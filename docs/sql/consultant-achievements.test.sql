-- Success stories checks. Run after consultant-roles.sql and consultant-achievements.sql; everything rolls back.
BEGIN;
DO $$
DECLARE cu uuid := gen_random_uuid(); ou uuid := gen_random_uuid(); au uuid := gen_random_uuid();
  c uuid; a uuid; b uuid; n int; i int;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (cu, cu||'@t.test'), (ou, ou||'@t.test'), (au, au||'@t.test');
  INSERT INTO consultants (user_id, verification_status) VALUES (cu, 'verified') RETURNING id INTO c;
  INSERT INTO consultants (user_id) VALUES (ou);
  INSERT INTO user_roles (user_id, role) VALUES (au, 'admin');
  INSERT INTO client_profiles (user_id, company_name) VALUES (ou, 'Zylotech Industries');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1 contact details and platform client names are rejected
  BEGIN PERFORM my_achievement_save(NULL, '{"title": "Close faster", "outcome": "Call me at +966 55 123 4567 for details"}');
    RAISE EXCEPTION 'FAIL 1 contact accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM <> 'achievement_contact_details' THEN RAISE; END IF; END;
  BEGIN PERFORM my_achievement_save(NULL, '{"title": "Rollout for Zylotech Industries", "outcome": "Cut month-end close from 8 to 4 days"}');
    RAISE EXCEPTION 'FAIL 1 client name accepted'; EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM <> 'achievement_client_name' THEN RAISE; END IF; END;
  BEGIN PERFORM my_achievement_save(NULL, '{"title": "Close faster", "outcome": "Cut month-end close from 8 to 4 days", "reference_url": "https://bit.ly/x"}');
    RAISE EXCEPTION 'FAIL 1 short link accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'PASS 1 filters';

  -- 2 private by default; only the owner sees it until "show on my public profile" is on
  a := my_achievement_save(NULL, '{"title": "Faster month-end close", "outcome": "Cut month-end close from 8 to 4 days", "role_played": "functional_lead", "industry": "Retail", "year": 2024}');
  IF (SELECT status FROM consultant_achievements WHERE id = a) <> 'self_declared' THEN RAISE EXCEPTION 'FAIL 2 not self-declared'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true);
  IF EXISTS (SELECT 1 FROM consultant_achievements WHERE id = a) THEN RAISE EXCEPTION 'FAIL 2 private entry visible'; END IF;
  BEGIN PERFORM my_achievement_set_public(a, true); RAISE EXCEPTION 'FAIL 2 other user switched it';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true);
  PERFORM my_achievement_set_public(a, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true);
  IF NOT EXISTS (SELECT 1 FROM consultant_achievements WHERE id = a) THEN RAISE EXCEPTION 'FAIL 2 public entry hidden'; END IF;
  BEGIN PERFORM evidence_path FROM consultant_achievements WHERE id = a; RAISE EXCEPTION 'FAIL 2 evidence column readable';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE consultant_achievements SET title = 'Hacked' WHERE id = a; RAISE EXCEPTION 'FAIL 2 direct write';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS 2 visibility switch and RPC-only writes';

  -- 3 at most 8 entries
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true);
  FOR i IN 2..8 LOOP PERFORM my_achievement_save(NULL, jsonb_build_object('title', 'Story ' || i, 'outcome', 'Reduced open incidents by ' || i || '0 %')); END LOOP;
  BEGIN PERFORM my_achievement_save(NULL, '{"title": "Ninth", "outcome": "One more measurable result"}');
    RAISE EXCEPTION 'FAIL 3 ninth accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'PASS 3 max eight';

  -- 4 admin hide needs a reason, is audited and removes the card from public view
  PERFORM set_config('request.jwt.claims', json_build_object('sub', au, 'role', 'authenticated')::text, true);
  BEGIN PERFORM admin_achievement_review(a, 'hide', ''); RAISE EXCEPTION 'FAIL 4 hide without reason';
    EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  PERFORM admin_achievement_review(a, 'hide', 'Mentions confidential figures');
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE entity_id = a AND action = 'achievement_hide') THEN RAISE EXCEPTION 'FAIL 4 not audited'; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true);
  IF EXISTS (SELECT 1 FROM consultant_achievements WHERE id = a) THEN RAISE EXCEPTION 'FAIL 4 hidden entry public'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true);
  BEGIN PERFORM admin_achievement_review(a, 'restore', NULL); RAISE EXCEPTION 'FAIL 4 owner reviewed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RAISE NOTICE 'PASS 4 admin hide audited';

  -- 5 completion counts success stories
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true);
  IF (consultant_completion(c) -> 'missing_items') ? 'Success stories' THEN RAISE EXCEPTION 'FAIL 5 stories not counted'; END IF;
  RAISE NOTICE 'PASS 5 completion item';
END $$;
ROLLBACK;
