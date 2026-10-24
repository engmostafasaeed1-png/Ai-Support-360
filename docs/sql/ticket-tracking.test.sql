-- Adversarial tests for ticket-tracking.sql. ONE rolled-back transaction: run on a scratch copy (nothing is kept).
-- Each check raises on failure. TT01-TT26.
BEGIN;

-- Fixtures. Client C owns ticket T (legacy, consultant K assigned, NDA signed by both, rate approved);
-- bidder B only has a pending bid; observer V has an active observer assignment; admin A; outsider O.
--   A 00..a1   C 00..c1   K user 00..d1 / consultant 00..dc01   B user 00..b1 / consultant 00..bc01
--   V user 00..e1 / consultant 00..ec01   O 00..f9   T 00..aaa1   closed ticket T2 00..aaa2
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'), ('00000000-0000-0000-0000-0000000000c1', 'c@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'k@example.test'), ('00000000-0000-0000-0000-0000000000b1', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000e1', 'v@example.test'), ('00000000-0000-0000-0000-0000000000f9', 'o@example.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000000a1', 'admin');
INSERT INTO public.consultants (id, user_id) VALUES
  ('00000000-0000-0000-0000-00000000dc01', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-00000000bc01', '00000000-0000-0000-0000-0000000000b1'),
  ('00000000-0000-0000-0000-00000000ec01', '00000000-0000-0000-0000-0000000000e1');
INSERT INTO public.tickets (id, client_id, consultant_id, title, description, sap_module, status) VALUES
  ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000dc01',
   'MIRO invoices blocked', 'Invoices for vendor group 2 stop with a tolerance error since the upgrade.', 'MM', 'in_progress'),
  ('00000000-0000-0000-0000-00000000aaa2', '00000000-0000-0000-0000-0000000000c1', NULL, 'Old closed request', 'short', 'FI', 'closed');
INSERT INTO public.proposals (ticket_id, consultant_id, cover_letter, proposed_rate, status)
  VALUES ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000bc01', 'I can help', 50, 'pending');
INSERT INTO public.ticket_assignments (ticket_id, consultant_id, role, status)
  VALUES ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000ec01', 'observer', 'active');
INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, nda_content, signed_at, client_signed_at)
  VALUES ('00000000-0000-0000-0000-00000000dc01', '00000000-0000-0000-0000-0000000000c1', 'sig', 'nda', now() - interval '2 days', now() - interval '1 day');
INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status, decided_at, decided_by)
  VALUES ('00000000-0000-0000-0000-00000000aaa1', '00000000-0000-0000-0000-00000000dc01', 60, 'USD', 'approved', now() - interval '3 days', '00000000-0000-0000-0000-0000000000c1');
DELETE FROM public.platform_settings WHERE key = 'ticket_tracking';

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', COALESCE(_u::text, ''), true);
$$;
-- Runs a statement as the given user (role authenticated) and returns the SQLSTATE it raised ('' = no error).
CREATE OR REPLACE FUNCTION pg_temp.try(_u uuid, _sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_u);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  RETURN '';
END $$;
CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(_ok, false) THEN RAISE EXCEPTION 'FAILED %', _name; END IF; RAISE NOTICE 'ok %', _name; END $$;

DO $$
DECLARE
  C uuid := '00000000-0000-0000-0000-0000000000c1'; K uuid := '00000000-0000-0000-0000-0000000000d1';
  B uuid := '00000000-0000-0000-0000-0000000000b1'; V uuid := '00000000-0000-0000-0000-0000000000e1';
  A uuid := '00000000-0000-0000-0000-0000000000a1'; O uuid := '00000000-0000-0000-0000-0000000000f9';
  T uuid := '00000000-0000-0000-0000-00000000aaa1'; T2 uuid := '00000000-0000-0000-0000-00000000aaa2';
  r jsonb; n int; s text; f jsonb;
BEGIN
  -- TT01 default OFF: participants see nothing, writes refused
  PERFORM pg_temp.as_user(C);
  r := public.tt_ticket_tracking(T);
  PERFORM pg_temp.check((r ->> 'enabled')::boolean = false AND r -> 'facts' IS NULL, 'TT01 off by default, no facts for the client');
  s := pg_temp.try(C, format('SELECT public.tt_set_working_status(%L, %L, NULL)', T, 'in_testing'));
  PERFORM pg_temp.check(s = '55000', 'TT01b set refused while off');

  -- TT02 settings validation (admin only)
  s := pg_temp.try(C, $q$SELECT public.tt_admin_set_settings('{"enabled": true}'::jsonb)$q$);
  PERFORM pg_temp.check(s = '42501', 'TT02 a client can not change the settings');
  s := pg_temp.try(A, format('SELECT public.tt_admin_set_settings(%L::jsonb)', jsonb_build_object('statuses', (public.tt_default_settings() -> 'statuses') - 10)));
  PERFORM pg_temp.check(s = '22023', 'TT02b required status "completed" can not be removed');
  s := pg_temp.try(A, format('SELECT public.tt_admin_set_settings(%L::jsonb)', jsonb_build_object('statuses', jsonb_set(public.tt_default_settings() -> 'statuses', '{1,color}', '"#ff0000"'))));
  PERFORM pg_temp.check(s = '22023', 'TT02c only design colours are accepted');
  s := pg_temp.try(A, $q$SELECT public.tt_admin_set_settings('{"rate_limit_per_hour": 0}'::jsonb)$q$);
  PERFORM pg_temp.check(s = '22023', 'TT02d numbers are range-checked');
  s := pg_temp.try(A, $q$SELECT public.tt_admin_set_settings('{"enabled": true}'::jsonb, 'owner go-ahead')$q$);
  PERFORM pg_temp.check(s = '', 'TT02e admin switches the feature on');
  SELECT count(*) INTO n FROM public.audit_logs WHERE action = 'ticket_tracking.settings_changed' AND user_id = A;
  PERFORM pg_temp.check(n = 1, 'TT02f settings change audited');

  -- TT03 roles on THAT ticket
  PERFORM pg_temp.check(public.tt_viewer_role(T, C) = 'client' AND public.tt_viewer_role(T, K) = 'consultant'
    AND public.tt_viewer_role(T, V) = 'observer' AND public.tt_viewer_role(T, B) IS NULL AND public.tt_viewer_role(T, O) IS NULL
    AND public.tt_viewer_role(T, A) = 'admin', 'TT03 viewer roles (client, consultant, observer, bidder none, outsider none, admin)');

  -- TT04 outsider and bidder: no facts, no timeline, no rows, no writes
  PERFORM pg_temp.as_user(O);
  PERFORM pg_temp.check(public.tt_ticket_tracking(T) ->> 'role' IS NULL AND public.tt_ticket_tracking(T) -> 'facts' IS NULL, 'TT04 outsider gets no tracking');
  SELECT count(*) INTO n FROM public.tt_timeline(T);
  PERFORM pg_temp.check(n = 0, 'TT04b outsider timeline empty');
  s := pg_temp.try(O, format('SELECT public.tt_set_working_status(%L, %L, NULL)', T, 'in_testing'));
  PERFORM pg_temp.check(s = '42501', 'TT04c outsider can not set');
  s := pg_temp.try(B, format('SELECT public.tt_set_working_status(%L, %L, NULL)', T, 'in_testing'));
  PERFORM pg_temp.check(s = '42501', 'TT05 bidder can not set');
  PERFORM pg_temp.as_user(B);
  SELECT count(*) INTO n FROM public.tt_timeline(T);
  PERFORM pg_temp.check(n = 0, 'TT05b bidder timeline empty');
  SELECT count(*) INTO n FROM public.tt_list_facts(ARRAY[T]);
  PERFORM pg_temp.check(n = 0, 'TT05c bidder gets no list facts');

  -- TT06 direct table access: RLS read, no write grants
  s := pg_temp.try(C, format('INSERT INTO public.ticket_working_status (ticket_id, status_key) VALUES (%L, %L) ON CONFLICT DO NOTHING', T, 'completed'));
  PERFORM pg_temp.check(s = '42501', 'TT06 browser can not write the table');
  s := pg_temp.try(K, format('UPDATE public.ticket_working_status SET status_key = %L WHERE ticket_id = %L', 'completed', T));
  PERFORM pg_temp.check(s = '42501', 'TT06b browser can not update the table');
  s := pg_temp.try(C, 'SELECT * FROM public.ticket_tracking_email_queue');
  PERFORM pg_temp.check(s = '42501', 'TT06c e-mail queue is service-only');
  s := pg_temp.try(C, 'SELECT public.tt_claim_emails(10)');
  PERFORM pg_temp.check(s = '42501', 'TT06d claim RPC is service-only');
  s := pg_temp.try(C, 'SELECT public.tt_reminder_sweep()');
  PERFORM pg_temp.check(s = '42501', 'TT06e reminder sweep is not callable from the browser');
  s := pg_temp.try(C, format('SELECT public.tt_facts(%L)', T));
  PERFORM pg_temp.check(s = '42501', 'TT06f internal facts function is not callable');

  -- TT07 observer reads but can not set
  s := pg_temp.try(V, format('SELECT public.tt_set_working_status(%L, %L, NULL)', T, 'in_testing'));
  PERFORM pg_temp.check(s = '42501', 'TT07 observer can not set');
  PERFORM pg_temp.as_user(V);
  PERFORM pg_temp.check(public.tt_ticket_tracking(T) ->> 'role' = 'observer' AND jsonb_array_length(public.tt_ticket_tracking(T) -> 'allowed') = 0, 'TT07b observer reads, nothing allowed');

  -- TT08 permission matrix
  s := pg_temp.try(K, format('SELECT public.tt_set_working_status(%L, %L, %L)', T, 'needs_rework', 'please redo'));
  PERFORM pg_temp.check(s = '42501', 'TT08 consultant can not set the client-only "Needs rework"');
  s := pg_temp.try(C, format('SELECT public.tt_set_working_status(%L, %L, NULL)', T, 'ready_for_review'));
  PERFORM pg_temp.check(s = '42501', 'TT08b client can not set the consultant-only "Ready for client review"');
  s := pg_temp.try(K, format('SELECT public.tt_set_working_status(%L, %L, NULL)', T, 'no_such_status'));
  PERFORM pg_temp.check(s = '22023', 'TT08c unknown status refused');

  -- TT09 notes: mandatory, contact filter (M60), length
  s := pg_temp.try(K, format('SELECT public.tt_set_working_status(%L, %L, NULL)', T, 'waiting_client_info'));
  PERFORM pg_temp.check(s = '22023', 'TT09 note mandatory for "Waiting for client information"');
  s := pg_temp.try(K, format('SELECT public.tt_set_working_status(%L, %L, %L)', T, 'waiting_client_info', 'mail me at kim@example.com'));
  PERFORM pg_temp.check(s = '22023', 'TT09b e-mail address in the note refused');
  s := pg_temp.try(K, format('SELECT public.tt_set_working_status(%L, %L, %L)', T, 'waiting_client_info', 'call +20 100 123 4567'));
  PERFORM pg_temp.check(s = '22023', 'TT09c phone number in the note refused');
  s := pg_temp.try(K, format('SELECT public.tt_set_working_status(%L, %L, %L)', T, 'waiting_client_info', repeat('x', 1001)));
  PERFORM pg_temp.check(s = '22023', 'TT09d note longer than the limit refused');
  s := pg_temp.try(K, format('SELECT public.tt_set_working_status(%L, %L, %L, %L::date)', T, 'in_analysis', 'x', (current_date - 1)::text));
  PERFORM pg_temp.check(s = '22023', 'TT09e expected date in the past refused');

  -- TT10 a real change: version, history, in-app notice + one e-mail to the client, nothing to the actor
  s := pg_temp.try(K, format('SELECT public.tt_set_working_status(%L, %L, %L, NULL, %L, 1)', T, 'waiting_client_info', 'Please send the tolerance key screenshot', 'client'));
  PERFORM pg_temp.check(s = '', 'TT10 consultant sets "Waiting for client information" with a note');
  PERFORM pg_temp.check((SELECT version = 2 AND status_key = 'waiting_client_info' AND set_by_role = 'consultant' FROM public.ticket_working_status WHERE ticket_id = T), 'TT10b version 2 stored');
  SELECT count(*) INTO n FROM public.ticket_working_status_events WHERE ticket_id = T AND NOT backfill;
  PERFORM pg_temp.check(n = 1, 'TT10c one history row');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = C AND type = 'ticket_tracking';
  PERFORM pg_temp.check(n = 1, 'TT10d client notified in-app');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = K AND type = 'ticket_tracking';
  PERFORM pg_temp.check(n = 0, 'TT10e the actor is not notified');
  SELECT count(*) INTO n FROM public.notifications WHERE user_id IN (V, B) AND type = 'ticket_tracking';
  PERFORM pg_temp.check(n = 0, 'TT10f observer and bidder are not notified');
  SELECT count(*) INTO n FROM public.ticket_tracking_email_queue WHERE user_id = C AND kind = 'status';
  PERFORM pg_temp.check(n = 1, 'TT10g one e-mail queued for the client');
  SELECT count(*) INTO n FROM net.calls WHERE url LIKE '%ticket-tracking-run';
  PERFORM pg_temp.check(n >= 1 OR to_regprocedure('public.job_invoke_headers()') IS NULL, 'TT10h e-mail worker woken');

  -- TT11 idempotent + optimistic concurrency
  PERFORM pg_temp.as_user(K);
  r := public.tt_set_working_status(T, 'waiting_client_info', 'Please send the tolerance key screenshot', NULL, 'client', 2);
  PERFORM pg_temp.check((r ->> 'changed')::boolean = false AND (r ->> 'version')::int = 2, 'TT11 same change twice is a no-op');
  s := pg_temp.try(C, format('SELECT public.tt_set_working_status(%L, %L, NULL, NULL, NULL, 1)', T, 'in_testing'));
  PERFORM pg_temp.check(s = '40001', 'TT11b stale version refused (someone else changed it)');

  -- TT12 throttle: rapid changes keep ONE unread notice and ONE e-mail
  PERFORM pg_temp.as_user(K);
  PERFORM public.tt_set_working_status(T, 'in_analysis', NULL, NULL, NULL, 2);
  PERFORM public.tt_set_working_status(T, 'in_development', NULL, NULL, NULL, 3);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = C AND type = 'ticket_tracking';
  PERFORM pg_temp.check(n = 1, 'TT12 rapid changes update the one unread notice');
  PERFORM pg_temp.check((SELECT body LIKE '%In development%' FROM public.notifications WHERE user_id = C AND type = 'ticket_tracking'), 'TT12b the notice shows the latest status');
  SELECT count(*) INTO n FROM public.ticket_tracking_email_queue WHERE user_id = C;
  PERFORM pg_temp.check(n = 1, 'TT12c only one e-mail within the window');

  -- TT13 "Completed (from my side)" by the consultant never closes the ticket, asks the client to confirm
  PERFORM public.tt_set_working_status(T, 'completed', NULL, NULL, NULL, 4);
  PERFORM pg_temp.check((SELECT status::text = 'in_progress' FROM public.tickets WHERE id = T), 'TT13 official status unchanged');
  PERFORM pg_temp.check((SELECT title = 'Please confirm the resolution' FROM public.notifications WHERE user_id = C AND type = 'ticket_tracking'), 'TT13b client asked to confirm');

  -- TT14 client answers; consultants on the ticket are told
  PERFORM pg_temp.as_user(C);
  PERFORM public.tt_set_working_status(T, 'needs_rework', 'The tolerance still blocks vendor 4711', NULL, 'consultant', 5);
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = K AND type = 'ticket_tracking';
  PERFORM pg_temp.check(n = 1, 'TT14 consultant notified of "Needs rework"');

  -- TT15 admin change is audited
  PERFORM pg_temp.as_user(A);
  PERFORM public.tt_set_working_status(T, 'on_hold', 'Waiting for the year-end freeze', NULL, NULL, 6);
  SELECT count(*) INTO n FROM public.audit_logs WHERE action = 'ticket_working_status.admin_set' AND entity_id = T;
  PERFORM pg_temp.check(n = 1, 'TT15 admin change audited');

  -- TT16 rate limit per user
  PERFORM public.tt_admin_set_settings('{"rate_limit_per_hour": 1}'::jsonb, 'test');
  s := pg_temp.try(K, format('SELECT public.tt_set_working_status(%L, %L, NULL, NULL, NULL, 7)', T, 'in_testing'));
  PERFORM pg_temp.check(s = '54000', 'TT16 rate limit per user');
  PERFORM public.tt_admin_set_settings('{"rate_limit_per_hour": 30}'::jsonb, 'test');

  -- TT17 closed tickets are read-only for participants
  s := pg_temp.try(C, format('SELECT public.tt_set_working_status(%L, %L, NULL)', T2, 'in_testing'));
  PERFORM pg_temp.check(s = '55000', 'TT17 closed ticket can not be changed by the client');

  -- TT18 reminders: due tomorrow -> one reminder to the responsible side, max one per day
  UPDATE public.ticket_working_status SET status_key = 'in_testing', set_by_role = 'consultant', expected_date = current_date + 1,
         responsible = 'client', last_reminder_on = NULL WHERE ticket_id = T;
  DELETE FROM public.notifications WHERE type = 'ticket_tracking';
  n := public.tt_reminder_sweep();
  PERFORM pg_temp.check(n = 1, 'TT18 one reminder sent');
  PERFORM pg_temp.check((SELECT count(*) = 1 FROM public.notifications WHERE user_id = C AND type = 'ticket_tracking')
                    AND (SELECT count(*) = 0 FROM public.notifications WHERE user_id = K AND type = 'ticket_tracking'), 'TT18b only the responsible side (client) reminded');
  n := public.tt_reminder_sweep();
  PERFORM pg_temp.check(n = 0, 'TT18c no second reminder the same day');

  -- TT19 overdue reminders are capped; changing the status resets / stops them
  UPDATE public.ticket_working_status SET expected_date = current_date - 2, last_reminder_on = NULL, overdue_reminders = 3 WHERE ticket_id = T;
  n := public.tt_reminder_sweep();
  PERFORM pg_temp.check(n = 0, 'TT19 overdue reminders stop at the cap');
  PERFORM pg_temp.as_user(K);
  PERFORM public.tt_set_working_status(T, 'in_development', NULL, NULL, NULL, (SELECT version FROM public.ticket_working_status WHERE ticket_id = T));
  PERFORM pg_temp.check((SELECT expected_date IS NULL AND overdue_reminders = 0 FROM public.ticket_working_status WHERE ticket_id = T), 'TT19b a new status clears the date and counters');

  -- TT20 backfilled ("system") rows never remind
  UPDATE public.ticket_working_status SET set_by_role = 'system', expected_date = current_date + 1, last_reminder_on = NULL WHERE ticket_id = T;
  n := public.tt_reminder_sweep();
  PERFORM pg_temp.check(n = 0, 'TT20 no reminders for backfilled rows');

  -- TT21 review reminder after N days in "Ready for client review"
  UPDATE public.ticket_working_status SET status_key = 'ready_for_review', set_by_role = 'consultant', expected_date = NULL,
         set_at = now() - interval '4 days', review_reminders = 0, review_reminded_on = NULL, last_reminder_on = NULL WHERE ticket_id = T;
  n := public.tt_reminder_sweep();
  PERFORM pg_temp.check(n = 1 AND (SELECT review_reminders = 1 FROM public.ticket_working_status WHERE ticket_id = T), 'TT21 review reminder to the client');

  -- TT22 facts of the legacy ticket (rate approved, NDA by both, no confirmation step)
  PERFORM pg_temp.as_user(C);
  f := public.tt_ticket_tracking(T) -> 'facts';
  PERFORM pg_temp.check((f ->> 'nda_state') = 'signed' AND f ->> 'rate_at' IS NOT NULL AND (f ->> 'has_consultant')::boolean
    AND NOT (f ->> 'gated')::boolean AND (f ->> 'details_ok')::boolean AND f ->> 'bids_at' IS NOT NULL, 'TT22 facts derived from existing tables');

  -- TT23 timeline: the client sees the bid, the assigned consultant does not see a competitor's bid
  SELECT count(*) INTO n FROM public.tt_timeline(T) x WHERE x.kind = 'bid_received';
  PERFORM pg_temp.check(n = 1, 'TT23 client sees the bid in the timeline');
  PERFORM pg_temp.as_user(K);
  SELECT count(*) INTO n FROM public.tt_timeline(T) x WHERE x.kind = 'bid_received';
  PERFORM pg_temp.check(n = 0, 'TT23b consultant does not see another consultant''s bid');
  SELECT count(*) INTO n FROM public.tt_timeline(T) x WHERE x.source = 'manual';
  PERFORM pg_temp.check(n >= 5, 'TT23c manual changes are in the timeline');

  -- TT24 RLS read for participants only
  s := pg_temp.try(O, format('DO $x$ BEGIN IF (SELECT count(*) FROM public.ticket_working_status WHERE ticket_id = %L) <> 0 THEN RAISE EXCEPTION %L USING ERRCODE = %L; END IF; END $x$', T, 'leak', 'P0001'));
  PERFORM pg_temp.check(s = '', 'TT24 outsider reads no working status row');
  s := pg_temp.try(C, format('DO $x$ BEGIN IF (SELECT count(*) FROM public.ticket_working_status WHERE ticket_id = %L) <> 1 THEN RAISE EXCEPTION %L USING ERRCODE = %L; END IF; END $x$', T, 'missing', 'P0001'));
  PERFORM pg_temp.check(s = '', 'TT24b client reads the row');

  -- TT25 new tickets get "Not started" (system) without notifications
  INSERT INTO public.tickets (id, client_id, title, description, sap_module, status)
    VALUES ('00000000-0000-0000-0000-00000000aaa3', C, 'New one', 'A new request about posting periods in FI.', 'FI', 'new');
  PERFORM pg_temp.check((SELECT status_key = 'not_started' AND set_by_role = 'system' FROM public.ticket_working_status WHERE ticket_id = '00000000-0000-0000-0000-00000000aaa3'), 'TT25 new ticket starts "Not started"');

  -- TT26 switching off hides tracking again for participants (admins still see it)
  PERFORM pg_temp.as_user(A);
  PERFORM public.tt_admin_set_settings('{"enabled": false}'::jsonb, 'test');
  PERFORM pg_temp.as_user(C);
  PERFORM pg_temp.check(public.tt_ticket_tracking(T) -> 'facts' IS NULL, 'TT26 off again: client sees nothing');
  PERFORM pg_temp.as_user(A);
  PERFORM pg_temp.check(public.tt_ticket_tracking(T) -> 'facts' IS NOT NULL, 'TT26b admin still sees it');
END $$;

ROLLBACK;
