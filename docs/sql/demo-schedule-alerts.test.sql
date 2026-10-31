-- Checks for docs/sql/demo-schedule-alerts.sql. Run after applying it, inside a transaction that is rolled back:
--   BEGIN; \i docs/sql/demo-schedule-alerts.test.sql  ROLLBACK;
-- Each block raises an exception on failure and prints PASS n on success.

DO $$
DECLARE a uuid := gen_random_uuid(); r public.demo_requests; n int;
BEGIN
  -- fixtures: one admin
  INSERT INTO public.user_roles (user_id, role) VALUES (a, 'admin');
  PERFORM set_config('test.admin', a::text, true);

  -- 1. deadline = 1 business hour on Sun–Thu 08:00–18:00 Riyadh: Thursday 17:30 Riyadh -> Sunday 08:30 Riyadh
  IF public.dsa_respond_by('2026-11-05 14:30:00+00') <> '2026-11-08 05:30:00+00' THEN
    RAISE EXCEPTION 'FAIL 1 respond_by %', public.dsa_respond_by('2026-11-05 14:30:00+00'); END IF;
  INSERT INTO public.demo_requests (demo_type, scheduling_preference, full_name, email, company, scheduled_date, scheduled_slot, timezone, source, created_at)
  VALUES ('live', 'this-week', 'Jane Doe', 'jane@acme.test', 'Acme', current_date + 3, '10:00', 'Europe/London', 'landing-wizard', now())
  RETURNING * INTO r;
  IF r.respond_by IS NULL OR r.respond_by <= r.created_at THEN RAISE EXCEPTION 'FAIL 1 deadline not set'; END IF;
  RAISE NOTICE 'PASS 1 respond-by deadline (1 business hour, weekend skipped)';

  -- 2. bell for every admin with the alert title, the preferred slot and the deadline
  SELECT count(*) INTO n FROM public.notifications
   WHERE user_id = a AND title = 'Demo booked: schedule needed' AND body LIKE '%Preferred: %10:00 (Europe/London)%' AND body LIKE '%Confirm a time by %within 1 business hour.%'
     AND link = '/admin/demo-requests?request=' || r.id::text;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 2 bell %', n; END IF;
  RAISE NOTICE 'PASS 2 bell text';

  -- 3. optional details once, only right after the booking, validated
  IF NOT public.submit_demo_request_details(r.request_token, 'SAP FI lead', '+44 20 7946 0000', 'FI-AA', 'ar') THEN RAISE EXCEPTION 'FAIL 3 details'; END IF;
  IF public.submit_demo_request_details(r.request_token, 'x', NULL, NULL, 'en') THEN RAISE EXCEPTION 'FAIL 3 second write accepted'; END IF;
  BEGIN
    PERFORM public.submit_demo_request_details(r.request_token, NULL, 'call me <script>', NULL, NULL);
    RAISE EXCEPTION 'FAIL 3 bad phone accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  RAISE NOTICE 'PASS 3 details once + phone validation';

  -- 4. one alert per request; the second claim says already_sent
  IF NOT (public.dsa_alert_claim(r.id) ->> 'send')::boolean THEN RAISE EXCEPTION 'FAIL 4 first claim'; END IF;
  IF (public.dsa_alert_claim(r.id) ->> 'reason') <> 'already_sent' THEN RAISE EXCEPTION 'FAIL 4 second claim'; END IF;
  RAISE NOTICE 'PASS 4 one alert per request';

  -- 5. duplicate flagged, third booking from the same e-mail in 24 h is not alerted (flood)
  INSERT INTO public.demo_requests (demo_type, scheduling_preference, full_name, email, source) VALUES ('live', 'asap', 'Jane Doe', 'JANE@acme.test', 'landing-wizard') RETURNING * INTO r;
  IF (public.dsa_alert_claim(r.id) ->> 'duplicate_of') IS NULL THEN RAISE EXCEPTION 'FAIL 5 duplicate not flagged'; END IF;
  INSERT INTO public.demo_requests (demo_type, scheduling_preference, full_name, email, source) VALUES ('live', 'asap', 'Jane Doe', 'jane@acme.test', 'landing-wizard') RETURNING * INTO r;
  IF (public.dsa_alert_claim(r.id) ->> 'reason') <> 'flood' THEN RAISE EXCEPTION 'FAIL 5 flood not stopped'; END IF;
  RAISE NOTICE 'PASS 5 duplicate flag + flood guard';
END $$;

-- 6. reminders: once at the deadline, then daily, at most 2 more; stop when scheduled
DO $$
DECLARE r public.demo_requests; j jsonb; k int := 0;
BEGIN
  INSERT INTO public.demo_requests (demo_type, scheduling_preference, full_name, email, source) VALUES ('ai-triage', 'asap', 'Omar', 'omar@x.test', 'landing-wizard') RETURNING * INTO r;
  UPDATE public.demo_requests SET respond_by = now() - interval '1 minute' WHERE id = r.id;
  j := public.dsa_reminder_claim(50);
  IF NOT j @> jsonb_build_array(jsonb_build_object('id', r.id, 'n', 1)) THEN RAISE EXCEPTION 'FAIL 6 first reminder %', j; END IF;
  IF public.dsa_reminder_claim(50) @> jsonb_build_array(jsonb_build_object('id', r.id)) THEN RAISE EXCEPTION 'FAIL 6 same-day repeat'; END IF;
  FOR i IN 1..4 LOOP
    UPDATE public.demo_requests SET last_reminder_at = now() - interval '25 hours' WHERE id = r.id;
    IF public.dsa_reminder_claim(50) @> jsonb_build_array(jsonb_build_object('id', r.id)) THEN k := k + 1; END IF;
  END LOOP;
  IF k <> 2 THEN RAISE EXCEPTION 'FAIL 6 daily reminders %', k; END IF;
  -- a scheduled demo never gets one
  INSERT INTO public.demo_requests (demo_type, scheduling_preference, full_name, email, source) VALUES ('live', 'asap', 'Lina', 'lina@x.test', 'landing-wizard') RETURNING * INTO r;
  UPDATE public.demo_requests SET respond_by = now() - interval '1 minute', status = 'scheduled', meeting_at = now() + interval '1 day' WHERE id = r.id;
  IF public.dsa_reminder_claim(50) @> jsonb_build_array(jsonb_build_object('id', r.id)) THEN RAISE EXCEPTION 'FAIL 6 scheduled reminded'; END IF;
  RAISE NOTICE 'PASS 6 reminders once + 2 daily, stop when scheduled';
END $$;

-- 7. admin schedule / reschedule / cancel: admin only, validated, versioned, audited; the requester page reads it
DO $$
DECLARE r public.demo_requests; j jsonb; m record;
BEGIN
  INSERT INTO public.demo_requests (demo_type, scheduling_preference, full_name, email, timezone, source) VALUES ('live', 'asap', 'Sara', 'sara@x.test', 'Asia/Dubai', 'landing-wizard') RETURNING * INTO r;
  PERFORM set_config('test.uid', gen_random_uuid()::text, true);
  BEGIN PERFORM public.admin_demo_schedule(r.id, current_date + 2, '10:00', 'Asia/Dubai', 30, NULL, NULL); RAISE EXCEPTION 'FAIL 7 non-admin';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
  PERFORM set_config('test.uid', current_setting('test.admin'), true);
  BEGIN PERFORM public.admin_demo_schedule(r.id, current_date + 2, '10:00', 'Asia/Dubai', 30, 'http://evil.test/x', NULL); RAISE EXCEPTION 'FAIL 7 http link';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.admin_demo_schedule(r.id, current_date - 1, '10:00', 'Asia/Dubai', 30, NULL, NULL); RAISE EXCEPTION 'FAIL 7 past';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  j := public.admin_demo_schedule(r.id, current_date + 2, '10:00', 'Asia/Dubai', 45, 'https://meet.example.com/abc', 'See you');
  IF j ->> 'kind' <> 'confirmed' OR (j ->> 'version')::int <> 1 THEN RAISE EXCEPTION 'FAIL 7 confirm %', j; END IF;
  IF (SELECT meeting_at FROM public.demo_requests WHERE id = r.id) <> ((current_date + 2) + time '10:00') AT TIME ZONE 'Asia/Dubai' THEN RAISE EXCEPTION 'FAIL 7 time zone'; END IF;
  j := public.admin_demo_schedule(r.id, current_date + 3, '11:00', 'Asia/Dubai', 45, 'https://meet.example.com/abc', NULL);
  IF j ->> 'kind' <> 'rescheduled' OR (j ->> 'version')::int <> 2 THEN RAISE EXCEPTION 'FAIL 7 reschedule %', j; END IF;
  SELECT * INTO m FROM public.get_demo_meeting_by_token(r.request_token);
  IF m.status <> 'scheduled' OR m.meeting_link <> 'https://meet.example.com/abc' OR m.meeting_duration_min <> 45 THEN RAISE EXCEPTION 'FAIL 7 page read'; END IF;
  j := public.admin_demo_cancel(r.id, 'Speaker ill');
  IF j ->> 'kind' <> 'cancelled' OR NOT (j ->> 'had_meeting')::boolean THEN RAISE EXCEPTION 'FAIL 7 cancel %', j; END IF;
  SELECT * INTO m FROM public.get_demo_meeting_by_token(r.request_token);
  IF m.meeting_link IS NOT NULL OR m.cancel_reason <> 'Speaker ill' THEN RAISE EXCEPTION 'FAIL 7 cancelled page shows link'; END IF;
  IF (SELECT count(*) FROM public.audit_logs WHERE entity_id = r.id AND action IN ('demo_confirmed', 'demo_rescheduled', 'demo_cancelled')) <> 3 THEN RAISE EXCEPTION 'FAIL 7 audit'; END IF;
  RAISE NOTICE 'PASS 7 schedule / reschedule / cancel';
END $$;

-- 8. settings: admin only, clamped, audited; browsers cannot call the service-only claims
DO $$
DECLARE s jsonb;
BEGIN
  PERFORM set_config('test.uid', current_setting('test.admin'), true);
  s := public.admin_demo_alert_set_settings(true, 2, 'Africa/Cairo', 1, 45);
  IF (s ->> 'respond_business_hours')::numeric <> 2 OR s ->> 'admin_timezone' <> 'Africa/Cairo' OR (s ->> 'daily_reminders_max')::int <> 1 THEN RAISE EXCEPTION 'FAIL 8 set %', s; END IF;
  BEGIN PERFORM public.admin_demo_alert_set_settings(true, 2, 'Mars/Base', 1, 45); RAISE EXCEPTION 'FAIL 8 bad tz';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  IF has_function_privilege('anon', 'public.dsa_alert_claim(uuid)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.dsa_reminder_claim(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 8 claims callable from the browser'; END IF;
  IF NOT has_function_privilege('anon', 'public.submit_demo_request_details(text,text,text,text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL 8 details not callable'; END IF;
  RAISE NOTICE 'PASS 8 settings + privileges';
END $$;
