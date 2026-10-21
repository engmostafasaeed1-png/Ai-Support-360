-- Feature P post-apply checks. Run AFTER docs/sql/user-management.sql. Everything runs in one transaction and is
-- rolled back at the end, so no real data is changed. Each check raises an error with its name when it fails.
BEGIN;

DO $$
DECLARE
  _super uuid := gen_random_uuid();
  _super2 uuid := gen_random_uuid();
  _admin uuid := gen_random_uuid();
  _scoped uuid := gen_random_uuid();
  _cons uuid := gen_random_uuid();
  _client uuid := gen_random_uuid();
  _cid uuid;
  _gid uuid;
  _r jsonb;
  _n int;
  _failed boolean;
  _err text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (_super, 'um-test-super@example.invalid'), (_super2, 'um-test-super2@example.invalid'), (_admin, 'um-test-admin@example.invalid'),
    (_scoped, 'um-test-scoped@example.invalid'), (_cons, 'um-test-consultant@example.invalid'), (_client, 'um-test-client@example.invalid');
  -- The test needs to be the only super admin to check the "last super admin" rule.
  CREATE TEMP TABLE _um_saved_super ON COMMIT DROP AS SELECT user_id FROM public.user_roles WHERE role = 'super_admin';
  DELETE FROM public.user_roles WHERE role = 'super_admin';
  INSERT INTO public.user_roles (user_id, role) VALUES (_super, 'super_admin'), (_admin, 'admin'), (_scoped, 'admin'),
    (_cons, 'consultant'), (_client, 'client');
  INSERT INTO public.consultants (user_id) VALUES (_cons) RETURNING id INTO _cid;

  -- Permission matrix
  IF NOT public.admin_can(_super, 'admins.manage') OR NOT public.admin_can(_super, 'users.merge') THEN RAISE EXCEPTION 'check super has everything'; END IF;
  IF NOT public.admin_can(_admin, 'users.suspend') OR NOT public.admin_can(_admin, 'finance.view') THEN RAISE EXCEPTION 'check plain admin keeps full admin permissions'; END IF;
  IF public.admin_can(_admin, 'admins.manage') OR public.admin_can(_admin, 'users.merge') OR public.admin_can(_admin, 'users.mfa_reset') THEN
    RAISE EXCEPTION 'check super-only permissions refused for admin';
  END IF;
  IF public.admin_can(_client, 'users.read') OR public.admin_can(_cons, 'users.read') THEN RAISE EXCEPTION 'check non-admins have no admin permissions'; END IF;
  INSERT INTO public.admin_permission_groups (name, permissions) VALUES ('um test support', ARRAY['users.read', 'users.notes']) RETURNING id INTO _gid;
  INSERT INTO public.admin_group_members (group_id, user_id) VALUES (_gid, _scoped);
  IF NOT public.admin_can(_scoped, 'users.read') OR public.admin_can(_scoped, 'users.suspend') THEN RAISE EXCEPTION 'check group limits a scoped admin'; END IF;

  -- Signed-in calls
  PERFORM set_config('request.jwt.claim.sub', _scoped::text, true);
  _failed := false;
  BEGIN PERFORM public.admin_user_action(_client, 'set_tags', '{"tags":["vip"]}'::jsonb, NULL); EXCEPTION WHEN insufficient_privilege THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check scoped admin cannot edit'; END IF;
  _r := public.admin_users_search('{"q":"um-test-","page_size":10}'::jsonb);
  IF (_r ->> 'total')::int <> 6 THEN RAISE EXCEPTION 'check search total: %', _r ->> 'total'; END IF;

  PERFORM set_config('request.jwt.claim.sub', _client::text, true);
  _failed := false;
  BEGIN PERFORM public.admin_users_search('{}'::jsonb); EXCEPTION WHEN insufficient_privilege THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check client cannot list users'; END IF;

  -- Own role change is blocked, also for super admins
  PERFORM set_config('request.jwt.claim.sub', _super::text, true);
  _failed := false;
  BEGIN PERFORM public.admin_user_action(_super, 'set_roles', '{"roles":["super_admin","client"]}'::jsonb, 'testing self'); EXCEPTION WHEN insufficient_privilege THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check own role change blocked'; END IF;

  -- Only a super admin grants admin, with a reason
  PERFORM set_config('request.jwt.claim.sub', _admin::text, true);
  _failed := false;
  BEGIN PERFORM public.admin_user_action(_client, 'set_roles', '{"roles":["client","admin"]}'::jsonb, 'promote please'); EXCEPTION WHEN insufficient_privilege THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check admin cannot grant admin'; END IF;
  _r := public.admin_user_action(_client, 'set_roles', '{"roles":["client","consultant"]}'::jsonb, NULL);
  IF NOT public.has_role(_client, 'consultant') THEN RAISE EXCEPTION 'check admin can change client/consultant roles'; END IF;

  PERFORM set_config('request.jwt.claim.sub', _super::text, true);
  _failed := false;
  BEGIN PERFORM public.admin_user_action(_client, 'set_roles', '{"roles":["client","admin"]}'::jsonb, NULL); EXCEPTION WHEN invalid_parameter_value THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check reason required for admin role'; END IF;

  -- Last super admin cannot be removed (by the other super admin either)
  INSERT INTO public.user_roles (user_id, role) VALUES (_super2, 'admin');
  _r := public.admin_user_action(_super2, 'set_roles', '{"roles":["admin","super_admin"]}'::jsonb, 'second super admin');
  IF NOT public.has_role(_super2, 'super_admin') THEN RAISE EXCEPTION 'check super admin grant (4-eyes off)'; END IF;
  PERFORM set_config('request.jwt.claim.sub', _super2::text, true);
  _r := public.admin_user_action(_super, 'set_roles', '{"roles":["admin"]}'::jsonb, 'step down test');
  PERFORM set_config('request.jwt.claim.sub', _super::text, true);
  _failed := false;
  BEGIN PERFORM public.admin_user_action(_super2, 'set_roles', '{"roles":["admin"]}'::jsonb, 'remove last'); EXCEPTION WHEN insufficient_privilege THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check former super admin cannot act on super admin'; END IF;
  IF NOT public.um_is_last_super_admin(_super2) THEN RAISE EXCEPTION 'check last super admin detected'; END IF;
  _failed := false;
  BEGIN PERFORM public.um_apply_roles(_super2, _super2, ARRAY['admin'], 'self'); EXCEPTION WHEN insufficient_privilege THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check last super admin cannot drop own role'; END IF;
  -- restore _super as super admin through _super2
  PERFORM set_config('request.jwt.claim.sub', _super2::text, true);
  _r := public.admin_user_action(_super, 'set_roles', '{"roles":["admin","super_admin"]}'::jsonb, 'restore for test');

  -- 4-eyes: a grant becomes a request; the requester cannot approve it; another super admin can
  UPDATE public.platform_settings SET value = 'true'::jsonb WHERE key = 'super_admin_four_eyes';
  IF NOT FOUND THEN INSERT INTO public.platform_settings (key, value) VALUES ('super_admin_four_eyes', 'true'::jsonb); END IF;
  _r := public.admin_user_action(_admin, 'set_roles', '{"roles":["admin","super_admin"]}'::jsonb, 'four eyes test');
  IF public.has_role(_admin, 'super_admin') OR (_r ->> 'pending_request') IS NULL THEN RAISE EXCEPTION 'check 4-eyes creates a request: %', _r; END IF;
  _failed := false;
  BEGIN PERFORM public.admin_decide_grant_request((_r ->> 'pending_request')::uuid, true, NULL); EXCEPTION WHEN insufficient_privilege THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check requester cannot approve'; END IF;
  PERFORM set_config('request.jwt.claim.sub', _super::text, true);
  PERFORM public.admin_decide_grant_request((_r ->> 'pending_request')::uuid, true, 'ok');
  IF NOT public.has_role(_admin, 'super_admin') THEN RAISE EXCEPTION 'check second super admin approves'; END IF;

  -- Suspension hides the consultant from the directory and matching; reactivation brings them back
  IF _cid = ANY (public.hidden_consultant_ids()) THEN RAISE EXCEPTION 'check consultant visible before suspension'; END IF;
  UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = _cons;
  PERFORM public.um_record_state(_super, _cons, 'suspend', '{}'::jsonb, 'test suspension');
  IF NOT (_cid = ANY (public.hidden_consultant_ids())) THEN RAISE EXCEPTION 'check suspended hidden from directory'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.matching_inactive_consultants() x WHERE x = _cid) THEN RAISE EXCEPTION 'check suspended excluded from matching'; END IF;
  _r := public.admin_users_search(jsonb_build_object('status', jsonb_build_array('suspended'), 'q', 'um-test-consultant'));
  IF (_r ->> 'total')::int <> 1 OR _r #>> '{rows,0,suspended_reason}' <> 'test suspension' THEN RAISE EXCEPTION 'check suspended filter: %', _r; END IF;
  UPDATE auth.users SET banned_until = NULL WHERE id = _cons;
  PERFORM public.um_record_state(_super, _cons, 'reactivate', '{}'::jsonb, NULL);
  IF _cid = ANY (public.hidden_consultant_ids()) THEN RAISE EXCEPTION 'check reactivated visible again'; END IF;

  -- Soft delete hides and restores; deleted accounts are hidden from the default list
  PERFORM public.um_record_state(_super, _cons, 'soft_delete', '{}'::jsonb, 'duplicate account');
  IF NOT (_cid = ANY (public.hidden_consultant_ids())) THEN RAISE EXCEPTION 'check deleted hidden'; END IF;
  IF (public.admin_users_search('{"q":"um-test-consultant"}'::jsonb) ->> 'total')::int <> 0 THEN RAISE EXCEPTION 'check deleted not listed by default'; END IF;
  PERFORM public.um_record_state(_super, _cons, 'restore', '{}'::jsonb, 'restored');
  IF _cid = ANY (public.hidden_consultant_ids()) THEN RAISE EXCEPTION 'check restored visible'; END IF;

  -- Bulk: dry run changes nothing, limit 200, run + undo
  _r := public.admin_users_bulk('tag_add', ARRAY[_client, _cons], '{"tags":["Key account"]}'::jsonb, true);
  IF jsonb_array_length(_r -> 'eligible') <> 2 OR EXISTS (SELECT 1 FROM public.user_admin_state WHERE 'key account' = ANY (tags)) THEN
    RAISE EXCEPTION 'check dry run: %', _r;
  END IF;
  _failed := false;
  BEGIN PERFORM public.admin_users_bulk('tag_add', ARRAY(SELECT gen_random_uuid() FROM generate_series(1, 201)), '{"tags":["x"]}'::jsonb, true);
  EXCEPTION WHEN invalid_parameter_value THEN _failed := true; END;
  IF NOT _failed THEN RAISE EXCEPTION 'check 200 limit'; END IF;
  _r := public.admin_users_bulk('tag_add', ARRAY[_client, _cons], '{"tags":["Key account"]}'::jsonb, false);
  IF (SELECT count(*) FROM public.user_admin_state WHERE 'key account' = ANY (tags)) <> 2 THEN RAISE EXCEPTION 'check bulk tag'; END IF;
  PERFORM public.admin_bulk_undo((_r ->> 'run_id')::uuid);
  IF EXISTS (SELECT 1 FROM public.user_admin_state WHERE 'key account' = ANY (tags)) THEN RAISE EXCEPTION 'check bulk undo'; END IF;

  -- Audit rows carry actor, target, before, after and reason
  SELECT count(*) INTO _n FROM public.audit_logs WHERE action = 'admin_user.set_roles' AND entity_id = _client
     AND metadata ? 'before' AND metadata ? 'after';
  IF _n < 1 THEN RAISE EXCEPTION 'check role audit row'; END IF;
  SELECT count(*) INTO _n FROM public.audit_logs WHERE action = 'admin_user.suspend' AND entity_id = _cons AND user_id = _super
     AND metadata ->> 'reason' = 'test suspension';
  IF _n <> 1 THEN RAISE EXCEPTION 'check suspend audit row'; END IF;
  -- Role changes alert super admins
  SELECT count(*) INTO _n FROM public.notifications WHERE type = 'security_alert' AND user_id IN (_super, _super2);
  IF _n < 1 THEN RAISE EXCEPTION 'check security alert sent'; END IF;

  -- Detail view hides bank data and records the view
  _r := public.admin_user_detail(_cons);
  IF _r::text ILIKE '%iban%' THEN RAISE EXCEPTION 'check no bank data in detail'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'admin_user.viewed' AND entity_id = _cons) THEN RAISE EXCEPTION 'check view audited'; END IF;

  RAISE NOTICE 'Feature P checks passed';
END
$$;

ROLLBACK;
