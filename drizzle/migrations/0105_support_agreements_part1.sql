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
--   * Owner requirements (2026-10-25): every agreement has a client-chosen NAME (unique per client company, editable
--     only in Draft) and a REFERENCE "SA-<year>-<6 digits>" shown in lists, tags, notices, e-mails, invoices and PDFs;
--     agreements belong to the client company; each keeps an immutable snapshot of its SLA version (body + hash);
--     the client composes the CREW (lead + functional/technical/basis/backup members, capacity, working hours, backup
--     cover) and every required member accepts the place + SLA and signs the NDA before the agreement starts
--     (sa_confirmation); the agreement SLA applies to its tickets only while Active ("SLA starts when the crew is
--     confirmed"); AGREEMENT DOCUMENTS (private bucket 'agreement-documents', versions, NDA gate, download log, no
--     passwords/secrets); company-only statement recipients and escalation contacts.
--   * Needs at apply time: a private storage bucket 'agreement-documents' (created with the platform storage tool,
--     not by SQL), and docs/sql/sla-policies.sql for the SLA snapshot (without it only the policy reference is kept).
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

