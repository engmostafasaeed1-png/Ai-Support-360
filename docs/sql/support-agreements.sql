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
    'allow_prepayment', false, 'allow_forfeit', false, 'application_limit_per_day', 10)
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

CREATE TABLE IF NOT EXISTS public.sa_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.sa_agreements(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL,
  member_role text NOT NULL CHECK (member_role IN ('lead', 'support')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'declined', 'ended')),
  added_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sa_members_one_open ON public.sa_members (agreement_id, consultant_id) WHERE status IN ('invited', 'active');

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
    'sa_rate_changes', 'sa_members', 'sa_replacements', 'sa_tickets', 'sa_months', 'sa_events', 'sa_messages', 'sa_notices', 'sa_email_queue', 'sa_audit'] LOOP
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
  FOREACH t IN ARRAY ARRAY['sa_versions', 'sa_acceptances', 'sa_rate_records', 'sa_events', 'sa_messages', 'sa_audit'] LOOP
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

-- In-app notice (+ optional e-mail through agreement-run) once per dedupe key.
CREATE OR REPLACE FUNCTION public.sa_notify(_id uuid, _user uuid, _title_en text, _title_ar text, _body_en text, _body_ar text, _role text, _email boolean, _dedupe text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lang text := public.sa_lang(_user); n int; link text;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;
  INSERT INTO public.sa_notices (dedupe_key) VALUES (left(_dedupe, 300)) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN; END IF;
  link := CASE _role WHEN 'consultant' THEN '/consultant/agreements/' || _id WHEN 'admin' THEN '/admin/agreements' ELSE '/client/agreements/' || _id END;
  PERFORM public.safe_insert_notification(_user, left(CASE WHEN lang = 'ar' THEN _title_ar ELSE _title_en END, 200),
    left(CASE WHEN lang = 'ar' THEN _body_ar ELSE _body_en END, 1000), 'agreement', link);
  IF _email THEN
    INSERT INTO public.sa_email_queue (user_id, agreement_id, kind, payload, dedupe_key)
    VALUES (_user, _id, 'event', jsonb_build_object('lang', lang, 'title', CASE WHEN lang = 'ar' THEN _title_ar ELSE _title_en END,
      'body', CASE WHEN lang = 'ar' THEN _body_ar ELSE _body_en END, 'path', link, 'role', _role,
      'name', (SELECT a.name FROM public.sa_agreements a WHERE a.id = _id)), left('sa:' || _dedupe, 300))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
END $$;

-- Notify both parties (client + company managers, lead consultant).
CREATE OR REPLACE FUNCTION public.sa_notify_parties(_id uuid, _title_en text, _title_ar text, _body_en text, _body_ar text, _email boolean, _key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.sa_agreements; u uuid;
BEGIN
  SELECT * INTO a FROM public.sa_agreements WHERE id = _id;
  FOR u IN SELECT a.client_id UNION SELECT m.user_id FROM public.tenant_members m WHERE m.tenant_id = a.tenant_id AND m.accepted_at IS NOT NULL
                                    AND m.org_role IN ('owner'::org_role, 'admin'::org_role) LOOP
    PERFORM public.sa_notify(_id, u, _title_en, _title_ar, _body_en, _body_ar, 'client', _email, _key || ':' || u);
  END LOOP;
  IF a.consultant_id IS NOT NULL AND a.status NOT IN ('draft', 'open') THEN
    PERFORM public.sa_notify(_id, public.sa_user_of(a.consultant_id), _title_en, _title_ar, _body_en, _body_ar, 'consultant', _email, _key || ':lead');
  END IF;
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
  IF _rate IS NULL OR _rate < lo THEN out := out || 'rate_low'; END IF;
  IF _rate IS NULL OR _rate > hi THEN out := out || 'rate_high'; END IF;
  IF (_s1 IS NOT NULL AND (_s1 < 1 OR _s1 > mx)) OR (_ooh IS NOT NULL AND (_ooh < 1 OR _ooh > mx)) THEN out := out || 'multiplier'; END IF;
  IF _overage IS NOT NULL AND _overage < _rate THEN out := out || 'overage_low'; END IF;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.sa_terms_problems(_t jsonb)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.sa_settings(); out text[] := '{}'; sd date; ed date; mods text[];
BEGIN
  mods := ARRAY(SELECT jsonb_array_elements_text(COALESCE(_t -> 'scope' -> 'modules', '[]'::jsonb)));
  IF char_length(btrim(COALESCE(_t ->> 'name', ''))) NOT BETWEEN 1 AND 120 THEN out := out || 'name'; END IF;
  IF cardinality(mods) = 0 THEN out := out || 'modules'; END IF;
  IF NOT (COALESCE(s -> 'models_enabled', '[]'::jsonb) ? COALESCE(_t ->> 'model', '')) THEN out := out || 'model_disabled'; END IF;
  BEGIN sd := (_t -> 'term' ->> 'start_date')::date; EXCEPTION WHEN OTHERS THEN sd := NULL; END;
  BEGIN ed := NULLIF(_t -> 'term' ->> 'end_date', '')::date; EXCEPTION WHEN OTHERS THEN ed := NULL; out := out || 'end_before_start'; END;
  IF sd IS NULL OR sd < current_date THEN out := out || 'start_past'; END IF;
  IF ed IS NOT NULL AND sd IS NOT NULL THEN
    IF ed <= sd THEN out := out || 'end_before_start';
    ELSIF COALESCE((s ->> 'min_term_months')::int, 0) > 0 AND ed < (sd + make_interval(months => (s ->> 'min_term_months')::int))::date THEN out := out || 'term_short';
    END IF;
  END IF;
  IF COALESCE((_t -> 'term' ->> 'notice_days')::int, -1) NOT BETWEEN 0 AND COALESCE((s ->> 'max_notice_days')::int, 90) THEN out := out || 'notice'; END IF;
  IF _t ->> 'model' = 'hours_bank' THEN
    IF COALESCE((_t -> 'bank' ->> 'hours_per_month')::numeric, 0) NOT BETWEEN 0.25 AND 744 THEN out := out || 'bank_hours'; END IF;
    IF _t -> 'bank' ->> 'unused' = 'forfeit' AND NOT COALESCE((s ->> 'allow_forfeit')::boolean, false) THEN out := out || 'forfeit_disabled'; END IF;
    IF COALESCE((_t -> 'bank' ->> 'prepay')::boolean, false) AND NOT COALESCE((s ->> 'allow_prepayment')::boolean, false) THEN out := out || 'prepay_disabled'; END IF;
  END IF;
  IF _t ->> 'model' = 'availability' AND COALESCE((_t ->> 'capacity_hours_per_week')::numeric, 0) NOT BETWEEN 0.5 AND 60 THEN out := out || 'capacity'; END IF;
  IF COALESCE(_t -> 'rate' ->> 'currency', '') !~ '^[A-Z]{3}$' THEN out := out || 'currency'; END IF;
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
  SELECT NOT COALESCE((_a.terms ->> 'nda_required')::boolean, true) OR EXISTS (
    SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = _a.consultant_id AND n.client_id = _a.client_id
       AND n.revoked_at IS NULL AND n.signed_at IS NOT NULL AND n.client_signed_at IS NOT NULL)
$$;

-- Rate in force on a day (latest agreed record whose effective date has come).
CREATE OR REPLACE FUNCTION public.sa_rate_on(_id uuid, _day date)
RETURNS public.sa_rate_records LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM public.sa_rate_records r WHERE r.agreement_id = _id AND r.effective_from <= _day ORDER BY r.effective_from DESC, r.seq DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.sa_new_version(_id uuid, _terms jsonb, _actor uuid, _note text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  UPDATE public.sa_agreements SET terms = _terms, version = version + 1, name = left(COALESCE(NULLIF(btrim(_terms ->> 'name'), ''), name), 120), updated_at = now()
   WHERE id = _id RETURNING version INTO v;
  INSERT INTO public.sa_versions (agreement_id, version, terms, content_hash, note, created_by) VALUES (_id, v, _terms, md5(_terms::text), left(COALESCE(_note, ''), 300), _actor);
  RETURN v;
END $$;

-- Merge an offer patch (rate / bank / term / capacity keys only) into the terms.
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
$$;
