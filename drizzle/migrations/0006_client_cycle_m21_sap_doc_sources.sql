-- M21 (SAP's open documentation as one more source for the suggestions).
-- SAP publishes the markdown source of parts of its documentation on GitHub (organisation SAP-docs) under the Creative Commons licence CC BY 4.0:
-- it may be copied and adapted when the source is named, the licence is named and changes are marked. The suggestions show that attribution.
-- Only administrators can see or switch these tables from the screens; the import and the search run in edge functions (service role).
-- A. the sources an administrator can import (a fixed list: only SAP-docs repositories) and the state of each import
-- B. the files of an import (the plan: an import can stop and go on)
-- C. the text chunks with a stored, indexed search vector
-- D. search_sap_docs(): the best chunks for a few search words (edge functions only)

-- ===== A. sources =====
CREATE TABLE public.sap_doc_sources (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{3,60}$'),
  title text NOT NULL,
  repo text NOT NULL CHECK (repo ~ '^SAP-docs/[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  branch text NOT NULL DEFAULT 'main' CHECK (branch ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$' AND branch !~ '\.\.'),
  license text NOT NULL DEFAULT 'CC-BY-4.0',
  enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'empty' CHECK (status IN ('empty', 'importing', 'ready', 'error')),
  commit_sha text,
  files_total integer NOT NULL DEFAULT 0 CHECK (files_total >= 0),
  files_done integer NOT NULL DEFAULT 0 CHECK (files_done >= 0),
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  text_bytes bigint NOT NULL DEFAULT 0 CHECK (text_bytes >= 0),
  imported_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repo)
);
INSERT INTO public.sap_doc_sources (id, title, repo) VALUES
  ('btp-best-practices', 'SAP BTP best practices guide', 'SAP-docs/btp-best-practices-guide'),
  ('btp-cloud-platform', 'SAP BTP documentation', 'SAP-docs/btp-cloud-platform'),
  ('btp-business-application-studio', 'SAP Business Application Studio', 'SAP-docs/btp-business-application-studio'),
  ('btp-integration-suite', 'SAP Integration Suite', 'SAP-docs/btp-integration-suite'),
  ('sapui5', 'SAPUI5 and SAP Fiori', 'SAP-docs/sapui5');

-- ===== B. the files of an import =====
CREATE TABLE public.sap_doc_files (
  source_id text NOT NULL REFERENCES public.sap_doc_sources(id) ON DELETE CASCADE,
  path text NOT NULL CHECK (char_length(path) <= 400),
  bytes integer NOT NULL DEFAULT 0 CHECK (bytes >= 0),
  done boolean NOT NULL DEFAULT false,
  PRIMARY KEY (source_id, path)
);
CREATE INDEX sap_doc_files_pending_idx ON public.sap_doc_files (source_id) WHERE NOT done;

-- ===== C. the text chunks =====
CREATE TABLE public.sap_doc_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES public.sap_doc_sources(id) ON DELETE CASCADE,
  path text NOT NULL CHECK (char_length(path) <= 400),
  chunk_no integer NOT NULL CHECK (chunk_no >= 0),
  doc_title text NOT NULL CHECK (char_length(doc_title) <= 300),
  heading text CHECK (heading IS NULL OR char_length(heading) <= 300),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', COALESCE(doc_title, '') || ' ' || COALESCE(heading, '') || ' ' || body)) STORED,
  UNIQUE (source_id, path, chunk_no)
);
CREATE INDEX sap_doc_chunks_tsv_idx ON public.sap_doc_chunks USING gin (tsv);

-- ===== access: administrators read the sources and flip the switch; the rest is for the edge functions =====
ALTER TABLE public.sap_doc_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sap_doc_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sap_doc_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sap_doc_sources, public.sap_doc_files, public.sap_doc_chunks FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.sap_doc_sources TO authenticated;
CREATE POLICY "Administrators read the documentation sources" ON public.sap_doc_sources
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Administrators switch the documentation sources" ON public.sap_doc_sources
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- a signed-in administrator may only flip the switch, and only for a source that has been imported;
-- the edge function (service role, no signed-in person) writes the state of the import
CREATE FUNCTION public.guard_sap_doc_sources()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF (NEW.id, NEW.title, NEW.repo, NEW.branch, NEW.license, NEW.status, NEW.commit_sha, NEW.files_total, NEW.files_done, NEW.chunk_count, NEW.text_bytes, NEW.imported_at, NEW.last_error)
       IS DISTINCT FROM
       (OLD.id, OLD.title, OLD.repo, OLD.branch, OLD.license, OLD.status, OLD.commit_sha, OLD.files_total, OLD.files_done, OLD.chunk_count, OLD.text_bytes, OLD.imported_at, OLD.last_error) THEN
      RAISE EXCEPTION 'Only the switch can be changed here' USING ERRCODE = '42501';
    END IF;
    IF NEW.enabled AND NEW.status <> 'ready' THEN
      RAISE EXCEPTION 'Import the documentation first' USING ERRCODE = '22023';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_sap_doc_sources() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_sap_doc_sources
  BEFORE UPDATE ON public.sap_doc_sources
  FOR EACH ROW EXECUTE FUNCTION public.guard_sap_doc_sources();

-- ===== D. search =====
-- The best chunk of each file that contains ALL of the first 4 words, else the first 3, else the first 2; at most _limit chunks.
-- Only sources that are imported (status ready) AND switched on take part. Edge functions only.
CREATE FUNCTION public.search_sap_docs(_terms text[], _limit integer DEFAULT 3)
RETURNS TABLE (
  source_id text, source_title text, repo text, branch text, license text,
  path text, doc_title text, heading text, body text, rank real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _t text[];
  _n integer;
  _k integer;
  _q tsquery;
  _rows integer;
  _lim integer := LEAST(GREATEST(COALESCE(_limit, 3), 1), 5);
BEGIN
  SELECT array_agg(b.w ORDER BY b.p) INTO _t
  FROM (
    SELECT a.w, min(a.p) AS p
    FROM (SELECT lower(x) AS w, o AS p FROM unnest(COALESCE(_terms, '{}'::text[])) WITH ORDINALITY AS u(x, o)) a
    WHERE a.w ~ '^[[:alnum:]_]{2,30}$'
    GROUP BY a.w
    ORDER BY min(a.p)
    LIMIT 6
  ) b;
  _n := COALESCE(cardinality(_t), 0);
  IF _n < 2 THEN
    RETURN;
  END IF;
  FOR _k IN REVERSE LEAST(4, _n)..2 LOOP
    _q := to_tsquery('simple', array_to_string(ARRAY(SELECT quote_literal(w) || ':*' FROM unnest(_t[1:_k]) w), ' & '));
    RETURN QUERY
      SELECT s.id, s.title, s.repo, s.branch, s.license, h.path, h.doc_title, h.heading, h.body, h.r
      FROM (
        SELECT DISTINCT ON (c.source_id, c.path) c.source_id, c.path, c.doc_title, c.heading, c.body, ts_rank_cd(c.tsv, _q, 32) AS r
        FROM public.sap_doc_chunks c
        JOIN public.sap_doc_sources s0 ON s0.id = c.source_id AND s0.enabled AND s0.status = 'ready'
        WHERE c.tsv @@ _q
        ORDER BY c.source_id, c.path, ts_rank_cd(c.tsv, _q, 32) DESC
      ) h
      JOIN public.sap_doc_sources s ON s.id = h.source_id
      ORDER BY h.r DESC, h.path
      LIMIT _lim;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    IF _rows > 0 THEN
      RETURN;
    END IF;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.search_sap_docs(text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_sap_docs(text[], integer) TO service_role;