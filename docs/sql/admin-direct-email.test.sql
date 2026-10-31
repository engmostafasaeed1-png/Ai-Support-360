-- Post-apply checks for docs/sql/admin-direct-email.sql. One transaction, rolled back at the end (no data kept).
BEGIN;
CREATE TEMP TABLE _ids AS SELECT
  '00000000-0000-0000-0000-0000000ade01'::uuid AS adm,
  '00000000-0000-0000-0000-0000000ade02'::uuid AS c1,   -- Sara, English
  '00000000-0000-0000-0000-0000000ade03'::uuid AS c2,   -- Arabic
  '00000000-0000-0000-0000-0000000ade04'::uuid AS c3,   -- tagged "test"
  '00000000-0000-0000-0000-0000000ade05'::uuid AS c4,   -- e-mail not confirmed
  '00000000-0000-0000-0000-0000000ade06'::uuid AS c5,   -- bounced (suppressed)
  '00000000-0000-0000-0000-0000000ade07'::uuid AS c6,   -- unsubscribed
  '00000000-0000-0000-0000-0000000ade08'::uuid AS c7,   -- paused quiet e-mails
  '00000000-0000-0000-0000-0000000adeff'::uuid AS ghost; -- no account
INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
SELECT x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'ade-' || right(x.id::text, 4) || '@example.com', CASE WHEN x.id = (SELECT c4 FROM _ids) THEN NULL ELSE now() END, now(), now()
FROM (SELECT unnest(ARRAY[adm, c1, c2, c3, c4, c5, c6, c7]) AS id FROM _ids
      UNION ALL SELECT ('00000000-0000-0000-0000-0000000ad1' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 6) g) x
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_roles (user_id, role) SELECT adm, 'admin' FROM _ids ON CONFLICT DO NOTHING;
INSERT INTO profiles (user_id, display_name, preferred_language)
SELECT c1, 'Sara Hassan', 'en' FROM _ids UNION ALL SELECT c2, 'مريم علي', 'ar' FROM _ids UNION ALL SELECT adm, 'Ezz Admin', 'en' FROM _ids;
INSERT INTO user_admin_state (user_id, tags) SELECT c3, ARRAY['test'] FROM _ids ON CONFLICT (user_id) DO UPDATE SET tags = EXCLUDED.tags;
INSERT INTO suppressed_emails (email, reason) SELECT 'ade-' || right(c5::text, 4) || '@example.com', 'bounce' FROM _ids UNION ALL SELECT 'ade-' || right(c6::text, 4) || '@example.com', 'unsubscribe' FROM _ids;
INSERT INTO user_notification_pauses (user_id, paused_until, categories, email, in_app)
SELECT c7, now() + interval '3 days', ARRAY['reminders', 'digests', 'activity'], true, false FROM _ids;
DELETE FROM platform_settings WHERE key IN ('admin_direct_email_enabled', 'admin_direct_email_per_send_cap', 'admin_messages_email_enabled', 'admin_messages_email_daily_cap');
SELECT set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true) FROM _ids;

CREATE OR REPLACE FUNCTION pg_temp.msg(_ids uuid[], _channel text, _key text, _extra jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('ids', to_jsonb(_ids), 'channel', _channel, 'request_key', _key, 'confirmed', true, 'category', 'notice',
    'subject', 'Hello {first_name}', 'body', 'Hi {first_name}, please check /client/tickets.', 'link', '/client/tickets',
    'subject_ar', 'مرحبا {first_name}', 'body_ar', 'أهلا {first_name}') || _extra $$;
CREATE OR REPLACE FUNCTION pg_temp.err(_p jsonb) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM public.admin_direct_email_send(_p); RETURN 'no error'; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;

-- 1. One message per person, personalised, in the person's language; more than 5 people is NOT turned into in-app only.
DO $$
DECLARE i _ids; r jsonb; _many uuid[];
BEGIN
  SELECT * INTO i FROM _ids;
  SELECT array_agg(('00000000-0000-0000-0000-0000000ad1' || lpad(g::text, 2, '0'))::uuid) INTO _many FROM generate_series(1, 6) g;
  r := public.admin_direct_email_send(pg_temp.msg(_many || ARRAY[i.c1, i.c2], 'both', 'test-key-0001'));
  IF (SELECT count(*) FROM admin_message_emails WHERE direct_send = (r #>> '{send,id}')::uuid AND status = 'queued') <> 8 THEN
    RAISE EXCEPTION '1 failed: expected 8 queued e-mails, got %', r;
  END IF;
  IF (SELECT count(DISTINCT recipient) FROM admin_message_emails WHERE direct_send = (r #>> '{send,id}')::uuid) <> 8 THEN RAISE EXCEPTION '1 failed: one row per person'; END IF;
  IF (SELECT content ->> 'title' FROM admin_message_emails WHERE direct_send = (r #>> '{send,id}')::uuid AND recipient = i.c1) <> 'Hello Sara' THEN RAISE EXCEPTION '1 failed: first name'; END IF;
  IF (SELECT content ->> 'title' FROM admin_message_emails WHERE direct_send = (r #>> '{send,id}')::uuid AND recipient = i.c2) <> 'مرحبا مريم' THEN RAISE EXCEPTION '1 failed: Arabic'; END IF;
  IF (SELECT title FROM notifications WHERE user_id = (SELECT c1 FROM _ids) ORDER BY created_at DESC LIMIT 1) <> 'Hello Sara' THEN RAISE EXCEPTION '1 failed: in-app copy'; END IF;
  IF (SELECT content ->> 'title' FROM admin_message_emails WHERE direct_send = (r #>> '{send,id}')::uuid AND recipient = _many[1]) <> 'Hello' THEN RAISE EXCEPTION '1 failed: no name -> placeholder removed'; END IF;
  RAISE NOTICE 'ok 1 one message per person, personalised, no list rule';
END $$;

-- 2. Exclusions with reasons; with "both" the people without e-mail still get the in-app notice.
DO $$
DECLARE i _ids; p jsonb;
BEGIN
  SELECT * INTO i FROM _ids;
  p := public.admin_direct_email_preview(jsonb_build_object('ids', to_jsonb(ARRAY[i.adm, i.c1, i.c3, i.c4, i.c5, i.c6, i.c7, i.ghost]), 'channel', 'both', 'category', 'notice'));
  IF p -> 'by_reason' <> '{"self":1,"paused":1,"not_found":1,"test_account":1,"email_not_confirmed":1,"recipient_suppressed":1,"recipient_unsubscribed":1}'::jsonb THEN
    RAISE EXCEPTION '2 failed: reasons %', p -> 'by_reason';
  END IF;
  IF (p ->> 'email_reach')::int <> 1 OR (p ->> 'in_app_reach')::int <> 5 OR (p ->> 'recipients')::int <> 5 THEN RAISE EXCEPTION '2 failed: reach %', p; END IF;
  p := public.admin_direct_email_preview(jsonb_build_object('ids', to_jsonb(ARRAY[i.c1, i.c7]), 'channel', 'email', 'important', true));
  IF (p ->> 'email_reach')::int <> 2 THEN RAISE EXCEPTION '2 failed: important overrides the quiet pause'; END IF;
  p := public.admin_direct_email_preview(jsonb_build_object('ids', to_jsonb(ARRAY[i.c1, i.c3]), 'channel', 'in_app', 'tests', true));
  IF (p ->> 'recipients')::int <> 2 THEN RAISE EXCEPTION '2 failed: include tests'; END IF;
  RAISE NOTICE 'ok 2 exclusions';
END $$;

-- 3. Channels: e-mail only creates no in-app notice; in-app only queues no e-mail; skipped rows carry the reason.
DO $$
DECLARE i _ids; r jsonb; _n int;
BEGIN
  SELECT * INTO i FROM _ids;
  SELECT count(*) INTO _n FROM notifications WHERE user_id = i.c1;
  r := public.admin_direct_email_send(pg_temp.msg(ARRAY[i.c1, i.c5], 'email', 'test-key-0003'));
  IF (SELECT count(*) FROM notifications WHERE user_id = i.c1) <> _n THEN RAISE EXCEPTION '3 failed: e-mail only made an in-app notice'; END IF;
  IF (SELECT reason FROM admin_message_emails WHERE direct_send = (r #>> '{send,id}')::uuid AND recipient = i.c5) <> 'recipient_suppressed' THEN RAISE EXCEPTION '3 failed: suppressed row'; END IF;
  r := public.admin_direct_email_send(pg_temp.msg(ARRAY[i.c1, i.c2], 'in_app', 'test-key-0004'));
  IF EXISTS (SELECT 1 FROM admin_message_emails WHERE direct_send = (r #>> '{send,id}')::uuid) THEN RAISE EXCEPTION '3 failed: in-app only queued e-mail'; END IF;
  IF jsonb_array_length(r -> 'rows') <> 2 OR (r #>> '{rows,0,in_app}')::boolean IS NOT TRUE THEN RAISE EXCEPTION '3 failed: report %', r; END IF;
  RAISE NOTICE 'ok 3 channels';
END $$;

-- 4. Cap per send, nobody, safety rules (secrets, outside links), confirmation and the switch.
DO $$
DECLARE i _ids;
BEGIN
  SELECT * INTO i FROM _ids;
  INSERT INTO platform_settings (key, value) VALUES ('admin_direct_email_per_send_cap', '1'::jsonb);
  IF pg_temp.err(pg_temp.msg(ARRAY[i.c1, i.c2], 'both', 'test-key-0005')) NOT LIKE '%ade_over_cap%' THEN RAISE EXCEPTION '4 failed: cap'; END IF;
  DELETE FROM platform_settings WHERE key = 'admin_direct_email_per_send_cap';
  IF pg_temp.err(pg_temp.msg(ARRAY[i.c3, i.ghost], 'both', 'test-key-0006')) NOT LIKE '%ade_nobody%' THEN RAISE EXCEPTION '4 failed: nobody'; END IF;
  IF pg_temp.err(pg_temp.msg(ARRAY[i.c1], 'both', 'test-key-0007', '{"body":"password: hunter22"}')) NOT LIKE '%ame_secret%' THEN RAISE EXCEPTION '4 failed: secret'; END IF;
  IF pg_temp.err(pg_temp.msg(ARRAY[i.c1], 'both', 'test-key-0008', '{"body":"see https://evil.example/x"}')) NOT LIKE '%ade_outside_link%' THEN RAISE EXCEPTION '4 failed: outside link'; END IF;
  IF pg_temp.err(pg_temp.msg(ARRAY[i.c1], 'both', 'test-key-0009', '{"body":"see https://aisupport360.com.evil.example"}')) NOT LIKE '%ade_outside_link%' THEN RAISE EXCEPTION '4 failed: look-alike link'; END IF;
  IF pg_temp.err(pg_temp.msg(ARRAY[i.c1], 'both', 'test-key-0010', '{"body":"see https://www.aisupport360.com/pricing."}')) <> 'no error' THEN RAISE EXCEPTION '4 failed: own site link'; END IF;
  IF pg_temp.err(pg_temp.msg(ARRAY[i.c1], 'both', 'test-key-0011', '{"link":"https://evil.example"}')) NOT LIKE '%ame_link%' THEN RAISE EXCEPTION '4 failed: button link'; END IF;
  IF pg_temp.err(pg_temp.msg(ARRAY[i.c1], 'both', 'test-key-0012', '{"confirmed":false}')) NOT LIKE '%ade_confirm%' THEN RAISE EXCEPTION '4 failed: confirm'; END IF;
  INSERT INTO platform_settings (key, value) VALUES ('admin_direct_email_enabled', 'false'::jsonb);
  IF pg_temp.err(pg_temp.msg(ARRAY[i.c1], 'both', 'test-key-0013')) NOT LIKE '%ade_switched_off%' THEN RAISE EXCEPTION '4 failed: switch'; END IF;
  DELETE FROM platform_settings WHERE key = 'admin_direct_email_enabled';
  RAISE NOTICE 'ok 4 cap and safety rules';
END $$;

-- 5. Permission, double click, audit row per send.
DO $$
DECLARE i _ids; r jsonb; _n int;
BEGIN
  SELECT * INTO i FROM _ids;
  SELECT count(*) INTO _n FROM admin_direct_email_sends;
  r := public.admin_direct_email_send(pg_temp.msg(ARRAY[i.c1], 'both', 'test-key-0001'));
  IF (r ->> 'repeated')::boolean IS NOT TRUE OR (SELECT count(*) FROM admin_direct_email_sends) <> _n THEN RAISE EXCEPTION '5 failed: repeated request'; END IF;
  IF (SELECT count(*) FROM audit_logs WHERE action = 'admin_user.direct_email' AND user_id = i.adm) <> _n THEN RAISE EXCEPTION '5 failed: one audit row per send'; END IF;
  IF (SELECT metadata #>> '{after,subject}' FROM audit_logs WHERE action = 'admin_user.direct_email' ORDER BY created_at DESC LIMIT 1) IS NULL THEN RAISE EXCEPTION '5 failed: audit subject'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', i.c1, 'role', 'authenticated')::text, true);
  IF pg_temp.err(pg_temp.msg(ARRAY[i.c2], 'both', 'test-key-0020')) NOT LIKE '%permission%' THEN RAISE EXCEPTION '5 failed: non-admin'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', i.adm, 'role', 'authenticated')::text, true);
  RAISE NOTICE 'ok 5 permission, idempotent, audit';
END $$;

-- 6. Worker: e-mail-only rows are mailed from their own content; over the daily cap direct rows wait for tomorrow.
DO $$
DECLARE i _ids; c jsonb; _send uuid;
BEGIN
  SELECT * INTO i FROM _ids;
  UPDATE admin_message_emails SET status = 'skipped', reason = 'test_moved_aside' WHERE status = 'queued';
  _send := (public.admin_direct_email_send(pg_temp.msg(ARRAY[i.c1], 'email', 'test-key-0030')) #>> '{send,id}')::uuid;
  c := public.ame_claim(50);
  IF jsonb_array_length(c) <> 1 OR c #>> '{0,items,0,title}' <> 'Hello Sara' THEN RAISE EXCEPTION '6 failed: claim %', c; END IF;
  PERFORM public.ame_finish(c #>> '{0,mail_key}', 'sent');
  INSERT INTO platform_settings (key, value) VALUES ('admin_messages_email_daily_cap', '1'::jsonb);
  _send := (public.admin_direct_email_send(pg_temp.msg(ARRAY[i.c2], 'email', 'test-key-0031')) #>> '{send,id}')::uuid;
  c := public.ame_claim(50);
  IF jsonb_array_length(c) <> 0 OR (SELECT status FROM admin_message_emails WHERE direct_send = _send) <> 'queued'
     OR (SELECT send_after FROM admin_message_emails WHERE direct_send = _send) < date_trunc('day', now()) + interval '1 day' THEN
    RAISE EXCEPTION '6 failed: daily cap should hold direct rows';
  END IF;
  DELETE FROM platform_settings WHERE key = 'admin_messages_email_daily_cap';
  RAISE NOTICE 'ok 6 worker content and daily cap';
END $$;

-- 7. Send test to me: only the admin, marked test, nothing for anyone else.
DO $$
DECLARE i _ids; r jsonb; _n int;
BEGIN
  SELECT * INTO i FROM _ids;
  SELECT count(*) INTO _n FROM admin_message_emails;
  r := public.admin_direct_email_send(pg_temp.msg(ARRAY[i.c1, i.c2], 'both', '', '{"test":true}'));
  IF (SELECT count(*) FROM admin_message_emails) <> _n + 1 OR NOT EXISTS (SELECT 1 FROM admin_message_emails WHERE recipient = i.adm AND is_test) THEN
    RAISE EXCEPTION '7 failed: test copy %', r;
  END IF;
  RAISE NOTICE 'ok 7 test to me';
END $$;

ROLLBACK;
