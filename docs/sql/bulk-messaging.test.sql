-- Feature R checks for docs/sql/bulk-messaging.sql. Runs in one transaction and rolls back (leaves no data).
-- Run after applying the file:  psql -v ON_ERROR_STOP=1 -f docs/sql/bulk-messaging.test.sql
BEGIN;
DO $$
DECLARE
  sa UUID := gen_random_uuid(); adm UUID := gen_random_uuid(); cl UUID := gen_random_uuid(); co UUID := gen_random_uuid();
  sus UUID := gen_random_uuid(); uns UUID := gen_random_uuid(); ar UUID := gen_random_uuid();
  ids UUID[]; r JSONB; cid UUID; n INT; ok BOOLEAN; i INT; big UUID[] := '{}';
  _test_email_domain TEXT := 'bm-test.invalid';
BEGIN
  -- people
  INSERT INTO auth.users (id, email, created_at, last_sign_in_at) VALUES
    (sa, 'sa@' || _test_email_domain, now(), now()), (adm, 'adm@' || _test_email_domain, now(), now()),
    (cl, 'cl@' || _test_email_domain, now(), now() - interval '200 days'), (co, 'co@' || _test_email_domain, now(), now()),
    (sus, 'sus@' || _test_email_domain, now(), now()), (uns, 'uns@' || _test_email_domain, now(), now()),
    (ar, 'ar@' || _test_email_domain, now(), now());
  UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = sus;
  INSERT INTO public.user_roles (user_id, role) VALUES (sa, 'super_admin'), (adm, 'admin'), (cl, 'client'), (co, 'consultant'),
    (sus, 'client'), (uns, 'client'), (ar, 'client');
  INSERT INTO public.profiles (user_id, display_name, phone, preferred_language) VALUES
    (cl, 'Sara Client', '+966 50 123 4567', 'en'), (co, 'Omar Consultant', NULL, 'en'), (ar, 'Laila', NULL, 'ar');
  INSERT INTO public.client_profiles (user_id, company_name) VALUES (cl, 'Acme');
  INSERT INTO public.consultants (user_id, country, city) VALUES (co, 'Egypt', NULL);
  INSERT INTO public.telegram_links (user_id, chat_id, active) VALUES (co, 12345, true);
  INSERT INTO public.suppressed_emails (email, reason) VALUES ('uns@' || _test_email_domain, 'unsubscribe');
  ids := ARRAY[cl, co, sus, uns, ar];

  -- 1. permission: clients and admins without an explicit grant are refused; super admins may send
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cl)::TEXT, true);
  BEGIN PERFORM public.bm_preview(jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ids)), 'service'); RAISE EXCEPTION 'client allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm)::TEXT, true);
  BEGIN PERFORM public.bm_preview(jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ids)), 'service'); RAISE EXCEPTION 'admin allowed by default';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF public.bm_can_send(adm) OR NOT public.bm_can_send(sa) THEN RAISE EXCEPTION 'messages.send default'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sa)::TEXT, true);

  -- 2. audience + exclusions: suspended never; unsubscribed only for marketing
  r := public.bm_preview(jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ids)), 'service');
  IF (r ->> 'candidates')::INT <> 5 OR (r ->> 'eligible')::INT <> 4 OR (r -> 'excluded' ->> 'suspended')::INT <> 1 THEN RAISE EXCEPTION 'service audience %', r; END IF;
  r := public.bm_preview(jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ids)), 'marketing');
  IF (r ->> 'eligible')::INT <> 3 OR (r -> 'excluded' ->> 'unsubscribed')::INT <> 1 THEN RAISE EXCEPTION 'marketing audience %', r; END IF;
  IF (r ->> 'telegram_linked')::INT <> 1 OR (r ->> 'with_phone')::INT <> 1 OR (r ->> 'arabic')::INT <> 1 THEN RAISE EXCEPTION 'reach %', r; END IF;
  r := public.bm_preview(jsonb_build_object('kind', 'emails', 'emails', jsonb_build_array('CL@' || _test_email_domain, 'nobody@' || _test_email_domain)), 'service');
  IF (r ->> 'eligible')::INT <> 1 OR (r ->> 'unknown_emails')::INT <> 1 THEN RAISE EXCEPTION 'emails %', r; END IF;
  r := public.bm_preview('{"kind":"filter","roles":["consultant"],"location_missing":true}'::jsonb, 'service');
  IF (r ->> 'eligible')::INT <> 1 THEN RAISE EXCEPTION 'filter location %', r; END IF;
  r := public.bm_preview('{"kind":"filter","roles":["client"],"inactive_days":90}'::jsonb, 'service');
  IF (r ->> 'eligible')::INT <> 1 THEN RAISE EXCEPTION 'filter inactive %', r; END IF;
  r := public.bm_preview(jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ids)), 'service', ARRAY[cl]);
  IF (r -> 'excluded' ->> 'excluded_by_admin')::INT <> 1 THEN RAISE EXCEPTION 'manual exclusion %', r; END IF;

  -- 3. secrets are refused; the category must be confirmed
  BEGIN
    PERFORM public.bm_create_campaign(jsonb_build_object('category', 'service', 'category_confirmed', true, 'channels', '["in_app"]'::jsonb,
      'subject_en', 'Hi', 'body_en', 'password: hunter22', 'audience', jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ids))));
    RAISE EXCEPTION 'secret accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN
    PERFORM public.bm_create_campaign(jsonb_build_object('category', 'service', 'channels', '["in_app"]'::jsonb,
      'subject_en', 'Hi', 'body_en', 'Body', 'audience', jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ids))));
    RAISE EXCEPTION 'unconfirmed category accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;

  -- 4. create: per-channel plan (Telegram only when linked, manual only with a phone, excluded rows recorded)
  r := public.bm_create_campaign(jsonb_build_object('category', 'marketing', 'category_confirmed', true,
    'channels', '["in_app","popup","telegram","whatsapp_manual"]'::jsonb, 'subject_en', 'News', 'body_en', 'Hello {{first_name}}',
    'audience', jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(ids))));
  cid := (r ->> 'id')::UUID;
  IF (r ->> 'recipient_count')::INT <> 3 THEN RAISE EXCEPTION 'count %', r; END IF;
  SELECT count(*) INTO n FROM public.message_campaign_recipients WHERE campaign_id = cid AND channel = 'in_app' AND status = 'queued';
  IF n <> 3 THEN RAISE EXCEPTION 'in-app queued %', n; END IF;
  SELECT count(*) INTO n FROM public.message_campaign_recipients WHERE campaign_id = cid AND channel = 'telegram' AND status = 'queued';
  IF n <> 1 THEN RAISE EXCEPTION 'telegram queued %', n; END IF;
  SELECT count(*) INTO n FROM public.message_campaign_recipients WHERE campaign_id = cid AND channel = 'whatsapp_manual' AND status = 'manual_pending';
  IF n <> 1 THEN RAISE EXCEPTION 'manual %', n; END IF;
  SELECT count(*) INTO n FROM public.message_campaign_recipients WHERE campaign_id = cid AND status = 'skipped' AND reason IN ('suspended', 'unsubscribed');
  IF n <> 6 THEN RAISE EXCEPTION 'skipped rows %', n; END IF; -- 2 excluded people x 3 channels
  IF NOT EXISTS (SELECT 1 FROM public.message_campaign_events WHERE campaign_id = cid AND action = 'created' AND (detail ->> 'count')::INT = 3) THEN
    RAISE EXCEPTION 'audit'; END IF;

  -- 5. immutable record, append-only history
  BEGIN UPDATE public.message_campaigns SET subject_en = 'Changed' WHERE id = cid; RAISE EXCEPTION 'content changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.message_campaigns WHERE id = cid; RAISE EXCEPTION 'deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.message_campaign_events SET action = 'cancelled' WHERE campaign_id = cid; RAISE EXCEPTION 'event changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- 6. throttling and kill switch
  INSERT INTO public.platform_settings (key, value) VALUES ('bulk_inapp_per_minute', '2'::jsonb)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  SELECT count(*) FILTER (WHERE channel = 'in_app'), count(*) FILTER (WHERE channel = 'telegram') INTO n, i FROM public.bm_claim(300);
  IF n <> 2 OR i <> 1 THEN RAISE EXCEPTION 'first claim in_app=% telegram=%', n, i; END IF;
  SELECT count(*) INTO n FROM public.bm_claim(300);
  IF n <> 0 THEN RAISE EXCEPTION 'budget not respected %', n; END IF;
  UPDATE public.message_campaign_recipients SET claimed_at = now() - interval '2 minutes' WHERE campaign_id = cid AND status = 'claimed';
  UPDATE public.platform_settings SET value = 'false'::jsonb WHERE key = 'bulk_messaging_enabled';
  IF NOT FOUND THEN INSERT INTO public.platform_settings (key, value) VALUES ('bulk_messaging_enabled', 'false'::jsonb); END IF;
  SELECT count(*) INTO n FROM public.bm_claim(300);
  IF n <> 0 THEN RAISE EXCEPTION 'kill switch ignored'; END IF;
  UPDATE public.platform_settings SET value = 'true'::jsonb WHERE key = 'bulk_messaging_enabled';

  -- 7. finish: delivered rows become sent, retry goes back to the queue; campaign finishes when nothing is left
  PERFORM public.bm_finish((SELECT jsonb_agg(jsonb_build_object('campaign_id', campaign_id, 'user_id', user_id, 'channel', channel,
    'ok', channel = 'in_app', 'retry', channel = 'telegram', 'error', CASE WHEN channel = 'telegram' THEN 'rate_limited' END,
    'subject', 'News', 'body', 'Hello'))
    FROM public.message_campaign_recipients WHERE campaign_id = cid AND status = 'claimed'));
  SELECT count(*) INTO n FROM public.message_campaign_recipients WHERE campaign_id = cid AND status = 'sent';
  IF n <> 2 THEN RAISE EXCEPTION 'sent %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.message_campaign_recipients WHERE campaign_id = cid AND channel = 'telegram' AND status = 'queued' AND attempts = 1) THEN
    RAISE EXCEPTION 'retry'; END IF;

  -- 8. cancel stops what is left (queued and manual)
  r := public.bm_cancel_campaign(cid);
  IF (r ->> 'stopped')::INT <> 3 THEN RAISE EXCEPTION 'cancel %', r; END IF;
  IF (SELECT status FROM public.message_campaigns WHERE id = cid) <> 'cancelled' THEN RAISE EXCEPTION 'status'; END IF;

  -- 9. typed confirmation above 50 recipients, daily cap
  FOR i IN 1..51 LOOP big := big || gen_random_uuid(); END LOOP;
  INSERT INTO auth.users (id, email, created_at) SELECT x, x::TEXT || '@' || _test_email_domain, now() FROM unnest(big) x;
  BEGIN
    PERFORM public.bm_create_campaign(jsonb_build_object('category', 'service', 'category_confirmed', true, 'channels', '["in_app"]'::jsonb,
      'subject_en', 'Hi', 'body_en', 'Body', 'audience', jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(big))));
    RAISE EXCEPTION 'no typed confirmation';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO public.platform_settings (key, value) VALUES ('bulk_daily_cap', '20'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  BEGIN
    PERFORM public.bm_create_campaign(jsonb_build_object('category', 'service', 'category_confirmed', true, 'channels', '["in_app"]'::jsonb,
      'subject_en', 'Hi', 'body_en', 'Body', 'confirm_count', 51, 'audience', jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(big))));
    RAISE EXCEPTION 'daily cap ignored';
  EXCEPTION WHEN SQLSTATE 'P0429' THEN NULL; END;

  -- 10. recipients read only their own message; phone numbers only for senders
  PERFORM set_config('request.jwt.claims', json_build_object('sub', co)::TEXT, true);
  BEGIN PERFORM public.bm_manual_contacts(gen_random_uuid()); RAISE EXCEPTION 'phones leaked';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'Feature R checks passed';
END $$;

-- Service-only worker functions are not callable by signed-in users or the public.
DO $$ BEGIN
  IF has_function_privilege('authenticated', 'public.bm_claim(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bm_finish(jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.bm_preview(jsonb,text,uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'worker or preview functions are public';
  END IF;
END $$;
ROLLBACK;
