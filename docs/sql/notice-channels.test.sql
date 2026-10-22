-- Adversarial checks for docs/sql/notice-channels.sql. One transaction, ROLLED BACK at the end (leaves no data).
-- Run only after applying the file:  psql -v ON_ERROR_STOP=1 -f docs/sql/notice-channels.test.sql
-- Each block is named (NC01 ...) so a failure message points at the broken rule.
BEGIN;
DO $$
DECLARE
  sa uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); cl uuid := gen_random_uuid();
  ok1 uuid := gen_random_uuid(); ar1 uuid := gen_random_uuid(); pau uuid := gen_random_uuid(); nop uuid := gen_random_uuid();
  ids uuid[]; r jsonb; n int; t text; run1 uuid; camp uuid;
  dom text := 'nc-test.invalid';
BEGIN
  -- fixtures --------------------------------------------------------------------------------------------------------
  INSERT INTO auth.users (id, email, email_confirmed_at, created_at) VALUES
    (sa, 'sa@' || dom, now(), now()), (adm, 'adm@' || dom, now(), now()), (cl, 'cl@' || dom, now(), now()),
    (ok1, 'ok@' || dom, now(), now()), (ar1, 'ar@' || dom, now(), now()), (pau, 'pau@' || dom, now(), now()), (nop, 'nop@' || dom, now(), now());
  INSERT INTO public.user_roles (user_id, role) VALUES (sa, 'super_admin'), (adm, 'admin'), (cl, 'client'),
    (ok1, 'consultant'), (ar1, 'consultant'), (pau, 'consultant'), (nop, 'consultant');
  INSERT INTO public.profiles (user_id, display_name, preferred_language) VALUES
    (sa, 'Super', 'en'), (adm, '', 'en'), (cl, 'Client', 'en'), (ok1, 'Omar Saleh', 'en'), (ar1, 'Laila', 'ar'), (pau, 'Paused', 'en'), (nop, 'Nora', 'en');
  INSERT INTO public.consultants (user_id, verification_status) VALUES (ok1, 'verified'), (ar1, 'verified'), (pau, 'verified'), (nop, 'verified');
  INSERT INTO public.telegram_links (user_id, chat_id, active) VALUES (ar1, 777, true);
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (ok1, 'https://fcm.googleapis.com/fcm/send/nc-test', 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg');
  INSERT INTO public.user_notification_pauses (user_id, paused_until, duration) VALUES (pau, now() + interval '3 days', '3d');
  INSERT INTO public.platform_settings (key, value) VALUES ('referral_invitations_enabled', 'true'::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  ids := ARRAY[ok1, ar1, pau, nop];

  -- NC01 cleanup_denied: only super admins remove test notifications --------------------------------------------------
  FOREACH t IN ARRAY ARRAY[cl::text, ok1::text, adm::text] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', t, 'role', 'authenticated')::text, true);
    BEGIN PERFORM public.admin_cleanup_test_notifications(0); RAISE EXCEPTION 'NC01 cleanup allowed for %', t;
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  END LOOP;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ok1, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.admin_referral_invite_preview(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'channels', '["push"]'::jsonb));
    RAISE EXCEPTION 'NC01 preview allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- NC02 test_text: marked is_test, no empty greeting gap, no stray ";", full text --------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := public.admin_referral_invite_send(jsonb_build_object('mode', 'test', 'channels', '["in_app"]'::jsonb, 'idempotency_key', gen_random_uuid()));
  SELECT body INTO t FROM public.notifications WHERE user_id = adm AND type = 'referral' AND is_test ORDER BY created_at DESC LIMIT 1;
  IF t IS NULL THEN RAISE EXCEPTION 'NC02 test notification not marked'; END IF;
  IF t ~ 'Hello\s+,' OR t !~ '^Hello,' THEN RAISE EXCEPTION 'NC02 greeting %', left(t, 40); END IF;
  IF t ~ ';\s*$' OR t !~ 'Open Refer & earn: https://' THEN RAISE EXCEPTION 'NC02 cut or stray punctuation'; END IF;
  IF t ~ '\{\{' THEN RAISE EXCEPTION 'NC02 placeholder left'; END IF;
  SELECT count(*) INTO n FROM public.notifications WHERE type = 'referral' AND user_id = ANY (ids);
  IF n <> 0 THEN RAISE EXCEPTION 'NC02 test reached others %', n; END IF;
  BEGIN PERFORM public.admin_referral_invite_send(jsonb_build_object('mode', 'test', 'channels', '["telegram"]'::jsonb, 'idempotency_key', gen_random_uuid()));
    RAISE EXCEPTION 'NC02 test without in-app'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- NC03 per_channel_counts: reach per channel before sending, e-mail shown as not available -----------------------------
  r := public.admin_referral_invite_preview(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'channels', '["in_app","email"]'::jsonb));
  IF (r -> 'by_channel' -> 'in_app' ->> 'eligible')::int <> 3 THEN RAISE EXCEPTION 'NC03 in-app %', r -> 'by_channel'; END IF;
  IF (r -> 'by_channel' -> 'push' ->> 'eligible')::int <> 1 OR (r -> 'by_channel' -> 'push' -> 'skipped' ->> 'push_not_enabled')::int <> 2 THEN RAISE EXCEPTION 'NC03 push %', r -> 'by_channel'; END IF;
  IF (r -> 'by_channel' -> 'telegram' ->> 'eligible')::int <> 1 OR (r -> 'by_channel' -> 'telegram' -> 'skipped' ->> 'telegram_not_connected')::int <> 2 THEN RAISE EXCEPTION 'NC03 telegram %', r -> 'by_channel'; END IF;
  IF (r -> 'by_channel' -> 'email' ->> 'available')::boolean OR r -> 'by_channel' -> 'email' ->> 'reason' <> 'email_not_allowed' THEN RAISE EXCEPTION 'NC03 email %', r -> 'by_channel'; END IF;
  -- NC04 pause_respected: the paused consultant is skipped on every app channel, with the reason
  IF (r -> 'by_channel' -> 'in_app' -> 'skipped' ->> 'paused')::int <> 1 OR (r -> 'skipped' ->> 'paused')::int <> 1 THEN RAISE EXCEPTION 'NC04 paused %', r; END IF;
  IF (r -> 'reach' ->> 'push,telegram')::int <> 2 OR (r -> 'reach' ->> 'in_app')::int <> 3 OR (r -> 'reach' ->> 'email')::int <> 0 THEN RAISE EXCEPTION 'NC03 reach %', r -> 'reach'; END IF;

  -- NC05 email_never_sent: e-mail alone is refused; with other channels it is recorded as skipped -----------------------
  BEGIN
    PERFORM public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'channels', '["email"]'::jsonb,
      'confirmed', true, 'idempotency_key', gen_random_uuid()));
    RAISE EXCEPTION 'NC05 e-mail only accepted';
  EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'E-mail cannot carry%' THEN RAISE; END IF; END;
  r := public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'channels', '["in_app","email"]'::jsonb,
        'confirmed', true, 'idempotency_key', gen_random_uuid()));
  run1 := (r ->> 'id')::uuid; camp := (r ->> 'campaign_id')::uuid;
  IF (r ->> 'queued')::int <> 3 THEN RAISE EXCEPTION 'NC05 queued %', r; END IF;
  IF (SELECT channels FROM public.message_campaigns WHERE id = camp) <> ARRAY['in_app'] THEN RAISE EXCEPTION 'NC05 e-mail reached the campaign'; END IF;
  SELECT count(*) INTO n FROM public.referral_invitation_deliveries WHERE run_id = run1 AND channel = 'email' AND outcome = 'skipped' AND reason = 'email_not_allowed';
  IF n <> 3 THEN RAISE EXCEPTION 'NC05 e-mail not recorded as skipped %', n; END IF;
  IF (r -> 'by_channel' -> 'email' -> 'skipped' ->> 'email_not_allowed')::int <> 3 OR (r -> 'by_channel' -> 'in_app' ->> 'sending')::int <> 3 THEN RAISE EXCEPTION 'NC05 report %', r -> 'by_channel'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id = run1 AND action = 'referral_invitation_sent'
                   AND metadata -> 'channels' = '["in_app","email"]'::jsonb AND (metadata -> 'queued_by_channel' ->> 'in_app')::int = 3) THEN RAISE EXCEPTION 'NC05 audit channels'; END IF;

  -- NC06 dedupe_per_channel: the same channel twice is refused, another channel later is fine ---------------------------
  BEGIN
    PERFORM public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'channels', '["in_app"]'::jsonb,
      'confirmed', true, 'idempotency_key', gen_random_uuid()));
    RAISE EXCEPTION 'NC06 in-app twice';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.admin_referral_invite_preview(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'channels', '["in_app"]'::jsonb));
  IF (r -> 'by_channel' -> 'in_app' -> 'skipped' ->> 'already_invited')::int <> 3 THEN RAISE EXCEPTION 'NC06 reason %', r -> 'by_channel'; END IF;
  r := public.admin_referral_invite_send(jsonb_build_object('mode', 'selected', 'user_ids', to_jsonb(ids), 'channels', '["in_app","telegram","push"]'::jsonb,
        'confirmed', true, 'idempotency_key', gen_random_uuid()));
  IF (r ->> 'queued')::int <> 2 THEN RAISE EXCEPTION 'NC06 second channel %', r; END IF;
  SELECT count(*) INTO n FROM public.message_campaign_recipients WHERE campaign_id = (r ->> 'campaign_id')::uuid AND status = 'queued';
  IF n <> 2 THEN RAISE EXCEPTION 'NC06 queued rows %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.message_campaign_recipients WHERE campaign_id = (r ->> 'campaign_id')::uuid AND user_id = ar1 AND channel = 'telegram' AND status = 'queued')
     OR NOT EXISTS (SELECT 1 FROM public.message_campaign_recipients WHERE campaign_id = (r ->> 'campaign_id')::uuid AND user_id = ok1 AND channel = 'push' AND status = 'queued')
     THEN RAISE EXCEPTION 'NC06 wrong channel rows'; END IF;
  BEGIN
    INSERT INTO public.referral_invitation_deliveries (run_id, user_id, version, channel, outcome) VALUES (run1, gen_random_uuid(), 1, 'in_app', 'queued');
    INSERT INTO public.referral_invitation_deliveries (run_id, user_id, version, channel, outcome)
      SELECT gen_random_uuid(), ok1, 1, 'in_app', 'queued';
    RAISE EXCEPTION 'NC06 unique index missing';
  EXCEPTION WHEN unique_violation OR foreign_key_violation THEN NULL; END;
  -- the report shows each channel per person
  r := public.admin_referral_invite_report(run1);
  IF NOT (SELECT bool_and(x -> 'channels' ? 'email') FROM jsonb_array_elements(r -> 'rows') x WHERE x ->> 'outcome' <> 'skipped') THEN RAISE EXCEPTION 'NC06 row channels %', r; END IF;
  SELECT count(*) INTO n FROM public.admin_referral_invite_status(ids) s WHERE 'telegram' = ANY (s.channels) OR 'push' = ANY (s.channels);
  IF n <> 2 THEN RAISE EXCEPTION 'NC06 status channels %', n; END IF;

  -- NC07 deliveries_append_only ---------------------------------------------------------------------------------------
  BEGIN UPDATE public.referral_invitation_deliveries SET outcome = 'skipped' WHERE run_id = run1; RAISE EXCEPTION 'NC07 changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- NC08 bulk_push_channel: push only to people with a device; e-mail is never a bulk channel ---------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.bm_create_campaign(jsonb_build_object('category', 'service', 'category_confirmed', true, 'channels', '["email"]'::jsonb,
      'subject_en', 'Hi', 'body_en', 'Body', 'audience', jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ARRAY[ok1, nop]))));
    RAISE EXCEPTION 'NC08 e-mail accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.bm_create_campaign(jsonb_build_object('category', 'service', 'category_confirmed', true, 'channels', '["in_app","push"]'::jsonb,
      'subject_en', 'Maintenance tonight', 'body_en', 'The portal is offline 22:00-23:00.', 'audience', jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ARRAY[ok1, nop]))));
  SELECT count(*) INTO n FROM public.message_campaign_recipients WHERE campaign_id = (r ->> 'id')::uuid AND channel = 'push' AND status = 'queued' AND user_id = ok1;
  IF n <> 1 THEN RAISE EXCEPTION 'NC08 push queued %', n; END IF;
  SELECT count(*) INTO n FROM public.message_campaign_recipients WHERE campaign_id = (r ->> 'id')::uuid AND channel = 'push' AND status = 'skipped' AND reason = 'push_not_enabled' AND user_id = nop;
  IF n <> 1 THEN RAISE EXCEPTION 'NC08 push skipped %', n; END IF;
  IF ((public.bm_preview(jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ARRAY[ok1, nop])), 'service')) ->> 'push_enabled')::int <> 1 THEN RAISE EXCEPTION 'NC08 preview push'; END IF;

  -- NC09 cleanup: the super admin removes test notifications only ---------------------------------------------------------
  SELECT count(*) INTO n FROM public.notifications WHERE NOT is_test;
  PERFORM public.admin_cleanup_test_notifications(0);
  IF EXISTS (SELECT 1 FROM public.notifications WHERE is_test) THEN RAISE EXCEPTION 'NC09 test notices left'; END IF;
  IF (SELECT count(*) FROM public.notifications WHERE NOT is_test) <> n THEN RAISE EXCEPTION 'NC09 removed real notices'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'test_notifications_removed' AND user_id = sa) THEN RAISE EXCEPTION 'NC09 audit'; END IF;

  RAISE NOTICE 'notice-channels tests passed';
END $$;
ROLLBACK;
