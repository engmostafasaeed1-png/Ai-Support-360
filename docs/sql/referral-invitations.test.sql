-- Adversarial checks for docs/sql/referral-invitations.sql. One transaction, ROLLED BACK at the end (leaves no data).
-- Run only after applying the file:  psql -v ON_ERROR_STOP=1 -f docs/sql/referral-invitations.test.sql
-- Each block is named (RI01 ...) so a failure message points at the broken rule.
BEGIN;
DO $$
DECLARE
  sa uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); cl uuid := gen_random_uuid();
  ok1 uuid := gen_random_uuid(); ar1 uuid := gen_random_uuid(); unv uuid := gen_random_uuid(); unc uuid := gen_random_uuid();
  pau uuid := gen_random_uuid(); tst uuid := gen_random_uuid(); sus uuid := gen_random_uuid();
  c_ok uuid; c_ar uuid; ids uuid[]; r jsonb; n int; k1 uuid := gen_random_uuid(); run1 uuid; line uuid;
  dom text := 'ri-test.invalid';
BEGIN
  -- fixtures --------------------------------------------------------------------------------------------------------
  INSERT INTO auth.users (id, email, email_confirmed_at, created_at) VALUES
    (sa, 'sa@' || dom, now(), now()), (adm, 'adm@' || dom, now(), now()), (cl, 'cl@' || dom, now(), now()),
    (ok1, 'ok@' || dom, now(), now()), (ar1, 'ar@' || dom, now(), now()), (unv, 'unv@' || dom, now(), now()),
    (unc, 'unc@' || dom, NULL, now()), (pau, 'pau@' || dom, now(), now()), (tst, 'tst@' || dom, now(), now()),
    (sus, 'sus@' || dom, now(), now());
  UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = sus;
  INSERT INTO public.user_roles (user_id, role) VALUES (sa, 'super_admin'), (adm, 'admin'), (cl, 'client'),
    (ok1, 'consultant'), (ar1, 'consultant'), (unv, 'consultant'), (unc, 'consultant'), (pau, 'consultant'), (tst, 'consultant'), (sus, 'consultant');
  INSERT INTO public.profiles (user_id, display_name, preferred_language) VALUES
    (sa, 'Super', 'en'), (adm, 'Admin', 'en'), (cl, 'Client', 'en'), (ok1, 'Omar', 'en'), (ar1, 'Laila', 'ar'), (unv, 'Unverified', 'en'),
    (unc, 'Unconfirmed', 'en'), (pau, 'Paused', 'en'), (tst, 'Tester', 'en'), (sus, 'Suspended', 'en');
  INSERT INTO public.consultants (user_id, verification_status) VALUES
    (ok1, 'verified'), (ar1, 'verified'), (unv, 'pending'), (unc, 'verified'), (pau, 'verified'), (tst, 'verified'), (sus, 'verified');
  SELECT id INTO c_ok FROM public.consultants WHERE user_id = ok1;
  SELECT id INTO c_ar FROM public.consultants WHERE user_id = ar1;
  INSERT INTO public.telegram_links (user_id, chat_id, active) VALUES (ar1, 777, true);
  INSERT INTO public.user_notification_pauses (user_id, paused_until, duration) VALUES (pau, now() + interval '3 days', '3d');
  INSERT INTO public.user_admin_state (user_id, tags) VALUES (tst, ARRAY['Test']);
  UPDATE public.platform_settings SET value = 'false'::jsonb WHERE key = 'referral_invitations_enabled';
  ids := ARRAY[cl, ok1, ar1, unv, unc, pau, tst, sus];

  -- RI01 non_admin_denied: clients and consultants can call nothing --------------------------------------------------
  FOREACH line IN ARRAY ARRAY[cl, ok1] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', line, 'role', 'authenticated')::text, true);
    BEGIN PERFORM public.admin_referral_invite_preview(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids))); RAISE EXCEPTION 'RI01 preview allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.admin_referral_invite_send(jsonb_build_object('mode', 'test', 'idempotency_key', gen_random_uuid())); RAISE EXCEPTION 'RI01 send allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.admin_referral_invite_runs(5); RAISE EXCEPTION 'RI01 runs allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM * FROM public.admin_referral_invite_status(ids); RAISE EXCEPTION 'RI01 status allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN PERFORM public.admin_referral_invite_set_settings('{"enabled":true}'::jsonb); RAISE EXCEPTION 'RI01 settings allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  -- RLS: the invitation tables are not readable by consultants (no rows visible through the policy)
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'referral_invitation_recipients' AND cmd <> 'SELECT') THEN RAISE EXCEPTION 'RI01 write policy exists'; END IF;

  -- RI02 eligibility_reasons: each rule skips with its own reason ---------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := public.admin_referral_invite_preview(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids)));
  IF (r ->> 'eligible')::int <> 2 THEN RAISE EXCEPTION 'RI02 eligible %', r; END IF;
  IF (r -> 'skipped' ->> 'not_consultant')::int <> 1 OR (r -> 'skipped' ->> 'not_verified')::int <> 1 OR (r -> 'skipped' ->> 'email_unconfirmed')::int <> 1
     OR (r -> 'skipped' ->> 'suspended')::int <> 1 THEN RAISE EXCEPTION 'RI02 reasons %', r; END IF;
  IF jsonb_array_length(r -> 'sample') <> 2 OR (r ->> 'arabic')::int <> 1 OR (r ->> 'telegram_linked')::int <> 1 THEN RAISE EXCEPTION 'RI02 reach %', r; END IF;

  -- RI03 pause_respected: a consultant who paused notifications is skipped and reported -------------------------------
  IF (r -> 'skipped' ->> 'paused')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'RI03 paused %', r; END IF;

  -- RI04 test_tag_skipped: tagged "test" skipped unless included explicitly ----------------------------------------
  IF (r -> 'skipped' ->> 'test_account')::int IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'RI04 test tag %', r; END IF;
  r := public.admin_referral_invite_preview(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'include_tests', true));
  IF (r ->> 'eligible')::int <> 3 THEN RAISE EXCEPTION 'RI04 include tests %', r; END IF;

  -- RI05 kill_switch_off: no real send while OFF; the test goes only to the caller ----------------------------------
  BEGIN
    PERFORM public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'confirmed', true, 'idempotency_key', gen_random_uuid()));
    RAISE EXCEPTION 'RI05 sent while off';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%switched off%' THEN RAISE; END IF; END;
  r := public.admin_referral_invite_send(jsonb_build_object('mode', 'test', 'idempotency_key', gen_random_uuid()));
  SELECT count(*) INTO n FROM public.notifications WHERE type = 'referral' AND title LIKE '[TEST]%' AND user_id = adm;
  IF n <> 1 THEN RAISE EXCEPTION 'RI05 test notice %', n; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE type = 'referral' AND user_id = ANY (ids);
  IF n <> 0 THEN RAISE EXCEPTION 'RI05 test reached others %', n; END IF;

  -- RI06 confirm_required: never on the first click ----------------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  PERFORM public.admin_referral_invite_set_settings('{"enabled":true}'::jsonb);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'idempotency_key', gen_random_uuid()));
    RAISE EXCEPTION 'RI06 sent without confirmation';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- RI07 send_and_log: queued for the Feature R worker, skipped people logged with reasons, audit row written ---------
  r := public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'confirmed', true,
        'channels', '["in_app","telegram"]'::jsonb, 'idempotency_key', k1, 'filters', '{"roles":"consultant","Evil-Key!":"<script>","nested":{"a":1}}'::jsonb));
  run1 := (r ->> 'id')::uuid;
  IF (r ->> 'queued')::int <> 2 OR (r ->> 'skipped')::int <> 6 THEN RAISE EXCEPTION 'RI07 counts %', r; END IF;
  SELECT count(*) INTO n FROM public.message_campaign_recipients WHERE campaign_id = (r ->> 'campaign_id')::uuid AND channel = 'in_app' AND status = 'queued';
  IF n <> 2 THEN RAISE EXCEPTION 'RI07 in-app queued %', n; END IF;
  SELECT count(*) INTO n FROM public.message_campaign_recipients WHERE campaign_id = (r ->> 'campaign_id')::uuid AND channel = 'telegram' AND status = 'queued';
  IF n <> 1 THEN RAISE EXCEPTION 'RI07 telegram only linked %', n; END IF;
  IF (SELECT filters ? 'Evil-Key!' OR filters ? 'nested' OR NOT filters ? 'roles' FROM public.referral_invitation_runs WHERE id = run1) THEN RAISE EXCEPTION 'RI07 unknown filter kept'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id = run1 AND action = 'referral_invitation_sent' AND user_id = adm
                   AND (metadata ->> 'queued')::int = 2 AND metadata ->> 'template' = 'referral_invitation_v1') THEN RAISE EXCEPTION 'RI07 audit'; END IF;
  IF (SELECT link_url FROM public.message_campaigns WHERE id = (r ->> 'campaign_id')::uuid) !~ '^/consultant/referrals\?tab=programme' THEN RAISE EXCEPTION 'RI07 link'; END IF;
  IF (SELECT body_en !~ 'there is no guaranteed income' OR body_en ~* 'you will earn|guaranteed (reward|payment)' OR body_ar !~ 'لا يوجد دخل مضمون'
        FROM public.message_campaigns WHERE id = (r ->> 'campaign_id')::uuid) THEN RAISE EXCEPTION 'RI07 promise wording'; END IF;

  -- RI08 idempotent: the same request id twice returns the first run and sends nothing new ---------------------------
  r := public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'confirmed', true, 'idempotency_key', k1));
  IF (r ->> 'id')::uuid <> run1 OR (r ->> 'repeated')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'RI08 not idempotent %', r; END IF;
  SELECT count(*) INTO n FROM public.referral_invitation_runs WHERE admin_id = adm AND mode <> 'test';
  IF n <> 1 THEN RAISE EXCEPTION 'RI08 runs %', n; END IF;

  -- RI09 dedupe_per_version: a new request id still skips everyone already invited (this version) --------------------
  BEGIN
    PERFORM public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ARRAY[ok1, ar1]), 'confirmed', true, 'idempotency_key', gen_random_uuid()));
    RAISE EXCEPTION 'RI09 invited twice';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.admin_referral_invite_preview(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ARRAY[ok1, ar1])));
  IF (r -> 'skipped' ->> 'already_invited')::int <> 2 THEN RAISE EXCEPTION 'RI09 reason %', r; END IF;
  -- even a direct insert (service role) cannot record a second first invitation for the same version
  INSERT INTO public.referral_invitation_runs (id, admin_id, idempotency_key, version, mode) VALUES (k1, adm, gen_random_uuid(), 1, 'selected');
  BEGIN
    INSERT INTO public.referral_invitation_recipients (run_id, user_id, version, outcome) VALUES (k1, ok1, 1, 'queued');
    RAISE EXCEPTION 'RI09 unique index missing';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- RI10 resend_rules: needs a reason; at most one per 14 days ----------------------------------------------------
  BEGIN
    PERFORM public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ARRAY[ok1]), 'resend', true, 'confirmed', true, 'idempotency_key', gen_random_uuid()));
    RAISE EXCEPTION 'RI10 resend without reason';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.admin_referral_invite_preview(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ARRAY[ok1]), 'resend', true));
  IF (r -> 'skipped' ->> 'resend_too_soon')::int <> 1 THEN RAISE EXCEPTION 'RI10 too soon %', r; END IF;
  ALTER TABLE public.referral_invitation_recipients DISABLE TRIGGER trg_ri_recipients_append_only;
  UPDATE public.referral_invitation_recipients SET created_at = now() - interval '15 days' WHERE run_id = run1;
  ALTER TABLE public.referral_invitation_recipients ENABLE TRIGGER trg_ri_recipients_append_only;
  r := public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ARRAY[ok1]), 'resend', true,
        'reason', 'Owner asked for a reminder after the launch', 'confirmed', true, 'idempotency_key', gen_random_uuid()));
  IF (r ->> 'queued')::int <> 1 OR NOT EXISTS (SELECT 1 FROM public.referral_invitation_recipients WHERE run_id = (r ->> 'id')::uuid AND is_resend) THEN
    RAISE EXCEPTION 'RI10 resend %', r; END IF;
  r := public.admin_referral_invite_preview(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ARRAY[ok1]), 'resend', true));
  IF (r -> 'skipped' ->> 'resend_too_soon')::int <> 1 THEN RAISE EXCEPTION 'RI10 second resend %', r; END IF;

  -- RI11 max_cap: more eligible people than the maximum per request is refused --------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  PERFORM public.admin_referral_invite_set_settings('{"version":2,"max_recipients":1}'::jsonb);
  BEGIN
    PERFORM public.admin_referral_invite_set_settings('{"version":1}'::jsonb);
    RAISE EXCEPTION 'RI11 version went down';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ARRAY[ok1, ar1]), 'confirmed', true, 'idempotency_key', gen_random_uuid()));
    RAISE EXCEPTION 'RI11 cap ignored';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Too many recipients%' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.admin_referral_invite_set_settings('{"max_recipients":5000}'::jsonb);
    RAISE EXCEPTION 'RI11 admin changed settings';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- RI12 append_only: invitation records cannot be changed --------------------------------------------------------
  BEGIN
    UPDATE public.referral_invitation_runs SET queued = 0 WHERE id = run1;
    RAISE EXCEPTION 'RI12 run changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- RI13 report_and_status: per-person report and "Invited on" for rows --------------------------------------------
  r := public.admin_referral_invite_report(run1);
  IF jsonb_array_length(r -> 'rows') <> 8 OR (r -> 'skipped_by_reason' ->> 'paused')::int <> 1 THEN RAISE EXCEPTION 'RI13 report %', r; END IF;
  SELECT count(*) INTO n FROM public.admin_referral_invite_status(ARRAY[ok1, ar1, unv]);
  IF n <> 2 THEN RAISE EXCEPTION 'RI13 status %', n; END IF;

  -- RI14 event_notices: one notice per line and event, never twice, never blocking the money write -------------------
  INSERT INTO public.consultant_referrals (referred_consultant_id, referrer_consultant_id, code, source, first_reward_notified_at)
  VALUES (c_ar, c_ok, 'TESTCODE1', 'admin', now());
  INSERT INTO public.referral_reward_lines (id, unique_key, kind, referrer_consultant_id, referred_consultant_id, source_payout_id, fee_amount, rate_percent, amount, currency, status)
  VALUES (gen_random_uuid(), 'ri-test-1', 'reward', c_ok, c_ar, gen_random_uuid(), 1000, 0.5, 5, 'USD', 'pending') RETURNING id INTO line;
  UPDATE public.referral_reward_lines SET status = 'available' WHERE id = line;
  UPDATE public.referral_reward_lines SET status = 'paid' WHERE id = line;
  UPDATE public.referral_reward_lines SET status = 'paid', updated_at = now() WHERE id = line;
  SELECT count(*) INTO n FROM public.referral_email_queue WHERE user_id = ok1 AND kind IN ('reward_earned', 'reward_available', 'reward_paid');
  IF n <> 3 THEN RAISE EXCEPTION 'RI14 notices %', n; END IF;
  UPDATE public.consultant_referrals SET status = 'removed' WHERE referred_consultant_id = c_ar;
  UPDATE public.consultant_referrals SET status = 'removed', updated_at = now() WHERE referred_consultant_id = c_ar;
  SELECT count(*) INTO n FROM public.notifications WHERE user_id = ok1 AND type = 'referral' AND title = 'A referral was not accepted';
  IF n <> 1 THEN RAISE EXCEPTION 'RI14 rejected notice %', n; END IF;

  RAISE NOTICE 'referral-invitations tests passed';
END $$;
ROLLBACK;
