-- M69: administrators see ALL profile data of a consultant in one call (read-only, audited).
-- The consultants table has column-level privileges and the contact links / nationality / bank details live behind separate protection,
-- so an administrator needs this SECURITY DEFINER function to read everything together.
CREATE OR REPLACE FUNCTION public.admin_consultant_full_profile(_cid uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _c public.consultants;
  _out jsonb;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false)
     AND NOT COALESCE(public.has_role(auth.uid(), 'super_admin'::app_role), false) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _c FROM public.consultants WHERE id = _cid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Consultant not found' USING ERRCODE = 'P0002';
  END IF;
  _out := jsonb_build_object(
    'consultant', to_jsonb(_c) - 'location',
    'account', (SELECT jsonb_build_object('email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at, 'provider', u.raw_app_meta_data ->> 'provider')
                  FROM auth.users u WHERE u.id = _c.user_id),
    'profile', (SELECT to_jsonb(p) FROM public.profiles p WHERE p.user_id = _c.user_id),
    'private', (SELECT to_jsonb(x) FROM public.consultant_private x WHERE x.consultant_id = _c.id),
    'skills', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sap_module) FROM public.consultant_skills x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'certifications', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.issue_date DESC NULLS LAST) FROM public.certifications x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'work_history', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.start_date DESC NULLS LAST) FROM public.consultant_work_history x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'education', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.end_year DESC NULLS LAST) FROM public.consultant_education x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM public.consultant_projects x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'availability', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.day_of_week NULLS LAST, x.start_time) FROM public.availability_slots x WHERE x.consultant_id = _c.id), '[]'::jsonb),
    'interviews', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (SELECT id, status, interview_type, interview_style, overall_score, technical_score, soft_skills_score, ai_summary, started_at, completed_at, created_at FROM public.interview_sessions WHERE consultant_id = _c.id ORDER BY created_at DESC LIMIT 10) x), '[]'::jsonb),
    'payout', (SELECT to_jsonb(x) FROM public.consultant_payout_details x WHERE x.consultant_id = _c.id),
    'missing_required_fields', public.consultant_missing_fields(_c.id),
    'counts', jsonb_build_object(
      'tickets_assigned', (SELECT count(*) FROM public.tickets t WHERE t.consultant_id = _c.id),
      'bids', (SELECT count(*) FROM public.proposals p WHERE p.consultant_id = _c.id),
      'ndas_signed', (SELECT count(*) FROM public.nda_agreements n WHERE n.consultant_id = _c.id AND n.revoked_at IS NULL))
  );
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'admin_viewed_consultant_profile', 'consultant', _cid, jsonb_build_object('at', now()));
  RETURN _out;
END
$function$;
REVOKE ALL ON FUNCTION public.admin_consultant_full_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_consultant_full_profile(uuid) TO authenticated;
