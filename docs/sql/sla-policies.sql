-- =====================================================================================================================
-- SLA POLICIES (platform default + client policies, severities, business-hour clocks, escalations, reminders)
-- Prepared for owner review. NOT APPLIED. Idempotent: safe to run more than once. Rolled-back checks:
-- docs/sql/sla-policies.test.sql. Browser/worker mirror: supabase/functions/_shared/slaPolicy.ts. Notes: docs/sla-policies.md.
--
-- What it does
--   * Settings row platform_settings 'sla_policies' (enabled = false). While OFF nothing changes: tickets_apply_sla,
--     sla_deadline / sla_response_deadline, flag_sla_breaches and its "SLA breached" notices work exactly as today.
--   * sla_policies + immutable sla_policy_versions: one mandatory Platform default (seeded from today's live
--     ticket_sla_policies system rows, 24x7, measured from submission, breach notice to consultant + admins), three
--     admin templates (Standard, Enterprise 24x7, Business hours light) and client policies owned by a company
--     (tenant) or, without a company, by the client user.
--   * When ON, every NEW ticket gets an immutable snapshot (sla_ticket_snapshots) of the effective policy version and
--     three clocks (response, optional workaround, resolution) in sla_ticket_clocks. One tested pair of functions,
--     sla_business_minutes / sla_add_business_minutes, does all clock maths (coverage, time zone, DST, holidays).
--     Pauses (waiting for client info / third party / on hold / waiting for client / NDA / BRD approval) are stored
--     with their reason in sla_ticket_pauses. Existing tickets are not touched (no backfill notifications).
--   * The existing 5-minute cron job 'sla-breach-check' (flag_sla_breaches) also runs sla_sweep(): bounded batches,
--     idempotent reminders (sla_reminders_sent unique ticket+snapshot+step+recipient+repeat), notification pauses
--     respected except S1 steps the policy marks "cannot be paused", quiet hours in the consultant time zone except
--     S1, repeats >= 30 minutes apart and capped. In-app notices are written here; e-mail / push / Telegram go to
--     sla_delivery_queue and are sent by the sla-run function (job token, shared e-mail layout + sender settings,
--     one recipient per message, registered users only). SMS does not exist as a channel.
--   * Every write goes through SECURITY DEFINER RPCs with fixed search_path and role checks. Tables have RLS on and
--     NO browser grants: clients read their own company's policies, consultants only the snapshot of tickets they are
--     assigned to or bidding on, admins everything, all through RPCs. Audit log sla_audit.
--   * No financial penalty / credit logic. Extension point: sla_breach_financial_hook(ticket, clock) is a no-op.
--
-- Order: needs the live ticket-tracking objects (ticket_working_status, tt_viewer_role) which are applied. Optional
-- helpers (brd_gate_state, team_ticket_gated, check_rate_limit, contact_details_in_text, notifications_paused) are
-- probed with to_regprocedure so this file can be applied in any order.
-- =====================================================================================================================

-- ------------------------------------------------------------------------------------------------ settings
CREATE OR REPLACE FUNCTION public.sla_default_settings()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', false,
    'severities', jsonb_build_array(
      jsonb_build_object('key', 'S1', 'rank', 1, 'color', 'destructive', 'label_en', 'Critical', 'label_ar', 'حرج',
        'definition_en', 'Production is down or a business-critical process is blocked and there is no workaround.',
        'definition_ar', 'نظام الإنتاج متوقف أو عملية حرجة للأعمال متوقفة ولا يوجد حل بديل.'),
      jsonb_build_object('key', 'S2', 'rank', 2, 'color', 'warning', 'label_en', 'High', 'label_ar', 'مرتفع',
        'definition_en', 'A key function is seriously degraded or blocked for many users; a workaround is hard to use or missing.',
        'definition_ar', 'وظيفة أساسية متعطلة بشدة أو متوقفة لعدد كبير من المستخدمين، والحل البديل صعب أو غير موجود.'),
      jsonb_build_object('key', 'S3', 'rank', 3, 'color', 'info', 'label_en', 'Medium', 'label_ar', 'متوسط',
        'definition_en', 'A function does not work as expected; a reasonable workaround exists or few users are affected.',
        'definition_ar', 'وظيفة لا تعمل كما هو متوقع، ويوجد حل بديل مقبول أو يتأثر عدد قليل من المستخدمين.'),
      jsonb_build_object('key', 'S4', 'rank', 4, 'color', 'muted', 'label_en', 'Low', 'label_ar', 'منخفض',
        'definition_en', 'Question, how-to, small defect or change request with little business impact.',
        'definition_ar', 'سؤال أو استفسار عن طريقة استخدام أو عيب بسيط أو طلب تغيير بتأثير محدود على الأعمال.')),
    'urgency_map', jsonb_build_object('critical', 'S1', 'high', 'S2', 'medium', 'S3', 'low', 'S4'),
    'bounds', jsonb_build_object(
      'min_response', jsonb_build_object('S1', 15, 'S2', 30, 'S3', 60, 'S4', 120),
      'min_resolution', jsonb_build_object('S1', 120, 'S2', 240, 'S3', 480, 'S4', 960),
      'max_escalations', 6,
      'allowed_coverage', jsonb_build_array('24x7', 'business'),
      'allowed_start', jsonb_build_array('submitted', 'assigned', 'ready'),
      'allowed_pause', jsonb_build_array('waiting_client_info', 'waiting_third_party', 'on_hold', 'waiting_for_client', 'awaiting_nda', 'awaiting_brd_approval'),
      'premium', jsonb_build_array(jsonb_build_object('severity', 'S1', 'field', 'response', 'under_min', 60, 'requires', 'critical_service')),
      'max_repeats', 6, 'min_repeat_min', 30, 'max_extra_contacts', 5),
    'at_risk_pct', 75,
    'quiet_hours', jsonb_build_object('start', '22:00', 'end', '07:00'),
    'unpausable_allowed', true,
    'require_acceptance', true,
    'compliance_alert_pct', 90,
    'channels_enabled', jsonb_build_object('in_app', true, 'email', true, 'push', true, 'telegram', true))
$$;

-- Stored value over defaults; 'bounds' and 'channels_enabled' merge one level deep so a partial save keeps the rest.
CREATE OR REPLACE FUNCTION public.sla_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH d AS (SELECT public.sla_default_settings() AS v),
       s AS (SELECT COALESCE((SELECT ps.value FROM public.platform_settings ps WHERE ps.key = 'sla_policies' LIMIT 1), '{}'::jsonb) AS v)
  SELECT d.v || s.v
         || jsonb_build_object('bounds', (d.v -> 'bounds') || COALESCE(CASE WHEN jsonb_typeof(s.v -> 'bounds') = 'object' THEN s.v -> 'bounds' END, '{}'::jsonb))
         || jsonb_build_object('channels_enabled', (d.v -> 'channels_enabled') || COALESCE(CASE WHEN jsonb_typeof(s.v -> 'channels_enabled') = 'object' THEN s.v -> 'channels_enabled' END, '{}'::jsonb))
    FROM d, s
$$;

CREATE OR REPLACE FUNCTION public.sla_enabled()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((public.sla_settings() ->> 'enabled')::boolean, false)
$$;

INSERT INTO public.platform_settings (key, value) VALUES ('sla_policies', jsonb_build_object('enabled', false))
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------ tables
CREATE TABLE IF NOT EXISTS public.sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('platform', 'template', 'client')),
  tenant_id uuid,
  client_id uuid,
  template_key text,
  is_default boolean NOT NULL DEFAULT false,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  applies_to jsonb NOT NULL DEFAULT '{"kind":"all","values":[]}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  current_version integer NOT NULL DEFAULT 0,
  active_version integer,
  effective_from timestamptz,
  lock_version integer NOT NULL DEFAULT 0,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archive_reason text,
  CHECK (scope <> 'client' OR tenant_id IS NOT NULL OR client_id IS NOT NULL),
  CHECK (NOT is_default OR scope = 'platform')
);
CREATE UNIQUE INDEX IF NOT EXISTS sla_policies_one_default ON public.sla_policies ((true)) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS sla_policies_template_key ON public.sla_policies (template_key) WHERE template_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS sla_policies_owner ON public.sla_policies (tenant_id, client_id, status);

CREATE TABLE IF NOT EXISTS public.sla_policy_versions (
  policy_id uuid NOT NULL REFERENCES public.sla_policies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  body jsonb NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_note text NOT NULL DEFAULT '' CHECK (char_length(change_note) <= 500),
  content_hash text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, version)
);

CREATE TABLE IF NOT EXISTS public.sla_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_key text NOT NULL CHECK (list_key ~ '^[A-Za-z0-9_-]{1,24}$'),
  day date NOT NULL,
  label_en text NOT NULL DEFAULT '' CHECK (char_length(label_en) <= 120),
  label_ar text NOT NULL DEFAULT '' CHECK (char_length(label_ar) <= 120),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (list_key, day)
);

CREATE TABLE IF NOT EXISTS public.sla_ticket_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  policy_id uuid REFERENCES public.sla_policies(id) ON DELETE SET NULL,
  policy_version integer NOT NULL,
  policy_name text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('S1', 'S2', 'S3', 'S4')),
  data jsonb NOT NULL,
  reason text NOT NULL CHECK (reason IN ('created', 'reclassified', 'new_policy', 'counter_accepted')),
  reason_note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS sla_snapshots_one_active ON public.sla_ticket_snapshots (ticket_id) WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sla_ticket_clocks (
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('response', 'workaround', 'resolution')),
  snapshot_id uuid NOT NULL REFERENCES public.sla_ticket_snapshots(id) ON DELETE CASCADE,
  target_min integer NOT NULL CHECK (target_min > 0),
  extended_min integer NOT NULL DEFAULT 0 CHECK (extended_min >= 0),
  started_at timestamptz,
  running_since timestamptz,
  consumed_min numeric NOT NULL DEFAULT 0,
  paused_since timestamptz,
  pause_reason text,
  due_at timestamptz,
  met_at timestamptz,
  breached_at timestamptz,
  stopped_at timestamptz,
  swept_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, kind)
);
CREATE INDEX IF NOT EXISTS sla_clocks_open ON public.sla_ticket_clocks (swept_at NULLS FIRST) WHERE met_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sla_ticket_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  clock text NOT NULL,
  reason text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS sla_pauses_ticket ON public.sla_ticket_pauses (ticket_id, started_at);

-- Unified SLA timeline (shown to client, assigned consultants and admins; never person names, only roles).
CREATE TABLE IF NOT EXISTS public.sla_ticket_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  kind text NOT NULL,
  actor_id uuid,
  actor_role text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sla_events_ticket ON public.sla_ticket_events (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS public.sla_reminders_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL,
  step_key text NOT NULL,
  recipient_id uuid NOT NULL,
  seq integer NOT NULL DEFAULT 0,
  channels text[] NOT NULL DEFAULT '{}',
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, snapshot_id, step_key, recipient_id, seq)
);

CREATE TABLE IF NOT EXISTS public.sla_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  eta timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sla_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  policy_id uuid,
  policy_version integer NOT NULL,
  summary text NOT NULL,
  context text NOT NULL CHECK (context IN ('assignment', 'bid', 'team')),
  disclaimer_version text NOT NULL DEFAULT 'draft-1',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, consultant_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS public.sla_counter_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  proposal_id uuid,
  targets jsonb NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sla_counter_one_pending ON public.sla_counter_proposals (ticket_id, consultant_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.sla_reclass_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  from_severity text NOT NULL,
  to_severity text NOT NULL CHECK (to_severity IN ('S1', 'S2', 'S3', 'S4')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  proposed_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sla_reclass_one_pending ON public.sla_reclass_requests (ticket_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.sla_breach_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  clock text NOT NULL,
  choice text NOT NULL CHECK (choice IN ('extend', 'reassign', 'admin_help')),
  extend_min integer,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 500),
  chosen_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sla_delivery_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  clock text,
  channel text NOT NULL CHECK (channel IN ('email', 'push', 'telegram')),
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
CREATE INDEX IF NOT EXISTS sla_queue_pending ON public.sla_delivery_queue (created_at) WHERE sent_at IS NULL AND failed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.sla_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  policy_id uuid,
  ticket_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sla_audit_policy ON public.sla_audit (policy_id, created_at);

CREATE TABLE IF NOT EXISTS public.sla_alert_log (
  day date PRIMARY KEY,
  compliance numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- No browser access to any SLA table: everything goes through the functions below.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sla_policies', 'sla_policy_versions', 'sla_holidays', 'sla_ticket_snapshots', 'sla_ticket_clocks',
    'sla_ticket_pauses', 'sla_ticket_events', 'sla_reminders_sent', 'sla_acknowledgements', 'sla_acceptances',
    'sla_counter_proposals', 'sla_reclass_requests', 'sla_breach_choices', 'sla_delivery_queue', 'sla_audit', 'sla_alert_log'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Versions, snapshots, events, acceptances and the audit are append-only (snapshots may only be marked superseded).
CREATE OR REPLACE FUNCTION public.sla_guard_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Cascades from a deleted ticket/policy are allowed; direct deletes are not.
    IF pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'sla_immutable: % rows cannot be deleted', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'sla_ticket_snapshots' AND OLD.superseded_at IS NULL AND NEW.superseded_at IS NOT NULL
     AND (to_jsonb(NEW) - 'superseded_at') = (to_jsonb(OLD) - 'superseded_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'sla_immutable: % rows cannot be changed', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sla_policy_versions', 'sla_ticket_snapshots', 'sla_ticket_events', 'sla_acceptances', 'sla_audit'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sla_immutable ON public.%I', t);
    EXECUTE format('CREATE TRIGGER sla_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.sla_guard_immutable()', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------ small helpers
CREATE OR REPLACE FUNCTION public.sla_is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = _uid AND r.role IN ('admin'::app_role, 'super_admin'::app_role))
$$;

-- Company owner/admin (or the client himself when the policy has no company) may manage; any member may read.
CREATE OR REPLACE FUNCTION public.sla_can_manage(_uid uuid, _tenant uuid, _client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.sla_is_admin(_uid)
    OR (_tenant IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = _tenant AND m.user_id = _uid
                                          AND m.org_role IN ('owner'::org_role, 'admin'::org_role) AND m.accepted_at IS NOT NULL))
    OR (_tenant IS NULL AND _client = _uid AND public.has_role(_uid, 'client'::app_role)))
$$;

CREATE OR REPLACE FUNCTION public.sla_can_read_owner(_uid uuid, _tenant uuid, _client uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.sla_can_manage(_uid, _tenant, _client)
    OR (_tenant IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = _tenant AND m.user_id = _uid AND m.accepted_at IS NOT NULL))
    OR (_tenant IS NULL AND _client = _uid))
$$;

CREATE OR REPLACE FUNCTION public.sla_text_ok(_t text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _t IS NULL OR _t = '' THEN RETURN true; END IF;
  IF to_regprocedure('public.contact_details_in_text(text)') IS NOT NULL THEN
    RETURN NOT public.contact_details_in_text(_t);
  END IF;
  RETURN _t !~* '([a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,})|(https?://|www\.)|(\+|\m00)\d[\d\s().-]{7,}\d';
END $$;

CREATE OR REPLACE FUNCTION public.sla_rate_ok(_bucket text, _limit integer, _seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regprocedure('public.check_rate_limit(text,integer,integer)') IS NULL THEN RETURN true; END IF;
  RETURN public.check_rate_limit(_bucket, _limit, _seconds);
END $$;

CREATE OR REPLACE FUNCTION public.sla_lang(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN (SELECT p.preferred_language FROM public.profiles p WHERE p.user_id = _user LIMIT 1) = 'ar' THEN 'ar' ELSE 'en' END
$$;

CREATE OR REPLACE FUNCTION public.sla_fmt_minutes(_min numeric, _lang text DEFAULT 'en')
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH m AS (SELECT GREATEST(0, round(COALESCE(_min, 0)))::integer AS v)
  SELECT CASE
    WHEN v >= 1440 THEN (v / 1440)::text || CASE WHEN _lang = 'ar' THEN ' ي' ELSE ' d' END
                        || CASE WHEN (v % 1440) / 60 > 0 THEN ' ' || ((v % 1440) / 60)::text || CASE WHEN _lang = 'ar' THEN ' س' ELSE ' h' END ELSE '' END
    WHEN v >= 60 THEN (v / 60)::text || CASE WHEN _lang = 'ar' THEN ' س' ELSE ' h' END
                      || CASE WHEN v % 60 > 0 THEN ' ' || (v % 60)::text || CASE WHEN _lang = 'ar' THEN ' د' ELSE ' m' END ELSE '' END
    ELSE v::text || CASE WHEN _lang = 'ar' THEN ' د' ELSE ' m' END END
  FROM m
$$;

CREATE OR REPLACE FUNCTION public.sla_hash(_body jsonb, _meta jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, extensions AS $$
  SELECT md5(COALESCE(_body::text, '') || '|' || COALESCE(_meta::text, ''))
$$;

-- Extension point only (owner: no automatic penalty or credit). Kept as a no-op so a later feature can hook in.
CREATE OR REPLACE FUNCTION public.sla_breach_financial_hook(_ticket uuid, _clock text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ SELECT NULL::void $$;

-- ------------------------------------------------------------------------------------------------ clock maths
-- The ONLY implementation of counted minutes. _cal = resolved calendar {mode, tz, days[0=Sun..6], start, end, holidays[]}.
-- 24x7 counts every minute. Business: for every local date in the time zone, the window start-end (local wall time,
-- converted with AT TIME ZONE so daylight saving is handled) unless the weekday is not a working day or a holiday.
CREATE OR REPLACE FUNCTION public.sla_business_minutes(_from timestamptz, _to timestamptz, _cal jsonb)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  tz text := COALESCE(NULLIF(_cal ->> 'tz', ''), 'UTC');
  wd int[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(_cal -> 'days', '[]'::jsonb))::int);
  hol date[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(_cal -> 'holidays', '[]'::jsonb))::date);
  st time := COALESCE(NULLIF(_cal ->> 'start', ''), '09:00')::time;
  en time := COALESCE(NULLIF(_cal ->> 'end', ''), '17:00')::time;
  d date; last date; ws timestamptz; we timestamptz; total numeric := 0; i int := 0;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN RETURN 0; END IF;
  IF COALESCE(_cal ->> 'mode', '24x7') <> 'business' THEN RETURN extract(epoch FROM _to - _from) / 60; END IF;
  d := (_from AT TIME ZONE tz)::date;
  last := (_to AT TIME ZONE tz)::date;
  WHILE d <= last AND i < 3700 LOOP
    IF extract(dow FROM d)::int = ANY (wd) AND NOT (d = ANY (hol)) THEN
      ws := (d + st) AT TIME ZONE tz;
      we := (d + en) AT TIME ZONE tz;
      IF we > ws AND LEAST(_to, we) > GREATEST(_from, ws) THEN
        total := total + extract(epoch FROM LEAST(_to, we) - GREATEST(_from, ws)) / 60;
      END IF;
    END IF;
    d := d + 1; i := i + 1;
  END LOOP;
  RETURN total;
END $$;

CREATE OR REPLACE FUNCTION public.sla_add_business_minutes(_from timestamptz, _minutes numeric, _cal jsonb)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  tz text := COALESCE(NULLIF(_cal ->> 'tz', ''), 'UTC');
  wd int[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(_cal -> 'days', '[]'::jsonb))::int);
  hol date[] := ARRAY(SELECT jsonb_array_elements_text(COALESCE(_cal -> 'holidays', '[]'::jsonb))::date);
  st time := COALESCE(NULLIF(_cal ->> 'start', ''), '09:00')::time;
  en time := COALESCE(NULLIF(_cal ->> 'end', ''), '17:00')::time;
  d date; ws timestamptz; we timestamptz; s timestamptz; avail numeric; left_min numeric := _minutes; i int := 0;
BEGIN
  IF _from IS NULL THEN RETURN NULL; END IF;
  IF COALESCE(_minutes, 0) <= 0 THEN RETURN _from; END IF;
  IF COALESCE(_cal ->> 'mode', '24x7') <> 'business' THEN RETURN _from + make_interval(secs => _minutes * 60); END IF;
  d := (_from AT TIME ZONE tz)::date;
  WHILE i < 3700 LOOP
    IF extract(dow FROM d)::int = ANY (wd) AND NOT (d = ANY (hol)) THEN
      ws := (d + st) AT TIME ZONE tz;
      we := (d + en) AT TIME ZONE tz;
      s := GREATEST(_from, ws);
      IF we > s THEN
        avail := extract(epoch FROM we - s) / 60;
        IF left_min <= avail THEN RETURN s + make_interval(secs => left_min * 60); END IF;
        left_min := left_min - avail;
      END IF;
    END IF;
    d := d + 1; i := i + 1;
  END LOOP;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.sla_valid_tz(_tz text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT _tz IS NOT NULL AND length(_tz) <= 64 AND EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = _tz)
$$;

-- Coverage of a policy + company time zone + admin holiday lists -> the calendar stored in a snapshot.
CREATE OR REPLACE FUNCTION public.sla_resolve_calendar(_coverage jsonb, _company_tz text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE tz text; hol jsonb;
BEGIN
  tz := CASE WHEN public.sla_valid_tz(_coverage ->> 'tz') THEN _coverage ->> 'tz'
             WHEN public.sla_valid_tz(_company_tz) THEN _company_tz ELSE 'UTC' END;
  SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb) INTO hol FROM (
    SELECT jsonb_array_elements_text(COALESCE(_coverage -> 'holidays', '[]'::jsonb)) AS x
    UNION
    SELECT h.day::text FROM public.sla_holidays h
     WHERE h.list_key IN (SELECT jsonb_array_elements_text(COALESCE(_coverage -> 'holiday_lists', '[]'::jsonb)))
       AND h.day BETWEEN (now() - interval '60 days')::date AND (now() + interval '3 years')::date) q;
  RETURN jsonb_build_object('mode', COALESCE(_coverage ->> 'mode', '24x7'), 'tz', tz,
    'days', COALESCE(_coverage -> 'days', '[0,1,2,3,4]'::jsonb), 'start', COALESCE(_coverage ->> 'start', '09:00'),
    'end', COALESCE(_coverage ->> 'end', '17:00'), 'holidays', hol);
END $$;

-- ------------------------------------------------------------------------------------------------ validation
-- Same rules and codes as policyProblems() in _shared/slaPolicy.ts. Errors block saving as active; warnings explain.
CREATE OR REPLACE FUNCTION public.sla_policy_problems(_body jsonb, _meta jsonb, _tenant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := public.sla_settings();
  b jsonb := s -> 'bounds';
  out jsonb := '[]'::jsonb;
  k text; sev jsonb; st jsonb; i int; r numeric; w numeric; res numeric; pr jsonb; ch text; who text; e text; dom text;
  cov jsonb := COALESCE(_body -> 'coverage', '{}'::jsonb);
  last_p jsonb; th numeric;
  allowed_domain text;
BEGIN
  IF jsonb_typeof(_body) <> 'object' OR jsonb_typeof(_body -> 'severities') <> 'object' THEN
    RETURN jsonb_build_array(jsonb_build_object('code', 'bad_shape', 'level', 'error', 'path', ''));
  END IF;
  IF char_length(btrim(COALESCE(_meta ->> 'name', ''))) NOT BETWEEN 1 AND 120 THEN
    out := out || jsonb_build_object('code', 'name_length', 'level', 'error', 'path', 'name');
  END IF;
  IF char_length(COALESCE(_meta ->> 'description', '')) > 1000 THEN
    out := out || jsonb_build_object('code', 'description_length', 'level', 'error', 'path', 'description');
  END IF;
  IF NOT public.sla_text_ok(COALESCE(_meta ->> 'name', '') || ' ' || COALESCE(_meta ->> 'description', '')) THEN
    out := out || jsonb_build_object('code', 'contact_details', 'level', 'error', 'path', 'description');
  END IF;
  IF COALESCE(_meta -> 'applies_to' ->> 'kind', 'all') NOT IN ('all', 'sap_area', 'module') THEN
    out := out || jsonb_build_object('code', 'applies_unknown', 'level', 'error', 'path', 'applies_to');
  ELSIF COALESCE(_meta -> 'applies_to' ->> 'kind', 'all') <> 'all' AND jsonb_array_length(COALESCE(_meta -> 'applies_to' -> 'values', '[]'::jsonb)) = 0 THEN
    out := out || jsonb_build_object('code', 'applies_empty', 'level', 'error', 'path', 'applies_to');
  END IF;

  FOREACH k IN ARRAY ARRAY['S1', 'S2', 'S3', 'S4'] LOOP
    sev := _body -> 'severities' -> k;
    IF jsonb_typeof(sev) <> 'object' OR jsonb_typeof(sev -> 'response_min') <> 'number' OR jsonb_typeof(sev -> 'resolution_min') <> 'number' THEN
      out := out || jsonb_build_object('code', 'bad_shape', 'level', 'error', 'path', 'severities.' || k);
      CONTINUE;
    END IF;
    r := (sev ->> 'response_min')::numeric; res := (sev ->> 'resolution_min')::numeric;
    w := CASE WHEN jsonb_typeof(sev -> 'workaround_min') = 'number' THEN (sev ->> 'workaround_min')::numeric END;
    IF r < COALESCE((b -> 'min_response' ->> k)::numeric, 1) OR r < 1 OR r > 525600 THEN
      out := out || jsonb_build_object('code', 'below_min_response', 'level', 'error', 'path', 'severities.' || k || '.response_min',
        'params', jsonb_build_object('severity', k, 'min', b -> 'min_response' -> k));
    END IF;
    IF res < COALESCE((b -> 'min_resolution' ->> k)::numeric, 1) OR res > 525600 THEN
      out := out || jsonb_build_object('code', 'below_min_resolution', 'level', 'error', 'path', 'severities.' || k || '.resolution_min',
        'params', jsonb_build_object('severity', k, 'min', b -> 'min_resolution' -> k));
    END IF;
    IF res <= r THEN
      out := out || jsonb_build_object('code', 'resolution_before_response', 'level', 'error', 'path', 'severities.' || k || '.resolution_min', 'params', jsonb_build_object('severity', k));
    END IF;
    IF w IS NOT NULL AND (w < r OR w > res) THEN
      out := out || jsonb_build_object('code', 'workaround_order', 'level', 'error', 'path', 'severities.' || k || '.workaround_min', 'params', jsonb_build_object('severity', k));
    END IF;
    FOR pr IN SELECT x FROM jsonb_array_elements(COALESCE(b -> 'premium', '[]'::jsonb)) x WHERE x ->> 'severity' = k LOOP
      IF (CASE WHEN pr ->> 'field' = 'resolution' THEN res ELSE r END) < (pr ->> 'under_min')::numeric THEN
        out := out || jsonb_build_object('code', 'premium_required', 'level', 'warning', 'path', 'severities.' || k || '.' || (pr ->> 'field') || '_min',
          'params', jsonb_build_object('severity', k, 'under', pr -> 'under_min', 'requires', pr -> 'requires'));
      END IF;
    END LOOP;
    IF jsonb_array_length(COALESCE(sev -> 'escalations', '[]'::jsonb)) > COALESCE((b ->> 'max_escalations')::int, 6) THEN
      out := out || jsonb_build_object('code', 'too_many_steps', 'level', 'error', 'path', 'severities.' || k || '.escalations',
        'params', jsonb_build_object('severity', k, 'max', b -> 'max_escalations'));
    END IF;
    last_p := '{}'::jsonb;
    FOR st, i IN SELECT x, n::int FROM jsonb_array_elements(COALESCE(sev -> 'escalations', '[]'::jsonb)) WITH ORDINALITY AS t(x, n) LOOP
      IF COALESCE(st ->> 'clock', '') NOT IN ('response', 'workaround', 'resolution') OR COALESCE(st ->> 'kind', '') NOT IN ('percent', 'after_breach')
         OR jsonb_typeof(st -> 'value') <> 'number'
         OR (st ->> 'kind' = 'percent' AND (st ->> 'value')::numeric NOT BETWEEN 1 AND 100)
         OR (st ->> 'kind' = 'after_breach' AND (st ->> 'value')::numeric NOT BETWEEN 1 AND 10080)
         OR COALESCE(st ->> 'template', '') NOT IN ('reminder', 'escalation', 'breach', 'after_breach') THEN
        out := out || jsonb_build_object('code', 'bad_step', 'level', 'error', 'path', 'severities.' || k || '.escalations.' || (i - 1), 'params', jsonb_build_object('severity', k, 'step', i));
        CONTINUE;
      END IF;
      IF jsonb_array_length(COALESCE(st -> 'who', '[]'::jsonb)) = 0 THEN
        out := out || jsonb_build_object('code', 'step_no_recipient', 'level', 'error', 'path', 'severities.' || k || '.escalations.' || (i - 1), 'params', jsonb_build_object('severity', k, 'step', i));
      END IF;
      FOR who IN SELECT jsonb_array_elements_text(COALESCE(st -> 'who', '[]'::jsonb)) LOOP
        IF who NOT IN ('lead', 'support', 'all_assigned', 'client_contact', 'client_manager', 'admin', 'extra') THEN
          out := out || jsonb_build_object('code', 'recipient_unknown', 'level', 'error', 'path', 'severities.' || k || '.escalations.' || (i - 1), 'params', jsonb_build_object('severity', k, 'step', i));
        ELSIF who = 'extra' AND jsonb_array_length(COALESCE(_body -> 'extra_contacts', '[]'::jsonb)) = 0 THEN
          out := out || jsonb_build_object('code', 'step_extra_missing', 'level', 'error', 'path', 'severities.' || k || '.escalations.' || (i - 1), 'params', jsonb_build_object('severity', k, 'step', i));
        END IF;
      END LOOP;
      IF jsonb_array_length(COALESCE(st -> 'channels', '[]'::jsonb)) = 0 THEN
        out := out || jsonb_build_object('code', 'step_no_channel', 'level', 'error', 'path', 'severities.' || k || '.escalations.' || (i - 1), 'params', jsonb_build_object('severity', k, 'step', i));
      END IF;
      FOR ch IN SELECT jsonb_array_elements_text(COALESCE(st -> 'channels', '[]'::jsonb)) LOOP
        IF ch NOT IN ('in_app', 'email', 'push', 'telegram') THEN   -- SMS (or anything else) is never a channel
          out := out || jsonb_build_object('code', 'channel_not_allowed', 'level', 'error', 'path', 'severities.' || k || '.escalations.' || (i - 1), 'params', jsonb_build_object('severity', k, 'step', i));
        END IF;
      END LOOP;
      IF st ->> 'clock' = 'workaround' AND w IS NULL THEN
        out := out || jsonb_build_object('code', 'step_no_workaround', 'level', 'error', 'path', 'severities.' || k || '.escalations.' || (i - 1), 'params', jsonb_build_object('severity', k, 'step', i));
      END IF;
      IF jsonb_typeof(st -> 'repeat_min') = 'number' AND (st ->> 'repeat_min')::numeric < GREATEST(30, COALESCE((b ->> 'min_repeat_min')::numeric, 30)) THEN
        out := out || jsonb_build_object('code', 'repeat_too_often', 'level', 'error', 'path', 'severities.' || k || '.escalations.' || (i - 1),
          'params', jsonb_build_object('severity', k, 'step', i, 'min', GREATEST(30, COALESCE((b ->> 'min_repeat_min')::numeric, 30))));
      END IF;
      IF COALESCE((st ->> 'unpausable')::boolean, false) AND (k <> 'S1' OR NOT COALESCE((s ->> 'unpausable_allowed')::boolean, true)) THEN
        out := out || jsonb_build_object('code', 'unpausable_not_allowed', 'level', 'error', 'path', 'severities.' || k || '.escalations.' || (i - 1), 'params', jsonb_build_object('severity', k, 'step', i));
      END IF;
      th := CASE WHEN st ->> 'kind' = 'percent' THEN (st ->> 'value')::numeric ELSE 100 + (st ->> 'value')::numeric / 1000 END;
      IF last_p ? (st ->> 'clock') AND th <= (last_p ->> (st ->> 'clock'))::numeric THEN
        out := out || jsonb_build_object('code', 'steps_order', 'level', 'error', 'path', 'severities.' || k || '.escalations.' || (i - 1), 'params', jsonb_build_object('severity', k, 'step', i));
      END IF;
      last_p := last_p || jsonb_build_object(st ->> 'clock', th);
    END LOOP;
  END LOOP;

  IF NOT (COALESCE(b -> 'allowed_coverage', '[]'::jsonb) ? COALESCE(cov ->> 'mode', '')) THEN
    out := out || jsonb_build_object('code', 'coverage_not_allowed', 'level', 'error', 'path', 'coverage.mode', 'params', jsonb_build_object('mode', cov ->> 'mode'));
  END IF;
  IF NULLIF(cov ->> 'tz', '') IS NOT NULL AND NOT public.sla_valid_tz(cov ->> 'tz') THEN
    out := out || jsonb_build_object('code', 'bad_timezone', 'level', 'error', 'path', 'coverage.tz');
  END IF;
  IF cov ->> 'mode' = 'business' THEN
    IF jsonb_array_length(COALESCE(cov -> 'days', '[]'::jsonb)) = 0 THEN
      out := out || jsonb_build_object('code', 'no_working_days', 'level', 'error', 'path', 'coverage.days');
    END IF;
    IF COALESCE(cov ->> 'start', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' OR COALESCE(cov ->> 'end', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
       OR (cov ->> 'end') <= (cov ->> 'start') THEN
      out := out || jsonb_build_object('code', 'end_before_start', 'level', 'error', 'path', 'coverage.end');
    END IF;
  END IF;
  IF jsonb_array_length(COALESCE(cov -> 'holidays', '[]'::jsonb)) > 200 THEN
    out := out || jsonb_build_object('code', 'too_many_holidays', 'level', 'error', 'path', 'coverage.holidays');
  END IF;
  IF NOT (COALESCE(b -> 'allowed_start', '[]'::jsonb) ? COALESCE(_body -> 'clock' ->> 'start', '')) THEN
    out := out || jsonb_build_object('code', 'start_not_allowed', 'level', 'error', 'path', 'clock.start');
  END IF;
  FOR ch IN SELECT jsonb_array_elements_text(COALESCE(_body -> 'clock' -> 'pause', '[]'::jsonb)) LOOP
    IF NOT (COALESCE(b -> 'allowed_pause', '[]'::jsonb) ? ch) THEN
      out := out || jsonb_build_object('code', 'pause_not_allowed', 'level', 'error', 'path', 'clock.pause', 'params', jsonb_build_object('pause', ch));
    END IF;
  END LOOP;

  -- Extra contacts: registered, accepted members of the owning company with an address on the company's domain.
  IF jsonb_array_length(COALESCE(_body -> 'extra_contacts', '[]'::jsonb)) > COALESCE((b ->> 'max_extra_contacts')::int, 5) THEN
    out := out || jsonb_build_object('code', 'too_many_contacts', 'level', 'error', 'path', 'extra_contacts', 'params', jsonb_build_object('max', b -> 'max_extra_contacts'));
  END IF;
  SELECT lower(NULLIF(btrim(regexp_replace(t.domain, '^(https?://)?(www\.)?', '')), '')) INTO allowed_domain FROM public.tenants t WHERE t.id = _tenant;
  FOR e IN SELECT lower(btrim(x)) FROM jsonb_array_elements_text(COALESCE(_body -> 'extra_contacts', '[]'::jsonb)) x LOOP
    dom := split_part(e, '@', 2);
    IF e !~ '^[a-z0-9._%+-]+@([a-z0-9-]+\.)+[a-z]{2,}$' THEN
      out := out || jsonb_build_object('code', 'contact_invalid', 'level', 'error', 'path', 'extra_contacts', 'params', jsonb_build_object('email', e));
    ELSIF allowed_domain IS NULL OR dom <> allowed_domain THEN
      out := out || jsonb_build_object('code', 'contact_domain', 'level', 'error', 'path', 'extra_contacts', 'params', jsonb_build_object('email', e));
    ELSIF NOT EXISTS (SELECT 1 FROM public.tenant_members m JOIN auth.users u ON u.id = m.user_id
                       WHERE m.tenant_id = _tenant AND m.accepted_at IS NOT NULL AND lower(u.email) = e) THEN
      out := out || jsonb_build_object('code', 'contact_not_member', 'level', 'error', 'path', 'extra_contacts', 'params', jsonb_build_object('email', e));
    END IF;
  END LOOP;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION public.sla_has_errors(_problems jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_problems, '[]'::jsonb)) p WHERE p ->> 'level' = 'error')
$$;
