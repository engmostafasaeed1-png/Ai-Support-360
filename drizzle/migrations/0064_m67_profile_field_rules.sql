-- M67: the administrator decides, field by field, what every consultant profile must contain.
--  profile_field_rules: each profile field is 'required', 'optional' or 'hidden' (admin only changes it, through admin_set_profile_field_rules, with a log)
--  consultant_missing_fields(): the required fields that are still empty (hidden fields never count)
--  enforcement switch (default OFF): when ON, incomplete consultants are hidden from the client directory / map (hidden_consultant_ids) and cannot place NEW bids

CREATE TABLE IF NOT EXISTS public.profile_field_rules (
  field_key text PRIMARY KEY CHECK (field_key ~ '^[a-z_]{2,40}$'),
  section text NOT NULL,
  label text NOT NULL,
  mode text NOT NULL DEFAULT 'optional' CHECK (mode IN ('required', 'optional', 'hidden')),
  default_mode text NOT NULL DEFAULT 'optional' CHECK (default_mode IN ('required', 'optional', 'hidden')),
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.profile_field_rules_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_key text NOT NULL,
  old_mode text,
  new_mode text NOT NULL,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.profile_rules_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enforce boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.profile_rules_config (id, enforce) VALUES (true, false) ON CONFLICT DO NOTHING;

ALTER TABLE public.profile_field_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_field_rules_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_rules_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read the profile field rules" ON public.profile_field_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Administrators read the rules log" ON public.profile_field_rules_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Signed-in users read the rules switch" ON public.profile_rules_config FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.profile_field_rules, public.profile_field_rules_log, public.profile_rules_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profile_field_rules, public.profile_field_rules_log, public.profile_rules_config TO authenticated;

INSERT INTO public.profile_field_rules (field_key, section, label, mode, default_mode, sort_order) VALUES
  ('display_name', 'Basics', 'Display name', 'required', 'required', 10),
  ('avatar', 'Basics', 'Profile photo', 'optional', 'optional', 20),
  ('phone', 'Basics', 'Phone number (private)', 'optional', 'optional', 30),
  ('bio', 'Basics', 'Bio', 'required', 'required', 40),
  ('hourly_rate', 'Basics', 'Hourly rate', 'required', 'required', 50),
  ('timezone', 'Basics', 'Time zone', 'required', 'required', 60),
  ('languages', 'Basics', 'Languages', 'required', 'required', 70),
  ('language_levels', 'Basics', 'Language levels', 'optional', 'optional', 80),
  ('nationality', 'Basics', 'Nationality (private)', 'optional', 'optional', 90),
  ('country', 'Location', 'Country', 'required', 'required', 100),
  ('city', 'Location', 'City', 'required', 'required', 110),
  ('work_modes', 'Location', 'Work mode', 'optional', 'optional', 120),
  ('working_week', 'Location', 'Working week', 'optional', 'optional', 130),
  ('linkedin_url', 'Links', 'LinkedIn profile', 'optional', 'optional', 140),
  ('credly_username', 'Links', 'Credly profile', 'optional', 'optional', 150),
  ('github_url', 'Links', 'GitHub', 'optional', 'optional', 160),
  ('personal_website', 'Links', 'Personal website', 'optional', 'optional', 170),
  ('profile_video_url', 'Links', 'Profile video', 'optional', 'optional', 180),
  ('sap_role', 'Experience', 'Main SAP role', 'optional', 'optional', 190),
  ('seniority_level', 'Experience', 'Seniority level', 'optional', 'optional', 200),
  ('total_sap_years', 'Experience', 'Years of SAP experience', 'optional', 'optional', 210),
  ('sap_roles', 'Experience', 'SAP roles held', 'optional', 'optional', 220),
  ('sap_technologies', 'Experience', 'SAP technologies', 'optional', 'optional', 230),
  ('industries', 'Experience', 'Industries', 'optional', 'optional', 240),
  ('customer_segments', 'Experience', 'Customer segments', 'optional', 'optional', 250),
  ('vertical_solutions', 'Experience', 'Vertical solutions', 'optional', 'optional', 260),
  ('localization_countries', 'Experience', 'Localization countries', 'optional', 'optional', 270),
  ('localization_solutions', 'Experience', 'Localization solutions', 'optional', 'optional', 280),
  ('deployment_experience', 'Experience', 'Deployment experience', 'optional', 'optional', 290),
  ('project_types', 'Experience', 'Project types', 'optional', 'optional', 300),
  ('project_scale', 'Experience', 'Project scale', 'optional', 'optional', 310),
  ('skills', 'Records', 'SAP skills (at least one)', 'required', 'required', 320),
  ('certifications', 'Records', 'Certifications (at least one)', 'optional', 'optional', 330),
  ('work_history', 'Records', 'Work experience (at least one)', 'optional', 'optional', 340),
  ('education', 'Records', 'Education (at least one)', 'optional', 'optional', 350),
  ('projects', 'Records', 'Projects (at least one)', 'optional', 'optional', 360),
  ('availability', 'Records', 'Weekly availability', 'required', 'required', 370),
  ('cv', 'Records', 'CV file', 'optional', 'optional', 380),
  ('ai_interview', 'Verification', 'AI interview completed', 'optional', 'optional', 390),
  ('bank_details', 'Verification', 'Payout bank details', 'optional', 'optional', 400)
ON CONFLICT (field_key) DO NOTHING;

-- is one field filled for one consultant? (internal)
CREATE OR REPLACE FUNCTION public.profile_field_filled(_cid uuid, _key text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  c public.consultants;
  p public.profiles;
BEGIN
  SELECT * INTO c FROM public.consultants WHERE id = _cid;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO p FROM public.profiles WHERE user_id = c.user_id;
  RETURN CASE _key
    WHEN 'display_name' THEN char_length(btrim(COALESCE(p.display_name, ''))) >= 2
    WHEN 'avatar' THEN COALESCE(p.avatar_url, '') <> ''
    WHEN 'phone' THEN COALESCE(p.phone, '') <> ''
    WHEN 'bio' THEN char_length(btrim(COALESCE(c.bio, ''))) >= 20
    WHEN 'hourly_rate' THEN COALESCE(c.hourly_rate, 0) > 0
    WHEN 'timezone' THEN COALESCE(c.timezone, '') <> ''
    WHEN 'languages' THEN COALESCE(cardinality(c.languages), 0) > 0
    WHEN 'language_levels' THEN c.language_levels IS NOT NULL AND c.language_levels::text NOT IN ('{}', '[]', 'null')
    WHEN 'nationality' THEN COALESCE(c.nationality, '') <> '' OR EXISTS (SELECT 1 FROM public.consultant_private x WHERE x.consultant_id = _cid AND COALESCE(x.nationality, '') <> '')
    WHEN 'country' THEN COALESCE(btrim(c.country), '') <> ''
    WHEN 'city' THEN COALESCE(btrim(c.city), '') <> ''
    WHEN 'work_modes' THEN COALESCE(cardinality(c.work_modes), 0) > 0
    WHEN 'working_week' THEN COALESCE(c.working_week, '') <> ''
    WHEN 'linkedin_url' THEN COALESCE(c.linkedin_url, '') <> ''
    WHEN 'credly_username' THEN COALESCE(c.credly_username, '') <> ''
    WHEN 'github_url' THEN COALESCE(c.github_url, '') <> ''
    WHEN 'personal_website' THEN COALESCE(c.personal_website, '') <> ''
    WHEN 'profile_video_url' THEN COALESCE(c.profile_video_url, '') <> ''
    WHEN 'sap_role' THEN COALESCE(c.sap_role, '') <> ''
    WHEN 'seniority_level' THEN COALESCE(c.seniority_level, '') <> ''
    WHEN 'total_sap_years' THEN COALESCE(c.total_sap_years, 0) > 0
    WHEN 'sap_roles' THEN COALESCE(cardinality(c.sap_roles), 0) > 0
    WHEN 'sap_technologies' THEN COALESCE(cardinality(c.sap_technologies), 0) > 0
    WHEN 'industries' THEN COALESCE(cardinality(c.industries), 0) > 0
    WHEN 'customer_segments' THEN COALESCE(cardinality(c.customer_segments), 0) > 0
    WHEN 'vertical_solutions' THEN COALESCE(cardinality(c.vertical_solutions), 0) > 0
    WHEN 'localization_countries' THEN COALESCE(cardinality(c.localization_countries), 0) > 0
    WHEN 'localization_solutions' THEN COALESCE(cardinality(c.localization_solutions), 0) > 0
    WHEN 'deployment_experience' THEN COALESCE(cardinality(c.deployment_experience), 0) > 0
    WHEN 'project_types' THEN COALESCE(cardinality(c.project_types), 0) > 0
    WHEN 'project_scale' THEN COALESCE(c.project_scale, '') <> ''
    WHEN 'skills' THEN EXISTS (SELECT 1 FROM public.consultant_skills x WHERE x.consultant_id = _cid)
    WHEN 'certifications' THEN EXISTS (SELECT 1 FROM public.certifications x WHERE x.consultant_id = _cid)
    WHEN 'work_history' THEN EXISTS (SELECT 1 FROM public.consultant_work_history x WHERE x.consultant_id = _cid)
    WHEN 'education' THEN EXISTS (SELECT 1 FROM public.consultant_education x WHERE x.consultant_id = _cid)
    WHEN 'projects' THEN EXISTS (SELECT 1 FROM public.consultant_projects x WHERE x.consultant_id = _cid)
    WHEN 'availability' THEN EXISTS (SELECT 1 FROM public.availability_slots x WHERE x.consultant_id = _cid)
    WHEN 'cv' THEN COALESCE(c.cv_url, '') <> '' OR EXISTS (SELECT 1 FROM public.consultant_private x WHERE x.consultant_id = _cid AND COALESCE(x.cv_url, '') <> '')
    WHEN 'ai_interview' THEN c.ai_interview_completed_at IS NOT NULL
    WHEN 'bank_details' THEN EXISTS (SELECT 1 FROM public.consultant_payout_details x WHERE x.consultant_id = _cid AND x.acknowledged_at IS NOT NULL)
    ELSE true
  END;
END
$function$;
REVOKE ALL ON FUNCTION public.profile_field_filled(uuid, text) FROM PUBLIC, anon, authenticated;

-- the required fields that are still empty
CREATE OR REPLACE FUNCTION public.consultant_missing_fields(_cid uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT COALESCE(array_agg(r.field_key ORDER BY r.sort_order), ARRAY[]::text[])
    FROM public.profile_field_rules r
   WHERE r.mode = 'required' AND NOT public.profile_field_filled(_cid, r.field_key)
$function$;
REVOKE ALL ON FUNCTION public.consultant_missing_fields(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_missing_profile_fields()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT public.consultant_missing_fields(c.id) FROM public.consultants c WHERE c.user_id = auth.uid()
$function$;
REVOKE ALL ON FUNCTION public.my_missing_profile_fields() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_missing_profile_fields() TO authenticated;

-- administrators: who is incomplete and what is missing
CREATE OR REPLACE FUNCTION public.admin_incomplete_consultants()
RETURNS TABLE(consultant_id uuid, display_name text, verification_status text, missing text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT c.id, COALESCE(p.display_name, ''), c.verification_status::text, public.consultant_missing_fields(c.id)
    FROM public.consultants c LEFT JOIN public.profiles p ON p.user_id = c.user_id
   WHERE public.has_role(auth.uid(), 'admin'::app_role)
     AND cardinality(public.consultant_missing_fields(c.id)) > 0
   ORDER BY 3, 2
$function$;
REVOKE ALL ON FUNCTION public.admin_incomplete_consultants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_incomplete_consultants() TO authenticated;

-- the ids that the client directory and the map must not show (empty while the switch is off)
CREATE OR REPLACE FUNCTION public.hidden_consultant_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[])
    FROM public.consultants c
   WHERE auth.uid() IS NOT NULL
     AND (SELECT enforce FROM public.profile_rules_config WHERE id)
     AND cardinality(public.consultant_missing_fields(c.id)) > 0
$function$;
REVOKE ALL ON FUNCTION public.hidden_consultant_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hidden_consultant_ids() TO authenticated;

-- administrators set the rules (all at once, with a log) and the switch
CREATE OR REPLACE FUNCTION public.admin_set_profile_field_rules(_rules jsonb, _enforce boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _item jsonb;
  _old text;
  _mode text;
  _key text;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF _rules IS NULL OR jsonb_typeof(_rules) <> 'array' OR jsonb_array_length(_rules) > 100 THEN
    RAISE EXCEPTION 'The rules are not valid' USING ERRCODE = '22023';
  END IF;
  FOR _item IN SELECT * FROM jsonb_array_elements(_rules) LOOP
    _key := _item ->> 'field_key';
    _mode := _item ->> 'mode';
    IF _mode NOT IN ('required', 'optional', 'hidden') THEN
      RAISE EXCEPTION 'The mode must be required, optional or hidden' USING ERRCODE = '22023';
    END IF;
    SELECT mode INTO _old FROM public.profile_field_rules WHERE field_key = _key FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unknown profile field %', _key USING ERRCODE = '22023';
    END IF;
    IF _old IS DISTINCT FROM _mode THEN
      UPDATE public.profile_field_rules SET mode = _mode, updated_by = auth.uid(), updated_at = now() WHERE field_key = _key;
      INSERT INTO public.profile_field_rules_log (field_key, old_mode, new_mode, changed_by) VALUES (_key, _old, _mode, auth.uid());
    END IF;
  END LOOP;
  IF _enforce IS NOT NULL THEN
    UPDATE public.profile_rules_config SET enforce = _enforce, updated_by = auth.uid(), updated_at = now() WHERE id AND enforce IS DISTINCT FROM _enforce;
  END IF;
END
$function$;
REVOKE ALL ON FUNCTION public.admin_set_profile_field_rules(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_field_rules(jsonb, boolean) TO authenticated;

-- an incomplete consultant cannot place a NEW bid while the switch is on (revising a bid on the same request is still allowed)
-- helper (definer): is a NEW bid of the signed-in consultant blocked? Only answers for the caller's own consultant row.
CREATE OR REPLACE FUNCTION public.new_bid_blocked_by_profile(_cid uuid, _ticket uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT COALESCE((SELECT enforce FROM public.profile_rules_config WHERE id), false)
     AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _cid AND c.user_id = auth.uid())
     AND NOT EXISTS (SELECT 1 FROM public.proposals p WHERE p.ticket_id = _ticket AND p.consultant_id = _cid)
     AND cardinality(public.consultant_missing_fields(_cid)) > 0
$function$;
REVOKE ALL ON FUNCTION public.new_bid_blocked_by_profile(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.new_bid_blocked_by_profile(uuid, uuid) TO authenticated;

-- trigger function runs as the caller, so is_untrusted_writer() sees the browser role
CREATE OR REPLACE FUNCTION public.guard_bid_profile_complete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN RETURN NEW; END IF;
  IF public.new_bid_blocked_by_profile(NEW.consultant_id, NEW.ticket_id) THEN
    RAISE EXCEPTION 'Please complete your profile before placing a new bid' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS trg_guard_bid_profile_complete ON public.proposals;
CREATE TRIGGER trg_guard_bid_profile_complete BEFORE INSERT ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.guard_bid_profile_complete();
