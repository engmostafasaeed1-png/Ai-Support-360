-- =============================================================================
-- Feature X — checks for consultant name privacy. Run once AFTER applying docs/sql/consultant-name-privacy.sql.
-- Everything runs in one transaction and is ROLLED BACK: no data is kept, no e-mail is sent.
-- Needs one verified consultant, a second consultant, a client with a ticket and an administrator.
-- Prints "NAME PRIVACY CHECKS PASSED" or stops at the first "FAIL: ...".
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.ck(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', _what; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _uid IS NULL THEN '{"role":"anon"}' ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true)
$$;

-- 1) Formats, English and Arabic, one word, three words, titles, diacritics, one-letter words
DO $$
DECLARE f text;
BEGIN
  PERFORM pg_temp.ck(public.format_consultant_name('Mostafa Saeed', 'masked') = 'M. S****', 'masked EN');
  PERFORM pg_temp.ck(public.format_consultant_name('Mostafa Saeed', 'initial_family') = 'M. Saeed', 'initial_family EN');
  PERFORM pg_temp.ck(public.format_consultant_name('Mostafa Saeed', 'initials') = 'M.S.', 'initials EN');
  PERFORM pg_temp.ck(public.format_consultant_name('  Mostafa   Saeed ', 'full') = 'Mostafa Saeed', 'full EN');
  PERFORM pg_temp.ck(public.format_consultant_name('Dr. Mostafa Ahmed Saeed', 'masked') = 'M. S****', 'three words + title use first and last');
  PERFORM pg_temp.ck(public.format_consultant_name('Mostafa', 'masked') = 'M*****', 'one word, max 5 stars');
  PERFORM pg_temp.ck(public.format_consultant_name('Ali', 'masked') = 'A***', 'one word, min 3 stars');
  PERFORM pg_temp.ck(public.format_consultant_name('Mostafa', 'initials') = 'M.', 'one word initials');
  PERFORM pg_temp.ck(public.format_consultant_name('A B', 'masked') = 'A. B***', 'one-letter words');
  PERFORM pg_temp.ck(public.format_consultant_name('José Núñez', 'masked') = 'J. N****', 'accents removed for letters');
  PERFORM pg_temp.ck(public.format_consultant_name('José Núñez', 'initial_family') = 'J. Núñez', 'family name kept as written');
  PERFORM pg_temp.ck(public.format_consultant_name('مصطفى سعيد', 'masked') = 'م. س***', 'masked AR');
  PERFORM pg_temp.ck(public.format_consultant_name('مصطفى سعيد', 'initial_family') = 'م. سعيد', 'initial_family AR');
  PERFORM pg_temp.ck(public.format_consultant_name('مصطفى سعيد', 'initials') = 'م.س.', 'initials AR');
  PERFORM pg_temp.ck(public.format_consultant_name('م. مُصْطَفَى أحمد سعيد', 'masked') = 'م. س***', 'AR title, diacritics, three words');
  PERFORM pg_temp.ck(public.format_consultant_name('د. علي', 'masked') = 'ع***', 'AR title + one word');
  PERFORM pg_temp.ck(public.format_consultant_name('Eng. Omar', 'masked') = 'O***', 'EN title + one word');
  PERFORM pg_temp.ck(public.format_consultant_name('', 'masked') = '', 'empty name');
END $$;

-- 2) Viewer matrix
DO $$
DECLARE
  _c uuid; _c_user uuid; _o uuid; _o_user uuid; _k uuid; _t uuid; _a uuid; _n int; _body text;
BEGIN
  SELECT ur.user_id INTO _a FROM public.user_roles ur WHERE ur.role::text IN ('admin', 'super_admin') LIMIT 1;
  SELECT c.id, c.user_id INTO _c, _c_user FROM public.consultants c WHERE c.verification_status = 'verified' ORDER BY c.created_at LIMIT 1;
  SELECT c.id, c.user_id INTO _o, _o_user FROM public.consultants c WHERE c.verification_status = 'verified' AND c.id <> _c ORDER BY c.created_at LIMIT 1;
  SELECT t.id, t.client_id INTO _t, _k FROM public.tickets t
   WHERE t.client_id NOT IN (_c_user, _o_user, _a) ORDER BY t.created_at LIMIT 1;
  IF _a IS NULL OR _c IS NULL OR _o IS NULL OR _t IS NULL THEN
    RAISE EXCEPTION 'SKIPPED: needs an administrator, two verified consultants and a client ticket';
  END IF;

  -- fixture (rolled back): a known name, masking on, no relationship between consultant and client
  SET LOCAL session_replication_role = replica;
  UPDATE public.profiles SET display_name = 'Mostafa Saeed' WHERE user_id = _c_user;
  UPDATE public.consultants SET name_format = 'masked' WHERE id = _c;
  UPDATE public.platform_settings SET value = 'true'::jsonb WHERE key = 'consultant_name_masking_enabled';
  UPDATE public.nda_agreements SET revoked_at = now() WHERE consultant_id = _c AND revoked_at IS NULL;
  UPDATE public.ticket_team_members SET status = 'withdrawn' WHERE consultant_id = _c AND status IN ('ready', 'active');
  UPDATE public.ticket_assignments SET status = 'removed' WHERE consultant_id = _c AND status::text = 'active';
  UPDATE public.tickets SET consultant_id = NULL WHERE consultant_id = _c;
  SET LOCAL session_replication_role = origin;

  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'M. S****', 'visitor sees masked');
  PERFORM pg_temp.as_user(_k);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'M. S****', 'client sees masked');
  PERFORM pg_temp.as_user(_o_user);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'M. S****', 'other consultant sees masked');
  PERFORM pg_temp.as_user(_a);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'Mostafa Saeed', 'admin sees full');
  PERFORM pg_temp.as_user(_c_user);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'Mostafa Saeed', 'owner sees full');

  -- assigned (legacy active assignment) but no NDA: still masked
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.ticket_assignments (ticket_id, consultant_id, status) VALUES (_t, _c, 'active');
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.as_user(_k);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'M. S****', 'assigned client without NDA sees masked');

  -- consultant signs: the client notification uses the masked name
  PERFORM pg_temp.as_user(_c_user);
  INSERT INTO public.nda_agreements (consultant_id, client_id, signature_data, nda_content, signed_at)
  VALUES (_c, _k, 'Mostafa Saeed', 'test', now());
  SELECT n.body INTO _body FROM public.notifications n WHERE n.user_id = _k AND n.type = 'nda' ORDER BY n.created_at DESC LIMIT 1;
  PERFORM pg_temp.ck(_body IS NULL OR (_body LIKE '%M. S****%' AND _body NOT LIKE '%Saeed%'), 'NDA notification text is masked');
  PERFORM pg_temp.ck(public.team_consultant_name(_c) = 'M. S****', 'team notification name is masked');
  PERFORM pg_temp.as_user(_k);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'M. S****', 'NDA signed by consultant only: masked');

  -- both signed: full name for the client of that ticket only
  SET LOCAL session_replication_role = replica;
  UPDATE public.nda_agreements SET client_signed_at = now() WHERE consultant_id = _c AND client_id = _k AND revoked_at IS NULL;
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.as_user(_k);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'Mostafa Saeed', 'assigned client with NDA sees full');
  PERFORM pg_temp.as_user(_o_user);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'M. S****', 'other consultant still masked');
  PERFORM pg_temp.ck(public.team_consultant_name(_c) = 'M. S****', 'stored notification texts stay masked');

  -- search leak: a client without access cannot find the consultant by the hidden family name
  SET LOCAL session_replication_role = replica;
  UPDATE public.nda_agreements SET revoked_at = now() WHERE consultant_id = _c AND client_id = _k;
  SET LOCAL session_replication_role = origin;
  PERFORM pg_temp.as_user(_k);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.profile_directory d WHERE d.user_id = _c_user AND d.display_name ILIKE '%saeed%';
  PERFORM pg_temp.ck(_n = 0, 'directory does not leak the family name');
  SELECT count(*) INTO _n FROM public.profile_directory d WHERE d.user_id = _c_user AND d.display_name = 'M. S****';
  PERFORM pg_temp.ck(_n = 1, 'directory returns the masked name');
  SELECT count(*) INTO _n FROM public.profiles p WHERE p.user_id = _c_user;
  PERFORM pg_temp.ck(_n = 0, 'profiles table is not readable by other users');
  RESET ROLE;

  -- formats chosen by the owner; nobody else may change them
  PERFORM pg_temp.as_user(_c_user);
  SET LOCAL ROLE authenticated;
  UPDATE public.consultants SET name_format = 'initials' WHERE id = _c;
  RESET ROLE;
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'M.S.', 'owner choice initials');
  BEGIN
    PERFORM pg_temp.as_user(_k);
    SET LOCAL ROLE authenticated;
    UPDATE public.consultants SET name_format = 'full' WHERE id = _c;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN RESET ROLE;
  END;
  PERFORM pg_temp.ck((SELECT name_format FROM public.consultants WHERE id = _c) = 'initials', 'client cannot change the format');
  BEGIN
    UPDATE public.consultants SET name_format = 'shown' WHERE id = _c;
    RAISE EXCEPTION 'FAIL: invalid format accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- switch off: everyone sees the full name
  UPDATE public.platform_settings SET value = 'false'::jsonb WHERE key = 'consultant_name_masking_enabled';
  PERFORM pg_temp.as_user(NULL);
  PERFORM pg_temp.ck(public.consultant_public_name(_c) = 'Mostafa Saeed', 'masking off shows full names');

  -- internal helpers are not callable from the browser
  PERFORM pg_temp.ck(NOT has_function_privilege('authenticated', 'public.consultant_name_for(uuid,uuid)', 'EXECUTE'), 'consultant_name_for is internal');
  PERFORM pg_temp.ck(NOT has_function_privilege('anon', 'public.consultant_name_unlocked(uuid,uuid)', 'EXECUTE'), 'consultant_name_unlocked is internal');
  PERFORM pg_temp.ck(has_function_privilege('anon', 'public.consultant_public_name(uuid)', 'EXECUTE'), 'consultant_public_name is public');

  RAISE NOTICE 'NAME PRIVACY CHECKS PASSED';
END $$;

ROLLBACK;
