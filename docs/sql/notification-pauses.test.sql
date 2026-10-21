-- Feature Q post-apply checks. Runs inside one transaction and rolls everything back (no data is kept).
-- Uses fake ids: user 1 (client), user 2 (consultant with consultant row c2) and user 3 (outsider), as in a scratch database.
BEGIN;
CREATE TEMP TABLE _ids AS SELECT
  '00000000-0000-0000-0000-00000000f001'::uuid AS u1,
  '00000000-0000-0000-0000-00000000f002'::uuid AS u2,
  '00000000-0000-0000-0000-00000000f003'::uuid AS u3,
  '00000000-0000-0000-0000-00000000fc02'::uuid AS c2,
  '00000000-0000-0000-0000-00000000fa01'::uuid AS req_normal,
  '00000000-0000-0000-0000-00000000fa02'::uuid AS req_critical;
GRANT SELECT ON _ids TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
$$;

-- 0. Categories (same cases as src/lib/notificationPause.test.ts).
DO $$ BEGIN
  IF notification_category('critical_request', 'Critical request') <> 'essential' THEN RAISE EXCEPTION 'critical'; END IF;
  IF notification_category('payment', 'Payment received') <> 'essential' THEN RAISE EXCEPTION 'payment'; END IF;
  IF notification_category('security_alert', 'New sign-in') <> 'essential' THEN RAISE EXCEPTION 'security'; END IF;
  IF notification_category('policy_reminder', 'Please confirm') <> 'essential' THEN RAISE EXCEPTION 'policy'; END IF;
  IF notification_category('match_request', 'New assignment request') <> 'essential' THEN RAISE EXCEPTION 'first request'; END IF;
  IF notification_category('match_request', 'Reminder: assignment request waiting') <> 'reminders' THEN RAISE EXCEPTION 'reminder'; END IF;
  IF notification_category('match_request', 'تذكير: طلب تعيين بانتظار ردك') <> 'reminders' THEN RAISE EXCEPTION 'ar reminder'; END IF;
  IF notification_category('match_request', 'No reply from the consultant') <> 'activity' THEN RAISE EXCEPTION 'no reply'; END IF;
  IF notification_category('profile_reminder', 'Add your location') <> 'reminders' THEN RAISE EXCEPTION 'profile'; END IF;
  IF notification_category('admin_reminder_policy', 'x') <> 'essential' THEN RAISE EXCEPTION 'admin policy reminder'; END IF;
  IF notification_category('admin_reminder_profile', 'x') <> 'reminders' THEN RAISE EXCEPTION 'admin reminder'; END IF;
  IF notification_category('admin', 'Assignment requests without reply') <> 'digests' THEN RAISE EXCEPTION 'digest'; END IF;
  IF notification_category('ticket', 'Ticket updated') <> 'activity' THEN RAISE EXCEPTION 'activity'; END IF;
END $$;

INSERT INTO consultants (id, user_id) SELECT c2, u2 FROM _ids ON CONFLICT DO NOTHING;
INSERT INTO ticket_match_requests (id, is_critical) SELECT req_normal, false FROM _ids ON CONFLICT DO NOTHING;
INSERT INTO ticket_match_requests (id, is_critical) SELECT req_critical, true FROM _ids ON CONFLICT DO NOTHING;

-- 1. User 1 pauses e-mails and in-app alerts for 1 week, holding in-app notices.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT u1 FROM _ids));
DO $$ DECLARE r jsonb; BEGIN
  r := pause_my_notifications('1w', true, true, ARRAY['reminders', 'digests', 'activity'], true, false, 'settings');
  IF (r -> 'pause' ->> 'duration') <> '1w' THEN RAISE EXCEPTION 'pause not saved'; END IF;
  IF (r -> 'pause' ->> 'paused_until')::timestamptz < now() + interval '6 days 23 hours' THEN RAISE EXCEPTION 'end date'; END IF;
END $$;
-- Own row only.
SELECT pg_temp.as_user((SELECT u3 FROM _ids));
DO $$ BEGIN IF (SELECT count(*) FROM user_notification_pauses) <> 0 THEN RAISE EXCEPTION 'outsider reads pause'; END IF; END $$;
-- Too long for the platform maximum.
DO $$ BEGIN
  UPDATE platform_settings SET value = '7'::jsonb WHERE key = 'notification_pause_max_days';
  RAISE EXCEPTION 'non-admin changed settings';
EXCEPTION WHEN insufficient_privilege OR raise_exception THEN NULL;
END $$;
RESET ROLE;

-- 2. The gate: essential never paused; reminders / activity paused per channel.
DO $$ DECLARE u uuid := (SELECT u1 FROM _ids); BEGIN
  IF notifications_paused(u, 'essential', 'email') THEN RAISE EXCEPTION 'essential paused'; END IF;
  IF NOT notifications_paused(u, 'reminders', 'email') THEN RAISE EXCEPTION 'reminder e-mail not held'; END IF;
  IF NOT notifications_paused(u, 'activity', 'in_app') THEN RAISE EXCEPTION 'activity popup not held'; END IF;
  IF NOT (notification_email_check(u, 'reminders') ->> 'paused')::boolean THEN RAISE EXCEPTION 'email check'; END IF;
  IF (notification_email_check(u, 'essential') ->> 'links')::boolean THEN RAISE EXCEPTION 'footer on essential'; END IF;
END $$;

-- 3. Notifications insert: essential delivered normally, reminders held (hold_in_app), Critical reminders stay essential.
INSERT INTO notifications (user_id, title, body, type, link) SELECT u1, 'Payment received', 'x', 'payment', NULL FROM _ids;
INSERT INTO notifications (user_id, title, body, type, link) SELECT u1, 'Reminder: assignment request waiting', 'x', 'match_request', '/consultant/requests?request=' || req_normal FROM _ids;
INSERT INTO notifications (user_id, title, body, type, link) SELECT u1, 'Reminder: assignment request waiting', 'x', 'match_request', '/consultant/requests?request=' || req_critical FROM _ids;
DO $$ BEGIN
  IF (SELECT silent FROM notifications WHERE type = 'payment' AND user_id = (SELECT u1 FROM _ids)) THEN RAISE EXCEPTION 'payment silenced'; END IF;
  IF (SELECT count(*) FROM notifications WHERE user_id = (SELECT u1 FROM _ids) AND silent AND held_until > now() AND pause_category = 'reminders') <> 1 THEN
    RAISE EXCEPTION 'reminder not held'; END IF;
  IF (SELECT count(*) FROM notifications WHERE user_id = (SELECT u1 FROM _ids) AND link LIKE '%' || (SELECT req_critical FROM _ids) AND NOT silent AND pause_category = 'essential') <> 1 THEN
    RAISE EXCEPTION 'critical reminder paused'; END IF;
END $$;

-- 4. Consultant pauses only e-mails, stays available: in-app arrives normally, no unavailable period.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT u2 FROM _ids));
SELECT pause_my_notifications('3d', true, false, ARRAY['reminders'], false, false, 'bell');
RESET ROLE;
INSERT INTO notifications (user_id, title, body, type) SELECT u2, 'Complete your profile', 'x', 'profile_reminder' FROM _ids;
DO $$ BEGIN
  IF (SELECT silent FROM notifications WHERE user_id = (SELECT u2 FROM _ids) AND type = 'profile_reminder') THEN RAISE EXCEPTION 'in-app silenced'; END IF;
  IF notifications_paused((SELECT u2 FROM _ids), 'activity', 'email') THEN RAISE EXCEPTION 'unchosen category paused'; END IF;
  IF EXISTS (SELECT 1 FROM consultant_unavailable_periods WHERE consultant_id = (SELECT c2 FROM _ids) AND ends_at > now()) THEN
    RAISE EXCEPTION 'marked unavailable without choice'; END IF;
END $$;

-- 5. Signed link: idempotent per nonce; "also mark me unavailable" adds a period that ends with the pause.
DO $$ DECLARE a jsonb; b jsonb; u uuid := (SELECT u2 FROM _ids); BEGIN
  a := notification_pause_link_action(u, '0123456789abcdef', 'pause', '1m');
  b := notification_pause_link_action(u, '0123456789abcdef', 'pause', '1m');
  IF a ->> 'until' IS DISTINCT FROM b ->> 'until' THEN RAISE EXCEPTION 'link not idempotent'; END IF;
  IF (SELECT count(*) FROM notification_pause_events WHERE user_id = u AND source = 'email' AND action = 'pause') <> 1 THEN RAISE EXCEPTION 'double audit'; END IF;
  IF (SELECT email FROM user_notification_pauses WHERE user_id = u) IS NOT TRUE OR (SELECT in_app FROM user_notification_pauses WHERE user_id = u) THEN
    RAISE EXCEPTION 'link overwrote own choices'; END IF;
  a := notification_pause_link_action(u, 'fedcba9876543210', 'unavailable', NULL);
  IF NOT (a ->> 'unavailable')::boolean THEN RAISE EXCEPTION 'unavailable not set'; END IF;
  IF NOT EXISTS (SELECT 1 FROM consultant_unavailable_periods WHERE consultant_id = (SELECT c2 FROM _ids) AND ends_at > now() + interval '29 days') THEN
    RAISE EXCEPTION 'no unavailable period'; END IF;
  BEGIN
    PERFORM notification_pause_link_action(u, 'not-a-nonce', 'pause', '1m');
    RAISE EXCEPTION 'bad nonce accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;

-- 6. Resume (link) ends the unavailable period at once; no "back" notice for a manual resume.
DO $$ DECLARE u uuid := (SELECT u2 FROM _ids); BEGIN
  PERFORM notification_pause_link_action(u, '1111111111111111', 'resume', NULL);
  IF notifications_paused(u, 'reminders', 'email') THEN RAISE EXCEPTION 'resume failed'; END IF;
  IF EXISTS (SELECT 1 FROM consultant_unavailable_periods WHERE consultant_id = (SELECT c2 FROM _ids) AND ends_at > now()) THEN
    RAISE EXCEPTION 'still unavailable'; END IF;
  IF EXISTS (SELECT 1 FROM notifications WHERE user_id = u AND type = 'notifications_resumed') THEN RAISE EXCEPTION 'notice on manual resume'; END IF;
END $$;

-- 7. Expiry: the pause ends by itself, held notices come back and one "Your notifications are back" notice is sent.
UPDATE user_notification_pauses SET paused_until = now() - interval '1 minute' WHERE user_id = (SELECT u1 FROM _ids);
DO $$ DECLARE u uuid := (SELECT u1 FROM _ids); BEGIN
  IF notifications_paused(u, 'reminders', 'email') THEN RAISE EXCEPTION 'expired pause still active'; END IF;
  PERFORM notification_pause_sweep();
  PERFORM notification_pause_sweep();
  IF (SELECT count(*) FROM notifications WHERE user_id = u AND type = 'notifications_resumed') <> 1 THEN RAISE EXCEPTION 'back notice not once'; END IF;
  IF EXISTS (SELECT 1 FROM notifications WHERE user_id = u AND held_until IS NOT NULL) THEN RAISE EXCEPTION 'held not released'; END IF;
END $$;

-- 8. Admin switch off: nothing is paused any more.
UPDATE platform_settings SET value = 'false'::jsonb WHERE key = 'notification_pause_enabled';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT u3 FROM _ids));
DO $$ BEGIN
  PERFORM pause_my_notifications('3d');
  RAISE EXCEPTION 'pause allowed while switched off';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM admin_notification_pause_overview();
  RAISE EXCEPTION 'non-admin read the count';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;

SELECT 'Feature Q checks passed' AS result;
ROLLBACK;
