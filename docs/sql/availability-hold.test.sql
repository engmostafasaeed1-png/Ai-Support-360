-- Feature Y checks (weekly availability required, reminders, grace, holds). One transaction, rolled back at the end.
-- Run in a scratch database after docs/sql/availability-hold.sql. Raises an exception on the first failed check.
BEGIN;
SET LOCAL client_min_messages = warning;
CREATE TEMP TABLE _ids AS SELECT
  '00000000-0000-0000-0000-0000000000a1'::uuid AS admin,
  '00000000-0000-0000-0000-0000000000b1'::uuid AS client,
  '00000000-0000-0000-0000-0000000000c1'::uuid AS a_user, '00000000-0000-0000-0000-00000000cc01'::uuid AS a,
  '00000000-0000-0000-0000-0000000000c2'::uuid AS b_user, '00000000-0000-0000-0000-00000000cc02'::uuid AS b,
  '00000000-0000-0000-0000-0000000000c3'::uuid AS c_user, '00000000-0000-0000-0000-00000000cc03'::uuid AS c;
GRANT SELECT ON _ids TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _u IS NULL THEN '' ELSE json_build_object('sub', _u, 'role', 'authenticated')::text END, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.as_service() RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(_ok, false) THEN RAISE EXCEPTION 'FAILED: %', _what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.fails(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.fails(text) TO authenticated;

-- 09:00 local time right now for A, so the hourly profile reminder claim picks A up.
CREATE TEMP TABLE _tz AS SELECT (((9 - extract(hour FROM now() AT TIME ZONE 'UTC')::int) + 36) % 24) - 12 AS h;
CREATE TEMP TABLE _tzname AS SELECT CASE WHEN h >= 0 THEN 'Etc/GMT-' || h ELSE 'Etc/GMT+' || (-h) END AS tz FROM _tz;

INSERT INTO auth.users (id, email) SELECT u, 'x@example.com' FROM _ids, LATERAL unnest(ARRAY[admin, client, a_user, b_user, c_user]) u;
INSERT INTO public.user_roles (user_id, role) SELECT admin, 'admin' FROM _ids;
INSERT INTO public.profiles (user_id, display_name, preferred_language) SELECT a_user, 'Sara', 'en' FROM _ids;
INSERT INTO public.profiles (user_id, display_name, preferred_language) SELECT client, 'Client', 'ar' FROM _ids;
INSERT INTO public.consultants (id, user_id, created_at, timezone) SELECT a, a_user, now() - interval '10 days', (SELECT tz FROM _tzname) FROM _ids;
INSERT INTO public.consultants (id, user_id, created_at) SELECT b, b_user, now() - interval '10 days' FROM _ids;
INSERT INTO public.consultants (id, user_id, created_at, availability_status) SELECT c, c_user, now() - interval '10 days', 'busy' FROM _ids;
INSERT INTO public.availability_slots (consultant_id, day_of_week, start_time, end_time) SELECT b, 0, '09:00', '17:00' FROM _ids;
INSERT INTO public.availability_slots (consultant_id, day_of_week, start_time, end_time, specific_date, is_recurring) SELECT c, NULL, '09:00', '12:00', current_date + 3, false FROM _ids;
UPDATE public.profile_field_rules SET mode = 'optional' WHERE field_key = 'bio';
INSERT INTO public.tickets (id, client_id, consultant_id, status) SELECT '00000000-0000-0000-0000-00000000dd01', client, a, 'in_progress' FROM _ids;
INSERT INTO public.tickets (client_id, consultant_id, status) SELECT client, a, 'closed' FROM _ids;
GRANT SELECT ON public.tickets TO authenticated;

-- 1. Required item ------------------------------------------------------------------------------------------------------
SELECT pg_temp.check((SELECT hard_required AND mode = 'required' FROM public.profile_field_rules WHERE field_key = 'availability'), 'availability is hard-required by default');
SELECT pg_temp.check('availability' = ANY(public.consultant_missing_fields((SELECT a FROM _ids))), 'missing list has availability (no slots)');
SELECT pg_temp.check('availability' = ANY(public.consultant_missing_fields((SELECT c FROM _ids))), 'a one-date slot is not weekly availability');
SELECT pg_temp.check(NOT ('availability' = ANY(public.consultant_missing_fields((SELECT b FROM _ids)))), 'a recurring slot fills it');

-- 2. Grace exclusion -----------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user((SELECT client FROM _ids));
SELECT pg_temp.check(NOT ((SELECT a FROM _ids) = ANY(public.hidden_consultant_ids())), 'inside the grace period: not hidden (enforce on, availability ignored there)');
UPDATE public.platform_settings SET value = to_jsonb(now() - interval '30 days') WHERE key = 'availability_grace_started_at';
SELECT pg_temp.check((SELECT a FROM _ids) = ANY(public.hidden_consultant_ids()), 'after the grace period: hidden from directory / new matching');
SELECT pg_temp.check(NOT ((SELECT b FROM _ids) = ANY(public.hidden_consultant_ids())), 'with weekly availability: visible');
SELECT pg_temp.check((SELECT a FROM _ids) = ANY(public.consultant_availability_blocked_ids()), 'left out of critical alerts too');
UPDATE public.profile_field_rules SET hard_required = false, mode = 'optional' WHERE field_key = 'availability';
SELECT pg_temp.check(NOT ((SELECT a FROM _ids) = ANY(public.hidden_consultant_ids())), 'not required: never hidden for it');
UPDATE public.profile_field_rules SET hard_required = true, mode = 'required' WHERE field_key = 'availability';
UPDATE public.platform_settings SET value = to_jsonb(now()) WHERE key = 'availability_grace_started_at';

-- 3. Reminders ------------------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check(public.availability_reminder_due((SELECT a FROM _ids)) = 'first', 'before the urgent notice: first');
SELECT pg_temp.check(public.availability_send_first(true) = 2, 'urgent notice to the two consultants missing it (A and C)');
SELECT pg_temp.check(public.availability_send_first(true) = 0, 'the urgent notice is one-time');
SELECT pg_temp.check((SELECT count(*) FROM public.notifications WHERE type = 'availability_urgent' AND pause_category IS NULL) = 2, 'in-app urgent notice is essential (no pause category)');
SELECT pg_temp.check((SELECT count(*) FROM public.availability_email_queue WHERE kind = 'first') = 2, 'urgent e-mail queued once per consultant');
SELECT pg_temp.check(public.availability_reminder_due((SELECT a FROM _ids)) = 'wait', 'right after the notice: wait');
UPDATE public.availability_reminder_log SET sent_at = now() - interval '45 hours';
SELECT pg_temp.check(public.availability_reminder_due((SELECT a FROM _ids)) = 'due', 'after 2 days: due');
UPDATE public.profile_reminder_log SET sent_at = now() - interval '1 day';
SELECT pg_temp.as_service();
CREATE TEMP TABLE _claim AS SELECT * FROM public.claim_profile_reminders(200);
SELECT pg_temp.check((SELECT count(*) FROM _claim WHERE consultant_id = (SELECT a FROM _ids) AND availability_urgent) = 1, 'folded into the daily profile mail as the urgent block');
SELECT pg_temp.check((SELECT count(*) FROM public.availability_reminder_log WHERE consultant_id = (SELECT a FROM _ids) AND kind = 'reminder') = 1, 'reminder logged');
SELECT pg_temp.check((SELECT count(*) FROM public.claim_profile_reminders(200)) = 0, 'never a second mail the same day');
SELECT pg_temp.as_user(NULL);
INSERT INTO public.availability_reminder_log (consultant_id, kind, sent_at) SELECT a, 'reminder', now() - interval '50 hours' FROM _ids, generate_series(1, 7);
UPDATE public.availability_reminder_log SET sent_at = now() - interval '50 hours' WHERE consultant_id = (SELECT a FROM _ids);
SELECT pg_temp.check(public.availability_reminder_due((SELECT a FROM _ids)) = 'wait', 'after 8 reminders: weekly (50 h is not enough)');
UPDATE public.availability_reminder_log SET sent_at = now() - interval '165 hours' WHERE consultant_id = (SELECT a FROM _ids);
SELECT pg_temp.check(public.availability_reminder_due((SELECT a FROM _ids)) = 'due', 'after 8 reminders: due again after a week');
INSERT INTO public.availability_slots (id, consultant_id, day_of_week, start_time, end_time) SELECT '00000000-0000-0000-0000-00000000ee01', a, 1, '09:00', '17:00' FROM _ids;
SELECT pg_temp.check(public.availability_reminder_due((SELECT a FROM _ids)) = 'stop', 'stops at once when filled');
DELETE FROM public.availability_slots WHERE id = '00000000-0000-0000-0000-00000000ee01';

-- Administrator reminder: 50 max, once per 24 h, audited.
UPDATE public.availability_reminder_log SET sent_at = now() - interval '2 days';
SELECT pg_temp.as_user((SELECT client FROM _ids));
SELECT pg_temp.check(pg_temp.fails('SELECT public.admin_send_availability_reminder(ARRAY[''00000000-0000-0000-0000-00000000cc01''::uuid])'), 'non-admin cannot send reminders');
SELECT pg_temp.as_user((SELECT admin FROM _ids));
SELECT pg_temp.check(pg_temp.fails('SELECT public.admin_send_availability_reminder(ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 51)))'), 'more than 50 refused');
SELECT pg_temp.check(public.admin_send_availability_reminder(ARRAY[(SELECT a FROM _ids), (SELECT b FROM _ids)]) = 1, 'only consultants missing it are reminded');
SELECT pg_temp.check(public.admin_send_availability_reminder(ARRAY[(SELECT a FROM _ids)]) = 0, 'at most once per 24 hours');
SELECT pg_temp.check((SELECT count(*) FROM public.audit_logs WHERE action = 'availability_reminder_sent') = 2, 'reminder sends audited');
SELECT pg_temp.check((SELECT count(*) FROM public.notifications WHERE type = 'availability_urgent' AND pause_category = 'reminders') = 1, 'admin reminder can be held by a pause');

-- 4. Holds --------------------------------------------------------------------------------------------------------------------
SELECT pg_temp.as_user((SELECT a_user FROM _ids));
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(pg_temp.fails('SELECT public.set_my_hold(now(), now() + interval ''100 days'', NULL)'), 'longer than hold_max_days refused');
SELECT pg_temp.check(pg_temp.fails('SELECT public.set_my_hold(now() + interval ''181 days'', now() + interval ''185 days'', NULL)'), 'more than 180 days ahead refused');
SELECT pg_temp.check(pg_temp.fails('SELECT public.set_my_hold(now(), NULL, NULL)'), 'end required');
SELECT pg_temp.check(pg_temp.fails('SELECT public.set_my_hold(now(), now() + interval ''3 days'', ''call me on +966 55 123 4567'')'), 'contact details refused in the reason');
SELECT public.set_my_hold(now(), now() + interval '10 days', 'Family leave');
RESET ROLE;
SELECT pg_temp.check((SELECT status FROM public.consultant_holds WHERE consultant_id = (SELECT a FROM _ids) AND status <> 'cancelled') = 'active', 'starting now: active at once');
SELECT pg_temp.check((SELECT availability_status::text FROM public.consultants WHERE id = (SELECT a FROM _ids)) = 'on_hold', 'status on_hold while active');
SELECT pg_temp.check((SELECT prev_status FROM public.consultant_holds WHERE consultant_id = (SELECT a FROM _ids) AND status = 'active') = 'available', 'previous status remembered');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.consultant_unavailable_periods p JOIN public.consultant_holds h ON h.unavailable_period_id = p.id
                              WHERE h.consultant_id = (SELECT a FROM _ids) AND p.starts_at = h.starts_at AND p.ends_at = h.ends_at), 'responsiveness: the hold is an unavailable period');
SELECT pg_temp.check((SELECT count(*) FROM public.notifications WHERE type = 'consultant_hold' AND user_id = (SELECT client FROM _ids)) = 1, 'one client notice for the one active ticket (closed ticket skipped)');
SELECT pg_temp.check((SELECT body FROM public.notifications WHERE type = 'consultant_hold') LIKE 'مستشارك متوقف مؤقتًا من % إلى %، ويستمر العمل الحالي كما هو متفق عليه.', 'client notice in the client''s language');
SELECT pg_temp.check(public.hold_client_notice_text('2026-11-01 08:00+00', '2026-11-15 08:00+00', 'en') = 'Your consultant is on hold from 1 Nov 2026 to 15 Nov 2026, current work continues as agreed.', 'English notice text');
SELECT pg_temp.check(pg_temp.fails('INSERT INTO public.ticket_match_requests (ticket_id, consultant_id) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-00000000cc01'')'), 'no new requests during the hold');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check(pg_temp.fails('UPDATE public.consultants SET availability_status = ''available'' WHERE id = ''00000000-0000-0000-0000-00000000cc01'''), 'cannot switch status away from on hold without resuming');
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_holds) >= 1, 'consultant reads own hold');
-- Overlapping hold merges; a separate future hold stays scheduled.
SELECT public.set_my_hold(now() + interval '9 days', now() + interval '20 days', NULL);
SELECT public.set_my_hold(now() + interval '40 days', now() + interval '45 days', NULL);
RESET ROLE;
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_holds WHERE consultant_id = (SELECT a FROM _ids) AND status IN ('scheduled', 'active')) = 2, 'overlap merged, separate future hold kept');
SELECT pg_temp.check((SELECT ends_at > now() + interval '19 days' FROM public.consultant_holds WHERE consultant_id = (SELECT a FROM _ids) AND status = 'active'), 'merged hold ends at the later end');
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_holds WHERE consultant_id = (SELECT a FROM _ids) AND status = 'cancelled' AND merged_into IS NOT NULL) = 1, 'absorbed row marked merged');
-- Shorten, cancel the future one.
SET LOCAL ROLE authenticated;
SELECT public.change_my_hold((SELECT id FROM public.consultant_holds WHERE status = 'active'), now() + interval '5 days');
SELECT public.cancel_my_hold((SELECT id FROM public.consultant_holds WHERE status = 'scheduled'));
RESET ROLE;
SELECT pg_temp.check((SELECT ends_at < now() + interval '6 days' FROM public.consultant_holds WHERE consultant_id = (SELECT a FROM _ids) AND status = 'active'), 'shortened');
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_holds WHERE consultant_id = (SELECT a FROM _ids) AND status = 'scheduled') = 0, 'future hold cancelled');
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_unavailable_periods WHERE consultant_id = (SELECT a FROM _ids)) = 1, 'only the remaining hold keeps a period');
-- Reminders pause during the hold.
SELECT pg_temp.check(public.availability_reminder_due((SELECT a FROM _ids)) = 'stop', 'reminders paused while on hold');
-- Directory: label (default) keeps the consultant listed; hide removes them; the public part is only the end.
SELECT pg_temp.as_user((SELECT client FROM _ids));
SELECT pg_temp.check(NOT ((SELECT a FROM _ids) = ANY(public.hidden_consultant_ids())), 'mode label: still listed');
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_hold_public(ARRAY[(SELECT a FROM _ids), (SELECT b FROM _ids)])) = 1, 'public hold end for cards');
SET LOCAL ROLE authenticated;
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_holds) = 0, 'clients never read holds (private reason)');
RESET ROLE;
UPDATE public.platform_settings SET value = '"hide"' WHERE key = 'hold_directory_mode';
SELECT pg_temp.check((SELECT a FROM _ids) = ANY(public.hidden_consultant_ids()), 'mode hide: hidden');
UPDATE public.platform_settings SET value = '"label"' WHERE key = 'hold_directory_mode';
SELECT pg_temp.check((SELECT a FROM _ids) = ANY(public.consultant_on_hold_ids()), 'left out of critical alerts while on hold');
-- Automatic resume by the sweep.
UPDATE public.consultant_holds SET starts_at = now() - interval '2 days', ends_at = now() - interval '1 minute' WHERE consultant_id = (SELECT a FROM _ids) AND status = 'active';
SELECT public.availability_hold_sweep();
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_holds WHERE consultant_id = (SELECT a FROM _ids) AND status = 'ended') = 1, 'sweep ends the hold');
SELECT pg_temp.check((SELECT availability_status::text FROM public.consultants WHERE id = (SELECT a FROM _ids)) = 'available', 'status back to the previous value');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.notifications WHERE type = 'hold_ended' AND user_id = (SELECT a_user FROM _ids)), 'in-app resume notice');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.availability_email_queue WHERE kind = 'resumed' AND consultant_id = (SELECT a FROM _ids)), 'resume e-mail queued');
-- A future hold starts by the sweep; "Resume now" ends it early.
SELECT pg_temp.as_user((SELECT b_user FROM _ids));
SELECT public.set_my_hold(now() + interval '1 hour', now() + interval '3 days', NULL);
SELECT pg_temp.check((SELECT status FROM public.consultant_holds WHERE consultant_id = (SELECT b FROM _ids)) = 'scheduled', 'future hold scheduled');
UPDATE public.consultant_holds SET starts_at = now() - interval '1 minute' WHERE consultant_id = (SELECT b FROM _ids);
SELECT public.availability_hold_sweep();
SELECT pg_temp.check((SELECT availability_status::text FROM public.consultants WHERE id = (SELECT b FROM _ids)) = 'on_hold', 'sweep starts a due hold');
SELECT public.resume_my_hold();
SELECT pg_temp.check((SELECT status FROM public.consultant_holds WHERE consultant_id = (SELECT b FROM _ids)) = 'ended', 'resume now ends it');
SELECT pg_temp.check((SELECT availability_status::text FROM public.consultants WHERE id = (SELECT b FROM _ids)) = 'available', 'resume restores the status');
-- Administrator on behalf (reason required, audited).
SELECT pg_temp.as_user((SELECT client FROM _ids));
SELECT pg_temp.check(pg_temp.fails('SELECT public.admin_set_hold(''00000000-0000-0000-0000-00000000cc03'', NULL, now() + interval ''3 days'', ''x'')'), 'non-admin cannot set a hold');
SELECT pg_temp.as_user((SELECT admin FROM _ids));
SELECT pg_temp.check(pg_temp.fails('SELECT public.admin_set_hold(''00000000-0000-0000-0000-00000000cc03'', NULL, now() + interval ''3 days'', '''')'), 'admin needs a reason');
SELECT public.admin_set_hold((SELECT c FROM _ids), NULL, now() + interval '3 days', 'Asked by e-mail to support');
SELECT pg_temp.check((SELECT set_by_admin AND status = 'active' FROM public.consultant_holds WHERE consultant_id = (SELECT c FROM _ids)), 'admin hold active');
SELECT pg_temp.check((SELECT availability_status::text FROM public.consultants WHERE id = (SELECT c FROM _ids)) = 'on_hold', 'admin hold sets on_hold');
SELECT pg_temp.check((SELECT count(*) FROM public.admin_holds()) = 1, 'admin list shows the current hold');
SELECT pg_temp.check(public.admin_clear_hold((SELECT c FROM _ids), 'Back early') = 1, 'admin clears it');
SELECT pg_temp.check((SELECT availability_status::text FROM public.consultants WHERE id = (SELECT c FROM _ids)) = 'busy', 'admin clear restores busy');
SELECT pg_temp.check((SELECT count(*) FROM public.audit_logs WHERE action IN ('consultant_hold_set', 'consultant_hold_cleared')) = 2, 'admin hold changes audited');
-- Settings validation.
SELECT pg_temp.check(pg_temp.fails('SELECT public.admin_set_availability_settings(91, 90, ''label'', true)'), 'grace days capped at 90');
SELECT public.admin_set_availability_settings(10, 60, 'hide', true);
SELECT pg_temp.check(public.avail_setting_int('hold_max_days', 90, 1, 365) = 60 AND public.hold_directory_mode() = 'hide', 'settings saved');
SELECT pg_temp.check(EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'availability_settings_changed'), 'settings audited');

SELECT 'availability-hold checks passed';
ROLLBACK;
