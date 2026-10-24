-- ============================================================================================================
-- Solution Architecture documents (client page /client/solution-architecture).   PREPARED, NOT APPLIED.
-- The owner reviews and applies it. Run once in a transaction; safe to re-run (IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS). Then run docs/sql/solution-architecture.test.sql (it rolls back).
-- Needs docs/sql/ticket-brd.sql (applied): reuses brd_is_admin, brd_role_for, brd_ref, brd_person_name,
-- brd_consultant_of, mask_contact_details (M60) and contact_details_in_text.
--
-- What it adds
--   * settings key platform_settings.solution_architecture (feature OFF, AI OFF, NDA required, limits, model);
--   * sa_documents (one row per document: details + autosaved draft), sa_versions (immutable v1, v2 ... with a
--     snapshot of the details), sa_links / sa_project_links (linked tickets and projects), sa_comments (threaded,
--     per section, suggestions), sa_access_log (who opened which version), sa_events (audit), sa_assets (diagram
--     pictures), sa_systems (company SAP landscape register, never credentials) + sa_ticket_systems, sa_ai_usage;
--   * ticket_documents gets doc_type 'architecture' + arch_doc_id / arch_version (Attach to ticket = a normal
--     ticket document row, the same flow as the BRD);
--   * restrictive policies so architecture rows and files follow the document rule (the older ticket-document and
--     bucket policies cannot widen it): diagram pictures arch/<doc>/<file>.(png|jpg|svg), attached PDFs
--     <ticket>/architecture/<doc>/<file>.pdf; never replaced or deleted from the browser.
--
-- Reader rule sa_role_for (mirror: supabase/functions/_shared/archModel.ts archRole):
--   admin                         -> 'admin'
--   company document (tenant_id)  -> accepted member: creator or owner/admin/manager = 'client' (writer),
--                                    member = 'company' (read + comment)
--   personal document             -> the owning client account = 'client'
--   consultant                    -> only when the document is Shared, not archived, has a saved version, and the
--                                    consultant is a reader of at least one linked ticket by the BRD rule
--                                    (brd_role_for = 'consultant': assigned / started team member) AND has an active
--                                    NDA signed by both sides with that ticket's client (setting require_nda, default
--                                    on). Read-only; comments allowed (contact-detail filter M60). Never the draft.
-- Security model: no table grants to anon/authenticated; every read and write is a SECURITY DEFINER function with a
-- fixed search_path that checks the caller. Saved text passes the contact mask and a markup allowlist. Archive is
-- soft (status 'archived'); documents and versions are never deleted from the browser.
-- ============================================================================================================

-- ------------------------------------------------------------------------------------------------ settings
CREATE OR REPLACE FUNCTION public.sa_default_settings()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', false,
    'ai_enabled', false,
    'require_nda', true,
    'ai_calls_per_doc_per_day', 10,
    'ai_calls_per_org_per_day', 30,
    'ai_model', 'openai/gpt-6-luna',
    'max_brd_chars', 12000,
    'docs_per_user_per_day', 30,
    'comments_per_user_per_day', 60,
    'uploads_per_user_per_day', 60,
    'landscape_saves_per_user_per_day', 100,
    'max_assets_per_doc', 30,
    'max_versions_per_doc', 500,
    'max_systems', 200
  )
$$;

CREATE OR REPLACE FUNCTION public.sa_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.sa_default_settings() || COALESCE(
    (SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value END FROM public.platform_settings WHERE key = 'solution_architecture' LIMIT 1),
    '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION public.sa_setting_int(_k text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((public.sa_settings() ->> _k)::integer, (public.sa_default_settings() ->> _k)::integer)
$$;

-- What every signed-in screen may know (the button stays dimmed while enabled = false).
CREATE OR REPLACE FUNCTION public.sa_public_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('enabled', COALESCE((s ->> 'enabled')::boolean, false),
                            'ai_enabled', COALESCE((s ->> 'enabled')::boolean, false) AND COALESCE((s ->> 'ai_enabled')::boolean, false))
  FROM (SELECT public.sa_settings() AS s) x
$$;

-- ------------------------------------------------------------------------------------------------ tables
CREATE TABLE IF NOT EXISTS public.sa_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  created_by uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('blueprint', 'hld', 'lld', 'integration', 'migration', 'security', 'test', 'cutover', 'adr', 'other')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'superseded', 'archived')),
  confidentiality text NOT NULL DEFAULT 'private' CHECK (confidentiality IN ('private', 'shared')),
  sap_area text NOT NULL DEFAULT '' CHECK (char_length(sap_area) <= 120),
  sap_module text NOT NULL DEFAULT '' CHECK (char_length(sap_module) <= 120),
  sap_version text NOT NULL DEFAULT '' CHECK (char_length(sap_version) <= 120),
  owner_name text NOT NULL DEFAULT '' CHECK (char_length(owner_name) <= 120),
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar')),
  draft jsonb NOT NULL,
  draft_rev integer NOT NULL DEFAULT 1,
  draft_saved_at timestamptz NOT NULL DEFAULT now(),
  draft_saved_by uuid,
  latest_version integer NOT NULL DEFAULT 0,
  approved_version integer,
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_documents_tenant_idx ON public.sa_documents (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS sa_documents_client_idx ON public.sa_documents (client_id, updated_at DESC) WHERE tenant_id IS NULL;

CREATE TABLE IF NOT EXISTS public.sa_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.sa_documents(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL,
  content jsonb NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_note text NOT NULL DEFAULT '',
  restored_from integer,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_id, version)
);

CREATE TABLE IF NOT EXISTS public.sa_links (
  doc_id uuid NOT NULL REFERENCES public.sa_documents(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, ticket_id)
);
CREATE INDEX IF NOT EXISTS sa_links_ticket_idx ON public.sa_links (ticket_id);

CREATE TABLE IF NOT EXISTS public.sa_project_links (
  doc_id uuid NOT NULL REFERENCES public.sa_documents(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, project_id)
);

CREATE TABLE IF NOT EXISTS public.sa_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.sa_documents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  section_key text NOT NULL,
  parent_id uuid REFERENCES public.sa_comments(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  author_role text NOT NULL,
  author_consultant_id uuid,
  kind text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'suggestion')),
  body text NOT NULL,
  suggested_text text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'accepted', 'declined')),
  status_by uuid,
  status_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_comments_doc_idx ON public.sa_comments (doc_id, created_at);
CREATE INDEX IF NOT EXISTS sa_comments_author_idx ON public.sa_comments (author_id, created_at);

CREATE TABLE IF NOT EXISTS public.sa_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.sa_documents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  viewer_id uuid NOT NULL,
  viewer_role text NOT NULL,
  viewer_consultant_id uuid,
  action text NOT NULL CHECK (action IN ('view', 'download')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_access_log_doc_idx ON public.sa_access_log (doc_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sa_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid REFERENCES public.sa_documents(id) ON DELETE CASCADE,
  tenant_id uuid,
  client_id uuid,
  actor_id uuid,
  action text NOT NULL,
  version integer,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_events_doc_idx ON public.sa_events (doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sa_events_scope_idx ON public.sa_events (tenant_id, client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sa_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.sa_documents(id) ON DELETE CASCADE,
  path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/svg+xml')),
  size bigint NOT NULL CHECK (size > 0 AND size <= 5242880),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_assets_doc_idx ON public.sa_assets (doc_id);

CREATE TABLE IF NOT EXISTS public.sa_systems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  sid text NOT NULL DEFAULT '' CHECK (sid = '' OR sid ~ '^[A-Z][A-Z0-9]{2}$'),
  role text NOT NULL CHECK (role IN ('DEV', 'QAS', 'PRD', 'SBX', 'TRN', 'PRE', 'OTHER')),
  product text NOT NULL DEFAULT '' CHECK (char_length(product) <= 120),
  release text NOT NULL DEFAULT '' CHECK (char_length(release) <= 120),
  hosting text NOT NULL DEFAULT 'other' CHECK (hosting IN ('on_premise', 'private_cloud', 'rise', 'public_cloud', 'hyperscaler', 'other')),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX IF NOT EXISTS sa_systems_scope_idx ON public.sa_systems (tenant_id, client_id);

CREATE TABLE IF NOT EXISTS public.sa_ticket_systems (
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  system_id uuid NOT NULL REFERENCES public.sa_systems(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, system_id)
);

CREATE TABLE IF NOT EXISTS public.sa_ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id uuid NOT NULL REFERENCES public.sa_documents(id) ON DELETE CASCADE,
  scope_key text NOT NULL,
  actor_id uuid NOT NULL,
  kind text NOT NULL,
  model text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed', 'refused')),
  reason text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS sa_ai_usage_doc_idx ON public.sa_ai_usage (doc_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sa_ai_usage_scope_idx ON public.sa_ai_usage (scope_key, created_at DESC);

-- ticket_documents: an attached architecture PDF is a normal document row of type 'architecture'.
ALTER TABLE public.ticket_documents ADD COLUMN IF NOT EXISTS arch_doc_id uuid REFERENCES public.sa_documents(id) ON DELETE SET NULL;
ALTER TABLE public.ticket_documents ADD COLUMN IF NOT EXISTS arch_version integer;
ALTER TABLE public.ticket_documents DROP CONSTRAINT IF EXISTS ticket_documents_doc_type_check;
ALTER TABLE public.ticket_documents ADD CONSTRAINT ticket_documents_doc_type_check CHECK (doc_type IN ('file', 'brd', 'architecture'));
CREATE UNIQUE INDEX IF NOT EXISTS ticket_documents_arch_file_uidx ON public.ticket_documents (file_url) WHERE doc_type = 'architecture';
CREATE INDEX IF NOT EXISTS ticket_documents_arch_doc_idx ON public.ticket_documents (arch_doc_id) WHERE doc_type = 'architecture';

-- Grants: service role only. Browsers use the functions below.
REVOKE ALL ON public.sa_documents, public.sa_versions, public.sa_links, public.sa_project_links, public.sa_comments,
  public.sa_access_log, public.sa_events, public.sa_assets, public.sa_systems, public.sa_ticket_systems, public.sa_ai_usage
  FROM anon, authenticated;
GRANT ALL ON public.sa_documents, public.sa_versions, public.sa_links, public.sa_project_links, public.sa_comments,
  public.sa_access_log, public.sa_events, public.sa_assets, public.sa_systems, public.sa_ticket_systems, public.sa_ai_usage
  TO service_role;
ALTER TABLE public.sa_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_project_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_ticket_systems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sa_ai_usage ENABLE ROW LEVEL SECURITY;
-- (No policies for anon/authenticated on purpose: RLS on + no grants = locked.)

-- ------------------------------------------------------------------------------------------------ catalogue
-- Section template per type. Mirror of TYPE_SECTIONS in _shared/archModel.ts (a test compares them).
CREATE OR REPLACE FUNCTION public.sa_type_sections(_type text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _type
    WHEN 'blueprint' THEN ARRAY['context', 'scope', 'process_design', 'org_structure', 'master_data', 'integrations', 'reporting', 'security', 'risks', 'decisions', 'open_points']
    WHEN 'hld' THEN ARRAY['context', 'scope', 'principles', 'target_landscape', 'components', 'integrations', 'data_flows', 'security', 'non_functional', 'risks', 'decisions', 'open_points']
    WHEN 'lld' THEN ARRAY['context', 'detailed_design', 'objects', 'data_model', 'error_handling', 'security', 'non_functional', 'risks', 'open_points']
    WHEN 'integration' THEN ARRAY['context', 'scope', 'integrations', 'interface_specs', 'data_flows', 'error_handling', 'security', 'non_functional', 'risks', 'open_points']
    WHEN 'migration' THEN ARRAY['context', 'scope', 'migration_objects', 'migration_approach', 'cleansing', 'reconciliation', 'risks', 'open_points']
    WHEN 'security' THEN ARRAY['context', 'scope', 'roles', 'sod', 'security', 'risks', 'open_points']
    WHEN 'test' THEN ARRAY['context', 'test_scope', 'test_approach', 'defects', 'acceptance', 'risks', 'open_points']
    WHEN 'cutover' THEN ARRAY['context', 'cutover_tasks', 'cutover_timeline', 'go_no_go', 'rollback', 'hypercare', 'risks', 'open_points']
    WHEN 'adr' THEN ARRAY['context', 'decision_drivers', 'options', 'decision', 'consequences']
    WHEN 'other' THEN ARRAY['context', 'notes', 'open_points']
  END
$$;

-- ------------------------------------------------------------------------------------------------ access rule
-- Role of a user inside a document's company / client account: 'client' (writer), 'company' (reader) or NULL.
CREATE OR REPLACE FUNCTION public.sa_scope_role(_tenant uuid, _client uuid, _creator uuid, _uid uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r text;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  IF _tenant IS NULL THEN
    RETURN CASE WHEN _client = _uid THEN 'client' END;
  END IF;
  SELECT org_role::text INTO r FROM public.tenant_members
   WHERE tenant_id = _tenant AND user_id = _uid AND accepted_at IS NOT NULL LIMIT 1;
  IF r IS NULL THEN RETURN NULL; END IF;
  RETURN CASE WHEN r IN ('owner', 'admin', 'manager') OR _creator = _uid THEN 'client' ELSE 'company' END;
END
$$;

-- Consultant rule for one linked ticket: BRD reader rule + NDA signed by both sides with the ticket's client.
CREATE OR REPLACE FUNCTION public.sa_consultant_on_ticket(_ticket uuid, _uid uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid; cl uuid;
BEGIN
  IF public.brd_role_for(_ticket, _uid) IS DISTINCT FROM 'consultant' THEN RETURN false; END IF;
  IF NOT COALESCE((public.sa_settings() ->> 'require_nda')::boolean, true) THEN RETURN true; END IF;
  cid := public.brd_consultant_of(_uid);
  SELECT client_id INTO cl FROM public.tickets WHERE id = _ticket;
  RETURN EXISTS (SELECT 1 FROM public.nda_agreements n
                 WHERE n.consultant_id = cid AND n.client_id = cl AND n.revoked_at IS NULL
                   AND n.signed_at IS NOT NULL AND n.client_signed_at IS NOT NULL);
END
$$;

-- 'admin' | 'client' | 'company' | 'consultant' | NULL
CREATE OR REPLACE FUNCTION public.sa_role_for(_doc uuid, _uid uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d record; r text;
BEGIN
  IF _uid IS NULL OR _doc IS NULL THEN RETURN NULL; END IF;
  SELECT id, tenant_id, client_id, created_by, confidentiality, archived_at, latest_version INTO d FROM public.sa_documents WHERE id = _doc;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF public.brd_is_admin(_uid) THEN RETURN 'admin'; END IF;
  r := public.sa_scope_role(d.tenant_id, d.client_id, d.created_by, _uid);
  IF r IS NOT NULL THEN RETURN r; END IF;
  IF d.confidentiality = 'shared' AND d.archived_at IS NULL AND d.latest_version > 0 AND EXISTS (
       SELECT 1 FROM public.sa_links l WHERE l.doc_id = _doc AND public.sa_consultant_on_ticket(l.ticket_id, _uid)) THEN
    RETURN 'consultant';
  END IF;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.sa_role(_doc uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.sa_role_for(_doc, auth.uid())
$$;

-- Writers: the owning company's writers and admins; while the feature is off only admins; never while archived
-- (sa_set_status may bring an archived document back to draft).
CREATE OR REPLACE FUNCTION public.sa_can_write_for(_doc uuid, _uid uuid, _allow_archived boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r text := public.sa_role_for(_doc, _uid); arch timestamptz;
BEGIN
  IF r IS NULL OR r NOT IN ('admin', 'client') THEN RETURN false; END IF;
  IF r <> 'admin' AND NOT COALESCE((public.sa_settings() ->> 'enabled')::boolean, false) THEN RETURN false; END IF;
  SELECT archived_at INTO arch FROM public.sa_documents WHERE id = _doc;
  RETURN arch IS NULL OR _allow_archived;
END
$$;

-- Who may create documents / landscape rows in a company (or, with NULL, in the own client account).
CREATE OR REPLACE FUNCTION public.sa_can_create(_tenant uuid, _uid uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _uid IS NULL OR NOT COALESCE((public.sa_settings() ->> 'enabled')::boolean, false) THEN RETURN false; END IF;
  IF _tenant IS NULL THEN
    RETURN public.has_role(_uid, 'client'::app_role);
  END IF;
  RETURN public.sa_scope_role(_tenant, NULL, NULL, _uid) = 'client';
END
$$;

-- May the caller read the company's list (members) or the own account's list?
CREATE OR REPLACE FUNCTION public.sa_can_read_scope(_tenant uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (public.brd_is_admin(_uid)
    OR (_tenant IS NULL)
    OR public.sa_scope_role(_tenant, NULL, NULL, _uid) IS NOT NULL)
$$;

-- A ticket / project may be linked when it belongs to the same company (or the same client account).
CREATE OR REPLACE FUNCTION public.sa_ticket_in_scope(_ticket uuid, _tenant uuid, _client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket
                 AND ((_tenant IS NOT NULL AND t.tenant_id = _tenant) OR (_tenant IS NULL AND t.client_id = _client AND t.tenant_id IS NULL)))
$$;
CREATE OR REPLACE FUNCTION public.sa_project_in_scope(_project uuid, _tenant uuid, _client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = _project
                 AND ((_tenant IS NOT NULL AND p.tenant_id = _tenant) OR (_tenant IS NULL AND p.client_id = _client AND p.tenant_id IS NULL)))
$$;

-- ------------------------------------------------------------------------------------------------ content checks
-- Credential-like text (mirror of looksLikeSecret in _shared/archModel.ts + the BRD token patterns).
CREATE OR REPLACE FUNCTION public.sa_text_has_secret(_t text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(_t, '') <> '' AND (
       _t ~* '(^|[^a-z0-9_])(pass(word|wort|wd|phrase)s?|pwd|kennwort|secrets?|tokens?|api[ _-]?keys?|private[ _-]?keys?|access[ _-]?keys?|client[ _-]?secrets?|credentials?)([^a-z0-9_]|$)'
    OR _t ~* '(^|[^a-z0-9_])(login|logon|user(name)?)\s*[:=]'
    OR _t ~ '(كلمة\s*(ال)?(مرور|سر|السر)|الرقم\s*السري|رمز\s*(الدخول|المرور))'
    OR _t ~* '[a-z][a-z0-9+.-]*://[^\s:@/]+:[^\s@/]+@'
    OR _t ~ '-----BEGIN [A-Z ]*PRIVATE KEY-----'
    OR _t ~ 'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}'
    OR _t ~ 'AKIA[0-9A-Z]{16}'
    OR _t ~ 'AIza[0-9A-Za-z_-]{30,}'
    OR _t ~ '(sk|pk|rk)[-_](live|test|proj)[-_][A-Za-z0-9_-]{12,}'
    OR _t ~ 'sk-[A-Za-z0-9_-]{20,}'
    OR _t ~ 'gh[pousr]_[A-Za-z0-9]{20,}'
    OR _t ~ 'xox[abprs]-[A-Za-z0-9-]{10,}')
$$;

-- Contact mask (M60) over the free-text parts only (html, caption, Mermaid source); ids are left as they are.
CREATE OR REPLACE FUNCTION public.sa_mask_content(_c jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE secs jsonb := '[]'::jsonb; s jsonb; ds jsonb; d jsonb;
BEGIN
  FOR s IN SELECT e FROM jsonb_array_elements(COALESCE(_c -> 'sections', '[]'::jsonb)) WITH ORDINALITY a(e, o) ORDER BY o LOOP
    ds := '[]'::jsonb;
    FOR d IN SELECT e FROM jsonb_array_elements(COALESCE(s -> 'diagrams', '[]'::jsonb)) WITH ORDINALITY a(e, o) ORDER BY o LOOP
      d := d || jsonb_build_object('caption', public.mask_contact_details(COALESCE(d ->> 'caption', '')));
      IF d ->> 'kind' = 'mermaid' THEN d := d || jsonb_build_object('source', public.mask_contact_details(COALESCE(d ->> 'source', ''))); END IF;
      ds := ds || jsonb_build_array(d);
    END LOOP;
    secs := secs || jsonb_build_array(s || jsonb_build_object('html', public.mask_contact_details(COALESCE(s ->> 'html', '')), 'diagrams', ds));
  END LOOP;
  RETURN _c || jsonb_build_object('sections', secs);
END
$$;

-- Shape, size, template, links and markup allowlist. Image blocks must point at this document's pictures and
-- landscape ids at the company's register.
CREATE OR REPLACE FUNCTION public.sa_validate_content(_doc uuid, _type text, _c jsonb)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  allowed text[] := public.sa_type_sections(_type);
  s jsonb; d jsonb; tr jsonb; keys text[] := '{}';
  sc record;
BEGIN
  IF _c IS NULL OR jsonb_typeof(_c) <> 'object' THEN RAISE EXCEPTION 'sa_invalid_content' USING ERRCODE = '22023'; END IF;
  IF octet_length(_c::text) > 600000 THEN RAISE EXCEPTION 'sa_too_large' USING ERRCODE = '22023'; END IF;
  IF COALESCE(_c ->> 'type', '') <> _type THEN RAISE EXCEPTION 'sa_wrong_type' USING ERRCODE = '22023'; END IF;
  IF COALESCE(_c ->> 'language', 'en') NOT IN ('en', 'ar') THEN RAISE EXCEPTION 'sa_invalid_options' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(_c -> 'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(_c -> 'sections') > 30 THEN
    RAISE EXCEPTION 'sa_invalid_sections' USING ERRCODE = '22023';
  END IF;
  FOR s IN SELECT e FROM jsonb_array_elements(_c -> 'sections') e LOOP
    IF jsonb_typeof(s) <> 'object' OR NOT ((s ->> 'key') = ANY (allowed)) OR (s ->> 'key') = ANY (keys) THEN
      RAISE EXCEPTION 'sa_invalid_section %', s ->> 'key' USING ERRCODE = '22023';
    END IF;
    keys := keys || (s ->> 'key');
    IF char_length(COALESCE(s ->> 'html', '')) > 40000 THEN RAISE EXCEPTION 'sa_section_too_long' USING ERRCODE = '22023'; END IF;
    IF jsonb_typeof(COALESCE(s -> 'diagrams', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(s -> 'diagrams', '[]'::jsonb)) > 10 THEN
      RAISE EXCEPTION 'sa_too_many_diagrams' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(COALESCE(s -> 'trace', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(s -> 'trace', '[]'::jsonb)) > 50 THEN
      RAISE EXCEPTION 'sa_too_many_links' USING ERRCODE = '22023';
    END IF;
    FOR tr IN SELECT e FROM jsonb_array_elements(COALESCE(s -> 'trace', '[]'::jsonb)) e LOOP
      IF COALESCE(tr ->> 'ticket_ref', '') !~ '^[A-Z0-9]{1,20}$' OR COALESCE(tr ->> 'req_id', '') !~ '^REQ-[0-9]{3}$' THEN
        RAISE EXCEPTION 'sa_invalid_trace' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    FOR d IN SELECT e FROM jsonb_array_elements(COALESCE(s -> 'diagrams', '[]'::jsonb)) e LOOP
      IF COALESCE(d ->> 'id', '') !~ '^d[a-z]{6,12}$' OR char_length(COALESCE(d ->> 'caption', '')) > 300 THEN
        RAISE EXCEPTION 'sa_invalid_diagram' USING ERRCODE = '22023';
      END IF;
      IF d ->> 'kind' = 'mermaid' THEN
        IF char_length(COALESCE(d ->> 'source', '')) > 5000 THEN RAISE EXCEPTION 'sa_diagram_too_long' USING ERRCODE = '22023'; END IF;
      ELSIF d ->> 'kind' = 'image' THEN
        IF NOT EXISTS (SELECT 1 FROM public.sa_assets a WHERE a.doc_id = _doc AND a.id::text = d ->> 'asset_id') THEN
          RAISE EXCEPTION 'sa_unknown_picture' USING ERRCODE = '22023';
        END IF;
      ELSE
        RAISE EXCEPTION 'sa_invalid_diagram' USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
  IF jsonb_typeof(COALESCE(_c -> 'systems', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_c -> 'systems', '[]'::jsonb)) > 50 THEN
    RAISE EXCEPTION 'sa_invalid_systems' USING ERRCODE = '22023';
  END IF;
  SELECT tenant_id, client_id INTO sc FROM public.sa_documents WHERE id = _doc;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(_c -> 'systems', '[]'::jsonb)) x(v)
             WHERE NOT EXISTS (SELECT 1 FROM public.sa_systems y WHERE y.id::text = x.v AND y.archived_at IS NULL
                               AND ((sc.tenant_id IS NOT NULL AND y.tenant_id = sc.tenant_id) OR (sc.tenant_id IS NULL AND y.tenant_id IS NULL AND y.client_id = sc.client_id)))) THEN
    RAISE EXCEPTION 'sa_unknown_system' USING ERRCODE = '22023';
  END IF;
  -- Markup allowlist (same rule as the BRD): no scripts, frames, images, links, styles or event handlers.
  IF _c::text ~* '<\s*/?\s*(script|iframe|frame|object|embed|style|link|meta|svg|math|img|video|audio|source|form|input|button|a|base)\M'
     OR _c::text ~* '<[^>]*\son[a-z]+\s*=' OR _c::text ~* '(java|vb)script\s*:' OR _c::text ~* 'data\s*:\s*text/html' THEN
    RAISE EXCEPTION 'sa_markup_not_allowed' USING ERRCODE = '22023';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.sa_meta_of(_d public.sa_documents)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object('title', _d.title, 'type', _d.type, 'status', _d.status, 'confidentiality', _d.confidentiality,
    'sap_area', _d.sap_area, 'sap_module', _d.sap_module, 'sap_version', _d.sap_version, 'owner_name', _d.owner_name)
$$;

-- ------------------------------------------------------------------------------------------------ immutability
CREATE OR REPLACE FUNCTION public.sa_guard_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Only the cascade from deleting the parent document (service role / admin tooling) may remove rows.
  IF TG_OP = 'DELETE' AND (TG_TABLE_NAME = 'sa_versions' OR TG_TABLE_NAME = 'sa_events' OR TG_TABLE_NAME = 'sa_access_log')
     AND NOT EXISTS (SELECT 1 FROM public.sa_documents WHERE id = OLD.doc_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows cannot be changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
END
$$;
DROP TRIGGER IF EXISTS sa_guard_versions ON public.sa_versions;
CREATE TRIGGER sa_guard_versions BEFORE UPDATE OR DELETE ON public.sa_versions FOR EACH ROW EXECUTE FUNCTION public.sa_guard_append_only();
DROP TRIGGER IF EXISTS sa_guard_events ON public.sa_events;
CREATE TRIGGER sa_guard_events BEFORE UPDATE OR DELETE ON public.sa_events FOR EACH ROW EXECUTE FUNCTION public.sa_guard_append_only();
DROP TRIGGER IF EXISTS sa_guard_access_log ON public.sa_access_log;
CREATE TRIGGER sa_guard_access_log BEFORE UPDATE OR DELETE ON public.sa_access_log FOR EACH ROW EXECUTE FUNCTION public.sa_guard_append_only();

-- Architecture document rows: only the superseded / unattached marks may change; never deleted while the ticket exists.
CREATE OR REPLACE FUNCTION public.sa_guard_document()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.doc_type = 'architecture' AND EXISTS (SELECT 1 FROM public.tickets WHERE id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'An attached architecture document cannot be deleted (unattach it instead)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.doc_type = 'architecture' OR NEW.doc_type = 'architecture' THEN
    IF NEW.doc_type IS DISTINCT FROM OLD.doc_type OR NEW.ticket_id <> OLD.ticket_id OR NEW.file_url <> OLD.file_url
       OR NEW.file_name <> OLD.file_name OR NEW.arch_version IS DISTINCT FROM OLD.arch_version
       OR (NEW.arch_doc_id IS DISTINCT FROM OLD.arch_doc_id AND NEW.arch_doc_id IS NOT NULL)
       OR NEW.uploaded_by <> OLD.uploaded_by OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'An attached architecture document cannot be changed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS sa_guard_document ON public.ticket_documents;
CREATE TRIGGER sa_guard_document BEFORE UPDATE OR DELETE ON public.ticket_documents FOR EACH ROW EXECUTE FUNCTION public.sa_guard_document();

-- ------------------------------------------------------------------------------------------------ file rules
-- arch/<doc uuid>/<32 hex>.(png|jpg|svg)
CREATE OR REPLACE FUNCTION public.sa_asset_doc_of_path(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF _name IS NULL OR split_part(_name, '/', 1) <> 'arch' THEN RETURN NULL; END IF;
  RETURN split_part(_name, '/', 2)::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END
$$;
-- <ticket uuid>/architecture/<doc uuid>/<file>.pdf
CREATE OR REPLACE FUNCTION public.sa_pdf_doc_of_path(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF _name IS NULL OR split_part(_name, '/', 2) <> 'architecture' THEN RETURN NULL; END IF;
  RETURN split_part(_name, '/', 3)::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.sa_asset_readable(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.sa_asset_doc_of_path(_name) IS NOT NULL AND public.sa_role(public.sa_asset_doc_of_path(_name)) IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION public.sa_asset_can_insert(_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _name ~ '^arch/[0-9a-f-]{36}/[0-9a-f]{24,32}\.(png|jpg|svg)$'
     AND public.sa_can_write_for(public.sa_asset_doc_of_path(_name), auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.sa_pdf_readable(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE did uuid := public.sa_pdf_doc_of_path(_name); r text;
BEGIN
  IF did IS NULL THEN RETURN false; END IF;
  r := public.sa_role(did);
  IF r IN ('admin', 'client') THEN RETURN true; END IF;
  IF r IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.ticket_documents d WHERE d.doc_type = 'architecture' AND d.file_url = _name AND d.unattached_at IS NULL);
END
$$;
CREATE OR REPLACE FUNCTION public.sa_pdf_can_insert(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE did uuid := public.sa_pdf_doc_of_path(_name); tid uuid;
BEGIN
  IF did IS NULL OR _name !~ '^[0-9a-f-]{36}/architecture/[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,120}\.pdf$' THEN RETURN false; END IF;
  tid := split_part(_name, '/', 1)::uuid;
  RETURN public.sa_can_write_for(did, auth.uid()) AND EXISTS (SELECT 1 FROM public.sa_links l WHERE l.doc_id = did AND l.ticket_id = tid);
EXCEPTION WHEN others THEN RETURN false;
END
$$;
CREATE OR REPLACE FUNCTION public.sa_doc_row_visible(_doc uuid, _unattached_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r text := public.sa_role(_doc);
BEGIN
  IF r IN ('admin', 'client') THEN RETURN true; END IF;
  IF r IN ('consultant', 'company') THEN RETURN _unattached_at IS NULL; END IF;
  RETURN false;
END
$$;

-- ------------------------------------------------------------------------------------------------ policies
-- ticket_documents: restrictive policies (ANDed with the existing permissive ones) for architecture rows.
DROP POLICY IF EXISTS "Architecture rows: readers only" ON public.ticket_documents;
CREATE POLICY "Architecture rows: readers only" ON public.ticket_documents AS RESTRICTIVE FOR SELECT TO public
  USING (doc_type <> 'architecture' OR public.sa_doc_row_visible(arch_doc_id, unattached_at));
DROP POLICY IF EXISTS "Architecture rows: added by the functions only" ON public.ticket_documents;
CREATE POLICY "Architecture rows: added by the functions only" ON public.ticket_documents AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (doc_type <> 'architecture');
DROP POLICY IF EXISTS "Architecture rows: changed by the functions only" ON public.ticket_documents;
CREATE POLICY "Architecture rows: changed by the functions only" ON public.ticket_documents AS RESTRICTIVE FOR UPDATE TO public
  USING (doc_type <> 'architecture') WITH CHECK (doc_type <> 'architecture');
DROP POLICY IF EXISTS "Architecture rows: never deleted" ON public.ticket_documents;
CREATE POLICY "Architecture rows: never deleted" ON public.ticket_documents AS RESTRICTIVE FOR DELETE TO public
  USING (doc_type <> 'architecture');

-- storage.objects in ticket-documents: arch/<doc>/... pictures and <ticket>/architecture/<doc>/... PDFs.
DROP POLICY IF EXISTS "Architecture files: readers only" ON storage.objects;
CREATE POLICY "Architecture files: readers only" ON storage.objects AS RESTRICTIVE FOR SELECT TO public
  USING (bucket_id <> 'ticket-documents'
         OR (split_part(name, '/', 1) <> 'arch' AND split_part(name, '/', 2) <> 'architecture')
         OR (split_part(name, '/', 1) = 'arch' AND public.sa_asset_readable(name))
         OR (split_part(name, '/', 2) = 'architecture' AND public.sa_pdf_readable(name)));
DROP POLICY IF EXISTS "Architecture files: writers upload" ON storage.objects;
CREATE POLICY "Architecture files: writers upload" ON storage.objects AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (bucket_id <> 'ticket-documents'
         OR (split_part(name, '/', 1) <> 'arch' AND split_part(name, '/', 2) <> 'architecture')
         OR (split_part(name, '/', 1) = 'arch' AND public.sa_asset_can_insert(name))
         OR (split_part(name, '/', 2) = 'architecture' AND public.sa_pdf_can_insert(name)));
DROP POLICY IF EXISTS "Architecture files: never replaced" ON storage.objects;
CREATE POLICY "Architecture files: never replaced" ON storage.objects AS RESTRICTIVE FOR UPDATE TO public
  USING (bucket_id <> 'ticket-documents' OR (split_part(name, '/', 1) <> 'arch' AND split_part(name, '/', 2) <> 'architecture'))
  WITH CHECK (bucket_id <> 'ticket-documents' OR (split_part(name, '/', 1) <> 'arch' AND split_part(name, '/', 2) <> 'architecture'));
DROP POLICY IF EXISTS "Architecture files: never deleted" ON storage.objects;
CREATE POLICY "Architecture files: never deleted" ON storage.objects AS RESTRICTIVE FOR DELETE TO public
  USING (bucket_id <> 'ticket-documents' OR (split_part(name, '/', 1) <> 'arch' AND split_part(name, '/', 2) <> 'architecture'));
-- Permissive read / upload for document readers and writers (the older bucket policies only know ticket folders).
DROP POLICY IF EXISTS "Architecture files: readers can open" ON storage.objects;
CREATE POLICY "Architecture files: readers can open" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ticket-documents' AND (
         (split_part(name, '/', 1) = 'arch' AND public.sa_asset_readable(name))
      OR (split_part(name, '/', 2) = 'architecture' AND public.sa_pdf_readable(name))));
DROP POLICY IF EXISTS "Architecture files: writers can upload" ON storage.objects;
CREATE POLICY "Architecture files: writers can upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ticket-documents' AND (
         (split_part(name, '/', 1) = 'arch' AND public.sa_asset_can_insert(name))
      OR (split_part(name, '/', 2) = 'architecture' AND public.sa_pdf_can_insert(name))));

-- ------------------------------------------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION public.sa_log_event(_doc uuid, _actor uuid, _action text, _version integer, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.sa_events (doc_id, tenant_id, client_id, actor_id, action, version, detail)
  SELECT _doc, d.tenant_id, d.client_id, _actor, _action, _version, COALESCE(_detail, '{}'::jsonb)
  FROM public.sa_documents d WHERE d.id = _doc
$$;

CREATE OR REPLACE FUNCTION public.sa_scope_key(_tenant uuid, _client uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _tenant IS NOT NULL THEN 't:' || _tenant::text ELSE 'c:' || _client::text END
$$;

-- One list row as the viewer may see it.
CREATE OR REPLACE FUNCTION public.sa_row_json(_d public.sa_documents, _viewer uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.sa_meta_of(_d) || jsonb_build_object(
    'id', _d.id, 'latest_version', _d.latest_version, 'approved_version', _d.approved_version,
    'created_at', _d.created_at, 'updated_at', _d.updated_at, 'archived_at', _d.archived_at,
    'links', COALESCE((SELECT jsonb_agg(jsonb_build_object('ticket_id', t.id, 'ref', public.brd_ref(t.id), 'title', t.title, 'status', t.status) ORDER BY t.created_at DESC)
                       FROM public.sa_links l JOIN public.tickets t ON t.id = l.ticket_id WHERE l.doc_id = _d.id), '[]'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id', p.id, 'title', p.name) ORDER BY p.created_at DESC)
                          FROM public.sa_project_links pl JOIN public.projects p ON p.id = pl.project_id WHERE pl.doc_id = _d.id), '[]'::jsonb),
    'open_comments', (SELECT count(*) FROM public.sa_comments c WHERE c.doc_id = _d.id AND c.status = 'open' AND c.parent_id IS NULL))
$$;

-- ------------------------------------------------------------------------------------------------ read
CREATE OR REPLACE FUNCTION public.sa_list(_tenant uuid, _include_archived boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT public.sa_can_read_scope(_tenant, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(public.sa_row_json(d, uid) ORDER BY d.updated_at DESC)
    FROM public.sa_documents d
    WHERE ((_tenant IS NOT NULL AND d.tenant_id = _tenant) OR (_tenant IS NULL AND d.tenant_id IS NULL AND d.client_id = uid))
      AND (COALESCE(_include_archived, false) OR d.archived_at IS NULL)
      AND public.sa_role_for(d.id, uid) IS NOT NULL), '[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION public.sa_get(_doc uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r text := public.sa_role_for(_doc, uid);
  pub jsonb := public.sa_public_settings();
  d public.sa_documents;
  writer boolean;
  full_view boolean;
  res jsonb;
BEGIN
  res := pub || jsonb_build_object('role', r, 'can_write', false);
  IF r IS NULL THEN RETURN res; END IF;
  SELECT * INTO d FROM public.sa_documents WHERE id = _doc;
  writer := public.sa_can_write_for(_doc, uid);
  full_view := r IN ('admin', 'client');
  res := res || jsonb_build_object(
    'can_write', writer,
    'doc', public.sa_row_json(d, uid) || jsonb_build_object('tenant_id', d.tenant_id, 'language', d.language,
             'draft', CASE WHEN full_view THEN d.draft END, 'draft_rev', CASE WHEN full_view THEN d.draft_rev END,
             'draft_saved_at', CASE WHEN full_view THEN d.draft_saved_at END),
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', v.version, 'status', v.status, 'change_note', v.change_note,
                   'restored_from', v.restored_from, 'created_at', v.created_at, 'author', public.brd_person_name(v.created_by, NULL, uid),
                   'attached', EXISTS (SELECT 1 FROM public.ticket_documents td WHERE td.doc_type = 'architecture' AND td.arch_doc_id = _doc AND td.arch_version = v.version AND td.unattached_at IS NULL))
                   ORDER BY v.version DESC) FROM public.sa_versions v WHERE v.doc_id = _doc), '[]'::jsonb),
    'comments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'version', c.version, 'section_key', c.section_key, 'parent_id', c.parent_id,
                   'author', public.brd_person_name(c.author_id, c.author_consultant_id, uid), 'author_role', c.author_role, 'kind', c.kind,
                   'body', c.body, 'suggested_text', c.suggested_text, 'status', c.status, 'created_at', c.created_at, 'mine', c.author_id = uid)
                   ORDER BY c.created_at) FROM public.sa_comments c WHERE c.doc_id = _doc), '[]'::jsonb),
    'assets', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime', a.mime, 'size', a.size, 'path', a.path) ORDER BY a.created_at)
                   FROM public.sa_assets a WHERE a.doc_id = _doc), '[]'::jsonb),
    'systems', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name, 'sid', y.sid, 'role', y.role, 'product', y.product,
                   'release', y.release, 'hosting', y.hosting, 'notes', CASE WHEN full_view OR r = 'company' THEN y.notes ELSE '' END) ORDER BY y.role, y.name)
                   FROM public.sa_systems y
                   WHERE y.archived_at IS NULL AND ((d.tenant_id IS NOT NULL AND y.tenant_id = d.tenant_id) OR (d.tenant_id IS NULL AND y.tenant_id IS NULL AND y.client_id = d.client_id))
                     AND (full_view OR r = 'company' OR y.id::text IN (SELECT jsonb_array_elements_text(COALESCE(v2.content -> 'systems', '[]'::jsonb))
                                                                      FROM public.sa_versions v2 WHERE v2.doc_id = _doc))), '[]'::jsonb),
    'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', td.id, 'ticket_id', td.ticket_id, 'ticket_ref', public.brd_ref(td.ticket_id), 'version', td.arch_version,
                   'file_name', td.file_name, 'file_url', td.file_url, 'attached_at', td.created_at, 'unattached_at', td.unattached_at) ORDER BY td.created_at DESC)
                   FROM public.ticket_documents td WHERE td.doc_type = 'architecture' AND td.arch_doc_id = _doc
                     AND (full_view OR td.unattached_at IS NULL)), '[]'::jsonb));
  IF full_view THEN
    res := res || jsonb_build_object(
      'access_log', COALESCE((SELECT jsonb_agg(jsonb_build_object('viewer', public.brd_person_name(a.viewer_id, a.viewer_consultant_id, uid), 'role', a.viewer_role,
                     'version', a.version, 'action', a.action, 'at', a.created_at) ORDER BY a.created_at DESC)
                     FROM (SELECT * FROM public.sa_access_log WHERE doc_id = _doc ORDER BY created_at DESC LIMIT 200) a), '[]'::jsonb),
      'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', e.action, 'version', e.version, 'at', e.created_at,
                     'actor', CASE WHEN e.actor_id IS NULL THEN '' ELSE public.brd_person_name(e.actor_id, public.brd_consultant_of(e.actor_id), uid) END) ORDER BY e.created_at DESC)
                     FROM (SELECT * FROM public.sa_events WHERE doc_id = _doc ORDER BY created_at DESC LIMIT 200) e), '[]'::jsonb),
      -- BRD requirement ids of linked tickets this person may read (newest saved BRD version).
      'requirements', COALESCE((SELECT jsonb_agg(jsonb_build_object('ticket_id', l.ticket_id, 'ticket_ref', public.brd_ref(l.ticket_id),
                     'req_id', q ->> 'id', 'description', left(COALESCE(q ->> 'description', ''), 300)))
                     FROM public.sa_links l
                     CROSS JOIN LATERAL (SELECT bv.content FROM public.ticket_brd_versions bv WHERE bv.ticket_id = l.ticket_id ORDER BY bv.version DESC LIMIT 1) bv
                     CROSS JOIN LATERAL jsonb_array_elements(COALESCE(bv.content -> 'requirements', '[]'::jsonb)) q
                     WHERE l.doc_id = _doc AND public.brd_role_for(l.ticket_id, uid) IS NOT NULL AND (q ->> 'id') ~ '^REQ-[0-9]{3}$'), '[]'::jsonb),
      'usage', jsonb_build_object(
        'doc_today', (SELECT count(*) FROM public.sa_ai_usage u WHERE u.doc_id = _doc AND u.status <> 'refused' AND u.created_at > now() - interval '1 day'),
        'org_today', (SELECT count(*) FROM public.sa_ai_usage u WHERE u.scope_key = public.sa_scope_key(d.tenant_id, d.client_id) AND u.status <> 'refused' AND u.created_at > now() - interval '1 day'),
        'doc_limit', public.sa_setting_int('ai_calls_per_doc_per_day'), 'org_limit', public.sa_setting_int('ai_calls_per_org_per_day')));
  END IF;
  RETURN res;
END
$$;

-- One saved version (consultants and members: logged as a view, at most once per 10 minutes).
CREATE OR REPLACE FUNCTION public.sa_get_version(_doc uuid, _version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.sa_role_for(_doc, uid); v public.sa_versions;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.sa_versions WHERE doc_id = _doc AND version = _version;
  IF NOT FOUND THEN RAISE EXCEPTION 'sa_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF r IN ('consultant', 'company') AND NOT EXISTS (
       SELECT 1 FROM public.sa_access_log a WHERE a.doc_id = _doc AND a.viewer_id = uid AND a.version = _version
         AND a.action = 'view' AND a.created_at > now() - interval '10 minutes') THEN
    INSERT INTO public.sa_access_log (doc_id, version, viewer_id, viewer_role, viewer_consultant_id, action)
    VALUES (_doc, _version, uid, r, public.brd_consultant_of(uid), 'view');
  END IF;
  RETURN jsonb_build_object('version', v.version, 'status', v.status, 'change_note', v.change_note, 'created_at', v.created_at,
                            'content', v.content, 'meta', v.meta);
END
$$;

CREATE OR REPLACE FUNCTION public.sa_log_access(_doc uuid, _version integer, _action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.sa_role_for(_doc, uid);
BEGIN
  IF r IS NULL OR _action NOT IN ('view', 'download') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sa_versions WHERE doc_id = _doc AND version = _version) THEN RAISE EXCEPTION 'sa_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF r = 'client' THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM public.sa_access_log a WHERE a.doc_id = _doc AND a.viewer_id = uid AND a.version = _version
             AND a.action = _action AND a.created_at > now() - interval '2 minutes') THEN RETURN true; END IF;
  INSERT INTO public.sa_access_log (doc_id, version, viewer_id, viewer_role, viewer_consultant_id, action)
  VALUES (_doc, _version, uid, r, public.brd_consultant_of(uid), _action);
  RETURN true;
END
$$;

-- Real events for the Timeline tab: document events of the scope + linked ticket stages (created, BRD saved /
-- attached, current status).
CREATE OR REPLACE FUNCTION public.sa_timeline(_tenant uuid, _limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); lim integer := LEAST(GREATEST(COALESCE(_limit, 200), 1), 500);
BEGIN
  IF NOT public.sa_can_read_scope(_tenant, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(q.x ORDER BY (q.x ->> 'at') DESC) FROM (SELECT u.x FROM (
      SELECT jsonb_build_object('at', e.created_at, 'kind', 'doc', 'action', e.action, 'doc_id', d.id, 'doc_title', d.title, 'doc_type', d.type,
               'version', e.version, 'ticket_id', NULL, 'ticket_ref', NULL, 'ticket_title', NULL,
               'actor', CASE WHEN e.actor_id IS NULL THEN NULL ELSE public.brd_person_name(e.actor_id, public.brd_consultant_of(e.actor_id), uid) END) AS x
      FROM public.sa_events e JOIN public.sa_documents d ON d.id = e.doc_id
      WHERE ((_tenant IS NOT NULL AND d.tenant_id = _tenant) OR (_tenant IS NULL AND d.tenant_id IS NULL AND d.client_id = uid))
        AND e.action IN ('create', 'version', 'restore', 'status', 'attach', 'unattach', 'archive', 'links')
        AND public.sa_role_for(d.id, uid) IS NOT NULL
      UNION ALL
      SELECT jsonb_build_object('at', s.at, 'kind', 'ticket', 'action', s.action, 'doc_id', NULL, 'doc_title', NULL, 'doc_type', NULL,
               'version', s.version, 'ticket_id', t.id, 'ticket_ref', public.brd_ref(t.id), 'ticket_title', t.title, 'actor', NULL)
      FROM (SELECT DISTINCT l.ticket_id FROM public.sa_links l JOIN public.sa_documents d ON d.id = l.doc_id
            WHERE ((_tenant IS NOT NULL AND d.tenant_id = _tenant) OR (_tenant IS NULL AND d.tenant_id IS NULL AND d.client_id = uid))) lt
      JOIN public.tickets t ON t.id = lt.ticket_id
      CROSS JOIN LATERAL (
        SELECT t.created_at AS at, 'ticket_created'::text AS action, NULL::integer AS version
        UNION ALL SELECT COALESCE(t.updated_at, t.created_at), 'ticket_status:' || t.status::text, NULL WHERE t.status::text <> 'new'
        UNION ALL SELECT be.created_at, 'brd_' || be.action, be.version FROM public.ticket_brd_events be
          WHERE be.ticket_id = t.id AND be.action IN ('version', 'final', 'attach')
      ) s
      WHERE public.brd_role_for(t.id, uid) IN ('admin', 'client', 'company')
    ) u ORDER BY (u.x ->> 'at') DESC LIMIT lim) q), '[]'::jsonb);
END
$$;

-- Documents linked to a ticket that the caller may open (ticket pages and the consultant case page).
CREATE OR REPLACE FUNCTION public.sa_for_ticket(_ticket uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'type', d.type, 'title', d.title, 'status', d.status,
                                              'latest_version', d.latest_version, 'updated_at', d.updated_at) ORDER BY d.updated_at DESC), '[]'::jsonb)
  FROM public.sa_links l JOIN public.sa_documents d ON d.id = l.doc_id
  WHERE l.ticket_id = _ticket AND d.archived_at IS NULL AND public.sa_role_for(d.id, auth.uid()) IS NOT NULL
$$;

-- ------------------------------------------------------------------------------------------------ write
CREATE OR REPLACE FUNCTION public.sa_set_links_internal(_doc uuid, _uid uuid, _tickets uuid[], _projects uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.sa_documents; x uuid;
BEGIN
  SELECT * INTO d FROM public.sa_documents WHERE id = _doc;
  IF COALESCE(array_length(_tickets, 1), 0) > 20 OR COALESCE(array_length(_projects, 1), 0) > 20 THEN
    RAISE EXCEPTION 'sa_too_many_links' USING ERRCODE = '22023';
  END IF;
  FOREACH x IN ARRAY COALESCE(_tickets, '{}') LOOP
    IF NOT public.sa_ticket_in_scope(x, d.tenant_id, d.client_id) THEN RAISE EXCEPTION 'sa_ticket_not_in_company' USING ERRCODE = '42501'; END IF;
  END LOOP;
  FOREACH x IN ARRAY COALESCE(_projects, '{}') LOOP
    IF NOT public.sa_project_in_scope(x, d.tenant_id, d.client_id) THEN RAISE EXCEPTION 'sa_project_not_in_company' USING ERRCODE = '42501'; END IF;
  END LOOP;
  DELETE FROM public.sa_links WHERE doc_id = _doc AND NOT (ticket_id = ANY (COALESCE(_tickets, '{}')));
  INSERT INTO public.sa_links (doc_id, ticket_id, created_by) SELECT _doc, t, _uid FROM unnest(COALESCE(_tickets, '{}')) t ON CONFLICT DO NOTHING;
  DELETE FROM public.sa_project_links WHERE doc_id = _doc AND NOT (project_id = ANY (COALESCE(_projects, '{}')));
  INSERT INTO public.sa_project_links (doc_id, project_id, created_by) SELECT _doc, p, _uid FROM unnest(COALESCE(_projects, '{}')) p ON CONFLICT DO NOTHING;
END
$$;

CREATE OR REPLACE FUNCTION public.sa_create(_tenant uuid, _input jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  typ text := _input ->> 'type';
  ttl text := trim(COALESCE(_input ->> 'title', ''));
  st text := COALESCE(_input ->> 'status', 'draft');
  conf text := COALESCE(_input ->> 'confidentiality', 'private');
  lang text := COALESCE(_input ->> 'language', 'en');
  c jsonb;
  new_id uuid := gen_random_uuid();
  tks uuid[];
  prs uuid[];
BEGIN
  IF NOT public.sa_can_create(_tenant, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF public.sa_type_sections(typ) IS NULL THEN RAISE EXCEPTION 'sa_invalid_type' USING ERRCODE = '22023'; END IF;
  IF st NOT IN ('draft', 'in_review') THEN RAISE EXCEPTION 'sa_invalid_status' USING ERRCODE = '22023'; END IF; -- approval needs a saved version
  IF conf NOT IN ('private', 'shared') OR lang NOT IN ('en', 'ar') THEN RAISE EXCEPTION 'sa_invalid_options' USING ERRCODE = '22023'; END IF;
  IF char_length(ttl) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'sa_invalid_title' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.sa_documents WHERE created_by = uid AND created_at > now() - interval '1 day') >= public.sa_setting_int('docs_per_user_per_day') THEN
    RAISE EXCEPTION 'sa_create_limit' USING ERRCODE = '54000';
  END IF;
  c := COALESCE(_input -> 'content', jsonb_build_object('schema', 1, 'type', typ, 'language', lang, 'systems', '[]'::jsonb,
         'sections', (SELECT jsonb_agg(jsonb_build_object('key', k, 'html', '', 'trace', '[]'::jsonb, 'diagrams', '[]'::jsonb) ORDER BY o)
                      FROM unnest(public.sa_type_sections(typ)) WITH ORDINALITY u(k, o))));
  INSERT INTO public.sa_documents (id, tenant_id, client_id, created_by, type, title, status, confidentiality, sap_area, sap_module, sap_version,
                                   owner_name, language, draft, draft_saved_by)
  VALUES (new_id, _tenant, uid, uid, typ, public.mask_contact_details(ttl), st, conf,
          left(COALESCE(_input ->> 'sap_area', ''), 120), left(COALESCE(_input ->> 'sap_module', ''), 120), left(COALESCE(_input ->> 'sap_version', ''), 120),
          public.mask_contact_details(left(trim(COALESCE(_input ->> 'owner_name', '')), 120)), lang, '{}'::jsonb, uid);
  -- Validation needs the row (picture / landscape checks), so the draft is written right after.
  PERFORM public.sa_validate_content(new_id, typ, c);
  UPDATE public.sa_documents SET draft = public.sa_mask_content(c) WHERE id = new_id;
  SELECT array_agg(x::uuid) INTO tks FROM jsonb_array_elements_text(COALESCE(_input -> 'tickets', '[]'::jsonb)) x;
  SELECT array_agg(x::uuid) INTO prs FROM jsonb_array_elements_text(COALESCE(_input -> 'projects', '[]'::jsonb)) x;
  PERFORM public.sa_set_links_internal(new_id, uid, tks, prs);
  PERFORM public.sa_log_event(new_id, uid, 'create', NULL, jsonb_build_object('type', typ, 'confidentiality', conf, 'tickets', COALESCE(array_length(tks, 1), 0)));
  RETURN new_id;
END
$$;

CREATE OR REPLACE FUNCTION public.sa_store_draft(_doc uuid, _uid uuid, _content jsonb, _rev integer)
RETURNS public.sa_documents LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.sa_documents; masked jsonb;
BEGIN
  SELECT * INTO d FROM public.sa_documents WHERE id = _doc FOR UPDATE;
  PERFORM public.sa_validate_content(_doc, d.type, _content);
  IF _rev IS NOT NULL AND _rev <> d.draft_rev THEN
    RAISE EXCEPTION 'sa_draft_conflict' USING ERRCODE = '40001', HINT = 'The document was saved in another tab or by another person. Reload to continue.';
  END IF;
  masked := public.sa_mask_content(_content);
  UPDATE public.sa_documents SET draft = masked, language = COALESCE(masked ->> 'language', language), draft_rev = draft_rev + 1,
         draft_saved_at = now(), draft_saved_by = _uid, updated_at = now()
   WHERE id = _doc RETURNING * INTO d;
  RETURN d;
END
$$;

CREATE OR REPLACE FUNCTION public.sa_save_draft(_doc uuid, _content jsonb, _rev integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); d public.sa_documents;
BEGIN
  IF NOT public.sa_can_write_for(_doc, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  d := public.sa_store_draft(_doc, uid, _content, _rev);
  RETURN jsonb_build_object('rev', d.draft_rev, 'saved_at', d.draft_saved_at, 'masked', d.draft <> _content,
                            'content', CASE WHEN d.draft <> _content THEN d.draft END);
END
$$;

-- Immutable version: number = latest + 1 under the row lock; an approved document goes back to "In review".
CREATE OR REPLACE FUNCTION public.sa_save_version(_doc uuid, _content jsonb, _note text, _rev integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); d public.sa_documents; n integer;
BEGIN
  IF NOT public.sa_can_write_for(_doc, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF char_length(COALESCE(_note, '')) > 500 THEN RAISE EXCEPTION 'sa_note_too_long' USING ERRCODE = '22023'; END IF;
  d := public.sa_store_draft(_doc, uid, _content, _rev);
  IF d.latest_version >= public.sa_setting_int('max_versions_per_doc') THEN RAISE EXCEPTION 'sa_too_many_versions' USING ERRCODE = '22023'; END IF;
  n := d.latest_version + 1;
  UPDATE public.sa_documents SET latest_version = n, status = CASE WHEN status = 'approved' THEN 'in_review' ELSE status END, updated_at = now()
   WHERE id = _doc RETURNING * INTO d;
  INSERT INTO public.sa_versions (doc_id, version, status, content, meta, change_note, created_by)
  VALUES (_doc, n, d.status, d.draft, public.sa_meta_of(d), public.mask_contact_details(trim(COALESCE(_note, ''))), uid);
  PERFORM public.sa_log_event(_doc, uid, 'version', n, '{}'::jsonb);
  RETURN jsonb_build_object('version', n, 'rev', d.draft_rev, 'status', d.status, 'content', d.draft);
END
$$;

CREATE OR REPLACE FUNCTION public.sa_restore_version(_doc uuid, _version integer, _note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); d public.sa_documents; v public.sa_versions; n integer;
BEGIN
  IF NOT public.sa_can_write_for(_doc, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.sa_documents WHERE id = _doc FOR UPDATE;
  SELECT * INTO v FROM public.sa_versions WHERE doc_id = _doc AND version = _version;
  IF v.id IS NULL THEN RAISE EXCEPTION 'sa_version_not_found' USING ERRCODE = 'P0002'; END IF;
  n := d.latest_version + 1;
  UPDATE public.sa_documents SET latest_version = n, draft = v.content, draft_rev = draft_rev + 1, draft_saved_at = now(), draft_saved_by = uid,
         status = CASE WHEN status = 'approved' THEN 'in_review' ELSE status END, updated_at = now()
   WHERE id = _doc RETURNING * INTO d;
  INSERT INTO public.sa_versions (doc_id, version, status, content, meta, change_note, restored_from, created_by)
  VALUES (_doc, n, d.status, v.content, public.sa_meta_of(d), public.mask_contact_details(left(trim(COALESCE(_note, '')), 500)), _version, uid);
  PERFORM public.sa_log_event(_doc, uid, 'restore', n, jsonb_build_object('from', _version));
  RETURN jsonb_build_object('version', n, 'rev', d.draft_rev, 'content', v.content);
END
$$;

CREATE OR REPLACE FUNCTION public.sa_update_meta(_doc uuid, _patch jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); d public.sa_documents; k text; before jsonb;
BEGIN
  IF NOT public.sa_can_write_for(_doc, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN RAISE EXCEPTION 'sa_invalid_details' USING ERRCODE = '22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    IF k NOT IN ('title', 'sap_area', 'sap_module', 'sap_version', 'owner_name', 'confidentiality') OR jsonb_typeof(_patch -> k) <> 'string' THEN
      RAISE EXCEPTION 'sa_invalid_details %', k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT * INTO d FROM public.sa_documents WHERE id = _doc FOR UPDATE;
  before := public.sa_meta_of(d);
  IF _patch ? 'title' AND char_length(trim(_patch ->> 'title')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'sa_invalid_title' USING ERRCODE = '22023'; END IF;
  IF _patch ? 'confidentiality' AND (_patch ->> 'confidentiality') NOT IN ('private', 'shared') THEN RAISE EXCEPTION 'sa_invalid_options' USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_documents SET
    title = CASE WHEN _patch ? 'title' THEN public.mask_contact_details(trim(_patch ->> 'title')) ELSE title END,
    sap_area = CASE WHEN _patch ? 'sap_area' THEN left(_patch ->> 'sap_area', 120) ELSE sap_area END,
    sap_module = CASE WHEN _patch ? 'sap_module' THEN left(_patch ->> 'sap_module', 120) ELSE sap_module END,
    sap_version = CASE WHEN _patch ? 'sap_version' THEN left(_patch ->> 'sap_version', 120) ELSE sap_version END,
    owner_name = CASE WHEN _patch ? 'owner_name' THEN public.mask_contact_details(left(trim(_patch ->> 'owner_name'), 120)) ELSE owner_name END,
    confidentiality = CASE WHEN _patch ? 'confidentiality' THEN _patch ->> 'confidentiality' ELSE confidentiality END,
    updated_at = now()
  WHERE id = _doc RETURNING * INTO d;
  PERFORM public.sa_log_event(_doc, uid, CASE WHEN before ->> 'confidentiality' <> d.confidentiality THEN 'sharing' ELSE 'details' END, NULL,
                              jsonb_build_object('before', before, 'after', public.sa_meta_of(d)));
  RETURN true;
END
$$;

-- Status rules (mirror of allowedStatuses): approval needs a saved version and approves the newest one; archive is
-- soft; an archived document can only come back as a draft.
CREATE OR REPLACE FUNCTION public.sa_set_status(_doc uuid, _status text, _note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); d public.sa_documents; prev text;
BEGIN
  IF NOT public.sa_can_write_for(_doc, uid, true) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _status NOT IN ('draft', 'in_review', 'approved', 'superseded', 'archived') THEN RAISE EXCEPTION 'sa_invalid_status' USING ERRCODE = '22023'; END IF;
  SELECT * INTO d FROM public.sa_documents WHERE id = _doc FOR UPDATE;
  prev := d.status;
  IF prev = _status THEN RETURN jsonb_build_object('status', d.status, 'approved_version', d.approved_version); END IF;
  IF prev = 'archived' AND _status <> 'draft' THEN RAISE EXCEPTION 'sa_archived' USING ERRCODE = '22023'; END IF;
  IF _status = 'approved' AND d.latest_version = 0 THEN RAISE EXCEPTION 'sa_save_version_first' USING ERRCODE = '22023'; END IF;
  IF _status = 'archived' AND char_length(trim(COALESCE(_note, ''))) < 3 THEN RAISE EXCEPTION 'sa_reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_documents SET status = _status,
         approved_version = CASE WHEN _status = 'approved' THEN latest_version ELSE approved_version END,
         archived_at = CASE WHEN _status = 'archived' THEN now() WHEN prev = 'archived' THEN NULL ELSE archived_at END,
         archived_by = CASE WHEN _status = 'archived' THEN uid WHEN prev = 'archived' THEN NULL ELSE archived_by END,
         archive_reason = CASE WHEN _status = 'archived' THEN left(trim(_note), 300) WHEN prev = 'archived' THEN NULL ELSE archive_reason END,
         updated_at = now()
   WHERE id = _doc RETURNING * INTO d;
  PERFORM public.sa_log_event(_doc, uid, CASE WHEN _status = 'archived' THEN 'archive' ELSE 'status' END,
                              CASE WHEN _status = 'approved' THEN d.latest_version END,
                              jsonb_build_object('from', prev, 'to', _status, 'note', public.mask_contact_details(left(trim(COALESCE(_note, '')), 300))));
  RETURN jsonb_build_object('status', d.status, 'approved_version', d.approved_version);
END
$$;

CREATE OR REPLACE FUNCTION public.sa_set_links(_doc uuid, _tickets uuid[], _projects uuid[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT public.sa_can_write_for(_doc, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  PERFORM public.sa_set_links_internal(_doc, uid, _tickets, _projects);
  UPDATE public.sa_documents SET updated_at = now() WHERE id = _doc;
  PERFORM public.sa_log_event(_doc, uid, 'links', NULL, jsonb_build_object('tickets', COALESCE(array_length(_tickets, 1), 0), 'projects', COALESCE(array_length(_projects, 1), 0)));
  RETURN true;
END
$$;

-- ------------------------------------------------------------------------------------------------ comments
CREATE OR REPLACE FUNCTION public.sa_add_comment(_doc uuid, _version integer, _section text, _body text,
  _parent uuid DEFAULT NULL, _kind text DEFAULT 'comment', _suggested text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r text := public.sa_role_for(_doc, uid);
  d public.sa_documents;
  par public.sa_comments;
  new_id uuid;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.sa_documents WHERE id = _doc;
  IF d.archived_at IS NOT NULL THEN RAISE EXCEPTION 'sa_archived' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sa_versions WHERE doc_id = _doc AND version = _version) THEN RAISE EXCEPTION 'sa_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _section IS NULL OR NOT (_section = 'general' OR _section = 'details' OR _section = ANY (public.sa_type_sections(d.type))) THEN
    RAISE EXCEPTION 'sa_invalid_section' USING ERRCODE = '22023';
  END IF;
  IF _kind NOT IN ('comment', 'suggestion') OR (_kind = 'suggestion' AND r NOT IN ('consultant', 'admin', 'company')) THEN
    RAISE EXCEPTION 'sa_invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF char_length(trim(COALESCE(_body, ''))) = 0 OR char_length(_body) > 4000 OR char_length(COALESCE(_suggested, '')) > 20000
     OR (_kind = 'suggestion' AND char_length(trim(COALESCE(_suggested, ''))) = 0) THEN
    RAISE EXCEPTION 'sa_invalid_comment' USING ERRCODE = '22023';
  END IF;
  IF public.contact_details_in_text(_body) OR public.contact_details_in_text(_suggested) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.sa_comments WHERE author_id = uid AND created_at > now() - interval '1 day') >= public.sa_setting_int('comments_per_user_per_day') THEN
    RAISE EXCEPTION 'sa_comment_limit' USING ERRCODE = '54000';
  END IF;
  IF _parent IS NOT NULL THEN
    SELECT * INTO par FROM public.sa_comments WHERE id = _parent AND doc_id = _doc;
    IF par.id IS NULL THEN RAISE EXCEPTION 'sa_invalid_parent' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO public.sa_comments (doc_id, version, section_key, parent_id, author_id, author_role, author_consultant_id, kind, body, suggested_text)
  VALUES (_doc, _version, _section, _parent, uid, r, CASE WHEN r = 'consultant' THEN public.brd_consultant_of(uid) END, _kind, trim(_body),
          NULLIF(trim(COALESCE(_suggested, '')), ''))
  RETURNING id INTO new_id;
  PERFORM public.sa_log_event(_doc, uid, CASE WHEN _kind = 'suggestion' THEN 'suggestion' ELSE 'comment' END, _version, jsonb_build_object('comment_id', new_id, 'section', _section));
  IF r IN ('consultant', 'company') AND d.created_by <> uid THEN
    PERFORM public.safe_insert_notification(d.created_by,
      CASE WHEN _kind = 'suggestion' THEN 'Suggested change on your architecture document' ELSE 'New comment on your architecture document' END,
      'On "' || left(d.title, 120) || '", version ' || _version || '.', 'architecture', '/client/solution-architecture/' || _doc);
  ELSIF par.id IS NOT NULL AND par.author_role = 'consultant' AND par.author_id <> uid THEN
    PERFORM public.safe_insert_notification(par.author_id, 'Reply on an architecture document',
      'The client replied on "' || left(d.title, 120) || '", version ' || _version || '.', 'architecture', '/architecture/' || _doc);
  END IF;
  RETURN new_id;
END
$$;

CREATE OR REPLACE FUNCTION public.sa_set_comment_status(_comment uuid, _status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); c public.sa_comments;
BEGIN
  SELECT * INTO c FROM public.sa_comments WHERE id = _comment;
  IF c.id IS NULL THEN RAISE EXCEPTION 'sa_comment_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _status NOT IN ('open', 'resolved', 'accepted', 'declined') THEN RAISE EXCEPTION 'sa_invalid_status' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_can_write_for(c.doc_id, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.sa_comments SET status = _status, status_by = uid, status_at = now() WHERE id = c.id;
  PERFORM public.sa_log_event(c.doc_id, uid, 'comment_' || _status, c.version, jsonb_build_object('comment_id', c.id));
  RETURN true;
END
$$;

-- ------------------------------------------------------------------------------------------------ pictures
CREATE OR REPLACE FUNCTION public.sa_asset_register(_doc uuid, _path text, _name text, _mime text, _size bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); new_id uuid; ext text;
BEGIN
  IF NOT public.sa_can_write_for(_doc, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _mime NOT IN ('image/png', 'image/jpeg', 'image/svg+xml') THEN RAISE EXCEPTION 'sa_invalid_file_type' USING ERRCODE = '22023'; END IF;
  ext := CASE _mime WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpg' ELSE 'svg' END;
  IF _path IS NULL OR _path !~ ('^arch/' || _doc::text || '/[0-9a-f]{24,32}\.' || ext || '$') THEN RAISE EXCEPTION 'sa_invalid_path' USING ERRCODE = '22023'; END IF;
  IF _size IS NULL OR _size <= 0 OR _size > 5242880 THEN RAISE EXCEPTION 'sa_invalid_size' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.sa_assets WHERE doc_id = _doc) >= public.sa_setting_int('max_assets_per_doc') THEN RAISE EXCEPTION 'sa_too_many_pictures' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.sa_assets WHERE created_by = uid AND created_at > now() - interval '1 day') >= public.sa_setting_int('uploads_per_user_per_day') THEN
    RAISE EXCEPTION 'sa_upload_limit' USING ERRCODE = '54000';
  END IF;
  IF to_regclass('storage.objects') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ticket-documents' AND o.name = _path) THEN
    RAISE EXCEPTION 'sa_file_missing' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.sa_assets (doc_id, path, file_name, mime, size, created_by)
  VALUES (_doc, _path, left(regexp_replace(COALESCE(_name, 'picture'), '[^A-Za-z0-9 ._-]', '', 'g'), 120), _mime, _size, uid)
  RETURNING id INTO new_id;
  PERFORM public.sa_log_event(_doc, uid, 'picture', NULL, jsonb_build_object('asset_id', new_id, 'mime', _mime, 'size', _size));
  RETURN jsonb_build_object('id', new_id, 'file_name', left(COALESCE(_name, 'picture'), 120), 'mime', _mime, 'size', _size, 'path', _path);
END
$$;

-- ------------------------------------------------------------------------------------------------ attach
CREATE OR REPLACE FUNCTION public.sa_attach(_doc uuid, _ticket uuid, _version integer, _path text, _size bigint, _notify boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  d public.sa_documents;
  doc_row uuid;
  fname text;
  short text;
  rec record;
  notified integer := 0;
BEGIN
  IF NOT public.sa_can_write_for(_doc, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.sa_documents WHERE id = _doc FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.sa_links WHERE doc_id = _doc AND ticket_id = _ticket) THEN RAISE EXCEPTION 'sa_ticket_not_linked' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sa_versions WHERE doc_id = _doc AND version = _version) THEN RAISE EXCEPTION 'sa_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _path IS NULL OR _path !~ ('^' || _ticket::text || '/architecture/' || _doc::text || '/[A-Za-z0-9_.-]{1,120}\.pdf$') THEN
    RAISE EXCEPTION 'sa_invalid_path' USING ERRCODE = '22023';
  END IF;
  IF _size IS NULL OR _size < 100 OR _size > 20 * 1024 * 1024 THEN RAISE EXCEPTION 'sa_invalid_size' USING ERRCODE = '22023'; END IF;
  IF to_regclass('storage.objects') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ticket-documents' AND o.name = _path) THEN
    RAISE EXCEPTION 'sa_file_missing' USING ERRCODE = 'P0002';
  END IF;
  short := CASE d.type WHEN 'blueprint' THEN 'Blueprint' WHEN 'hld' THEN 'HLD' WHEN 'lld' THEN 'LLD' WHEN 'integration' THEN 'Integration'
             WHEN 'migration' THEN 'Migration' WHEN 'security' THEN 'Security' WHEN 'test' THEN 'Test' WHEN 'cutover' THEN 'Cutover'
             WHEN 'adr' THEN 'ADR' ELSE 'Other' END;
  fname := 'ARCH_' || short || '_' || public.brd_ref(_doc) || '_v' || _version || '_' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '.pdf';
  UPDATE public.ticket_documents SET superseded_at = now()
   WHERE ticket_id = _ticket AND doc_type = 'architecture' AND arch_doc_id = _doc AND superseded_at IS NULL AND unattached_at IS NULL;
  INSERT INTO public.ticket_documents (ticket_id, uploaded_by, file_name, file_url, file_size, mime_type, version, comment, doc_type, arch_doc_id, arch_version)
  VALUES (_ticket, uid, fname, _path, _size, 'application/pdf', _version, left(d.title, 150) || ' v' || _version, 'architecture', _doc, _version)
  RETURNING id INTO doc_row;
  PERFORM public.sa_log_event(_doc, uid, 'attach', _version, jsonb_build_object('document_id', doc_row, 'ticket_id', _ticket, 'notify', COALESCE(_notify, false)));
  IF COALESCE(_notify, false) AND d.confidentiality = 'shared' THEN
    FOR rec IN SELECT * FROM public.brd_consultant_readers(_ticket) LOOP
      IF public.sa_role_for(_doc, rec.user_id) = 'consultant' THEN
        PERFORM public.safe_insert_notification(rec.user_id, 'Architecture document attached',
          '"' || left(d.title, 120) || '" v' || _version || ' was attached to your request.', 'architecture', '/architecture/' || _doc);
        notified := notified + 1;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('document_id', doc_row, 'file_name', fname, 'notified', notified);
END
$$;

CREATE OR REPLACE FUNCTION public.sa_unattach(_document_id uuid, _reason text DEFAULT '')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); td public.ticket_documents; prev uuid;
BEGIN
  SELECT * INTO td FROM public.ticket_documents WHERE id = _document_id AND doc_type = 'architecture' FOR UPDATE;
  IF td.id IS NULL THEN RAISE EXCEPTION 'sa_document_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.sa_can_write_for(td.arch_doc_id, uid, true) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF td.unattached_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.ticket_documents SET unattached_at = now(), unattached_by = uid WHERE id = td.id;
  IF td.superseded_at IS NULL THEN
    SELECT id INTO prev FROM public.ticket_documents
     WHERE ticket_id = td.ticket_id AND doc_type = 'architecture' AND arch_doc_id = td.arch_doc_id AND unattached_at IS NULL AND id <> td.id
     ORDER BY created_at DESC LIMIT 1;
    IF prev IS NOT NULL THEN UPDATE public.ticket_documents SET superseded_at = NULL WHERE id = prev; END IF;
  END IF;
  PERFORM public.sa_log_event(td.arch_doc_id, uid, 'unattach', td.arch_version, jsonb_build_object('document_id', td.id, 'reason', left(trim(COALESCE(_reason, '')), 300)));
  RETURN true;
END
$$;

-- ------------------------------------------------------------------------------------------------ landscape register
CREATE OR REPLACE FUNCTION public.sa_landscape_list(_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT public.sa_can_read_scope(_tenant, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name, 'sid', y.sid, 'role', y.role, 'product', y.product, 'release', y.release,
                    'hosting', y.hosting, 'notes', y.notes, 'updated_at', y.updated_at) ORDER BY y.role, y.name)
                   FROM public.sa_systems y
                   WHERE y.archived_at IS NULL AND ((_tenant IS NOT NULL AND y.tenant_id = _tenant) OR (_tenant IS NULL AND y.tenant_id IS NULL AND y.client_id = uid))), '[]'::jsonb);
END
$$;

-- Create or update one system. Password-like content is refused (the register never stores credentials).
CREATE OR REPLACE FUNCTION public.sa_landscape_save(_tenant uuid, _row jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  rid uuid := NULLIF(_row ->> 'id', '')::uuid;
  y public.sa_systems;
  nm text := trim(COALESCE(_row ->> 'name', ''));
  sd text := upper(trim(COALESCE(_row ->> 'sid', '')));
BEGIN
  IF NOT public.sa_can_create(_tenant, uid) AND NOT public.brd_is_admin(uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF public.sa_text_has_secret(nm) OR public.sa_text_has_secret(_row ->> 'product') OR public.sa_text_has_secret(_row ->> 'release') OR public.sa_text_has_secret(_row ->> 'notes') THEN
    RAISE EXCEPTION 'Do not store passwords, keys, tokens or connection secrets in the landscape register.' USING ERRCODE = '22023', HINT = 'sa_secret_rejected';
  END IF;
  IF (SELECT count(*) FROM public.sa_events WHERE actor_id = uid AND action = 'landscape' AND created_at > now() - interval '1 day') >= public.sa_setting_int('landscape_saves_per_user_per_day') THEN
    RAISE EXCEPTION 'sa_landscape_limit' USING ERRCODE = '54000';
  END IF;
  IF rid IS NOT NULL THEN
    SELECT * INTO y FROM public.sa_systems WHERE id = rid AND archived_at IS NULL FOR UPDATE;
    IF y.id IS NULL OR NOT ((_tenant IS NOT NULL AND y.tenant_id = _tenant) OR (_tenant IS NULL AND y.tenant_id IS NULL AND y.client_id = uid)) THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
    END IF;
    UPDATE public.sa_systems SET name = nm, sid = sd, role = _row ->> 'role', product = left(COALESCE(_row ->> 'product', ''), 120),
           release = left(COALESCE(_row ->> 'release', ''), 120), hosting = COALESCE(_row ->> 'hosting', 'other'),
           notes = public.mask_contact_details(left(COALESCE(_row ->> 'notes', ''), 1000)), updated_at = now()
     WHERE id = rid;
  ELSE
    IF (SELECT count(*) FROM public.sa_systems WHERE archived_at IS NULL AND ((_tenant IS NOT NULL AND tenant_id = _tenant) OR (_tenant IS NULL AND tenant_id IS NULL AND client_id = uid)))
       >= public.sa_setting_int('max_systems') THEN
      RAISE EXCEPTION 'sa_too_many_systems' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.sa_systems (tenant_id, client_id, name, sid, role, product, release, hosting, notes, created_by)
    VALUES (_tenant, uid, nm, sd, _row ->> 'role', left(COALESCE(_row ->> 'product', ''), 120), left(COALESCE(_row ->> 'release', ''), 120),
            COALESCE(_row ->> 'hosting', 'other'), public.mask_contact_details(left(COALESCE(_row ->> 'notes', ''), 1000)), uid)
    RETURNING id INTO rid;
  END IF;
  INSERT INTO public.sa_events (doc_id, tenant_id, client_id, actor_id, action, detail)
  VALUES (NULL, _tenant, CASE WHEN _tenant IS NULL THEN uid END, uid, 'landscape', jsonb_build_object('system_id', rid, 'name', nm));
  RETURN rid;
END
$$;

CREATE OR REPLACE FUNCTION public.sa_landscape_archive(_id uuid, _reason text DEFAULT '')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); y public.sa_systems;
BEGIN
  SELECT * INTO y FROM public.sa_systems WHERE id = _id AND archived_at IS NULL;
  IF y.id IS NULL THEN RETURN false; END IF;
  IF NOT (public.brd_is_admin(uid) OR public.sa_can_create(y.tenant_id, uid) AND (y.tenant_id IS NOT NULL OR y.client_id = uid)) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sa_systems SET archived_at = now(), updated_at = now() WHERE id = _id;
  INSERT INTO public.sa_events (doc_id, tenant_id, client_id, actor_id, action, detail)
  VALUES (NULL, y.tenant_id, y.client_id, uid, 'landscape_archive', jsonb_build_object('system_id', _id, 'reason', left(trim(COALESCE(_reason, '')), 300)));
  RETURN true;
END
$$;

-- Systems picked on a ticket (client / company / admin see and choose; the ticket's consultants see the picked ones).
CREATE OR REPLACE FUNCTION public.sa_ticket_systems(_ticket uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.brd_role_for(_ticket, uid); t record; edit boolean;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT id, tenant_id, client_id INTO t FROM public.tickets WHERE id = _ticket;
  edit := r IN ('admin', 'client') AND COALESCE((public.sa_settings() ->> 'enabled')::boolean, false);
  RETURN jsonb_build_object(
    'can_edit', edit,
    'systems', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name, 'sid', y.sid, 'role', y.role, 'product', y.product, 'release', y.release,
                 'hosting', y.hosting, 'notes', '') ORDER BY y.role, y.name)
               FROM public.sa_ticket_systems ts JOIN public.sa_systems y ON y.id = ts.system_id WHERE ts.ticket_id = _ticket AND y.archived_at IS NULL), '[]'::jsonb),
    'available', CASE WHEN edit THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name, 'sid', y.sid, 'role', y.role, 'product', y.product,
                 'release', y.release, 'hosting', y.hosting, 'notes', '') ORDER BY y.role, y.name)
               FROM public.sa_systems y WHERE y.archived_at IS NULL
                 AND ((t.tenant_id IS NOT NULL AND y.tenant_id = t.tenant_id) OR (t.tenant_id IS NULL AND y.tenant_id IS NULL AND y.client_id = t.client_id))), '[]'::jsonb)
             ELSE '[]'::jsonb END);
END
$$;

CREATE OR REPLACE FUNCTION public.sa_set_ticket_systems(_ticket uuid, _systems uuid[])
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.brd_role_for(_ticket, uid); t record;
BEGIN
  IF r IS NULL OR r NOT IN ('admin', 'client') OR (r <> 'admin' AND NOT COALESCE((public.sa_settings() ->> 'enabled')::boolean, false)) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(array_length(_systems, 1), 0) > 20 THEN RAISE EXCEPTION 'sa_too_many_links' USING ERRCODE = '22023'; END IF;
  SELECT id, tenant_id, client_id INTO t FROM public.tickets WHERE id = _ticket;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(_systems, '{}')) s(id) WHERE NOT EXISTS (
       SELECT 1 FROM public.sa_systems y WHERE y.id = s.id AND y.archived_at IS NULL
         AND ((t.tenant_id IS NOT NULL AND y.tenant_id = t.tenant_id) OR (t.tenant_id IS NULL AND y.tenant_id IS NULL AND y.client_id = t.client_id)))) THEN
    RAISE EXCEPTION 'sa_unknown_system' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.sa_ticket_systems WHERE ticket_id = _ticket AND NOT (system_id = ANY (COALESCE(_systems, '{}')));
  INSERT INTO public.sa_ticket_systems (ticket_id, system_id, created_by) SELECT _ticket, s, uid FROM unnest(COALESCE(_systems, '{}')) s ON CONFLICT DO NOTHING;
  RETURN true;
END
$$;

-- ------------------------------------------------------------------------------------------------ AI (service role)
-- Called by the architecture-ai function with the signed-in caller's id. Off unless enabled + ai_enabled.
CREATE OR REPLACE FUNCTION public.sa_ai_claim(_doc uuid, _actor uuid, _kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.sa_settings(); d public.sa_documents; sk text; n_doc integer; n_org integer; reason text; new_id uuid;
BEGIN
  IF _kind NOT IN ('arch_draft', 'arch_components', 'arch_review') THEN RAISE EXCEPTION 'sa_invalid_kind' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE((s ->> 'enabled')::boolean, false) OR NOT COALESCE((s ->> 'ai_enabled')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ai_off');
  END IF;
  IF NOT public.sa_can_write_for(_doc, _actor) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('sa_ai:' || _doc::text));
  SELECT * INTO d FROM public.sa_documents WHERE id = _doc;
  sk := public.sa_scope_key(d.tenant_id, d.client_id);
  SELECT count(*) INTO n_doc FROM public.sa_ai_usage WHERE doc_id = _doc AND status <> 'refused' AND created_at > now() - interval '1 day';
  SELECT count(*) INTO n_org FROM public.sa_ai_usage WHERE scope_key = sk AND status <> 'refused' AND created_at > now() - interval '1 day';
  IF n_doc >= COALESCE((s ->> 'ai_calls_per_doc_per_day')::integer, 10) THEN reason := 'doc_limit';
  ELSIF n_org >= COALESCE((s ->> 'ai_calls_per_org_per_day')::integer, 30) THEN reason := 'org_limit';
  END IF;
  INSERT INTO public.sa_ai_usage (doc_id, scope_key, actor_id, kind, model, status, reason)
  VALUES (_doc, sk, _actor, _kind, s ->> 'ai_model', CASE WHEN reason IS NULL THEN 'running' ELSE 'refused' END, reason)
  RETURNING id INTO new_id;
  IF reason IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', reason); END IF;
  RETURN jsonb_build_object('ok', true, 'id', new_id, 'model', s ->> 'ai_model', 'max_brd_chars', COALESCE((s ->> 'max_brd_chars')::integer, 12000));
END
$$;

CREATE OR REPLACE FUNCTION public.sa_ai_finish(_id uuid, _status text, _input integer, _output integer, _reason text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.sa_ai_usage
     SET status = CASE WHEN _status IN ('ok', 'failed') THEN _status ELSE 'failed' END,
         input_tokens = GREATEST(0, COALESCE(_input, 0)), output_tokens = GREATEST(0, COALESCE(_output, 0)),
         reason = left(_reason, 120), finished_at = now()
   WHERE id = _id AND status = 'running'
$$;

-- Context the AI may use: the document details and, for a linked ticket the caller can read, the ticket and its
-- newest saved BRD version (already contact-masked). Never landscape notes, never other documents.
CREATE OR REPLACE FUNCTION public.sa_ai_context(_doc uuid, _actor uuid, _ticket uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.sa_documents; t record; brd jsonb;
BEGIN
  IF NOT public.sa_can_write_for(_doc, _actor) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO d FROM public.sa_documents WHERE id = _doc;
  IF _ticket IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.sa_links WHERE doc_id = _doc AND ticket_id = _ticket) OR public.brd_role_for(_ticket, _actor) IS NULL THEN
      RAISE EXCEPTION 'sa_ticket_not_linked' USING ERRCODE = '22023';
    END IF;
    SELECT id, title, description, sap_module, status INTO t FROM public.tickets WHERE id = _ticket;
    SELECT content INTO brd FROM public.ticket_brd_versions WHERE ticket_id = _ticket ORDER BY version DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('meta', public.sa_meta_of(d), 'language', d.language,
    'ticket', CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('ref', public.brd_ref(t.id), 'title', public.mask_contact_details(t.title),
                'description', public.mask_contact_details(left(COALESCE(t.description, ''), 4000)), 'sap_module', t.sap_module, 'status', t.status) END,
    'brd', brd,
    'systems', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', y.name, 'sid', y.sid, 'role', y.role, 'product', y.product, 'release', y.release, 'hosting', y.hosting))
                FROM public.sa_systems y WHERE y.archived_at IS NULL AND y.id::text IN (SELECT jsonb_array_elements_text(COALESCE(d.draft -> 'systems', '[]'::jsonb)))), '[]'::jsonb));
END
$$;

-- ------------------------------------------------------------------------------------------------ admin
CREATE OR REPLACE FUNCTION public.admin_sa_set_settings(_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); before jsonb := public.sa_settings(); merged jsonb := public.sa_settings(); k text; v jsonb;
BEGIN
  IF NOT public.brd_is_admin(uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _value IS NULL OR jsonb_typeof(_value) <> 'object' THEN RAISE EXCEPTION 'sa_invalid_settings' USING ERRCODE = '22023'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(_value) LOOP
    IF k IN ('enabled', 'ai_enabled', 'require_nda') THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'sa_invalid_setting %', k USING ERRCODE = '22023'; END IF;
    ELSIF k IN ('ai_calls_per_doc_per_day', 'ai_calls_per_org_per_day', 'max_brd_chars', 'docs_per_user_per_day', 'comments_per_user_per_day',
                'uploads_per_user_per_day', 'landscape_saves_per_user_per_day', 'max_assets_per_doc', 'max_versions_per_doc', 'max_systems') THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) OR (v #>> '{}')::integer < 0
         OR (k = 'max_brd_chars' AND (v #>> '{}')::integer > 30000)
         OR (k <> 'max_brd_chars' AND (v #>> '{}')::integer > 1000) THEN
        RAISE EXCEPTION 'sa_invalid_setting %', k USING ERRCODE = '22023';
      END IF;
    ELSIF k = 'ai_model' THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') !~ '^(openai|google)/[a-z0-9][a-z0-9.-]{1,60}$' THEN
        RAISE EXCEPTION 'sa_invalid_setting %', k USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'sa_unknown_setting %', k USING ERRCODE = '22023';
    END IF;
    merged := merged || jsonb_build_object(k, v);
  END LOOP;
  INSERT INTO public.platform_settings (key, value) VALUES ('solution_architecture', merged)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (uid, 'solution_architecture_settings_changed', 'platform_settings', NULL, jsonb_build_object('before', before, 'after', merged));
  RETURN merged;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_sa_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.brd_is_admin(auth.uid()) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'settings', public.sa_settings(),
    'documents', (SELECT count(*) FROM public.sa_documents WHERE archived_at IS NULL),
    'archived', (SELECT count(*) FROM public.sa_documents WHERE archived_at IS NOT NULL),
    'versions', (SELECT count(*) FROM public.sa_versions),
    'shared', (SELECT count(*) FROM public.sa_documents WHERE confidentiality = 'shared' AND archived_at IS NULL),
    'attached', (SELECT count(*) FROM public.ticket_documents WHERE doc_type = 'architecture' AND unattached_at IS NULL),
    'systems', (SELECT count(*) FROM public.sa_systems WHERE archived_at IS NULL),
    'ai_today', (SELECT count(*) FROM public.sa_ai_usage WHERE status <> 'refused' AND created_at > now() - interval '1 day'),
    'ai_refused_today', (SELECT count(*) FROM public.sa_ai_usage WHERE status = 'refused' AND created_at > now() - interval '1 day'),
    'tokens_30d', jsonb_build_object(
      'input', (SELECT COALESCE(sum(input_tokens), 0) FROM public.sa_ai_usage WHERE created_at > now() - interval '30 days'),
      'output', (SELECT COALESCE(sum(output_tokens), 0) FROM public.sa_ai_usage WHERE created_at > now() - interval '30 days')));
END
$$;

-- ------------------------------------------------------------------------------------------------ function grants
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'sa_default_settings()', 'sa_settings()', 'sa_setting_int(text)', 'sa_public_settings()', 'sa_type_sections(text)',
    'sa_scope_role(uuid, uuid, uuid, uuid)', 'sa_consultant_on_ticket(uuid, uuid)', 'sa_role_for(uuid, uuid)', 'sa_role(uuid)',
    'sa_can_write_for(uuid, uuid, boolean)', 'sa_can_create(uuid, uuid)', 'sa_can_read_scope(uuid, uuid)', 'sa_ticket_in_scope(uuid, uuid, uuid)',
    'sa_project_in_scope(uuid, uuid, uuid)', 'sa_text_has_secret(text)', 'sa_mask_content(jsonb)', 'sa_validate_content(uuid, text, jsonb)',
    'sa_meta_of(public.sa_documents)', 'sa_asset_doc_of_path(text)', 'sa_pdf_doc_of_path(text)', 'sa_asset_readable(text)', 'sa_asset_can_insert(text)',
    'sa_pdf_readable(text)', 'sa_pdf_can_insert(text)', 'sa_doc_row_visible(uuid, timestamptz)', 'sa_log_event(uuid, uuid, text, integer, jsonb)',
    'sa_scope_key(uuid, uuid)', 'sa_row_json(public.sa_documents, uuid)', 'sa_list(uuid, boolean)', 'sa_get(uuid)', 'sa_get_version(uuid, integer)',
    'sa_log_access(uuid, integer, text)', 'sa_timeline(uuid, integer)', 'sa_for_ticket(uuid)', 'sa_set_links_internal(uuid, uuid, uuid[], uuid[])',
    'sa_create(uuid, jsonb)', 'sa_store_draft(uuid, uuid, jsonb, integer)', 'sa_save_draft(uuid, jsonb, integer)', 'sa_save_version(uuid, jsonb, text, integer)',
    'sa_restore_version(uuid, integer, text)', 'sa_update_meta(uuid, jsonb)', 'sa_set_status(uuid, text, text)', 'sa_set_links(uuid, uuid[], uuid[])',
    'sa_add_comment(uuid, integer, text, text, uuid, text, text)', 'sa_set_comment_status(uuid, text)', 'sa_asset_register(uuid, text, text, text, bigint)',
    'sa_attach(uuid, uuid, integer, text, bigint, boolean)', 'sa_unattach(uuid, text)', 'sa_landscape_list(uuid)', 'sa_landscape_save(uuid, jsonb)',
    'sa_landscape_archive(uuid, text)', 'sa_ticket_systems(uuid)', 'sa_set_ticket_systems(uuid, uuid[])', 'sa_ai_claim(uuid, uuid, text)',
    'sa_ai_finish(uuid, text, integer, integer, text)', 'sa_ai_context(uuid, uuid, uuid)', 'admin_sa_set_settings(jsonb)', 'admin_sa_overview()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- Signed-in browser entry points (each checks the caller itself) and the helpers the policies evaluate.
  FOREACH f IN ARRAY ARRAY[
    'sa_public_settings()', 'sa_role(uuid)', 'sa_doc_row_visible(uuid, timestamptz)', 'sa_asset_readable(text)', 'sa_asset_can_insert(text)',
    'sa_pdf_readable(text)', 'sa_pdf_can_insert(text)', 'sa_asset_doc_of_path(text)', 'sa_pdf_doc_of_path(text)',
    'sa_list(uuid, boolean)', 'sa_get(uuid)', 'sa_get_version(uuid, integer)', 'sa_log_access(uuid, integer, text)', 'sa_timeline(uuid, integer)',
    'sa_for_ticket(uuid)', 'sa_create(uuid, jsonb)', 'sa_save_draft(uuid, jsonb, integer)', 'sa_save_version(uuid, jsonb, text, integer)',
    'sa_restore_version(uuid, integer, text)', 'sa_update_meta(uuid, jsonb)', 'sa_set_status(uuid, text, text)', 'sa_set_links(uuid, uuid[], uuid[])',
    'sa_add_comment(uuid, integer, text, text, uuid, text, text)', 'sa_set_comment_status(uuid, text)', 'sa_asset_register(uuid, text, text, text, bigint)',
    'sa_attach(uuid, uuid, integer, text, bigint, boolean)', 'sa_unattach(uuid, text)', 'sa_landscape_list(uuid)', 'sa_landscape_save(uuid, jsonb)',
    'sa_landscape_archive(uuid, text)', 'sa_ticket_systems(uuid)', 'sa_set_ticket_systems(uuid, uuid[])', 'admin_sa_set_settings(jsonb)', 'admin_sa_overview()'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- anon evaluates the restrictive policies too (they answer false without a user).
  FOREACH f IN ARRAY ARRAY['sa_doc_row_visible(uuid, timestamptz)', 'sa_asset_readable(text)', 'sa_asset_can_insert(text)', 'sa_pdf_readable(text)',
                           'sa_pdf_can_insert(text)', 'sa_asset_doc_of_path(text)', 'sa_pdf_doc_of_path(text)'] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO anon', f);
  END LOOP;
END $$;
