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