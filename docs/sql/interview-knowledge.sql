-- AI Interviewer Training: knowledge-based, profile-specific interview questions + admin knowledge documents.
-- PREPARED, NOT APPLIED. The owner reviews and applies it; then run docs/sql/interview-knowledge.test.sql (rolled back).
-- Re-runnable: every statement is IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
--
-- What it adds
--   1. consultant_skills.sap_version          optional "version / release" per profile module (+ admin-editable choices)
--   2. interview_knowledge_documents/_chunks   admin-only knowledge documents and their search chunks (full-text, no vectors)
--   3. interview_plans                         the cached per-session plan and question set (key points stay here)
--   4. interview_question_log                  hash of every planned question per consultant (never asked twice)
--   5. interview_answers.question_source       why a question was asked (admins only; consultants cannot read the column)
--   6. functions: ik_search_chunks, ik_claim_document (service only), ik_coverage, admin_interview_question_sources
--      (admins), ik_public_enabled (signed-in users: only "is the feature on")
--   7. storage policy for the private bucket "interview-knowledge" (admins may read; only the server function writes).
--      The bucket itself is created by the interview-knowledge function on the first upload (private, 10 MB).
-- The feature stays OFF until an administrator switches "Use knowledge base for interview questions" on
-- (platform_settings key interview_knowledge, enabled=false by default; nothing is inserted here).

-- ---------------------------------------------------------------------------------------------------------------
-- Helpers

CREATE OR REPLACE FUNCTION public.ik_is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role IN ('admin', 'super_admin'))
$$;
REVOKE EXECUTE ON FUNCTION public.ik_is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ik_is_admin(uuid) TO authenticated, service_role;

-- "SAP FI", "fi", " S/4HANA Finance " -> comparable keys (same rule as moduleKey in _shared/interviewPlan.ts)
CREATE OR REPLACE FUNCTION public.ik_module_key(_m text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT btrim(regexp_replace(regexp_replace(lower(coalesce(_m, '')), '^sap\s+', ''), '[^a-z0-9/\u0600-\u06ff]+', ' ', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.ik_same_module(_a text, _b text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT public.ik_module_key(_a) <> '' AND public.ik_module_key(_b) <> '' AND (
    public.ik_module_key(_a) = public.ik_module_key(_b)
    OR position(' ' || public.ik_module_key(_b) || ' ' IN ' ' || public.ik_module_key(_a) || ' ') > 0
    OR position(' ' || public.ik_module_key(_a) || ' ' IN ' ' || public.ik_module_key(_b) || ' ') > 0)
$$;

CREATE OR REPLACE FUNCTION public.ik_version_key(_v text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT nullif(btrim(regexp_replace(lower(coalesce(_v, '')), '\s+', ' ', 'g')), '')
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Version / release per profile module

ALTER TABLE public.consultant_skills ADD COLUMN IF NOT EXISTS sap_version text;
DO $$ BEGIN
  ALTER TABLE public.consultant_skills ADD CONSTRAINT consultant_skills_sap_version_check
    CHECK (sap_version IS NULL OR (char_length(btrim(sap_version)) BETWEEN 1 AND 60 AND sap_version !~ '[<>\[\]{}]'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.consultant_skills.sap_version IS 'Optional version / release of this module (e.g. S/4HANA 2023, ECC 6.0 EHP8). Used by the AI interview plan.';

-- Admin-editable release choices per product family (module_key = family from _shared/sapVersions.ts).
-- Families without rows use the built-in defaults; consultants can always type their own value.
CREATE TABLE IF NOT EXISTS public.sap_version_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_key text NOT NULL CHECK (module_key ~ '^[a-z0-9_]{2,30}$'),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 60 AND label !~ '[<>\[\]{}]'),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_key, label)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sap_version_options TO authenticated;
GRANT ALL ON public.sap_version_options TO service_role;
ALTER TABLE public.sap_version_options ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Signed-in users read version options" ON public.sap_version_options;
CREATE POLICY "Signed-in users read version options" ON public.sap_version_options FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage version options" ON public.sap_version_options;
CREATE POLICY "Admins manage version options" ON public.sap_version_options FOR ALL TO authenticated
  USING (public.ik_is_admin(auth.uid())) WITH CHECK (public.ik_is_admin(auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Knowledge documents (admin only; written only by the interview-knowledge function with the service role)

CREATE TABLE IF NOT EXISTS public.interview_knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  sap_module text NOT NULL CHECK (char_length(btrim(sap_module)) BETWEEN 1 AND 120),
  sap_version text CHECK (sap_version IS NULL OR char_length(btrim(sap_version)) BETWEEN 1 AND 60),
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar', 'de', 'fr', 'es', 'other')),
  tags text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 20),
  enabled boolean NOT NULL DEFAULT true,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  file_name text NOT NULL CHECK (file_name ~ '^[A-Za-z0-9._-]{1,90}$'),
  storage_path text NOT NULL UNIQUE CHECK (storage_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,90}$'),
  file_kind text NOT NULL CHECK (file_kind IN ('pdf', 'docx', 'txt', 'md')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'extracting', 'ready', 'no_text', 'failed')),
  status_reason text CHECK (status_reason IS NULL OR char_length(status_reason) <= 300),
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count BETWEEN 0 AND 300),
  text_chars integer NOT NULL DEFAULT 0 CHECK (text_chars >= 0),
  pii_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  rights_confirmed boolean NOT NULL CHECK (rights_confirmed),
  rights_confirmed_by uuid NOT NULL,
  rights_confirmed_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by uuid NOT NULL,
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS interview_knowledge_documents_sha ON public.interview_knowledge_documents (sha256);
CREATE INDEX IF NOT EXISTS interview_knowledge_documents_module ON public.interview_knowledge_documents (public.ik_module_key(sap_module));
GRANT SELECT ON public.interview_knowledge_documents TO authenticated;
GRANT ALL ON public.interview_knowledge_documents TO service_role;
ALTER TABLE public.interview_knowledge_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read knowledge documents" ON public.interview_knowledge_documents;
CREATE POLICY "Admins read knowledge documents" ON public.interview_knowledge_documents FOR SELECT TO authenticated USING (public.ik_is_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.interview_knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.interview_knowledge_documents(id) ON DELETE CASCADE,
  chunk_no integer NOT NULL CHECK (chunk_no BETWEEN 1 AND 300),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  sap_module text NOT NULL,
  sap_version text,
  tags text[] NOT NULL DEFAULT '{}',
  language text NOT NULL DEFAULT 'en',
  tsv tsvector,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_no)
);
CREATE INDEX IF NOT EXISTS interview_knowledge_chunks_tsv ON public.interview_knowledge_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS interview_knowledge_chunks_module ON public.interview_knowledge_chunks (public.ik_module_key(sap_module));
GRANT SELECT ON public.interview_knowledge_chunks TO authenticated;
GRANT ALL ON public.interview_knowledge_chunks TO service_role;
ALTER TABLE public.interview_knowledge_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read knowledge chunks" ON public.interview_knowledge_chunks;
CREATE POLICY "Admins read knowledge chunks" ON public.interview_knowledge_chunks FOR SELECT TO authenticated USING (public.ik_is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.ik_chunk_tsv()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.tsv := to_tsvector('simple', coalesce(NEW.sap_module, '') || ' ' || coalesce(NEW.sap_version, '') || ' '
    || coalesce(array_to_string(NEW.tags, ' '), '') || ' ' || coalesce(NEW.body, ''));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ik_chunk_tsv ON public.interview_knowledge_chunks;
CREATE TRIGGER ik_chunk_tsv BEFORE INSERT OR UPDATE OF body, sap_module, sap_version, tags ON public.interview_knowledge_chunks
  FOR EACH ROW EXECUTE FUNCTION public.ik_chunk_tsv();

-- Chunks carry a copy of module / version / tags / language for filtering; keep them in step with the document.
CREATE OR REPLACE FUNCTION public.ik_document_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND (NEW.sap_module, NEW.sap_version, NEW.tags, NEW.language) IS DISTINCT FROM (OLD.sap_module, OLD.sap_version, OLD.tags, OLD.language) THEN
    UPDATE public.interview_knowledge_chunks
       SET sap_module = NEW.sap_module, sap_version = NEW.sap_version, tags = NEW.tags, language = NEW.language
     WHERE document_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ik_document_sync ON public.interview_knowledge_documents;
CREATE TRIGGER ik_document_sync BEFORE UPDATE ON public.interview_knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.ik_document_sync();

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Cached plan per interview session (admins may read; consultants never: key points and sources live here)

CREATE TABLE IF NOT EXISTS public.interview_plans (
  interview_id uuid PRIMARY KEY REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'ready', 'failed')),
  plan jsonb,
  questions jsonb,
  model text,
  error text CHECK (error IS NULL OR char_length(error) <= 300),
  ai_calls integer NOT NULL DEFAULT 0 CHECK (ai_calls BETWEEN 0 AND 10),
  tokens_in integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interview_plans_consultant ON public.interview_plans (consultant_id, created_at DESC);
GRANT SELECT ON public.interview_plans TO authenticated;
GRANT ALL ON public.interview_plans TO service_role;
ALTER TABLE public.interview_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read interview plans" ON public.interview_plans;
CREATE POLICY "Admins read interview plans" ON public.interview_plans FOR SELECT TO authenticated USING (public.ik_is_admin(auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Question log: one row per (consultant, question hash); the UNIQUE key is the "never repeat" rule

CREATE TABLE IF NOT EXISTS public.interview_question_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  interview_id uuid REFERENCES public.interview_sessions(id) ON DELETE SET NULL,
  question_hash text NOT NULL CHECK (question_hash ~ '^[0-9a-f]{8,32}$'),
  sap_module text,
  sap_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, question_hash)
);
GRANT SELECT ON public.interview_question_log TO authenticated;
GRANT ALL ON public.interview_question_log TO service_role;
ALTER TABLE public.interview_question_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read question log" ON public.interview_question_log;
CREATE POLICY "Admins read question log" ON public.interview_question_log FOR SELECT TO authenticated USING (public.ik_is_admin(auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Why a question was asked. Column privileges: signed-in users keep every existing column, but not question_source
--    (admins read it through admin_interview_question_sources). Existing screens select named columns.

ALTER TABLE public.interview_answers ADD COLUMN IF NOT EXISTS question_source jsonb;
COMMENT ON COLUMN public.interview_answers.question_source IS 'Why the question was asked: {type: document|library|knowledge|generated_from_profile|follow_up, module, version, plan_question, document_ids, chunk_ids, library_ids, knowledge_ids}. Admins only.';
REVOKE ALL ON public.interview_answers FROM anon, authenticated;
GRANT SELECT (id, interview_id, question, answer_transcript, category, score, ai_feedback, question_order, created_at, sap_module) ON public.interview_answers TO authenticated;
GRANT INSERT (interview_id, question, answer_transcript, category, score, ai_feedback, question_order, sap_module) ON public.interview_answers TO authenticated;
GRANT UPDATE (question, answer_transcript, category, score, ai_feedback, question_order, sap_module) ON public.interview_answers TO authenticated;
GRANT DELETE ON public.interview_answers TO authenticated;
GRANT ALL ON public.interview_answers TO service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Functions

-- Search chunks for one module (and version): module first, then version (chunks of another release are excluded,
-- chunks without a release apply to all), then full-text rank on the profile keywords. Service role only.
CREATE OR REPLACE FUNCTION public.ik_search_chunks(_module text, _version text, _terms text[], _limit integer DEFAULT 3)
RETURNS TABLE (id uuid, document_id uuid, chunk_no integer, body text, sap_version text, title text, rank real)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lim integer := LEAST(GREATEST(coalesce(_limit, 3), 1), 8);
  _vk text := public.ik_version_key(_version);
  _q tsquery;
BEGIN
  IF public.ik_module_key(_module) = '' THEN RETURN; END IF;
  SELECT to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' | '))
    INTO _q
    FROM (SELECT DISTINCT lower(x) AS w FROM unnest(coalesce(_terms, '{}'::text[])) x WHERE lower(x) ~ '^[a-z0-9_.]{2,30}$' LIMIT 8) t;
  RETURN QUERY
  SELECT c.id, c.document_id, c.chunk_no, left(c.body, 1200), c.sap_version, d.title,
         (CASE WHEN _vk IS NOT NULL AND public.ik_version_key(c.sap_version) = _vk THEN 1.0 ELSE 0 END
          + CASE WHEN _q IS NULL THEN 0 ELSE ts_rank_cd(c.tsv, _q, 32) END)::real AS r
    FROM public.interview_knowledge_chunks c
    JOIN public.interview_knowledge_documents d ON d.id = c.document_id AND d.enabled AND d.status = 'ready'
   WHERE public.ik_same_module(c.sap_module, _module)
     AND (_vk IS NULL OR c.sap_version IS NULL
          OR public.ik_version_key(c.sap_version) = _vk
          OR position(public.ik_version_key(c.sap_version) IN _vk) > 0
          OR position(_vk IN public.ik_version_key(c.sap_version)) > 0)
   ORDER BY r DESC, c.chunk_no
   LIMIT _lim;
END $$;
REVOKE EXECUTE ON FUNCTION public.ik_search_chunks(text, text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ik_search_chunks(text, text, text[], integer) TO service_role;

-- Extraction claim: one worker at a time per document, a stuck claim expires after 10 minutes, at most 5 attempts.
CREATE OR REPLACE FUNCTION public.ik_claim_document(_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n integer;
BEGIN
  UPDATE public.interview_knowledge_documents
     SET status = 'extracting', claimed_at = now(), attempts = attempts + 1, status_reason = NULL
   WHERE id = _id
     AND attempts < 5
     AND (status <> 'extracting' OR claimed_at IS NULL OR claimed_at < now() - interval '10 minutes');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n = 1;
END $$;
REVOKE EXECUTE ON FUNCTION public.ik_claim_document(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ik_claim_document(uuid) TO service_role;

-- Coverage table for the Training page: module x version -> documents, chunks, consultants who declare it, questions
-- asked (last _days days) and their average score. Admins only.
CREATE OR REPLACE FUNCTION public.ik_coverage(_days integer DEFAULT 30)
RETURNS TABLE (sap_module text, sap_version text, documents integer, module_documents integer, chunks integer, consultants integer, questions_asked integer, avg_score numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _d integer := LEAST(GREATEST(coalesce(_days, 30), 1), 365);
BEGIN
  IF NOT public.ik_is_admin(auth.uid()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  WITH docs AS (
    SELECT public.ik_module_key(d.sap_module) AS k, public.ik_version_key(d.sap_version) AS v, min(d.sap_module) AS m, min(d.sap_version) AS vl,
           count(*) FILTER (WHERE d.enabled AND d.status = 'ready')::integer AS n, coalesce(sum(d.chunk_count) FILTER (WHERE d.enabled AND d.status = 'ready'), 0)::integer AS ch
      FROM public.interview_knowledge_documents d GROUP BY 1, 2
  ), decl AS (
    SELECT public.ik_module_key(s.sap_module) AS k, public.ik_version_key(s.sap_version) AS v, min(s.sap_module) AS m, min(s.sap_version) AS vl,
           count(DISTINCT s.consultant_id)::integer AS n
      FROM public.consultant_skills s GROUP BY 1, 2
  ), asked AS (
    SELECT public.ik_module_key(a.question_source->>'module') AS k, public.ik_version_key(a.question_source->>'version') AS v,
           count(*)::integer AS n, round(avg(a.score), 1) AS sc
      FROM public.interview_answers a
     WHERE a.question_source ? 'module' AND coalesce(a.question_source->>'type', '') <> 'follow_up'
       AND a.created_at > now() - make_interval(days => _d)
     GROUP BY 1, 2
  ), keys AS (
    SELECT k, v FROM docs UNION SELECT k, v FROM decl UNION SELECT k, v FROM asked
  )
  SELECT coalesce(dc.m, de.m, x.k), coalesce(dc.vl, de.vl, x.v),
         coalesce(dc.n, 0), coalesce((SELECT sum(d2.n) FROM docs d2 WHERE d2.k = x.k AND (d2.v IS NULL OR d2.v = x.v)), 0)::integer,
         coalesce(dc.ch, 0), coalesce(de.n, 0), coalesce(q.n, 0), q.sc
    FROM keys x
    LEFT JOIN docs dc ON dc.k = x.k AND dc.v IS NOT DISTINCT FROM x.v
    LEFT JOIN decl de ON de.k = x.k AND de.v IS NOT DISTINCT FROM x.v
    LEFT JOIN asked q ON q.k = x.k AND q.v IS NOT DISTINCT FROM x.v
   WHERE x.k <> ''
   ORDER BY coalesce(dc.n, 0), coalesce(de.n, 0) DESC, 1, 2
   LIMIT 500;
END $$;
REVOKE EXECUTE ON FUNCTION public.ik_coverage(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ik_coverage(integer) TO authenticated, service_role;

-- Why each question of an interview was asked. Admins only.
CREATE OR REPLACE FUNCTION public.admin_interview_question_sources(_interview_id uuid)
RETURNS TABLE (question_order integer, question text, sap_module text, score numeric, question_source jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ik_is_admin(auth.uid()) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT a.question_order, a.question, a.sap_module, a.score, a.question_source
    FROM public.interview_answers a WHERE a.interview_id = _interview_id ORDER BY a.question_order;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_interview_question_sources(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_interview_question_sources(uuid) TO authenticated, service_role;

-- Only "is the feature on" for the consultant's pre-interview line; no other setting is exposed.
CREATE OR REPLACE FUNCTION public.ik_public_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (value->>'enabled')::boolean FROM public.platform_settings WHERE key = 'interview_knowledge' LIMIT 1), false)
$$;
REVOKE EXECUTE ON FUNCTION public.ik_public_enabled() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ik_public_enabled() TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Private storage bucket "interview-knowledge": admins may read; no insert/update/delete policy (server writes only)

DROP POLICY IF EXISTS "Admins read interview knowledge files" ON storage.objects;
CREATE POLICY "Admins read interview knowledge files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'interview-knowledge' AND public.ik_is_admin(auth.uid()));
