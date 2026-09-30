-- Smart SAP Connect — security regression suite
-- Run in the Supabase SQL editor. It creates synthetic users/rows inside ONE transaction, exercises the security guards and the main
-- workflows as anon / authenticated / service_role, and ALWAYS ends with RAISE EXCEPTION so that everything is rolled back.
-- The error message lists the results: any line containing '(BAD)' or 'ERROR' is a regression.
-- Run it after every migration that touches policies, triggers or grants.

DO $dry$
DECLARE
  _log text := '';
  _r   text;
  _rc  text;
  _st  text;
  a   uuid := gen_random_uuid();
  v   uuid := gen_random_uuid();
  c   uuid := gen_random_uuid();
  adm uuid := gen_random_uuid();
  x   uuid := gen_random_uuid();
  y   uuid := gen_random_uuid();
  z   uuid := gen_random_uuid();
  tv  uuid := gen_random_uuid();
  ta  uuid := gen_random_uuid();
  iv  uuid := gen_random_uuid();
  sid uuid := gen_random_uuid();
  sid2 uuid := gen_random_uuid();
  ce  uuid := gen_random_uuid();
  tk  uuid := gen_random_uuid();
  rf  uuid := gen_random_uuid();
  ig  uuid := gen_random_uuid();
  pid uuid := gen_random_uuid();
  pr  uuid := gen_random_uuid();
  mr  uuid := gen_random_uuid();
  ti  uuid := gen_random_uuid();
  sc  uuid := gen_random_uuid();
  rfu uuid := gen_random_uuid();
  sc2 uuid := gen_random_uuid();
  pr2 uuid := gen_random_uuid();
  ts1 uuid := gen_random_uuid();
  pj  uuid := gen_random_uuid();
  ms  uuid := gen_random_uuid();
  tk2 uuid := gen_random_uuid();
  cid uuid;
BEGIN
  SET LOCAL lock_timeout = '5s';
  SET LOCAL statement_timeout = '120s';

  -- a = attacker client, v = victim client, c = consultant, adm = admin, x/y/z = signup-metadata probes
  INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
    (a,   'dry_a_'   || a   || '@example.test', '{"role":"client","display_name":"A"}'),
    (v,   'dry_v_'   || v   || '@example.test', '{"role":"client","display_name":"V"}'),
    (c,   'dry_c_'   || c   || '@example.test', '{"role":"consultant","display_name":"C"}'),
    (adm, 'dry_adm_' || adm || '@example.test', '{"role":"client","display_name":"ADM"}'),
    (x,   'dry_x_'   || x   || '@example.test', '{"role":"admin","display_name":"X"}'),
    (y,   'dry_y_'   || y   || '@example.test', '{"role":"super_admin","display_name":"Y"}'),
    (z,   'dry_z_'   || z   || '@example.test', '{"role":"Consultant","display_name":"Z"}');
  INSERT INTO public.user_roles (user_id, role) VALUES (adm, 'admin');

  SELECT string_agg(role::text, ',') INTO _r FROM public.user_roles WHERE user_id = x;
  _log := _log || 'T1a signup metadata role=admin       -> roles: ' || COALESCE(_r, 'none') || E'   (expect client)\n';
  SELECT string_agg(role::text, ',') INTO _r FROM public.user_roles WHERE user_id = y;
  _log := _log || 'T1b signup metadata role=super_admin -> roles: ' || COALESCE(_r, 'none') || E'   (expect client)\n';
  SELECT string_agg(role::text, ',') INTO _r FROM public.user_roles WHERE user_id = z;
  _log := _log || 'T1c signup metadata role=Consultant  -> roles: ' || COALESCE(_r, 'none') || E'   (expect consultant)\n';
  SELECT count(*)::text INTO _r FROM public.consultants WHERE user_id = z;
  _log := _log || 'T1d consultant row created: ' || _r || E'   (expect 1)\n';

  SELECT string_agg(f || ' = ' || CASE WHEN has_function_privilege('anon', f, 'EXECUTE') THEN 'ANON' ELSE 'no-anon' END
                      || ' / ' || CASE WHEN has_function_privilege('authenticated', f, 'EXECUTE') THEN 'AUTH' ELSE 'no-auth' END
                      || ' / ' || CASE WHEN has_function_privilege('service_role', f, 'EXECUTE') THEN 'service' ELSE 'NO-SERVICE' END, E'\n   ')
    INTO _r
  FROM unnest(ARRAY[
    'public.enqueue_email(text,jsonb)', 'public.read_email_batch(text,integer,integer)',
    'public.delete_email(text,bigint)', 'public.move_to_dlq(text,text,bigint,jsonb)',
    'public.check_rate_limit(text,integer,integer)',
    'public.safe_insert_notification(uuid,text,text,text,text)',
    'public.admin_confirm_reschedule_slot(uuid,integer,text)', 'public.retry_failed_notification(uuid)',
    'public.get_integration_credentials(uuid)', 'public.get_vmware_settings_safe(uuid)',
    'public.get_user_tenant_id()', 'public.has_role(uuid,public.app_role)',
    'public.get_demo_request_by_token(text)', 'public.request_demo_reschedule(text,jsonb,text)',
    'public.submit_demo_request(text,text,date,text,text,text,text,text,text,text,text)'
  ]) AS f;
  _log := _log || E'T2 EXECUTE grants:\n   ' || _r || E'\n';

  SELECT count(*)::text INTO _r
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype
    AND p.proname NOT IN ('handle_new_user','process_referral_signup')
    AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  _log := _log || 'T2b trigger functions still executable by anon/authenticated: ' || _r || E'   (expect 0)\n';

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.read_email_batch('auth_emails', 1, 1);
    _log := _log || E'T2c anon read_email_batch -> ALLOWED (BAD)\n';
  EXCEPTION WHEN insufficient_privilege THEN _log := _log || E'T2c anon read_email_batch -> denied (ok)\n';
            WHEN OTHERS THEN _log := _log || 'T2c anon read_email_batch -> ' || SQLERRM || E'\n'; END;
  BEGIN
    PERFORM public.enqueue_email('auth_emails', '{"x":1}'::jsonb);
    _log := _log || E'T2d anon enqueue_email -> ALLOWED (BAD)\n';
  EXCEPTION WHEN insufficient_privilege THEN _log := _log || E'T2d anon enqueue_email -> denied (ok)\n';
            WHEN OTHERS THEN _log := _log || 'T2d anon enqueue_email -> ' || SQLERRM || E'\n'; END;
  BEGIN
    PERFORM public.safe_insert_notification(v, 'phish', 'click', 'x', 'https://evil.test');
    _log := _log || E'T2e anon safe_insert_notification -> ALLOWED (BAD)\n';
  EXCEPTION WHEN insufficient_privilege THEN _log := _log || E'T2e anon safe_insert_notification -> denied (ok)\n';
            WHEN OTHERS THEN _log := _log || 'T2e anon safe_insert_notification -> ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.demo_requests (demo_type, scheduling_preference, full_name, email, status)
    VALUES ('live', 'asap', 'Dry Run', 'dry_direct@example.test', 'received') RETURNING request_token INTO _r;
    _log := _log || E'T2f anon direct INSERT..RETURNING request_token -> worked\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T2f anon direct INSERT..RETURNING request_token -> FAILS: ' || SQLERRM || E'   (expected: the wizard must use submit_demo_request)\n'; END;
  BEGIN
    _r := public.submit_demo_request('live','asap',NULL,NULL,'UTC','video','Dry Run','Dry_RPC@Example.test','Co','n');
    _log := _log || 'T2g anon submit_demo_request -> token length ' || length(_r) || E'   (expect 32)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T2g anon submit_demo_request -> ERROR ' || SQLERRM || E'\n'; END;
  BEGIN
    PERFORM public.submit_demo_request('live','asap',NULL,NULL,'UTC','video','Dry Run','not-an-email','Co','n');
    _log := _log || E'T2h invalid email -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T2h invalid email -> rejected: ' || SQLERRM || E'\n'; END;
  BEGIN
    PERFORM public.check_rate_limit('x', 1, 60);
    _log := _log || E'T2i anon check_rate_limit -> ALLOWED (BAD)\n';
  EXCEPTION WHEN insufficient_privilege THEN _log := _log || E'T2i anon check_rate_limit -> denied (ok)\n';
            WHEN OTHERS THEN _log := _log || 'T2i anon check_rate_limit -> ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  PERFORM public.submit_demo_request('live','asap',NULL,NULL,'UTC','video','Dry Run','throttle@example.test','Co','n');
  PERFORM public.submit_demo_request('live','asap',NULL,NULL,'UTC','video','Dry Run','throttle@example.test','Co','n');
  PERFORM public.submit_demo_request('live','asap',NULL,NULL,'UTC','video','Dry Run','throttle@example.test','Co','n');
  BEGIN
    PERFORM public.submit_demo_request('live','asap',NULL,NULL,'UTC','video','Dry Run','throttle@example.test','Co','n');
    _log := _log || E'T2j 4th demo request same email -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T2j 4th demo request same email -> throttled: ' || SQLERRM || E'\n'; END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.tenants (id, name, slug) VALUES (tv, 'Victim Org', 'victim-' || tv);
    _log := _log || E'T3-setup victim creates tenant (owner row not yet inserted) -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T3-setup victim creates tenant -> ERROR ' || SQLERRM || E'\n'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  BEGIN
    INSERT INTO public.tenant_members (tenant_id, user_id, org_role) VALUES (tv, a, 'owner');
    _log := _log || E'T3a attacker claims victim orphan tenant as owner -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T3a attacker claims victim orphan tenant -> blocked: ' || SQLERRM || E'\n'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  BEGIN
    INSERT INTO public.tenant_members (tenant_id, user_id, org_role) VALUES (tv, v, 'owner');
    _log := _log || E'T3b victim bootstraps own tenant ownership -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T3b victim bootstraps own tenant -> ERROR ' || SQLERRM || E'\n'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  BEGIN
    INSERT INTO public.tenant_members (tenant_id, user_id, org_role) VALUES (tv, a, 'owner');
    _log := _log || E'T3c attacker joins victim tenant (has members) as owner -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T3c attacker joins victim tenant as owner -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.tenant_members (tenant_id, user_id, org_role) VALUES (tv, a, 'member');
    _log := _log || E'T3d attacker joins victim tenant as member -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T3d attacker joins victim tenant as member -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.tenants (id, name, slug, created_by, subscription_tier, max_users, ai_quota)
    VALUES (ta, 'Attacker Org', 'attacker-' || ta, v, 'enterprise', 99999, 99999);
    _log := _log || E'T3e-setup attacker creates tenant with spoofed fields -> accepted (values normalised below)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T3e-setup attacker creates tenant -> ERROR ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  SELECT (created_by = a)::text || ' tier=' || subscription_tier::text || ' max_users=' || max_users || ' ai_quota=' || ai_quota
    INTO _r FROM public.tenants WHERE id = ta;
  _log := _log || 'T3e stored -> created_by_is_attacker=' || COALESCE(_r, 'ROW MISSING') || E'   (expect true basic 5 50)\n';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.tenant_members (tenant_id, user_id, org_role) VALUES (ta, a, 'owner');
    _log := _log || E'T3f attacker bootstraps own tenant -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T3f attacker bootstraps own tenant -> ERROR ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.tenants SET subscription_tier = 'enterprise', max_users = 9999 WHERE id = ta;
    _log := _log || E'T3g owner edits subscription/quota -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T3g owner edits subscription/quota -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.tenants SET name = 'Renamed Org' WHERE id = ta;
    _log := _log || E'T3h owner renames tenant -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T3h owner renames tenant -> ERROR ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  SELECT id INTO cid FROM public.consultants WHERE user_id = c;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.consultants SET bio = 'Senior SAP FI consultant', hourly_rate = 120 WHERE user_id = c;
    _log := _log || E'T4a consultant edits bio/hourly_rate -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T4a consultant edits bio -> ERROR ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.consultants SET verification_status = 'verified' WHERE user_id = c;
    _log := _log || E'T4b consultant self-verifies -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T4b consultant self-verifies -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.consultants SET credibility_credits = 999 WHERE user_id = c;
    _log := _log || E'T4c consultant sets credits -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T4c consultant sets credits -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.consultants SET rating = 5, total_reviews = 500 WHERE user_id = c;
    _log := _log || E'T4d consultant sets rating -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T4d consultant sets rating -> blocked: ' || SQLERRM || E'\n'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  BEGIN
    INSERT INTO public.consultants (user_id, verification_status, rating, credibility_credits, ai_interview_badge)
    VALUES (a, 'verified', 5, 500, 'Gold');
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T4e-setup insert pre-verified consultant -> ERROR ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  SELECT verification_status::text || ' rating=' || rating || ' credits=' || credibility_credits || ' badge=' || COALESCE(ai_interview_badge, 'null')
    INTO _r FROM public.consultants WHERE user_id = a;
  _log := _log || 'T4e non-admin INSERT of pre-verified consultant -> stored: ' || COALESCE(_r, 'ROW MISSING') || E'   (expect pending rating=0 credits=0 badge=null)\n';
  DELETE FROM public.consultants WHERE user_id = a;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', adm::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.consultants SET verification_status = 'verified' WHERE id = cid;
    _log := _log || E'T4f admin verifies consultant -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T4f admin verifies consultant -> ERROR ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.consultants (user_id, bio, verification_status) VALUES (c, 'b2', 'pending')
    ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio, verification_status = EXCLUDED.verification_status;
    _log := _log || E'T4g upsert WITH verification_status on an already-verified consultant -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T4g upsert WITH verification_status on already-verified consultant -> blocked (the front-end must not send that key): ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.consultants (user_id, bio) VALUES (c, 'b3')
    ON CONFLICT (user_id) DO UPDATE SET bio = EXCLUDED.bio;
    _log := _log || E'T4h upsert WITHOUT verification_status -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T4h upsert WITHOUT verification_status -> ERROR ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.interview_sessions (id, consultant_id, status, overall_score, interview_type)
    VALUES (iv, cid, 'completed', 100, 'ai');
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T5a-setup consultant inserts interview -> ERROR ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  SELECT status::text || ' score=' || COALESCE(overall_score::text, 'null') INTO _r FROM public.interview_sessions WHERE id = iv;
  _log := _log || 'T5a consultant inserts interview as completed/100 -> stored: ' || COALESCE(_r, 'ROW MISSING') || E'   (expect pending score=null)\n';
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.interview_sessions SET status = 'completed', overall_score = 100 WHERE id = iv;
    _log := _log || E'T5b consultant completes own interview -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T5b consultant completes own interview -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.interview_sessions SET skill_results = '[{"role":"user","content":"hi"}]'::jsonb WHERE id = iv;
    _log := _log || E'T5c consultant autosaves transcript -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T5c consultant autosaves transcript -> ERROR ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.interview_sessions SET status = 'in_progress' WHERE id = iv;
    _log := _log || E'T5d consultant marks interview in_progress -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T5d consultant marks in_progress -> ERROR ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  UPDATE public.consultants SET credibility_credits = 0, ai_interview_completed_at = NULL, ai_interview_badge = NULL WHERE id = cid;
  SET LOCAL ROLE service_role;
  BEGIN
    UPDATE public.interview_sessions SET status = 'completed', overall_score = 90, completed_at = now() WHERE id = iv;
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T5e-setup service_role completes interview -> ERROR ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  SELECT credibility_credits || ' ' || COALESCE(ai_interview_badge, 'null') INTO _r FROM public.consultants WHERE id = cid;
  _log := _log || 'T5e service_role completes interview (definer reward trigger) -> credits/badge: ' || _r || E'   (expect 150 Gold)\n';

  INSERT INTO public.sessions (id, client_id, consultant_id, status) VALUES (sid, a, cid, 'scheduled');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ratings (session_id, client_id, consultant_id, score) VALUES (sid, a, cid, 5);
    _log := _log || E'T6a rating on a not-completed session -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T6a rating on not-completed session -> blocked: ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  UPDATE public.sessions SET status = 'completed' WHERE id = sid;
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ratings (session_id, client_id, consultant_id, score) VALUES (sid, a, cid, 4);
    _log := _log || E'T6b rating on own completed session -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T6b rating on own completed session -> ERROR ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.ratings (session_id, client_id, consultant_id, score) VALUES (sid, a, cid, 5);
    _log := _log || E'T6c duplicate rating -> ALLOWED (BAD)\n';
  EXCEPTION WHEN unique_violation THEN _log := _log || E'T6c duplicate rating -> blocked (unique) ok\n';
            WHEN OTHERS THEN _log := _log || 'T6c duplicate rating -> ' || SQLERRM || E'\n'; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v::text, true);
  BEGIN
    INSERT INTO public.ratings (session_id, client_id, consultant_id, score) VALUES (sid, v, cid, 1);
    _log := _log || E'T6d other client rates someone else session -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T6d other client rates someone else session -> blocked: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.certifications (id, consultant_id, name, issuer, verified) VALUES (ce, cid, 'SAP S/4HANA Finance', 'SAP', true);
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T7a-setup insert certification -> ERROR ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  SELECT verified::text INTO _r FROM public.certifications WHERE id = ce;
  _log := _log || 'T7a consultant inserts certification verified=true -> stored verified=' || COALESCE(_r, 'ROW MISSING') || E'   (expect false)\n';
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.certifications SET verified = true WHERE id = ce;
    _log := _log || E'T7b consultant marks certification verified -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T7b consultant marks certification verified -> blocked: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.tickets (id, client_id, title, sap_module, ticket_type) VALUES (tk, a, 'Dry run ticket', 'FI', 'standard');
    UPDATE public.tickets SET title = 'Dry run ticket (edited)', status = 'resolved' WHERE id = tk;
    _log := _log || E'T8a client creates + edits own ticket title/status -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8a client creates/edits own ticket -> ERROR ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.tickets SET sla_breached = true WHERE id = tk;
    _log := _log || E'T8b client edits sla_breached -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8b client edits sla_breached -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.sessions SET status = 'cancelled', notes = 'n' WHERE id = sid;
    _log := _log || E'T8c participant edits session status/notes -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8c participant edits session -> ERROR ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.sessions SET consultant_id = (SELECT id FROM public.consultants WHERE user_id = z) WHERE id = sid;
    _log := _log || E'T8d participant re-points session consultant -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8d participant re-points session consultant -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.referrals (id, referrer_id, referral_code, referred_email) VALUES (rf, a, 'DRYCODE', 'friend@example.test');
    UPDATE public.referrals SET status = 'rewarded' WHERE id = rf;
    _log := _log || E'T8e referrer sets status=rewarded -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8e referrer sets status=rewarded -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.profiles SET referral_code = 'STOLEN' WHERE user_id = a;
    _log := _log || E'T8f user changes referral_code -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8f user changes referral_code -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.profiles SET display_name = 'Renamed' WHERE user_id = a;
    _log := _log || E'T8g user edits display_name -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8g user edits display_name -> ERROR ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.knowledge_articles (title, content, author_id, status) VALUES ('Spam', 'buy now', a, 'published');
    _log := _log || E'T8h user publishes KB article -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8h user publishes KB article -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.integrations (client_id, platform, platform_url, api_key_encrypted) VALUES (a, 'zendesk', 'http://169.254.169.254/latest', 'x');
    _log := _log || E'T8i integration with http://169.254... -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8i integration with http:// url -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.integrations (client_id, platform, platform_url, api_key_encrypted) VALUES (a, 'zendesk', 'https://user:pw@acme.zendesk.com', 'x');
    _log := _log || E'T8j integration with credentials in url -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8j integration with credentials in url -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.integrations (id, client_id, platform, platform_url, api_key_encrypted) VALUES (ig, a, 'zendesk', 'https://acme.zendesk.com', 'x');
  EXCEPTION WHEN OTHERS THEN _log := _log || 'T8k-setup valid integration insert -> ERROR ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  SELECT length(webhook_secret)::text INTO _r FROM public.integrations WHERE id = ig;
  _log := _log || 'T8k valid integration insert -> auto webhook_secret length ' || COALESCE(_r, 'ROW MISSING') || E'   (expect 64)\n';

  SET LOCAL ROLE service_role;
  _r := public.check_rate_limit('dry:bucket', 2, 60)::text || ',' || public.check_rate_limit('dry:bucket', 2, 60)::text || ',' || public.check_rate_limit('dry:bucket', 2, 60)::text;
  RESET ROLE;
  _log := _log || 'T9 service_role check_rate_limit x3 (limit 2) -> ' || _r || E'   (expect true,true,false)\n';

  SELECT count(*)::text INTO _r FROM public.user_roles WHERE user_id IN (a, v) AND role::text = 'client';
  _log := _log || 'T10 normal client signups got client role: ' || _r || E'   (expect 2)\n';

  -- =================== WORKFLOW SMOKE TESTS (existing flows must keep working) ===================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  FOREACH _st IN ARRAY ARRAY['under_review','matched','in_progress','waiting_for_client','resolved','closed'] LOOP
    BEGIN
      UPDATE public.tickets SET status = _st::public.ticket_status WHERE id = tk;
      _log := _log || 'S1 ticket status -> ' || _st || E' ok\n';
    EXCEPTION WHEN OTHERS THEN _log := _log || 'S1 ticket status -> ' || _st || ' ERROR: ' || SQLERRM || E'\n'; END;
  END LOOP;
  BEGIN
    UPDATE public.tickets SET consultant_id = cid, status = 'in_progress' WHERE id = tk;
    _log := _log || E'S1b client assigns consultant + in_progress (accept-proposal path) -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S1b assign consultant -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.tickets SET sla_breached = true WHERE id = tk;
    _log := _log || E'S1c client edits sla_breached -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S1c client edits sla_breached -> blocked: ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  SELECT count(*)::text INTO _r FROM public.playbooks WHERE source_ticket_id = tk;
  _log := _log || 'S1d playbook auto-created on resolve/close: ' || _r || E'   (expect 1)\n';
  SELECT count(*)::text INTO _r FROM public.notifications WHERE user_id = a AND title = 'Ticket Status Update';
  _log := _log || 'S1e client status-update notifications: ' || _r || E'   (expect >= 6)\n';

  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.sessions (id, client_id, consultant_id, status, scheduled_at)
    VALUES (sid2, a, cid, 'scheduled', now() + interval '1 day');
    _log := _log || E'S2a client books a session -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S2a client books a session -> ERROR: ' || SQLERRM || E'\n'; END;
  FOREACH _st IN ARRAY ARRAY['in_progress','completed'] LOOP
    BEGIN
      UPDATE public.sessions SET status = _st::public.session_status WHERE id = sid2;
      _log := _log || 'S2 session status -> ' || _st || E' ok\n';
    EXCEPTION WHEN OTHERS THEN _log := _log || 'S2 session status -> ' || _st || ' ERROR: ' || SQLERRM || E'\n'; END;
  END LOOP;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', adm::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.payments (id, client_id, consultant_id, amount, status) VALUES (pid, a, cid, 100, 'pending');
    UPDATE public.payments SET status = 'completed' WHERE id = pid;
    _log := _log || E'S3 admin creates + completes payment -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S3 payment flow -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, nda_content) VALUES (cid, a, 'sig', 'nda text');
    _log := _log || E'S4 consultant signs NDA -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S4 NDA -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.proposals (id, ticket_id, consultant_id) VALUES (pr, tk, cid);
    _log := _log || E'S13a consultant submits proposal -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S13a proposal -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.proposals SET status = 'accepted' WHERE id = pr;
    _log := _log || E'S13b client accepts proposal -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S13b accept proposal -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.ticket_match_requests (id, ticket_id, consultant_id, sent_by) VALUES (mr, tk, cid, a);
    _log := _log || E'S5a client sends match request -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S5a match request -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.ticket_interviews (id, ticket_id, client_id, consultant_id) VALUES (ti, tk, a, cid);
    _log := _log || E'S6a client requests ticket interview -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S6a ticket interview -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.satisfaction_surveys (rated_by, rated_user, role) VALUES (a, c, 'client');
    _log := _log || E'S7 satisfaction survey -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S7 satisfaction survey -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.shared_remote_configs (id, client_id, consultant_id, tool_type) VALUES (sc, a, cid, 'anydesk');
    _log := _log || E'S8a client shares remote config -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S8a shared config -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.error_reports (message, level, user_id) VALUES ('dry-run error', 'error', a);
    _log := _log || E'S9 client error report (notifies admins) -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S9 error report -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.remote_environments (name, guacamole_url, client_id) VALUES ('Dry env', 'https://guac.example.test', a);
    _log := _log || E'S10 client creates remote environment -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S10 remote environment -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.remote_environments (name, guacamole_url, client_id) VALUES ('Evil env', 'javascript:alert(document.domain)', a);
    _log := _log || E'S10b client creates remote environment with javascript: URL -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S10b remote environment with javascript: URL -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.business_processes (client_id, name) VALUES (a, 'Order to Cash');
    _log := _log || E'S11 client creates business process -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S11 business process -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.ticket_match_requests SET status = 'accepted' WHERE id = mr;
    _log := _log || E'S5b consultant accepts match request -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S5b accept match request -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.shared_remote_configs SET status = 'accepted', accepted_at = now() WHERE id = sc;
    _log := _log || E'S8b consultant accepts shared config -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S8b accept shared config -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.consultants SET linkedin_url = 'linkedin.com/in/dry-run', personal_website = 'example.org' WHERE id = cid;
    SELECT linkedin_url || ' | ' || personal_website INTO _r FROM public.consultants WHERE id = cid;
    _log := _log || 'S15 consultant saves scheme-less profile links -> ' || _r || E'   (expect https:// prefixes)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S15 consultant profile links -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.consultants SET linkedin_url = 'javascript:alert(1)' WHERE id = cid;
    _log := _log || E'S15b consultant saves javascript: link -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'S15b consultant javascript: link -> blocked: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  -- S12 referral signup must still reward both sides (definer trigger updates referrals as owner)
  SELECT referral_code INTO _rc FROM public.profiles WHERE user_id = a;
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (rfu, 'dry_ref_' || rfu || '@example.test', json_build_object('role', 'client', 'display_name', 'R', 'referral_code', _rc)::jsonb);
  SELECT string_agg(status, ',') INTO _r FROM public.referrals WHERE referred_user_id = rfu;
  _log := _log || 'S12a referral signup -> referral status: ' || COALESCE(_r, 'NONE') || E'   (expect rewarded)\n';
  SELECT count(*)::text INTO _r FROM public.referral_rewards WHERE user_id IN (a, rfu);
  _log := _log || 'S12b referral rewards created: ' || _r || E'   (expect 2)\n';

  SELECT count(*)::text INTO _r FROM public.consultant_verification_audit WHERE consultant_id = cid;
  _log := _log || 'S14 verification audit rows for consultant: ' || _r || E'   (expect >= 1)\n';

  -- =================== ADDITIONAL GUARD TESTS ===================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.shared_remote_configs (client_id, consultant_id, tool_type, config)
    VALUES (a, cid, 'rdp', jsonb_build_object('connectionId', E'host.example.com\nfull address:s:evil\ndrivestoredirect:s:*'));
    _log := _log || E'U1a share config with newline-injected connectionId -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U1a newline-injected connectionId -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.shared_remote_configs (client_id, consultant_id, tool_type, config)
    VALUES (a, cid, 'teamviewer', jsonb_build_object('connectionId', '123&command=evil'));
    _log := _log || E'U1b share config with URL-injection connectionId -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U1b URL-injection connectionId -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.shared_remote_configs (id, client_id, consultant_id, tool_type, config)
    VALUES (sc2, a, cid, 'anydesk', jsonb_build_object('connectionId', '123456789', 'alias', 'SAP PRD'));
    _log := _log || E'U1c share config with valid connectionId -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U1c valid config -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    INSERT INTO public.shared_remote_configs (client_id, consultant_id, tool_type, config)
    VALUES (a, cid, 'anydesk', jsonb_build_object('connectionId', '', 'alias', 'blank'));
    _log := _log || E'U1d share config with blank connectionId (legacy UI behaviour) -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U1d blank connectionId -> ERROR: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.shared_remote_configs SET status = 'revoked', revoked_at = now() WHERE id = sc2;
    _log := _log || E'U1e client revokes own shared config -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U1e revoke -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.shared_remote_configs SET client_id = v WHERE id = sc;
    _log := _log || E'U1f consultant re-points shared config to another client -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U1f consultant re-points config -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.shared_remote_configs SET config = jsonb_build_object('connectionId', '999999999') WHERE id = sc;
    _log := _log || E'U1g consultant rewrites shared config -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U1g consultant rewrites config -> blocked: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.proposals (id, ticket_id, consultant_id, status, client_notes) VALUES (pr2, tk, cid, 'accepted', 'pre-accepted');
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U2a-setup consultant inserts proposal -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  SELECT status::text || ' notes=' || COALESCE(client_notes, 'null') INTO _r FROM public.proposals WHERE id = pr2;
  _log := _log || 'U2a consultant inserts proposal as accepted -> stored: ' || COALESCE(_r, 'ROW MISSING') || E'   (expect pending notes=null)\n';
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.proposals SET status = 'accepted' WHERE id = pr2;
    _log := _log || E'U2b consultant self-accepts proposal -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U2b consultant self-accepts proposal -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.proposals SET status = 'withdrawn' WHERE id = pr2;
    _log := _log || E'U2c consultant withdraws proposal -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U2c withdraw -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ticket_timesheet_submissions (id, ticket_id, submitted_by, status, signed_at, signed_by_name, signature_data)
    VALUES (ts1, tk, c, 'submitted', now(), 'Forged Client', 'data:image/png;base64,AAAA');
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U3a-setup submitter inserts timesheet -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  SELECT COALESCE(signed_at::text, 'null') || ' / ' || COALESCE(signed_by_name, 'null') INTO _r FROM public.ticket_timesheet_submissions WHERE id = ts1;
  _log := _log || 'U3a submitter inserts timesheet with forged signature -> stored signed_at/name: ' || COALESCE(_r, 'ROW MISSING') || E'   (expect null / null)\n';
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.ticket_timesheet_submissions SET status = 'approved' WHERE id = ts1;
    _log := _log || E'U3b submitter approves own timesheet -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U3b submitter approves own timesheet -> blocked: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  INSERT INTO public.projects (id, client_id, consultant_id, title) VALUES (pj, a, cid, 'Dry project');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.milestones (id, project_id, title, amount, escrow_status) VALUES (ms, pj, 'M1', 1000, 'funded');
    _log := _log || E'U4a project client creates funded milestone -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U4a client creates milestone -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.milestones SET escrow_status = 'released', released_at = now() WHERE id = ms;
    _log := _log || E'U4b consultant releases escrow -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U4b consultant releases escrow -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.milestones SET amount = 999999 WHERE id = ms;
    _log := _log || E'U4c consultant changes milestone amount -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U4c consultant changes amount -> blocked: ' || SQLERRM || E'\n'; END;
  BEGIN
    UPDATE public.milestones SET escrow_status = 'submitted', submitted_at = now() WHERE id = ms;
    _log := _log || E'U4d consultant submits funded milestone -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U4d consultant submits milestone -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', a::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', a::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.milestones SET escrow_status = 'approved', approved_at = now() WHERE id = ms;
    UPDATE public.milestones SET escrow_status = 'released', released_at = now() WHERE id = ms;
    _log := _log || E'U4e project client approves + releases -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U4e client approves/releases -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', c::text, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', c::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ticket_work_logs (ticket_id, consultant_id, work_date, hours, description) VALUES (tk, cid, current_date, 1.5, 'assigned ticket');
    _log := _log || E'U5a consultant logs time on an assigned ticket -> ok\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U5a log on assigned ticket -> ERROR: ' || SQLERRM || E'\n'; END;
  RESET ROLE;
  INSERT INTO public.tickets (id, client_id, title, sap_module, ticket_type) VALUES (tk2, v, 'Someone else ticket', 'MM', 'standard');
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.ticket_work_logs (ticket_id, consultant_id, work_date, hours, description) VALUES (tk2, cid, current_date, 40, 'padding another client bill');
    _log := _log || E'U5b consultant logs time on a ticket not assigned to them -> ALLOWED (BAD)\n';
  EXCEPTION WHEN OTHERS THEN _log := _log || 'U5b log on unassigned ticket -> blocked: ' || SQLERRM || E'\n'; END;
  RESET ROLE;

  RAISE EXCEPTION E'DRYRUN RESULTS (transaction rolled back)\n%', _log;

END
$dry$;
