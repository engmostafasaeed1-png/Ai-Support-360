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

-- ------------------------------------------------------------------------------------------------ people on a ticket
CREATE OR REPLACE FUNCTION public.sla_assigned(_ticket uuid)
RETURNS TABLE (consultant_id uuid, user_id uuid, is_lead boolean, tz text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ids AS (
    SELECT t.consultant_id AS cid, true AS lead FROM public.tickets t WHERE t.id = _ticket AND t.consultant_id IS NOT NULL
    UNION ALL
    SELECT a.consultant_id, a.role::text = 'lead' FROM public.ticket_assignments a
     WHERE a.ticket_id = _ticket AND a.status::text = 'active' AND a.role::text IN ('lead', 'support')
    UNION ALL
    SELECT m.consultant_id, COALESCE(m.is_primary, false) OR m.team_role = 'lead' FROM public.ticket_team_members m
     WHERE m.ticket_id = _ticket AND m.status IN ('ready', 'active'))
  SELECT c.id, c.user_id, bool_or(ids.lead), max(c.timezone)
    FROM ids JOIN public.consultants c ON c.id = ids.cid
   WHERE c.user_id IS NOT NULL
   GROUP BY c.id, c.user_id
$$;

-- Role of a viewer on one ticket for SLA purposes. 'candidate' = consultant invited / requested / bidding.
CREATE OR REPLACE FUNCTION public.sla_ticket_role(_ticket uuid, _uid uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; cid uuid;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  SELECT tk.id, tk.client_id, tk.tenant_id INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF public.sla_is_admin(_uid) THEN RETURN 'admin'; END IF;
  IF t.client_id = _uid THEN RETURN 'client'; END IF;
  IF t.tenant_id IS NOT NULL AND public.sla_can_manage(_uid, t.tenant_id, t.client_id) THEN RETURN 'client_manager'; END IF;
  IF t.tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = t.tenant_id AND m.user_id = _uid AND m.accepted_at IS NOT NULL) THEN
    RETURN 'company';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sla_assigned(_ticket) a WHERE a.user_id = _uid) THEN RETURN 'consultant'; END IF;
  SELECT c.id INTO cid FROM public.consultants c WHERE c.user_id = _uid LIMIT 1;
  IF cid IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.ticket_match_requests q WHERE q.ticket_id = _ticket AND q.consultant_id = cid AND q.status::text = 'pending')
    OR EXISTS (SELECT 1 FROM public.proposals p WHERE p.ticket_id = _ticket AND p.consultant_id = cid AND p.status::text = 'pending')
    OR EXISTS (SELECT 1 FROM public.ticket_team_members m WHERE m.ticket_id = _ticket AND m.consultant_id = cid
                 AND m.status NOT IN ('declined', 'ended', 'removed', 'expired', 'replaced', 'ready', 'active'))
    OR EXISTS (SELECT 1 FROM public.tickets tk WHERE tk.id = _ticket AND tk.open_for_bids IS TRUE AND tk.consultant_id IS NULL
                 AND public.has_role(_uid, 'consultant'::app_role))) THEN
    RETURN 'candidate';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.sla_client_can_act(_ticket uuid, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.sla_ticket_role(_ticket, _uid) IN ('client', 'client_manager', 'admin')
$$;

-- ------------------------------------------------------------------------------------------------ effective policy + snapshot
CREATE OR REPLACE FUNCTION public.sla_severity_for(_urgency text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN x IN ('S1', 'S2', 'S3', 'S4') THEN x ELSE 'S3' END
    FROM (SELECT COALESCE(public.sla_settings() -> 'urgency_map' ->> COALESCE(_urgency, 'medium'), 'S3') AS x) q
$$;

-- Most specific active client policy of the ticket owner (module > SAP area > all; newest effective first), else the
-- platform default. Draft and archived policies never apply; effective_from in the future does not apply yet.
CREATE OR REPLACE FUNCTION public.sla_effective_policy(_ticket uuid)
RETURNS TABLE (policy_id uuid, version integer, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (SELECT tk.* FROM public.tickets tk WHERE tk.id = _ticket),
  c AS (
    SELECT p.id, p.active_version, p.name,
           CASE p.applies_to ->> 'kind' WHEN 'module' THEN 0 WHEN 'sap_area' THEN 1 ELSE 2 END AS rank, p.effective_from
      FROM public.sla_policies p, t
     WHERE p.scope = 'client' AND p.status = 'active' AND p.active_version IS NOT NULL AND p.effective_from <= now()
       AND ((t.tenant_id IS NOT NULL AND p.tenant_id = t.tenant_id) OR (p.tenant_id IS NULL AND p.client_id = t.client_id))
       AND (COALESCE(p.applies_to ->> 'kind', 'all') = 'all'
         OR (p.applies_to ->> 'kind' = 'sap_area' AND t.sap_module = ANY (ARRAY(SELECT jsonb_array_elements_text(p.applies_to -> 'values'))))
         OR (p.applies_to ->> 'kind' = 'module' AND (t.sap_module = ANY (ARRAY(SELECT jsonb_array_elements_text(p.applies_to -> 'values')))
               OR COALESCE(t.sap_modules, '{}') && ARRAY(SELECT jsonb_array_elements_text(p.applies_to -> 'values')))))
  )
  SELECT * FROM (
    (SELECT c.id, c.active_version, c.name FROM c ORDER BY c.rank, c.effective_from DESC LIMIT 1)
    UNION ALL
    (SELECT p.id, p.active_version, p.name FROM public.sla_policies p WHERE p.is_default AND p.active_version IS NOT NULL LIMIT 1)
  ) q LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.sla_snapshot_data(_policy uuid, _version integer, _severity text, _ticket uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  body jsonb; t record; tz text; sev jsonb; r int; res int; w int; capped boolean := false; pr jsonb;
BEGIN
  SELECT v.body INTO body FROM public.sla_policy_versions v WHERE v.policy_id = _policy AND v.version = _version;
  IF body IS NULL THEN RETURN NULL; END IF;
  SELECT tk.client_id, COALESCE(tk.critical_response, false) AS critical INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  SELECT cp.timezone INTO tz FROM public.client_profiles cp WHERE cp.user_id = t.client_id LIMIT 1;
  sev := body -> 'severities' -> _severity;
  r := (sev ->> 'response_min')::int; res := (sev ->> 'resolution_min')::int;
  w := CASE WHEN jsonb_typeof(sev -> 'workaround_min') = 'number' THEN (sev ->> 'workaround_min')::int END;
  IF NOT t.critical THEN
    FOR pr IN SELECT x FROM jsonb_array_elements(COALESCE(public.sla_settings() -> 'bounds' -> 'premium', '[]'::jsonb)) x WHERE x ->> 'severity' = _severity LOOP
      IF pr ->> 'field' = 'response' AND r < (pr ->> 'under_min')::int THEN r := (pr ->> 'under_min')::int; capped := true; END IF;
      IF pr ->> 'field' = 'resolution' AND res < (pr ->> 'under_min')::int THEN res := (pr ->> 'under_min')::int; capped := true; END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object(
    'severity', _severity, 'response_min', r, 'workaround_min', w, 'resolution_min', GREATEST(res, r + 1), 'premium_capped', capped,
    'calendar', public.sla_resolve_calendar(body -> 'coverage', tz),
    'clock', COALESCE(body -> 'clock', '{"start":"submitted","pause":[],"stop":"resolved"}'::jsonb),
    'escalations', COALESCE(sev -> 'escalations', '[]'::jsonb),
    'breach', COALESCE(body -> 'breach', '{"notify":true,"flag":true}'::jsonb),
    'extra_contacts', COALESCE(body -> 'extra_contacts', '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.sla_event(_ticket uuid, _kind text, _actor uuid, _data jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.sla_ticket_events (ticket_id, kind, actor_id, actor_role, data)
  VALUES (_ticket, _kind, _actor, CASE WHEN _actor IS NULL THEN 'system' ELSE COALESCE(public.sla_ticket_role(_ticket, _actor), 'system') END,
          COALESCE(_data, '{}'::jsonb));
END $$;

-- Copies the effective (or given) policy version onto the ticket and (re)creates its clocks.
--   _mode 'fresh'  : new clocks (ticket creation); on 'reclassified' started clocks restart from now with the new targets.
--   _mode 'carry'  : keep counted minutes and met state, only targets/calendar change ("apply new policy", counter offer).
CREATE OR REPLACE FUNCTION public.sla_apply_snapshot(_ticket uuid, _reason text, _actor uuid, _mode text DEFAULT 'fresh',
  _severity text DEFAULT NULL, _note text DEFAULT NULL, _policy uuid DEFAULT NULL, _version integer DEFAULT NULL, _override jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t record; old public.sla_ticket_snapshots; pid uuid := _policy; ver integer := _version; pname text; sev text; data jsonb; sid uuid;
  k text; tgt int; oc public.sla_ticket_clocks; used numeric; nowt timestamptz := now();
BEGIN
  SELECT tk.id, tk.urgency::text AS urgency INTO t FROM public.tickets tk WHERE tk.id = _ticket FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT s.* INTO old FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL FOR UPDATE;
  sev := COALESCE(_severity, public.sla_severity_for(t.urgency));
  IF pid IS NULL THEN
    SELECT e.policy_id, e.version INTO pid, ver FROM public.sla_effective_policy(_ticket) e;
  ELSIF ver IS NULL THEN
    SELECT p.active_version INTO ver FROM public.sla_policies p WHERE p.id = pid;
  END IF;
  IF pid IS NULL OR ver IS NULL THEN RETURN NULL; END IF;
  SELECT p.name INTO pname FROM public.sla_policies p WHERE p.id = pid;
  data := public.sla_snapshot_data(pid, ver, sev, _ticket);
  IF data IS NULL THEN RETURN NULL; END IF;
  IF _override IS NOT NULL THEN
    data := data || jsonb_strip_nulls(jsonb_build_object(
      'response_min', _override -> 'response_min', 'resolution_min', _override -> 'resolution_min', 'workaround_min', _override -> 'workaround_min',
      'counter_offer', true));
  END IF;
  IF old.id IS NOT NULL THEN UPDATE public.sla_ticket_snapshots SET superseded_at = nowt WHERE id = old.id; END IF;
  INSERT INTO public.sla_ticket_snapshots (ticket_id, policy_id, policy_version, policy_name, severity, data, reason, reason_note, created_by)
  VALUES (_ticket, pid, ver, pname, sev, data, _reason, left(_note, 500), _actor) RETURNING id INTO sid;

  IF jsonb_typeof(data -> 'workaround_min') <> 'number' THEN
    DELETE FROM public.sla_ticket_clocks c WHERE c.ticket_id = _ticket AND c.kind = 'workaround';
  END IF;
  FOREACH k IN ARRAY ARRAY['response', 'workaround', 'resolution'] LOOP
    IF jsonb_typeof(data -> (k || '_min')) <> 'number' THEN CONTINUE; END IF;
    tgt := (data ->> (k || '_min'))::int;
    SELECT c.* INTO oc FROM public.sla_ticket_clocks c WHERE c.ticket_id = _ticket AND c.kind = k FOR UPDATE;
    IF oc.ticket_id IS NULL THEN
      INSERT INTO public.sla_ticket_clocks (ticket_id, kind, snapshot_id, target_min) VALUES (_ticket, k, sid, tgt);
    ELSIF oc.met_at IS NOT NULL THEN
      UPDATE public.sla_ticket_clocks SET snapshot_id = sid, target_min = tgt, updated_at = nowt WHERE ticket_id = _ticket AND kind = k;
    ELSIF _mode = 'carry' THEN
      used := oc.consumed_min + CASE WHEN oc.running_since IS NOT NULL THEN public.sla_business_minutes(oc.running_since, nowt, old.data -> 'calendar') ELSE 0 END;
      UPDATE public.sla_ticket_clocks SET snapshot_id = sid, target_min = tgt, consumed_min = used,
             running_since = CASE WHEN oc.running_since IS NOT NULL THEN nowt END,
             breached_at = CASE WHEN used >= tgt + oc.extended_min THEN COALESCE(oc.breached_at, nowt) END, updated_at = nowt
       WHERE ticket_id = _ticket AND kind = k;
    ELSE
      UPDATE public.sla_ticket_clocks SET snapshot_id = sid, target_min = tgt, extended_min = 0, consumed_min = 0, breached_at = NULL, due_at = NULL,
             started_at = CASE WHEN oc.started_at IS NOT NULL THEN nowt END,
             running_since = CASE WHEN oc.running_since IS NOT NULL THEN nowt END,
             paused_since = CASE WHEN oc.paused_since IS NOT NULL THEN nowt END, updated_at = nowt
       WHERE ticket_id = _ticket AND kind = k;
    END IF;
  END LOOP;

  PERFORM public.sla_event(_ticket, CASE _reason WHEN 'created' THEN 'policy_applied' ELSE _reason END, _actor,
    jsonb_strip_nulls(jsonb_build_object('policy', pname, 'version', ver, 'severity', sev, 'from', old.severity,
      'from_version', old.policy_version, 'note', NULLIF(left(_note, 300), ''), 'premium_capped', CASE WHEN (data ->> 'premium_capped')::boolean THEN true END)));
  PERFORM public.sla_reconcile(_ticket);
  RETURN sid;
END $$;

-- ------------------------------------------------------------------------------------------------ clock facts
CREATE OR REPLACE FUNCTION public.sla_start_at(_ticket uuid, _rule text)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; a timestamptz; r timestamptz; gated boolean := false;
BEGIN
  SELECT tk.created_at, tk.consultant_id INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF COALESCE(_rule, 'submitted') = 'submitted' THEN RETURN t.created_at; END IF;
  SELECT LEAST(
           (SELECT min(x.created_at) FROM public.ticket_assignments x WHERE x.ticket_id = _ticket AND x.role::text IN ('lead', 'support')),
           (SELECT min(m.accepted_at) FROM public.ticket_team_members m WHERE m.ticket_id = _ticket AND m.status IN ('ready', 'active')))
    INTO a;
  IF a IS NULL AND t.consultant_id IS NOT NULL THEN a := now(); END IF;
  IF _rule = 'assigned' THEN RETURN a; END IF;
  -- 'ready' = engagement ready (all team gates passed) on gated tickets, otherwise the assignment time.
  IF to_regprocedure('public.team_ticket_gated(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.team_ticket_gated($1)' INTO gated USING _ticket;
  END IF;
  IF NOT COALESCE(gated, false) THEN RETURN a; END IF;
  SELECT min(m.ready_at) INTO r FROM public.ticket_team_members m WHERE m.ticket_id = _ticket AND m.status IN ('ready', 'active');
  RETURN r;
END $$;

-- First reply by an assigned consultant after the clock started (chat message, team message or critical reply).
CREATE OR REPLACE FUNCTION public.sla_first_response_at(_ticket uuid, _since timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH a AS (SELECT user_id FROM public.sla_assigned(_ticket))
  SELECT min(x) FROM (
    SELECT min(m.created_at) AS x FROM public.messages m JOIN public.sessions s ON s.id = m.session_id
     WHERE s.ticket_id = _ticket AND m.created_at >= _since AND m.message_type::text <> 'system' AND m.sender_id IN (SELECT user_id FROM a)
    UNION ALL
    SELECT min(tm.created_at) FROM public.ticket_team_messages tm
     WHERE tm.ticket_id = _ticket AND tm.created_at >= _since AND tm.sender_id IN (SELECT user_id FROM a)
    UNION ALL
    SELECT tk.critical_first_reply_at FROM public.tickets tk WHERE tk.id = _ticket AND tk.critical_first_reply_at >= _since
  ) q
$$;

-- Current pause reason under the policy's pause list, or NULL (clock runs).
CREATE OR REPLACE FUNCTION public.sla_pause_reason(_ticket uuid, _pauses jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; ws text; blocks boolean := false;
BEGIN
  IF jsonb_array_length(COALESCE(_pauses, '[]'::jsonb)) = 0 THEN RETURN NULL; END IF;
  SELECT tk.status::text AS status, tk.client_id, tk.consultant_id INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  IF to_regclass('public.ticket_working_status') IS NOT NULL THEN
    EXECUTE 'SELECT status_key FROM public.ticket_working_status WHERE ticket_id = $1' INTO ws USING _ticket;
    IF ws IN ('waiting_client_info', 'waiting_third_party', 'on_hold') AND _pauses ? ws THEN RETURN ws; END IF;
  END IF;
  IF t.status = 'waiting_for_client' AND _pauses ? 'waiting_for_client' THEN RETURN 'waiting_for_client'; END IF;
  IF _pauses ? 'awaiting_nda' AND t.consultant_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.nda_agreements n WHERE n.consultant_id = t.consultant_id AND n.client_id = t.client_id
          AND n.revoked_at IS NULL AND n.signed_at IS NOT NULL AND n.client_signed_at IS NOT NULL) THEN
    RETURN 'awaiting_nda';
  END IF;
  IF _pauses ? 'awaiting_brd_approval' AND to_regprocedure('public.brd_gate_state(uuid,uuid)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT COALESCE((public.brd_gate_state($1, NULL) ->> ''blocks'')::boolean, false)' INTO blocks USING _ticket;
    EXCEPTION WHEN OTHERS THEN blocks := false;
    END;
    IF blocks THEN RETURN 'awaiting_brd_approval'; END IF;
  END IF;
  RETURN NULL;
END $$;

-- ------------------------------------------------------------------------------------------------ the state machine
-- Idempotent: brings every clock of the ticket up to date (start, first response, pause/resume, stop, reopen, due,
-- breach). Called by ticket/message/status triggers and by the sweep. Never raises: an SLA problem must never block
-- a message, status change or assignment.
CREATE OR REPLACE FUNCTION public.sla_reconcile(_ticket uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t record; sn record; c record; cal jsonb; st timestamptz; fr timestamptz; pr text; used numeric; tgt numeric; due timestamptz;
  nowt timestamptz := clock_timestamp(); stop_set text[]; at_ts timestamptz;
BEGIN
  IF NOT public.sla_enabled() THEN RETURN; END IF;
  SELECT tk.id, tk.status::text AS status, tk.resolved_at INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT s.* INTO sn FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  cal := sn.data -> 'calendar';
  stop_set := CASE WHEN sn.data -> 'clock' ->> 'stop' = 'closed' THEN ARRAY['closed'] ELSE ARRAY['resolved', 'closed'] END;
  pr := public.sla_pause_reason(_ticket, sn.data -> 'clock' -> 'pause');

  FOR c IN SELECT * FROM public.sla_ticket_clocks x WHERE x.ticket_id = _ticket ORDER BY x.kind FOR UPDATE LOOP
    -- 1. start
    IF c.started_at IS NULL THEN
      st := public.sla_start_at(_ticket, sn.data -> 'clock' ->> 'start');
      IF st IS NULL THEN CONTINUE; END IF;
      st := GREATEST(st, sn.created_at);
      UPDATE public.sla_ticket_clocks SET started_at = st, running_since = CASE WHEN pr IS NULL THEN st END,
             paused_since = CASE WHEN pr IS NOT NULL THEN st END, pause_reason = pr, updated_at = nowt
       WHERE ticket_id = _ticket AND kind = c.kind RETURNING * INTO c;
      PERFORM public.sla_event(_ticket, 'clock_started', NULL, jsonb_build_object('clock', c.kind, 'at', st));
      IF pr IS NOT NULL THEN
        INSERT INTO public.sla_ticket_pauses (ticket_id, clock, reason, started_at) VALUES (_ticket, c.kind, pr, st);
        PERFORM public.sla_event(_ticket, 'paused', NULL, jsonb_build_object('clock', c.kind, 'reason', pr));
      END IF;
    END IF;

    -- 2. reopened ticket: the resolution clock continues
    IF c.kind = 'resolution' AND c.met_at IS NOT NULL AND NOT (t.status = ANY (stop_set)) THEN
      UPDATE public.sla_ticket_clocks SET met_at = NULL, stopped_at = NULL,
             running_since = CASE WHEN pr IS NULL THEN nowt END, paused_since = CASE WHEN pr IS NOT NULL THEN nowt END,
             pause_reason = pr, updated_at = nowt
       WHERE ticket_id = _ticket AND kind = c.kind RETURNING * INTO c;
      PERFORM public.sla_event(_ticket, 'resumed', NULL, jsonb_build_object('clock', c.kind, 'reason', 'reopened'));
    END IF;
    IF c.met_at IS NOT NULL THEN CONTINUE; END IF;

    -- 3. met
    at_ts := NULL;
    IF c.kind = 'response' THEN
      fr := public.sla_first_response_at(_ticket, c.started_at);
      IF fr IS NOT NULL THEN at_ts := fr; END IF;
    END IF;
    IF at_ts IS NULL AND t.status = ANY (stop_set) THEN at_ts := LEAST(COALESCE(t.resolved_at, nowt), nowt); END IF;
    IF at_ts IS NOT NULL THEN
      used := c.consumed_min + CASE WHEN c.running_since IS NOT NULL AND at_ts > c.running_since THEN public.sla_business_minutes(c.running_since, at_ts, cal) ELSE 0 END;
      tgt := c.target_min + c.extended_min;
      UPDATE public.sla_ticket_clocks SET consumed_min = used, met_at = at_ts, stopped_at = at_ts, running_since = NULL, paused_since = NULL,
             pause_reason = NULL, due_at = NULL, breached_at = COALESCE(c.breached_at, CASE WHEN used > tgt THEN at_ts END), updated_at = nowt
       WHERE ticket_id = _ticket AND kind = c.kind;
      UPDATE public.sla_ticket_pauses SET ended_at = at_ts WHERE ticket_id = _ticket AND clock = c.kind AND ended_at IS NULL;
      PERFORM public.sla_event(_ticket, c.kind || '_met', NULL, jsonb_build_object('clock', c.kind, 'late', used > tgt, 'used_min', round(used)));
      CONTINUE;
    END IF;

    -- 4. pause / resume / reason change
    IF pr IS NOT NULL AND c.running_since IS NOT NULL THEN
      used := c.consumed_min + public.sla_business_minutes(c.running_since, nowt, cal);
      UPDATE public.sla_ticket_clocks SET consumed_min = used, running_since = NULL, paused_since = nowt, pause_reason = pr, updated_at = nowt
       WHERE ticket_id = _ticket AND kind = c.kind RETURNING * INTO c;
      INSERT INTO public.sla_ticket_pauses (ticket_id, clock, reason, started_at) VALUES (_ticket, c.kind, pr, nowt);
      PERFORM public.sla_event(_ticket, 'paused', NULL, jsonb_build_object('clock', c.kind, 'reason', pr));
    ELSIF pr IS NULL AND c.running_since IS NULL AND c.paused_since IS NOT NULL THEN
      UPDATE public.sla_ticket_clocks SET running_since = nowt, paused_since = NULL, pause_reason = NULL, updated_at = nowt
       WHERE ticket_id = _ticket AND kind = c.kind RETURNING * INTO c;
      UPDATE public.sla_ticket_pauses SET ended_at = nowt WHERE ticket_id = _ticket AND clock = c.kind AND ended_at IS NULL;
      PERFORM public.sla_event(_ticket, 'resumed', NULL, jsonb_build_object('clock', c.kind));
    ELSIF pr IS NOT NULL AND c.paused_since IS NOT NULL AND pr IS DISTINCT FROM c.pause_reason THEN
      UPDATE public.sla_ticket_pauses SET ended_at = nowt WHERE ticket_id = _ticket AND clock = c.kind AND ended_at IS NULL;
      INSERT INTO public.sla_ticket_pauses (ticket_id, clock, reason, started_at) VALUES (_ticket, c.kind, pr, nowt);
      UPDATE public.sla_ticket_clocks SET pause_reason = pr, updated_at = nowt WHERE ticket_id = _ticket AND kind = c.kind RETURNING * INTO c;
      PERFORM public.sla_event(_ticket, 'paused', NULL, jsonb_build_object('clock', c.kind, 'reason', pr));
    END IF;

    -- 5. due time and breach
    tgt := c.target_min + c.extended_min;
    due := CASE WHEN c.running_since IS NOT NULL THEN public.sla_add_business_minutes(c.running_since, GREATEST(0, tgt - c.consumed_min), cal) END;
    used := c.consumed_min + CASE WHEN c.running_since IS NOT NULL THEN public.sla_business_minutes(c.running_since, nowt, cal) ELSE 0 END;
    UPDATE public.sla_ticket_clocks SET due_at = due,
           breached_at = CASE WHEN c.breached_at IS NULL AND used >= tgt THEN LEAST(COALESCE(due, nowt), nowt) ELSE c.breached_at END,
           updated_at = nowt
     WHERE ticket_id = _ticket AND kind = c.kind;
    IF c.breached_at IS NULL AND used >= tgt THEN
      PERFORM public.sla_event(_ticket, 'breached', NULL, jsonb_build_object('clock', c.kind));
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'SLA reconcile skipped for ticket %: %', _ticket, SQLERRM;
END $$;

-- ------------------------------------------------------------------------------------------------ reminders
-- Recipients of one step (registered users only; 'extra' = company members named in the policy, matched by e-mail).
CREATE OR REPLACE FUNCTION public.sla_step_recipients(_ticket uuid, _who jsonb, _extra jsonb)
RETURNS TABLE (user_id uuid, role text, tz text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (SELECT tk.client_id, tk.tenant_id FROM public.tickets tk WHERE tk.id = _ticket),
  w AS (SELECT jsonb_array_elements_text(COALESCE(_who, '[]'::jsonb)) AS k),
  r AS (
    SELECT a.user_id, 'consultant'::text AS role, a.tz FROM public.sla_assigned(_ticket) a
     WHERE (a.is_lead AND EXISTS (SELECT 1 FROM w WHERE k IN ('lead', 'all_assigned')))
        OR (NOT a.is_lead AND EXISTS (SELECT 1 FROM w WHERE k IN ('support', 'all_assigned')))
    UNION ALL
    SELECT t.client_id, 'client', (SELECT cp.timezone FROM public.client_profiles cp WHERE cp.user_id = t.client_id LIMIT 1)
      FROM t WHERE EXISTS (SELECT 1 FROM w WHERE k = 'client_contact')
    UNION ALL
    SELECT m.user_id, 'client', NULL FROM t JOIN public.tenant_members m ON m.tenant_id = t.tenant_id
     WHERE EXISTS (SELECT 1 FROM w WHERE k = 'client_manager') AND m.accepted_at IS NOT NULL
       AND m.org_role IN ('owner'::org_role, 'admin'::org_role, 'manager'::org_role)
    UNION ALL
    SELECT ur.user_id, 'admin', NULL FROM public.user_roles ur
     WHERE EXISTS (SELECT 1 FROM w WHERE k = 'admin') AND ur.role IN ('admin'::app_role, 'super_admin'::app_role)
    UNION ALL
    SELECT m.user_id, 'client', NULL FROM t JOIN public.tenant_members m ON m.tenant_id = t.tenant_id JOIN auth.users u ON u.id = m.user_id
     WHERE EXISTS (SELECT 1 FROM w WHERE k = 'extra') AND m.accepted_at IS NOT NULL
       AND lower(u.email) IN (SELECT lower(jsonb_array_elements_text(COALESCE(_extra, '[]'::jsonb)))))
  SELECT DISTINCT ON (r.user_id) r.user_id, r.role, r.tz FROM r WHERE r.user_id IS NOT NULL ORDER BY r.user_id, r.role DESC
$$;

CREATE OR REPLACE FUNCTION public.sla_in_quiet_hours(_tz text, _q jsonb)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  WITH v AS (SELECT (now() AT TIME ZONE CASE WHEN public.sla_valid_tz(_tz) THEN _tz ELSE 'UTC' END)::time AS n,
                    COALESCE(_q ->> 'start', '22:00')::time AS a, COALESCE(_q ->> 'end', '07:00')::time AS b)
  SELECT CASE WHEN a = b THEN false WHEN a < b THEN n >= a AND n < b ELSE n >= a OR n < b END FROM v
$$;

-- One reminder to one person: in-app notice here, other channels queued for sla-run. Text is polite and factual.
CREATE OR REPLACE FUNCTION public.sla_deliver(_ticket uuid, _user uuid, _role text, _step jsonb, _clock public.sla_ticket_clocks, _snapshot public.sla_ticket_snapshots, _key text, _seq integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := public.sla_settings(); lang text := public.sla_lang(_user); title text; body text; link text; tt text;
  tmpl text := COALESCE(_step ->> 'template', 'reminder'); clock_en text; clock_ar text; left_min numeric; ch text;
  unpausable boolean := COALESCE((_step ->> 'unpausable')::boolean, false) AND _snapshot.severity = 'S1';
  cat text; used numeric;
BEGIN
  SELECT left(tk.title, 120) INTO tt FROM public.tickets tk WHERE tk.id = _ticket;
  used := _clock.consumed_min + CASE WHEN _clock.running_since IS NOT NULL THEN public.sla_business_minutes(_clock.running_since, now(), _snapshot.data -> 'calendar') ELSE 0 END;
  left_min := (_clock.target_min + _clock.extended_min) - used;
  clock_en := CASE _clock.kind WHEN 'response' THEN 'first response' WHEN 'workaround' THEN 'workaround' ELSE 'resolution' END;
  clock_ar := CASE _clock.kind WHEN 'response' THEN 'الاستجابة الأولى' WHEN 'workaround' THEN 'الحل المؤقت' ELSE 'الحل' END;
  link := CASE _role WHEN 'consultant' THEN '/consultant/cases/' || _ticket WHEN 'admin' THEN '/admin/tickets' ELSE '/client/tickets/' || _ticket END;
  IF lang = 'ar' THEN
    title := CASE tmpl WHEN 'breach' THEN 'انتهى وقت اتفاقية مستوى الخدمة: ' WHEN 'after_breach' THEN 'ما زال مفتوحاً بعد وقت الاتفاقية: '
                       WHEN 'escalation' THEN 'تصعيد اتفاقية مستوى الخدمة: ' ELSE 'تذكير باتفاقية مستوى الخدمة: ' END || tt;
    body := CASE WHEN left_min > 0 THEN 'موعد ' || clock_ar || ' للتذكرة «' || tt || '» بعد حوالي ' || public.sla_fmt_minutes(left_min, 'ar') || ' (' || _snapshot.severity || ').'
                 ELSE 'انتهى وقت ' || clock_ar || ' للتذكرة «' || tt || '» (' || _snapshot.severity || '). يرجى تحديث التذكرة.' END;
  ELSE
    title := CASE tmpl WHEN 'breach' THEN 'SLA target passed: ' WHEN 'after_breach' THEN 'Still open after the SLA target: '
                       WHEN 'escalation' THEN 'SLA escalation: ' ELSE 'SLA reminder: ' END || tt;
    body := CASE WHEN left_min > 0 THEN 'The ' || clock_en || ' for "' || tt || '" is due in about ' || public.sla_fmt_minutes(left_min, 'en') || ' (' || _snapshot.severity || ').'
                 ELSE 'The ' || clock_en || ' target for "' || tt || '" has passed (' || _snapshot.severity || '). Please update the ticket.' END;
  END IF;
  cat := CASE WHEN unpausable THEN 'essential' ELSE 'reminders' END;

  IF COALESCE(_step -> 'channels', '[]'::jsonb) ? 'in_app' AND COALESCE((s -> 'channels_enabled' ->> 'in_app')::boolean, true) THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, body, type, link, pause_category) VALUES (_user, left(title, 200), left(body, 1000), 'sla', link, cat);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.safe_insert_notification(_user, left(title, 200), left(body, 1000), 'sla', link);
    END;
  END IF;
  FOR ch IN SELECT x FROM jsonb_array_elements_text(COALESCE(_step -> 'channels', '[]'::jsonb)) x WHERE x IN ('email', 'push', 'telegram') LOOP
    IF NOT COALESCE((s -> 'channels_enabled' ->> ch)::boolean, true) THEN CONTINUE; END IF;
    INSERT INTO public.sla_delivery_queue (user_id, ticket_id, clock, channel, kind, payload, dedupe_key)
    VALUES (_user, _ticket, _clock.kind, ch, tmpl, jsonb_build_object('lang', lang, 'title', title, 'body', body, 'path', link,
              'severity', _snapshot.severity, 'clock', _clock.kind, 'ticket_title', tt, 'left_min', round(left_min), 'unpausable', unpausable,
              'template', tmpl, 'role', _role),
            left('sla:' || _ticket || ':' || _snapshot.id || ':' || _key || ':' || _user || ':' || _seq || ':' || ch, 300))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.sla_fire_steps(_ticket uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := public.sla_settings(); sn public.sla_ticket_snapshots; c public.sla_ticket_clocks; st jsonb; i int; key text; th numeric; used numeric; tgt numeric;
  r record; n int := 0; ins int; first_at timestamptz; last_seq int; seq int; acked boolean; every numeric; unp boolean;
BEGIN
  SELECT x.* INTO sn FROM public.sla_ticket_snapshots x WHERE x.ticket_id = _ticket AND x.superseded_at IS NULL;
  IF sn.id IS NULL THEN RETURN 0; END IF;
  FOR st, i IN SELECT q.x, q.ord::int FROM jsonb_array_elements(COALESCE(sn.data -> 'escalations', '[]'::jsonb)) WITH ORDINALITY AS q(x, ord) LOOP
    SELECT k.* INTO c FROM public.sla_ticket_clocks k WHERE k.ticket_id = _ticket AND k.kind = st ->> 'clock';
    IF c.ticket_id IS NULL OR c.started_at IS NULL OR c.met_at IS NOT NULL THEN CONTINUE; END IF;
    tgt := c.target_min + c.extended_min;
    used := c.consumed_min + CASE WHEN c.running_since IS NOT NULL THEN public.sla_business_minutes(c.running_since, now(), sn.data -> 'calendar') ELSE 0 END;
    th := CASE WHEN st ->> 'kind' = 'percent' THEN ceil(tgt * (st ->> 'value')::numeric / 100) ELSE tgt + (st ->> 'value')::numeric END;
    IF used < th THEN CONTINUE; END IF;
    key := (st ->> 'clock') || ':' || (i - 1) || ':' || CASE WHEN st ->> 'kind' = 'percent' THEN 'p' ELSE 'b' END || (st ->> 'value');
    unp := COALESCE((st ->> 'unpausable')::boolean, false) AND sn.severity = 'S1';
    FOR r IN SELECT * FROM public.sla_step_recipients(_ticket, st -> 'who', sn.data -> 'extra_contacts') LOOP
      SELECT min(x.sent_at), max(x.seq) INTO first_at, last_seq FROM public.sla_reminders_sent x
       WHERE x.ticket_id = _ticket AND x.snapshot_id = sn.id AND x.step_key = key AND x.recipient_id = r.user_id;
      IF first_at IS NULL THEN
        seq := 0;
      ELSE
        IF jsonb_typeof(st -> 'repeat_min') <> 'number' THEN CONTINUE; END IF;
        SELECT EXISTS (SELECT 1 FROM public.sla_acknowledgements a WHERE a.ticket_id = _ticket AND a.created_at >= first_at) INTO acked;
        IF COALESCE((st ->> 'until_ack')::boolean, false) AND acked THEN CONTINUE; END IF;
        every := GREATEST((st ->> 'repeat_min')::numeric, GREATEST(30, COALESCE((s -> 'bounds' ->> 'min_repeat_min')::numeric, 30)));
        seq := LEAST(floor(extract(epoch FROM now() - first_at) / 60 / every)::int, COALESCE((s -> 'bounds' ->> 'max_repeats')::int, 6));
        IF seq < 1 OR seq <= last_seq THEN CONTINUE; END IF;
      END IF;
      -- Quiet hours (consultant's time zone) except S1. Feature Q pauses are applied by the notification and send rules.
      IF r.role = 'consultant' AND sn.severity <> 'S1' AND NOT unp AND public.sla_in_quiet_hours(r.tz, s -> 'quiet_hours') THEN CONTINUE; END IF;
      INSERT INTO public.sla_reminders_sent (ticket_id, snapshot_id, step_key, recipient_id, seq, channels)
      VALUES (_ticket, sn.id, key, r.user_id, seq, ARRAY(SELECT jsonb_array_elements_text(COALESCE(st -> 'channels', '[]'::jsonb))))
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS ins = ROW_COUNT;
      IF ins = 0 THEN CONTINUE; END IF;
      PERFORM public.sla_deliver(_ticket, r.user_id, r.role, st, c, sn, key, seq);
      PERFORM public.sla_event(_ticket, CASE WHEN st ->> 'template' IN ('escalation', 'after_breach') THEN 'escalated' ELSE 'reminder_sent' END, NULL,
        jsonb_build_object('clock', c.kind, 'to', r.role, 'step', i, 'repeat', seq));
      n := n + 1;
    END LOOP;
  END LOOP;
  RETURN n;
END $$;

-- Once per breached clock: flag the ticket, ask the client to choose, financial hook (no-op).
CREATE OR REPLACE FUNCTION public.sla_breach_actions(_ticket uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sn record; c record; t record; lang text; ins int; title text; body text;
BEGIN
  SELECT x.* INTO sn FROM public.sla_ticket_snapshots x WHERE x.ticket_id = _ticket AND x.superseded_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT tk.client_id, left(tk.title, 120) AS title, tk.sla_breached INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  FOR c IN SELECT * FROM public.sla_ticket_clocks k WHERE k.ticket_id = _ticket AND k.breached_at IS NOT NULL AND k.met_at IS NULL LOOP
    INSERT INTO public.sla_reminders_sent (ticket_id, snapshot_id, step_key, recipient_id, seq)
    VALUES (_ticket, sn.id, 'breach_actions:' || c.kind, '00000000-0000-0000-0000-000000000000', 0) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS ins = ROW_COUNT;
    IF ins = 0 THEN CONTINUE; END IF;
    IF COALESCE((sn.data -> 'breach' ->> 'flag')::boolean, true) AND t.sla_breached IS NOT TRUE THEN
      UPDATE public.tickets SET sla_breached = true WHERE id = _ticket AND sla_breached IS NOT TRUE;
    END IF;
    IF COALESCE((sn.data -> 'breach' ->> 'ask_client')::boolean, false) AND t.client_id IS NOT NULL THEN
      lang := public.sla_lang(t.client_id);
      IF lang = 'ar' THEN
        title := 'يرجى اختيار الخطوة التالية: ' || t.title;
        body := 'انتهى وقت ' || CASE c.kind WHEN 'response' THEN 'الاستجابة الأولى' WHEN 'workaround' THEN 'الحل المؤقت' ELSE 'الحل' END
          || '. يمكنك تمديد الوقت أو طلب استشاري آخر أو طلب مساعدة الإدارة من صفحة التذكرة.';
      ELSE
        title := 'Please choose the next step: ' || t.title;
        body := 'The ' || CASE c.kind WHEN 'response' THEN 'first response' WHEN 'workaround' THEN 'workaround' ELSE 'resolution' END
          || ' target has passed. You can extend the time, ask for another consultant or request admin help on the ticket page.';
      END IF;
      PERFORM public.safe_insert_notification(t.client_id, left(title, 200), body, 'sla', '/client/tickets/' || _ticket);
    END IF;
    PERFORM public.sla_breach_financial_hook(_ticket, c.kind);
  END LOOP;
END $$;

-- Bounded sweep (every 5 minutes through flag_sla_breaches). Also one daily compliance alert to administrators.
CREATE OR REPLACE FUNCTION public.sla_sweep(_limit integer DEFAULT 300)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0; pct numeric; total int; s jsonb; ins int; a uuid;
BEGIN
  IF NOT public.sla_enabled() THEN RETURN 0; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('sla_sweep')) THEN RETURN 0; END IF;
  FOR r IN SELECT c.ticket_id, min(c.swept_at) AS sw FROM public.sla_ticket_clocks c
            JOIN public.sla_ticket_snapshots sn ON sn.id = c.snapshot_id AND sn.superseded_at IS NULL
           WHERE c.met_at IS NULL GROUP BY c.ticket_id ORDER BY min(c.swept_at) NULLS FIRST LIMIT LEAST(GREATEST(COALESCE(_limit, 300), 1), 1000) LOOP
    BEGIN
      PERFORM public.sla_reconcile(r.ticket_id);
      n := n + public.sla_fire_steps(r.ticket_id);
      PERFORM public.sla_breach_actions(r.ticket_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'SLA sweep skipped ticket %: %', r.ticket_id, SQLERRM;
    END;
    UPDATE public.sla_ticket_clocks SET swept_at = now() WHERE ticket_id = r.ticket_id;
  END LOOP;

  s := public.sla_settings();
  SELECT count(*), round(100.0 * count(*) FILTER (WHERE c.breached_at IS NULL) / NULLIF(count(*), 0), 1) INTO total, pct
    FROM public.sla_ticket_clocks c WHERE c.met_at >= now() - interval '30 days';
  IF total >= 10 AND pct < COALESCE((s ->> 'compliance_alert_pct')::numeric, 90) THEN
    INSERT INTO public.sla_alert_log (day, compliance) VALUES (current_date, pct) ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS ins = ROW_COUNT;
    IF ins > 0 THEN
      FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin'::app_role, 'super_admin'::app_role) LOOP
        PERFORM public.safe_insert_notification(a, 'SLA compliance below ' || COALESCE(s ->> 'compliance_alert_pct', '90') || ' %',
          'Platform-wide SLA compliance over the last 30 days is ' || pct || ' % (' || total || ' measured targets).', 'sla', '/admin/sla');
      END LOOP;
    END IF;
  END IF;
  RETURN n;
END $$;

-- Today's job, unchanged for tickets without an SLA snapshot; snapshotted tickets are handled by sla_sweep.
CREATE OR REPLACE FUNCTION public.flag_sla_breaches()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _t record; _n integer := 0; _cons_user uuid; _admin uuid; _what text; _on boolean := public.sla_enabled();
BEGIN
  FOR _t IN
    UPDATE public.tickets t SET sla_breached = true
     WHERE t.sla_breached IS NOT TRUE
       AND t.status::text NOT IN ('resolved', 'closed')
       AND ((t.sla_response_deadline IS NOT NULL AND t.first_response_at IS NULL AND t.sla_response_deadline < now())
         OR (t.sla_deadline IS NOT NULL AND t.sla_deadline < now()))
       AND NOT (_on AND EXISTS (SELECT 1 FROM public.sla_ticket_snapshots s WHERE s.ticket_id = t.id AND s.superseded_at IS NULL))
    RETURNING t.id, t.title, t.consultant_id, t.first_response_at, t.sla_response_deadline
  LOOP
    _n := _n + 1;
    _what := CASE WHEN _t.first_response_at IS NULL AND _t.sla_response_deadline IS NOT NULL AND _t.sla_response_deadline < now()
                  THEN 'response time' ELSE 'resolution time' END;
    FOR _admin IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin'::app_role, 'super_admin'::app_role) LOOP
      PERFORM public.safe_insert_notification(_admin, 'SLA breached',
        'The ' || _what || ' of "' || left(_t.title, 120) || '" has run out.', 'ticket', '/admin/tickets');
    END LOOP;
    IF _t.consultant_id IS NOT NULL THEN
      SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = _t.consultant_id;
      IF _cons_user IS NOT NULL THEN
        PERFORM public.safe_insert_notification(_cons_user, 'SLA breached',
          'The ' || _what || ' of "' || left(_t.title, 120) || '" has run out.', 'ticket', '/consultant/cases/' || _t.id);
      END IF;
    END IF;
  END LOOP;
  IF _on THEN
    BEGIN
      _n := _n + public.sla_sweep();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'SLA sweep failed: %', SQLERRM;
    END;
  END IF;
  RETURN _n;
END;
$$;

-- ------------------------------------------------------------------------------------------------ triggers
CREATE OR REPLACE FUNCTION public.sla_on_ticket_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.sla_enabled() THEN
    BEGIN
      PERFORM public.sla_apply_snapshot(NEW.id, 'created', NULL, 'fresh');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'SLA snapshot skipped for ticket %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sla_ticket_insert ON public.tickets;
CREATE TRIGGER sla_ticket_insert AFTER INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.sla_on_ticket_insert();

-- Urgency change = re-classification (targets recomputed from the change time, logged with the reason the RPC set);
-- other changes only reconcile.
CREATE OR REPLACE FUNCTION public.sla_on_ticket_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur text; nxt text;
BEGIN
  IF NOT public.sla_enabled() THEN RETURN NULL; END IF;
  BEGIN
    SELECT s.severity INTO cur FROM public.sla_ticket_snapshots s WHERE s.ticket_id = NEW.id AND s.superseded_at IS NULL;
    IF cur IS NULL THEN RETURN NULL; END IF;
    nxt := public.sla_severity_for(NEW.urgency::text);
    IF NEW.urgency IS DISTINCT FROM OLD.urgency AND nxt <> cur THEN
      PERFORM public.sla_apply_snapshot(NEW.id, 'reclassified', auth.uid(), 'fresh', nxt, NULLIF(current_setting('sla.reason', true), ''));
    ELSE
      PERFORM public.sla_reconcile(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'SLA update skipped for ticket %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS sla_ticket_update ON public.tickets;
CREATE TRIGGER sla_ticket_update AFTER UPDATE OF status, urgency, consultant_id, critical_first_reply_at, resolved_at ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.sla_on_ticket_update();

-- Messages, team changes, working status and NDA signatures can start, meet, pause or resume a clock.
CREATE OR REPLACE FUNCTION public.sla_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tid uuid;
BEGIN
  IF NOT public.sla_enabled() THEN RETURN NULL; END IF;
  BEGIN
    IF TG_TABLE_NAME = 'messages' THEN
      SELECT s.ticket_id INTO tid FROM public.sessions s WHERE s.id = NEW.session_id;
    ELSIF TG_TABLE_NAME = 'nda_agreements' THEN
      FOR tid IN SELECT DISTINCT tk.id FROM public.tickets tk JOIN public.sla_ticket_snapshots sn ON sn.ticket_id = tk.id AND sn.superseded_at IS NULL
                  WHERE tk.consultant_id = NEW.consultant_id AND tk.client_id = NEW.client_id LIMIT 50 LOOP
        PERFORM public.sla_reconcile(tid);
      END LOOP;
      RETURN NULL;
    ELSE
      tid := NEW.ticket_id;
    END IF;
    IF tid IS NOT NULL AND EXISTS (SELECT 1 FROM public.sla_ticket_clocks c WHERE c.ticket_id = tid AND c.met_at IS NULL) THEN
      PERFORM public.sla_reconcile(tid);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'SLA touch skipped: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

DO $$
BEGIN
  DROP TRIGGER IF EXISTS sla_touch ON public.messages;
  CREATE TRIGGER sla_touch AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  DROP TRIGGER IF EXISTS sla_touch ON public.ticket_team_messages;
  CREATE TRIGGER sla_touch AFTER INSERT ON public.ticket_team_messages FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  DROP TRIGGER IF EXISTS sla_touch ON public.ticket_team_members;
  CREATE TRIGGER sla_touch AFTER INSERT OR UPDATE OF status, accepted_at, ready_at ON public.ticket_team_members FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  DROP TRIGGER IF EXISTS sla_touch ON public.ticket_assignments;
  CREATE TRIGGER sla_touch AFTER INSERT OR UPDATE OF status ON public.ticket_assignments FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  DROP TRIGGER IF EXISTS sla_touch ON public.nda_agreements;
  CREATE TRIGGER sla_touch AFTER INSERT OR UPDATE OF signed_at, client_signed_at, revoked_at ON public.nda_agreements FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  IF to_regclass('public.ticket_working_status') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS sla_touch ON public.ticket_working_status;
    CREATE TRIGGER sla_touch AFTER INSERT OR UPDATE OF status_key ON public.ticket_working_status FOR EACH ROW EXECUTE FUNCTION public.sla_touch();
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------------ delivery worker (sla-run)
CREATE OR REPLACE FUNCTION public.sla_wake()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regprocedure('public.job_invoke_headers()') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sla_delivery_queue q WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5) THEN RETURN; END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := public.job_invoke_headers(), body := '{}'::jsonb)$q$
    USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/sla-run';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'SLA delivery wake-up skipped: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.sla_wake_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN PERFORM public.sla_wake(); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS sla_wake ON public.sla_delivery_queue;
CREATE TRIGGER sla_wake AFTER INSERT ON public.sla_delivery_queue FOR EACH STATEMENT EXECUTE FUNCTION public.sla_wake_trigger();

-- Rows whose clock is already met, whose ticket closed, or while the feature is off are dropped (never sent late).
-- Notification pauses (Feature Q) are applied here for pausable steps; S1 "cannot be paused" steps skip that check.
CREATE OR REPLACE FUNCTION public.sla_claim_deliveries(_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, user_id uuid, ticket_id uuid, channel text, kind text, payload jsonb, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.sla_delivery_queue q SET failed_at = now(), last_error = 'not_applicable'
   WHERE q.sent_at IS NULL AND q.failed_at IS NULL
     AND (NOT public.sla_enabled()
       OR EXISTS (SELECT 1 FROM public.sla_ticket_clocks c WHERE c.ticket_id = q.ticket_id AND c.kind = q.clock AND c.met_at IS NOT NULL)
       OR (NOT COALESCE((q.payload ->> 'unpausable')::boolean, false) AND to_regprocedure('public.notifications_paused(uuid,text,text)') IS NOT NULL
           AND public.notifications_paused(q.user_id, 'reminders', CASE WHEN q.channel = 'email' THEN 'email' ELSE 'in_app' END)));
  RETURN QUERY
  WITH c AS (
    UPDATE public.sla_delivery_queue q SET attempts = q.attempts + 1, lease_until = now() + interval '10 minutes'
     WHERE q.id IN (SELECT q2.id FROM public.sla_delivery_queue q2
                     WHERE q2.sent_at IS NULL AND q2.failed_at IS NULL AND q2.attempts < 5
                       AND (q2.lease_until IS NULL OR q2.lease_until < now())
                     ORDER BY q2.created_at LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
                     FOR UPDATE SKIP LOCKED)
    RETURNING q.id, q.user_id, q.ticket_id, q.channel, q.kind, q.payload)
  SELECT c.id, c.user_id, c.ticket_id, c.channel, c.kind, c.payload, u.email::text FROM c LEFT JOIN auth.users u ON u.id = c.user_id;
END $$;

CREATE OR REPLACE FUNCTION public.sla_finish_delivery(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.sla_delivery_queue SET
    sent_at = CASE WHEN _ok THEN now() END,
    failed_at = CASE WHEN NOT _ok AND (attempts >= 5 OR _error IN ('not_connected', 'no_address', 'recipient_suppressed')) THEN now() END,
    last_error = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error, 'failed'), 200) END,
    lease_until = NULL
   WHERE id = _id
$$;

-- ------------------------------------------------------------------------------------------------ consultant acceptance gate
-- When ON and the admin requires it, a consultant must accept the ticket's SLA snapshot (sla_accept) before a bid,
-- an assignment acceptance or a team acceptance. Tickets without a snapshot (feature off / older tickets) are not gated.
CREATE OR REPLACE FUNCTION public.sla_acceptance_missing(_ticket uuid, _consultant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.sla_enabled() AND COALESCE((public.sla_settings() ->> 'require_acceptance')::boolean, true)
     AND EXISTS (SELECT 1 FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL
                   AND NOT EXISTS (SELECT 1 FROM public.sla_acceptances a WHERE a.ticket_id = _ticket AND a.consultant_id = _consultant AND a.snapshot_id = s.id))
$$;

CREATE OR REPLACE FUNCTION public.sla_guard_acceptance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.sla_is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'proposals' THEN
    IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'ticket_match_requests' THEN
    IF NOT (NEW.status::text = 'accepted' AND OLD.status::text IS DISTINCT FROM 'accepted') THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME = 'ticket_team_members' THEN
    IF NOT (NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL) THEN RETURN NEW; END IF;
  END IF;
  IF public.sla_acceptance_missing(NEW.ticket_id, NEW.consultant_id) THEN
    RAISE EXCEPTION 'sla_acceptance_required: please review and accept the SLA of this ticket first' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sla_acceptance ON public.proposals;
CREATE TRIGGER trg_sla_acceptance BEFORE INSERT ON public.proposals FOR EACH ROW EXECUTE FUNCTION public.sla_guard_acceptance();
DROP TRIGGER IF EXISTS trg_sla_acceptance ON public.ticket_match_requests;
CREATE TRIGGER trg_sla_acceptance BEFORE UPDATE OF status ON public.ticket_match_requests FOR EACH ROW EXECUTE FUNCTION public.sla_guard_acceptance();
DROP TRIGGER IF EXISTS trg_sla_acceptance ON public.ticket_team_members;
CREATE TRIGGER trg_sla_acceptance BEFORE UPDATE OF accepted_at ON public.ticket_team_members FOR EACH ROW EXECUTE FUNCTION public.sla_guard_acceptance();

-- ------------------------------------------------------------------------------------------------ settings RPCs
CREATE OR REPLACE FUNCTION public.sla_public_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN NULL ELSE
    (SELECT s - 'quiet_hours' FROM (SELECT public.sla_settings() AS s) q)
    || jsonb_build_object(
      'templates', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'key', p.template_key, 'name', p.name, 'description', p.description) ORDER BY p.created_at)
                               FROM public.sla_policies p WHERE p.scope = 'template' AND p.status = 'active'), '[]'::jsonb),
      'holiday_lists', COALESCE((SELECT jsonb_agg(DISTINCT h.list_key) FROM public.sla_holidays h), '[]'::jsonb),
      'disclaimer_version', 'draft-1')
  END
$$;

-- Admin: whole settings object (validated keys only). Turning the feature on/off is audited.
CREATE OR REPLACE FUNCTION public.sla_admin_set_settings(_value jsonb, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); before jsonb := public.sla_settings(); v jsonb; k text;
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(_value) <> 'object' THEN RAISE EXCEPTION 'sla_bad_settings' USING ERRCODE = '22023'; END IF;
  v := '{}'::jsonb;
  FOR k IN SELECT jsonb_object_keys(_value) LOOP
    IF k IN ('enabled', 'severities', 'urgency_map', 'bounds', 'at_risk_pct', 'quiet_hours', 'unpausable_allowed', 'require_acceptance',
             'compliance_alert_pct', 'channels_enabled') THEN
      v := v || jsonb_build_object(k, _value -> k);
    END IF;
  END LOOP;
  IF v ? 'enabled' AND jsonb_typeof(v -> 'enabled') <> 'boolean' THEN RAISE EXCEPTION 'sla_bad_settings: enabled' USING ERRCODE = '22023'; END IF;
  IF v ? 'urgency_map' AND EXISTS (SELECT 1 FROM jsonb_each_text(v -> 'urgency_map') e WHERE e.key NOT IN ('critical', 'high', 'medium', 'low') OR e.value NOT IN ('S1', 'S2', 'S3', 'S4')) THEN
    RAISE EXCEPTION 'sla_bad_settings: urgency_map' USING ERRCODE = '22023';
  END IF;
  IF v -> 'bounds' ? 'min_repeat_min' AND (v -> 'bounds' ->> 'min_repeat_min')::numeric < 30 THEN
    RAISE EXCEPTION 'sla_bad_settings: repeats must be at least 30 minutes apart' USING ERRCODE = '22023';
  END IF;
  IF v -> 'channels_enabled' ? 'sms' THEN RAISE EXCEPTION 'sla_bad_settings: SMS is not permitted' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.platform_settings (key, value) VALUES ('sla_policies', v)
  ON CONFLICT (key) DO UPDATE SET value = public.platform_settings.value || EXCLUDED.value, updated_at = now();
  INSERT INTO public.sla_audit (actor_id, action, detail) VALUES (uid, 'settings', jsonb_build_object('before', before, 'after', public.sla_settings(), 'reason', left(_reason, 300)));
  RETURN public.sla_settings();
END $$;

CREATE OR REPLACE FUNCTION public.sla_holidays_list()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN auth.uid() IS NULL THEN '[]'::jsonb ELSE COALESCE((
    SELECT jsonb_agg(jsonb_build_object('list', h.list_key, 'day', h.day, 'label_en', h.label_en, 'label_ar', h.label_ar) ORDER BY h.list_key, h.day)
      FROM public.sla_holidays h WHERE h.day >= (now() - interval '400 days')::date), '[]'::jsonb) END
$$;

CREATE OR REPLACE FUNCTION public.sla_admin_set_holiday(_list text, _day date, _label_en text DEFAULT '', _label_ar text DEFAULT '', _remove boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF _list !~ '^[A-Za-z0-9_-]{1,24}$' OR _day IS NULL THEN RAISE EXCEPTION 'sla_bad_holiday' USING ERRCODE = '22023'; END IF;
  IF _remove THEN
    DELETE FROM public.sla_holidays WHERE list_key = _list AND day = _day;
  ELSE
    INSERT INTO public.sla_holidays (list_key, day, label_en, label_ar, created_by)
    VALUES (upper(_list), _day, left(COALESCE(_label_en, ''), 120), left(COALESCE(_label_ar, ''), 120), uid)
    ON CONFLICT (list_key, day) DO UPDATE SET label_en = EXCLUDED.label_en, label_ar = EXCLUDED.label_ar;
  END IF;
  INSERT INTO public.sla_audit (actor_id, action, detail) VALUES (uid, CASE WHEN _remove THEN 'holiday_removed' ELSE 'holiday_saved' END,
    jsonb_build_object('list', _list, 'day', _day));
END $$;

-- ------------------------------------------------------------------------------------------------ policy RPCs
CREATE OR REPLACE FUNCTION public.sla_policy_json(_p public.sla_policies, _uid uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', _p.id, 'scope', _p.scope, 'tenant_id', _p.tenant_id, 'template_key', _p.template_key, 'is_default', _p.is_default,
    'name', _p.name, 'description', _p.description, 'applies_to', _p.applies_to, 'status', _p.status, 'current_version', _p.current_version,
    'active_version', _p.active_version, 'effective_from', _p.effective_from, 'lock_version', _p.lock_version, 'updated_at', _p.updated_at,
    'archived_at', _p.archived_at,
    'can_manage', CASE WHEN _p.scope = 'client' THEN public.sla_can_manage(_uid, _p.tenant_id, _p.client_id) ELSE public.sla_is_admin(_uid) END,
    'owner_name', CASE WHEN public.sla_is_admin(_uid) THEN COALESCE((SELECT t.name FROM public.tenants t WHERE t.id = _p.tenant_id),
                         (SELECT cp.company_name FROM public.client_profiles cp WHERE cp.user_id = _p.client_id LIMIT 1)) END)
$$;

CREATE OR REPLACE FUNCTION public.sla_can_read_policy(_p public.sla_policies, _uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (public.sla_is_admin(_uid)
    OR (_p.scope IN ('template', 'platform') AND _p.status = 'active' AND public.has_role(_uid, 'client'::app_role))
    OR (_p.scope = 'client' AND public.sla_can_read_owner(_uid, _p.tenant_id, _p.client_id)))
$$;

-- Client: policies of one company (or of the client himself when _tenant is NULL), plus the platform default.
CREATE OR REPLACE FUNCTION public.sla_my_policies(_tenant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.sla_can_read_owner(uid, _tenant, CASE WHEN _tenant IS NULL THEN uid END) THEN
    RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.sla_enabled(),
    'can_manage', public.sla_can_manage(uid, _tenant, CASE WHEN _tenant IS NULL THEN uid END),
    'policies', COALESCE((SELECT jsonb_agg(public.sla_policy_json(p, uid) ORDER BY p.status, p.updated_at DESC) FROM public.sla_policies p
                           WHERE p.scope = 'client' AND ((_tenant IS NOT NULL AND p.tenant_id = _tenant) OR (_tenant IS NULL AND p.tenant_id IS NULL AND p.client_id = uid))), '[]'::jsonb),
    'platform_default', (SELECT public.sla_policy_json(p, uid) || jsonb_build_object('body', v.body) FROM public.sla_policies p
                           JOIN public.sla_policy_versions v ON v.policy_id = p.id AND v.version = p.active_version WHERE p.is_default LIMIT 1));
END $$;

CREATE OR REPLACE FUNCTION public.sla_policy_get(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sla_policies; cur public.sla_policy_versions; manage boolean;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id;
  IF p.id IS NULL OR NOT public.sla_can_read_policy(p, uid) THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO cur FROM public.sla_policy_versions WHERE policy_id = _id AND version = p.current_version;
  manage := (public.sla_policy_json(p, uid) ->> 'can_manage')::boolean;
  RETURN public.sla_policy_json(p, uid) || jsonb_build_object(
    'body', cur.body, 'meta', cur.meta,
    'problems', public.sla_policy_problems(cur.body, cur.meta, p.tenant_id),
    'versions', COALESCE((SELECT jsonb_agg(jsonb_build_object('version', v.version, 'created_at', v.created_at, 'change_note', v.change_note,
                              'by_admin', public.sla_is_admin(v.created_by)) ORDER BY v.version DESC) FROM public.sla_policy_versions v WHERE v.policy_id = _id), '[]'::jsonb),
    'company_domain', CASE WHEN manage THEN (SELECT t.domain FROM public.tenants t WHERE t.id = p.tenant_id) END,
    'member_emails', CASE WHEN manage AND p.tenant_id IS NOT NULL THEN COALESCE((SELECT jsonb_agg(DISTINCT lower(u.email)) FROM public.tenant_members m
                       JOIN auth.users u ON u.id = m.user_id WHERE m.tenant_id = p.tenant_id AND m.accepted_at IS NOT NULL), '[]'::jsonb) END);
END $$;

CREATE OR REPLACE FUNCTION public.sla_policy_version(_id uuid, _version integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sla_policies; v public.sla_policy_versions;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id;
  IF p.id IS NULL OR NOT public.sla_can_read_policy(p, uid) THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.sla_policy_versions WHERE policy_id = _id AND version = _version;
  IF v.policy_id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object('version', v.version, 'body', v.body, 'meta', v.meta, 'change_note', v.change_note, 'created_at', v.created_at);
END $$;

-- Create (no _id) or add a version. Drafts always save (problems are returned); a malformed body is refused.
CREATE OR REPLACE FUNCTION public.sla_policy_save(_id uuid, _tenant uuid, _meta jsonb, _body jsonb, _note text DEFAULT '', _expected_lock integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); p public.sla_policies; probs jsonb; h text; ver integer; meta jsonb; admin_override boolean := false; m uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_rate_ok('sla_save:' || uid, 60, 3600) THEN RAISE EXCEPTION 'sla_rate_limited' USING ERRCODE = '53400'; END IF;
  meta := jsonb_build_object('name', left(btrim(COALESCE(_meta ->> 'name', '')), 120), 'description', left(COALESCE(_meta ->> 'description', ''), 1000),
                             'applies_to', COALESCE(_meta -> 'applies_to', '{"kind":"all","values":[]}'::jsonb));
  IF _id IS NULL THEN
    IF NOT public.sla_can_manage(uid, _tenant, CASE WHEN _tenant IS NULL THEN uid END) OR (_tenant IS NULL AND NOT public.has_role(uid, 'client'::app_role) AND NOT public.sla_is_admin(uid)) THEN
      RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501';
    END IF;
    IF (SELECT count(*) FROM public.sla_policies x WHERE x.scope = 'client' AND x.status <> 'archived'
          AND ((_tenant IS NOT NULL AND x.tenant_id = _tenant) OR (_tenant IS NULL AND x.client_id = uid))) >= 20 THEN
      RAISE EXCEPTION 'sla_too_many_policies' USING ERRCODE = '54000';
    END IF;
  ELSE
    SELECT * INTO p FROM public.sla_policies WHERE id = _id FOR UPDATE;
    IF p.id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
    IF p.scope = 'client' THEN
      IF NOT public.sla_can_manage(uid, p.tenant_id, p.client_id) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
      admin_override := public.sla_is_admin(uid) AND NOT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = p.tenant_id AND tm.user_id = uid)
                        AND p.client_id IS DISTINCT FROM uid;
    ELSIF NOT public.sla_is_admin(uid) THEN
      RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501';
    END IF;
    IF p.status = 'archived' THEN RAISE EXCEPTION 'sla_archived' USING ERRCODE = '55000'; END IF;
    IF _expected_lock IS NOT NULL AND _expected_lock <> p.lock_version THEN RAISE EXCEPTION 'sla_conflict: saved by someone else, reload' USING ERRCODE = '40001'; END IF;
  END IF;
  probs := public.sla_policy_problems(_body, meta, COALESCE(p.tenant_id, _tenant));
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(probs) x WHERE x ->> 'code' IN ('bad_shape', 'bad_step')) THEN
    RAISE EXCEPTION 'sla_bad_policy' USING ERRCODE = '22023';
  END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  h := public.sla_hash(_body, meta);

  IF _id IS NULL THEN
    INSERT INTO public.sla_policies (scope, tenant_id, client_id, name, description, applies_to, created_by, updated_by)
    VALUES ('client', _tenant, CASE WHEN _tenant IS NULL THEN uid END, meta ->> 'name', meta ->> 'description', meta -> 'applies_to', uid, uid)
    RETURNING * INTO p;
  ELSIF EXISTS (SELECT 1 FROM public.sla_policy_versions v WHERE v.policy_id = p.id AND v.version = p.current_version AND v.content_hash = h) THEN
    RETURN jsonb_build_object('id', p.id, 'version', p.current_version, 'unchanged', true, 'problems', probs, 'lock_version', p.lock_version);
  END IF;
  ver := p.current_version + 1;
  INSERT INTO public.sla_policy_versions (policy_id, version, body, meta, change_note, content_hash, created_by)
  VALUES (p.id, ver, _body, meta, left(COALESCE(_note, ''), 500), h, uid);
  UPDATE public.sla_policies SET current_version = ver, name = meta ->> 'name', description = meta ->> 'description', applies_to = meta -> 'applies_to',
         lock_version = lock_version + 1, updated_by = uid, updated_at = now()
   WHERE id = p.id RETURNING * INTO p;
  INSERT INTO public.sla_audit (actor_id, action, policy_id, detail)
  VALUES (uid, CASE WHEN ver = 1 THEN 'create' WHEN admin_override THEN 'override' ELSE 'version' END, p.id,
          jsonb_build_object('version', ver, 'note', left(_note, 300)));
  IF admin_override THEN
    FOR m IN SELECT tm.user_id FROM public.tenant_members tm WHERE tm.tenant_id = p.tenant_id AND tm.org_role IN ('owner'::org_role, 'admin'::org_role) AND tm.accepted_at IS NOT NULL
             UNION SELECT p.client_id WHERE p.client_id IS NOT NULL LOOP
      PERFORM public.safe_insert_notification(m, 'SLA policy updated by the platform team', 'A new version (v' || ver || ') of "' || p.name || '" was saved. Review it before activating.', 'sla', '/client/sla');
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', p.id, 'version', ver, 'problems', probs, 'lock_version', p.lock_version);
END $$;

CREATE OR REPLACE FUNCTION public.sla_policy_activate(_id uuid, _version integer, _effective_from timestamptz DEFAULT NULL, _apply_to_open boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sla_policies; v public.sla_policy_versions; probs jsonb; eff timestamptz := COALESCE(_effective_from, now()); n int := 0; tk record; e record; u uuid;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT (CASE WHEN p.scope = 'client' THEN public.sla_can_manage(uid, p.tenant_id, p.client_id) ELSE public.sla_is_admin(uid) END) THEN
    RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p.status = 'archived' THEN RAISE EXCEPTION 'sla_archived' USING ERRCODE = '55000'; END IF;
  SELECT * INTO v FROM public.sla_policy_versions WHERE policy_id = _id AND version = _version;
  IF v.policy_id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  probs := public.sla_policy_problems(v.body, v.meta, p.tenant_id);
  IF public.sla_has_errors(probs) THEN RAISE EXCEPTION 'sla_outside_bounds: fix the listed problems first' USING ERRCODE = '22023'; END IF;
  IF eff < now() - interval '5 minutes' THEN RAISE EXCEPTION 'sla_not_retroactive: effective date cannot be in the past' USING ERRCODE = '22023'; END IF;
  IF _apply_to_open AND eff > now() + interval '5 minutes' THEN RAISE EXCEPTION 'sla_apply_open_needs_now' USING ERRCODE = '22023'; END IF;
  UPDATE public.sla_policies SET status = 'active', active_version = _version, effective_from = eff, lock_version = lock_version + 1, updated_by = uid, updated_at = now()
   WHERE id = _id;
  INSERT INTO public.sla_audit (actor_id, action, policy_id, detail) VALUES (uid, 'activate', _id, jsonb_build_object('version', _version, 'effective_from', eff, 'apply_to_open', _apply_to_open));
  -- Open tickets keep their snapshot unless the client explicitly ticked "apply to open tickets".
  IF _apply_to_open AND p.scope = 'client' AND public.sla_enabled() THEN
    FOR tk IN SELECT t.id FROM public.tickets t JOIN public.sla_ticket_snapshots s ON s.ticket_id = t.id AND s.superseded_at IS NULL
               WHERE t.status::text NOT IN ('resolved', 'closed')
                 AND ((p.tenant_id IS NOT NULL AND t.tenant_id = p.tenant_id) OR (p.tenant_id IS NULL AND t.client_id = p.client_id))
               LIMIT 500 LOOP
      SELECT * INTO e FROM public.sla_effective_policy(tk.id);
      IF e.policy_id = _id THEN
        PERFORM public.sla_apply_snapshot(tk.id, 'new_policy', uid, 'carry', NULL, 'Policy activated for open tickets');
        FOR u IN SELECT a.user_id FROM public.sla_assigned(tk.id) a LOOP
          PERFORM public.safe_insert_notification(u, 'SLA policy changed on a ticket', 'The client applied "' || p.name || '" v' || _version || ' to this ticket.', 'sla', '/consultant/cases/' || tk.id);
        END LOOP;
        n := n + 1;
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('id', _id, 'active_version', _version, 'effective_from', eff, 'tickets_updated', n);
END $$;

CREATE OR REPLACE FUNCTION public.sla_policy_archive(_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sla_policies;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p.is_default THEN RAISE EXCEPTION 'sla_default_required: the platform default cannot be archived' USING ERRCODE = '55000'; END IF;
  IF NOT (CASE WHEN p.scope = 'client' THEN public.sla_can_manage(uid, p.tenant_id, p.client_id) ELSE public.sla_is_admin(uid) END) THEN
    RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sla_text_ok(_reason) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  UPDATE public.sla_policies SET status = 'archived', archived_at = now(), archive_reason = left(_reason, 300), lock_version = lock_version + 1, updated_by = uid, updated_at = now()
   WHERE id = _id;
  INSERT INTO public.sla_audit (actor_id, action, policy_id, detail) VALUES (uid, 'archive', _id, jsonb_build_object('reason', left(_reason, 300)));
END $$;

-- Copy of an own policy, a template or the platform default as a new draft of the caller's company (or own account).
CREATE OR REPLACE FUNCTION public.sla_policy_duplicate(_id uuid, _tenant uuid, _name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); p public.sla_policies; v public.sla_policy_versions; meta jsonb;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id;
  IF p.id IS NULL OR NOT public.sla_can_read_policy(p, uid) THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.sla_policy_versions WHERE policy_id = _id AND version = COALESCE(CASE WHEN p.scope = 'client' THEN p.current_version END, p.active_version, p.current_version);
  meta := v.meta || jsonb_build_object('name', left(COALESCE(NULLIF(btrim(_name), ''), p.name || ' (copy)'), 120));
  -- Copied extra contacts would belong to another company: they are dropped.
  RETURN public.sla_policy_save(NULL, _tenant, meta, v.body || jsonb_build_object('extra_contacts', CASE WHEN p.scope = 'client' AND p.tenant_id IS NOT DISTINCT FROM _tenant THEN COALESCE(v.body -> 'extra_contacts', '[]'::jsonb) ELSE '[]'::jsonb END),
    'Copied from ' || p.name || ' v' || v.version, NULL);
END $$;

CREATE OR REPLACE FUNCTION public.sla_policy_restore(_id uuid, _version integer, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.sla_policy_versions; p public.sla_policies;
BEGIN
  SELECT * INTO p FROM public.sla_policies WHERE id = _id;
  SELECT * INTO v FROM public.sla_policy_versions WHERE policy_id = _id AND version = _version;
  IF v.policy_id IS NULL THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN public.sla_policy_save(_id, p.tenant_id, v.meta, v.body, COALESCE(NULLIF(_note, ''), 'Restored from v' || _version), NULL);
END $$;

CREATE OR REPLACE FUNCTION public.sla_admin_policies(_search text DEFAULT NULL, _status text DEFAULT NULL, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(public.sla_policy_json(p, uid) ORDER BY p.is_default DESC, p.scope, p.updated_at DESC) FROM (
    SELECT * FROM public.sla_policies p
     WHERE (_status IS NULL OR p.status = _status)
       AND (_search IS NULL OR p.name ILIKE '%' || _search || '%'
            OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p.tenant_id AND t.name ILIKE '%' || _search || '%'))
     ORDER BY p.is_default DESC, p.scope, p.updated_at DESC
     LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200) OFFSET GREATEST(COALESCE(_offset, 0), 0)) p), '[]'::jsonb);
END $$;

-- ------------------------------------------------------------------------------------------------ ticket RPCs
CREATE OR REPLACE FUNCTION public.sla_clock_json(_c public.sla_ticket_clocks, _cal jsonb)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('kind', _c.kind, 'target_min', _c.target_min, 'extended_min', _c.extended_min, 'started_at', _c.started_at,
    'running_since', _c.running_since, 'consumed_min', round(_c.consumed_min, 2), 'paused_since', _c.paused_since, 'pause_reason', _c.pause_reason,
    'due_at', _c.due_at, 'met_at', _c.met_at, 'breached_at', _c.breached_at, 'stopped_at', _c.stopped_at,
    'consumed_now', round(_c.consumed_min + CASE WHEN _c.running_since IS NOT NULL THEN public.sla_business_minutes(_c.running_since, now(), _cal) ELSE 0 END, 2))
$$;

CREATE OR REPLACE FUNCTION public.sla_ticket_view(_ticket uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); role text := public.sla_ticket_role(_ticket, uid); sn public.sla_ticket_snapshots; t record; cid uuid; e record; data jsonb;
BEGIN
  IF role IS NULL THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT tk.sla_response_deadline, tk.sla_deadline, tk.first_response_at, tk.sla_breached, tk.urgency::text AS urgency INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  SELECT * INTO sn FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL;
  SELECT c.id INTO cid FROM public.consultants c WHERE c.user_id = uid LIMIT 1;
  IF sn.id IS NULL THEN
    RETURN jsonb_build_object('enabled', public.sla_enabled(), 'role', role, 'snapshot', NULL,
      'legacy', jsonb_build_object('response_due', t.sla_response_deadline, 'resolution_due', t.sla_deadline, 'first_response_at', t.first_response_at, 'breached', t.sla_breached));
  END IF;
  data := sn.data;
  IF role NOT IN ('admin', 'client', 'client_manager') THEN data := data - 'extra_contacts'; END IF;
  IF role IN ('client', 'client_manager', 'admin') THEN
    SELECT * INTO e FROM public.sla_effective_policy(_ticket);
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.sla_enabled(), 'role', role,
    'snapshot', jsonb_build_object('id', sn.id, 'policy_name', sn.policy_name, 'version', sn.policy_version, 'severity', sn.severity, 'data', data,
                                   'reason', sn.reason, 'created_at', sn.created_at),
    'clocks', CASE WHEN role = 'candidate' THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(public.sla_clock_json(c, sn.data -> 'calendar') ORDER BY array_position(ARRAY['response', 'workaround', 'resolution'], c.kind))
                 FROM public.sla_ticket_clocks c WHERE c.ticket_id = _ticket), '[]'::jsonb) END,
    'events', CASE WHEN role = 'candidate' THEN '[]'::jsonb ELSE COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', x.kind, 'role', x.actor_role, 'data', x.data, 'at', x.created_at) ORDER BY x.created_at DESC)
                 FROM (SELECT * FROM public.sla_ticket_events ev WHERE ev.ticket_id = _ticket ORDER BY ev.created_at DESC LIMIT 100) x), '[]'::jsonb) END,
    'accepted', CASE WHEN cid IS NOT NULL THEN EXISTS (SELECT 1 FROM public.sla_acceptances a WHERE a.ticket_id = _ticket AND a.consultant_id = cid AND a.snapshot_id = sn.id) END,
    'acceptances', CASE WHEN role IN ('client', 'client_manager', 'admin') THEN (SELECT count(*) FROM public.sla_acceptances a WHERE a.ticket_id = _ticket AND a.snapshot_id = sn.id) END,
    'require_acceptance', COALESCE((public.sla_settings() ->> 'require_acceptance')::boolean, true),
    'counters', CASE WHEN role IN ('client', 'client_manager', 'admin') THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'consultant_id', k.consultant_id, 'targets', k.targets, 'note', k.note, 'created_at', k.created_at))
                   FROM public.sla_counter_proposals k WHERE k.ticket_id = _ticket AND k.status = 'pending'), '[]'::jsonb)
                     WHEN cid IS NOT NULL THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', k.id, 'targets', k.targets, 'note', k.note, 'status', k.status, 'created_at', k.created_at))
                   FROM public.sla_counter_proposals k WHERE k.ticket_id = _ticket AND k.consultant_id = cid), '[]'::jsonb) END,
    'reclass', (SELECT jsonb_build_object('id', r.id, 'from', r.from_severity, 'to', r.to_severity, 'reason', r.reason, 'created_at', r.created_at)
                  FROM public.sla_reclass_requests r WHERE r.ticket_id = _ticket AND r.status = 'pending' AND role <> 'candidate'),
    'newer_policy', CASE WHEN e.policy_id IS NOT NULL AND (e.policy_id IS DISTINCT FROM sn.policy_id OR e.version IS DISTINCT FROM sn.policy_version)
                         THEN jsonb_build_object('policy_id', e.policy_id, 'version', e.version, 'name', e.name) END,
    'can', jsonb_build_object(
      'acknowledge', role = 'consultant', 'workaround', role = 'consultant', 'propose_reclass', role = 'consultant',
      'accept', role IN ('candidate', 'consultant') AND cid IS NOT NULL, 'counter', role = 'candidate',
      'decide', role IN ('client', 'client_manager', 'admin'), 'reclassify', role = 'admin',
      'apply_policy', role IN ('client', 'client_manager', 'admin'), 'breach_choice', role IN ('client', 'client_manager', 'admin')));
END $$;

-- SLA columns for ticket lists (only tickets the viewer may see; at most 200 ids).
CREATE OR REPLACE FUNCTION public.sla_list_states(_tickets uuid[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ticket_id', s.ticket_id, 'severity', s.severity, 'calendar', s.data -> 'calendar',
           'clocks', (SELECT jsonb_agg(public.sla_clock_json(c, s.data -> 'calendar')) FROM public.sla_ticket_clocks c WHERE c.ticket_id = s.ticket_id))), '[]'::jsonb)
    FROM public.sla_ticket_snapshots s
   WHERE s.superseded_at IS NULL AND s.ticket_id = ANY (_tickets[1:200])
     AND public.sla_ticket_role(s.ticket_id, auth.uid()) IN ('admin', 'client', 'client_manager', 'company', 'consultant')
$$;

CREATE OR REPLACE FUNCTION public.sla_accept(_ticket uuid, _context text DEFAULT 'assignment')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); role text := public.sla_ticket_role(_ticket, uid); cid uuid; sn public.sla_ticket_snapshots; summary text;
BEGIN
  IF role NOT IN ('candidate', 'consultant') THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF _context NOT IN ('assignment', 'bid', 'team') THEN RAISE EXCEPTION 'sla_bad_context' USING ERRCODE = '22023'; END IF;
  SELECT c.id INTO cid FROM public.consultants c WHERE c.user_id = uid LIMIT 1;
  SELECT * INTO sn FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL;
  IF sn.id IS NULL THEN RETURN jsonb_build_object('accepted', false, 'reason', 'no_sla'); END IF;
  summary := sn.severity || ' response ' || public.sla_fmt_minutes((sn.data ->> 'response_min')::numeric) || ', resolution '
    || public.sla_fmt_minutes((sn.data ->> 'resolution_min')::numeric) || CASE WHEN sn.data -> 'calendar' ->> 'mode' = 'business' THEN ' (business hours)' ELSE ' (24x7)' END
    || ' - ' || sn.policy_name || ' v' || sn.policy_version;
  INSERT INTO public.sla_acceptances (ticket_id, consultant_id, user_id, snapshot_id, policy_id, policy_version, summary, context)
  VALUES (_ticket, cid, uid, sn.id, sn.policy_id, sn.policy_version, summary, _context)
  ON CONFLICT (ticket_id, consultant_id, snapshot_id) DO NOTHING;
  PERFORM public.sla_event(_ticket, 'accepted', uid, jsonb_build_object('version', sn.policy_version, 'severity', sn.severity));
  RETURN jsonb_build_object('accepted', true, 'snapshot_id', sn.id, 'summary', summary);
END $$;

CREATE OR REPLACE FUNCTION public.sla_counter_propose(_ticket uuid, _targets jsonb, _note text DEFAULT '', _proposal uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cid uuid; sn public.sla_ticket_snapshots; b jsonb := public.sla_settings() -> 'bounds'; r int; res int; w int; id uuid; t record;
BEGIN
  IF public.sla_ticket_role(_ticket, uid) <> 'candidate' THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_rate_ok('sla_counter:' || uid, 10, 3600) THEN RAISE EXCEPTION 'sla_rate_limited' USING ERRCODE = '53400'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  SELECT c.id INTO cid FROM public.consultants c WHERE c.user_id = uid LIMIT 1;
  SELECT * INTO sn FROM public.sla_ticket_snapshots s WHERE s.ticket_id = _ticket AND s.superseded_at IS NULL;
  IF sn.id IS NULL THEN RAISE EXCEPTION 'sla_no_policy' USING ERRCODE = 'P0002'; END IF;
  r := (_targets ->> 'response_min')::int; res := (_targets ->> 'resolution_min')::int;
  w := CASE WHEN jsonb_typeof(_targets -> 'workaround_min') = 'number' THEN (_targets ->> 'workaround_min')::int END;
  IF r IS NULL OR res IS NULL OR r < COALESCE((b -> 'min_response' ->> sn.severity)::int, 1) OR res < COALESCE((b -> 'min_resolution' ->> sn.severity)::int, 1)
     OR res <= r OR r > 525600 OR res > 525600 OR (w IS NOT NULL AND (w < r OR w > res)) THEN
    RAISE EXCEPTION 'sla_outside_bounds' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.sla_counter_proposals (ticket_id, consultant_id, user_id, snapshot_id, proposal_id, targets, note)
  VALUES (_ticket, cid, uid, sn.id, _proposal, jsonb_strip_nulls(jsonb_build_object('response_min', r, 'resolution_min', res, 'workaround_min', w)), left(COALESCE(_note, ''), 500))
  ON CONFLICT (ticket_id, consultant_id) WHERE status = 'pending' DO UPDATE SET targets = EXCLUDED.targets, note = EXCLUDED.note, snapshot_id = EXCLUDED.snapshot_id, created_at = now()
  RETURNING sla_counter_proposals.id INTO id;
  SELECT tk.client_id, left(tk.title, 120) AS title INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  PERFORM public.safe_insert_notification(t.client_id, 'SLA counter-proposal', 'A consultant proposed different SLA targets for "' || t.title || '".', 'sla', '/client/tickets/' || _ticket);
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION public.sla_decide_counter(_id uuid, _accept boolean, _note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); k public.sla_counter_proposals;
BEGIN
  SELECT * INTO k FROM public.sla_counter_proposals WHERE id = _id FOR UPDATE;
  IF k.id IS NULL OR k.status <> 'pending' THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.sla_client_can_act(k.ticket_id, uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  UPDATE public.sla_counter_proposals SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END, decided_by = uid, decided_at = now() WHERE id = _id;
  IF _accept THEN
    UPDATE public.sla_counter_proposals SET status = 'withdrawn', decided_at = now() WHERE ticket_id = k.ticket_id AND status = 'pending' AND id <> _id;
    PERFORM public.sla_apply_snapshot(k.ticket_id, 'counter_accepted', uid, 'carry', NULL, NULLIF(_note, ''), NULL, NULL, k.targets);
    -- The proposing consultant's acceptance carries over to the new snapshot (these are his own targets).
    INSERT INTO public.sla_acceptances (ticket_id, consultant_id, user_id, snapshot_id, policy_id, policy_version, summary, context)
    SELECT k.ticket_id, k.consultant_id, k.user_id, s.id, s.policy_id, s.policy_version, 'Counter-proposal accepted by the client', 'bid'
      FROM public.sla_ticket_snapshots s WHERE s.ticket_id = k.ticket_id AND s.superseded_at IS NULL
    ON CONFLICT DO NOTHING;
  END IF;
  PERFORM public.safe_insert_notification(k.user_id, CASE WHEN _accept THEN 'SLA counter-proposal accepted' ELSE 'SLA counter-proposal declined' END,
    CASE WHEN _accept THEN 'The client accepted your SLA targets.' ELSE 'The client kept the original SLA targets.' END, 'sla', '/consultant/cases/' || k.ticket_id);
END $$;

CREATE OR REPLACE FUNCTION public.sla_acknowledge(_ticket uuid, _note text DEFAULT '', _eta timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF public.sla_ticket_role(_ticket, uid) <> 'consultant' THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_rate_ok('sla_ack:' || uid, 30, 3600) THEN RAISE EXCEPTION 'sla_rate_limited' USING ERRCODE = '53400'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  IF _eta IS NOT NULL AND (_eta < now() - interval '1 hour' OR _eta > now() + interval '180 days') THEN RAISE EXCEPTION 'sla_bad_eta' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sla_acknowledgements (ticket_id, user_id, note, eta) VALUES (_ticket, uid, left(COALESCE(_note, ''), 500), _eta);
  PERFORM public.sla_event(_ticket, 'acknowledged', uid, jsonb_strip_nulls(jsonb_build_object('note', NULLIF(left(_note, 500), ''), 'eta', _eta)));
END $$;

CREATE OR REPLACE FUNCTION public.sla_mark_workaround(_ticket uuid, _note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); c public.sla_ticket_clocks; sn public.sla_ticket_snapshots; used numeric;
BEGIN
  IF public.sla_ticket_role(_ticket, uid) <> 'consultant' THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.sla_ticket_clocks WHERE ticket_id = _ticket AND kind = 'workaround' FOR UPDATE;
  IF c.ticket_id IS NULL OR c.met_at IS NOT NULL OR c.started_at IS NULL THEN RAISE EXCEPTION 'sla_no_open_workaround' USING ERRCODE = '55000'; END IF;
  SELECT * INTO sn FROM public.sla_ticket_snapshots WHERE id = c.snapshot_id;
  used := c.consumed_min + CASE WHEN c.running_since IS NOT NULL THEN public.sla_business_minutes(c.running_since, now(), sn.data -> 'calendar') ELSE 0 END;
  UPDATE public.sla_ticket_clocks SET consumed_min = used, met_at = now(), stopped_at = now(), running_since = NULL, paused_since = NULL, due_at = NULL,
         breached_at = COALESCE(breached_at, CASE WHEN used > target_min + extended_min THEN now() END), updated_at = now()
   WHERE ticket_id = _ticket AND kind = 'workaround';
  UPDATE public.sla_ticket_pauses SET ended_at = now() WHERE ticket_id = _ticket AND clock = 'workaround' AND ended_at IS NULL;
  PERFORM public.sla_event(_ticket, 'workaround_met', uid, jsonb_strip_nulls(jsonb_build_object('note', NULLIF(left(_note, 300), ''))));
END $$;

-- Internal: change severity (urgency) with a logged reason; the urgency trigger recomputes the targets from now.
CREATE OR REPLACE FUNCTION public.sla_set_severity(_ticket uuid, _severity text, _reason text, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE urg text; cur text;
BEGIN
  SELECT e.key INTO urg FROM jsonb_each_text(public.sla_settings() -> 'urgency_map') e WHERE e.value = _severity
   ORDER BY array_position(ARRAY['critical', 'high', 'medium', 'low'], e.key) LIMIT 1;
  IF urg IS NULL THEN RAISE EXCEPTION 'sla_bad_severity' USING ERRCODE = '22023'; END IF;
  SELECT tk.urgency::text INTO cur FROM public.tickets tk WHERE tk.id = _ticket;
  PERFORM set_config('sla.reason', left(COALESCE(_reason, ''), 300), true);
  IF cur IS DISTINCT FROM urg THEN
    UPDATE public.tickets SET urgency = urg::urgency_level WHERE id = _ticket;
  ELSE
    PERFORM public.sla_apply_snapshot(_ticket, 'reclassified', _actor, 'fresh', _severity, _reason);
  END IF;
  PERFORM set_config('sla.reason', '', true);
  INSERT INTO public.sla_audit (actor_id, action, ticket_id, detail) VALUES (_actor, 'reclassify', _ticket, jsonb_build_object('to', _severity, 'reason', left(_reason, 300)));
END $$;

CREATE OR REPLACE FUNCTION public.sla_reclassify(_ticket uuid, _severity text, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); u uuid; t record;
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF char_length(btrim(COALESCE(_reason, ''))) < 3 THEN RAISE EXCEPTION 'sla_reason_required' USING ERRCODE = '22023'; END IF;
  IF NOT public.sla_text_ok(_reason) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  PERFORM public.sla_set_severity(_ticket, _severity, _reason, uid);
  SELECT tk.client_id, left(tk.title, 120) AS title INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  FOR u IN SELECT t.client_id UNION SELECT a.user_id FROM public.sla_assigned(_ticket) a LOOP
    PERFORM public.safe_insert_notification(u, 'Ticket severity changed to ' || _severity, '"' || t.title || '": ' || left(_reason, 300), 'sla',
      CASE WHEN u = t.client_id THEN '/client/tickets/' ELSE '/consultant/cases/' END || _ticket);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.sla_propose_reclass(_ticket uuid, _severity text, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); sn public.sla_ticket_snapshots; id uuid; t record;
BEGIN
  IF public.sla_ticket_role(_ticket, uid) <> 'consultant' THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_rate_ok('sla_reclass:' || uid, 5, 3600) THEN RAISE EXCEPTION 'sla_rate_limited' USING ERRCODE = '53400'; END IF;
  IF char_length(btrim(COALESCE(_reason, ''))) < 3 OR NOT public.sla_text_ok(_reason) THEN RAISE EXCEPTION 'sla_reason_required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO sn FROM public.sla_ticket_snapshots WHERE ticket_id = _ticket AND superseded_at IS NULL;
  IF sn.id IS NULL OR sn.severity = _severity THEN RAISE EXCEPTION 'sla_bad_severity' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.sla_reclass_requests (ticket_id, from_severity, to_severity, reason, proposed_by)
  VALUES (_ticket, sn.severity, _severity, left(_reason, 500), uid) RETURNING sla_reclass_requests.id INTO id;
  PERFORM public.sla_event(_ticket, 'reclass_proposed', uid, jsonb_build_object('from', sn.severity, 'to', _severity, 'reason', left(_reason, 300)));
  SELECT tk.client_id, left(tk.title, 120) AS title INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  PERFORM public.safe_insert_notification(t.client_id, 'Severity change proposed', 'The consultant proposes ' || _severity || ' for "' || t.title || '". Please accept or decline.', 'sla', '/client/tickets/' || _ticket);
  RETURN id;
END $$;

CREATE OR REPLACE FUNCTION public.sla_decide_reclass(_id uuid, _accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); r public.sla_reclass_requests;
BEGIN
  SELECT * INTO r FROM public.sla_reclass_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'pending' THEN RAISE EXCEPTION 'sla_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.sla_client_can_act(r.ticket_id, uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.sla_reclass_requests SET status = CASE WHEN _accept THEN 'accepted' ELSE 'declined' END, decided_by = uid, decided_at = now() WHERE id = _id;
  IF _accept THEN PERFORM public.sla_set_severity(r.ticket_id, r.to_severity, r.reason, uid);
  ELSE PERFORM public.sla_event(r.ticket_id, 'reclass_declined', uid, jsonb_build_object('to', r.to_severity));
  END IF;
  PERFORM public.safe_insert_notification(r.proposed_by, CASE WHEN _accept THEN 'Severity change accepted' ELSE 'Severity change declined' END,
    'Your proposal ' || r.from_severity || ' → ' || r.to_severity || ' was ' || CASE WHEN _accept THEN 'accepted.' ELSE 'declined.' END, 'sla', '/consultant/cases/' || r.ticket_id);
END $$;

-- "Apply new policy to this ticket": both parties informed; counted minutes are kept.
CREATE OR REPLACE FUNCTION public.sla_apply_new_policy(_ticket uuid, _note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); e record; sn public.sla_ticket_snapshots; sid uuid; u uuid; t record;
BEGIN
  IF NOT public.sla_client_can_act(_ticket, uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  SELECT * INTO sn FROM public.sla_ticket_snapshots WHERE ticket_id = _ticket AND superseded_at IS NULL;
  SELECT * INTO e FROM public.sla_effective_policy(_ticket);
  IF sn.id IS NULL OR e.policy_id IS NULL OR (e.policy_id = sn.policy_id AND e.version = sn.policy_version) THEN
    RETURN jsonb_build_object('changed', false);
  END IF;
  sid := public.sla_apply_snapshot(_ticket, 'new_policy', uid, 'carry', sn.severity, NULLIF(_note, ''), e.policy_id, e.version);
  INSERT INTO public.sla_audit (actor_id, action, ticket_id, policy_id, detail) VALUES (uid, 'apply_to_ticket', _ticket, e.policy_id, jsonb_build_object('version', e.version));
  SELECT tk.client_id, left(tk.title, 120) AS title INTO t FROM public.tickets tk WHERE tk.id = _ticket;
  FOR u IN SELECT a.user_id FROM public.sla_assigned(_ticket) a UNION SELECT t.client_id LOOP
    PERFORM public.safe_insert_notification(u, 'SLA policy changed on a ticket', '"' || t.title || '" now follows ' || e.name || ' v' || e.version || '.', 'sla',
      CASE WHEN u = t.client_id THEN '/client/tickets/' ELSE '/consultant/cases/' END || _ticket);
  END LOOP;
  RETURN jsonb_build_object('changed', true, 'snapshot_id', sid);
END $$;

-- Client choice after a breach: extend (adds counted minutes, up to the original target again), ask for another
-- consultant (admin uses the existing replace flow) or request admin help.
CREATE OR REPLACE FUNCTION public.sla_breach_choice(_ticket uuid, _clock text, _choice text, _extend_min integer DEFAULT NULL, _note text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); c public.sla_ticket_clocks; a uuid; t record;
BEGIN
  IF NOT public.sla_client_can_act(_ticket, uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF _choice NOT IN ('extend', 'reassign', 'admin_help') THEN RAISE EXCEPTION 'sla_bad_choice' USING ERRCODE = '22023'; END IF;
  IF NOT public.sla_text_ok(_note) THEN RAISE EXCEPTION 'sla_contact_details' USING ERRCODE = '22023'; END IF;
  IF NOT public.sla_rate_ok('sla_choice:' || uid, 20, 3600) THEN RAISE EXCEPTION 'sla_rate_limited' USING ERRCODE = '53400'; END IF;
  SELECT * INTO c FROM public.sla_ticket_clocks WHERE ticket_id = _ticket AND kind = _clock FOR UPDATE;
  IF c.ticket_id IS NULL OR c.breached_at IS NULL OR c.met_at IS NOT NULL THEN RAISE EXCEPTION 'sla_not_breached' USING ERRCODE = '55000'; END IF;
  INSERT INTO public.sla_breach_choices (ticket_id, clock, choice, extend_min, note, chosen_by) VALUES (_ticket, _clock, _choice, _extend_min, left(COALESCE(_note, ''), 500), uid);
  IF _choice = 'extend' THEN
    IF _extend_min IS NULL OR _extend_min < 15 OR c.extended_min + _extend_min > c.target_min * 3 THEN RAISE EXCEPTION 'sla_bad_extension' USING ERRCODE = '22023'; END IF;
    UPDATE public.sla_ticket_clocks SET extended_min = extended_min + _extend_min, breached_at = NULL, updated_at = now() WHERE ticket_id = _ticket AND kind = _clock;
    -- The next steps of the ladder may fire again for the extended target.
    DELETE FROM public.sla_reminders_sent WHERE ticket_id = _ticket AND snapshot_id = c.snapshot_id AND (step_key LIKE _clock || ':%' OR step_key = 'breach_actions:' || _clock);
    PERFORM public.sla_reconcile(_ticket);
  ELSE
    SELECT left(tk.title, 120) AS title INTO t FROM public.tickets tk WHERE tk.id = _ticket;
    FOR a IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin'::app_role, 'super_admin'::app_role) LOOP
      PERFORM public.safe_insert_notification(a, CASE WHEN _choice = 'reassign' THEN 'Client asks for another consultant (SLA)' ELSE 'Client asks for admin help (SLA)' END,
        '"' || t.title || '"' || CASE WHEN NULLIF(_note, '') IS NOT NULL THEN ': ' || left(_note, 300) ELSE '' END, 'sla', '/admin/tickets');
    END LOOP;
  END IF;
  PERFORM public.sla_event(_ticket, 'breach_choice', uid, jsonb_strip_nulls(jsonb_build_object('clock', _clock, 'choice', _choice, 'extend_min', _extend_min)));
END $$;

-- ------------------------------------------------------------------------------------------------ reports
CREATE OR REPLACE FUNCTION public.sla_report_rows(_since timestamptz)
RETURNS TABLE (ticket_id uuid, title text, tenant_id uuid, client_id uuid, consultant_id uuid, severity text, kind text, target numeric,
               used numeric, met_at timestamptz, breached_at timestamptz, due_at timestamptz, paused boolean, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, left(t.title, 120), t.tenant_id, t.client_id, t.consultant_id, s.severity, c.kind, c.target_min + c.extended_min,
         c.consumed_min + CASE WHEN c.running_since IS NOT NULL THEN public.sla_business_minutes(c.running_since, now(), s.data -> 'calendar') ELSE 0 END,
         c.met_at, c.breached_at, c.due_at, c.paused_since IS NOT NULL, t.created_at
    FROM public.sla_ticket_clocks c
    JOIN public.sla_ticket_snapshots s ON s.id = c.snapshot_id
    JOIN public.tickets t ON t.id = c.ticket_id
   WHERE c.started_at IS NOT NULL AND (c.met_at IS NULL OR c.met_at >= _since)
$$;

CREATE OR REPLACE FUNCTION public.sla_summarise(_rows jsonb, _at_risk numeric)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH r AS (SELECT x FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb)) x)
  SELECT jsonb_build_object(
    'by_severity', COALESCE((SELECT jsonb_object_agg(sev, v) FROM (
        SELECT x ->> 'severity' AS sev, jsonb_build_object(
          'measured', count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL),
          'met', count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL AND x ->> 'breached_at' IS NULL),
          'pct', round(100.0 * count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL AND x ->> 'breached_at' IS NULL) / NULLIF(count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL), 0), 1),
          'avg_response_min', round(avg((x ->> 'used')::numeric) FILTER (WHERE x ->> 'kind' = 'response' AND x ->> 'met_at' IS NOT NULL)),
          'avg_resolution_min', round(avg((x ->> 'used')::numeric) FILTER (WHERE x ->> 'kind' = 'resolution' AND x ->> 'met_at' IS NOT NULL))) AS v
          FROM r GROUP BY x ->> 'severity') q), '{}'::jsonb),
    'pct', (SELECT round(100.0 * count(*) FILTER (WHERE x ->> 'breached_at' IS NULL) / NULLIF(count(*), 0), 1) FROM r WHERE x ->> 'met_at' IS NOT NULL),
    'breached_open', (SELECT count(DISTINCT x ->> 'ticket_id') FROM r WHERE x ->> 'met_at' IS NULL AND x ->> 'breached_at' IS NOT NULL),
    'at_risk', COALESCE((SELECT jsonb_agg(x ORDER BY (x ->> 'due_at')) FROM (SELECT x FROM r WHERE x ->> 'met_at' IS NULL
          AND (x ->> 'breached_at' IS NOT NULL OR (x ->> 'used')::numeric >= (x ->> 'target')::numeric * _at_risk / 100) LIMIT 50) q), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.sla_client_report(_tenant uuid DEFAULT NULL, _days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); rows jsonb;
BEGIN
  IF NOT public.sla_can_read_owner(uid, _tenant, CASE WHEN _tenant IS NULL THEN uid END) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tenant_id' - 'client_id' - 'consultant_id'), '[]'::jsonb) INTO rows
    FROM public.sla_report_rows(now() - make_interval(days => LEAST(GREATEST(COALESCE(_days, 30), 1), 365))) r
   WHERE (_tenant IS NOT NULL AND r.tenant_id = _tenant) OR (_tenant IS NULL AND r.client_id = uid);
  RETURN public.sla_summarise(rows, COALESCE((public.sla_settings() ->> 'at_risk_pct')::numeric, 75)) || jsonb_build_object('enabled', public.sla_enabled(), 'days', _days);
END $$;

CREATE OR REPLACE FUNCTION public.sla_consultant_report(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); cid uuid; rows jsonb;
BEGIN
  SELECT c.id INTO cid FROM public.consultants c WHERE c.user_id = uid LIMIT 1;
  IF cid IS NULL THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) - 'tenant_id' - 'client_id' - 'consultant_id'), '[]'::jsonb) INTO rows
    FROM public.sla_report_rows(now() - make_interval(days => LEAST(GREATEST(COALESCE(_days, 30), 1), 365))) r
   WHERE EXISTS (SELECT 1 FROM public.sla_assigned(r.ticket_id) a WHERE a.consultant_id = cid);
  RETURN public.sla_summarise(rows, COALESCE((public.sla_settings() ->> 'at_risk_pct')::numeric, 75)) || jsonb_build_object('enabled', public.sla_enabled(), 'days', _days);
END $$;

CREATE OR REPLACE FUNCTION public.sla_admin_report(_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); rows jsonb; base jsonb;
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) || jsonb_build_object(
           'company', COALESCE((SELECT t.name FROM public.tenants t WHERE t.id = r.tenant_id), (SELECT cp.company_name FROM public.client_profiles cp WHERE cp.user_id = r.client_id LIMIT 1)),
           'consultant', (SELECT p.display_name FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id WHERE c.id = r.consultant_id LIMIT 1),
           'reason', CASE WHEN r.breached_at IS NULL THEN NULL WHEN r.kind = 'response' THEN 'response_breach' WHEN r.kind = 'workaround' THEN 'workaround_breach' ELSE 'resolution_breach' END,
           'acknowledged', EXISTS (SELECT 1 FROM public.sla_acknowledgements a WHERE a.ticket_id = r.ticket_id),
           'had_pauses', EXISTS (SELECT 1 FROM public.sla_ticket_pauses p WHERE p.ticket_id = r.ticket_id AND p.clock = r.kind))), '[]'::jsonb) INTO rows
    FROM public.sla_report_rows(now() - make_interval(days => LEAST(GREATEST(COALESCE(_days, 30), 1), 365))) r;
  base := public.sla_summarise(rows, COALESCE((public.sla_settings() ->> 'at_risk_pct')::numeric, 75));
  RETURN base || jsonb_build_object('enabled', public.sla_enabled(), 'days', _days,
    'by_company', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', k, 'measured', m, 'pct', p) ORDER BY p NULLS LAST) FROM (
        SELECT x ->> 'company' AS k, count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL) AS m,
               round(100.0 * count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL AND x ->> 'breached_at' IS NULL) / NULLIF(count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL), 0), 1) AS p
          FROM jsonb_array_elements(rows) x GROUP BY 1) q), '[]'::jsonb),
    'by_consultant', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', k, 'measured', m, 'pct', p) ORDER BY p NULLS LAST) FROM (
        SELECT x ->> 'consultant' AS k, count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL) AS m,
               round(100.0 * count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL AND x ->> 'breached_at' IS NULL) / NULLIF(count(*) FILTER (WHERE x ->> 'met_at' IS NOT NULL), 0), 1) AS p
          FROM jsonb_array_elements(rows) x WHERE x ->> 'consultant' IS NOT NULL GROUP BY 1) q), '[]'::jsonb),
    'breaches', COALESCE((SELECT jsonb_agg(x ORDER BY x ->> 'breached_at' DESC) FROM (SELECT x FROM jsonb_array_elements(rows) x WHERE x ->> 'breached_at' IS NOT NULL LIMIT 500) q), '[]'::jsonb),
    'alert_pct', (public.sla_settings() ->> 'compliance_alert_pct')::numeric);
END $$;

-- Admin dry run: what a ticket would get under a policy version and when each step would fire (nothing is written).
CREATE OR REPLACE FUNCTION public.sla_admin_simulate(_ticket uuid, _policy uuid DEFAULT NULL, _version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); pid uuid := _policy; ver integer := _version; data jsonb; sev text; st jsonb; plan jsonb := '[]'::jsonb; tgt numeric; th numeric; start timestamptz := now();
BEGIN
  IF NOT public.sla_is_admin(uid) THEN RAISE EXCEPTION 'sla_forbidden' USING ERRCODE = '42501'; END IF;
  IF pid IS NULL THEN SELECT e.policy_id, e.version INTO pid, ver FROM public.sla_effective_policy(_ticket) e; END IF;
  IF ver IS NULL THEN SELECT p.active_version INTO ver FROM public.sla_policies p WHERE p.id = pid; END IF;
  SELECT public.sla_severity_for(tk.urgency::text) INTO sev FROM public.tickets tk WHERE tk.id = _ticket;
  data := public.sla_snapshot_data(pid, ver, sev, _ticket);
  IF data IS NULL THEN RETURN NULL; END IF;
  FOR st IN SELECT x FROM jsonb_array_elements(COALESCE(data -> 'escalations', '[]'::jsonb)) x LOOP
    tgt := (data ->> ((st ->> 'clock') || '_min'))::numeric;
    IF tgt IS NULL THEN CONTINUE; END IF;
    th := CASE WHEN st ->> 'kind' = 'percent' THEN ceil(tgt * (st ->> 'value')::numeric / 100) ELSE tgt + (st ->> 'value')::numeric END;
    plan := plan || jsonb_build_object('step', st, 'at', public.sla_add_business_minutes(start, th, data -> 'calendar'),
      'recipients', (SELECT count(*) FROM public.sla_step_recipients(_ticket, st -> 'who', data -> 'extra_contacts')));
  END LOOP;
  RETURN jsonb_build_object('policy_id', pid, 'version', ver, 'severity', sev, 'data', data, 'plan', plan,
    'response_due', public.sla_add_business_minutes(start, (data ->> 'response_min')::numeric, data -> 'calendar'),
    'resolution_due', public.sla_add_business_minutes(start, (data ->> 'resolution_min')::numeric, data -> 'calendar'));
END $$;

-- ------------------------------------------------------------------------------------------------ seed: platform default + templates
-- Platform default v1 = today's live system rows of ticket_sla_policies (falls back to 60/480, 240/1440, 480/4320,
-- 1440/10080), 24x7, measured from submission, no pauses, breach notice in-app to the consultant and administrators.
DO $$
DECLARE
  pid uuid; body jsonb; sev jsonb := '{}'::jsonb; k text; u text; r int; res int; breach jsonb;
  m jsonb := '{"critical":"S1","high":"S2","medium":"S3","low":"S4"}'::jsonb;
  dflt jsonb := '{"S1":[60,480],"S2":[240,1440],"S3":[480,4320],"S4":[1440,10080]}'::jsonb;
  biz jsonb := '{"mode":"business","tz":null,"days":[0,1,2,3,4],"start":"09:00","end":"17:00","holidays":[],"holiday_lists":[]}'::jsonb;
  all_pause jsonb := '["waiting_client_info","waiting_third_party","on_hold","waiting_for_client","awaiting_nda","awaiting_brd_approval"]'::jsonb;
  tpl record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sla_policies WHERE is_default) THEN
    FOR u, k IN SELECT key, value FROM jsonb_each_text(m) LOOP
      SELECT p.response_time_minutes, p.resolution_time_minutes INTO r, res FROM public.ticket_sla_policies p
       WHERE p.client_id IS NULL AND p.is_active AND p.urgency::text = u AND p.sap_module IS NULL ORDER BY p.created_at LIMIT 1;
      r := COALESCE(r, (dflt -> k ->> 0)::int); res := COALESCE(res, (dflt -> k ->> 1)::int);
      breach := jsonb_build_array(
        jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 100, 'who', '["lead","admin"]'::jsonb, 'channels', '["in_app"]'::jsonb, 'template', 'breach', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
        jsonb_build_object('clock', 'resolution', 'kind', 'percent', 'value', 100, 'who', '["lead","admin"]'::jsonb, 'channels', '["in_app"]'::jsonb, 'template', 'breach', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false));
      sev := sev || jsonb_build_object(k, jsonb_build_object('response_min', r, 'workaround_min', NULL, 'resolution_min', GREATEST(res, r + 1), 'escalations', breach));
    END LOOP;
    body := jsonb_build_object('severities', sev,
      'coverage', '{"mode":"24x7","tz":null,"days":[0,1,2,3,4,5,6],"start":"00:00","end":"23:59","holidays":[],"holiday_lists":[]}'::jsonb,
      'clock', '{"start":"submitted","pause":[],"stop":"resolved"}'::jsonb,
      'breach', '{"notify":true,"flag":true,"ask_client":false,"offer_replacement":false}'::jsonb, 'extra_contacts', '[]'::jsonb);
    INSERT INTO public.sla_policies (scope, is_default, name, description, status, current_version, active_version, effective_from)
    VALUES ('platform', true, 'Platform default policy', 'Today''s SLA: measured 24x7 from submission; used until a client defines its own policy.', 'active', 1, 1, now())
    RETURNING id INTO pid;
    INSERT INTO public.sla_policy_versions (policy_id, version, body, meta, change_note, content_hash)
    VALUES (pid, 1, body, jsonb_build_object('name', 'Platform default policy', 'description', '', 'applies_to', '{"kind":"all","values":[]}'::jsonb),
            'Seeded from the existing SLA rules', public.sla_hash(body, '{}'::jsonb));
  END IF;

  FOR tpl IN SELECT * FROM (VALUES
      ('standard', 'Standard', 'Business hours Sunday–Thursday 09:00–17:00, clock from assignment, full reminder ladder.', biz,
       '{"S1":[60,240,960,"full"],"S2":[120,null,960,"full"],"S3":[480,null,2400,"full"],"S4":[960,null,4800,"light"]}'::jsonb,
       '{"notify":true,"flag":true,"ask_client":true,"offer_replacement":false}'::jsonb),
      ('enterprise_24x7', 'Enterprise 24x7', 'Round-the-clock coverage with workaround target for S1 and escalation to managers.',
       '{"mode":"24x7","tz":null,"days":[0,1,2,3,4,5,6],"start":"00:00","end":"23:59","holidays":[],"holiday_lists":[]}'::jsonb,
       '{"S1":[60,240,480,"full"],"S2":[120,null,1440,"full"],"S3":[480,null,2880,"full"],"S4":[1440,null,7200,"light"]}'::jsonb,
       '{"notify":true,"flag":true,"ask_client":true,"offer_replacement":true}'::jsonb),
      ('business_light', 'Business hours light', 'Business hours, relaxed targets and a short reminder ladder.', biz,
       '{"S1":[120,null,1920,"light"],"S2":[240,null,2880,"light"],"S3":[960,null,4800,"light"],"S4":[1920,null,9600,"light"]}'::jsonb,
       '{"notify":true,"flag":true,"ask_client":false,"offer_replacement":false}'::jsonb)
    ) AS x(key, name, descr, cov, targets, breach) LOOP
    IF EXISTS (SELECT 1 FROM public.sla_policies WHERE template_key = tpl.key) THEN CONTINUE; END IF;
    sev := '{}'::jsonb;
    FOREACH k IN ARRAY ARRAY['S1', 'S2', 'S3', 'S4'] LOOP
      sev := sev || jsonb_build_object(k, jsonb_build_object(
        'response_min', (tpl.targets -> k ->> 0)::int,
        'workaround_min', CASE WHEN tpl.targets -> k -> 1 = 'null'::jsonb THEN NULL ELSE (tpl.targets -> k ->> 1)::int END,
        'resolution_min', (tpl.targets -> k ->> 2)::int,
        'escalations', CASE WHEN tpl.targets -> k ->> 3 = 'full' THEN jsonb_build_array(
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 50, 'who', '["lead"]'::jsonb, 'channels', '["in_app"]'::jsonb, 'template', 'reminder', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 75, 'who', '["all_assigned"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'reminder', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 90, 'who', '["all_assigned","client_manager"]'::jsonb, 'channels', '["in_app","email","push"]'::jsonb, 'template', 'escalation', 'repeat_min', NULL, 'until_ack', false, 'unpausable', k = 'S1'),
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 100, 'who', '["lead","client_contact","admin"]'::jsonb, 'channels', '["in_app","email","push","telegram"]'::jsonb, 'template', 'breach', 'repeat_min', NULL, 'until_ack', false, 'unpausable', k = 'S1'),
            jsonb_build_object('clock', 'resolution', 'kind', 'percent', 'value', 90, 'who', '["all_assigned"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'reminder', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'resolution', 'kind', 'after_breach', 'value', 60, 'who', '["admin","client_manager"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'after_breach', 'repeat_min', 120, 'until_ack', true, 'unpausable', false))
          ELSE jsonb_build_array(
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 75, 'who', '["lead"]'::jsonb, 'channels', '["in_app"]'::jsonb, 'template', 'reminder', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'response', 'kind', 'percent', 'value', 100, 'who', '["lead","client_contact"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'breach', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'resolution', 'kind', 'percent', 'value', 90, 'who', '["all_assigned"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'reminder', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false),
            jsonb_build_object('clock', 'resolution', 'kind', 'percent', 'value', 100, 'who', '["all_assigned","client_contact"]'::jsonb, 'channels', '["in_app","email"]'::jsonb, 'template', 'breach', 'repeat_min', NULL, 'until_ack', false, 'unpausable', false))
          END));
    END LOOP;
    body := jsonb_build_object('severities', sev, 'coverage', tpl.cov,
      'clock', jsonb_build_object('start', 'assigned', 'pause', all_pause, 'stop', 'resolved'), 'breach', tpl.breach, 'extra_contacts', '[]'::jsonb);
    INSERT INTO public.sla_policies (scope, template_key, name, description, status, current_version, active_version, effective_from)
    VALUES ('template', tpl.key, tpl.name, tpl.descr, 'active', 1, 1, now()) RETURNING id INTO pid;
    INSERT INTO public.sla_policy_versions (policy_id, version, body, meta, change_note, content_hash)
    VALUES (pid, 1, body, jsonb_build_object('name', tpl.name, 'description', tpl.descr, 'applies_to', '{"kind":"all","values":[]}'::jsonb),
            'Seeded template', public.sla_hash(body, '{}'::jsonb));
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------ grants
-- Default deny for every sla_* function, then only the browser RPCs for signed-in users and worker RPCs for the server.
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'sla\_%' LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION
  public.sla_public_settings(), public.sla_admin_set_settings(jsonb, text), public.sla_holidays_list(),
  public.sla_admin_set_holiday(text, date, text, text, boolean),
  public.sla_my_policies(uuid), public.sla_policy_get(uuid), public.sla_policy_version(uuid, integer),
  public.sla_policy_save(uuid, uuid, jsonb, jsonb, text, integer), public.sla_policy_activate(uuid, integer, timestamptz, boolean),
  public.sla_policy_archive(uuid, text), public.sla_policy_duplicate(uuid, uuid, text), public.sla_policy_restore(uuid, integer, text),
  public.sla_admin_policies(text, text, integer, integer),
  public.sla_ticket_view(uuid), public.sla_list_states(uuid[]), public.sla_accept(uuid, text),
  public.sla_counter_propose(uuid, jsonb, text, uuid), public.sla_decide_counter(uuid, boolean, text),
  public.sla_acknowledge(uuid, text, timestamptz), public.sla_mark_workaround(uuid, text),
  public.sla_reclassify(uuid, text, text), public.sla_propose_reclass(uuid, text, text), public.sla_decide_reclass(uuid, boolean),
  public.sla_apply_new_policy(uuid, text), public.sla_breach_choice(uuid, text, text, integer, text),
  public.sla_client_report(uuid, integer), public.sla_consultant_report(integer), public.sla_admin_report(integer),
  public.sla_admin_simulate(uuid, uuid, integer)
TO authenticated;
