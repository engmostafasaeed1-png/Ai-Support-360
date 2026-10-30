-- Post-apply checks for docs/sql/admin-message-email.sql. One transaction, rolled back at the end (no data kept).
BEGIN;
CREATE TEMP TABLE _ids AS SELECT
  '00000000-0000-0000-0000-0000000ae001'::uuid AS adm,
  '00000000-0000-0000-0000-0000000ae002'::uuid AS u1,
  '00000000-0000-0000-0000-0000000ae003'::uuid AS u2,
  '00000000-0000-0000-0000-0000000ae004'::uuid AS u3,   -- tagged "test"
  '00000000-0000-0000-0000-0000000ae005'::uuid AS u4;   -- e-mail not confirmed
INSERT INTO auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
SELECT x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'ame-' || right(x.id::text, 4) || '@example.com', CASE WHEN x.id = (SELECT u4 FROM _ids) THEN NULL ELSE now() END, now(), now()
FROM (SELECT unnest(ARRAY[adm, u1, u2, u3, u4]) AS id FROM _ids
      UNION ALL SELECT ('00000000-0000-0000-0000-0000000ae1' || lpad(g::text, 2, '0'))::uuid FROM generate_series(1, 7) g) x
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_roles (user_id, role) SELECT adm, 'admin' FROM _ids ON CONFLICT DO NOTHING;
INSERT INTO user_admin_state (user_id, tags) SELECT u3, ARRAY['Test'] FROM _ids
  ON CONFLICT (user_id) DO UPDATE SET tags = EXCLUDED.tags;

-- Acts as user _by (NULL = scheduled job) with the admin's e-mail choice header, and creates one notification.
CREATE OR REPLACE FUNCTION pg_temp.note(_by uuid, _to uuid, _type text, _hdr text DEFAULT '', _title text DEFAULT 'Hello')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _id uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', CASE WHEN _by IS NULL THEN '' ELSE json_build_object('sub', _by, 'role', 'authenticated')::text END, true);
  PERFORM set_config('request.headers', json_build_object('x-admin-email', _hdr)::text, true);
  INSERT INTO notifications (user_id, title, body, type, link) VALUES (_to, _title, 'Body <b>x</b>', _type, '/consultant/profile') RETURNING id INTO _id;
  RETURN _id;
END $$;
-- Each admin action is its own transaction in real use; the checks share one, so earlier rows are moved aside.
CREATE OR REPLACE FUNCTION pg_temp.next_action() RETURNS void LANGUAGE sql AS $$
  UPDATE admin_message_emails SET tx = tx - 1000000000 WHERE tx = txid_current();
$$;
CREATE OR REPLACE FUNCTION pg_temp.row_of(_n uuid) RETURNS admin_message_emails LANGUAGE sql AS $$
  SELECT * FROM admin_message_emails WHERE notification_id = _n;
$$;

-- 1. An admin's message is queued once; a second notice to the same person in the same action is not mailed again.
DO $$ DECLARE i _ids; a uuid; b uuid; BEGIN
  SELECT * INTO i FROM _ids;
  a := pg_temp.note(i.adm, i.u1, 'admin_message');
  b := pg_temp.note(i.adm, i.u1, 'ticket');
  IF (pg_temp.row_of(a)).status <> 'queued' OR (pg_temp.row_of(a)).kind <> 'comment' THEN RAISE EXCEPTION '1 first not queued'; END IF;
  IF (pg_temp.row_of(b)).reason IS DISTINCT FROM 'one_email_per_action' THEN RAISE EXCEPTION '1 duplicate mailed'; END IF;
  PERFORM pg_temp.next_action();
  RAISE NOTICE 'PASS 1 one e-mail per message and recipient';
END $$;

-- 2. System / cron notices (no signed-in user) and an admin's note to themself never enter this path.
DO $$ DECLARE i _ids; a uuid; b uuid; BEGIN
  SELECT * INTO i FROM _ids;
  a := pg_temp.note(NULL, i.u1, 'admin_message');
  b := pg_temp.note(i.adm, i.adm, 'admin_message');
  IF EXISTS (SELECT 1 FROM admin_message_emails WHERE notification_id IN (a, b)) THEN RAISE EXCEPTION '2 system notice captured'; END IF;
  RAISE NOTICE 'PASS 2 system notices excluded';
END $$;

-- 3. Flows that already e-mail keep their single e-mail.
DO $$ DECLARE i _ids; a uuid; b uuid; BEGIN
  SELECT * INTO i FROM _ids;
  a := pg_temp.note(i.adm, i.u1, 'nda');
  b := pg_temp.note(i.adm, i.u2, 'feedback_reply');
  IF (pg_temp.row_of(a)).reason <> 'already_emailed' OR (pg_temp.row_of(b)).reason <> 'already_emailed' THEN RAISE EXCEPTION '3 double mail'; END IF;
  PERFORM pg_temp.next_action();
  RAISE NOTICE 'PASS 3 no duplicate for flows that already mail';
END $$;

-- 4. Unticking works only for comments; decisions stay locked on. Unticking is logged with the admin.
DO $$ DECLARE i _ids; a uuid; b uuid; BEGIN
  SELECT * INTO i FROM _ids;
  a := pg_temp.note(i.adm, i.u1, 'admin_message', 'off');
  b := pg_temp.note(i.adm, i.u2, 'approval', 'off');
  IF (pg_temp.row_of(a)).reason <> 'admin_unticked_email' OR (pg_temp.row_of(a)).actor <> i.adm THEN RAISE EXCEPTION '4 untick not logged'; END IF;
  IF (pg_temp.row_of(b)).status <> 'queued' OR (pg_temp.row_of(b)).kind <> 'decision' THEN RAISE EXCEPTION '4 decision not locked on'; END IF;
  PERFORM pg_temp.next_action();
  RAISE NOTICE 'PASS 4 locked decisions, logged untick';
END $$;

-- 5. Test-tagged accounts are skipped unless the admin includes tests.
DO $$ DECLARE i _ids; a uuid; b uuid; BEGIN
  SELECT * INTO i FROM _ids;
  a := pg_temp.note(i.adm, i.u3, 'admin_message');
  PERFORM pg_temp.next_action();
  b := pg_temp.note(i.adm, i.u3, 'admin_message', 'tests');
  IF (pg_temp.row_of(a)).reason <> 'test_account' OR (pg_temp.row_of(b)).status <> 'queued' THEN RAISE EXCEPTION '5 test tag'; END IF;
  PERFORM pg_temp.next_action();
  RAISE NOTICE 'PASS 5 test accounts';
END $$;

-- 6. One action notifying more than 5 people is a list: in-app only.
DO $$ DECLARE i _ids; g int; BEGIN
  SELECT * INTO i FROM _ids;
  FOR g IN 1 .. 7 LOOP
    PERFORM pg_temp.note(i.adm, ('00000000-0000-0000-0000-0000000ae1' || lpad(g::text, 2, '0'))::uuid, 'admin_message');
  END LOOP;
  IF EXISTS (SELECT 1 FROM admin_message_emails WHERE tx = txid_current() AND status = 'queued') THEN RAISE EXCEPTION '6 list mailed'; END IF;
  IF (SELECT count(*) FROM admin_message_emails WHERE tx = txid_current() AND reason = 'list_send_in_app_only') <> 7 THEN RAISE EXCEPTION '6 list count'; END IF;
  PERFORM pg_temp.next_action();
  RAISE NOTICE 'PASS 6 list sends stay in-app';
END $$;

-- 7. Claim: unconfirmed address skipped with reason; pauses respected unless "important"; rate limit with digest.
DELETE FROM admin_message_emails WHERE status = 'queued' AND recipient NOT IN (SELECT u1 FROM _ids UNION SELECT u4 FROM _ids);
DO $$ DECLARE i _ids; r jsonb; a uuid; b uuid; n int; k text; BEGIN
  SELECT * INTO i FROM _ids;
  DELETE FROM admin_message_emails WHERE recipient = i.u1;
  a := pg_temp.note(i.adm, i.u4, 'admin_message');
  PERFORM pg_temp.next_action();
  PERFORM notification_pause_apply(i.u2, '1w', true, true, ARRAY['reminders', 'digests', 'activity'], false, false, 'settings');
  a := pg_temp.note(i.adm, i.u2, 'ticket', '', 'Ticket updated');
  PERFORM pg_temp.next_action();
  b := pg_temp.note(i.adm, i.u2, 'ticket', 'important', 'Ticket updated');
  PERFORM pg_temp.next_action();
  -- three messages to u1 -> three single e-mails
  FOR n IN 1 .. 3 LOOP PERFORM pg_temp.note(i.adm, i.u1, 'admin_message'); PERFORM pg_temp.next_action(); END LOOP;
  r := ame_claim(50);
  IF (SELECT reason FROM admin_message_emails WHERE recipient = i.u4 ORDER BY created_at DESC LIMIT 1) <> 'email_not_confirmed' THEN RAISE EXCEPTION '7 unconfirmed'; END IF;
  IF (pg_temp.row_of(a)).reason <> 'paused' OR (pg_temp.row_of(b)).status <> 'sending' THEN RAISE EXCEPTION '7 pause rules'; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(r) e WHERE (e ->> 'recipient')::uuid = i.u1 AND NOT (e ->> 'digest')::boolean) <> 3 THEN RAISE EXCEPTION '7 singles'; END IF;
  FOR k IN SELECT e ->> 'mail_key' FROM jsonb_array_elements(r) e LOOP PERFORM ame_finish(k, 'sent'); END LOOP;
  -- four more (allowance 2 left) -> one digest
  FOR n IN 1 .. 4 LOOP PERFORM pg_temp.note(i.adm, i.u1, 'admin_message'); PERFORM pg_temp.next_action(); END LOOP;
  r := ame_claim(50);
  IF jsonb_array_length(r) <> 1 OR NOT (r -> 0 ->> 'digest')::boolean OR jsonb_array_length(r -> 0 -> 'items') <> 4 THEN RAISE EXCEPTION '7 digest'; END IF;
  PERFORM ame_finish(r -> 0 ->> 'mail_key', 'sent');
  -- one more fits (4 e-mails this hour), the next is held for the next hour
  PERFORM pg_temp.note(i.adm, i.u1, 'admin_message'); PERFORM pg_temp.next_action();
  r := ame_claim(50); PERFORM ame_finish(r -> 0 ->> 'mail_key', 'sent');
  a := pg_temp.note(i.adm, i.u1, 'admin_message'); PERFORM pg_temp.next_action();
  r := ame_claim(50);
  IF jsonb_array_length(r) <> 0 OR (pg_temp.row_of(a)).send_after <= now() + interval '50 minutes' THEN RAISE EXCEPTION '7 hourly limit'; END IF;
  -- a suppressed address reported by the e-mail service is skipped with that reason
  UPDATE admin_message_emails SET send_after = now() WHERE id = (pg_temp.row_of(a)).id;
  UPDATE admin_message_emails SET claimed_at = claimed_at - interval '2 hours' WHERE recipient = i.u1 AND status = 'sent';
  r := ame_claim(50);
  PERFORM ame_finish(r -> 0 ->> 'mail_key', 'skipped', 'recipient_suppressed');
  IF (pg_temp.row_of(a)).reason <> 'recipient_suppressed' THEN RAISE EXCEPTION '7 suppressed'; END IF;
  RAISE NOTICE 'PASS 7 claim rules (unconfirmed, pause, important, rate limit, digest, suppressed)';
END $$;

-- 8. Switch off and daily cap.
DO $$ DECLARE i _ids; a uuid; r jsonb; BEGIN
  SELECT * INTO i FROM _ids;
  INSERT INTO platform_settings (key, value) VALUES ('admin_messages_email_enabled', 'false'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  a := pg_temp.note(i.adm, i.u2, 'approval'); PERFORM pg_temp.next_action();
  r := ame_claim(50);
  IF (pg_temp.row_of(a)).reason <> 'switched_off' THEN RAISE EXCEPTION '8 switch'; END IF;
  UPDATE platform_settings SET value = 'true'::jsonb WHERE key = 'admin_messages_email_enabled';
  INSERT INTO platform_settings (key, value) VALUES ('admin_messages_email_daily_cap', '1'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  a := pg_temp.note(i.adm, i.u2, 'approval'); PERFORM pg_temp.next_action();
  r := ame_claim(50);
  IF (pg_temp.row_of(a)).reason <> 'daily_cap_reached' THEN RAISE EXCEPTION '8 cap'; END IF;
  RAISE NOTICE 'PASS 8 switch and daily cap';
END $$;

-- 9. Browsers cannot read or write the log; only administrators read it through the RPC.
DO $$ DECLARE i _ids; ok boolean := false; BEGIN
  SELECT * INTO i FROM _ids;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', i.u1, 'role', 'authenticated')::text, true);
  BEGIN PERFORM admin_message_email_log(NULL, 10); EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '9 non-admin read log'; END IF;
  IF has_table_privilege('authenticated', 'public.admin_message_emails', 'SELECT')
     OR has_table_privilege('authenticated', 'public.admin_message_emails', 'INSERT')
     OR has_function_privilege('authenticated', 'public.ame_claim(integer)', 'EXECUTE') THEN RAISE EXCEPTION '9 grants'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', i.adm, 'role', 'authenticated')::text, true);
  IF jsonb_array_length(admin_message_email_log(i.u1, 50)) < 1 THEN RAISE EXCEPTION '9 admin log'; END IF;
  RAISE NOTICE 'PASS 9 access';
END $$;

-- 10. Organised messages: category, related item only from the recipient's own items, test send only to the admin.
DO $$ DECLARE i _ids; r jsonb; ok boolean := false; t1 uuid := gen_random_uuid(); t2 uuid := gen_random_uuid(); m jsonb; BEGIN
  SELECT * INTO i FROM _ids;
  IF ame_category('payment', NULL) <> 'decision' OR ame_category('admin_message', '{"category":"action"}') <> 'action'
     OR ame_category('profile_reminder', NULL) <> 'reminder' OR ame_category('admin_message', NULL) <> 'notice' THEN RAISE EXCEPTION '10 category'; END IF;
  INSERT INTO tickets (id, client_id, title, status) VALUES (t1, i.u1, 'SAP FI posting error', 'in_progress'), (t2, i.u2, 'Other client ticket', 'new');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', i.adm, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM admin_message_send(i.u1, jsonb_build_object('category', 'decision', 'subject', 'Hi', 'body', 'x', 'context', jsonb_build_object('kind', 'ticket', 'ref', t2)));
  EXCEPTION WHEN insufficient_privilege THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION '10 foreign ticket shown'; END IF;
  r := admin_message_send(i.u1, jsonb_build_object('category', 'action', 'subject', 'Please confirm', 'summary', 'One step left',
    'body', E'Hello\n- one\n- two', 'link', '/client/tickets', 'action_label', 'Confirm the resolution', 'deadline', to_char(current_date + 3, 'YYYY-MM-DD'),
    'context', jsonb_build_object('kind', 'ticket', 'ref', t1)));
  SELECT meta INTO m FROM notifications WHERE id = (r ->> 'id')::uuid;
  IF m ->> 'category' <> 'action' OR m #>> '{context,label}' <> 'SAP FI posting error' OR m #>> '{context,status}' <> 'in progress' THEN RAISE EXCEPTION '10 meta %', m; END IF;
  IF (r #>> '{email,status}') <> 'queued' THEN RAISE EXCEPTION '10 not queued'; END IF;
  PERFORM pg_temp.next_action();
  r := admin_message_send(i.u2, jsonb_build_object('category', 'notice', 'subject', 'Minor', 'body', 'ok', 'email', false));
  IF (r #>> '{email,reason}') <> 'admin_unticked_email' THEN RAISE EXCEPTION '10 untick via compose'; END IF;
  PERFORM pg_temp.next_action();
  r := admin_message_send(i.u2, jsonb_build_object('category', 'notice', 'subject', 'Test', 'body', 'ok', 'test', true));
  IF (SELECT user_id FROM notifications WHERE id = (r ->> 'id')::uuid) <> i.adm
     OR NOT (SELECT is_test FROM admin_message_emails WHERE notification_id = (r ->> 'id')::uuid) THEN RAISE EXCEPTION '10 test send'; END IF;
  IF jsonb_array_length(admin_message_history(jsonb_build_object('category', 'action', 'q', 'confirm'))) <> 1 THEN RAISE EXCEPTION '10 history filter'; END IF;
  RAISE NOTICE 'PASS 10 organised messages, own items only, test send, history';
END $$;

ROLLBACK;
