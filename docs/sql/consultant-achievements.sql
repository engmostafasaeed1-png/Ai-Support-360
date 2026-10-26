-- Success stories & achievements (all roles). RPC-only writes with owner check, RLS, rate limits, admin review with
-- audit, private evidence files, client-name and contact-detail filters, "Success stories" item in profile completion.
-- Mirrored by src/lib/achievements.ts. Prepared, NOT applied. Run after consultant-roles.sql. Re-runnable.
-- Storage: create the private bucket 'achievement-evidence' (5 MB, PDF/PNG/JPEG/DOCX) with the storage tool when applying.

CREATE TABLE IF NOT EXISTS public.consultant_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  role_played text CHECK (role_played IS NULL OR role_played ~ '^[a-z][a-z0-9_]{1,39}$'),
  sap_area text CHECK (sap_area IS NULL OR char_length(sap_area) <= 80),
  sap_version text CHECK (sap_version IS NULL OR char_length(sap_version) <= 40),
  industry text CHECK (industry IS NULL OR char_length(industry) <= 80),
  outcome text NOT NULL CHECK (char_length(outcome) BETWEEN 10 AND 400),
  year integer CHECK (year IS NULL OR year BETWEEN 1980 AND 2100),
  reference_url text CHECK (reference_url IS NULL OR char_length(reference_url) <= 300),
  evidence_path text,
  is_public boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'self_declared' CHECK (status IN ('self_declared', 'verified', 'hidden', 'rejected')),
  review_reason text CHECK (review_reason IS NULL OR char_length(review_reason) <= 500),
  reviewed_by uuid,
  reviewed_at timestamptz,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consultant_achievements_consultant_idx ON public.consultant_achievements (consultant_id, sort);

-- Reads: named columns only (evidence path and review details stay out; owners and admins read them through RPCs).
REVOKE ALL ON public.consultant_achievements FROM anon, authenticated;
GRANT SELECT (id, consultant_id, title, role_played, sap_area, sap_version, industry, outcome, year, reference_url, is_public, status, sort, created_at, updated_at)
  ON public.consultant_achievements TO authenticated;
GRANT ALL ON public.consultant_achievements TO service_role;
ALTER TABLE public.consultant_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Achievements: owner, admins, public visible ones" ON public.consultant_achievements;
CREATE POLICY "Achievements: owner, admins, public visible ones" ON public.consultant_achievements FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  -- Public entries of consultants the viewer may see (the consultants policy applies inside this subquery).
  OR (is_public AND status IN ('self_declared', 'verified') AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id))
);
-- No INSERT/UPDATE/DELETE policies: writes only through the functions below.

-- Text problem: 'contact_details' or 'client_name' (a client company registered on the platform), else NULL.
CREATE OR REPLACE FUNCTION public.achievement_text_problem(_text text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _text IS NULL OR btrim(_text) = '' THEN RETURN NULL; END IF;
  IF public.contact_details_in_text(_text) THEN RETURN 'contact_details'; END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT btrim(company_name) AS n FROM public.client_profiles WHERE char_length(btrim(COALESCE(company_name, ''))) >= 4
      UNION SELECT btrim(name) FROM public.tenants WHERE char_length(btrim(COALESCE(name, ''))) >= 4
    ) x WHERE _text ~* ('(^|[^[:alnum:]])' || regexp_replace(x.n, '([\.\^\$\*\+\?\(\)\[\]\{\}\|\\])', '\\\1', 'g') || '($|[^[:alnum:]])')
  ) THEN RETURN 'client_name'; END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.achievement_text_problem(text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.achievement_url_ok(_url text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _url IS NULL OR (
    _url ~* '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^\s@]*)?$'
    AND _url !~* '^https://(\d+\.){3}\d+'
    AND _url !~* '^https://(www\.)?(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|cutt\.ly|wa\.me|t\.me)(/|$)'
    AND char_length(_url) <= 300)
$$;

CREATE OR REPLACE FUNCTION public.my_consultant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.consultants WHERE user_id = auth.uid()
$$;

-- Create (_id NULL) or edit an own entry. Editing a verified entry makes it self-declared again; hidden/rejected stay so.
CREATE OR REPLACE FUNCTION public.my_achievement_save(_id uuid, _data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cid uuid := public.my_consultant_id();
  _row public.consultant_achievements;
  _title text := left(btrim(COALESCE(_data ->> 'title', '')), 120);
  _outcome text := left(btrim(COALESCE(_data ->> 'outcome', '')), 400);
  _role text := NULLIF(btrim(COALESCE(_data ->> 'role_played', '')), '');
  _area text := NULLIF(left(btrim(COALESCE(_data ->> 'sap_area', '')), 80), '');
  _version text := NULLIF(left(btrim(COALESCE(_data ->> 'sap_version', '')), 40), '');
  _industry text := NULLIF(left(btrim(COALESCE(_data ->> 'industry', '')), 80), '');
  _url text := NULLIF(btrim(COALESCE(_data ->> 'reference_url', '')), '');
  _year int := NULLIF(_data ->> 'year', '')::int;
  _problem text;
BEGIN
  IF _cid IS NULL THEN RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501'; END IF;
  IF NOT public.check_rate_limit('achievement:' || _cid, 30, 3600) THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'P0001'; END IF;
  IF char_length(_title) < 3 OR char_length(_outcome) < 10 THEN RAISE EXCEPTION 'achievement_incomplete' USING ERRCODE = '22023'; END IF;
  IF _year IS NOT NULL AND (_year < 1980 OR _year > extract(year FROM now())::int) THEN RAISE EXCEPTION 'achievement_year' USING ERRCODE = '22023'; END IF;
  IF _role IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.consultant_role_catalog k WHERE k.key = _role) THEN RAISE EXCEPTION 'achievement_role' USING ERRCODE = '22023'; END IF;
  IF NOT public.achievement_url_ok(_url) THEN RAISE EXCEPTION 'achievement_link' USING ERRCODE = '22023'; END IF;
  _problem := COALESCE(public.achievement_text_problem(_title), public.achievement_text_problem(_outcome),
                       public.achievement_text_problem(_area), public.achievement_text_problem(_industry), public.achievement_text_problem(_version));
  IF _problem IS NOT NULL THEN RAISE EXCEPTION 'achievement_%', _problem USING ERRCODE = '22023'; END IF;

  IF _id IS NULL THEN
    IF (SELECT count(*) FROM public.consultant_achievements WHERE consultant_id = _cid) >= 8 THEN
      RAISE EXCEPTION 'achievement_limit' USING ERRCODE = '22023', HINT = 'Up to 8 success stories.';
    END IF;
    INSERT INTO public.consultant_achievements (consultant_id, title, role_played, sap_area, sap_version, industry, outcome, year, reference_url, is_public, sort)
    VALUES (_cid, _title, _role, _area, _version, _industry, _outcome, _year, _url, COALESCE((_data ->> 'is_public')::boolean, false),
            (SELECT COALESCE(max(sort), 0) + 1 FROM public.consultant_achievements WHERE consultant_id = _cid))
    RETURNING * INTO _row;
  ELSE
    UPDATE public.consultant_achievements SET title = _title, role_played = _role, sap_area = _area, sap_version = _version, industry = _industry,
      outcome = _outcome, year = _year, reference_url = _url, updated_at = now(),
      status = CASE WHEN status = 'verified' THEN 'self_declared' ELSE status END
     WHERE id = _id AND consultant_id = _cid RETURNING * INTO _row;
    IF NOT FOUND THEN RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN _row.id;
END $$;

CREATE OR REPLACE FUNCTION public.my_achievement_set_public(_id uuid, _public boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.consultant_achievements SET is_public = COALESCE(_public, false), updated_at = now()
   WHERE id = _id AND consultant_id = public.my_consultant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.my_achievement_delete(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.consultant_achievements WHERE id = _id AND consultant_id = public.my_consultant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501'; END IF;
END $$;

-- Evidence file in the private bucket, under the owner's folder: "<user id>/<achievement id>/<file>".
CREATE OR REPLACE FUNCTION public.my_achievement_set_evidence(_id uuid, _path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _path IS NOT NULL AND (_path NOT LIKE auth.uid()::text || '/' || _id::text || '/%' OR char_length(_path) > 300 OR _path ~ '\.\.') THEN
    RAISE EXCEPTION 'achievement_evidence' USING ERRCODE = '22023';
  END IF;
  UPDATE public.consultant_achievements SET evidence_path = _path, updated_at = now()
   WHERE id = _id AND consultant_id = public.my_consultant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501'; END IF;
END $$;

-- The owner's entries with status, admin reason and whether evidence was added.
CREATE OR REPLACE FUNCTION public.my_achievements()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'role_played', a.role_played, 'sap_area', a.sap_area,
    'sap_version', a.sap_version, 'industry', a.industry, 'outcome', a.outcome, 'year', a.year, 'reference_url', a.reference_url,
    'is_public', a.is_public, 'status', a.status, 'review_reason', a.review_reason, 'has_evidence', a.evidence_path IS NOT NULL) ORDER BY a.sort), '[]'::jsonb)
  FROM public.consultant_achievements a WHERE a.consultant_id = public.my_consultant_id()
$$;

-- Admin review list (all statuses or one), with evidence path for a signed download.
CREATE OR REPLACE FUNCTION public.admin_achievements(_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'consultant_id', a.consultant_id,
      'consultant_name', COALESCE((SELECT p.display_name FROM public.profiles p JOIN public.consultants c ON c.user_id = p.user_id WHERE c.id = a.consultant_id), ''),
      'title', a.title, 'role_played', a.role_played, 'sap_area', a.sap_area, 'industry', a.industry, 'outcome', a.outcome, 'year', a.year,
      'reference_url', a.reference_url, 'evidence_path', a.evidence_path, 'is_public', a.is_public, 'status', a.status,
      'review_reason', a.review_reason, 'updated_at', a.updated_at) ORDER BY a.updated_at DESC)
    FROM (SELECT * FROM public.consultant_achievements WHERE _status IS NULL OR status = _status ORDER BY updated_at DESC LIMIT 300) a), '[]'::jsonb);
END $$;

-- verify (needs evidence or a reference link), hide / reject (reason required), restore. Audited.
CREATE OR REPLACE FUNCTION public.admin_achievement_review(_id uuid, _action text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a public.consultant_achievements; _new text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _a FROM public.consultant_achievements WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  _new := CASE _action WHEN 'verify' THEN 'verified' WHEN 'hide' THEN 'hidden' WHEN 'reject' THEN 'rejected' WHEN 'restore' THEN 'self_declared' END;
  IF _new IS NULL THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023'; END IF;
  IF _action IN ('hide', 'reject') AND char_length(btrim(COALESCE(_reason, ''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF _action = 'verify' AND _a.evidence_path IS NULL AND _a.reference_url IS NULL THEN RAISE EXCEPTION 'achievement_no_evidence' USING ERRCODE = '22023'; END IF;
  UPDATE public.consultant_achievements SET status = _new, review_reason = NULLIF(left(btrim(COALESCE(_reason, '')), 500), ''),
    reviewed_by = auth.uid(), reviewed_at = now() WHERE id = _id;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'achievement_' || _action, 'consultant_achievement', _id,
          jsonb_build_object('consultant_id', _a.consultant_id, 'from', _a.status, 'to', _new, 'reason', left(COALESCE(_reason, ''), 500)));
END $$;

REVOKE ALL ON FUNCTION public.my_achievement_save(uuid, jsonb), public.my_achievement_set_public(uuid, boolean), public.my_achievement_delete(uuid),
  public.my_achievement_set_evidence(uuid, text), public.my_achievements(), public.admin_achievements(text),
  public.admin_achievement_review(uuid, text, text), public.my_consultant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_achievement_save(uuid, jsonb), public.my_achievement_set_public(uuid, boolean), public.my_achievement_delete(uuid),
  public.my_achievement_set_evidence(uuid, text), public.my_achievements(), public.admin_achievements(text),
  public.admin_achievement_review(uuid, text, text) TO authenticated;

-- Evidence files: owner folder only; admins read for review.
DROP POLICY IF EXISTS "Achievement evidence: owner uploads" ON storage.objects;
CREATE POLICY "Achievement evidence: owner uploads" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'achievement-evidence' AND (auth.uid())::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "Achievement evidence: owner and admins read" ON storage.objects;
CREATE POLICY "Achievement evidence: owner and admins read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'achievement-evidence' AND ((auth.uid())::text = (storage.foldername(name))[1]
         OR public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)));
DROP POLICY IF EXISTS "Achievement evidence: owner deletes" ON storage.objects;
CREATE POLICY "Achievement evidence: owner deletes" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'achievement-evidence' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Profile completion: same body as live consultant_completion plus the optional "Success stories" item. It counts in the
-- percent only; fields_complete and missing_items leave it out, so profile reminders never ask for it.
CREATE OR REPLACE FUNCTION public.consultant_completion(_cid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.consultants%ROWTYPE;
  v_role TEXT := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  v_weight INT := public.profile_interview_weight();
  v_skills INT;
  v_payout BOOLEAN;
  v_interview BOOLEAN;
  v_stories INT;
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
  SELECT count(*) INTO v_stories FROM public.consultant_achievements a WHERE a.consultant_id = _cid AND a.status IN ('self_declared', 'verified');
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
    jsonb_build_object('key', 'achievements', 'label', 'Success stories',            'done', v_stories > 0),
    jsonb_build_object('key', 'payout',       'label', 'Bank details for payouts',   'done', v_payout)
  );
  SELECT count(*) FILTER (WHERE (i ->> 'done')::BOOLEAN), count(*) INTO v_done, v_total FROM jsonb_array_elements(v_items) i;

  RETURN jsonb_build_object(
    'percent', round(((100 - v_weight)::numeric * v_done) / v_total + CASE WHEN v_interview THEN v_weight ELSE 0 END)::INT,
    'fields_percent', round(100.0 * v_done / v_total)::INT,
    'fields_complete', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) i WHERE NOT (i ->> 'done')::BOOLEAN AND i ->> 'key' <> 'achievements'),
    'interview_done', v_interview,
    'interview_weight', v_weight,
    'payout_ready', v_payout,
    'missing_items', COALESCE((SELECT jsonb_agg(i ->> 'label') FROM jsonb_array_elements(v_items) i WHERE NOT (i ->> 'done')::BOOLEAN AND i ->> 'key' <> 'achievements'), '[]'::jsonb),
    'missing_fields', to_jsonb(COALESCE(public.consultant_missing_fields(_cid), ARRAY[]::TEXT[]))
  );
END;
$function$;
