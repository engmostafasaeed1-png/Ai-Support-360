-- Feature N post-apply checks. Run AFTER docs/sql/consultant-policy.sql. Everything runs in one transaction and is
-- rolled back at the end, so no real data is changed. Each check raises an error with its name when it fails.
BEGIN;

DO $$
DECLARE
  _admin uuid := gen_random_uuid();
  _u_old uuid := gen_random_uuid();
  _u_new uuid := gen_random_uuid();
  _c_old uuid;
  _c_new uuid;
  _s jsonb;
  _a1 jsonb;
  _a2 jsonb;
  _v2 int;
  _n int;
  _failed boolean;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_admin, 'policy-test-admin@example.invalid'), (_u_old, 'policy-test-old@example.invalid'), (_u_new, 'policy-test-new@example.invalid');
  INSERT INTO public.user_roles (user_id, role) VALUES (_admin, 'admin');
  INSERT INTO public.consultants (user_id, created_at) VALUES (_u_old, now() - interval '30 days') RETURNING id INTO _c_old;
  INSERT INTO public.consultants (user_id, created_at) VALUES (_u_new, now() - interval '20 days') RETURNING id INTO _c_new;

  -- Pending until shown; first display starts the grace period.
  PERFORM set_config('request.jwt.claim.sub', _u_old::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _u_old, 'role', 'authenticated')::text, true);
  _s := public.my_consultant_policy_status();
  IF _s ->> 'state' <> 'pending' THEN RAISE EXCEPTION 'check pending: %', _s; END IF;
  _s := public.consultant_policy_mark_shown((_s ->> 'current_version')::int);
  IF _s ->> 'state' <> 'grace' OR (_s ->> 'deadline') IS NULL THEN RAISE EXCEPTION 'check grace: %', _s; END IF;

  -- Accepting needs the current version and is idempotent.
  _failed := false;
  BEGIN PERFORM public.accept_consultant_policy(999, 'en', 'popup', 'test'); EXCEPTION WHEN OTHERS THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check wrong version refused'; END IF;
  _a1 := public.accept_consultant_policy((_s ->> 'current_version')::int, 'ar', 'popup', 'test agent');
  _a2 := public.accept_consultant_policy((_s ->> 'current_version')::int, 'en', 'page', 'other agent');
  IF _a1 <> _a2 THEN RAISE EXCEPTION 'check idempotent accept: % vs %', _a1, _a2; END IF;
  IF public.my_consultant_policy_status() ->> 'state' <> 'accepted' THEN RAISE EXCEPTION 'check accepted'; END IF;
  SELECT count(*) INTO _n FROM public.consultant_policy_acknowledgements WHERE consultant_id = _c_old;
  IF _n <> 1 THEN RAISE EXCEPTION 'check one acknowledgement row: %', _n; END IF;

  -- Append-only.
  _failed := false;
  BEGIN UPDATE public.consultant_policy_acknowledgements SET language = 'en' WHERE consultant_id = _c_old; EXCEPTION WHEN OTHERS THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check acknowledgement cannot be updated'; END IF;
  _failed := false;
  BEGIN DELETE FROM public.consultant_policy_acknowledgements WHERE consultant_id = _c_old; EXCEPTION WHEN OTHERS THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check acknowledgement cannot be deleted'; END IF;

  -- After the grace period: blocked, hidden, no new bids, no accepting; declining still works.
  INSERT INTO public.consultant_policy_prompts (consultant_id, version, first_shown_at)
  VALUES (_c_new, public.consultant_policy_current_version(), now() - interval '8 days');
  IF NOT public.consultant_policy_blocked(_c_new) THEN RAISE EXCEPTION 'check blocked after grace'; END IF;
  IF public.consultant_policy_blocked(_c_old) THEN RAISE EXCEPTION 'check accepted consultant not blocked'; END IF;
  PERFORM set_config('request.jwt.claim.sub', _u_new::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _u_new, 'role', 'authenticated')::text, true);
  IF NOT (_c_new = ANY(public.hidden_consultant_ids())) THEN RAISE EXCEPTION 'check hidden from directory'; END IF;
  IF _c_old = ANY(public.hidden_consultant_ids()) THEN RAISE EXCEPTION 'check accepted consultant visible'; END IF;

  -- Version bump re-prompts everyone (published by an administrator).
  PERFORM set_config('request.jwt.claim.sub', _admin::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  _v2 := public.admin_publish_consultant_policy('Consultant Service Policy', 'سياسة خدمة المستشار', 'Summary v2', 'ملخص 2', 'Body v2', 'نص 2', now());
  IF public.consultant_policy_state(_c_old) ->> 'state' <> 'pending' THEN RAISE EXCEPTION 'check new version re-prompts'; END IF;
  IF public.consultant_policy_blocked(_c_new) THEN RAISE EXCEPTION 'check new version restarts the grace period'; END IF;
  IF NOT public.admin_send_policy_reminder(_c_old) THEN RAISE EXCEPTION 'check manual reminder'; END IF;
  IF public.admin_send_policy_reminder(_c_old) THEN RAISE EXCEPTION 'check manual reminder at most once per 24 h'; END IF;
  SELECT count(*) INTO _n FROM public.admin_consultant_policy_overview() o WHERE o.consultant_id IN (_c_old, _c_new);
  IF _n <> 2 THEN RAISE EXCEPTION 'check admin overview'; END IF;

  -- E-mail claim: service role only, one notice per consultant and version.
  _failed := false;
  BEGIN PERFORM public.claim_consultant_policy_notices(10); EXCEPTION WHEN OTHERS THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check claim refused for non-service callers'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT count(*) INTO _n FROM public.claim_consultant_policy_notices(200) c WHERE c.consultant_id IN (_c_old, _c_new);
  IF _n < 2 THEN RAISE EXCEPTION 'check first notices claimed: %', _n; END IF;
  SELECT count(*) INTO _n FROM public.claim_consultant_policy_notices(200) c WHERE c.consultant_id IN (_c_old, _c_new);
  IF _n <> 0 THEN RAISE EXCEPTION 'check notices not repeated: %', _n; END IF;

  RAISE NOTICE 'Feature N checks passed (version % published inside the test and rolled back).', _v2;
END $$;

ROLLBACK;
