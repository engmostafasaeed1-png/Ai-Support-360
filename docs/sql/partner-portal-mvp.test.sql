-- Partner portal MVP checks. Run after partner-portal-mvp.sql; everything rolls back.
BEGIN;
DO $$
DECLARE pu uuid := gen_random_uuid(); ou uuid := gen_random_uuid(); cu uuid := gen_random_uuid();
  pt uuid; ot uuid; c uuid; r uuid; ok boolean;
BEGIN
  UPDATE platform_settings SET value = 'true'::jsonb WHERE key = 'partner_portal';
  INSERT INTO auth.users (id, email) VALUES (pu, pu||'@t.test'), (ou, ou||'@t.test'), (cu, cu||'@t.test');
  INSERT INTO tenants (name, slug, is_partner) VALUES ('P', 'p-'||pu, true) RETURNING id INTO pt;
  INSERT INTO tenants (name, slug, is_partner) VALUES ('O', 'o-'||ou, false) RETURNING id INTO ot;
  INSERT INTO tenant_members (tenant_id, user_id, org_role) VALUES (pt, pu, 'owner'), (ot, ou, 'owner');
  INSERT INTO consultants (user_id) VALUES (cu) RETURNING id INTO c;

  -- 1 non-partner tenant denied
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true);
  BEGIN PERFORM partner_overview(); RAISE EXCEPTION 'FAIL 1 non-partner allowed'; EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS 1 non-partner denied';

  -- partner invites, consultant accepts
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pu, 'role', 'authenticated')::text, true);
  IF partner_invite_resource(cu||'@t.test') <> 'invited' THEN RAISE EXCEPTION 'FAIL invite'; END IF;
  SELECT id INTO r FROM partner_resources WHERE consultant_id = c;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true);
  PERFORM partner_respond(r, true);

  -- 2 other tenant cannot read the resource
  PERFORM set_config('request.jwt.claims', json_build_object('sub', ou, 'role', 'authenticated')::text, true);
  UPDATE tenants SET is_partner = true WHERE id = ot;
  BEGIN PERFORM partner_resource_overview(c); RAISE EXCEPTION 'FAIL 2 other tenant read'; EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  IF jsonb_array_length(partner_overview()) <> 0 THEN RAISE EXCEPTION 'FAIL 2 list leak'; END IF;
  RAISE NOTICE 'PASS 2 other tenant denied';

  -- 3 one active partner per consultant
  IF partner_invite_resource(cu||'@t.test') <> 'invited' THEN RAISE EXCEPTION 'FAIL 3 invite'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', cu, 'role', 'authenticated')::text, true);
  BEGIN PERFORM partner_respond((SELECT id FROM partner_resources WHERE tenant_id = ot AND consultant_id = c), true);
    RAISE EXCEPTION 'FAIL 3 second active partner'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS 3 one active partner';

  -- 4 consultant can leave; partner then loses access
  PERFORM partner_leave();
  SELECT status = 'left' INTO ok FROM partner_resources WHERE id = r;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 4 leave'; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pu, 'role', 'authenticated')::text, true);
  BEGIN PERFORM partner_resource_overview(c); RAISE EXCEPTION 'FAIL 4 access after leave'; EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS 4 consultant left';

  -- 5 feature off denies everyone
  UPDATE platform_settings SET value = 'false'::jsonb WHERE key = 'partner_portal';
  BEGIN PERFORM partner_overview(); RAISE EXCEPTION 'FAIL 5 flag off'; EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL%' THEN RAISE; END IF; END;
  RAISE NOTICE 'PASS 5 flag off';
END $$;
ROLLBACK;
