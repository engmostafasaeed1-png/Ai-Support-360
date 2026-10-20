-- Fix J: the AI interview counts in profile completion (default 15 %, admin-editable).
-- NOT APPLIED by the agent: review and apply it yourself, BEFORE docs/sql/profile-reminders.sql.
-- Additive and idempotent: one platform setting, four functions. No table, column or row is changed or removed,
-- consultant_missing_fields() stays exactly as it is (fields only), and the verified-badge / tier logic
-- (award_ai_interview_rewards) is untouched.
--
-- Completion = (100 - weight) % for the profile items + weight % for a COMPLETED AI interview
-- (pending / never started = 0). The profile items are the same 16 the app shows (Fix K added the mandatory location)
-- (supabase/functions/_shared/profileCompleteness.ts); keep both in step if one changes.

-- 1. Setting (only inserted when missing).
INSERT INTO public.platform_settings (key, value)
VALUES ('profile_interview_weight', '15'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. Public read of the weight (a plain number, needed by client-facing directory and bid cards).
CREATE OR REPLACE FUNCTION public.profile_interview_weight()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LEAST(50, GREATEST(0, COALESCE(
    (SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN round((value #>> '{}')::numeric)::INT
                 WHEN jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^\d{1,2}$' THEN (value #>> '{}')::INT END
       FROM public.platform_settings WHERE key = 'profile_interview_weight'),
    15)));
$$;
REVOKE ALL ON FUNCTION public.profile_interview_weight() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_interview_weight() TO anon, authenticated, service_role;

-- 3. Admin edit (0..50, whole numbers).
CREATE OR REPLACE FUNCTION public.admin_set_profile_interview_weight(_weight INT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF _weight IS NULL OR _weight < 0 OR _weight > 50 THEN
    RAISE EXCEPTION 'The AI interview share must be a whole number from 0 to 50.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_settings (key, value) VALUES ('profile_interview_weight', to_jsonb(_weight))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN _weight;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_profile_interview_weight(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_profile_interview_weight(INT) TO authenticated;

-- 4. One consultant's completion. Readable by the consultant, administrators and the service role only.
--    missing_fields = consultant_missing_fields() (admin-required fields, unchanged);
--    missing_items  = labels of the 16 profile items still missing (location included) (interview reported separately).
CREATE OR REPLACE FUNCTION public.consultant_completion(_cid UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c public.consultants%ROWTYPE;
  v_role TEXT := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  v_weight INT := public.profile_interview_weight();
  v_skills INT;
  v_payout BOOLEAN;
  v_interview BOOLEAN;
  v_items JSONB;
  v_done INT;
  v_total INT;
BEGIN
  SELECT * INTO c FROM public.consultants WHERE id = _cid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_role IS DISTINCT FROM 'service_role'
     AND c.user_id IS DISTINCT FROM auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_skills FROM public.consultant_skills s WHERE s.consultant_id = _cid;
  SELECT EXISTS (SELECT 1 FROM public.consultant_payout_details pd
                 WHERE pd.consultant_id = _cid AND pd.acknowledged_at IS NOT NULL AND pd.acknowledged_version = 'v1')
    INTO v_payout;
  v_interview := c.ai_interview_completed_at IS NOT NULL OR c.ai_interview_badge IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.interview_sessions s
               WHERE s.consultant_id = _cid AND s.interview_type = 'ai' AND s.status IN ('completed', 'reviewed'));

  v_items := jsonb_build_array(
    jsonb_build_object('key', 'location',     'label', 'Location (country and city)', 'done', NULLIF(btrim(c.country), '') IS NOT NULL AND NULLIF(btrim(c.city), '') IS NOT NULL),
    jsonb_build_object('key', 'skills',       'label', 'SAP modules',                'done', v_skills > 0),
    jsonb_build_object('key', 'roles',        'label', 'Roles',                      'done', COALESCE(cardinality(c.sap_roles), 0) > 0),
    jsonb_build_object('key', 'seniority',    'label', 'Seniority and years',        'done', NULLIF(btrim(c.seniority_level), '') IS NOT NULL AND COALESCE(c.total_sap_years, 0) > 0),
    jsonb_build_object('key', 'technologies', 'label', 'Technologies',               'done', COALESCE(cardinality(c.sap_technologies), 0) > 0),
    jsonb_build_object('key', 'industries',   'label', 'Industries',                 'done', COALESCE(cardinality(c.industries), 0) > 0),
    jsonb_build_object('key', 'segments',     'label', 'Customer segments',          'done', COALESCE(cardinality(c.customer_segments), 0) > 0),
    jsonb_build_object('key', 'verticals',    'label', 'Vertical solutions',         'done', COALESCE(cardinality(c.vertical_solutions), 0) > 0),
    jsonb_build_object('key', 'countries',    'label', 'Localization countries',     'done', COALESCE(cardinality(c.localization_countries), 0) > 0),
    jsonb_build_object('key', 'localization', 'label', 'Localization solutions',     'done', COALESCE(cardinality(c.localization_solutions), 0) > 0),
    jsonb_build_object('key', 'projects',     'label', 'Project types',              'done', COALESCE(cardinality(c.project_types), 0) > 0),
    jsonb_build_object('key', 'deployment',   'label', 'Deployment experience',      'done', COALESCE(cardinality(c.deployment_experience), 0) > 0),
    jsonb_build_object('key', 'scale',        'label', 'Project scale',              'done', NULLIF(btrim(c.project_scale), '') IS NOT NULL),
    jsonb_build_object('key', 'work',         'label', 'Work mode and working week', 'done', COALESCE(cardinality(c.work_modes), 0) > 0 AND NULLIF(btrim(c.working_week), '') IS NOT NULL),
    jsonb_build_object('key', 'languages',    'label', 'Language levels',            'done', c.language_levels IS NOT NULL AND jsonb_typeof(c.language_levels) = 'object' AND c.language_levels <> '{}'::jsonb),
    jsonb_build_object('key', 'payout',       'label', 'Bank details for payouts',   'done', v_payout)
  );
  SELECT count(*) FILTER (WHERE (i ->> 'done')::BOOLEAN), count(*) INTO v_done, v_total FROM jsonb_array_elements(v_items) i;

  RETURN jsonb_build_object(
    'percent', round(((100 - v_weight)::numeric * v_done) / v_total + CASE WHEN v_interview THEN v_weight ELSE 0 END)::INT,
    'fields_percent', round(100.0 * v_done / v_total)::INT,
    'fields_complete', v_done = v_total,
    'interview_done', v_interview,
    'interview_weight', v_weight,
    'payout_ready', v_payout,
    'missing_items', COALESCE((SELECT jsonb_agg(i ->> 'label') FROM jsonb_array_elements(v_items) i WHERE NOT (i ->> 'done')::BOOLEAN), '[]'::jsonb),
    'missing_fields', to_jsonb(COALESCE(public.consultant_missing_fields(_cid), ARRAY[]::TEXT[]))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.consultant_completion(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_completion(UUID) TO authenticated, service_role;

-- 5. Sibling of my_missing_profile_fields() for the signed-in consultant.
CREATE OR REPLACE FUNCTION public.my_profile_completion()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.consultant_completion(c.id) FROM public.consultants c WHERE c.user_id = auth.uid() LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.my_profile_completion() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_profile_completion() TO authenticated;

-- Note on duplicate pending AI sessions: the app now resumes the open session (in-progress first, else the newest
-- pending one, also when it is older than 24 h) and never creates another, and the list shows only that one.
-- Older never-started duplicates are kept as they are (no data is deleted; the status type has no "expired" value).
-- To review them: SELECT consultant_id, count(*) FROM public.interview_sessions
--   WHERE interview_type = 'ai' AND status = 'pending' AND started_at IS NULL GROUP BY 1 HAVING count(*) > 1;
