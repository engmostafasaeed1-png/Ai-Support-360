-- Required submission validation, independent of directory/bid enforcement.
-- Drafts remain saveable; existing verified accounts are not forced back through onboarding.
CREATE OR REPLACE FUNCTION public.profile_required_value_present(_value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT CASE jsonb_typeof(_value)
 WHEN 'string' THEN regexp_replace(_value #>> '{}', '[[:space:]]', '', 'g') <> ''
 WHEN 'array' THEN EXISTS (SELECT 1 FROM jsonb_array_elements(_value) v WHERE public.profile_required_value_present(v))
 WHEN 'object' THEN EXISTS (SELECT 1 FROM jsonb_each(_value) v WHERE public.profile_required_value_present(v.value))
 WHEN 'number' THEN true WHEN 'boolean' THEN _value = 'true'::jsonb ELSE false END
$$;
REVOKE ALL ON FUNCTION public.profile_required_value_present(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_required_value_present(jsonb) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.profile_field_filled(_cid uuid, _key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.consultants;
  p public.profiles;
BEGIN
  SELECT * INTO c FROM public.consultants WHERE id = _cid;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO p FROM public.profiles WHERE user_id = c.user_id;
  RETURN CASE _key
    WHEN 'display_name' THEN char_length(btrim(COALESCE(p.display_name, ''))) >= 2
    WHEN 'avatar' THEN public.profile_required_value_present(to_jsonb(p.avatar_url))
    WHEN 'phone' THEN public.profile_required_value_present(to_jsonb(p.phone))
    WHEN 'bio' THEN char_length(btrim(COALESCE(c.bio, ''))) >= 20
    WHEN 'hourly_rate' THEN COALESCE(c.hourly_rate, 0) > 0
    WHEN 'timezone' THEN public.profile_required_value_present(to_jsonb(c.timezone))
    WHEN 'languages' THEN public.profile_required_value_present(to_jsonb(c.languages))
    WHEN 'language_levels' THEN c.language_levels IS NOT NULL AND c.language_levels::text NOT IN ('{}', '[]', 'null')
    WHEN 'nationality' THEN public.profile_required_value_present(to_jsonb(c.nationality)) OR EXISTS (SELECT 1 FROM public.consultant_private x WHERE x.consultant_id = _cid AND public.profile_required_value_present(to_jsonb(x.nationality)))
    WHEN 'country' THEN public.profile_required_value_present(to_jsonb(btrim(c.country)))
    WHEN 'city' THEN public.profile_required_value_present(to_jsonb(btrim(c.city)))
    WHEN 'work_modes' THEN public.profile_required_value_present(to_jsonb(c.work_modes))
    WHEN 'working_week' THEN public.profile_required_value_present(to_jsonb(c.working_week))
    WHEN 'linkedin_url' THEN public.profile_required_value_present(to_jsonb(c.linkedin_url))
    WHEN 'credly_username' THEN public.profile_required_value_present(to_jsonb(c.credly_username))
    WHEN 'github_url' THEN public.profile_required_value_present(to_jsonb(c.github_url))
    WHEN 'personal_website' THEN public.profile_required_value_present(to_jsonb(c.personal_website))
    WHEN 'profile_video_url' THEN public.profile_required_value_present(to_jsonb(c.profile_video_url))
    WHEN 'sap_role' THEN public.profile_required_value_present(to_jsonb(c.sap_role))
    WHEN 'seniority_level' THEN public.profile_required_value_present(to_jsonb(c.seniority_level))
    WHEN 'total_sap_years' THEN COALESCE(c.total_sap_years, 0) > 0
    WHEN 'sap_roles' THEN public.profile_required_value_present(to_jsonb(c.sap_roles))
    WHEN 'sap_technologies' THEN public.profile_required_value_present(to_jsonb(c.sap_technologies))
    WHEN 'industries' THEN public.profile_required_value_present(to_jsonb(c.industries))
    WHEN 'customer_segments' THEN public.profile_required_value_present(to_jsonb(c.customer_segments))
    WHEN 'vertical_solutions' THEN public.profile_required_value_present(to_jsonb(c.vertical_solutions))
    WHEN 'localization_countries' THEN public.profile_required_value_present(to_jsonb(c.localization_countries))
    WHEN 'localization_solutions' THEN public.profile_required_value_present(to_jsonb(c.localization_solutions))
    WHEN 'deployment_experience' THEN public.profile_required_value_present(to_jsonb(c.deployment_experience))
    WHEN 'project_types' THEN public.profile_required_value_present(to_jsonb(c.project_types))
    WHEN 'project_scale' THEN public.profile_required_value_present(to_jsonb(c.project_scale))
    WHEN 'skills' THEN EXISTS (SELECT 1 FROM public.consultant_skills x WHERE x.consultant_id = _cid)
    WHEN 'certifications' THEN EXISTS (SELECT 1 FROM public.certifications x WHERE x.consultant_id = _cid)
    WHEN 'work_history' THEN EXISTS (SELECT 1 FROM public.consultant_work_history x WHERE x.consultant_id = _cid)
    WHEN 'education' THEN EXISTS (SELECT 1 FROM public.consultant_education x WHERE x.consultant_id = _cid)
    WHEN 'projects' THEN EXISTS (SELECT 1 FROM public.consultant_projects x WHERE x.consultant_id = _cid)
    WHEN 'availability' THEN EXISTS (SELECT 1 FROM public.availability_slots x WHERE x.consultant_id = _cid)
    WHEN 'cv' THEN public.profile_required_value_present(to_jsonb(c.cv_url)) OR EXISTS (SELECT 1 FROM public.consultant_private x WHERE x.consultant_id = _cid AND public.profile_required_value_present(to_jsonb(x.cv_url)))
    WHEN 'ai_interview' THEN c.ai_interview_completed_at IS NOT NULL
    WHEN 'bank_details' THEN EXISTS (SELECT 1 FROM public.consultant_payout_details x WHERE x.consultant_id = _cid AND x.acknowledged_at IS NOT NULL)
    ELSE true
  END;
END
$function$;

CREATE OR REPLACE FUNCTION public.guard_required_profile_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cid uuid; _missing text[];
BEGIN
 IF NEW.onboarding_completed IS NOT TRUE THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND OLD.onboarding_completed IS TRUE THEN RETURN NEW; END IF;
 SELECT id INTO _cid FROM public.consultants WHERE user_id = NEW.user_id AND verification_status <> 'verified';
 IF _cid IS NULL THEN RETURN NEW; END IF;
 _missing := public.consultant_submission_missing(_cid);
 IF cardinality(_missing) > 0 THEN
  RAISE EXCEPTION 'missing_required:%', array_to_string(_missing, ',') USING ERRCODE = 'P0001', DETAIL = array_to_string(_missing, ','), HINT = 'Complete these required items to finish';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_required_profile_completion BEFORE INSERT OR UPDATE OF onboarding_completed ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION public.guard_required_profile_completion();

CREATE OR REPLACE FUNCTION public.client_required_missing(_profile jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT COALESCE(array_agg(key ORDER BY key), ARRAY[]::text[]) FROM unnest(ARRAY['company_name','sap_modules']) key
 WHERE NOT public.profile_required_value_present(_profile -> key)
$$;
REVOKE ALL ON FUNCTION public.client_required_missing(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_required_missing(jsonb) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.guard_client_required_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _missing text[];
BEGIN
 -- Runs after existing approval guards/auto-submit: validates all actual submission transitions.
 IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM public.client_profiles WHERE user_id = NEW.user_id) THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN RETURN NEW; END IF;
 IF NEW.onboarding_completed IS TRUE OR NEW.approval_status IN ('awaiting_confirmation','approved') THEN
  IF TG_OP = 'UPDATE' AND NEW.onboarding_completed IS NOT DISTINCT FROM OLD.onboarding_completed
   AND NEW.approval_status IS NOT DISTINCT FROM OLD.approval_status THEN RETURN NEW; END IF;
  _missing := public.client_required_missing(to_jsonb(NEW));
  IF cardinality(_missing) > 0 THEN
   RAISE EXCEPTION 'missing_required:%', array_to_string(_missing, ',') USING ERRCODE = 'P0001', DETAIL = array_to_string(_missing, ','), HINT = 'Complete these required items to finish';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER trg_client_approval_3_required BEFORE INSERT OR UPDATE ON public.client_profiles
 FOR EACH ROW EXECUTE FUNCTION public.guard_client_required_submission();

-- Existing consultant_missing_fields remains unchanged (role-aware, required only).
-- Explicit admin-only metadata endpoint; no bank values or profile content.
CREATE OR REPLACE FUNCTION public.admin_required_profile_fields(_ids uuid[])
RETURNS TABLE(consultant_id uuid, missing text[]) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
  RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
 END IF;
 RETURN QUERY SELECT c.id, public.consultant_submission_missing(c.id) FROM public.consultants c WHERE c.id = ANY(_ids);
END $$;
REVOKE ALL ON FUNCTION public.admin_required_profile_fields(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_required_profile_fields(uuid[]) TO authenticated, service_role;
