-- Consultant roles checks. Run after consultant-roles.sql; everything rolls back.
BEGIN;
DO $$
DECLARE cu uuid := gen_random_uuid(); mu uuid := gen_random_uuid(); c uuid; m uuid; miss text[];
BEGIN
  INSERT INTO auth.users (id, email) VALUES (cu, cu||'@t.test'), (mu, mu||'@t.test');

  -- 1 legacy labels and old keys map to catalogue keys, primary first; unknown text stays visible
  INSERT INTO consultants (user_id, sap_role, sap_roles)
  VALUES (cu, 'architect', ARRAY['Functional consultant', 'Solution / enterprise architect', 'SAP PTW']) RETURNING id INTO c;
  IF (SELECT sap_roles FROM consultants WHERE id = c) <> ARRAY['solution_architect', 'functional', 'SAP PTW']
     OR (SELECT sap_role FROM consultants WHERE id = c) <> 'solution_architect' THEN RAISE EXCEPTION 'FAIL 1 mapping %', (SELECT sap_roles FROM consultants WHERE id = c); END IF;
  UPDATE consultants SET sap_roles = ARRAY['SAP PTW', 'functional'] WHERE id = c;
  IF (SELECT sap_role FROM consultants WHERE id = c) <> 'other' THEN RAISE EXCEPTION 'FAIL 1 unknown primary should be other'; END IF;
  RAISE NOTICE 'PASS 1 legacy mapping';

  -- 2 one primary + up to 4 more
  BEGIN
    UPDATE consultants SET sap_roles = ARRAY['functional','technical','basis','integration','tester','presales'] WHERE id = c;
    RAISE EXCEPTION 'FAIL 2 six roles accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'PASS 2 max five roles';

  -- 3 technical fields never required for a manager; still required for a technical consultant
  UPDATE profile_field_rules SET mode = 'required' WHERE field_key IN ('sap_technologies', 'certifications', 'methodologies');
  INSERT INTO consultants (user_id, sap_roles) VALUES (mu, ARRAY['project_manager']) RETURNING id INTO m;
  miss := consultant_missing_fields(m);
  IF 'sap_technologies' = ANY (miss) OR 'certifications' = ANY (miss) THEN RAISE EXCEPTION 'FAIL 3 manager forced technical %', miss; END IF;
  IF NOT 'methodologies' = ANY (miss) THEN RAISE EXCEPTION 'FAIL 3 manager methodology rule ignored'; END IF;
  UPDATE consultants SET role_details = '{"methodologies": ["SAP Activate"]}' WHERE id = m;
  IF 'methodologies' = ANY (consultant_missing_fields(m)) THEN RAISE EXCEPTION 'FAIL 3 filled methodology still missing'; END IF;
  UPDATE consultants SET sap_roles = ARRAY['technical'] WHERE id = c;
  IF NOT 'sap_technologies' = ANY (consultant_missing_fields(c)) OR 'methodologies' = ANY (consultant_missing_fields(c)) THEN
    RAISE EXCEPTION 'FAIL 3 technical consultant rules'; END IF;
  RAISE NOTICE 'PASS 3 role-aware required fields';

  -- 4 role details reject contact details and unknown keys
  BEGIN UPDATE consultants SET role_details = '{"presales_experience": "call me on +966 55 123 4567 or a@b.com"}' WHERE id = m;
    RAISE EXCEPTION 'FAIL 4 contact accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN UPDATE consultants SET role_details = '{"salary": 1}' WHERE id = m;
    RAISE EXCEPTION 'FAIL 4 unknown key accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'PASS 4 role details validated';

  -- 5 catalogue: everyone reads, only admins write
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM consultant_role_catalog) < 25 THEN RAISE EXCEPTION 'FAIL 5 catalogue not readable'; END IF;
  BEGIN INSERT INTO consultant_role_catalog (key, label_en, label_ar, category) VALUES ('hacker', 'Hacker', 'هاكر', 'other');
    RAISE EXCEPTION 'FAIL 5 non-admin wrote'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE consultant_role_catalog SET enabled = false WHERE key = 'presales';
  RESET ROLE;
  IF NOT (SELECT enabled FROM consultant_role_catalog WHERE key = 'presales') THEN RAISE EXCEPTION 'FAIL 5 non-admin edited'; END IF;
  RAISE NOTICE 'PASS 5 catalogue access';
END $$;
ROLLBACK;
