-- Checks for docs/sql/email-sender.sql. One transaction, ROLLED BACK at the end (leaves no data).
BEGIN;
DO $$ DECLARE sa uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); r jsonb; BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (sa, 'sa@es-test.invalid', now()), (adm, 'a@es-test.invalid', now());
  INSERT INTO public.user_roles (user_id, role) VALUES (sa, 'super_admin'), (adm, 'admin');
  -- ES01 only super admins change the sender
  PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  r := public.admin_email_sender_settings(); IF (r ->> 'can_edit')::boolean THEN RAISE EXCEPTION 'ES01 admin can edit'; END IF;
  BEGIN PERFORM public.admin_set_email_sender_settings('{"reply_to":"info@aisupport360.com"}'); RAISE EXCEPTION 'ES01 admin saved'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- ES02 From only on the verified domain; Reply-To own domain; no header injection through the name
  PERFORM set_config('request.jwt.claims', json_build_object('sub', sa, 'role', 'authenticated')::text, true);
  BEGIN PERFORM public.admin_set_email_sender_settings('{"from":"info@gmail.com"}'); RAISE EXCEPTION 'ES02 foreign From'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.admin_set_email_sender_settings('{"reply_to":"x@evil.example"}'); RAISE EXCEPTION 'ES02 foreign Reply-To'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM public.admin_set_email_sender_settings('{"display_name":"Evil\" <x@y.z>"}'); RAISE EXCEPTION 'ES02 bad name'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  -- ES03 the non-registered switch can never be turned on here
  BEGIN PERFORM public.admin_set_email_sender_settings('{"non_users_enabled":true}'); RAISE EXCEPTION 'ES03 non-users enabled'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- ES04 a valid change is saved and audited
  r := public.admin_set_email_sender_settings('{"display_name":"AI Support 360","from":"info@aisupport360.com","reply_to":"info@aisupport360.com"}');
  IF r ->> 'from' <> 'info@aisupport360.com' OR (r ->> 'non_users_enabled')::boolean THEN RAISE EXCEPTION 'ES04 %', r; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs WHERE action = 'email_sender_settings' AND user_id = sa) THEN RAISE EXCEPTION 'ES04 audit'; END IF;
  RAISE NOTICE 'email-sender tests passed';
END $$;
ROLLBACK;
