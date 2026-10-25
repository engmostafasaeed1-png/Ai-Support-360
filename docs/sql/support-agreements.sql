-- =====================================================================================================================
-- SUPPORT AGREEMENTS (long-term commitments: one client organisation + a lead consultant, optional small team,
-- agreed hourly rate, commitment model, SLA policy attached). Prepared for owner review. NOT APPLIED. Idempotent.
-- Rolled-back checks: docs/sql/support-agreements.test.sql. Browser/worker mirror: supabase/functions/_shared/supportAgreements.ts.
-- Notes: docs/support-agreements.md. Works with docs/sql/sla-policies.sql (either order): the SLA file calls the hook
-- sa_ticket_sla(ticket) defined here; without the SLA file the agreement simply stores the chosen policy reference.
--
-- What it does
--   * Settings row platform_settings 'support_agreements' (enabled = false; admin review of first agreements ON).
--   * One row per agreement in sa_agreements: Draft -> Open for applications -> Negotiating -> Agreed (waiting for
--     admin review if on, NDA both and the start date) -> Active -> Renewal due -> Active (renewed) / Expired /
--     Terminated -> Archived; Suspended <-> Active. Only sa_set_status changes the status (sa_transition_allowed).
--   * Applications (rate within admin bounds, SLA acceptance), offers/counter-offers (each must be accepted by the
--     other side), immutable terms versions + electronic acceptances bound to version + content hash, immutable agreed
--     rate records (never retroactive), rate change proposals, team members, replacement (client + admin + new
--     consultant), Q&A messages (contact-details filter M60), timeline events, audit.
--   * A ticket created with ticket_context.support_agreement_id (switch "Use my support agreement") is linked to a live
--     agreement whose scope covers the module: an approved ticket rate (source 'agreement', S1 multiplier when agreed)
--     and a direct assignment request to the lead consultant are created (no bidding round); the SLA comes from the
--     agreement. Existing assignment, team, NDA, timesheet, invoice and payout flows are unchanged.
--   * Hours bank: month-end settlement of committed hours that expire unused (+ optional overage rate difference) as
--     an ordinary platform invoice (payments row, pricing v2: portal fee + payment fee + VAT). Payouts follow the
--     existing payout rules (15 business days).
--   * Daily sweep (cron 'support-agreements-daily'): activation, renewal reminders 60/30/7 days, auto-renew (both
--     parties consented), expiry, notice-period terminations, archive, effective rate changes, monthly settlements,
--     no-activity (bypass) alert to administrators.
--   * Tables have RLS on and no browser grants; everything goes through SECURITY DEFINER functions with fixed
--     search_path and role checks. Rates are returned only to the parties and administrators.
-- =====================================================================================================================

-- ------------------------------------------------------------------------------------------------ settings
CREATE OR REPLACE FUNCTION public.sa_default_settings()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', false, 'needs_admin_review', true, 'draft_legal_flag', true,
    'models_enabled', jsonb_build_array('payg', 'hours_bank', 'availability'),
    'rate_min', 10, 'rate_max', 1000, 'rate_caps', '{}'::jsonb,
    'service_fee_percent', NULL, 'max_multiplier', 2,
    'renewal_reminder_days', jsonb_build_array(60, 30, 7), 'inactivity_weeks', 6,
    'min_term_months', 1, 'max_notice_days', 90, 'handover_days', 14,
    'allow_prepayment', false, 'allow_forfeit', false, 'application_limit_per_day', 10,
    'crew_max', 6, 'contacts_max', 5, 'doc_max_mb', 20, 'docs_per_agreement', 50)
$$;

CREATE OR REPLACE FUNCTION public.sa_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.sa_default_settings() || COALESCE((SELECT ps.value FROM public.platform_settings ps WHERE ps.key = 'support_agreements' LIMIT 1), '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION public.sa_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((public.sa_settings() ->> 'enabled')::boolean, false)
$$;

INSERT INTO public.platform_settings (key, value) VALUES ('support_agreements', jsonb_build_object('enabled', false))
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.platform_settings (key, value) VALUES ('support_agreements_visible', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
DROP POLICY IF EXISTS "Signed-in users can read support_agreements_visible" ON public.platform_settings;
CREATE POLICY "Signed-in users can read support_agreements_visible" ON public.platform_settings
  FOR SELECT TO authenticated USING (key = 'support_agreements_visible');

-- Portal (service) fee for agreement invoices: the admin value, else the platform fee of every other invoice.
CREATE OR REPLACE FUNCTION public.sa_service_fee_percent()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(public.sa_settings() ->> 'service_fee_percent', '')::numeric, public.payment_service_fee_percent())
$$;

-- ------------------------------------------------------------------------------------------------ tables
CREATE TABLE IF NOT EXISTS public.sa_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  client_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  reference text UNIQUE,                                  -- "SA-2026-000012", set once by sa_guard_agreement
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'negotiating', 'agreed', 'active', 'suspended', 'renewal_due', 'expired', 'terminated', 'archived')),
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 0,
  invite_only boolean NOT NULL DEFAULT false,
  deadline timestamptz,
  consultant_id uuid,
  application_id uuid,
  admin_review text NOT NULL DEFAULT 'not_needed' CHECK (admin_review IN ('not_needed', 'pending', 'approved', 'rejected')),
  admin_note text,
  agreed_at timestamptz,
  started_at timestamptz,
  start_date date,
  end_date date,
  auto_renew_client_at timestamptz,
  auto_renew_consultant_at timestamptz,
  termination_requested_by text,
  termination_reason text,
  termination_requested_at timestamptz,
  termination_end date,
  handover_until date,
  handover_note text,
  suspended_until date,
  current_rate_id uuid,
  last_activity_at timestamptz,
  inactivity_alerted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_agreements_owner ON public.sa_agreements (tenant_id, client_id, status);
CREATE INDEX IF NOT EXISTS sa_agreements_lead ON public.sa_agreements (consultant_id, status);

CREATE TABLE IF NOT EXISTS public.sa_invites (
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agreement_id, consultant_id)
);

CREATE TABLE IF NOT EXISTS public.sa_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  hourly_rate numeric NOT NULL CHECK (hourly_rate > 0 AND hourly_rate <= 100000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  model text NOT NULL CHECK (model IN ('payg', 'hours_bank', 'availability')),
  capacity_hours_per_week numeric,
  availability_note text NOT NULL DEFAULT '' CHECK (char_length(availability_note) <= 500),
  sla_accepted_at timestamptz NOT NULL,
  sla_summary text NOT NULL DEFAULT '',
  message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'shortlisted', 'selected', 'declined', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, consultant_id)
);

CREATE TABLE IF NOT EXISTS public.sa_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  by_role text NOT NULL CHECK (by_role IN ('client', 'consultant')),
  by_user uuid NOT NULL,
  patch jsonb NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'declined', 'superseded')),
  responded_by uuid,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sa_versions (
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  version integer NOT NULL,
  terms jsonb NOT NULL,
  content_hash text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agreement_id, version)
);

CREATE TABLE IF NOT EXISTS public.sa_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  version integer NOT NULL,
  content_hash text NOT NULL,
  party text NOT NULL CHECK (party IN ('client', 'consultant')),
  user_id uuid NOT NULL,
  typed_name text NOT NULL CHECK (char_length(typed_name) BETWEEN 2 AND 120),
  legal_draft boolean NOT NULL DEFAULT true,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agreement_id, version, party)
);

CREATE TABLE IF NOT EXISTS public.sa_rate_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  hourly_rate numeric NOT NULL CHECK (hourly_rate > 0 AND hourly_rate <= 100000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  s1_multiplier numeric,
  ooh_multiplier numeric,
  overage_rate numeric,
  effective_from date NOT NULL,
  proposed_by uuid,
  proposed_role text,
  accepted_by uuid,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('negotiation', 'rate_change', 'renewal')),
  terms_version integer,
  previous_id uuid,
  UNIQUE (agreement_id, seq)
);

CREATE TABLE IF NOT EXISTS public.sa_rate_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  proposed_by uuid NOT NULL,
  proposed_role text NOT NULL CHECK (proposed_role IN ('client', 'consultant')),
  hourly_rate numeric NOT NULL,
  s1_multiplier numeric,
  ooh_multiplier numeric,
  overage_rate numeric,
  effective_from date NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  decided_by uuid,
  decided_at timestamptz,
  rate_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sa_rate_changes_one_pending ON public.sa_rate_changes (agreement_id) WHERE status = 'pending';

-- The client's crew ("support team"): lead + members with a role, weekly capacity, working hours and backup cover.
-- Each member accepts the place and the agreement's SLA snapshot (sa_member_acceptances) and signs the NDA.
CREATE TABLE IF NOT EXISTS public.sa_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL,
  member_role text NOT NULL CHECK (member_role IN ('lead', 'functional', 'technical', 'basis', 'backup', 'support')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'declined', 'ended')),
  required boolean NOT NULL DEFAULT true,
  capacity_hours_per_week numeric CHECK (capacity_hours_per_week IS NULL OR capacity_hours_per_week BETWEEN 0 AND 60),
  working_hours jsonb NOT NULL DEFAULT '{}'::jsonb,       -- {timezone, days [1-7], from "08:00", to "17:00"}
  backup_for uuid,                                         -- consultant this member covers
  invited_by uuid,
  accepted_at timestamptz,
  sla_policy_id uuid,
  sla_version integer,
  sla_hash text,
  sla_accepted_at timestamptz,
  end_reason text,
  added_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sa_members_one_open ON public.sa_members (agreement_id, consultant_id) WHERE status IN ('invited', 'active', 'declined');

-- Append-only record of each member's acceptance of the place + SLA (checkbox + typed name + SLA version and hash).
CREATE TABLE IF NOT EXISTS public.sa_member_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  member_role text NOT NULL,
  terms_version integer,
  terms_hash text,
  sla_policy_id uuid,
  sla_version integer,
  sla_hash text,
  sla_summary text NOT NULL DEFAULT '',
  typed_name text NOT NULL CHECK (char_length(typed_name) BETWEEN 2 AND 120),
  legal_draft boolean NOT NULL DEFAULT true,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

-- Agreement documents: supporting files (SOW, scope annex, access plan, escalation matrix) in the private bucket
-- 'agreement-documents' under <agreement>/<upload>/<file>; versions, uploads in progress and every download are kept.
CREATE TABLE IF NOT EXISTS public.sa_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('sow', 'scope_annex', 'access_plan', 'escalation_matrix', 'other')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  current_version integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid
);
CREATE INDEX IF NOT EXISTS sa_documents_agreement ON public.sa_documents (agreement_id);

CREATE TABLE IF NOT EXISTS public.sa_document_versions (
  document_id uuid NOT NULL REFERENCES public.sa_documents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  agreement_id uuid NOT NULL,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  note text NOT NULL DEFAULT '',
  uploaded_by uuid NOT NULL,
  uploaded_role text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, version)
);

CREATE TABLE IF NOT EXISTS public.sa_document_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  document_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  note text NOT NULL DEFAULT '',
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.sa_document_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  version integer NOT NULL,
  storage_path text NOT NULL,
  user_id uuid NOT NULL,
  actor_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_document_access_path ON public.sa_document_access (storage_path, user_id, created_at);

CREATE TABLE IF NOT EXISTS public.sa_replacements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  from_consultant uuid NOT NULL,
  to_consultant uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'pending_admin' CHECK (status IN ('pending_admin', 'pending_consultant', 'done', 'declined')),
  requested_by uuid NOT NULL,
  admin_by uuid,
  admin_at timestamptz,
  done_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sa_replacements_one_open ON public.sa_replacements (agreement_id) WHERE status IN ('pending_admin', 'pending_consultant');

CREATE TABLE IF NOT EXISTS public.sa_tickets (
  ticket_id uuid PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_tickets_agreement ON public.sa_tickets (agreement_id);

CREATE TABLE IF NOT EXISTS public.sa_months (
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  month date NOT NULL,
  committed numeric NOT NULL,
  carried_in jsonb NOT NULL DEFAULT '[]'::jsonb,
  used_hours numeric NOT NULL,
  carried_out jsonb NOT NULL DEFAULT '[]'::jsonb,
  expired_hours numeric NOT NULL,
  charge_hours numeric NOT NULL,
  overage_hours numeric NOT NULL,
  base_amount numeric NOT NULL,
  payment_id uuid,
  settled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agreement_id, month)
);

CREATE TABLE IF NOT EXISTS public.sa_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  kind text NOT NULL,
  actor_id uuid,
  actor_role text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_events_agreement ON public.sa_events (agreement_id, created_at);

CREATE TABLE IF NOT EXISTS public.sa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('client', 'consultant')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sa_messages_thread ON public.sa_messages (agreement_id, consultant_id, created_at);

CREATE TABLE IF NOT EXISTS public.sa_notices (dedupe_key text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS public.sa_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sa_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  agreement_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sa_agreements', 'sa_invites', 'sa_applications', 'sa_offers', 'sa_versions', 'sa_acceptances', 'sa_rate_records',
    'sa_rate_changes', 'sa_members', 'sa_member_acceptances', 'sa_replacements', 'sa_tickets', 'sa_months', 'sa_events', 'sa_messages', 'sa_notices',
    'sa_email_queue', 'sa_audit', 'sa_documents', 'sa_document_versions', 'sa_document_uploads', 'sa_document_access'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Terms versions, acceptances, agreed rate records, events, messages and the audit are append-only.
CREATE OR REPLACE FUNCTION public.sa_guard_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;   -- cascades from a deleted agreement
  RAISE EXCEPTION 'sa_immutable: % rows cannot be changed or deleted', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sa_versions', 'sa_acceptances', 'sa_rate_records', 'sa_events', 'sa_messages', 'sa_audit',
                           'sa_member_acceptances', 'sa_document_versions', 'sa_document_access'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sa_append_only ON public.%I', t);
    EXECUTE format('CREATE TRIGGER sa_append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.sa_guard_append_only()', t);
  END LOOP;
END $$;

-- Agreement tickets carry an approved rate of source 'agreement' (widens the existing check, nothing else changes).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.ticket_rates'::regclass AND conname = 'ticket_rates_source_check'
               AND pg_get_constraintdef(oid) NOT LIKE '%agreement%') THEN
    ALTER TABLE public.ticket_rates DROP CONSTRAINT ticket_rates_source_check;
    ALTER TABLE public.ticket_rates ADD CONSTRAINT ticket_rates_source_check CHECK (source = ANY (ARRAY['consultant'::text, 'proposal'::text, 'agreement'::text]));
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION public.sa_is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role IN ('admin'::app_role, 'super_admin'::app_role))
$$;

CREATE OR REPLACE FUNCTION public.sa_can_manage(_uid uuid, _tenant uuid, _client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    (_tenant IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = _tenant AND m.user_id = _uid
                                       AND m.org_role IN ('owner'::org_role, 'admin'::org_role) AND m.accepted_at IS NOT NULL))
    OR (_tenant IS NULL AND _client = _uid AND public.has_role(_uid, 'client'::app_role)))
$$;

CREATE OR REPLACE FUNCTION public.sa_consultant_of(_uid uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id FROM public.consultants c WHERE c.user_id = _uid LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.sa_user_of(_consultant uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.user_id FROM public.consultants c WHERE c.id = _consultant LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.sa_modules(_a public.sa_agreements)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY(SELECT DISTINCT x FROM jsonb_array_elements_text(COALESCE(_a.terms -> 'scope' -> 'modules', _a.request -> 'modules', '[]'::jsonb)) x)
$$;

-- Role of a viewer on one agreement:
--   admin | client (owner/admin of the company, or the client himself) | client_member | lead | team |
--   applicant (applied) | candidate (may see the request: open, invited or verified with a matching module) | NULL
CREATE OR REPLACE FUNCTION public.sa_role(_id uuid, _uid uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements; cid uuid;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF a.id IS NULL THEN RETURN NULL; END IF;
  IF public.sa_is_admin(_uid) THEN RETURN 'admin'; END IF;
  IF a.client_id = _uid OR public.sa_can_manage(_uid, a.tenant_id, a.client_id) THEN RETURN 'client'; END IF;
  IF a.tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = a.tenant_id AND m.user_id = _uid AND m.accepted_at IS NOT NULL) THEN
    RETURN 'client_member';
  END IF;
  cid := public.sa_consultant_of(_uid);
  IF cid IS NULL THEN RETURN NULL; END IF;
  IF a.consultant_id = cid AND a.status NOT IN ('draft', 'open') THEN RETURN 'lead'; END IF;
  IF EXISTS (SELECT 1 FROM public.sa_members m WHERE m.agreement_id = _id AND m.consultant_id = cid AND m.status IN ('invited', 'active')) THEN RETURN 'team'; END IF;
  IF EXISTS (SELECT 1 FROM public.sa_applications p WHERE p.agreement_id = _id AND p.consultant_id = cid) THEN RETURN 'applicant'; END IF;
  IF a.status = 'open' AND (
       EXISTS (SELECT 1 FROM public.sa_invites i WHERE i.agreement_id = _id AND i.consultant_id = cid)
    OR (NOT a.invite_only AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = cid AND c.verification_status::text = 'verified')
        AND EXISTS (SELECT 1 FROM public.consultant_skills s WHERE s.consultant_id = cid AND s.sap_module = ANY (public.sa_modules(a))))) THEN
    RETURN 'candidate';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.sa_party(_role text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _role IN ('client') THEN 'client' WHEN _role = 'lead' THEN 'consultant' END
$$;

CREATE OR REPLACE FUNCTION public.sa_text_ok(_t text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _t IS NULL OR _t = '' THEN RETURN true; END IF;
  IF to_regprocedure('public.contact_details_in_text(text)') IS NOT NULL THEN RETURN NOT public.contact_details_in_text(_t); END IF;
  RETURN _t !~* '([a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,})|(https?://|www\.)|(\+|\m00)\d[\d\s().-]{7,}\d';
END $$;

CREATE OR REPLACE FUNCTION public.sa_rate_ok(_bucket text, _limit integer, _seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regprocedure('public.check_rate_limit(text,integer,integer)') IS NULL THEN RETURN true; END IF;
  RETURN public.check_rate_limit(_bucket, _limit, _seconds);
END $$;

CREATE OR REPLACE FUNCTION public.sa_lang(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN (SELECT p.preferred_language FROM public.profiles p WHERE p.user_id = _user LIMIT 1) = 'ar' THEN 'ar' ELSE 'en' END
$$;

-- No passwords or access secrets in agreement texts and document titles/notes ("password: ...", "api key = ...", keys).
CREATE OR REPLACE FUNCTION public.sa_secret_ok(_t text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _t IS NULL OR (_t !~* '\m(pass(word|wort|wd)?|pwd|kennwort|secret|api[ _-]?key|access[ _-]?key|token|client[ _-]?secret)\s*[:=]'
                        AND _t !~ '(كلمة\s*(المرور|السر))\s*[:=]' AND _t !~ '-----BEGIN [A-Z ]*PRIVATE KEY')
$$;

-- ------------------------------------------------------------------------------------------------ name + reference number
-- Every agreement gets a reference "SA-<year>-<6 digits>" when it is created; the reference and the owner never
-- change and the client-chosen name can only change while the agreement is a Draft. Names are unique per client
-- company (own-account clients: per client) among agreements that are not archived.
CREATE SEQUENCE IF NOT EXISTS public.sa_reference_seq;
REVOKE ALL ON SEQUENCE public.sa_reference_seq FROM PUBLIC;
DO $$ BEGIN EXECUTE 'REVOKE ALL ON SEQUENCE public.sa_reference_seq FROM anon, authenticated'; EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.sa_guard_agreement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.reference := 'SA-' || to_char(now() AT TIME ZONE 'UTC', 'YYYY') || '-' || lpad(nextval('public.sa_reference_seq')::text, 6, '0');
    NEW.name := btrim(NEW.name);
    RETURN NEW;
  END IF;
  IF NEW.reference IS DISTINCT FROM OLD.reference OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'sa_immutable: reference and owner never change' USING ERRCODE = '42501';
  END IF;
  IF NEW.name IS DISTINCT FROM OLD.name AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'sa_name_locked: the name can only change in Draft' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sa_guard_agreement ON public.sa_agreements;
CREATE TRIGGER sa_guard_agreement BEFORE INSERT OR UPDATE ON public.sa_agreements FOR EACH ROW EXECUTE FUNCTION public.sa_guard_agreement();
CREATE UNIQUE INDEX IF NOT EXISTS sa_agreements_name_per_client ON public.sa_agreements (COALESCE(tenant_id, client_id), lower(btrim(name))) WHERE status <> 'archived';

CREATE OR REPLACE FUNCTION public.sa_name_taken(_tenant uuid, _client uuid, _name text, _except uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.sa_agreements a WHERE COALESCE(a.tenant_id, a.client_id) = COALESCE(_tenant, _client)
                   AND lower(btrim(a.name)) = lower(btrim(COALESCE(_name, ''))) AND a.status <> 'archived' AND a.id IS DISTINCT FROM _except)
$$;

-- "Name (SA-2026-000012)" for notices, invoices and e-mails.
CREATE OR REPLACE FUNCTION public.sa_label(_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.name || COALESCE(' (' || a.reference || ')', '') FROM public.sa_agreements a WHERE a.id = _id
$$;

-- Person shown in document version and download lists (consultants: the public name format only).
CREATE OR REPLACE FUNCTION public.sa_user_label(_uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT public.consultant_public_name(c.id) FROM public.consultants c WHERE c.user_id = _uid LIMIT 1),
                  (SELECT NULLIF(btrim(p.display_name), '') FROM public.profiles p WHERE p.user_id = _uid LIMIT 1), '—')
$$;

-- ------------------------------------------------------------------------------------------------ company contacts
-- A statement recipient or escalation contact must be the client himself or an accepted member of the client company.
CREATE OR REPLACE FUNCTION public.sa_company_user(_tenant uuid, _client uuid, _email text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM auth.users u
   WHERE lower(u.email) = lower(btrim(COALESCE(_email, '')))
     AND (u.id = _client OR (_tenant IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = _tenant AND m.user_id = u.id AND m.accepted_at IS NOT NULL)))
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.sa_contact_problems(_tenant uuid, _client uuid, _t jsonb)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.sa_settings(); mx int := COALESCE((s ->> 'contacts_max')::int, 5); out text[] := '{}'; e jsonb; x text;
BEGIN
  IF jsonb_typeof(COALESCE(_t -> 'statement_recipients', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_t -> 'statement_recipients', '[]'::jsonb)) > mx THEN
    out := array_append(out, 'recipients_max');
  ELSE
    FOR x IN SELECT jsonb_array_elements_text(COALESCE(_t -> 'statement_recipients', '[]'::jsonb)) LOOP
      IF public.sa_company_user(_tenant, _client, x) IS NULL THEN out := array_append(out, 'recipient_outside'); END IF;
    END LOOP;
  END IF;
  IF jsonb_typeof(COALESCE(_t -> 'escalation_contacts', '[]'::jsonb)) <> 'array' OR jsonb_array_length(COALESCE(_t -> 'escalation_contacts', '[]'::jsonb)) > mx THEN
    out := array_append(out, 'escalation_max');
  ELSE
    FOR e IN SELECT jsonb_array_elements(COALESCE(_t -> 'escalation_contacts', '[]'::jsonb)) LOOP
      IF public.sa_company_user(_tenant, _client, e ->> 'email') IS NULL THEN out := array_append(out, 'escalation_outside'); END IF;
      IF COALESCE(e ->> 'level', '') NOT IN ('1', '2', '3') THEN out := array_append(out, 'escalation_level'); END IF;
      IF char_length(COALESCE(e ->> 'title', '')) > 80 OR NOT public.sa_text_ok(e ->> 'title') THEN out := array_append(out, 'escalation_title'); END IF;
    END LOOP;
  END IF;
  RETURN ARRAY(SELECT DISTINCT unnest(out));
END $$;

-- ------------------------------------------------------------------------------------------------ SLA snapshot
CREATE OR REPLACE FUNCTION public.sa_fmt_min(_m numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _m IS NULL THEN '-' WHEN _m < 60 THEN round(_m) || ' min' WHEN _m % 1440 = 0 THEN (_m / 1440)::int || ' d'
              WHEN _m % 60 = 0 THEN (_m / 60)::int || ' h' ELSE floor(_m / 60)::int || ' h ' || (_m % 60)::int || ' min' END
$$;

-- The SLA the agreement is agreed with: one of the client's ACTIVE policies (own company), an active template or the
-- platform default, always its active version. The full version body and its hash are copied into the terms, so the
-- agreement keeps an immutable snapshot (part of the terms hash both sides accept). No policy = platform default SLA.
CREATE OR REPLACE FUNCTION public.sa_resolve_sla(_tenant uuid, _client uuid, _sla jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; p record; body jsonb; hash text; summary text;
BEGIN
  BEGIN pid := NULLIF(_sla ->> 'policy_id', '')::uuid; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'sa_sla_invalid' USING ERRCODE = '22023'; END;
  IF pid IS NULL THEN
    RETURN jsonb_build_object('policy_id', NULL, 'version', NULL, 'source', 'platform', 'name', NULL, 'summary', '');
  END IF;
  IF to_regclass('public.sla_policies') IS NULL THEN   -- SLA policies not installed: keep the reference only
    RETURN jsonb_build_object('policy_id', pid, 'version', NULLIF(_sla ->> 'version', '')::int, 'source', 'reference', 'name', left(_sla ->> 'name', 120),
                              'summary', left(COALESCE(_sla ->> 'summary', ''), 1000));
  END IF;
  EXECUTE 'SELECT p.scope, p.tenant_id, p.client_id, p.status, p.active_version, p.name FROM public.sla_policies p WHERE p.id = $1' INTO p USING pid;
  IF p.scope IS NULL OR p.status <> 'active' OR p.active_version IS NULL
     OR (p.scope = 'client' AND NOT ((_tenant IS NOT NULL AND p.tenant_id = _tenant) OR (p.tenant_id IS NULL AND p.client_id = _client))) THEN
    RAISE EXCEPTION 'sa_sla_invalid: choose an active SLA policy of your company or a template' USING ERRCODE = '22023';
  END IF;
  EXECUTE 'SELECT v.body, v.content_hash FROM public.sla_policy_versions v WHERE v.policy_id = $1 AND v.version = $2' INTO body, hash USING pid, p.active_version;
  IF body IS NULL THEN RAISE EXCEPTION 'sa_sla_invalid' USING ERRCODE = '22023'; END IF;
  SELECT string_agg(k || ': response ' || public.sa_fmt_min((body -> 'severities' -> k ->> 'response_min')::numeric)
                    || ', resolution ' || public.sa_fmt_min((body -> 'severities' -> k ->> 'resolution_min')::numeric), '; ' ORDER BY k)
    INTO summary FROM unnest(ARRAY['S1', 'S2', 'S3', 'S4']) k WHERE body -> 'severities' ? k;
  RETURN jsonb_build_object('policy_id', pid, 'version', p.active_version, 'source', p.scope, 'name', p.name, 'hash', hash, 'body', body,
                            'summary', left(p.name || ' (v' || p.active_version || ')' || COALESCE(': ' || summary, ''), 1000));
END $$;

-- ------------------------------------------------------------------------------------------------ crew
-- terms.team = [{consultant_id, role, capacity_hours_per_week, working_hours {timezone, days, from, to}, backup_for, required}]
-- Lead entry only for the selected lead consultant; verified consultants only; never one the client blocked.
CREATE OR REPLACE FUNCTION public.sa_crew_problems(_tenant uuid, _client uuid, _team jsonb, _lead uuid)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.sa_settings(); e jsonb; out text[] := '{}'; ids uuid[] := '{}'; cid uuid; b uuid; wh jsonb;
BEGIN
  IF _team IS NULL OR jsonb_typeof(_team) = 'null' THEN RETURN '{}'; END IF;
  IF jsonb_typeof(_team) <> 'array' THEN RETURN ARRAY['crew_member']; END IF;
  IF jsonb_array_length(_team) > COALESCE((s ->> 'crew_max')::int, 6) THEN out := array_append(out, 'crew_size'); END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(_team) x LOOP
    BEGIN cid := (e ->> 'consultant_id')::uuid; EXCEPTION WHEN OTHERS THEN cid := NULL; END;
    IF cid IS NULL OR NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = cid AND c.verification_status::text = 'verified') THEN
      out := array_append(out, 'crew_member'); CONTINUE;
    END IF;
    IF cid = ANY (ids) THEN out := array_append(out, 'crew_duplicate'); END IF;
    ids := array_append(ids, cid);
    IF COALESCE(e ->> 'role', '') NOT IN ('lead', 'functional', 'technical', 'basis', 'backup', 'support')
       OR ((e ->> 'role' = 'lead') IS DISTINCT FROM (cid = _lead AND _lead IS NOT NULL)) THEN
      out := array_append(out, 'crew_role');
    END IF;
    IF jsonb_typeof(e -> 'capacity_hours_per_week') = 'number' AND (e ->> 'capacity_hours_per_week')::numeric NOT BETWEEN 0 AND 60 THEN out := array_append(out, 'crew_capacity'); END IF;
    wh := COALESCE(e -> 'working_hours', '{}'::jsonb);
    IF jsonb_typeof(wh) <> 'object' OR char_length(COALESCE(wh ->> 'timezone', '')) > 64
       OR (wh ? 'from' AND COALESCE(wh ->> 'from', '') !~ '^([01]\d|2[0-3]):[0-5]\d$') OR (wh ? 'to' AND COALESCE(wh ->> 'to', '') !~ '^([01]\d|2[0-3]):[0-5]\d$')
       OR (wh ? 'days' AND (jsonb_typeof(wh -> 'days') <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(wh -> 'days') d WHERE d !~ '^[1-7]$'))) THEN
      out := array_append(out, 'crew_hours');
    END IF;
    IF EXISTS (SELECT 1 FROM public.client_consultant_blocks k WHERE k.consultant_id = cid
                 AND ((_tenant IS NOT NULL AND k.tenant_id = _tenant) OR (k.tenant_id IS NULL AND k.owner_user_id = _client))) THEN
      out := array_append(out, 'crew_blocked');
    END IF;
  END LOOP;
  FOR e IN SELECT x FROM jsonb_array_elements(_team) x WHERE NULLIF(x ->> 'backup_for', '') IS NOT NULL LOOP
    BEGIN b := (e ->> 'backup_for')::uuid; EXCEPTION WHEN OTHERS THEN b := NULL; END;
    IF b IS NULL OR NOT (b = ANY (ids) OR b = _lead) OR b::text = e ->> 'consultant_id' THEN out := array_append(out, 'crew_backup'); END IF;
  END LOOP;
  RETURN ARRAY(SELECT DISTINCT unnest(out));
END $$;

CREATE OR REPLACE FUNCTION public.sa_member_nda_ok(_client uuid, _consultant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = _consultant AND n.client_id = _client
                   AND n.revoked_at IS NULL AND n.signed_at IS NOT NULL AND n.client_signed_at IS NOT NULL)
$$;

CREATE OR REPLACE FUNCTION public.sa_transition_allowed(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (_from, _to) IN (('draft', 'open'), ('draft', 'archived'), ('open', 'negotiating'), ('open', 'draft'), ('open', 'archived'),
    ('negotiating', 'agreed'), ('negotiating', 'open'), ('negotiating', 'archived'), ('agreed', 'active'), ('agreed', 'terminated'), ('agreed', 'archived'),
    ('active', 'suspended'), ('active', 'renewal_due'), ('active', 'terminated'), ('active', 'expired'), ('suspended', 'active'), ('suspended', 'terminated'),
    ('renewal_due', 'active'), ('renewal_due', 'expired'), ('renewal_due', 'terminated'), ('expired', 'archived'), ('terminated', 'archived'))
$$;

CREATE OR REPLACE FUNCTION public.sa_event(_id uuid, _kind text, _actor uuid, _data jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.sa_events (agreement_id, kind, actor_id, actor_role, data)
  VALUES (_id, _kind, _actor, CASE WHEN _actor IS NULL THEN 'system' ELSE COALESCE(public.sa_role(_id, _actor), 'system') END, COALESCE(_data, '{}'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.sa_audit_log(_actor uuid, _action text, _id uuid, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.sa_audit (actor_id, action, agreement_id, detail) VALUES (_actor, _action, _id, COALESCE(_detail, '{}'::jsonb))
$$;

-- In-app notice (+ optional e-mail through agreement-run) once per dedupe key. The agreement reference number is
-- added to every title ("... · SA-2026-000012") and to the e-mail payload.
CREATE OR REPLACE FUNCTION public.sa_notify(_id uuid, _user uuid, _title_en text, _title_ar text, _body_en text, _body_ar text, _role text, _email boolean, _dedupe text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lang text := public.sa_lang(_user); n int; link text; ref text; title text;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;
  INSERT INTO public.sa_notices (dedupe_key) VALUES (left(_dedupe, 300)) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN; END IF;
  SELECT a.reference INTO ref FROM public.sa_agreements a WHERE a.id = _id;
  title := CASE WHEN lang = 'ar' THEN _title_ar ELSE _title_en END;
  IF ref IS NOT NULL AND position(ref IN title) = 0 THEN title := title || ' · ' || ref; END IF;
  link := CASE _role WHEN 'consultant' THEN '/consultant/agreements/' || _id WHEN 'admin' THEN '/admin/agreements' ELSE '/client/agreements/' || _id END;
  PERFORM public.safe_insert_notification(_user, left(title, 200), left(CASE WHEN lang = 'ar' THEN _body_ar ELSE _body_en END, 1000), 'agreement', link);
  IF _email THEN
    INSERT INTO public.sa_email_queue (user_id, agreement_id, kind, payload, dedupe_key)
    VALUES (_user, _id, 'event', jsonb_build_object('lang', lang, 'title', title,
      'body', CASE WHEN lang = 'ar' THEN _body_ar ELSE _body_en END, 'path', link, 'role', _role, 'reference', ref,
      'name', (SELECT a.name FROM public.sa_agreements a WHERE a.id = _id)), left('sa:' || _dedupe, 300))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END $$;

-- Notify the parties: client + company managers, the lead consultant and the crew members who accepted their place.
CREATE OR REPLACE FUNCTION public.sa_notify_parties(_id uuid, _title_en text, _title_ar text, _body_en text, _body_ar text, _email boolean, _key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements; u uuid; c uuid;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  FOR u IN SELECT a.client_id UNION SELECT m.user_id FROM public.tenant_members m WHERE m.tenant_id = a.tenant_id AND m.accepted_at IS NOT NULL
                                    AND m.org_role IN ('owner'::org_role, 'admin'::org_role) LOOP
    PERFORM public.sa_notify(_id, u, _title_en, _title_ar, _body_en, _body_ar, 'client', _email, _key || ':' || u);
  END LOOP;
  IF a.consultant_id IS NOT NULL AND a.status NOT IN ('draft', 'open') THEN
    PERFORM public.sa_notify(_id, public.sa_user_of(a.consultant_id), _title_en, _title_ar, _body_en, _body_ar, 'consultant', _email, _key || ':lead');
  END IF;
  FOR c IN SELECT m.consultant_id FROM public.sa_members m WHERE m.agreement_id = _id AND m.status = 'active' AND m.consultant_id IS DISTINCT FROM a.consultant_id LOOP
    PERFORM public.sa_notify(_id, public.sa_user_of(c), _title_en, _title_ar, _body_en, _body_ar, 'consultant', _email, _key || ':m:' || c);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.sa_notify_admins(_id uuid, _title text, _body text, _key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid;
BEGIN
  FOR u IN SELECT DISTINCT r.user_id FROM public.user_roles r WHERE r.role IN ('admin'::app_role, 'super_admin'::app_role) LOOP
    PERFORM public.sa_notify(_id, u, _title, _title, _body, _body, 'admin', false, _key || ':' || u);
  END LOOP;
END $$;

-- The only way to change an agreement's status (state machine + timeline + audit).
CREATE OR REPLACE FUNCTION public.sa_set_status(_id uuid, _to text, _actor uuid, _data jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur text;
BEGIN
  SELECT status INTO cur FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF cur IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  IF cur = _to THEN RETURN; END IF;
  IF NOT public.sa_transition_allowed(cur, _to) THEN
    RAISE EXCEPTION 'sa_bad_transition: % -> %', cur, _to USING ERRCODE = '55000';
  END IF;
  UPDATE public.sa_agreements SET status = _to, updated_at = now() WHERE id = _id;
  PERFORM public.sa_event(_id, 'status', _actor, COALESCE(_data, '{}'::jsonb) || jsonb_build_object('from', cur, 'to', _to));
  PERFORM public.sa_audit_log(_actor, 'status', _id, jsonb_build_object('from', cur, 'to', _to) || COALESCE(_data, '{}'::jsonb));
END $$;

-- ------------------------------------------------------------------------------------------------ rules (mirror of the TS model)
CREATE OR REPLACE FUNCTION public.sa_rate_problems(_rate numeric, _s1 numeric, _ooh numeric, _overage numeric, _modules text[])
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.sa_settings(); lo numeric := COALESCE((s ->> 'rate_min')::numeric, 10); hi numeric := COALESCE((s ->> 'rate_max')::numeric, 1000);
  m text; out text[] := '{}'; mx numeric := COALESCE((s ->> 'max_multiplier')::numeric, 2);
BEGIN
  FOREACH m IN ARRAY COALESCE(_modules, '{}') LOOP
    IF s -> 'rate_caps' -> m ->> 'min' IS NOT NULL THEN lo := GREATEST(lo, (s -> 'rate_caps' -> m ->> 'min')::numeric); END IF;
    IF s -> 'rate_caps' -> m ->> 'max' IS NOT NULL THEN hi := LEAST(hi, (s -> 'rate_caps' -> m ->> 'max')::numeric); END IF;
  END LOOP;
  IF _rate IS NULL OR _rate < lo THEN out := array_append(out, 'rate_low'); END IF;
  IF _rate IS NULL OR _rate > hi THEN out := array_append(out, 'rate_high'); END IF;
  IF (_s1 IS NOT NULL AND (_s1 < 1 OR _s1 > mx)) OR (_ooh IS NOT NULL AND (_ooh < 1 OR _ooh > mx)) THEN out := array_append(out, 'multiplier'); END IF;
  IF _overage IS NOT NULL AND _overage < _rate THEN out := array_append(out, 'overage_low'); END IF;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.sa_terms_problems(_t jsonb)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.sa_settings(); out text[] := '{}'; sd date; ed date; mods text[];
BEGIN
  mods := ARRAY(SELECT jsonb_array_elements_text(COALESCE(_t -> 'scope' -> 'modules', '[]'::jsonb)));
  IF char_length(btrim(COALESCE(_t ->> 'name', ''))) NOT BETWEEN 1 AND 120 THEN out := array_append(out, 'name'); END IF;
  IF cardinality(mods) = 0 THEN out := array_append(out, 'modules'); END IF;
  IF NOT (COALESCE(s -> 'models_enabled', '[]'::jsonb) ? COALESCE(_t ->> 'model', '')) THEN out := array_append(out, 'model_disabled'); END IF;
  BEGIN sd := (_t -> 'term' ->> 'start_date')::date; EXCEPTION WHEN OTHERS THEN sd := NULL; END;
  BEGIN ed := NULLIF(_t -> 'term' ->> 'end_date', '')::date; EXCEPTION WHEN OTHERS THEN ed := NULL; out := array_append(out, 'end_before_start'); END;
  IF sd IS NULL OR sd < current_date THEN out := array_append(out, 'start_past'); END IF;
  IF ed IS NOT NULL AND sd IS NOT NULL THEN
    IF ed <= sd THEN out := array_append(out, 'end_before_start');
    ELSIF COALESCE((s ->> 'min_term_months')::int, 0) > 0 AND ed < (sd + make_interval(months => (s ->> 'min_term_months')::int))::date THEN out := array_append(out, 'term_short');
    END IF;
  END IF;
  IF COALESCE((_t -> 'term' ->> 'notice_days')::int, -1) NOT BETWEEN 0 AND COALESCE((s ->> 'max_notice_days')::int, 90) THEN out := array_append(out, 'notice'); END IF;
  IF _t ->> 'model' = 'hours_bank' THEN
    IF COALESCE((_t -> 'bank' ->> 'hours_per_month')::numeric, 0) NOT BETWEEN 0.25 AND 744 THEN out := array_append(out, 'bank_hours'); END IF;
    IF _t -> 'bank' ->> 'unused' = 'forfeit' AND NOT COALESCE((s ->> 'allow_forfeit')::boolean, false) THEN out := array_append(out, 'forfeit_disabled'); END IF;
    IF COALESCE((_t -> 'bank' ->> 'prepay')::boolean, false) AND NOT COALESCE((s ->> 'allow_prepayment')::boolean, false) THEN out := array_append(out, 'prepay_disabled'); END IF;
  END IF;
  IF _t ->> 'model' = 'availability' AND COALESCE((_t ->> 'capacity_hours_per_week')::numeric, 0) NOT BETWEEN 0.5 AND 60 THEN out := array_append(out, 'capacity'); END IF;
  IF COALESCE(_t -> 'rate' ->> 'currency', '') !~ '^[A-Z]{3}$' THEN out := array_append(out, 'currency'); END IF;
  out := out || public.sa_rate_problems((_t -> 'rate' ->> 'hourly_rate')::numeric, NULLIF(_t -> 'rate' ->> 's1_multiplier', '')::numeric,
    NULLIF(_t -> 'rate' ->> 'ooh_multiplier', '')::numeric, NULLIF(_t -> 'rate' ->> 'overage_rate', '')::numeric, mods);
  RETURN out;
END $$;

-- One month of an hours bank (same rules as bankMonth in _shared/supportAgreements.ts).
CREATE OR REPLACE FUNCTION public.sa_bank_month(_month text, _carried jsonb, _used numeric, _bank jsonb, _committed numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  b record; left_h numeric := GREATEST(0, COALESCE(_used, 0)); take numeric; keep numeric; expired numeric := 0; nxt jsonb := '[]'::jsonb;
  mode text := COALESCE(_bank ->> 'rollover', 'none'); cap_h numeric := COALESCE((_bank ->> 'rollover_hours')::numeric, 0);
  cap_m int := COALESCE((_bank ->> 'rollover_months')::int, 0); age int; rem jsonb := '[]'::jsonb; x jsonb; h numeric;
BEGIN
  FOR b IN SELECT e ->> 'month' AS m, (e ->> 'hours')::numeric AS hrs FROM (
             SELECT e FROM jsonb_array_elements(COALESCE(_carried, '[]'::jsonb)) e WHERE (e ->> 'hours')::numeric > 0
             UNION ALL SELECT jsonb_build_object('month', _month, 'hours', _committed)) q ORDER BY e ->> 'month' LOOP
    take := LEAST(b.hrs, left_h);
    left_h := round(left_h - take, 2);
    rem := rem || jsonb_build_object('month', b.m, 'hours', round(b.hrs - take, 2));
  END LOOP;
  FOR x IN SELECT e FROM jsonb_array_elements(rem) e LOOP
    h := (x ->> 'hours')::numeric;
    IF h <= 0 THEN CONTINUE; END IF;
    age := (split_part(_month, '-', 1)::int - split_part(x ->> 'month', '-', 1)::int) * 12 + (split_part(_month, '-', 2)::int - split_part(x ->> 'month', '-', 2)::int);
    keep := CASE WHEN mode = 'hours' AND x ->> 'month' = _month THEN LEAST(h, GREATEST(0, cap_h))
                 WHEN mode = 'months' AND age + 1 <= GREATEST(0, cap_m) THEN h ELSE 0 END;
    IF keep > 0 THEN nxt := nxt || jsonb_build_object('month', x ->> 'month', 'hours', round(keep, 2)); END IF;
    expired := round(expired + h - keep, 2);
  END LOOP;
  RETURN jsonb_build_object('carried_out', nxt, 'expired_hours', expired,
    'charge_hours', CASE WHEN COALESCE(_bank ->> 'unused', 'charge') = 'charge' THEN expired ELSE 0 END, 'overage_hours', left_h);
END $$;

CREATE OR REPLACE FUNCTION public.sa_nda_ok(_a public.sa_agreements)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT COALESCE((_a.terms ->> 'nda_required')::boolean, true) OR public.sa_member_nda_ok(_a.client_id, _a.consultant_id)
$$;

-- "Team confirmation" checklist: nobody works under the agreement until the terms are accepted by the client and the
-- lead, every REQUIRED crew member accepted the place and the SLA snapshot, the NDA is signed by both sides for every
-- working member (when required), the admin review is done (pilot setting) and the start date has come.
CREATE OR REPLACE FUNCTION public.sa_confirmation(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements; nda_req boolean; members jsonb; crew_ok boolean; nda_all boolean; terms_ok boolean; review_ok boolean; start_ok boolean; sd date;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF a.id IS NULL THEN RETURN NULL; END IF;
  nda_req := COALESCE((a.terms ->> 'nda_required')::boolean, true);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('consultant_id', m.consultant_id, 'name', public.consultant_public_name(m.consultant_id), 'role', m.member_role,
           'required', m.required, 'status', m.status, 'capacity_hours_per_week', m.capacity_hours_per_week, 'working_hours', m.working_hours,
           'backup_for', m.backup_for, 'accepted_at', m.accepted_at, 'sla_accepted_at', m.sla_accepted_at, 'sla_version', m.sla_version,
           'nda_ok', public.sa_member_nda_ok(a.client_id, m.consultant_id),
           'nda_signed_at', (SELECT max(GREATEST(n.signed_at, n.client_signed_at)) FROM public.nda_agreements n WHERE n.consultant_id = m.consultant_id AND n.client_id = a.client_id
                               AND n.revoked_at IS NULL AND n.signed_at IS NOT NULL AND n.client_signed_at IS NOT NULL))
         ORDER BY (m.member_role = 'lead') DESC, m.added_at), '[]'::jsonb)
    INTO members FROM public.sa_members m WHERE m.agreement_id = _id AND m.status IN ('invited', 'active', 'declined');
  terms_ok := a.agreed_at IS NOT NULL;
  crew_ok := EXISTS (SELECT 1 FROM public.sa_members m WHERE m.agreement_id = _id AND m.member_role = 'lead' AND m.status = 'active' AND m.sla_accepted_at IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM public.sa_members m WHERE m.agreement_id = _id AND m.required AND (m.status IN ('invited', 'declined') OR (m.status = 'active' AND m.sla_accepted_at IS NULL)));
  nda_all := NOT nda_req OR NOT EXISTS (SELECT 1 FROM public.sa_members m WHERE m.agreement_id = _id AND m.status = 'active' AND (m.required OR m.member_role = 'lead')
                                          AND NOT public.sa_member_nda_ok(a.client_id, m.consultant_id));
  review_ok := a.admin_review IN ('not_needed', 'approved');
  sd := COALESCE(a.start_date, NULLIF(a.terms -> 'term' ->> 'start_date', '')::date);
  start_ok := sd IS NOT NULL AND sd <= current_date;
  RETURN jsonb_build_object('ready', terms_ok AND crew_ok AND nda_all AND review_ok AND start_ok,
    'items', jsonb_build_array(
      jsonb_build_object('key', 'terms', 'ok', terms_ok),
      jsonb_build_object('key', 'crew', 'ok', crew_ok),
      jsonb_build_object('key', 'nda', 'ok', nda_all, 'needed', nda_req),
      jsonb_build_object('key', 'admin_review', 'ok', review_ok, 'needed', a.admin_review <> 'not_needed'),
      jsonb_build_object('key', 'start_date', 'ok', start_ok, 'date', sd)),
    'members', members);
END $$;

-- Rate in force on a day (latest agreed record whose effective date has come).
CREATE OR REPLACE FUNCTION public.sa_rate_on(_id uuid, _day date)
RETURNS public.sa_rate_records LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM public.sa_rate_records r WHERE r.agreement_id = _id AND r.effective_from <= _day ORDER BY r.effective_from DESC, r.seq DESC LIMIT 1
$$;

-- New immutable terms version. The agreement's name and reference are written into the versioned terms (part of the
-- hash both sides accept); a terms change never renames the agreement.
CREATE OR REPLACE FUNCTION public.sa_new_version(_id uuid, _terms jsonb, _actor uuid, _note text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int; t jsonb;
BEGIN
  SELECT _terms || jsonb_build_object('name', a.name, 'reference', a.reference) INTO t FROM public.sa_agreements a WHERE a.id = _id;
  UPDATE public.sa_agreements SET terms = t, version = version + 1, updated_at = now() WHERE id = _id RETURNING version INTO v;
  INSERT INTO public.sa_versions (agreement_id, version, terms, content_hash, note, created_by) VALUES (_id, v, t, md5(t::text), left(COALESCE(_note, ''), 300), _actor);
  RETURN v;
END $$;

-- Merge an offer patch (rate / bank / term / capacity / crew keys only) into the terms.
CREATE OR REPLACE FUNCTION public.sa_apply_patch(_terms jsonb, _patch jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _terms
    || CASE WHEN _patch ? 'rate' THEN jsonb_build_object('rate', COALESCE(_terms -> 'rate', '{}'::jsonb) || (
         SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(_patch -> 'rate') e(k, v) WHERE k IN ('hourly_rate', 's1_multiplier', 'ooh_multiplier', 'overage_rate'))) ELSE '{}'::jsonb END
    || CASE WHEN _patch ? 'bank' THEN jsonb_build_object('bank', COALESCE(_terms -> 'bank', '{}'::jsonb) || (
         SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(_patch -> 'bank') e(k, v) WHERE k IN ('hours_per_month', 'rollover', 'rollover_hours', 'rollover_months', 'overage_rate'))) ELSE '{}'::jsonb END
    || CASE WHEN _patch ? 'term' THEN jsonb_build_object('term', COALESCE(_terms -> 'term', '{}'::jsonb) || (
         SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(_patch -> 'term') e(k, v) WHERE k IN ('start_date', 'end_date', 'notice_days'))) ELSE '{}'::jsonb END
    || CASE WHEN _patch ? 'capacity_hours_per_week' THEN jsonb_build_object('capacity_hours_per_week', _patch -> 'capacity_hours_per_week') ELSE '{}'::jsonb END
    || CASE WHEN jsonb_typeof(_patch -> 'team') = 'array' THEN jsonb_build_object('team', _patch -> 'team') ELSE '{}'::jsonb END
$$;

-- Draft terms as the database keeps them: SLA snapshot resolved on the server (never the browser's copy), crew and
-- company contacts checked, free text through the contact-details and secrets filters.
CREATE OR REPLACE FUNCTION public.sa_prepare_terms(_tenant uuid, _client uuid, _terms jsonb, _request jsonb, _lead uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t jsonb := COALESCE(_terms, '{}'::jsonb); probs text[]; txt text;
BEGIN
  txt := concat_ws(' ', t ->> 'name', t -> 'scope' ->> 'covered', t -> 'scope' ->> 'not_covered', _request ->> 'notes');
  IF NOT public.sa_text_ok(txt) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_secret_ok(txt) THEN RAISE EXCEPTION 'sa_secret_details' USING ERRCODE = '22023'; END IF;
  probs := public.sa_crew_problems(_tenant, _client, t -> 'team', _lead) || public.sa_contact_problems(_tenant, _client, t);
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_terms_invalid: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  RETURN t || jsonb_build_object('sla', public.sa_resolve_sla(_tenant, _client, t -> 'sla'));
END $$;

-- ------------------------------------------------------------------------------------------------ client: request
-- New draft (request details shown to applicants + the draft terms). Company owner/admin or own-account client.
-- The name is required and unique per client company; the reference number is assigned automatically.
CREATE OR REPLACE FUNCTION public.sa_create(_tenant uuid, _request jsonb, _terms jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); new_id uuid; nm text := left(btrim(COALESCE(_terms ->> 'name', '')), 120); t jsonb;
BEGIN
  IF NOT public.sa_enabled() THEN RAISE EXCEPTION 'sa_disabled' USING ERRCODE = '55000'; END IF;
  IF NOT public.sa_can_manage(uid, _tenant, CASE WHEN _tenant IS NULL THEN uid END) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_rate_ok('sa_create:' || uid, 20, 86400) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  IF char_length(nm) < 1 THEN RAISE EXCEPTION 'sa_terms_invalid: name' USING ERRCODE = '22023'; END IF;
  IF public.sa_name_taken(_tenant, uid, nm, NULL) THEN RAISE EXCEPTION 'sa_name_taken' USING ERRCODE = '23505'; END IF;
  t := public.sa_prepare_terms(_tenant, uid, _terms, _request, NULL);
  INSERT INTO public.sa_agreements (tenant_id, client_id, name, request, terms, created_by)
  VALUES (_tenant, uid, nm, COALESCE(_request, '{}'::jsonb), t || jsonb_build_object('name', nm), uid)
  RETURNING sa_agreements.id INTO new_id;
  UPDATE public.sa_agreements SET terms = terms || jsonb_build_object('reference', reference) WHERE id = new_id;
  PERFORM public.sa_event(new_id, 'created', uid);
  PERFORM public.sa_audit_log(uid, 'create', new_id);
  RETURN new_id;
END $$;

-- Save the draft at any time. The name can change only while the agreement is a Draft (unique per company).
CREATE OR REPLACE FUNCTION public.sa_save_draft(_id uuid, _request jsonb, _terms jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; nm text := left(btrim(COALESCE(_terms ->> 'name', '')), 120); t jsonb;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF a.id IS NULL OR public.sa_role(_id, uid) <> 'client' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF a.status NOT IN ('draft', 'open') THEN RAISE EXCEPTION 'sa_locked: terms change through offers once negotiation starts' USING ERRCODE = '55000'; END IF;
  IF nm = '' THEN nm := a.name; END IF;
  IF nm IS DISTINCT FROM a.name THEN
    IF a.status <> 'draft' THEN RAISE EXCEPTION 'sa_name_locked: the name can only change in Draft' USING ERRCODE = '55000'; END IF;
    IF public.sa_name_taken(a.tenant_id, a.client_id, nm, _id) THEN RAISE EXCEPTION 'sa_name_taken' USING ERRCODE = '23505'; END IF;
  END IF;
  t := public.sa_prepare_terms(a.tenant_id, a.client_id, COALESCE(_terms, a.terms), _request, NULL);
  UPDATE public.sa_agreements SET request = COALESCE(_request, request), terms = t || jsonb_build_object('name', nm, 'reference', a.reference),
         name = nm, updated_at = now() WHERE id = _id;
  PERFORM public.sa_audit_log(uid, 'save_draft', _id);
END $$;

-- Open for applications (all matched consultants, or only invited favourites).
CREATE OR REPLACE FUNCTION public.sa_publish(_id uuid, _deadline timestamptz, _invite_only boolean, _invite uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; probs text[]; c uuid; n int := 0;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF a.id IS NULL OR public.sa_role(_id, uid) <> 'client' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  probs := array_remove(array_remove(array_remove(public.sa_terms_problems(a.terms), 'rate_low'), 'rate_high'), 'currency');  -- rate comes from applications
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_terms_invalid: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  IF _deadline IS NOT NULL AND (_deadline < now() + interval '1 hour' OR _deadline > now() + interval '90 days') THEN RAISE EXCEPTION 'sa_bad_deadline' USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_agreements SET invite_only = COALESCE(_invite_only, false), deadline = _deadline WHERE id = _id;
  FOREACH c IN ARRAY COALESCE(_invite, '{}') LOOP
    INSERT INTO public.sa_invites (agreement_id, consultant_id) VALUES (_id, c) ON CONFLICT DO NOTHING;
    PERFORM public.sa_notify(_id, public.sa_user_of(c), 'Support agreement invitation', 'دعوة إلى اتفاقية دعم',
      'A client invites you to apply for a long-term support agreement: ' || a.name, 'يدعوك عميل إلى التقدّم لاتفاقية دعم طويلة الأمد: ' || a.name,
      'consultant', true, 'invite:' || _id || ':' || c);
    n := n + 1;
  END LOOP;
  PERFORM public.sa_set_status(_id, 'open', uid, jsonb_build_object('invited', n, 'invite_only', COALESCE(_invite_only, false)));
  RETURN jsonb_build_object('invited', n);
END $$;

-- ------------------------------------------------------------------------------------------------ consultant: opportunities + applications
CREATE OR REPLACE FUNCTION public.sa_opportunities()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF public.sa_consultant_of(uid) IS NULL THEN RETURN '[]'::jsonb; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'reference', a.reference, 'request', a.request - CASE WHEN COALESCE((a.request ->> 'show_budget')::boolean, false) THEN '' ELSE 'budget' END,
      'modules', to_jsonb(public.sa_modules(a)), 'model', a.terms ->> 'model', 'term', a.terms -> 'term', 'sla', (a.terms -> 'sla') - 'body', 'deadline', a.deadline,
      'invited', EXISTS (SELECT 1 FROM public.sa_invites i WHERE i.agreement_id = a.id AND i.consultant_id = public.sa_consultant_of(uid)),
      'applied', EXISTS (SELECT 1 FROM public.sa_applications p WHERE p.agreement_id = a.id AND p.consultant_id = public.sa_consultant_of(uid)),
      'role', public.sa_role(a.id, uid)) ORDER BY a.deadline NULLS LAST)
    FROM public.sa_agreements a WHERE a.status = 'open' AND public.sa_role(a.id, uid) IN ('candidate', 'applicant') AND (a.deadline IS NULL OR a.deadline > now())), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.sa_apply(_id uuid, _rate numeric, _currency text, _model text, _capacity numeric, _availability text, _sla_accepted boolean, _message text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; cid uuid := public.sa_consultant_of(uid); probs text[]; new_id uuid; s jsonb := public.sa_settings();
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF a.id IS NULL OR public.sa_role(_id, uid) NOT IN ('candidate', 'applicant') OR a.status <> 'open' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF a.deadline IS NOT NULL AND a.deadline < now() THEN RAISE EXCEPTION 'sa_deadline_passed' USING ERRCODE = '55000'; END IF;
  IF NOT public.sa_rate_ok('sa_apply:' || uid, COALESCE((s ->> 'application_limit_per_day')::int, 10), 86400) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  IF _sla_accepted IS NOT TRUE THEN RAISE EXCEPTION 'sa_sla_acceptance_required' USING ERRCODE = '22023'; END IF;
  IF NOT (COALESCE(s -> 'models_enabled', '[]'::jsonb) ? _model) THEN RAISE EXCEPTION 'sa_model_disabled' USING ERRCODE = '22023'; END IF;
  IF COALESCE(_currency, '') !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'sa_bad_currency' USING ERRCODE = '22023'; END IF;
  probs := public.sa_rate_problems(_rate, NULL, NULL, NULL, public.sa_modules(a));
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_rate_out_of_bounds: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_text_ok(concat_ws(' ', _message, _availability)) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sa_applications (agreement_id, consultant_id, user_id, hourly_rate, currency, model, capacity_hours_per_week, availability_note, sla_accepted_at, sla_summary, message)
  VALUES (_id, cid, uid, round(_rate, 2), _currency, _model, _capacity, left(COALESCE(_availability, ''), 500), now(), COALESCE(a.terms -> 'sla' ->> 'summary', ''), left(COALESCE(_message, ''), 2000))
  ON CONFLICT (agreement_id, consultant_id) DO UPDATE SET hourly_rate = EXCLUDED.hourly_rate, currency = EXCLUDED.currency, model = EXCLUDED.model,
    capacity_hours_per_week = EXCLUDED.capacity_hours_per_week, availability_note = EXCLUDED.availability_note, sla_accepted_at = now(), message = EXCLUDED.message,
    status = CASE WHEN sa_applications.status IN ('withdrawn', 'declined') THEN 'pending' ELSE sa_applications.status END, updated_at = now()
  RETURNING sa_applications.id INTO new_id;
  PERFORM public.sa_event(_id, 'applied', uid);
  PERFORM public.sa_notify(_id, a.client_id, 'New application: ' || a.name, 'طلب جديد: ' || a.name, 'A consultant applied for your support agreement.',
    'تقدّم استشاري لاتفاقية الدعم الخاصة بك.', 'client', false, 'applied:' || new_id || ':' || extract(epoch FROM now())::bigint / 3600);
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.sa_withdraw_application(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  UPDATE public.sa_applications SET status = 'withdrawn', updated_at = now()
   WHERE agreement_id = _id AND consultant_id = public.sa_consultant_of(uid) AND status IN ('pending', 'shortlisted');
  IF NOT FOUND THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.sa_event(_id, 'application_withdrawn', uid);
END $$;

-- Client picks an application -> negotiating with that consultant; the proposed rate/model become the terms (v1).
CREATE OR REPLACE FUNCTION public.sa_select_application(_application uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sa_applications; a public.sa_agreements; t jsonb; v int;
BEGIN
  SELECT * INTO p FROM public.sa_applications WHERE id = _application FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = p.agreement_id FOR UPDATE;
  IF public.sa_role(a.id, uid) <> 'client' OR a.status <> 'open' OR p.status NOT IN ('pending', 'shortlisted') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  t := a.terms || jsonb_build_object('model', p.model,
         'rate', COALESCE(a.terms -> 'rate', '{}'::jsonb) || jsonb_build_object('hourly_rate', p.hourly_rate, 'currency', p.currency),
         'capacity_hours_per_week', COALESCE(to_jsonb(p.capacity_hours_per_week), a.terms -> 'capacity_hours_per_week'),
         -- the selected consultant becomes the lead; the crew the client planned stays (without the new lead)
         'team', jsonb_build_array(jsonb_build_object('consultant_id', p.consultant_id, 'role', 'lead', 'required', true, 'capacity_hours_per_week', p.capacity_hours_per_week))
                 || COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(a.terms -> 'team', '[]'::jsonb)) e
                               WHERE e ->> 'consultant_id' <> p.consultant_id::text AND COALESCE(e ->> 'role', '') <> 'lead'), '[]'::jsonb));
  UPDATE public.sa_agreements SET consultant_id = p.consultant_id, application_id = p.id WHERE id = a.id;
  UPDATE public.sa_applications SET status = 'selected', updated_at = now() WHERE id = p.id;
  PERFORM public.sa_set_status(a.id, 'negotiating', uid, jsonb_build_object('application', p.id));
  v := public.sa_new_version(a.id, t, uid, 'Application selected');
  PERFORM public.sa_notify(a.id, p.user_id, 'You were selected: ' || a.name, 'تم اختيارك: ' || a.name,
    'The client chose your application. Review the terms, counter if needed, and accept.', 'اختار العميل طلبك. راجع الشروط وقدّم عرضاً مقابلاً عند الحاجة ثم اقبل.',
    'consultant', true, 'selected:' || p.id);
  RETURN v;
END $$;

-- Back to applications (e.g. negotiation failed): the selected application is declined, nothing was agreed.
CREATE OR REPLACE FUNCTION public.sa_reopen(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF public.sa_role(_id, uid) NOT IN ('client', 'lead') OR a.status <> 'negotiating' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sa_applications SET status = 'declined', updated_at = now() WHERE id = a.application_id;
  UPDATE public.sa_offers SET status = 'superseded' WHERE agreement_id = _id AND status = 'open';
  UPDATE public.sa_agreements SET consultant_id = NULL, application_id = NULL WHERE id = _id;
  PERFORM public.sa_set_status(_id, 'open', uid, jsonb_build_object('reason', left(_reason, 300)));
END $$;

-- ------------------------------------------------------------------------------------------------ negotiation
CREATE OR REPLACE FUNCTION public.sa_offer(_id uuid, _patch jsonb, _note text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; r text := public.sa_role(_id, uid); probs text[]; new_id uuid;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF r NOT IN ('client', 'lead') OR a.status <> 'negotiating' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_rate_ok('sa_offer:' || uid, 20, 86400) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  IF NOT public.sa_text_ok(_note) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  probs := public.sa_terms_problems(public.sa_apply_patch(a.terms, _patch));
  IF _patch ? 'team' THEN   -- the crew is composed by the client; the lead must stay in it
    IF r <> 'client' THEN RAISE EXCEPTION 'sa_forbidden: only the client changes the crew' USING ERRCODE = '42501'; END IF;
    probs := probs || public.sa_crew_problems(a.tenant_id, a.client_id, _patch -> 'team', a.consultant_id);
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_patch -> 'team') e WHERE e ->> 'consultant_id' = a.consultant_id::text AND e ->> 'role' = 'lead') THEN
      probs := array_append(probs, 'crew_lead_missing');
    END IF;
  END IF;
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_terms_invalid: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_offers SET status = 'superseded' WHERE agreement_id = _id AND status = 'open';
  INSERT INTO public.sa_offers (agreement_id, by_role, by_user, patch, note) VALUES (_id, public.sa_party(r), uid, _patch, left(COALESCE(_note, ''), 1000))
  RETURNING sa_offers.id INTO new_id;
  PERFORM public.sa_event(_id, 'offer', uid, jsonb_build_object('patch', _patch));
  PERFORM public.sa_audit_log(uid, 'counter', _id, jsonb_build_object('patch', _patch));
  IF r = 'client' THEN
    PERFORM public.sa_notify(_id, public.sa_user_of(a.consultant_id), 'Counter-offer: ' || a.name, 'عرض مقابل: ' || a.name,
      'The client proposes different terms. Please accept or counter.', 'يقترح العميل شروطاً مختلفة. يرجى القبول أو تقديم عرض مقابل.', 'consultant', true, 'offer:' || new_id);
  ELSE
    PERFORM public.sa_notify(_id, a.client_id, 'Counter-offer: ' || a.name, 'عرض مقابل: ' || a.name,
      'The consultant proposes different terms. Please accept or counter.', 'يقترح الاستشاري شروطاً مختلفة. يرجى القبول أو تقديم عرض مقابل.', 'client', true, 'offer:' || new_id);
  END IF;
  RETURN new_id;
END $$;

-- Only the OTHER party may accept or decline an offer; acceptance creates a new terms version (acceptances reset).
CREATE OR REPLACE FUNCTION public.sa_respond_offer(_offer uuid, _accept boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); o public.sa_offers; a public.sa_agreements; r text; v int;
BEGIN
  SELECT * INTO o FROM public.sa_offers WHERE id = _offer FOR UPDATE;
  IF o.id IS NULL OR o.status <> 'open' THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = o.agreement_id FOR UPDATE;
  r := public.sa_role(a.id, uid);
  IF a.status <> 'negotiating' OR r NOT IN ('client', 'lead') OR public.sa_party(r) = o.by_role THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sa_offers SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END, responded_by = uid, responded_at = now() WHERE id = _offer;
  IF _accept THEN
    v := public.sa_new_version(a.id, public.sa_apply_patch(a.terms, o.patch), uid, 'Offer accepted');
  END IF;
  PERFORM public.sa_event(a.id, CASE WHEN _accept THEN 'offer_accepted' ELSE 'offer_declined' END, uid);
  RETURN COALESCE(v, a.version);
END $$;

-- Electronic acceptance of one terms version (checkbox + typed name + timestamp + content hash). When both parties
-- accepted the same version the agreement is Agreed: immutable agreed rate record, other applications declined.
CREATE OR REPLACE FUNCTION public.sa_accept_terms(_id uuid, _version integer, _hash text, _typed_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; r text := public.sa_role(_id, uid); v public.sa_versions; probs text[]; first_pair boolean; rid uuid; s jsonb := public.sa_settings(); e jsonb;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF r NOT IN ('client', 'lead') OR a.status <> 'negotiating' THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.sa_versions WHERE agreement_id = _id AND version = a.version;
  IF v.version IS NULL OR _version <> a.version OR _hash IS DISTINCT FROM v.content_hash THEN
    RAISE EXCEPTION 'sa_version_changed: the terms changed, please review version %', a.version USING ERRCODE = '40001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sa_offers o WHERE o.agreement_id = _id AND o.status = 'open') THEN RAISE EXCEPTION 'sa_open_offer: answer the open offer first' USING ERRCODE = '55000'; END IF;
  probs := public.sa_terms_problems(a.terms);
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_terms_invalid: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  IF char_length(btrim(COALESCE(_typed_name, ''))) < 2 OR NOT public.sa_text_ok(_typed_name) THEN RAISE EXCEPTION 'sa_name_required' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sa_acceptances (agreement_id, version, content_hash, party, user_id, typed_name, legal_draft)
  VALUES (_id, a.version, v.content_hash, public.sa_party(r), uid, left(btrim(_typed_name), 120), COALESCE((s ->> 'draft_legal_flag')::boolean, true))
  ON CONFLICT (agreement_id, version, party) DO NOTHING;
  PERFORM public.sa_event(_id, 'accepted', uid, jsonb_build_object('version', a.version, 'party', public.sa_party(r)));
  PERFORM public.sa_audit_log(uid, 'accept', _id, jsonb_build_object('version', a.version, 'hash', v.content_hash));
  IF (SELECT count(DISTINCT party) FROM public.sa_acceptances x WHERE x.agreement_id = _id AND x.version = a.version) < 2 THEN
    RETURN jsonb_build_object('agreed', false, 'waiting_for', CASE WHEN public.sa_party(r) = 'client' THEN 'consultant' ELSE 'client' END);
  END IF;
  first_pair := NOT EXISTS (SELECT 1 FROM public.sa_agreements o WHERE o.id <> _id AND o.consultant_id = a.consultant_id AND o.agreed_at IS NOT NULL
                              AND ((a.tenant_id IS NOT NULL AND o.tenant_id = a.tenant_id) OR o.client_id = a.client_id));
  INSERT INTO public.sa_rate_records (agreement_id, seq, hourly_rate, currency, s1_multiplier, ooh_multiplier, overage_rate, effective_from, proposed_by, proposed_role, accepted_by, source, terms_version)
  VALUES (_id, 1, (a.terms -> 'rate' ->> 'hourly_rate')::numeric, a.terms -> 'rate' ->> 'currency', NULLIF(a.terms -> 'rate' ->> 's1_multiplier', '')::numeric,
          NULLIF(a.terms -> 'rate' ->> 'ooh_multiplier', '')::numeric, NULLIF(a.terms -> 'rate' ->> 'overage_rate', '')::numeric,
          (a.terms -> 'term' ->> 'start_date')::date, (SELECT p.user_id FROM public.sa_applications p WHERE p.id = a.application_id), 'consultant', uid, 'negotiation', a.version)
  RETURNING id INTO rid;
  UPDATE public.sa_agreements SET agreed_at = now(), current_rate_id = rid, start_date = (terms -> 'term' ->> 'start_date')::date,
         end_date = NULLIF(terms -> 'term' ->> 'end_date', '')::date,
         admin_review = CASE WHEN COALESCE((s ->> 'needs_admin_review')::boolean, true) AND first_pair THEN 'pending' ELSE 'not_needed' END
   WHERE id = _id;
  -- Crew: the lead's place and SLA acceptance come from the terms acceptance (+ the SLA box ticked when applying);
  -- every other crew member is invited and must accept the place and the SLA snapshot.
  INSERT INTO public.sa_members (agreement_id, consultant_id, member_role, status, required, capacity_hours_per_week, working_hours, invited_by,
                                 accepted_at, sla_policy_id, sla_version, sla_hash, sla_accepted_at)
  SELECT _id, a.consultant_id, 'lead', 'active', true, NULLIF(q.le ->> 'capacity_hours_per_week', '')::numeric, COALESCE(q.le -> 'working_hours', '{}'::jsonb), a.client_id,
         now(), NULLIF(a.terms -> 'sla' ->> 'policy_id', '')::uuid, NULLIF(a.terms -> 'sla' ->> 'version', '')::int, a.terms -> 'sla' ->> 'hash',
         COALESCE((SELECT p.sla_accepted_at FROM public.sa_applications p WHERE p.id = a.application_id), now())
    FROM (SELECT (SELECT e FROM jsonb_array_elements(COALESCE(a.terms -> 'team', '[]'::jsonb)) e WHERE e ->> 'consultant_id' = a.consultant_id::text LIMIT 1) AS le) q
  ON CONFLICT DO NOTHING;
  INSERT INTO public.sa_member_acceptances (agreement_id, consultant_id, user_id, member_role, terms_version, terms_hash, sla_policy_id, sla_version, sla_hash, sla_summary, typed_name, legal_draft)
  SELECT _id, a.consultant_id, x.user_id, 'lead', a.version, x.content_hash, NULLIF(a.terms -> 'sla' ->> 'policy_id', '')::uuid, NULLIF(a.terms -> 'sla' ->> 'version', '')::int,
         a.terms -> 'sla' ->> 'hash', COALESCE(a.terms -> 'sla' ->> 'summary', ''), x.typed_name, x.legal_draft
    FROM public.sa_acceptances x WHERE x.agreement_id = _id AND x.version = a.version AND x.party = 'consultant';
  FOR e IN SELECT jsonb_array_elements(COALESCE(a.terms -> 'team', '[]'::jsonb)) LOOP
    CONTINUE WHEN e ->> 'consultant_id' = a.consultant_id::text;
    INSERT INTO public.sa_members (agreement_id, consultant_id, member_role, status, required, capacity_hours_per_week, working_hours, backup_for, invited_by)
    VALUES (_id, (e ->> 'consultant_id')::uuid, e ->> 'role', 'invited', COALESCE((e ->> 'required')::boolean, true), NULLIF(e ->> 'capacity_hours_per_week', '')::numeric,
            COALESCE(e -> 'working_hours', '{}'::jsonb), NULLIF(e ->> 'backup_for', '')::uuid, a.client_id)
    ON CONFLICT DO NOTHING;
    PERFORM public.sa_notify_member_invite(_id, (e ->> 'consultant_id')::uuid);
  END LOOP;
  UPDATE public.sa_applications SET status = 'declined', updated_at = now() WHERE agreement_id = _id AND id <> a.application_id AND status IN ('pending', 'shortlisted');
  PERFORM public.sa_set_status(_id, 'agreed', uid, jsonb_build_object('version', a.version, 'rate_record', rid));
  PERFORM public.sa_notify_parties(_id, 'Support agreement agreed: ' || a.name, 'تم الاتفاق على اتفاقية الدعم: ' || a.name,
    'Both parties accepted version ' || a.version || '. It starts when the crew is confirmed: every required member accepted the place and the SLA, the NDA is signed by both sides and the start date has come'
      || CASE WHEN first_pair AND COALESCE((s ->> 'needs_admin_review')::boolean, true) THEN ', after our team has reviewed it.' ELSE '.' END,
    'قبل الطرفان الإصدار ' || a.version || '. تبدأ عند تأكيد الفريق: قبول كل عضو مطلوب لمكانه ولاتفاقية مستوى الخدمة، وتوقيع اتفاقية عدم الإفصاح من الطرفين، وحلول تاريخ البدء.', true, 'agreed:' || _id);
  IF first_pair AND COALESCE((s ->> 'needs_admin_review')::boolean, true) THEN
    PERFORM public.sa_notify_admins(_id, 'Support agreement to review', a.name || ' needs an admin review before it starts.', 'review:' || _id);
  END IF;
  PERFORM public.sa_try_activate(_id);
  RETURN jsonb_build_object('agreed', true, 'admin_review', first_pair AND COALESCE((s ->> 'needs_admin_review')::boolean, true));
END $$;

CREATE OR REPLACE FUNCTION public.sa_notify_member_invite(_id uuid, _consultant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm text := (SELECT a.name FROM public.sa_agreements a WHERE a.id = _id);
BEGIN
  PERFORM public.sa_notify(_id, public.sa_user_of(_consultant), 'Join a support crew: ' || nm, 'الانضمام إلى فريق دعم: ' || nm,
    'A client invites you to the crew of a long-term support agreement at the agreed rate. Review your role, capacity and the SLA, then accept or decline.',
    'يدعوك عميل إلى فريق اتفاقية دعم طويلة الأمد بالسعر المتفق عليه. راجع دورك وساعاتك واتفاقية مستوى الخدمة ثم اقبل أو اعتذر.',
    'consultant', true, 'member:' || _id || ':' || _consultant || ':' || extract(epoch FROM now())::bigint / 86400);
END $$;

-- Agreed -> Active only when the team confirmation checklist is complete (sa_confirmation). From that moment the
-- agreement's SLA snapshot applies to new tickets under the agreement ("SLA starts when the crew is confirmed").
CREATE OR REPLACE FUNCTION public.sa_try_activate(_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF a.status <> 'agreed' OR NOT COALESCE((public.sa_confirmation(_id) ->> 'ready')::boolean, false) THEN RETURN false; END IF;
  UPDATE public.sa_agreements SET started_at = now(), last_activity_at = now() WHERE id = _id;
  PERFORM public.sa_set_status(_id, 'active', NULL);
  PERFORM public.sa_notify_parties(_id, 'Support agreement active: ' || a.name, 'اتفاقية الدعم نشطة: ' || a.name,
    'The crew is confirmed. From today new tickets under this agreement go directly to the committed consultant at the agreed rate, and the agreement SLA applies.',
    'تم تأكيد الفريق. من اليوم تذهب التذاكر الجديدة ضمن هذه الاتفاقية مباشرة إلى الاستشاري الملتزم بالسعر المتفق عليه، وتسري اتفاقية مستوى الخدمة الخاصة بالاتفاقية.', true, 'active:' || _id);
  RETURN true;
END $$;

-- ------------------------------------------------------------------------------------------------ rate changes (annual review)
CREATE OR REPLACE FUNCTION public.sa_propose_rate_change(_id uuid, _rate numeric, _s1 numeric, _ooh numeric, _overage numeric, _effective date, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; r text := public.sa_role(_id, uid); probs text[]; new_id uuid;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF r NOT IN ('client', 'lead') OR a.status NOT IN ('agreed', 'active', 'suspended', 'renewal_due') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF _effective IS NULL OR _effective <= current_date THEN RAISE EXCEPTION 'sa_not_retroactive: the effective date must be in the future' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_text_ok(_reason) OR char_length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'sa_reason_required' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_rate_ok('sa_ratechange:' || uid, 5, 86400) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  probs := public.sa_rate_problems(_rate, _s1, _ooh, _overage, public.sa_modules(a));
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'sa_rate_out_of_bounds: %', array_to_string(probs, ',') USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sa_rate_changes (agreement_id, proposed_by, proposed_role, hourly_rate, s1_multiplier, ooh_multiplier, overage_rate, effective_from, reason)
  VALUES (_id, uid, public.sa_party(r), round(_rate, 2), _s1, _ooh, _overage, _effective, left(_reason, 500)) RETURNING sa_rate_changes.id INTO new_id;
  PERFORM public.sa_event(_id, 'rate_change_proposed', uid, jsonb_build_object('effective_from', _effective));
  PERFORM public.sa_audit_log(uid, 'rate_change_proposed', _id, jsonb_build_object('rate', _rate, 'effective_from', _effective));
  PERFORM public.sa_notify_parties(_id, 'Rate change proposed: ' || a.name, 'اقتراح تغيير السعر: ' || a.name,
    'A new hourly rate from ' || _effective || ' was proposed. The other party must approve it.', 'اقتُرح سعر جديد اعتباراً من ' || _effective || '. يجب أن يوافق الطرف الآخر.', true, 'ratechange:' || new_id);
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.sa_decide_rate_change(_change uuid, _accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); c public.sa_rate_changes; a public.sa_agreements; r text; rid uuid; prev uuid;
BEGIN
  SELECT * INTO c FROM public.sa_rate_changes WHERE id = _change FOR UPDATE;
  IF c.id IS NULL OR c.status <> 'pending' THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  r := public.sa_role(c.agreement_id, uid);
  IF r NOT IN ('client', 'lead') OR public.sa_party(r) = c.proposed_role THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF _accept AND c.effective_from <= current_date THEN RAISE EXCEPTION 'sa_not_retroactive: propose a new effective date' USING ERRCODE = '22023'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = c.agreement_id;
  IF _accept THEN
    SELECT id INTO prev FROM public.sa_rate_records WHERE agreement_id = a.id ORDER BY seq DESC LIMIT 1;
    INSERT INTO public.sa_rate_records (agreement_id, seq, hourly_rate, currency, s1_multiplier, ooh_multiplier, overage_rate, effective_from, proposed_by, proposed_role, accepted_by, source, previous_id)
    VALUES (a.id, (SELECT COALESCE(max(seq), 0) + 1 FROM public.sa_rate_records WHERE agreement_id = a.id), c.hourly_rate, a.terms -> 'rate' ->> 'currency',
            c.s1_multiplier, c.ooh_multiplier, c.overage_rate, c.effective_from, c.proposed_by, c.proposed_role, uid, 'rate_change', prev)
    RETURNING id INTO rid;
  END IF;
  UPDATE public.sa_rate_changes SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END, decided_by = uid, decided_at = now(), rate_record_id = rid WHERE id = _change;
  PERFORM public.sa_event(a.id, CASE WHEN _accept THEN 'rate_change_accepted' ELSE 'rate_change_declined' END, uid, jsonb_build_object('effective_from', c.effective_from));
  PERFORM public.sa_audit_log(uid, CASE WHEN _accept THEN 'rate_change_accepted' ELSE 'rate_change_declined' END, a.id, jsonb_build_object('change', _change));
END $$;

-- ------------------------------------------------------------------------------------------------ lifecycle actions
CREATE OR REPLACE FUNCTION public.sa_request_termination(_id uuid, _reason text)
RETURNS date LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; r text := public.sa_role(_id, uid); e date; s jsonb := public.sa_settings();
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF r NOT IN ('client', 'lead', 'admin') OR a.status NOT IN ('agreed', 'active', 'suspended', 'renewal_due') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF a.termination_end IS NOT NULL THEN RAISE EXCEPTION 'sa_already_terminating' USING ERRCODE = '55000'; END IF;
  IF char_length(btrim(COALESCE(_reason, ''))) < 10 OR NOT public.sa_text_ok(_reason) THEN RAISE EXCEPTION 'sa_reason_required' USING ERRCODE = '22023'; END IF;
  e := CASE WHEN a.status = 'agreed' THEN current_date ELSE LEAST(current_date + COALESCE((a.terms -> 'term' ->> 'notice_days')::int, 30), COALESCE(a.end_date, 'infinity'::date)) END;
  UPDATE public.sa_agreements SET termination_requested_by = CASE WHEN r = 'lead' THEN 'consultant' ELSE r END, termination_reason = left(_reason, 1000),
         termination_requested_at = now(), termination_end = e, handover_until = e + COALESCE((s ->> 'handover_days')::int, 14) WHERE id = _id;
  PERFORM public.sa_event(_id, 'termination_requested', uid, jsonb_build_object('end', e, 'by', CASE WHEN r = 'lead' THEN 'consultant' ELSE r END));
  PERFORM public.sa_audit_log(uid, 'terminate', _id, jsonb_build_object('end', e, 'reason', left(_reason, 300)));
  IF a.status = 'agreed' THEN PERFORM public.sa_set_status(_id, 'terminated', uid, jsonb_build_object('before_start', true)); END IF;
  PERFORM public.sa_notify_parties(_id, 'Support agreement ending: ' || a.name, 'انتهاء اتفاقية الدعم: ' || a.name,
    'Termination was requested. The last day is ' || e || ' (notice period). A handover note follows.', 'طُلب إنهاء الاتفاقية. آخر يوم هو ' || e || ' (فترة الإشعار). ستتبعها ملاحظة تسليم.', true, 'terminate:' || _id);
  RETURN e;
END $$;

CREATE OR REPLACE FUNCTION public.sa_handover_note(_id uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF public.sa_role(_id, uid) NOT IN ('lead', 'admin') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_text_ok(_note) OR char_length(btrim(COALESCE(_note, ''))) < 10 THEN RAISE EXCEPTION 'sa_note_required' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_secret_ok(_note) THEN RAISE EXCEPTION 'sa_secret_details' USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_agreements SET handover_note = left(_note, 4000) WHERE id = _id AND termination_end IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'sa_not_terminating' USING ERRCODE = '55000'; END IF;
  PERFORM public.sa_event(_id, 'handover_note', uid);
END $$;

CREATE OR REPLACE FUNCTION public.sa_suspend(_id uuid, _until date, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF public.sa_role(_id, uid) NOT IN ('client', 'lead', 'admin') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF _until IS NULL OR _until <= current_date OR _until > current_date + 120 THEN RAISE EXCEPTION 'sa_bad_date' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_text_ok(_reason) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  UPDATE public.sa_agreements SET suspended_until = _until WHERE id = _id;
  PERFORM public.sa_set_status(_id, 'suspended', uid, jsonb_build_object('until', _until, 'reason', left(_reason, 300)));
  PERFORM public.sa_notify_parties(_id, 'Support agreement paused: ' || a.name, 'إيقاف مؤقت لاتفاقية الدعم: ' || a.name,
    'Paused until ' || _until || '.', 'متوقفة حتى ' || _until || '.', true, 'suspend:' || _id || ':' || _until);
END $$;

CREATE OR REPLACE FUNCTION public.sa_resume(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF public.sa_role(_id, uid) NOT IN ('client', 'lead', 'admin') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sa_agreements SET suspended_until = NULL WHERE id = _id;
  PERFORM public.sa_set_status(_id, 'active', uid);
END $$;

-- Auto-renew needs the explicit consent of BOTH parties; either can withdraw it before the end date.
CREATE OR REPLACE FUNCTION public.sa_set_auto_renew(_id uuid, _on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.sa_role(_id, uid); a public.sa_agreements;
BEGIN
  IF r NOT IN ('client', 'lead') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF r = 'client' THEN UPDATE public.sa_agreements SET auto_renew_client_at = CASE WHEN _on THEN now() END WHERE id = _id RETURNING * INTO a;
  ELSE UPDATE public.sa_agreements SET auto_renew_consultant_at = CASE WHEN _on THEN now() END WHERE id = _id RETURNING * INTO a; END IF;
  PERFORM public.sa_event(_id, CASE WHEN _on THEN 'auto_renew_on' ELSE 'auto_renew_off' END, uid);
  RETURN jsonb_build_object('client', a.auto_renew_client_at IS NOT NULL, 'consultant', a.auto_renew_consultant_at IS NOT NULL);
END $$;

-- Team: client invites another consultant at the agreed rate; the consultant accepts or declines.
CREATE OR REPLACE FUNCTION public.sa_invite_member(_id uuid, _consultant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF public.sa_role(_id, uid) <> 'client' OR a.status NOT IN ('agreed', 'active', 'renewal_due') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF _consultant = a.consultant_id OR (SELECT count(*) FROM public.sa_members m WHERE m.agreement_id = _id AND m.status IN ('invited', 'active')) >= 5 THEN
    RAISE EXCEPTION 'sa_team_full' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.sa_members (agreement_id, consultant_id, member_role, status) VALUES (_id, _consultant, 'support', 'invited');
  PERFORM public.sa_event(_id, 'member_invited', uid);
  PERFORM public.sa_notify(_id, public.sa_user_of(_consultant), 'Join a support agreement team', 'الانضمام إلى فريق اتفاقية دعم',
    'You are invited to support ' || a.name || ' at the agreed rate.', 'أنت مدعو لدعم ' || a.name || ' بالسعر المتفق عليه.', 'consultant', true, 'member:' || _id || ':' || _consultant);
END $$;

CREATE OR REPLACE FUNCTION public.sa_member_respond(_id uuid, _accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  UPDATE public.sa_members SET status = CASE WHEN _accept THEN 'active' ELSE 'declined' END
   WHERE agreement_id = _id AND consultant_id = public.sa_consultant_of(uid) AND status = 'invited';
  IF NOT FOUND THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.sa_event(_id, CASE WHEN _accept THEN 'member_joined' ELSE 'member_declined' END, uid);
END $$;

-- Replacing the lead mid-term: client asks -> admin approves -> new consultant accepts; the rate is kept.
CREATE OR REPLACE FUNCTION public.sa_request_replacement(_id uuid, _to uuid, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements; new_id uuid;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF public.sa_role(_id, uid) <> 'client' OR a.status NOT IN ('active', 'suspended', 'renewal_due') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_text_ok(_reason) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sa_replacements (agreement_id, from_consultant, to_consultant, reason, requested_by) VALUES (_id, a.consultant_id, _to, left(_reason, 1000), uid)
  RETURNING sa_replacements.id INTO new_id;
  PERFORM public.sa_event(_id, 'replacement_requested', uid);
  PERFORM public.sa_notify_admins(_id, 'Consultant replacement requested', a.name || ': the client asks to replace the lead consultant.', 'replace:' || new_id);
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION public.sa_admin_decide_replacement(_replacement uuid, _approve boolean, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); x public.sa_replacements;
BEGIN
  IF NOT public.sa_is_admin(uid) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO x FROM public.sa_replacements WHERE id = _replacement AND status = 'pending_admin' FOR UPDATE;
  IF x.id IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.sa_replacements SET status = CASE WHEN _approve THEN 'pending_consultant' ELSE 'declined' END, admin_by = uid, admin_at = now() WHERE id = _replacement;
  PERFORM public.sa_audit_log(uid, 'replacement_admin', x.agreement_id, jsonb_build_object('approve', _approve, 'note', left(_note, 300)));
  IF _approve THEN
    PERFORM public.sa_notify(x.agreement_id, public.sa_user_of(x.to_consultant), 'Take over a support agreement', 'تولّي اتفاقية دعم',
      'You are asked to take over a support agreement at the agreed rate.', 'يُطلب منك تولّي اتفاقية دعم بالسعر المتفق عليه.', 'consultant', true, 'takeover:' || x.id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.sa_replacement_accept(_replacement uuid, _accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); x public.sa_replacements;
BEGIN
  SELECT * INTO x FROM public.sa_replacements WHERE id = _replacement AND status = 'pending_consultant' FOR UPDATE;
  IF x.id IS NULL OR x.to_consultant <> public.sa_consultant_of(uid) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sa_replacements SET status = CASE WHEN _accept THEN 'done' ELSE 'declined' END, done_at = now() WHERE id = _replacement;
  IF _accept THEN
    UPDATE public.sa_members SET status = 'ended', ended_at = now() WHERE agreement_id = x.agreement_id AND consultant_id = x.from_consultant AND status = 'active';
    UPDATE public.sa_members SET member_role = 'lead', status = 'active', accepted_at = COALESCE(accepted_at, now())
     WHERE agreement_id = x.agreement_id AND consultant_id = x.to_consultant AND status IN ('invited', 'active', 'declined');
    IF NOT FOUND THEN
      INSERT INTO public.sa_members (agreement_id, consultant_id, member_role, status, accepted_at) VALUES (x.agreement_id, x.to_consultant, 'lead', 'active', now());
    END IF;
    UPDATE public.sa_agreements SET consultant_id = x.to_consultant WHERE id = x.agreement_id;
    PERFORM public.sa_event(x.agreement_id, 'lead_replaced', uid);
    PERFORM public.sa_audit_log(uid, 'lead_replaced', x.agreement_id, jsonb_build_object('from', x.from_consultant, 'to', x.to_consultant));
  END IF;
END $$;

-- Q&A between the client and one applicant / the parties (contact-details filter M60).
CREATE OR REPLACE FUNCTION public.sa_post_message(_id uuid, _consultant uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.sa_role(_id, uid); cid uuid; new_id uuid; a public.sa_agreements;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  IF r IN ('candidate', 'applicant', 'lead', 'team') THEN cid := public.sa_consultant_of(uid);
  ELSIF r = 'client' THEN cid := _consultant;
  ELSE RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF cid IS NULL THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sa_text_ok(_body) THEN RAISE EXCEPTION 'sa_contact_details' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_secret_ok(_body) THEN RAISE EXCEPTION 'sa_secret_details' USING ERRCODE = '22023'; END IF;
  IF NOT public.sa_rate_ok('sa_msg:' || uid, 60, 3600) THEN RAISE EXCEPTION 'sa_rate_limited' USING ERRCODE = '53400'; END IF;
  INSERT INTO public.sa_messages (agreement_id, consultant_id, sender_id, sender_role, body)
  VALUES (_id, cid, uid, CASE WHEN r = 'client' THEN 'client' ELSE 'consultant' END, left(btrim(_body), 2000)) RETURNING sa_messages.id INTO new_id;
  IF r = 'client' THEN
    PERFORM public.sa_notify(_id, public.sa_user_of(cid), 'New message: ' || a.name, 'رسالة جديدة: ' || a.name, 'The client replied about the support agreement.', 'ردّ العميل بخصوص اتفاقية الدعم.', 'consultant', false, 'msg:' || new_id);
  ELSE
    PERFORM public.sa_notify(_id, a.client_id, 'New question: ' || a.name, 'سؤال جديد: ' || a.name, 'A consultant wrote about your support agreement.', 'كتب استشاري بخصوص اتفاقية الدعم.', 'client', false, 'msg:' || new_id);
  END IF;
  RETURN new_id;
END $$;

-- ------------------------------------------------------------------------------------------------ tickets under an agreement
CREATE OR REPLACE FUNCTION public.sa_ticket_live_agreement(_ticket uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT st.agreement_id FROM public.sa_tickets st JOIN public.sa_agreements a ON a.id = st.agreement_id WHERE st.ticket_id = _ticket LIMIT 1
$$;

-- SLA hook used by sla_effective_policy (docs/sql/sla-policies.sql): the policy version attached to the agreement.
CREATE OR REPLACE FUNCTION public.sa_ticket_sla(_ticket uuid)
RETURNS TABLE (policy_id uuid, version integer) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NULLIF(a.terms -> 'sla' ->> 'policy_id', '')::uuid, NULLIF(a.terms -> 'sla' ->> 'version', '')::int
    FROM public.sa_tickets st JOIN public.sa_agreements a ON a.id = st.agreement_id
   WHERE st.ticket_id = _ticket AND NULLIF(a.terms -> 'sla' ->> 'policy_id', '') IS NOT NULL LIMIT 1
$$;

-- Links a ticket to a live agreement of the same client / company whose scope covers the module: approved agreement
-- rate (S1 multiplier for critical tickets) and a direct assignment request to the lead consultant (no bidding).
-- Returns false (and changes nothing) when the agreement does not apply. Never raises.
CREATE OR REPLACE FUNCTION public.sa_link_ticket(_ticket uuid, _agreement uuid, _actor uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; a public.sa_agreements; rr public.sa_rate_records; rate numeric;
BEGIN
  IF NOT public.sa_enabled() OR _agreement IS NULL THEN RETURN false; END IF;
  SELECT tk.id, tk.client_id, tk.tenant_id, tk.sap_module, tk.sap_modules, tk.critical_response, tk.urgency::text AS urgency INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  IF t.id IS NULL OR EXISTS (SELECT 1 FROM public.sa_tickets x WHERE x.ticket_id = _ticket) THEN RETURN false; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = _agreement;
  IF a.id IS NULL OR a.status NOT IN ('active', 'renewal_due') OR a.termination_end < current_date THEN RETURN false; END IF;
  IF NOT ((a.tenant_id IS NOT NULL AND a.tenant_id = t.tenant_id) OR (a.client_id = t.client_id)) THEN RETURN false; END IF;
  IF NOT (t.sap_module = ANY (public.sa_modules(a)) OR COALESCE(t.sap_modules, '{}') && public.sa_modules(a)) THEN RETURN false; END IF;
  INSERT INTO public.sa_tickets (ticket_id, agreement_id) VALUES (_ticket, _agreement);
  rr := public.sa_rate_on(_agreement, current_date);
  IF rr.id IS NOT NULL THEN
    rate := round(rr.hourly_rate * CASE WHEN COALESCE(t.critical_response, false) OR t.urgency = 'critical' THEN COALESCE(rr.s1_multiplier, 1) ELSE 1 END, 2);
    UPDATE public.ticket_rates SET status = 'replaced' WHERE ticket_id = _ticket AND consultant_id = a.consultant_id AND status IN ('proposed', 'approved');
    INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status, source, proposed_by, decided_by, decided_at, decision_note, base_rate, surcharge_percent)
    VALUES (_ticket, a.consultant_id, rate, rr.currency, 'approved', 'agreement', public.sa_user_of(a.consultant_id), t.client_id, now(),
            left('Support agreement "' || a.name || '" (' || a.reference || ', rate record ' || rr.seq || ')', 500),
            CASE WHEN rate <> rr.hourly_rate THEN rr.hourly_rate END, CASE WHEN rate <> rr.hourly_rate THEN round((rate / rr.hourly_rate - 1) * 100, 2) END);
  END IF;
  BEGIN
    INSERT INTO public.ticket_match_requests (ticket_id, consultant_id, sent_by, status, message)
    VALUES (_ticket, a.consultant_id, t.client_id, 'pending', left('Support agreement: ' || a.name || ' (' || a.reference || ')', 500));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Agreement request to the lead consultant skipped: %', SQLERRM;
  END;
  UPDATE public.sa_agreements SET last_activity_at = now() WHERE id = _agreement;
  PERFORM public.sa_event(_agreement, 'ticket_linked', _actor, jsonb_build_object('ticket', _ticket));
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Support agreement link skipped for ticket %: %', _ticket, SQLERRM;
  RETURN false;
END $$;

-- Trusted (server) inserts may pass ticket_context.support_agreement_id; the browser cannot (guard_ticket_context
-- accepts only matching keys) and uses sa_attach_ticket right after creating the ticket.
CREATE OR REPLACE FUNCTION public.sa_on_ticket_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE aid uuid;
BEGIN
  BEGIN
    aid := NULLIF(NEW.ticket_context ->> 'support_agreement_id', '')::uuid;
  EXCEPTION WHEN OTHERS THEN RETURN NULL;
  END;
  IF aid IS NOT NULL THEN PERFORM public.sa_link_ticket(NEW.id, aid, NEW.client_id); END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sa_ticket_link ON public.tickets;   -- runs before sla_ticket_insert (name order), so the SLA hook sees the link
CREATE TRIGGER sa_ticket_link AFTER INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.sa_on_ticket_insert();

-- New-request form switch "Use my support agreement": the ticket's own client (or a company member who may use the
-- agreement) attaches a just-created, still unassigned ticket. The SLA snapshot is re-applied with the agreement's policy.
CREATE OR REPLACE FUNCTION public.sa_attach_ticket(_ticket uuid, _agreement uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); t record; ok boolean; pol uuid; ver int;
BEGIN
  SELECT tk.id, tk.client_id, tk.consultant_id, tk.created_at INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  IF t.id IS NULL OR t.client_id <> uid OR public.sa_role(_agreement, uid) NOT IN ('client', 'client_member') THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  IF t.consultant_id IS NOT NULL OR t.created_at < now() - interval '30 minutes' THEN RAISE EXCEPTION 'sa_too_late: attach right after creating the ticket' USING ERRCODE = '55000'; END IF;
  ok := public.sa_link_ticket(_ticket, _agreement, uid);
  IF ok AND to_regprocedure('public.sla_apply_snapshot(uuid,text,uuid,text,text,text,uuid,integer,jsonb)') IS NOT NULL THEN
    SELECT x.policy_id, x.version INTO pol, ver FROM public.sa_ticket_sla(_ticket) x;
    IF pol IS NOT NULL AND EXISTS (SELECT 1 FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL AND (s.policy_id IS DISTINCT FROM pol OR s.policy_version IS DISTINCT FROM ver)) THEN
      EXECUTE 'SELECT public.sla_apply_snapshot($1, ''new_policy'', $2, ''fresh'', NULL, ''Support agreement SLA'', $3, $4)' USING _ticket, uid, pol, ver;
    END IF;
  END IF;
  RETURN jsonb_build_object('linked', ok);
END $$;

-- Timesheet activity keeps the agreement "active" for the bypass check.
CREATE OR REPLACE FUNCTION public.sa_on_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.sa_agreements a SET last_activity_at = now() FROM public.sa_tickets st WHERE st.ticket_id = NEW.ticket_id AND a.id = st.agreement_id;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sa_activity ON public.ticket_work_logs;
CREATE TRIGGER sa_activity AFTER INSERT ON public.ticket_work_logs FOR EACH ROW EXECUTE FUNCTION public.sa_on_activity();
DROP TRIGGER IF EXISTS sa_activity ON public.ticket_timesheet_submissions;
CREATE TRIGGER sa_activity AFTER INSERT OR UPDATE OF status ON public.ticket_timesheet_submissions FOR EACH ROW EXECUTE FUNCTION public.sa_on_activity();

-- Agreements a client may use on the new-request form ("Use my support agreement").
CREATE OR REPLACE FUNCTION public.sa_usable(_tenant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'reference', a.reference, 'modules', to_jsonb(public.sa_modules(a)),
                                              'sla_name', a.terms -> 'sla' ->> 'name')), '[]'::jsonb)
    FROM public.sa_agreements a
   WHERE public.sa_enabled() AND a.status IN ('active', 'renewal_due') AND (a.termination_end IS NULL OR a.termination_end >= current_date)
     AND ((_tenant IS NOT NULL AND a.tenant_id = _tenant AND public.sa_role(a.id, auth.uid()) IN ('client', 'client_member'))
       OR (_tenant IS NULL AND a.client_id = auth.uid()))
$$;

-- "Agreement: <name>" tags for lists and headers (parties only).
CREATE OR REPLACE FUNCTION public.sa_ticket_tags(_tickets uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ticket_id', st.ticket_id, 'agreement_id', a.id, 'name', a.name)), '[]'::jsonb)
    FROM public.sa_tickets st JOIN public.sa_agreements a ON a.id = st.agreement_id
   WHERE st.ticket_id = ANY (_tickets[1:200]) AND public.sa_role(a.id, auth.uid()) IN ('admin', 'client', 'client_member', 'lead', 'team')
$$;

-- ------------------------------------------------------------------------------------------------ reads
CREATE OR REPLACE FUNCTION public.sa_month_hours(_id uuid, _month date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(l.hours), 0) FROM public.ticket_work_logs l
    JOIN public.sa_tickets st ON st.ticket_id = l.ticket_id AND st.agreement_id = _id
    JOIN public.ticket_timesheet_submissions s ON s.id = l.submission_id AND s.status = 'approved'
   WHERE COALESCE(l.billable, true) AND date_trunc('month', COALESCE(l.work_date, l.created_at::date)) = date_trunc('month', _month)
$$;

CREATE OR REPLACE FUNCTION public.sa_usage(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements; m date := date_trunc('month', current_date)::date; last public.sa_months; sla jsonb;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  SELECT * INTO last FROM public.sa_months WHERE agreement_id = _id ORDER BY month DESC LIMIT 1;
  IF to_regclass('public.sla_ticket_clocks') IS NOT NULL THEN
    EXECUTE $q$SELECT jsonb_build_object('measured', count(*), 'met', count(*) FILTER (WHERE c.breached_at IS NULL),
               'pct', round(100.0 * count(*) FILTER (WHERE c.breached_at IS NULL) / NULLIF(count(*), 0), 1))
          FROM public.sla_ticket_clocks c JOIN public.sa_tickets st ON st.ticket_id = c.ticket_id WHERE st.agreement_id = $1 AND c.met_at IS NOT NULL$q$
      INTO sla USING _id;
  END IF;
  RETURN jsonb_build_object(
    'month', m, 'used_hours', public.sa_month_hours(_id, m),
    'committed', CASE WHEN a.terms ->> 'model' = 'hours_bank' THEN (a.terms -> 'bank' ->> 'hours_per_month')::numeric END,
    'capacity_hours_per_week', CASE WHEN a.terms ->> 'model' = 'availability' THEN (a.terms ->> 'capacity_hours_per_week')::numeric END,
    'rollover_balance', COALESCE((SELECT sum((e ->> 'hours')::numeric) FROM jsonb_array_elements(last.carried_out) e), 0),
    'sla', sla, 'end_date', a.end_date, 'termination_end', a.termination_end,
    'tickets', (SELECT count(*) FROM public.sa_tickets st WHERE st.agreement_id = _id),
    'recent', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'title', left(t.title, 120), 'status', t.status, 'created_at', t.created_at) ORDER BY t.created_at DESC)
                 FROM (SELECT tk.* FROM public.tickets tk JOIN public.sa_tickets st ON st.ticket_id = tk.id WHERE st.agreement_id = _id ORDER BY tk.created_at DESC LIMIT 10) t), '[]'::jsonb),
    'spend', COALESCE((SELECT sum(p.amount) FROM public.payments p WHERE p.status::text = 'completed'
                        AND (p.ticket_id IN (SELECT st.ticket_id FROM public.sa_tickets st WHERE st.agreement_id = _id) OR p.reference LIKE 'agreement:' || _id || ':%')), 0),
    'months', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'agreement_id' ORDER BY x.month DESC) FROM (SELECT * FROM public.sa_months WHERE agreement_id = _id ORDER BY month DESC LIMIT 12) x), '[]'::jsonb));
END $$;

-- Full view of one agreement for the viewer's role. Rates and acceptances only for the parties and admins;
-- applicants see the request and their own application only; other applicants' rates are never returned.
CREATE OR REPLACE FUNCTION public.sa_get(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r text := public.sa_role(_id, uid); a public.sa_agreements; cid uuid := public.sa_consultant_of(uid); party boolean; base jsonb; s jsonb := public.sa_settings();
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  party := r IN ('admin', 'client', 'client_member', 'lead', 'team');
  base := jsonb_build_object('id', a.id, 'name', a.name, 'status', a.status, 'role', r, 'request', a.request - CASE WHEN party OR COALESCE((a.request ->> 'show_budget')::boolean, false) THEN '' ELSE 'budget' END,
    'modules', to_jsonb(public.sa_modules(a)), 'deadline', a.deadline, 'invite_only', a.invite_only, 'legal_draft', COALESCE((s ->> 'draft_legal_flag')::boolean, true),
    'created_at', a.created_at,
    'terms_public', jsonb_build_object('model', a.terms ->> 'model', 'term', a.terms -> 'term', 'sla', a.terms -> 'sla', 'scope', a.terms -> 'scope', 'bank', a.terms -> 'bank',
                                       'capacity_hours_per_week', a.terms -> 'capacity_hours_per_week', 'nda_required', a.terms -> 'nda_required'));
  IF NOT party THEN
    RETURN base || jsonb_build_object('my_application', (SELECT to_jsonb(p) - 'user_id' FROM public.sa_applications p WHERE p.agreement_id = _id AND p.consultant_id = cid),
      'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('role', m.sender_role, 'body', m.body, 'at', m.created_at) ORDER BY m.created_at)
                    FROM public.sa_messages m WHERE m.agreement_id = _id AND m.consultant_id = cid), '[]'::jsonb));
  END IF;
  RETURN base || jsonb_build_object(
    'terms', a.terms, 'version', a.version, 'content_hash', (SELECT v.content_hash FROM public.sa_versions v WHERE v.agreement_id = _id AND v.version = a.version),
    'consultant_id', a.consultant_id, 'consultant_name', CASE WHEN a.consultant_id IS NOT NULL THEN public.consultant_public_name(a.consultant_id) END, 'admin_review', a.admin_review, 'agreed_at', a.agreed_at, 'started_at', a.started_at, 'start_date', a.start_date, 'end_date', a.end_date,
    'auto_renew', jsonb_build_object('client', a.auto_renew_client_at IS NOT NULL, 'consultant', a.auto_renew_consultant_at IS NOT NULL),
    'termination', CASE WHEN a.termination_end IS NOT NULL THEN jsonb_build_object('by', a.termination_requested_by, 'reason', a.termination_reason, 'end', a.termination_end,
                     'handover_until', a.handover_until, 'handover_note', a.handover_note) END,
    'suspended_until', a.suspended_until, 'nda_ok', CASE WHEN a.consultant_id IS NOT NULL THEN public.sa_nda_ok(a) END,
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', v.version, 'hash', v.content_hash, 'note', v.note, 'at', v.created_at) ORDER BY v.version DESC) FROM public.sa_versions v WHERE v.agreement_id = _id), '[]'::jsonb),
    'acceptances', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', x.version, 'party', x.party, 'name', x.typed_name, 'at', x.accepted_at, 'hash', x.content_hash, 'legal_draft', x.legal_draft) ORDER BY x.accepted_at) FROM public.sa_acceptances x WHERE x.agreement_id = _id), '[]'::jsonb),
    'rates', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'agreement_id' - 'proposed_by' - 'accepted_by' ORDER BY x.seq) FROM public.sa_rate_records x WHERE x.agreement_id = _id), '[]'::jsonb),
    'rate_in_force', (SELECT to_jsonb(x) - 'agreement_id' - 'proposed_by' - 'accepted_by' FROM public.sa_rate_on(_id, current_date) x WHERE x.id IS NOT NULL),
    'rate_changes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'by', c.proposed_role, 'hourly_rate', c.hourly_rate, 's1_multiplier', c.s1_multiplier, 'overage_rate', c.overage_rate,
                     'effective_from', c.effective_from, 'reason', c.reason, 'status', c.status, 'at', c.created_at) ORDER BY c.created_at DESC) FROM public.sa_rate_changes c WHERE c.agreement_id = _id), '[]'::jsonb),
    'offers', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'by', o.by_role, 'patch', o.patch, 'note', o.note, 'status', o.status, 'at', o.created_at) ORDER BY o.created_at DESC) FROM public.sa_offers o WHERE o.agreement_id = _id), '[]'::jsonb),
    'applications', CASE WHEN r IN ('admin', 'client', 'client_member') THEN COALESCE((SELECT jsonb_agg((to_jsonb(p) - 'user_id') || jsonb_build_object('name', public.consultant_public_name(p.consultant_id)) ORDER BY p.created_at) FROM public.sa_applications p WHERE p.agreement_id = _id), '[]'::jsonb) END,
    'members', COALESCE((SELECT jsonb_agg(jsonb_build_object('consultant_id', m.consultant_id, 'name', public.consultant_public_name(m.consultant_id), 'role', m.member_role, 'status', m.status)) FROM public.sa_members m WHERE m.agreement_id = _id), '[]'::jsonb),
    'replacement', (SELECT jsonb_build_object('id', x.id, 'status', x.status, 'to', x.to_consultant, 'reason', x.reason) FROM public.sa_replacements x WHERE x.agreement_id = _id AND x.status IN ('pending_admin', 'pending_consultant') LIMIT 1),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'role', e.actor_role, 'data', e.data, 'at', e.created_at) ORDER BY e.created_at DESC) FROM (SELECT * FROM public.sa_events WHERE agreement_id = _id ORDER BY created_at DESC LIMIT 100) e), '[]'::jsonb),
    'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object('consultant_id', m.consultant_id, 'role', m.sender_role, 'body', m.body, 'at', m.created_at) ORDER BY m.created_at)
                  FROM public.sa_messages m WHERE m.agreement_id = _id AND (r IN ('admin', 'client', 'client_member') OR m.consultant_id = cid)), '[]'::jsonb),
    'usage', CASE WHEN a.status IN ('active', 'suspended', 'renewal_due', 'expired', 'terminated', 'archived') THEN public.sa_usage(_id) END,
    'fees', jsonb_build_object('service_fee_percent', public.sa_service_fee_percent(), 'processing_fee_percent', public.payment_processing_fee_percent(), 'vat_percent', public.payment_vat_percent()));
END $$;

CREATE OR REPLACE FUNCTION public.sa_list_mine(_tenant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cid uuid := public.sa_consultant_of(uid);
BEGIN
  RETURN jsonb_build_object('enabled', public.sa_enabled(), 'settings', public.sa_settings() - 'rate_caps',
    'agreements', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'reference', a.reference, 'status', a.status, 'role', public.sa_role(a.id, uid), 'modules', to_jsonb(public.sa_modules(a)),
        'crew', (SELECT jsonb_build_object('members', count(*), 'confirmed', count(*) FILTER (WHERE m.status = 'active' AND m.sla_accepted_at IS NOT NULL)) FROM public.sa_members m WHERE m.agreement_id = a.id AND m.status IN ('invited', 'active', 'declined')),
        'model', a.terms ->> 'model', 'start_date', COALESCE(a.start_date, NULLIF(a.terms -> 'term' ->> 'start_date', '')::date), 'end_date', COALESCE(a.end_date, NULLIF(a.terms -> 'term' ->> 'end_date', '')::date),
        'applications', CASE WHEN public.sa_role(a.id, uid) IN ('client', 'client_member', 'admin') THEN (SELECT count(*) FROM public.sa_applications p WHERE p.agreement_id = a.id AND p.status IN ('pending', 'shortlisted', 'selected')) END,
        'updated_at', a.updated_at) ORDER BY a.updated_at DESC)
      FROM public.sa_agreements a
     WHERE (_tenant IS NOT NULL AND a.tenant_id = _tenant AND public.sa_role(a.id, uid) IN ('client', 'client_member'))
        OR (_tenant IS NULL AND a.client_id = uid)
        OR (cid IS NOT NULL AND (a.consultant_id = cid AND a.status NOT IN ('draft', 'open')
             OR EXISTS (SELECT 1 FROM public.sa_members m WHERE m.agreement_id = a.id AND m.consultant_id = cid AND m.status IN ('invited', 'active'))
             OR EXISTS (SELECT 1 FROM public.sa_applications p WHERE p.agreement_id = a.id AND p.consultant_id = cid)))), '[]'::jsonb),
    'replacements', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'agreement_id', x.agreement_id, 'name', a.name, 'reference', a.reference)) FROM public.sa_replacements x JOIN public.sa_agreements a ON a.id = x.agreement_id
                      WHERE x.status = 'pending_consultant' AND x.to_consultant = cid), '[]'::jsonb));
END $$;

-- ------------------------------------------------------------------------------------------------ admin
CREATE OR REPLACE FUNCTION public.sa_admin_set_settings(_value jsonb, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v jsonb := '{}'::jsonb; k text; before jsonb := public.sa_settings();
BEGIN
  IF NOT public.sa_is_admin(uid) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  FOR k IN SELECT jsonb_object_keys(COALESCE(_value, '{}'::jsonb)) LOOP
    IF k IN ('enabled', 'needs_admin_review', 'draft_legal_flag', 'models_enabled', 'rate_min', 'rate_max', 'rate_caps', 'service_fee_percent', 'max_multiplier',
             'renewal_reminder_days', 'inactivity_weeks', 'min_term_months', 'max_notice_days', 'handover_days', 'allow_prepayment', 'allow_forfeit', 'application_limit_per_day',
             'crew_max', 'contacts_max', 'doc_max_mb', 'docs_per_agreement') THEN
      v := v || jsonb_build_object(k, _value -> k);
    END IF;
  END LOOP;
  IF v ? 'service_fee_percent' AND jsonb_typeof(v -> 'service_fee_percent') = 'number' AND (v ->> 'service_fee_percent')::numeric NOT BETWEEN 0 AND 50 THEN
    RAISE EXCEPTION 'sa_bad_settings: fee 0-50 %%' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((v ->> 'rate_min')::numeric, (before ->> 'rate_min')::numeric) > COALESCE((v ->> 'rate_max')::numeric, (before ->> 'rate_max')::numeric) THEN
    RAISE EXCEPTION 'sa_bad_settings: min above max' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_settings (key, value) VALUES ('support_agreements', v)
  ON CONFLICT (key) DO UPDATE SET value = public.platform_settings.value || EXCLUDED.value, updated_at = now();
  -- Boolean mirror for the menu switch (src/lib/pageVisibility.ts reads boolean rows only).
  INSERT INTO public.platform_settings (key, value) VALUES ('support_agreements_visible', to_jsonb(public.sa_enabled()))
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  PERFORM public.sa_audit_log(uid, 'settings', NULL, jsonb_build_object('before', before, 'after', public.sa_settings(), 'reason', left(_reason, 300)));
  RETURN public.sa_settings();
END $$;

-- Full settings (incl. per-module rate caps) and today's fee percentages for the administrator screen.
CREATE OR REPLACE FUNCTION public.sa_admin_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.sa_is_admin(auth.uid()) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object('settings', public.sa_settings(), 'fees', jsonb_build_object('service_fee_percent', public.payment_service_fee_percent(),
    'processing_fee_percent', public.payment_processing_fee_percent(), 'vat_percent', public.payment_vat_percent(), 'agreement_fee_percent', public.sa_service_fee_percent()));
END $$;

CREATE OR REPLACE FUNCTION public.sa_admin_list(_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT public.sa_is_admin(uid) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'reference', a.reference, 'status', a.status, 'admin_review', a.admin_review,
      'company', COALESCE((SELECT t.name FROM public.tenants t WHERE t.id = a.tenant_id), (SELECT cp.company_name FROM public.client_profiles cp WHERE cp.user_id = a.client_id LIMIT 1)),
      'consultant', (SELECT p.display_name FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id WHERE c.id = a.consultant_id LIMIT 1),
      'rate', (SELECT jsonb_build_object('hourly_rate', x.hourly_rate, 'currency', x.currency) FROM public.sa_rate_on(a.id, current_date) x WHERE x.id IS NOT NULL),
      'model', a.terms ->> 'model', 'end_date', a.end_date, 'last_activity_at', a.last_activity_at,
      'inactive', a.status IN ('active', 'renewal_due') AND GREATEST(a.last_activity_at, a.started_at) < now() - make_interval(weeks => COALESCE((public.sa_settings() ->> 'inactivity_weeks')::int, 6)),
      'replacement', (SELECT jsonb_build_object('id', x.id, 'status', x.status, 'reason', x.reason) FROM public.sa_replacements x WHERE x.agreement_id = a.id AND x.status = 'pending_admin' LIMIT 1),
      'updated_at', a.updated_at) ORDER BY a.updated_at DESC)
    FROM public.sa_agreements a WHERE _status IS NULL OR a.status = _status OR (_status = 'review' AND a.admin_review = 'pending')), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.sa_admin_review(_id uuid, _approve boolean, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); a public.sa_agreements;
BEGIN
  IF NOT public.sa_is_admin(uid) THEN RAISE EXCEPTION 'sa_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id AND admin_review = 'pending' FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'sa_not_found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.sa_agreements SET admin_review = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, admin_note = left(_note, 500) WHERE id = _id;
  PERFORM public.sa_event(_id, CASE WHEN _approve THEN 'admin_approved' ELSE 'admin_rejected' END, uid);
  PERFORM public.sa_audit_log(uid, 'admin_review', _id, jsonb_build_object('approve', _approve, 'note', left(_note, 300)));
  IF _approve THEN PERFORM public.sa_try_activate(_id);
  ELSE
    UPDATE public.sa_agreements SET termination_reason = 'Not approved by the platform team: ' || left(COALESCE(_note, ''), 300), termination_end = current_date WHERE id = _id;
    PERFORM public.sa_set_status(_id, 'terminated', uid, jsonb_build_object('admin_rejected', true));
  END IF;
  PERFORM public.sa_notify_parties(_id, CASE WHEN _approve THEN 'Support agreement approved' ELSE 'Support agreement not approved' END,
    CASE WHEN _approve THEN 'تمت الموافقة على اتفاقية الدعم' ELSE 'لم تتم الموافقة على اتفاقية الدعم' END,
    COALESCE(NULLIF(_note, ''), a.name), COALESCE(NULLIF(_note, ''), a.name), true, 'review_done:' || _id);
END $$;

-- ------------------------------------------------------------------------------------------------ daily sweep
CREATE OR REPLACE FUNCTION public.sa_settle_month(_id uuid, _month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.sa_agreements; prev public.sa_months; res jsonb; used numeric; committed numeric; days int; active_days int; rr public.sa_rate_records;
  base numeric; br jsonb; pid uuid; m0 date := date_trunc('month', _month)::date; m1 date := (date_trunc('month', _month) + interval '1 month - 1 day')::date;
  svc numeric; sf numeric; pf numeric; vat numeric; sub numeric;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id FOR UPDATE;
  IF a.terms ->> 'model' <> 'hours_bank' OR a.started_at IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.sa_months x WHERE x.agreement_id = _id AND x.month = m0) THEN RETURN NULL; END IF;
  days := m1 - m0 + 1;
  active_days := GREATEST(0, LEAST(m1, COALESCE(a.termination_end, a.end_date, m1)) - GREATEST(m0, COALESCE(a.start_date, m0)) + 1);
  IF active_days <= 0 THEN RETURN NULL; END IF;
  committed := round((a.terms -> 'bank' ->> 'hours_per_month')::numeric * active_days / days, 2);  -- first/last month prorated by days
  SELECT * INTO prev FROM public.sa_months WHERE agreement_id = _id AND month < m0 ORDER BY month DESC LIMIT 1;
  used := public.sa_month_hours(_id, m0);
  res := public.sa_bank_month(to_char(m0, 'YYYY-MM'), COALESCE(prev.carried_out, '[]'::jsonb), used, a.terms -> 'bank', committed);
  rr := public.sa_rate_on(_id, m1);
  base := round((res ->> 'charge_hours')::numeric * rr.hourly_rate
          + (res ->> 'overage_hours')::numeric * GREATEST(0, COALESCE(rr.overage_rate, NULLIF(a.terms -> 'bank' ->> 'overage_rate', '')::numeric, rr.hourly_rate) - rr.hourly_rate), 2);
  IF base > 0 THEN
    -- pricing v2 with the agreement portal fee (same rounding order as pricing_breakdown).
    svc := public.sa_service_fee_percent();
    sf := round(base * svc / 100, 2); pf := round(base * public.payment_processing_fee_percent() / 100, 2);
    sub := base + sf + pf; vat := round(sub * public.payment_vat_percent() / 100, 2);
    INSERT INTO public.payments (client_id, consultant_id, tenant_id, amount, currency, vat_amount, status, kind, reference, description, due_date, pricing_model,
                                 base_amount, service_fee_percent, service_fee_amount, processing_fee_percent, processing_fee_amount, vat_percent)
    VALUES (a.client_id, a.consultant_id, a.tenant_id, sub + vat, rr.currency, vat, 'pending', 'invoice', 'agreement:' || _id || ':' || to_char(m0, 'YYYY-MM'),
            left('Support agreement "' || a.name || '" (' || a.reference || ') ' || to_char(m0, 'YYYY-MM') || ': ' || (res ->> 'charge_hours') || ' committed hours not used'
                 || CASE WHEN (res ->> 'overage_hours')::numeric > 0 THEN ', overage difference for ' || (res ->> 'overage_hours') || ' h' ELSE '' END, 500),
            now() + interval '14 days', 'v2', base, svc, sf, public.payment_processing_fee_percent(), pf, public.payment_vat_percent())
    RETURNING id INTO pid;
  END IF;
  INSERT INTO public.sa_months (agreement_id, month, committed, carried_in, used_hours, carried_out, expired_hours, charge_hours, overage_hours, base_amount, payment_id)
  VALUES (_id, m0, committed, COALESCE(prev.carried_out, '[]'::jsonb), used, res -> 'carried_out', (res ->> 'expired_hours')::numeric, (res ->> 'charge_hours')::numeric,
          (res ->> 'overage_hours')::numeric, base, pid);
  PERFORM public.sa_event(_id, 'month_settled', NULL, jsonb_build_object('month', to_char(m0, 'YYYY-MM'), 'used', used, 'charge_hours', res -> 'charge_hours', 'base', base));
  PERFORM public.sa_notify_parties(_id, 'Monthly statement ' || to_char(m0, 'YYYY-MM') || ': ' || a.name, 'كشف شهري ' || to_char(m0, 'YYYY-MM') || ': ' || a.name,
    'Hours used ' || used || ' of ' || committed || ' committed.' || CASE WHEN base > 0 THEN ' An invoice for the unused committed hours was created.' ELSE '' END,
    'الساعات المستخدمة ' || used || ' من ' || committed || ' ملتزم بها.' || CASE WHEN base > 0 THEN ' أُنشئت فاتورة للساعات الملتزم بها غير المستخدمة.' ELSE '' END,
    true, 'statement:' || _id || ':' || to_char(m0, 'YYYY-MM'));
  PERFORM public.sa_notify_statement(_id, m0);
  RETURN res || jsonb_build_object('base', base, 'payment_id', pid);
END $$;

CREATE OR REPLACE FUNCTION public.sa_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.sa_settings(); a public.sa_agreements; d int; first_d int; n_act int := 0; n_ren int := 0; n_set int := 0; rr public.sa_rate_records; tk uuid;
BEGIN
  IF NOT public.sa_enabled() THEN RETURN jsonb_build_object('skipped', true); END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('sa_sweep')) THEN RETURN jsonb_build_object('busy', true); END IF;
  first_d := COALESCE((SELECT max(x::int) FROM jsonb_array_elements_text(s -> 'renewal_reminder_days') x), 60);
  FOR a IN SELECT * FROM public.sa_agreements WHERE status IN ('agreed', 'active', 'suspended', 'renewal_due', 'expired', 'terminated') ORDER BY updated_at LIMIT 2000 LOOP
    BEGIN
      IF a.status = 'agreed' THEN
        IF public.sa_try_activate(a.id) THEN n_act := n_act + 1; END IF;
        CONTINUE;
      END IF;
      -- monthly settlement of the previous month (hours bank)
      IF a.terms ->> 'model' = 'hours_bank' AND a.started_at IS NOT NULL THEN
        IF public.sa_settle_month(a.id, (date_trunc('month', current_date) - interval '1 month')::date) IS NOT NULL THEN n_set := n_set + 1; END IF;
      END IF;
      IF a.status = 'suspended' AND a.suspended_until IS NOT NULL AND a.suspended_until <= current_date THEN
        UPDATE public.sa_agreements SET suspended_until = NULL WHERE id = a.id;
        PERFORM public.sa_set_status(a.id, 'active', NULL, jsonb_build_object('auto_resume', true));
        a.status := 'active';
      END IF;
      -- notice period over -> terminated; long after the end -> archived
      IF a.termination_end IS NOT NULL AND current_date > a.termination_end AND a.status IN ('active', 'suspended', 'renewal_due') THEN
        PERFORM public.sa_set_status(a.id, 'terminated', NULL, jsonb_build_object('notice_end', a.termination_end));
        CONTINUE;
      END IF;
      IF a.status IN ('expired', 'terminated') AND current_date > COALESCE(a.handover_until, a.termination_end, a.end_date, current_date) + 30 THEN
        PERFORM public.sa_set_status(a.id, 'archived', NULL);
        CONTINUE;
      END IF;
      IF a.status IN ('active', 'renewal_due') AND a.end_date IS NOT NULL THEN
        FOR d IN SELECT x::int FROM jsonb_array_elements_text(s -> 'renewal_reminder_days') x LOOP
          IF a.end_date - d = current_date THEN
            PERFORM public.sa_notify_parties(a.id, 'Support agreement ends in ' || d || ' days: ' || a.name, 'تنتهي اتفاقية الدعم خلال ' || d || ' يوماً: ' || a.name,
              CASE WHEN a.auto_renew_client_at IS NOT NULL AND a.auto_renew_consultant_at IS NOT NULL THEN 'It renews automatically on ' || (a.end_date + 1) || ' unless one of you switches auto-renew off.'
                   ELSE 'Renew it, or let it end on ' || a.end_date || '.' END,
              CASE WHEN a.auto_renew_client_at IS NOT NULL AND a.auto_renew_consultant_at IS NOT NULL THEN 'تتجدد تلقائياً في ' || (a.end_date + 1) || ' ما لم يوقف أحدكما التجديد التلقائي.'
                   ELSE 'جدّدها أو اتركها تنتهي في ' || a.end_date || '.' END, true, 'renewal:' || a.id || ':' || a.end_date || ':' || d);
          END IF;
        END LOOP;
        IF current_date > a.end_date THEN
          IF a.auto_renew_client_at IS NOT NULL AND a.auto_renew_consultant_at IS NOT NULL AND COALESCE((a.terms -> 'term' ->> 'renew_months')::int, 0) > 0 AND a.termination_end IS NULL THEN
            UPDATE public.sa_agreements SET end_date = (end_date + make_interval(months => (terms -> 'term' ->> 'renew_months')::int))::date WHERE id = a.id;
            IF a.status = 'renewal_due' THEN PERFORM public.sa_set_status(a.id, 'active', NULL, jsonb_build_object('renewed', true)); END IF;
            PERFORM public.sa_event(a.id, 'renewed', NULL, jsonb_build_object('until', (a.end_date + make_interval(months => (a.terms -> 'term' ->> 'renew_months')::int))::date));
            n_ren := n_ren + 1;
          ELSE
            PERFORM public.sa_set_status(a.id, 'expired', NULL);
          END IF;
        ELSIF a.status = 'active' AND a.end_date - first_d <= current_date THEN
          PERFORM public.sa_set_status(a.id, 'renewal_due', NULL);
        END IF;
      END IF;
      -- a rate change takes effect today: open agreement tickets get the new approved rate (earlier work keeps its rate)
      SELECT * INTO rr FROM public.sa_rate_records x WHERE x.agreement_id = a.id AND x.effective_from = current_date AND x.source = 'rate_change' ORDER BY x.seq DESC LIMIT 1;
      IF rr.id IS NOT NULL AND a.current_rate_id IS DISTINCT FROM rr.id THEN
        UPDATE public.sa_agreements SET current_rate_id = rr.id WHERE id = a.id;
        FOR tk IN SELECT st.ticket_id FROM public.sa_tickets st JOIN public.tickets t ON t.id = st.ticket_id WHERE st.agreement_id = a.id AND t.status::text NOT IN ('resolved', 'closed') LOOP
          UPDATE public.ticket_rates SET status = 'replaced' WHERE ticket_id = tk AND consultant_id = a.consultant_id AND status = 'approved';
          INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status, source, decided_at, decision_note)
          VALUES (tk, a.consultant_id, rr.hourly_rate, rr.currency, 'approved', 'agreement', now(), 'Support agreement ' || a.reference || ' rate change from ' || rr.effective_from);
        END LOOP;
        PERFORM public.sa_event(a.id, 'rate_in_force', NULL, jsonb_build_object('seq', rr.seq, 'effective_from', rr.effective_from));
      END IF;
      -- bypass check: an active agreement without ticket or timesheet activity for N weeks
      IF a.status IN ('active', 'renewal_due') AND GREATEST(a.last_activity_at, a.started_at) < now() - make_interval(weeks => COALESCE((s ->> 'inactivity_weeks')::int, 6))
         AND (a.inactivity_alerted_at IS NULL OR a.inactivity_alerted_at < GREATEST(a.last_activity_at, a.started_at)) THEN
        UPDATE public.sa_agreements SET inactivity_alerted_at = now() WHERE id = a.id;
        PERFORM public.sa_event(a.id, 'inactivity_alert', NULL);
        PERFORM public.sa_notify_admins(a.id, 'Support agreement without activity', a.name || ': no tickets or timesheets for ' || COALESCE(s ->> 'inactivity_weeks', '6') || ' weeks.', 'inactive:' || a.id || ':' || current_date);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Support agreement sweep skipped %: %', a.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('activated', n_act, 'renewed', n_ren, 'settled', n_set);
END $$;

-- ------------------------------------------------------------------------------------------------ matching + e-mail worker
-- Share of a consultant's week reserved by availability commitments (ai-ticket lowers the availability fit with it).
CREATE OR REPLACE FUNCTION public.sa_reserved_shares(_consultant_ids uuid[])
RETURNS TABLE (consultant_id uuid, share numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.consultant_id, LEAST(1, sum((a.terms ->> 'capacity_hours_per_week')::numeric) / 40)
    FROM public.sa_agreements a
   WHERE public.sa_enabled() AND a.status IN ('active', 'renewal_due') AND a.terms ->> 'model' = 'availability' AND a.consultant_id = ANY (_consultant_ids)
   GROUP BY a.consultant_id
$$;

CREATE OR REPLACE FUNCTION public.sa_wake()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regprocedure('public.job_invoke_headers()') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sa_email_queue q WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5) THEN RETURN; END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := public.job_invoke_headers(), body := '{}'::jsonb)$q$
    USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/agreement-run';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Agreement e-mail wake-up skipped: %', SQLERRM;
END $$;
CREATE OR REPLACE FUNCTION public.sa_wake_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN PERFORM public.sa_wake(); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS sa_wake ON public.sa_email_queue;
CREATE TRIGGER sa_wake AFTER INSERT ON public.sa_email_queue FOR EACH STATEMENT EXECUTE FUNCTION public.sa_wake_trigger();

CREATE OR REPLACE FUNCTION public.sa_claim_emails(_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, user_id uuid, agreement_id uuid, kind text, payload jsonb, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.sa_email_queue q SET failed_at = now(), last_error = 'not_applicable'
   WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND (NOT public.sa_enabled()
      OR (to_regprocedure('public.notifications_paused(uuid,text,text)') IS NOT NULL AND public.notifications_paused(q.user_id, 'activity', 'email')));
  RETURN QUERY
  WITH c AS (
    UPDATE public.sa_email_queue q SET attempts = q.attempts + 1, lease_until = now() + interval '10 minutes'
     WHERE q.id IN (SELECT q2.id FROM public.sa_email_queue q2 WHERE q2.sent_at IS NULL AND q2.failed_at IS NULL AND q2.attempts < 5
                      AND (q2.lease_until IS NULL OR q2.lease_until < now()) ORDER BY q2.created_at LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200) FOR UPDATE SKIP LOCKED)
    RETURNING q.id, q.user_id, q.agreement_id, q.kind, q.payload)
  SELECT c.id, c.user_id, c.agreement_id, c.kind, c.payload, u.email::text FROM c LEFT JOIN auth.users u ON u.id = c.user_id;
END $$;

CREATE OR REPLACE FUNCTION public.sa_finish_email(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.sa_email_queue SET sent_at = CASE WHEN _ok THEN now() END,
    failed_at = CASE WHEN NOT _ok AND (attempts >= 5 OR _error IN ('no_address', 'recipient_suppressed')) THEN now() END,
    last_error = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error, 'failed'), 200) END, lease_until = NULL
   WHERE id = _id
$$;

-- ------------------------------------------------------------------------------------------------ schedule (daily, 02:17 UTC)
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL AND to_regclass('cron.job') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'support-agreements-daily') THEN
      PERFORM cron.schedule('support-agreements-daily', '17 2 * * *', 'SELECT public.sa_sweep()');
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Daily support agreement job not scheduled: %', SQLERRM;
END $$;

-- ------------------------------------------------------------------------------------------------ grants
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname LIKE 'sa\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
  public.sa_create(uuid, jsonb, jsonb), public.sa_save_draft(uuid, jsonb, jsonb), public.sa_publish(uuid, timestamptz, boolean, uuid[]),
  public.sa_opportunities(), public.sa_apply(uuid, numeric, text, text, numeric, text, boolean, text), public.sa_withdraw_application(uuid),
  public.sa_select_application(uuid), public.sa_reopen(uuid, text), public.sa_offer(uuid, jsonb, text), public.sa_respond_offer(uuid, boolean),
  public.sa_accept_terms(uuid, integer, text, text), public.sa_propose_rate_change(uuid, numeric, numeric, numeric, numeric, date, text),
  public.sa_decide_rate_change(uuid, boolean), public.sa_request_termination(uuid, text), public.sa_handover_note(uuid, text),
  public.sa_suspend(uuid, date, text), public.sa_resume(uuid), public.sa_set_auto_renew(uuid, boolean), public.sa_invite_member(uuid, uuid),
  public.sa_member_respond(uuid, boolean), public.sa_request_replacement(uuid, uuid, text), public.sa_admin_decide_replacement(uuid, boolean, text),
  public.sa_replacement_accept(uuid, boolean), public.sa_post_message(uuid, uuid, text), public.sa_usable(uuid), public.sa_attach_ticket(uuid, uuid), public.sa_ticket_tags(uuid[]),
  public.sa_get(uuid), public.sa_list_mine(uuid), public.sa_admin_set_settings(jsonb, text), public.sa_admin_settings(), public.sa_admin_list(text), public.sa_admin_review(uuid, boolean, text)
TO authenticated;
-- The SLA hook must stay callable from the SLA functions (they run as the owner; no browser grant needed).

-- ------------------------------------------------------------------------------------------------ OPTIONAL (owner decision, commented out)
-- Ticket timesheets keep the platform portal fee. If the owner later sets a lower agreement fee AND wants it on the
-- ticket timesheets too (not only on the month-end settlements above), the timesheet pricing must read
-- sa_service_fee_percent() for agreement tickets. That needs a reviewed change of the timesheet approval function and of
-- the browser price preview (src/lib/pricing.ts) so the shown figure stays the invoiced figure. Not done here.
