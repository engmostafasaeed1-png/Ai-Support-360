-- ============================================================================================================
-- Business Requirements Document (BRD) from a ticket.                      PREPARED FOR REVIEW - NOT APPLIED.
-- Run once in a transaction; safe to re-run (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).
-- Then run docs/sql/ticket-brd.test.sql (it rolls back).
--
-- What it adds
--   * settings key platform_settings.ticket_brd (feature OFF by default, NDA required, AI limits, models);
--   * ticket_brds (one per ticket: the autosaved draft), ticket_brd_versions (immutable v1, v2 ...),
--     ticket_brd_comments (threaded, per section, suggestions), ticket_brd_access_log (who opened / downloaded),
--     ticket_brd_events (audit), ticket_brd_ai_usage (calls, model, tokens), ticket_brd_notices (e-mail claims);
--   * ticket_documents gets doc_type 'brd' + brd_version / superseded_at / unattached_at (attach = a normal
--     ticket document row, so the Documents list shows it);
--   * the reader rule brd_role_for = the existing ticket-document rule + an NDA signed by both parties for
--     consultants (setting require_nda, default on). Bidders / matched-but-not-assigned consultants: no access.
--   * restrictive policies so BRD rows and files under <ticket>/brd/ in the ticket-documents bucket follow that
--     rule (the older ticket-document policies cannot widen it), are never replaced or deleted, and are written only
--     by the functions below.
--
-- Security model: browsers never read or write the BRD tables directly (no table grants to anon/authenticated);
-- everything goes through the SECURITY DEFINER functions below, which check the caller with brd_role_for.
-- Saved text passes the contact-bypass mask (mask_contact_details, M60) and a markup allowlist check.
-- Data lives and dies with the ticket (ON DELETE CASCADE); the immutability triggers allow only that cascade.
-- ============================================================================================================

-- ------------------------------------------------------------------------------------------------ settings
CREATE OR REPLACE FUNCTION public.brd_default_settings()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', false,
    'require_nda', true,
    'ai_calls_per_ticket_per_day', 12,
    'ai_calls_per_client_per_day', 40,
    'deep_calls_per_ticket_per_day', 3,
    'draft_model', 'openai/gpt-6-luna',
    'deep_model', 'openai/gpt-6-astra',
    'max_attachments', 3,
    'max_attachment_chars', 6000,
    'comments_per_user_per_day', 60
  )
$$;

CREATE OR REPLACE FUNCTION public.brd_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.brd_default_settings() || COALESCE(
    (SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value END FROM public.platform_settings WHERE key = 'ticket_brd' LIMIT 1),
    '{}'::jsonb)
$$;

-- ------------------------------------------------------------------------------------------------ tables
CREATE TABLE IF NOT EXISTS public.ticket_brds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'ar', 'both')),
  template text NOT NULL DEFAULT 'standard' CHECK (template IN ('standard', 'short', 'technical', 'incident')),
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_rev integer NOT NULL DEFAULT 0,
  draft_saved_at timestamptz,
  draft_saved_by uuid,
  latest_version integer NOT NULL DEFAULT 0,
  shared_version integer,
  edit_unlocked boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ticket_brd_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brd_id uuid NOT NULL REFERENCES public.ticket_brds(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('draft', 'final')),
  content jsonb NOT NULL,
  change_note text NOT NULL DEFAULT '' CHECK (char_length(change_note) <= 500),
  restored_from integer,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid,
  archive_reason text,
  UNIQUE (brd_id, version)
);
CREATE INDEX IF NOT EXISTS ticket_brd_versions_ticket_idx ON public.ticket_brd_versions (ticket_id, version DESC);

CREATE TABLE IF NOT EXISTS public.ticket_brd_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brd_id uuid NOT NULL REFERENCES public.ticket_brds(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  version integer NOT NULL,
  section_key text NOT NULL,
  parent_id uuid REFERENCES public.ticket_brd_comments(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  author_role text NOT NULL CHECK (author_role IN ('client', 'company', 'consultant', 'admin')),
  author_consultant_id uuid,
  kind text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'suggestion')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  suggested_text text CHECK (suggested_text IS NULL OR char_length(suggested_text) <= 20000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'accepted', 'declined')),
  status_by uuid,
  status_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_brd_comments_brd_idx ON public.ticket_brd_comments (brd_id, created_at);
CREATE INDEX IF NOT EXISTS ticket_brd_comments_author_idx ON public.ticket_brd_comments (author_id, created_at);

CREATE TABLE IF NOT EXISTS public.ticket_brd_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brd_id uuid NOT NULL REFERENCES public.ticket_brds(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  version integer NOT NULL,
  viewer_id uuid NOT NULL,
  viewer_role text NOT NULL,
  viewer_consultant_id uuid,
  action text NOT NULL CHECK (action IN ('view', 'download')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_brd_access_log_brd_idx ON public.ticket_brd_access_log (brd_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ticket_brd_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  brd_id uuid,
  actor_id uuid,
  action text NOT NULL,
  version integer,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_brd_events_ticket_idx ON public.ticket_brd_events (ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ticket_brd_ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('draft', 'section', 'improve', 'shorter', 'deep_draft', 'deep_section')),
  model text,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed', 'refused')),
  reason text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS ticket_brd_ai_usage_ticket_idx ON public.ticket_brd_ai_usage (ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_brd_ai_usage_client_idx ON public.ticket_brd_ai_usage (client_id, created_at DESC);

-- ticket_documents: a BRD attachment is a normal document row of type 'brd'.
ALTER TABLE public.ticket_documents ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'file';
ALTER TABLE public.ticket_documents ADD COLUMN IF NOT EXISTS brd_version integer;
ALTER TABLE public.ticket_documents ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE public.ticket_documents ADD COLUMN IF NOT EXISTS unattached_at timestamptz;
ALTER TABLE public.ticket_documents ADD COLUMN IF NOT EXISTS unattached_by uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_documents_doc_type_check') THEN
    ALTER TABLE public.ticket_documents ADD CONSTRAINT ticket_documents_doc_type_check CHECK (doc_type IN ('file', 'brd'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ticket_documents_brd_file_uidx ON public.ticket_documents (file_url) WHERE doc_type = 'brd';

CREATE TABLE IF NOT EXISTS public.ticket_brd_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.ticket_documents(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  version integer NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  emailed_at timestamptz,
  UNIQUE (document_id, user_id)
);

-- Grants: service role only. Browsers use the functions below.
REVOKE ALL ON public.ticket_brds, public.ticket_brd_versions, public.ticket_brd_comments, public.ticket_brd_access_log,
  public.ticket_brd_events, public.ticket_brd_ai_usage, public.ticket_brd_notices FROM anon, authenticated;
GRANT ALL ON public.ticket_brds, public.ticket_brd_versions, public.ticket_brd_comments, public.ticket_brd_access_log,
  public.ticket_brd_events, public.ticket_brd_ai_usage, public.ticket_brd_notices TO service_role;
ALTER TABLE public.ticket_brds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_brd_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_brd_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_brd_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_brd_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_brd_ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_brd_notices ENABLE ROW LEVEL SECURITY;
-- (No policies for anon/authenticated on purpose: RLS on + no grants = locked. Admin screens read through RPCs.)

-- ------------------------------------------------------------------------------------------------ access rule
CREATE OR REPLACE FUNCTION public.brd_is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role))
$$;

-- 'admin' | 'client' | 'company' | 'consultant' | NULL. Mirror: supabase/functions/_shared/brdAccess.ts.
CREATE OR REPLACE FUNCTION public.brd_role_for(_ticket uuid, _uid uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t record;
  cid uuid;
BEGIN
  IF _uid IS NULL OR _ticket IS NULL THEN RETURN NULL; END IF;
  SELECT id, client_id, consultant_id, tenant_id INTO t FROM public.tickets WHERE id = _ticket;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF public.brd_is_admin(_uid) THEN RETURN 'admin'; END IF;
  IF t.client_id = _uid THEN RETURN 'client'; END IF;
  IF t.tenant_id IS NOT NULL AND public.is_tenant_member(_uid, t.tenant_id) THEN RETURN 'company'; END IF;
  -- The ticket-document reader rule for consultants: the ticket's consultant, or a started (ready/active) team
  -- member on a team-gated ticket. Plain match requests, bids and support assignments are not readers.
  SELECT c.id INTO cid
  FROM public.consultants c
  WHERE c.user_id = _uid
    AND (c.id = t.consultant_id
         OR (public.team_ticket_gated(_ticket) AND EXISTS (
               SELECT 1 FROM public.ticket_team_members tm
               WHERE tm.ticket_id = _ticket AND tm.consultant_id = c.id AND tm.status IN ('ready', 'active'))))
  LIMIT 1;
  IF cid IS NULL THEN RETURN NULL; END IF;
  IF COALESCE((public.brd_settings() ->> 'require_nda')::boolean, true) AND NOT EXISTS (
       SELECT 1 FROM public.nda_agreements n
       WHERE n.consultant_id = cid AND n.client_id = t.client_id AND n.revoked_at IS NULL
         AND n.signed_at IS NOT NULL AND n.client_signed_at IS NOT NULL) THEN
    RETURN NULL;
  END IF;
  RETURN 'consultant';
END
$$;

CREATE OR REPLACE FUNCTION public.brd_role(_ticket uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.brd_role_for(_ticket, auth.uid())
$$;

-- Writers: the ticket's client and admins; after the ticket is closed only while an admin has reopened editing;
-- while the feature is off only admins (so the owner can try it before switching it on).
CREATE OR REPLACE FUNCTION public.brd_can_write_for(_ticket uuid, _uid uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r text := public.brd_role_for(_ticket, _uid);
  st text;
  unlocked boolean;
BEGIN
  IF r IS NULL OR r NOT IN ('admin', 'client') THEN RETURN false; END IF;
  IF r <> 'admin' AND NOT COALESCE((public.brd_settings() ->> 'enabled')::boolean, false) THEN RETURN false; END IF;
  SELECT status::text INTO st FROM public.tickets WHERE id = _ticket;
  SELECT edit_unlocked INTO unlocked FROM public.ticket_brds WHERE ticket_id = _ticket;
  RETURN st IS DISTINCT FROM 'closed' OR COALESCE(unlocked, false);
END
$$;

-- Attached (not unattached) versions are what consultants and company members may open.
CREATE OR REPLACE FUNCTION public.brd_version_attached(_ticket uuid, _version integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.ticket_documents d
                 WHERE d.ticket_id = _ticket AND d.doc_type = 'brd' AND d.brd_version = _version AND d.unattached_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION public.brd_doc_visible(_ticket uuid, _unattached_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r text := public.brd_role(_ticket);
BEGIN
  IF r IN ('admin', 'client') THEN RETURN true; END IF;
  IF r IN ('consultant', 'company') THEN RETURN _unattached_at IS NULL; END IF;
  RETURN false;
END
$$;

-- Storage names under the ticket-documents bucket: <ticket uuid>/brd/<file>.pdf
CREATE OR REPLACE FUNCTION public.brd_ticket_of_path(_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF _name IS NULL OR split_part(_name, '/', 2) <> 'brd' THEN RETURN NULL; END IF;
  RETURN split_part(_name, '/', 1)::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_file_readable(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  tid uuid := public.brd_ticket_of_path(_name);
  r text;
BEGIN
  IF tid IS NULL THEN RETURN false; END IF;
  r := public.brd_role(tid);
  IF r IN ('admin', 'client') THEN RETURN true; END IF;
  IF r IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.ticket_documents d
                 WHERE d.ticket_id = tid AND d.doc_type = 'brd' AND d.file_url = _name AND d.unattached_at IS NULL);
END
$$;

CREATE OR REPLACE FUNCTION public.brd_storage_can_insert(_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid := public.brd_ticket_of_path(_name);
BEGIN
  RETURN tid IS NOT NULL
     AND _name ~ '^[0-9a-f-]{36}/brd/[A-Za-z0-9_.-]{1,120}\.pdf$'
     AND public.brd_can_write_for(tid, auth.uid());
END
$$;

-- ------------------------------------------------------------------------------------------------ content checks
-- Contact-bypass mask (M60) over every string of the document.
CREATE OR REPLACE FUNCTION public.brd_mask_jsonb(_j jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  k text;
  v jsonb;
  res jsonb;
BEGIN
  CASE jsonb_typeof(_j)
    WHEN 'string' THEN RETURN to_jsonb(public.mask_contact_details(_j #>> '{}'));
    WHEN 'object' THEN
      res := '{}'::jsonb;
      FOR k, v IN SELECT * FROM jsonb_each(_j) LOOP
        res := res || jsonb_build_object(k, public.brd_mask_jsonb(v));
      END LOOP;
      RETURN res;
    WHEN 'array' THEN
      SELECT COALESCE(jsonb_agg(public.brd_mask_jsonb(e) ORDER BY o), '[]'::jsonb) INTO res
      FROM jsonb_array_elements(_j) WITH ORDINALITY AS a(e, o);
      RETURN res;
    ELSE RETURN _j;
  END CASE;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_validate_content(_c jsonb)
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  IF _c IS NULL OR jsonb_typeof(_c) <> 'object' THEN RAISE EXCEPTION 'brd_invalid_content' USING ERRCODE = '22023'; END IF;
  IF octet_length(_c::text) > 400000 THEN RAISE EXCEPTION 'brd_too_large' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(_c -> 'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(_c -> 'sections') > 20 THEN
    RAISE EXCEPTION 'brd_invalid_sections' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(_c -> 'requirements', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_c -> 'requirements', '[]'::jsonb)) > 150 THEN
    RAISE EXCEPTION 'brd_too_many_requirements' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(_c -> 'questions', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_c -> 'questions', '[]'::jsonb)) > 8 THEN
    RAISE EXCEPTION 'brd_too_many_questions' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_c ->> 'language', 'en') NOT IN ('en', 'ar', 'both') OR COALESCE(_c ->> 'template', 'standard') NOT IN ('standard', 'short', 'technical', 'incident') THEN
    RAISE EXCEPTION 'brd_invalid_options' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(_c #>> '{control,title}', '')) > 200 THEN RAISE EXCEPTION 'brd_title_too_long' USING ERRCODE = '22023'; END IF;
  -- Markup allowlist: no scripts, frames, images, links, styles or event handlers can be stored.
  IF _c::text ~* '<\s*/?\s*(script|iframe|frame|object|embed|style|link|meta|svg|math|img|video|audio|source|form|input|button|a|base)\M'
     OR _c::text ~* '<[^>]*\son[a-z]+\s*=' OR _c::text ~* '<[^>]*(java|vb)script\s*:' OR _c::text ~* '<[^>]*data\s*:\s*text/html' THEN
    RAISE EXCEPTION 'brd_markup_not_allowed' USING ERRCODE = '22023';
  END IF;
END
$$;

-- ------------------------------------------------------------------------------------------------ immutability
CREATE OR REPLACE FUNCTION public.brd_guard_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only the cascade of a deleted ticket may remove versions.
    IF EXISTS (SELECT 1 FROM public.tickets WHERE id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'BRD versions cannot be deleted (archive instead)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id <> OLD.id OR NEW.brd_id <> OLD.brd_id OR NEW.ticket_id <> OLD.ticket_id OR NEW.version <> OLD.version
     OR NEW.status <> OLD.status OR NEW.content <> OLD.content OR NEW.change_note <> OLD.change_note
     OR NEW.restored_from IS DISTINCT FROM OLD.restored_from OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'BRD versions are immutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.archived_at IS NOT NULL AND (NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archived_by IS DISTINCT FROM OLD.archived_by) THEN
    RAISE EXCEPTION 'BRD version already archived' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS brd_guard_version ON public.ticket_brd_versions;
CREATE TRIGGER brd_guard_version BEFORE UPDATE OR DELETE ON public.ticket_brd_versions FOR EACH ROW EXECUTE FUNCTION public.brd_guard_version();

CREATE OR REPLACE FUNCTION public.brd_guard_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.tickets WHERE id = OLD.ticket_id) THEN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END
$$;
DROP TRIGGER IF EXISTS brd_guard_events ON public.ticket_brd_events;
CREATE TRIGGER brd_guard_events BEFORE UPDATE OR DELETE ON public.ticket_brd_events FOR EACH ROW EXECUTE FUNCTION public.brd_guard_append_only();
DROP TRIGGER IF EXISTS brd_guard_access_log ON public.ticket_brd_access_log;
CREATE TRIGGER brd_guard_access_log BEFORE UPDATE OR DELETE ON public.ticket_brd_access_log FOR EACH ROW EXECUTE FUNCTION public.brd_guard_append_only();

-- BRD document rows: only the superseded / unattached marks may change; never deleted while the ticket exists.
CREATE OR REPLACE FUNCTION public.brd_guard_document()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.doc_type = 'brd' AND EXISTS (SELECT 1 FROM public.tickets WHERE id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'An attached BRD cannot be deleted (unattach it instead)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.doc_type = 'brd' OR NEW.doc_type = 'brd' THEN
    IF NEW.doc_type IS DISTINCT FROM OLD.doc_type OR NEW.ticket_id <> OLD.ticket_id OR NEW.file_url <> OLD.file_url
       OR NEW.file_name <> OLD.file_name OR NEW.brd_version IS DISTINCT FROM OLD.brd_version OR NEW.uploaded_by <> OLD.uploaded_by
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'An attached BRD cannot be changed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS brd_guard_document ON public.ticket_documents;
CREATE TRIGGER brd_guard_document BEFORE UPDATE OR DELETE ON public.ticket_documents FOR EACH ROW EXECUTE FUNCTION public.brd_guard_document();

-- ------------------------------------------------------------------------------------------------ policies
-- ticket_documents: restrictive policies (ANDed with the existing permissive ones) for BRD rows.
DROP POLICY IF EXISTS "BRD rows: readers only" ON public.ticket_documents;
CREATE POLICY "BRD rows: readers only" ON public.ticket_documents AS RESTRICTIVE FOR SELECT TO public
  USING (doc_type <> 'brd' OR public.brd_doc_visible(ticket_id, unattached_at));
DROP POLICY IF EXISTS "BRD rows: added by the BRD functions only" ON public.ticket_documents;
CREATE POLICY "BRD rows: added by the BRD functions only" ON public.ticket_documents AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (doc_type <> 'brd');
DROP POLICY IF EXISTS "BRD rows: changed by the BRD functions only" ON public.ticket_documents;
CREATE POLICY "BRD rows: changed by the BRD functions only" ON public.ticket_documents AS RESTRICTIVE FOR UPDATE TO public
  USING (doc_type <> 'brd') WITH CHECK (doc_type <> 'brd');
DROP POLICY IF EXISTS "BRD rows: never deleted" ON public.ticket_documents;
CREATE POLICY "BRD rows: never deleted" ON public.ticket_documents AS RESTRICTIVE FOR DELETE TO public
  USING (doc_type <> 'brd');

-- storage.objects in ticket-documents under <ticket>/brd/: readers only, client/admin upload, never replaced/deleted.
DROP POLICY IF EXISTS "BRD files: readers only" ON storage.objects;
CREATE POLICY "BRD files: readers only" ON storage.objects AS RESTRICTIVE FOR SELECT TO public
  USING (bucket_id <> 'ticket-documents' OR split_part(name, '/', 2) <> 'brd' OR public.brd_file_readable(name));
DROP POLICY IF EXISTS "BRD files: client or admin upload" ON storage.objects;
CREATE POLICY "BRD files: client or admin upload" ON storage.objects AS RESTRICTIVE FOR INSERT TO public
  WITH CHECK (bucket_id <> 'ticket-documents' OR split_part(name, '/', 2) <> 'brd' OR public.brd_storage_can_insert(name));
DROP POLICY IF EXISTS "BRD files: never replaced" ON storage.objects;
CREATE POLICY "BRD files: never replaced" ON storage.objects AS RESTRICTIVE FOR UPDATE TO public
  USING (bucket_id <> 'ticket-documents' OR split_part(name, '/', 2) <> 'brd')
  WITH CHECK (bucket_id <> 'ticket-documents' OR split_part(name, '/', 2) <> 'brd');
DROP POLICY IF EXISTS "BRD files: never deleted" ON storage.objects;
CREATE POLICY "BRD files: never deleted" ON storage.objects AS RESTRICTIVE FOR DELETE TO public
  USING (bucket_id <> 'ticket-documents' OR split_part(name, '/', 2) <> 'brd');
-- Permissive read for BRD readers who are not covered by the older bucket policy (team members, company members).
DROP POLICY IF EXISTS "BRD files: readers can open" ON storage.objects;
CREATE POLICY "BRD files: readers can open" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ticket-documents' AND split_part(name, '/', 2) = 'brd' AND public.brd_file_readable(name));
DROP POLICY IF EXISTS "BRD files: writers can upload" ON storage.objects;
CREATE POLICY "BRD files: writers can upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ticket-documents' AND split_part(name, '/', 2) = 'brd' AND public.brd_storage_can_insert(name));

-- ------------------------------------------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION public.brd_log_event(_ticket uuid, _brd uuid, _actor uuid, _action text, _version integer, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.ticket_brd_events (ticket_id, brd_id, actor_id, action, version, detail)
  VALUES (_ticket, _brd, _actor, _action, _version, COALESCE(_detail, '{}'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.brd_ref(_ticket uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT upper(left(replace(_ticket::text, '-', ''), 8))
$$;

-- Display name of a person for the viewer: consultants through the name-privacy rule, everyone else by profile.
CREATE OR REPLACE FUNCTION public.brd_person_name(_uid uuid, _consultant uuid, _viewer uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n text;
BEGIN
  IF _consultant IS NOT NULL THEN
    BEGIN
      n := public.consultant_name_for(_consultant, _viewer);
    EXCEPTION WHEN others THEN n := NULL;
    END;
    RETURN COALESCE(n, 'Consultant');
  END IF;
  SELECT display_name INTO n FROM public.profiles WHERE user_id = _uid;
  RETURN COALESCE(NULLIF(trim(n), ''), 'User');
END
$$;

CREATE OR REPLACE FUNCTION public.brd_consultant_of(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.consultants WHERE user_id = _uid LIMIT 1
$$;

-- Users who may read attached versions as consultants (for notices).
CREATE OR REPLACE FUNCTION public.brd_consultant_readers(_ticket uuid)
RETURNS TABLE (user_id uuid, consultant_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT c.user_id, c.id
  FROM public.consultants c
  WHERE (c.id = (SELECT consultant_id FROM public.tickets WHERE id = _ticket)
         OR c.id IN (SELECT tm.consultant_id FROM public.ticket_team_members tm WHERE tm.ticket_id = _ticket AND tm.status IN ('ready', 'active')))
    AND public.brd_role_for(_ticket, c.user_id) = 'consultant'
$$;

-- ------------------------------------------------------------------------------------------------ read
CREATE OR REPLACE FUNCTION public.brd_get(_ticket uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r text := public.brd_role_for(_ticket, uid);
  s jsonb := public.brd_settings();
  t record;
  b public.ticket_brds;
  writer boolean;
  full_view boolean;
  res jsonb;
BEGIN
  IF r IS NULL THEN
    RETURN jsonb_build_object('role', NULL, 'enabled', COALESCE((s ->> 'enabled')::boolean, false));
  END IF;
  full_view := r IN ('admin', 'client');
  writer := public.brd_can_write_for(_ticket, uid);
  SELECT tk.id, tk.title, tk.status::text AS status, tk.client_id, tk.sap_module, tk.urgency::text AS urgency, tk.created_at,
         (SELECT cp.company_name FROM public.client_profiles cp WHERE cp.user_id = tk.client_id LIMIT 1) AS company,
         (SELECT p.display_name FROM public.profiles p WHERE p.user_id = tk.client_id LIMIT 1) AS requester
    INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket;

  res := jsonb_build_object(
    'role', r,
    'can_write', writer,
    'enabled', COALESCE((s ->> 'enabled')::boolean, false),
    'settings', CASE WHEN full_view THEN s - 'draft_model' - 'deep_model' ELSE jsonb_build_object('require_nda', s -> 'require_nda') END,
    'ticket', jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'ref', public.brd_ref(t.id), 'sap_module', t.sap_module,
                                 'urgency', t.urgency, 'company', t.company, 'requester', t.requester, 'created_at', t.created_at),
    'brd', NULL, 'versions', '[]'::jsonb, 'attachments', '[]'::jsonb, 'comments', '[]'::jsonb, 'access_log', '[]'::jsonb
  );
  IF b.id IS NULL THEN RETURN res; END IF;

  res := res || jsonb_build_object('brd', jsonb_build_object(
    'id', b.id, 'language', b.language, 'template', b.template, 'latest_version', b.latest_version, 'shared_version', b.shared_version,
    'edit_unlocked', b.edit_unlocked, 'created_at', b.created_at,
    'draft', CASE WHEN full_view THEN b.draft END,
    'draft_rev', CASE WHEN full_view THEN b.draft_rev END,
    'draft_saved_at', CASE WHEN full_view THEN b.draft_saved_at END));

  res := res || jsonb_build_object('versions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'version', v.version, 'status', v.status, 'change_note', v.change_note, 'restored_from', v.restored_from,
      'created_at', v.created_at, 'author', public.brd_person_name(v.created_by, NULL, uid),
      'archived_at', v.archived_at, 'archive_reason', CASE WHEN full_view THEN v.archive_reason END,
      'attached', public.brd_version_attached(_ticket, v.version)) ORDER BY v.version DESC)
    FROM public.ticket_brd_versions v
    WHERE v.brd_id = b.id AND (full_view OR public.brd_version_attached(_ticket, v.version))), '[]'::jsonb));

  res := res || jsonb_build_object('attachments', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', d.id, 'version', d.brd_version, 'file_name', d.file_name, 'file_url', d.file_url, 'file_size', d.file_size,
      'attached_at', d.created_at, 'attached_by', public.brd_person_name(d.uploaded_by, NULL, uid),
      'superseded_at', d.superseded_at, 'unattached_at', d.unattached_at) ORDER BY d.created_at DESC)
    FROM public.ticket_documents d
    WHERE d.ticket_id = _ticket AND d.doc_type = 'brd' AND (full_view OR d.unattached_at IS NULL)), '[]'::jsonb));

  res := res || jsonb_build_object('comments', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id, 'version', c.version, 'section_key', c.section_key, 'parent_id', c.parent_id, 'kind', c.kind, 'body', c.body,
      'suggested_text', c.suggested_text, 'status', c.status, 'created_at', c.created_at, 'author_role', c.author_role,
      'mine', c.author_id = uid, 'author', public.brd_person_name(c.author_id, c.author_consultant_id, uid)) ORDER BY c.created_at)
    FROM public.ticket_brd_comments c
    WHERE c.brd_id = b.id AND (full_view OR c.author_id = uid OR public.brd_version_attached(_ticket, c.version))), '[]'::jsonb));

  res := res || jsonb_build_object('last_client_update', (
    SELECT max(v.created_at) FROM public.ticket_brd_versions v WHERE v.brd_id = b.id AND public.brd_version_attached(_ticket, v.version)));

  IF full_view THEN
    res := res || jsonb_build_object('access_log', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x ->> 'at') DESC) FROM (
        SELECT jsonb_build_object('viewer', public.brd_person_name(a.viewer_id, a.viewer_consultant_id, uid), 'role', a.viewer_role,
                                  'version', a.version, 'action', a.action, 'at', a.created_at) AS x
        FROM public.ticket_brd_access_log a WHERE a.brd_id = b.id ORDER BY a.created_at DESC LIMIT 300) q), '[]'::jsonb),
      'usage', jsonb_build_object(
        'ticket_today', (SELECT count(*) FROM public.ticket_brd_ai_usage u WHERE u.ticket_id = _ticket AND u.status <> 'refused' AND u.created_at > now() - interval '1 day'),
        'deep_today', (SELECT count(*) FROM public.ticket_brd_ai_usage u WHERE u.ticket_id = _ticket AND u.status <> 'refused' AND u.kind LIKE 'deep%' AND u.created_at > now() - interval '1 day')));
  END IF;
  RETURN res;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_get_version(_ticket uuid, _version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r text := public.brd_role_for(_ticket, uid);
  v public.ticket_brd_versions;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.ticket_brd_versions WHERE ticket_id = _ticket AND version = _version;
  IF NOT FOUND THEN RAISE EXCEPTION 'brd_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF r NOT IN ('admin', 'client') AND NOT public.brd_version_attached(_ticket, _version) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF r IN ('consultant', 'company') AND NOT EXISTS (
       SELECT 1 FROM public.ticket_brd_access_log a WHERE a.brd_id = v.brd_id AND a.viewer_id = uid AND a.version = _version
         AND a.action = 'view' AND a.created_at > now() - interval '10 minutes') THEN
    INSERT INTO public.ticket_brd_access_log (brd_id, ticket_id, version, viewer_id, viewer_role, viewer_consultant_id, action)
    VALUES (v.brd_id, _ticket, _version, uid, r, public.brd_consultant_of(uid), 'view');
  END IF;
  RETURN jsonb_build_object('version', v.version, 'status', v.status, 'change_note', v.change_note, 'created_at', v.created_at,
                            'archived_at', v.archived_at, 'content', v.content);
END
$$;

-- Downloads (and views of the PDF) are logged before the short-lived link is made.
CREATE OR REPLACE FUNCTION public.brd_log_access(_ticket uuid, _version integer, _action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r text := public.brd_role_for(_ticket, uid);
  bid uuid;
BEGIN
  IF r IS NULL OR _action NOT IN ('view', 'download') THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF r NOT IN ('admin', 'client') AND NOT public.brd_version_attached(_ticket, _version) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT id INTO bid FROM public.ticket_brds WHERE ticket_id = _ticket;
  IF bid IS NULL THEN RETURN false; END IF;
  IF r = 'client' THEN RETURN true; END IF; -- the owner's own opens are not interesting to the owner
  IF EXISTS (SELECT 1 FROM public.ticket_brd_access_log a WHERE a.brd_id = bid AND a.viewer_id = uid AND a.version = _version
               AND a.action = _action AND a.created_at > now() - interval '2 minutes') THEN
    RETURN true;
  END IF;
  INSERT INTO public.ticket_brd_access_log (brd_id, ticket_id, version, viewer_id, viewer_role, viewer_consultant_id, action)
  VALUES (bid, _ticket, _version, uid, r, public.brd_consultant_of(uid), _action);
  RETURN true;
END
$$;

-- ------------------------------------------------------------------------------------------------ write
CREATE OR REPLACE FUNCTION public.brd_store_draft(_ticket uuid, _uid uuid, _content jsonb, _rev integer)
RETURNS public.ticket_brds LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.ticket_brds;
  masked jsonb;
  cl uuid;
BEGIN
  PERFORM public.brd_validate_content(_content);
  masked := public.brd_mask_jsonb(_content);
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket FOR UPDATE;
  IF NOT FOUND THEN
    SELECT client_id INTO cl FROM public.tickets WHERE id = _ticket;
    INSERT INTO public.ticket_brds (ticket_id, client_id, language, template, draft, draft_rev, draft_saved_at, draft_saved_by, created_by)
    VALUES (_ticket, cl, COALESCE(masked ->> 'language', 'en'), COALESCE(masked ->> 'template', 'standard'), masked, 1, now(), _uid, _uid)
    ON CONFLICT (ticket_id) DO NOTHING
    RETURNING * INTO b;
    IF b.id IS NULL THEN RAISE EXCEPTION 'brd_draft_conflict' USING ERRCODE = '40001'; END IF;
    PERFORM public.brd_log_event(_ticket, b.id, _uid, 'create', NULL, jsonb_build_object('language', b.language, 'template', b.template));
    RETURN b;
  END IF;
  IF _rev IS NOT NULL AND _rev <> b.draft_rev THEN
    RAISE EXCEPTION 'brd_draft_conflict' USING ERRCODE = '40001', HINT = 'The document was saved in another tab or by another person. Reload to continue.';
  END IF;
  UPDATE public.ticket_brds
     SET draft = masked, language = COALESCE(masked ->> 'language', language), template = COALESCE(masked ->> 'template', template),
         draft_rev = draft_rev + 1, draft_saved_at = now(), draft_saved_by = _uid, updated_at = now()
   WHERE id = b.id RETURNING * INTO b;
  RETURN b;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_save_draft(_ticket uuid, _content jsonb, _rev integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  b public.ticket_brds;
BEGIN
  IF NOT public.brd_can_write_for(_ticket, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  b := public.brd_store_draft(_ticket, uid, _content, _rev);
  RETURN jsonb_build_object('rev', b.draft_rev, 'saved_at', b.draft_saved_at, 'masked', b.draft <> _content,
                            'content', CASE WHEN b.draft <> _content THEN b.draft END);
END
$$;

CREATE OR REPLACE FUNCTION public.brd_save_version(_ticket uuid, _content jsonb, _note text, _status text DEFAULT 'draft', _rev integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  b public.ticket_brds;
  n integer;
  c jsonb;
BEGIN
  IF NOT public.brd_can_write_for(_ticket, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _status NOT IN ('draft', 'final') THEN RAISE EXCEPTION 'brd_invalid_status' USING ERRCODE = '22023'; END IF;
  IF char_length(COALESCE(_note, '')) > 500 THEN RAISE EXCEPTION 'brd_note_too_long' USING ERRCODE = '22023'; END IF;
  c := jsonb_set(_content, '{control,status}', to_jsonb(_status), true);
  b := public.brd_store_draft(_ticket, uid, c, _rev);
  IF (SELECT count(*) FROM public.ticket_brd_versions WHERE brd_id = b.id) >= 500 THEN
    RAISE EXCEPTION 'brd_too_many_versions' USING ERRCODE = '22023';
  END IF;
  n := b.latest_version + 1;
  INSERT INTO public.ticket_brd_versions (brd_id, ticket_id, version, status, content, change_note, created_by)
  VALUES (b.id, _ticket, n, _status, b.draft, public.mask_contact_details(trim(COALESCE(_note, ''))), uid);
  UPDATE public.ticket_brds SET latest_version = n, updated_at = now() WHERE id = b.id;
  PERFORM public.brd_log_event(_ticket, b.id, uid, CASE WHEN _status = 'final' THEN 'final' ELSE 'version' END, n, '{}'::jsonb);
  RETURN jsonb_build_object('version', n, 'rev', b.draft_rev, 'status', _status, 'content', b.draft);
END
$$;

CREATE OR REPLACE FUNCTION public.brd_restore_version(_ticket uuid, _version integer, _note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  b public.ticket_brds;
  v public.ticket_brd_versions;
  n integer;
  c jsonb;
BEGIN
  IF NOT public.brd_can_write_for(_ticket, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket FOR UPDATE;
  SELECT * INTO v FROM public.ticket_brd_versions WHERE brd_id = b.id AND version = _version;
  IF v.id IS NULL THEN RAISE EXCEPTION 'brd_version_not_found' USING ERRCODE = 'P0002'; END IF;
  n := b.latest_version + 1;
  c := jsonb_set(v.content, '{control,status}', '"draft"', true);
  INSERT INTO public.ticket_brd_versions (brd_id, ticket_id, version, status, content, change_note, restored_from, created_by)
  VALUES (b.id, _ticket, n, 'draft', c, public.mask_contact_details(left(trim(COALESCE(_note, '')), 500)), _version, uid);
  UPDATE public.ticket_brds SET latest_version = n, draft = c, draft_rev = draft_rev + 1, draft_saved_at = now(), draft_saved_by = uid, updated_at = now()
   WHERE id = b.id RETURNING * INTO b;
  PERFORM public.brd_log_event(_ticket, b.id, uid, 'restore', n, jsonb_build_object('from', _version));
  RETURN jsonb_build_object('version', n, 'rev', b.draft_rev, 'content', c);
END
$$;

-- Soft archive (admins only, audited). Versions are never deleted.
CREATE OR REPLACE FUNCTION public.brd_archive_version(_ticket uuid, _version integer, _reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); bid uuid;
BEGIN
  IF NOT public.brd_is_admin(uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF char_length(trim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'brd_reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.ticket_brd_versions SET archived_at = now(), archived_by = uid, archive_reason = left(trim(_reason), 300)
   WHERE ticket_id = _ticket AND version = _version AND archived_at IS NULL RETURNING brd_id INTO bid;
  IF bid IS NULL THEN RETURN false; END IF;
  PERFORM public.brd_log_event(_ticket, bid, uid, 'archive', _version, jsonb_build_object('reason', left(trim(_reason), 300)));
  RETURN true;
END
$$;

-- ------------------------------------------------------------------------------------------------ attach
CREATE OR REPLACE FUNCTION public.brd_attach(_ticket uuid, _version integer, _path text, _size bigint, _notify boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  b public.ticket_brds;
  v public.ticket_brd_versions;
  doc_id uuid;
  fname text;
  title text;
  rec record;
  notified integer := 0;
BEGIN
  IF NOT public.brd_can_write_for(_ticket, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket FOR UPDATE;
  SELECT * INTO v FROM public.ticket_brd_versions WHERE brd_id = b.id AND version = _version;
  IF v.id IS NULL OR v.archived_at IS NOT NULL THEN RAISE EXCEPTION 'brd_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _path IS NULL OR _path !~ ('^' || _ticket::text || '/brd/[A-Za-z0-9_.-]{1,120}\.pdf$') THEN
    RAISE EXCEPTION 'brd_invalid_path' USING ERRCODE = '22023';
  END IF;
  IF _size IS NULL OR _size < 100 OR _size > 20 * 1024 * 1024 THEN RAISE EXCEPTION 'brd_invalid_size' USING ERRCODE = '22023'; END IF;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'ticket-documents' AND o.name = _path) THEN
      RAISE EXCEPTION 'brd_file_missing' USING ERRCODE = 'P0002';
    END IF;
  END IF;
  fname := 'BRD_' || public.brd_ref(_ticket) || '_v' || _version || '_' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '.pdf';
  UPDATE public.ticket_documents SET superseded_at = now()
   WHERE ticket_id = _ticket AND doc_type = 'brd' AND superseded_at IS NULL AND unattached_at IS NULL;
  INSERT INTO public.ticket_documents (ticket_id, uploaded_by, file_name, file_url, file_size, mime_type, version, comment, doc_type, brd_version)
  VALUES (_ticket, uid, fname, _path, _size, 'application/pdf', _version, 'Business Requirements Document v' || _version, 'brd', _version)
  RETURNING id INTO doc_id;
  UPDATE public.ticket_brds SET shared_version = _version, updated_at = now() WHERE id = b.id;
  PERFORM public.brd_log_event(_ticket, b.id, uid, 'attach', _version, jsonb_build_object('document_id', doc_id, 'notify', COALESCE(_notify, false)));

  IF COALESCE(_notify, false) THEN
    SELECT tk.title INTO title FROM public.tickets tk WHERE tk.id = _ticket;
    FOR rec IN SELECT * FROM public.brd_consultant_readers(_ticket) LOOP
      PERFORM public.safe_insert_notification(rec.user_id,
        'BRD v' || _version || ' attached',
        'BRD v' || _version || ' was attached to "' || left(COALESCE(title, 'your ticket'), 120) || '".',
        'brd', '/consultant/cases/' || _ticket || '/brd');
      INSERT INTO public.ticket_brd_notices (document_id, ticket_id, user_id, version, created_by)
      VALUES (doc_id, _ticket, rec.user_id, _version, uid) ON CONFLICT DO NOTHING;
      notified := notified + 1;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('document_id', doc_id, 'file_name', fname, 'notified', notified);
END
$$;

CREATE OR REPLACE FUNCTION public.brd_unattach(_document_id uuid, _reason text DEFAULT '')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  d public.ticket_documents;
  prev uuid;
  prev_version integer;
BEGIN
  SELECT * INTO d FROM public.ticket_documents WHERE id = _document_id AND doc_type = 'brd' FOR UPDATE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'brd_document_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.brd_can_write_for(d.ticket_id, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF d.unattached_at IS NOT NULL THEN RETURN false; END IF;
  UPDATE public.ticket_documents SET unattached_at = now(), unattached_by = uid WHERE id = d.id;
  IF d.superseded_at IS NULL THEN
    -- The current one was removed: the newest remaining attachment becomes current again.
    SELECT id, brd_version INTO prev, prev_version FROM public.ticket_documents
     WHERE ticket_id = d.ticket_id AND doc_type = 'brd' AND unattached_at IS NULL AND id <> d.id
     ORDER BY created_at DESC LIMIT 1;
    IF prev IS NOT NULL THEN UPDATE public.ticket_documents SET superseded_at = NULL WHERE id = prev; END IF;
    UPDATE public.ticket_brds SET shared_version = prev_version, updated_at = now() WHERE ticket_id = d.ticket_id;
  END IF;
  PERFORM public.brd_log_event(d.ticket_id, (SELECT id FROM public.ticket_brds WHERE ticket_id = d.ticket_id), uid, 'unattach', d.brd_version,
                               jsonb_build_object('document_id', d.id, 'reason', left(trim(COALESCE(_reason, '')), 300)));
  RETURN true;
END
$$;

-- E-mail part of the "notify the consultant" tick: the ticket-brd function claims each notice once.
CREATE OR REPLACE FUNCTION public.brd_claim_notices(_document_id uuid, _caller uuid)
RETURNS TABLE (user_id uuid, version integer, ticket_id uuid, ticket_title text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.ticket_documents;
BEGIN
  SELECT * INTO d FROM public.ticket_documents WHERE id = _document_id AND doc_type = 'brd';
  IF d.id IS NULL OR NOT (d.uploaded_by = _caller OR public.brd_is_admin(_caller)) THEN RETURN; END IF;
  RETURN QUERY
    UPDATE public.ticket_brd_notices n SET emailed_at = now()
     WHERE n.document_id = _document_id AND n.emailed_at IS NULL AND n.created_at > now() - interval '1 hour'
       AND public.brd_role_for(n.ticket_id, n.user_id) = 'consultant'
    RETURNING n.user_id, n.version, n.ticket_id, (SELECT tk.title FROM public.tickets tk WHERE tk.id = n.ticket_id);
END
$$;

-- ------------------------------------------------------------------------------------------------ comments
CREATE OR REPLACE FUNCTION public.brd_add_comment(_ticket uuid, _version integer, _section text, _body text,
  _parent uuid DEFAULT NULL, _kind text DEFAULT 'comment', _suggested text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r text := public.brd_role_for(_ticket, uid);
  b public.ticket_brds;
  cid uuid;
  par public.ticket_brd_comments;
  new_id uuid;
  cap integer := COALESCE((public.brd_settings() ->> 'comments_per_user_per_day')::integer, 60);
  ttl text;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket;
  IF b.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.ticket_brd_versions WHERE brd_id = b.id AND version = _version) THEN
    RAISE EXCEPTION 'brd_version_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r NOT IN ('admin', 'client') AND NOT public.brd_version_attached(_ticket, _version) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _section IS NULL OR _section NOT IN ('general', 'control', 'purpose', 'objectives', 'scope', 'current_future', 'stakeholders', 'functional',
       'non_functional', 'sap_landscape', 'data_migration', 'assumptions', 'risks', 'testing', 'timeline', 'open_questions', 'attachments', 'change_log') THEN
    RAISE EXCEPTION 'brd_invalid_section' USING ERRCODE = '22023';
  END IF;
  IF _kind NOT IN ('comment', 'suggestion') OR (_kind = 'suggestion' AND r NOT IN ('consultant', 'admin', 'company')) THEN
    RAISE EXCEPTION 'brd_invalid_kind' USING ERRCODE = '22023';
  END IF;
  IF char_length(trim(COALESCE(_body, ''))) = 0 OR char_length(_body) > 4000 OR char_length(COALESCE(_suggested, '')) > 20000
     OR (_kind = 'suggestion' AND char_length(trim(COALESCE(_suggested, ''))) = 0) THEN
    RAISE EXCEPTION 'brd_invalid_comment' USING ERRCODE = '22023';
  END IF;
  IF public.contact_details_in_text(_body) OR public.contact_details_in_text(_suggested) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.ticket_brd_comments WHERE author_id = uid AND created_at > now() - interval '1 day') >= cap THEN
    RAISE EXCEPTION 'brd_comment_limit' USING ERRCODE = '54000';
  END IF;
  IF _parent IS NOT NULL THEN
    SELECT * INTO par FROM public.ticket_brd_comments WHERE id = _parent AND brd_id = b.id;
    IF par.id IS NULL THEN RAISE EXCEPTION 'brd_invalid_parent' USING ERRCODE = '22023'; END IF;
  END IF;
  cid := CASE WHEN r = 'consultant' THEN public.brd_consultant_of(uid) END;
  INSERT INTO public.ticket_brd_comments (brd_id, ticket_id, version, section_key, parent_id, author_id, author_role, author_consultant_id, kind, body, suggested_text)
  VALUES (b.id, _ticket, _version, _section, _parent, uid, r, cid, _kind, trim(_body), NULLIF(trim(COALESCE(_suggested, '')), ''))
  RETURNING id INTO new_id;
  PERFORM public.brd_log_event(_ticket, b.id, uid, CASE WHEN _kind = 'suggestion' THEN 'suggestion' ELSE 'comment' END, _version, jsonb_build_object('comment_id', new_id, 'section', _section));

  SELECT title INTO ttl FROM public.tickets WHERE id = _ticket;
  IF r IN ('consultant', 'company') THEN
    PERFORM public.safe_insert_notification(b.client_id,
      CASE WHEN _kind = 'suggestion' THEN 'Suggested change on your BRD' ELSE 'New comment on your BRD' END,
      'On "' || left(COALESCE(ttl, 'your ticket'), 120) || '", BRD v' || _version || '.', 'brd', '/client/tickets/' || _ticket || '/brd');
  ELSIF par.id IS NOT NULL AND par.author_role = 'consultant' AND par.author_id <> uid THEN
    PERFORM public.safe_insert_notification(par.author_id, 'Reply on the BRD',
      'The client replied on "' || left(COALESCE(ttl, 'the ticket'), 120) || '", BRD v' || _version || '.', 'brd', '/consultant/cases/' || _ticket || '/brd');
  END IF;
  RETURN new_id;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_set_comment_status(_comment uuid, _status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); c public.ticket_brd_comments;
BEGIN
  SELECT * INTO c FROM public.ticket_brd_comments WHERE id = _comment;
  IF c.id IS NULL THEN RAISE EXCEPTION 'brd_comment_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _status NOT IN ('open', 'resolved', 'accepted', 'declined') THEN RAISE EXCEPTION 'brd_invalid_status' USING ERRCODE = '22023'; END IF;
  IF NOT public.brd_can_write_for(c.ticket_id, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.ticket_brd_comments SET status = _status, status_by = uid, status_at = now() WHERE id = c.id;
  PERFORM public.brd_log_event(c.ticket_id, c.brd_id, uid, 'comment_' || _status, c.version, jsonb_build_object('comment_id', c.id));
  RETURN true;
END
$$;

-- ------------------------------------------------------------------------------------------------ AI limits (service role)
CREATE OR REPLACE FUNCTION public.brd_ai_claim(_ticket uuid, _actor uuid, _kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := public.brd_settings();
  cl uuid;
  n_ticket integer;
  n_client integer;
  n_deep integer;
  reason text;
  new_id uuid;
  deep boolean := _kind LIKE 'deep%';
BEGIN
  IF _kind NOT IN ('draft', 'section', 'improve', 'shorter', 'deep_draft', 'deep_section') THEN RAISE EXCEPTION 'brd_invalid_kind' USING ERRCODE = '22023'; END IF;
  IF NOT public.brd_can_write_for(_ticket, _actor) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('brd_ai:' || _ticket::text));
  SELECT client_id INTO cl FROM public.tickets WHERE id = _ticket;
  SELECT count(*) INTO n_ticket FROM public.ticket_brd_ai_usage WHERE ticket_id = _ticket AND status <> 'refused' AND created_at > now() - interval '1 day';
  SELECT count(*) INTO n_client FROM public.ticket_brd_ai_usage WHERE client_id = cl AND status <> 'refused' AND created_at > now() - interval '1 day';
  SELECT count(*) INTO n_deep FROM public.ticket_brd_ai_usage WHERE ticket_id = _ticket AND status <> 'refused' AND kind LIKE 'deep%' AND created_at > now() - interval '1 day';
  IF n_ticket >= COALESCE((s ->> 'ai_calls_per_ticket_per_day')::integer, 12) THEN reason := 'ticket_limit';
  ELSIF n_client >= COALESCE((s ->> 'ai_calls_per_client_per_day')::integer, 40) THEN reason := 'client_limit';
  ELSIF deep AND n_deep >= COALESCE((s ->> 'deep_calls_per_ticket_per_day')::integer, 3) THEN reason := 'deep_limit';
  END IF;
  INSERT INTO public.ticket_brd_ai_usage (ticket_id, client_id, actor_id, kind, model, status, reason)
  VALUES (_ticket, cl, _actor, _kind, CASE WHEN deep THEN s ->> 'deep_model' ELSE s ->> 'draft_model' END,
          CASE WHEN reason IS NULL THEN 'running' ELSE 'refused' END, reason)
  RETURNING id INTO new_id;
  IF reason IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', reason); END IF;
  RETURN jsonb_build_object('ok', true, 'id', new_id, 'model', CASE WHEN deep THEN s ->> 'deep_model' ELSE s ->> 'draft_model' END,
                            'max_attachments', COALESCE((s ->> 'max_attachments')::integer, 3),
                            'max_attachment_chars', COALESCE((s ->> 'max_attachment_chars')::integer, 6000));
END
$$;

CREATE OR REPLACE FUNCTION public.brd_ai_finish(_id uuid, _status text, _input integer, _output integer, _reason text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ticket_brd_ai_usage
     SET status = CASE WHEN _status IN ('ok', 'failed') THEN _status ELSE 'failed' END,
         input_tokens = GREATEST(0, COALESCE(_input, 0)), output_tokens = GREATEST(0, COALESCE(_output, 0)),
         reason = left(_reason, 120), finished_at = now()
   WHERE id = _id AND status = 'running'
$$;

-- ------------------------------------------------------------------------------------------------ admin
CREATE OR REPLACE FUNCTION public.admin_brd_set_settings(_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  before jsonb := public.brd_settings();
  merged jsonb := public.brd_settings();
  k text;
  v jsonb;
BEGIN
  IF NOT public.brd_is_admin(uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _value IS NULL OR jsonb_typeof(_value) <> 'object' THEN RAISE EXCEPTION 'brd_invalid_settings' USING ERRCODE = '22023'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(_value) LOOP
    IF k IN ('enabled', 'require_nda') THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'brd_invalid_setting %', k USING ERRCODE = '22023'; END IF;
    ELSIF k IN ('ai_calls_per_ticket_per_day', 'ai_calls_per_client_per_day', 'deep_calls_per_ticket_per_day', 'max_attachments', 'max_attachment_chars', 'comments_per_user_per_day') THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
         OR (v #>> '{}')::integer < 0
         OR (k = 'max_attachment_chars' AND (v #>> '{}')::integer > 20000)
         OR (k = 'max_attachments' AND (v #>> '{}')::integer > 10)
         OR (k LIKE '%per_day' AND (v #>> '{}')::integer > 1000) THEN
        RAISE EXCEPTION 'brd_invalid_setting %', k USING ERRCODE = '22023';
      END IF;
    ELSIF k IN ('draft_model', 'deep_model') THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') !~ '^(openai|google)/[a-z0-9][a-z0-9.-]{1,60}$' THEN
        RAISE EXCEPTION 'brd_invalid_setting %', k USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'brd_unknown_setting %', k USING ERRCODE = '22023';
    END IF;
    merged := merged || jsonb_build_object(k, v);
  END LOOP;
  INSERT INTO public.platform_settings (key, value) VALUES ('ticket_brd', merged)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (uid, 'brd_settings_changed', 'platform_settings', NULL, jsonb_build_object('before', before, 'after', merged));
  RETURN merged;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_brd_unlock(_ticket uuid, _unlocked boolean, _reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); bid uuid;
BEGIN
  IF NOT public.brd_is_admin(uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF char_length(trim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'brd_reason_required' USING ERRCODE = '22023'; END IF;
  UPDATE public.ticket_brds SET edit_unlocked = COALESCE(_unlocked, false), updated_at = now() WHERE ticket_id = _ticket RETURNING id INTO bid;
  IF bid IS NULL THEN RETURN false; END IF;
  PERFORM public.brd_log_event(_ticket, bid, uid, CASE WHEN _unlocked THEN 'reopen' ELSE 'relock' END, NULL, jsonb_build_object('reason', left(trim(_reason), 300)));
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_brd_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.brd_is_admin(auth.uid()) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'settings', public.brd_settings(),
    'documents', (SELECT count(*) FROM public.ticket_brds),
    'versions', (SELECT count(*) FROM public.ticket_brd_versions),
    'attached', (SELECT count(*) FROM public.ticket_documents WHERE doc_type = 'brd' AND unattached_at IS NULL),
    'ai_today', (SELECT count(*) FROM public.ticket_brd_ai_usage WHERE status <> 'refused' AND created_at > now() - interval '1 day'),
    'ai_refused_today', (SELECT count(*) FROM public.ticket_brd_ai_usage WHERE status = 'refused' AND created_at > now() - interval '1 day'),
    'tokens_30d', jsonb_build_object(
      'input', (SELECT COALESCE(sum(input_tokens), 0) FROM public.ticket_brd_ai_usage WHERE created_at > now() - interval '30 days'),
      'output', (SELECT COALESCE(sum(output_tokens), 0) FROM public.ticket_brd_ai_usage WHERE created_at > now() - interval '30 days')),
    'by_model_30d', COALESCE((SELECT jsonb_object_agg(model, n) FROM (
        SELECT model, count(*) AS n FROM public.ticket_brd_ai_usage WHERE status = 'ok' AND created_at > now() - interval '30 days' GROUP BY model) m), '{}'::jsonb)
  );
END
$$;

-- ------------------------------------------------------------------------------------------------ function grants
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'brd_default_settings()', 'brd_settings()', 'brd_is_admin(uuid)', 'brd_role_for(uuid, uuid)', 'brd_role(uuid)', 'brd_can_write_for(uuid, uuid)',
    'brd_version_attached(uuid, integer)', 'brd_doc_visible(uuid, timestamptz)', 'brd_ticket_of_path(text)', 'brd_file_readable(text)',
    'brd_storage_can_insert(text)', 'brd_mask_jsonb(jsonb)', 'brd_validate_content(jsonb)', 'brd_log_event(uuid, uuid, uuid, text, integer, jsonb)',
    'brd_ref(uuid)', 'brd_person_name(uuid, uuid, uuid)', 'brd_consultant_of(uuid)', 'brd_consultant_readers(uuid)', 'brd_store_draft(uuid, uuid, jsonb, integer)',
    'brd_get(uuid)', 'brd_get_version(uuid, integer)', 'brd_log_access(uuid, integer, text)', 'brd_save_draft(uuid, jsonb, integer)',
    'brd_save_version(uuid, jsonb, text, text, integer)', 'brd_restore_version(uuid, integer, text)', 'brd_archive_version(uuid, integer, text)',
    'brd_attach(uuid, integer, text, bigint, boolean)', 'brd_unattach(uuid, text)', 'brd_claim_notices(uuid, uuid)',
    'brd_add_comment(uuid, integer, text, text, uuid, text, text)', 'brd_set_comment_status(uuid, text)', 'brd_ai_claim(uuid, uuid, text)',
    'brd_ai_finish(uuid, text, integer, integer, text)', 'admin_brd_set_settings(jsonb)', 'admin_brd_unlock(uuid, boolean, text)', 'admin_brd_overview()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- Signed-in browser entry points (each checks the caller itself). Policy helpers must be callable by the
  -- roles whose queries evaluate them.
  FOREACH f IN ARRAY ARRAY[
    'brd_settings()', 'brd_role(uuid)', 'brd_doc_visible(uuid, timestamptz)', 'brd_file_readable(text)', 'brd_storage_can_insert(text)',
    'brd_get(uuid)', 'brd_get_version(uuid, integer)', 'brd_log_access(uuid, integer, text)', 'brd_save_draft(uuid, jsonb, integer)',
    'brd_save_version(uuid, jsonb, text, text, integer)', 'brd_restore_version(uuid, integer, text)', 'brd_archive_version(uuid, integer, text)',
    'brd_attach(uuid, integer, text, bigint, boolean)', 'brd_unattach(uuid, text)', 'brd_add_comment(uuid, integer, text, text, uuid, text, text)',
    'brd_set_comment_status(uuid, text)', 'admin_brd_set_settings(jsonb)', 'admin_brd_unlock(uuid, boolean, text)', 'admin_brd_overview()'
  ] LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- brd_ticket_of_path is IMMUTABLE and harmless; anon evaluates the restrictive storage policy too.
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.brd_ticket_of_path(text) TO anon, authenticated';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.brd_file_readable(text) TO anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.brd_storage_can_insert(text) TO anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.brd_doc_visible(uuid, timestamptz) TO anon';
END $$;
