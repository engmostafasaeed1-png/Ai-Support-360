-- Consultant professional roles (all SAP-related jobs): admin-editable catalogue, legacy mapping of consultants.sap_role /
-- sap_roles to catalogue keys, role details for non-technical roles, role-aware required fields, "Type of help needed"
-- on requests (ticket_context.help_roles), suggested rate ranges setting, role interview templates.
-- Mirrored by supabase/functions/_shared/consultantRoles.ts. Prepared, NOT applied. Re-runnable.

-- 1. Catalogue ---------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consultant_role_catalog (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label_en text NOT NULL CHECK (char_length(label_en) BETWEEN 2 AND 80),
  label_ar text NOT NULL CHECK (char_length(label_ar) BETWEEN 2 AND 80),
  category text NOT NULL CHECK (category IN ('delivery_management','architecture','functional','technical','basis_security',
    'data_analytics','integration_btp','testing_quality','change_training','presales_sales','other')),
  enabled boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 500,
  legacy_labels text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.consultant_role_catalog TO anon, authenticated;
GRANT INSERT, UPDATE ON public.consultant_role_catalog TO authenticated;
GRANT ALL ON public.consultant_role_catalog TO service_role;
ALTER TABLE public.consultant_role_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone reads the role catalogue" ON public.consultant_role_catalog;
CREATE POLICY "Everyone reads the role catalogue" ON public.consultant_role_catalog FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins add roles" ON public.consultant_role_catalog;
CREATE POLICY "Admins add roles" ON public.consultant_role_catalog FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
DROP POLICY IF EXISTS "Admins edit roles" ON public.consultant_role_catalog;
CREATE POLICY "Admins edit roles" ON public.consultant_role_catalog FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
-- No DELETE: switch a role off instead, so stored keys keep their label.

INSERT INTO public.consultant_role_catalog (key, category, label_en, label_ar, sort, legacy_labels) VALUES
  ('project_manager','delivery_management','SAP Project Manager','مدير مشروع SAP',10,'{"Project / program manager","Project manager"}'),
  ('program_manager','delivery_management','SAP Program Manager','مدير برنامج SAP',20,'{"Program manager"}'),
  ('delivery_manager','delivery_management','SAP Delivery Manager','مدير تسليم SAP',30,'{"Delivery manager"}'),
  ('pmo_lead','delivery_management','PMO Lead','قائد مكتب إدارة المشاريع (PMO)',40,'{"PMO"}'),
  ('support_manager','delivery_management','SAP Support / AMS Manager','مدير دعم SAP / AMS',50,'{"SAP Support Manager","Support manager"}'),
  ('solution_architect','architecture','SAP Solution Architect','مهندس حلول SAP',60,'{"Solution / enterprise architect","architect","Solution architect"}'),
  ('enterprise_architect','architecture','SAP Enterprise Architect','مهندس معماري مؤسسي SAP',70,'{"Enterprise architect"}'),
  ('technical_architect','architecture','SAP Technical Architect','مهندس معماري تقني SAP',80,'{"Technical architect"}'),
  ('functional_lead','functional','Functional Lead','قائد وظيفي',90,'{"Functional lead"}'),
  ('functional','functional','Functional Consultant','مستشار وظيفي',100,'{"Functional consultant"}'),
  ('techno_functional','functional','Techno-functional Consultant','مستشار تقني-وظيفي',110,'{"Techno-functional"}'),
  ('business_analyst','functional','Business Analyst / Process Consultant','محلل أعمال / مستشار عمليات',120,'{"Business analyst"}'),
  ('technical','technical','Technical Consultant / Developer (ABAP)','مستشار تقني / مطوّر (ABAP)',130,'{"Technical / developer (ABAP, Fiori)","Developer"}'),
  ('fiori_developer','technical','Fiori / UI5 Developer','مطوّر Fiori / UI5',140,'{"Fiori developer"}'),
  ('basis','basis_security','Basis Consultant','مستشار Basis',150,'{"Basis / security / admin","Basis administrator"}'),
  ('security_grc','basis_security','Security & GRC Consultant','مستشار الأمن و GRC',160,'{"Security consultant","GRC consultant"}'),
  ('data_analytics','data_analytics','Data & Analytics Consultant (BW, SAC, Datasphere)','مستشار البيانات والتحليلات (BW, SAC, Datasphere)',170,'{"Data & analytics (BW, SAC, Datasphere)"}'),
  ('data_migration','data_analytics','Data Migration Consultant','مستشار ترحيل البيانات',180,'{"Data migration"}'),
  ('master_data','data_analytics','Master Data / MDG Consultant','مستشار البيانات الرئيسية / MDG',190,'{"MDG consultant"}'),
  ('integration','integration_btp','Integration Consultant (CPI, PI/PO)','مستشار التكامل (CPI, PI/PO)',200,'{"Integration (CPI, PI/PO, BTP)"}'),
  ('btp_developer','integration_btp','BTP Developer / Consultant','مطوّر / مستشار BTP',210,'{"BTP developer"}'),
  ('test_lead','testing_quality','Test / QA Lead','قائد الاختبار والجودة',220,'{"Test manager","QA lead"}'),
  ('tester','testing_quality','Tester','مختبِر',230,'{"Test consultant"}'),
  ('change_lead','change_training','Change Management Lead','قائد إدارة التغيير',240,'{"Change manager"}'),
  ('training_lead','change_training','Training Lead / Trainer','قائد التدريب / مدرّب',250,'{"Trainer"}'),
  ('presales','presales_sales','Pre-sales Consultant','مستشار ما قبل البيع',260,'{"Pre-sales"}'),
  ('solution_sales','presales_sales','Sales / Solution Consultant','مستشار مبيعات / حلول',270,'{"Sales consultant","Solution consultant"}'),
  ('other','other','Other SAP role','دور SAP آخر',999,'{}')
ON CONFLICT (key) DO NOTHING;

-- 2. Mapping helpers ---------------------------------------------------------------------------------------------------
-- Catalogue key for a stored value (key, English/Arabic label or legacy label, case-insensitive); NULL when unknown.
CREATE OR REPLACE FUNCTION public.consultant_role_key(_v text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.key FROM public.consultant_role_catalog c
   WHERE NULLIF(btrim(_v), '') IS NOT NULL
     AND (c.key = lower(btrim(_v)) OR lower(c.label_en) = lower(btrim(_v)) OR c.label_ar = btrim(_v)
          OR EXISTS (SELECT 1 FROM unnest(c.legacy_labels) l WHERE lower(l) = lower(btrim(_v))))
   ORDER BY c.sort LIMIT 1
$$;

-- Roles as keys, primary first, duplicates removed; unknown legacy text is kept as typed (counts as "Other").
CREATE OR REPLACE FUNCTION public.consultant_roles_normalize(_roles text[], _primary text)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out text[] := ARRAY[]::text[]; _v text; _k text;
BEGIN
  FOREACH _v IN ARRAY (ARRAY[COALESCE(_primary, '')] || COALESCE(_roles, ARRAY[]::text[])) LOOP
    IF NULLIF(btrim(_v), '') IS NULL THEN CONTINUE; END IF;
    _k := COALESCE(public.consultant_role_key(_v), left(btrim(_v), 80));
    IF NOT EXISTS (SELECT 1 FROM unnest(_out) o WHERE lower(o) = lower(_k)) THEN _out := _out || _k; END IF;
  END LOOP;
  RETURN _out;
END $$;

-- 3. Role details (non-technical roles) --------------------------------------------------------------------------------
ALTER TABLE public.consultants ADD COLUMN IF NOT EXISTS role_details jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.consultants.role_details IS
  'Role-specific profile details: methodologies[], team_size_managed, solution_areas[], presales_experience (see consultant-roles.sql)';

CREATE OR REPLACE FUNCTION public.consultant_roles_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _k text; _v jsonb;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.sap_roles IS DISTINCT FROM OLD.sap_roles OR NEW.sap_role IS DISTINCT FROM OLD.sap_role THEN
    NEW.sap_roles := public.consultant_roles_normalize(NEW.sap_roles,
      CASE WHEN TG_OP = 'UPDATE' AND NEW.sap_role IS NOT DISTINCT FROM OLD.sap_role THEN NULL ELSE NEW.sap_role END);
    -- One primary + up to 4 more; older profiles with more roles may keep them but cannot add more.
    IF cardinality(NEW.sap_roles) > 5 AND (TG_OP = 'INSERT' OR cardinality(NEW.sap_roles) > COALESCE(cardinality(OLD.sap_roles), 0)) THEN
      RAISE EXCEPTION 'too_many_roles' USING ERRCODE = '22023', HINT = 'Choose one main role and up to 4 more.';
    END IF;
    NEW.sap_role := CASE WHEN cardinality(NEW.sap_roles) = 0 THEN NULL
                         ELSE COALESCE(public.consultant_role_key(NEW.sap_roles[1]), 'other') END;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.role_details IS DISTINCT FROM OLD.role_details THEN
    NEW.role_details := COALESCE(NEW.role_details, '{}'::jsonb);
    IF jsonb_typeof(NEW.role_details) <> 'object' OR octet_length(NEW.role_details::text) > 4000 THEN
      RAISE EXCEPTION 'role_details_invalid' USING ERRCODE = '22023';
    END IF;
    FOR _k, _v IN SELECT key, value FROM jsonb_each(NEW.role_details) LOOP
      IF _k IN ('methodologies', 'solution_areas') THEN
        IF jsonb_typeof(_v) <> 'array' OR jsonb_array_length(_v) > 12 OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(_v) e WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') > 80
                OR public.contact_details_in_text(e #>> '{}')) THEN
          RAISE EXCEPTION 'role_details_invalid' USING ERRCODE = '22023';
        END IF;
      ELSIF _k = 'team_size_managed' THEN
        IF jsonb_typeof(_v) <> 'number' OR (_v)::numeric < 0 OR (_v)::numeric > 10000 THEN
          RAISE EXCEPTION 'role_details_invalid' USING ERRCODE = '22023';
        END IF;
      ELSIF _k = 'presales_experience' THEN
        IF jsonb_typeof(_v) <> 'string' OR char_length(_v #>> '{}') > 600 OR public.contact_details_in_text(_v #>> '{}') THEN
          RAISE EXCEPTION 'role_details_invalid' USING ERRCODE = '22023';
        END IF;
      ELSE
        RAISE EXCEPTION 'role_details_invalid' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
-- The old fixed list of 8 main-role keys becomes "any catalogue key" (the trigger maps every value to the catalogue).
ALTER TABLE public.consultants DROP CONSTRAINT IF EXISTS consultants_sap_role_chk;
ALTER TABLE public.consultants ADD CONSTRAINT consultants_sap_role_chk
  CHECK (sap_role IS NULL OR sap_role ~ '^[a-z][a-z0-9_]{1,39}$');

DROP TRIGGER IF EXISTS trg_consultant_roles_guard ON public.consultants;
CREATE TRIGGER trg_consultant_roles_guard BEFORE INSERT OR UPDATE OF sap_role, sap_roles, role_details ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.consultant_roles_guard();

-- Backfill: labels and old keys become catalogue keys (the trigger normalises; profiles with no role stay empty).
UPDATE public.consultants SET sap_roles = public.consultant_roles_normalize(sap_roles, sap_role)
 WHERE COALESCE(cardinality(sap_roles), 0) > 0 OR NULLIF(btrim(sap_role), '') IS NOT NULL;

-- 4. Role-aware required fields ----------------------------------------------------------------------------------------
INSERT INTO public.profile_field_rules (field_key, section, label, mode, default_mode, sort_order) VALUES
  ('methodologies', 'Experience', 'Delivery methodologies (managers, architects)', 'optional', 'optional', 222),
  ('team_size_managed', 'Experience', 'Team size managed (managers)', 'optional', 'optional', 224),
  ('solution_areas', 'Experience', 'Solution areas (pre-sales, architects)', 'optional', 'optional', 226),
  ('presales_experience', 'Experience', 'Deal and demo experience (pre-sales)', 'optional', 'optional', 228)
ON CONFLICT (field_key) DO NOTHING;

-- Same category lists as ROLE_FIELD_CATEGORIES in _shared/consultantRoles.ts.
CREATE OR REPLACE FUNCTION public.consultant_field_applies(_cid uuid, _key text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _allowed text[];
  _detail boolean := _key IN ('methodologies','team_size_managed','solution_areas','presales_experience');
  _cats text[];
BEGIN
  _allowed := CASE _key
    WHEN 'sap_technologies' THEN ARRAY['functional','technical','basis_security','data_analytics','integration_btp','architecture','testing_quality']
    WHEN 'certifications'   THEN ARRAY['functional','technical','basis_security','data_analytics','integration_btp','architecture','testing_quality']
    WHEN 'methodologies'    THEN ARRAY['delivery_management','architecture','testing_quality','change_training']
    WHEN 'team_size_managed' THEN ARRAY['delivery_management','architecture','testing_quality','change_training']
    WHEN 'solution_areas'   THEN ARRAY['presales_sales','architecture']
    WHEN 'presales_experience' THEN ARRAY['presales_sales']
  END;
  IF _allowed IS NULL THEN RETURN true; END IF;
  SELECT array_agg(DISTINCT COALESCE((SELECT k.category FROM public.consultant_role_catalog k WHERE k.key = public.consultant_role_key(r)), 'other'))
    INTO _cats
    FROM public.consultants c, unnest(COALESCE(c.sap_roles, ARRAY[]::text[])) r
   WHERE c.id = _cid AND NULLIF(btrim(r), '') IS NOT NULL;
  IF _cats IS NULL THEN RETURN NOT _detail; END IF;  -- no roles yet: today's fields apply, new detail fields do not
  RETURN _cats && _allowed OR ('other' = ANY (_cats) AND NOT _detail);
END $$;

CREATE OR REPLACE FUNCTION public.consultant_role_detail_filled(_cid uuid, _key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE _key
    WHEN 'team_size_managed' THEN jsonb_typeof(c.role_details -> _key) = 'number'
    WHEN 'presales_experience' THEN char_length(btrim(COALESCE(c.role_details ->> _key, ''))) >= 10
    ELSE jsonb_typeof(c.role_details -> _key) = 'array' AND jsonb_array_length(c.role_details -> _key) > 0
  END FROM public.consultants c WHERE c.id = _cid
$$;

-- Required fields still missing: admin rule + field applies to the consultant's roles (never technical fields for
-- managers or pre-sales only). Same signature and result type as before.
CREATE OR REPLACE FUNCTION public.consultant_missing_fields(_cid uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(r.field_key ORDER BY r.sort_order), ARRAY[]::text[])
    FROM public.profile_field_rules r
   WHERE r.mode = 'required'
     AND public.consultant_field_applies(_cid, r.field_key)
     AND NOT CASE WHEN r.field_key IN ('methodologies','team_size_managed','solution_areas','presales_experience')
                  THEN COALESCE(public.consultant_role_detail_filled(_cid, r.field_key), false)
                  ELSE public.profile_field_filled(_cid, r.field_key) END
$$;

-- 5. "Type of help needed" on requests: ticket_context.help_roles (catalogue keys). Same body as before plus that key.
CREATE OR REPLACE FUNCTION public.guard_ticket_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _k text;
  _v jsonb;
BEGIN
  IF NEW.ticket_context IS NOT DISTINCT FROM '{}'::jsonb OR NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.ticket_context) <> 'object' OR octet_length(NEW.ticket_context::text) > 4000 THEN
    RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
  END IF;
  FOR _k, _v IN SELECT key, value FROM jsonb_each(NEW.ticket_context) LOOP
    IF _k NOT IN ('industry', 'customer_segment', 'country', 'project_type', 'vertical_solutions', 'localization_solutions',
                  'deployment', 'work_mode', 'budget_max_rate', 'help_roles') THEN
      RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
    END IF;
    IF _k = 'budget_max_rate' AND jsonb_typeof(_v) = 'string' AND (_v #>> '{}') !~ '^[0-9]{1,5}(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
    END IF;
    IF _k = 'help_roles' AND (jsonb_typeof(_v) <> 'array' OR jsonb_array_length(_v) > 8 OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(_v) e
          WHERE jsonb_typeof(e) <> 'string' OR NOT EXISTS (SELECT 1 FROM public.consultant_role_catalog c WHERE c.key = e #>> '{}'))) THEN
      RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(_v) = 'string' THEN
      IF char_length(_v #>> '{}') > 160 OR public.contact_details_in_text(_v #>> '{}') THEN
        RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
      END IF;
    ELSIF jsonb_typeof(_v) = 'array' THEN
      IF jsonb_array_length(_v) > 12 OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(_v) e
         WHERE jsonb_typeof(e) <> 'string' OR char_length(e #>> '{}') > 160 OR public.contact_details_in_text(e #>> '{}')
      ) THEN
        RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
      END IF;
    ELSIF jsonb_typeof(_v) <> 'null' THEN
      RAISE EXCEPTION 'The request context is not valid' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

-- 6. Settings: optional suggested hourly-rate range per category (admin edits; signed-in users read). -------------------
INSERT INTO public.platform_settings (key, value) VALUES ('consultant_roles', '{"rate_ranges": {}}'::jsonb)
ON CONFLICT (key) DO NOTHING;
DROP POLICY IF EXISTS "Signed-in users can read consultant_roles" ON public.platform_settings;
CREATE POLICY "Signed-in users can read consultant_roles" ON public.platform_settings FOR SELECT TO authenticated
  USING (key = 'consultant_roles');

-- 7. Interview templates per role category (general area; admins can edit or switch them off). ------------------------
ALTER TABLE public.interview_templates DROP CONSTRAINT IF EXISTS interview_templates_role_focus_check;
ALTER TABLE public.interview_templates ADD CONSTRAINT interview_templates_role_focus_check
  CHECK (role_focus IN ('any', 'functional', 'technical', 'architect', 'manager', 'presales'));
INSERT INTO public.interview_templates (sap_module, seniority, role_focus, title, focus_areas, instructions, sample_questions, question_count, is_active)
SELECT 'general', 'any', v.role_focus, v.title, v.focus_areas, v.instructions, v.sample_questions, 8, true
  FROM (VALUES
    ('manager', 'SAP delivery and project management',
     'Delivery method (SAP Activate, hybrid), planning and estimation, risk and issue management, stakeholder and steering committee, budget and change control, governance, cut-over and hypercare, leading mixed teams',
     'Ask scenario questions about real SAP projects. Do not test configuration or code. Score delivery judgement and leadership.',
     'How did you recover an SAP project that was behind plan? | How do you run a steering committee when scope keeps growing? | What goes into a cut-over plan and who signs it off?'),
    ('architect', 'SAP solution architecture',
     'Design trade-offs, landscape and deployment (on-premise, RISE, public cloud), clean core and extensibility, integration patterns, security and authorisation design, data volume and performance',
     'Ask the candidate to justify decisions and compare options. Do not test transaction codes or code syntax.',
     'When would you extend side-by-side on BTP instead of in-app? | How do you design integration between S/4HANA and a third-party WMS? | What drives your choice between RISE and public cloud?'),
    ('presales', 'SAP pre-sales and solution sales',
     'Customer discovery, solution positioning, demo preparation and delivery, proposal and scope writing, objection handling, SAP licensing basics (concepts only)',
     'Never ask for or accept concrete prices, discounts or commercial promises. Do not test configuration or code.',
     'How do you run a discovery workshop with a CFO? | How do you build a demo story for a distribution company? | A customer says the cloud is too risky: how do you respond?')
  ) AS v(role_focus, title, focus_areas, instructions, sample_questions)
 WHERE NOT EXISTS (SELECT 1 FROM public.interview_templates t WHERE t.sap_module = 'general' AND t.role_focus = v.role_focus);
