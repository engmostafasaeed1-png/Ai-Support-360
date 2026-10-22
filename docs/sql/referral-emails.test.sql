-- Checks for docs/sql/referral-emails.sql. One transaction, ROLLED BACK at the end (leaves no data).
-- Run only after applying the file:  psql -v ON_ERROR_STOP=1 -f docs/sql/referral-emails.test.sql
BEGIN;
DO $$
DECLARE
  adm uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); u3 uuid := gen_random_uuid();
  c1 uuid; c2 uuid; c3 uuid; po uuid := gen_random_uuid(); m date := (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') - interval '1 month')::date;
  n int; q record; p jsonb; dom text := 're-test.invalid';
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, created_at) VALUES
    (adm, 'adm@' || dom, now(), now()), (u1, 'u1@' || dom, now(), now()), (u2, 'u2@' || dom, now(), now()), (u3, 'u3@' || dom, now(), now());
  INSERT INTO public.user_roles (user_id, role) VALUES (adm, 'admin'), (u1, 'consultant'), (u2, 'consultant'), (u3, 'consultant');
  INSERT INTO public.profiles (user_id, display_name, preferred_language) VALUES (adm, 'Admin', 'en'), (u1, 'Omar Saleh', 'en'), (u2, 'Dina Kamal', 'ar'), (u3, 'Quiet One', 'en');
  INSERT INTO public.consultants (user_id, verification_status) VALUES (u1, 'verified'), (u2, 'verified'), (u3, 'verified');
  SELECT id INTO c1 FROM public.consultants WHERE user_id = u1;
  SELECT id INTO c2 FROM public.consultants WHERE user_id = u2;
  SELECT id INTO c3 FROM public.consultants WHERE user_id = u3;
  INSERT INTO public.consultant_referrals (referred_consultant_id, referrer_consultant_id, code, source, first_reward_notified_at)
  VALUES (c2, c1, 'RETEST01', 'admin', now());
  INSERT INTO public.payouts (id, consultant_id, amount, currency, reference) VALUES (po, c2, 480, 'USD', 'referral:re-test');
  INSERT INTO public.referral_reward_lines (id, unique_key, kind, referrer_consultant_id, referred_consultant_id, source_payout_id, fee_amount, rate_percent, amount, currency, status, created_at)
  VALUES (gen_random_uuid(), 're-test-1', 'reward', c1, c2, po, 480, 0.5, 2.4, 'USD', 'pending', m + interval '3 days');
  DELETE FROM public.referral_email_queue WHERE user_id IN (u1, u2, u3, adm);

  -- RE01 statement_email_queued: once, only for a referrer with lines, masked name and anonymous reference only ---------
  PERFORM public.referral_generate_statements(m);
  SELECT count(*) INTO n FROM public.referral_email_queue WHERE kind = 'monthly_statement' AND user_id = u1;
  IF n <> 1 THEN RAISE EXCEPTION 'RE01 statement e-mails %', n; END IF;
  SELECT * INTO q FROM public.referral_email_queue WHERE kind = 'monthly_statement' AND user_id = u1;
  IF jsonb_array_length(q.payload -> 'lines') <> 1 OR q.payload -> 'lines' -> 0 ->> 'who' IS NULL OR q.payload -> 'lines' -> 0 ->> 'who' ILIKE '%Kamal%' THEN RAISE EXCEPTION 'RE01 lines %', q.payload; END IF;
  IF (q.payload -> 'totals' -> 0 ->> 'earned')::numeric <> 2.4 THEN RAISE EXCEPTION 'RE01 totals %', q.payload -> 'totals'; END IF;
  IF q.payload::text ~* '(title|hourly|client)' THEN RAISE EXCEPTION 'RE01 private field in payload'; END IF;
  SELECT count(*) INTO n FROM public.referral_email_queue WHERE kind = 'monthly_statement' AND user_id IN (u2, u3);
  IF n <> 0 THEN RAISE EXCEPTION 'RE01 empty statement e-mailed %', n; END IF;
  -- RE02 statement_once: running the job again queues nothing new
  PERFORM public.referral_generate_statements(m);
  SELECT count(*) INTO n FROM public.referral_email_queue WHERE kind = 'monthly_statement' AND user_id = u1;
  IF n <> 1 THEN RAISE EXCEPTION 'RE02 duplicate statement %', n; END IF;

  -- RE03 weekly_digest: one e-mail per administrator per week, never to consultants -------------------------------------
  PERFORM public.referral_weekly_digest();
  PERFORM public.referral_weekly_digest();
  SELECT count(*) INTO n FROM public.referral_email_queue WHERE kind = 'weekly_digest_admin' AND user_id = adm;
  IF n <> 1 THEN RAISE EXCEPTION 'RE03 admin digests %', n; END IF;
  SELECT count(*) INTO n FROM public.referral_email_queue WHERE kind = 'weekly_digest_admin' AND user_id IN (u1, u2, u3);
  IF n <> 0 THEN RAISE EXCEPTION 'RE03 digest reached consultants %', n; END IF;
  SELECT payload INTO p FROM public.referral_email_queue WHERE kind = 'weekly_digest_admin' AND user_id = adm;
  IF p -> 'stats' ->> 'signups' IS NULL OR p ->> 'period' IS NULL THEN RAISE EXCEPTION 'RE03 payload %', p; END IF;

  -- RE04 payload_service_only: the sender's payload function refuses signed-in users ------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.referral_email_payload(q.id); RAISE EXCEPTION 'RE04 payload readable';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'forbidden' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  p := public.referral_email_payload(q.id);
  IF p ? 'period_key' OR NOT p ? 'lines' OR NOT p ? 'tier' OR (p -> 'tier' ->> 'count') IS NULL THEN RAISE EXCEPTION 'RE04 payload %', p; END IF;

  RAISE NOTICE 'referral-emails tests passed';
END $$;
ROLLBACK;
