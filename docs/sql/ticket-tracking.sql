-- Two-layer ticket tracking: AUTOMATIC stage (derived, read-only) + MANUAL working status (new data).
-- APPLIED 2026-10-24 (migrations 0096-0099, owner approved). Re-running is safe (IF NOT EXISTS / CREATE OR REPLACE).
-- Afterwards run docs/sql/ticket-tracking.test.sql (one rolled-back transaction) on a scratch copy.
--
-- Compatibility: nothing here renames, removes or repurposes tickets.status, close_outcome or any existing function.
-- No existing trigger is replaced. SLA (tickets_apply_sla, flag_sla_breaches), success statistics
-- (success_on_ticket_change), matching, payments, reports and RLS keep working exactly as before.
--
-- 1. Automatic stage: tt_facts gathers timestamps from tables that already exist (tickets, audit_logs ticket updates,
--    ticket_match_requests, proposals, ticket_team_members + team_next_step / team_ticket_gated from the team-engagement
--    feature, ticket_rates, nda_agreements, engagement readiness, work logs, timesheets, sessions, messages,
--    ticket_documents). The stepper itself is derived in the browser from these facts (src/lib/ticketTracking.ts
--    deriveStage), so there is one derivation and no stored stage that could drift. Users can not change it.
-- 2. Working status: ticket_working_status (current) + ticket_working_status_events (history). Written only by
--    tt_set_working_status (SECURITY DEFINER, fixed search_path): caller's role on THAT ticket, admin permission
--    matrix, mandatory notes, M60 contact filter, length limit, rate limit, optimistic concurrency, idempotent.
--    It never touches tickets.status: "Completed (from my side)" by a consultant only asks the client to confirm.
-- 3. Notifications: in-app through safe_insert_notification (an unread tracking notice for the same ticket inside the
--    throttle window is updated instead of adding a new one), e-mail through ticket_tracking_email_queue + the
--    job-token-checked ticket-tracking-run function (woken by pg_net only while e-mails wait; leading-edge throttle:
--    one status e-mail per person and ticket per window). Pause rules apply in the function (sendTemplateEmail pause).
-- 4. Reminders: tt_reminder_sweep, once a day (06:43 UTC), bounded to 500 rows, max one reminder per item per day,
--    capped counts, never for backfilled rows; changing the status resets the counters and the expected date.
-- 5. Feature switch platform_settings 'ticket_tracking'.enabled - default OFF. While off, only admins see tracking.

-- ------------------------------------------------------------------ settings

CREATE OR REPLACE FUNCTION public.tt_default_settings()
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT $j${
  "enabled": false,
  "statuses": [
    {"key":"not_started","label_en":"Not started","label_ar":"لم يبدأ","color":"muted","icon":"circle","order":10,"enabled":true,"court":"consultant"},
    {"key":"in_analysis","label_en":"In analysis","label_ar":"قيد التحليل","color":"info","icon":"search","order":20,"enabled":true,"court":"consultant"},
    {"key":"waiting_client_info","label_en":"Waiting for client information","label_ar":"بانتظار معلومات من العميل","color":"warning","icon":"hourglass","order":30,"enabled":true,"court":"client"},
    {"key":"waiting_consultant","label_en":"Waiting for consultant","label_ar":"بانتظار الاستشاري","color":"warning","icon":"user-clock","order":40,"enabled":true,"court":"consultant"},
    {"key":"waiting_third_party","label_en":"Waiting for third party / access","label_ar":"بانتظار طرف ثالث / صلاحيات الوصول","color":"warning","icon":"key","order":50,"enabled":true,"court":"third_party"},
    {"key":"in_development","label_en":"In development / configuration","label_ar":"قيد التطوير / الإعداد","color":"primary","icon":"wrench","order":60,"enabled":true,"court":"consultant"},
    {"key":"in_testing","label_en":"In testing","label_ar":"قيد الاختبار","color":"accent","icon":"flask","order":70,"enabled":true,"court":"both"},
    {"key":"ready_for_review","label_en":"Ready for client review","label_ar":"جاهز لمراجعة العميل","color":"success","icon":"eye","order":80,"enabled":true,"court":"client"},
    {"key":"needs_rework","label_en":"Needs rework","label_ar":"يحتاج إلى إعادة عمل","color":"destructive","icon":"rotate","order":90,"enabled":true,"court":"consultant"},
    {"key":"on_hold","label_en":"On hold","label_ar":"معلّق","color":"muted","icon":"pause","order":100,"enabled":true,"court":"none"},
    {"key":"completed","label_en":"Completed (from my side)","label_ar":"مكتمل (من جهتي)","color":"success","icon":"check","order":110,"enabled":true,"court":"other"}
  ],
  "matrix": {
    "not_started": {"client":true,"consultant":true,"note":false},
    "in_analysis": {"client":false,"consultant":true,"note":false},
    "waiting_client_info": {"client":false,"consultant":true,"note":true},
    "waiting_consultant": {"client":true,"consultant":false,"note":true},
    "waiting_third_party": {"client":true,"consultant":true,"note":true},
    "in_development": {"client":false,"consultant":true,"note":false},
    "in_testing": {"client":true,"consultant":true,"note":false},
    "ready_for_review": {"client":false,"consultant":true,"note":false},
    "needs_rework": {"client":true,"consultant":false,"note":true},
    "on_hold": {"client":true,"consultant":true,"note":true},
    "completed": {"client":true,"consultant":true,"note":false}
  },
  "note_max": 1000,
  "rate_limit_per_hour": 30,
  "throttle_minutes": 15,
  "review_reminder_days": 3,
  "max_review_reminders": 3,
  "max_overdue_reminders": 3,
  "stuck_days": 7,
  "email_enabled": true
}$j$::jsonb $$;
REVOKE ALL ON FUNCTION public.tt_default_settings() FROM PUBLIC, anon, authenticated;

INSERT INTO public.platform_settings (key, value) VALUES ('ticket_tracking', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Saved settings are validated by tt_admin_set_settings, so a shallow merge over the defaults is safe.
CREATE OR REPLACE FUNCTION public.tt_settings()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.tt_default_settings()
      || COALESCE((SELECT CASE WHEN jsonb_typeof(s.value) = 'object' THEN s.value END
                     FROM public.platform_settings s WHERE s.key = 'ticket_tracking'), '{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.tt_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.tt_is_admin(_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT _uid IS NOT NULL AND (public.has_role(_uid, 'admin'::app_role) OR public.has_role(_uid, 'super_admin'::app_role)) $$;
REVOKE ALL ON FUNCTION public.tt_is_admin(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ tables

CREATE TABLE IF NOT EXISTS public.ticket_working_status (
  ticket_id uuid PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
  status_key text NOT NULL DEFAULT 'not_started',
  note text,
  expected_date date,
  responsible text CHECK (responsible IN ('client', 'consultant', 'both', 'third_party')),
  set_by uuid,
  set_by_role text NOT NULL DEFAULT 'system' CHECK (set_by_role IN ('client', 'consultant', 'admin', 'system')),
  set_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  last_reminder_on date,
  overdue_reminders integer NOT NULL DEFAULT 0,
  review_reminded_on date,
  review_reminders integer NOT NULL DEFAULT 0
);
GRANT SELECT ON public.ticket_working_status TO authenticated;
GRANT ALL ON public.ticket_working_status TO service_role;
ALTER TABLE public.ticket_working_status ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ticket_working_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  from_key text,
  to_key text NOT NULL,
  note text,
  expected_date date,
  responsible text,
  actor_id uuid,
  actor_role text NOT NULL CHECK (actor_role IN ('client', 'consultant', 'admin', 'system')),
  backfill boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_working_status_events_ticket_idx ON public.ticket_working_status_events (ticket_id, created_at DESC);
GRANT SELECT ON public.ticket_working_status_events TO authenticated;
GRANT ALL ON public.ticket_working_status_events TO service_role;
ALTER TABLE public.ticket_working_status_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.ticket_tracking_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('status', 'completed', 'due_tomorrow', 'overdue', 'review')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS ticket_tracking_email_queue_pending_idx ON public.ticket_tracking_email_queue (created_at)
  WHERE sent_at IS NULL AND failed_at IS NULL;
CREATE INDEX IF NOT EXISTS ticket_tracking_email_queue_throttle_idx ON public.ticket_tracking_email_queue (user_id, ticket_id, created_at DESC);
GRANT ALL ON public.ticket_tracking_email_queue TO service_role;
ALTER TABLE public.ticket_tracking_email_queue ENABLE ROW LEVEL SECURITY;  -- no policies: service role only

-- The stage reads the ticket's status history from audit_logs (entity + created_at index exists; this adds the type).
CREATE INDEX IF NOT EXISTS audit_logs_ticket_updates_idx ON public.audit_logs (entity_id, created_at)
  WHERE entity_type = 'tickets' AND action = 'tickets.updated';

-- ------------------------------------------------------------------ who is who on a ticket

-- admin | client (owner) | consultant (the ticket's consultant, a ready/active team member, an active lead/support
-- assignment) | observer (active observer assignment, also when mirrored into the team table: read only) | NULL (bidders, invited-but-not-ready, outsiders,
-- company colleagues).
CREATE OR REPLACE FUNCTION public.tt_viewer_role(_ticket uuid, _uid uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket) THEN NULL
    WHEN public.tt_is_admin(_uid) THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket AND t.client_id = _uid) THEN 'client'
    WHEN EXISTS (SELECT 1 FROM public.tickets t JOIN public.consultants c ON c.id = t.consultant_id
                  WHERE t.id = _ticket AND c.user_id = _uid) THEN 'consultant'
    -- An observer assignment is mirrored into the team table as a legacy row, so it is checked first.
    WHEN EXISTS (SELECT 1 FROM public.ticket_assignments a JOIN public.consultants c ON c.id = a.consultant_id
                  WHERE a.ticket_id = _ticket AND c.user_id = _uid AND a.status::text = 'active' AND a.role::text = 'observer') THEN 'observer'
    WHEN EXISTS (SELECT 1 FROM public.ticket_team_members m JOIN public.consultants c ON c.id = m.consultant_id
                  WHERE m.ticket_id = _ticket AND c.user_id = _uid AND m.status IN ('ready', 'active')) THEN 'consultant'
    WHEN EXISTS (SELECT 1 FROM public.ticket_assignments a JOIN public.consultants c ON c.id = a.consultant_id
                  WHERE a.ticket_id = _ticket AND c.user_id = _uid AND a.status::text = 'active' AND a.role::text IN ('lead', 'support')) THEN 'consultant'
  END
$$;
REVOKE ALL ON FUNCTION public.tt_viewer_role(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tt_can_read(_ticket uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.tt_viewer_role(_ticket, auth.uid()) IS NOT NULL $$;
REVOKE ALL ON FUNCTION public.tt_can_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_can_read(uuid) TO authenticated;

DROP POLICY IF EXISTS "Ticket participants read the working status" ON public.ticket_working_status;
CREATE POLICY "Ticket participants read the working status" ON public.ticket_working_status
  FOR SELECT TO authenticated USING (public.tt_can_read(ticket_id));
DROP POLICY IF EXISTS "Ticket participants read the working status history" ON public.ticket_working_status_events;
CREATE POLICY "Ticket participants read the working status history" ON public.ticket_working_status_events
  FOR SELECT TO authenticated USING (public.tt_can_read(ticket_id));

-- The role a past actor had on the ticket (for "who triggered it"); never a name.
CREATE OR REPLACE FUNCTION public.tt_actor_role(_ticket uuid, _uid uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _uid IS NULL THEN 'system'
    WHEN EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket AND t.client_id = _uid) THEN 'client'
    WHEN public.tt_is_admin(_uid) THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = _uid) THEN 'consultant'
    ELSE 'system' END
$$;
REVOKE ALL ON FUNCTION public.tt_actor_role(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- People told about a change: the client and the consultants who work on the ticket (not observers or bidders).
CREATE OR REPLACE FUNCTION public.tt_recipients(_ticket uuid)
 RETURNS TABLE(user_id uuid, role text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.client_id, 'client' FROM public.tickets t WHERE t.id = _ticket AND t.client_id IS NOT NULL
  UNION
  SELECT c.user_id, 'consultant' FROM public.tickets t JOIN public.consultants c ON c.id = t.consultant_id
   WHERE t.id = _ticket AND c.user_id IS NOT NULL
  UNION
  SELECT c.user_id, 'consultant' FROM public.ticket_team_members m JOIN public.consultants c ON c.id = m.consultant_id
   WHERE m.ticket_id = _ticket AND m.status IN ('ready', 'active') AND c.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.ticket_assignments a WHERE a.ticket_id = _ticket AND a.consultant_id = m.consultant_id
                      AND a.status::text = 'active' AND a.role::text = 'observer')
  UNION
  SELECT c.user_id, 'consultant' FROM public.ticket_assignments a JOIN public.consultants c ON c.id = a.consultant_id
   WHERE a.ticket_id = _ticket AND a.status::text = 'active' AND a.role::text IN ('lead', 'support') AND c.user_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.tt_recipients(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ automatic stage facts

-- Status transitions of one ticket from the existing audit trail (audit_tickets trigger, 'tickets.updated').
CREATE OR REPLACE FUNCTION public.tt_last_transition(_ticket uuid, _to text[], _from_not text[], _from_in text[] DEFAULT NULL)
 RETURNS TABLE(at timestamptz, by_user uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT a.created_at, a.user_id FROM public.audit_logs a
   WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket AND a.action = 'tickets.updated'
     AND a.metadata #>> '{new,status}' = ANY (_to)
     AND COALESCE(a.metadata #>> '{old,status}', '') <> ALL (_from_not)
     AND (_from_in IS NULL OR a.metadata #>> '{old,status}' = ANY (_from_in))
   ORDER BY a.created_at DESC LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.tt_last_transition(uuid, text[], text[], text[]) FROM PUBLIC, anon, authenticated;

-- Hooks for docs/sql/ticket-brd-approval.sql: no-op stubs, created only while that file is not applied, so this file
-- and that one can be applied in any order without dropping the BRD approval gate.
DO $stub$
BEGIN
  IF to_regprocedure('public.tt_brd_approval_fact(uuid)') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION public.tt_brd_approval_fact(_ticket uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $b$ SELECT NULL::jsonb $b$$f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.tt_brd_approval_fact(uuid) FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regprocedure('public.tt_brd_approval_events(uuid,uuid)') IS NULL THEN
    EXECUTE $f$CREATE FUNCTION public.tt_brd_approval_events(_ticket uuid, _viewer uuid) RETURNS TABLE (event_at timestamptz, source text, kind text, actor_role text, params jsonb) LANGUAGE sql STABLE SET search_path = public AS $b$ SELECT NULL::timestamptz, NULL::text, NULL::text, NULL::text, NULL::jsonb WHERE false $b$$f$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.tt_brd_approval_events(uuid, uuid) FROM PUBLIC, anon, authenticated';
  END IF;
END
$stub$;

-- Internal: the facts the stepper is derived from. No permission check here (callers check first).
CREATE OR REPLACE FUNCTION public.tt_facts(_ticket uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  t public.tickets;
  w public.ticket_working_status;
  _gated boolean; _floor timestamptz; _brd timestamptz; _bids timestamptz; _sel timestamptz;
  _rate timestamptz; _rate_by uuid; _rate_prop boolean;
  _nda timestamptz; _nda_state text := 'none'; _n_cons timestamptz; _n_client timestamptz; _n_found boolean := false;
  _conf timestamptz; _work timestamptz;
  _deliv timestamptz; _deliv_by uuid; _closed timestamptz; _closed_by uuid; _reopen timestamptz; _reopen_by uuid;
  _member uuid; _next jsonb; _working jsonb; _details boolean;
BEGIN
  SELECT * INTO t FROM public.tickets WHERE id = _ticket;
  IF NOT FOUND THEN RETURN NULL; END IF;
  _gated := COALESCE(public.team_ticket_gated(_ticket), false);
  _details := char_length(btrim(COALESCE(t.description, ''))) >= 20
              AND (COALESCE(btrim(t.sap_module), '') <> '' OR COALESCE(cardinality(t.sap_modules), 0) > 0);

  SELECT min(d.created_at) INTO _brd FROM public.ticket_documents d WHERE d.ticket_id = _ticket AND d.file_name ILIKE 'BRD\_%';

  _bids := LEAST(t.opened_for_bids_at,
    (SELECT min(m.created_at) FROM public.ticket_match_requests m WHERE m.ticket_id = _ticket),
    (SELECT min(p.created_at) FROM public.proposals p WHERE p.ticket_id = _ticket),
    (SELECT min(x.invited_at) FROM public.ticket_team_members x WHERE x.ticket_id = _ticket AND NOT x.is_legacy));

  _sel := LEAST(
    (SELECT min(p.updated_at) FROM public.proposals p WHERE p.ticket_id = _ticket AND p.status::text = 'accepted'),
    (SELECT min(m.responded_at) FROM public.ticket_match_requests m WHERE m.ticket_id = _ticket AND m.status::text = 'accepted'),
    (SELECT min(x.accepted_at) FROM public.ticket_team_members x WHERE x.ticket_id = _ticket AND NOT x.is_legacy),
    (SELECT min(a.created_at) FROM public.audit_logs a
      WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket AND a.action = 'tickets.updated'
        AND a.metadata #>> '{new,consultant_id}' IS NOT NULL
        AND a.metadata #>> '{new,consultant_id}' IS DISTINCT FROM a.metadata #>> '{old,consultant_id}'));

  SELECT r.decided_at, r.decided_by INTO _rate, _rate_by FROM public.ticket_rates r
   WHERE r.ticket_id = _ticket AND r.status = 'approved' AND r.decided_at IS NOT NULL ORDER BY r.decided_at LIMIT 1;
  _rate := LEAST(_rate, (SELECT min(x.rate_approved_at) FROM public.ticket_team_members x WHERE x.ticket_id = _ticket AND NOT x.is_legacy));
  _rate_prop := EXISTS (SELECT 1 FROM public.ticket_rates r WHERE r.ticket_id = _ticket AND r.status = 'proposed');

  IF _gated THEN
    -- Team tickets: the gates of team_gates / team_next_step, recorded on the member rows.
    SELECT min(x.nda_signed_at), min(x.ready_at) INTO _nda, _conf FROM public.ticket_team_members x
     WHERE x.ticket_id = _ticket AND NOT x.is_legacy;
    _nda_state := CASE WHEN _nda IS NOT NULL THEN 'signed' ELSE 'none' END;
    SELECT x.id INTO _member FROM public.ticket_team_members x
     WHERE x.ticket_id = _ticket AND NOT x.is_legacy AND public.team_pre_ready(x.status)
     ORDER BY array_position(ARRAY['nda_signed', 'rate_approved', 'bid_sent', 'accepted', 'viewed', 'invited', 'selected'], x.status), x.created_at
     LIMIT 1;
    IF _member IS NOT NULL AND _conf IS NULL THEN _next := public.team_next_step(_member); END IF;
  ELSIF t.consultant_id IS NOT NULL THEN
    -- Legacy tickets: the NDA between the ticket's consultant and the client, signed by both (has_active_nda rule +
    -- the consultant's signature); there is no engagement confirmation step.
    SELECT n.signed_at, n.client_signed_at, true INTO _n_cons, _n_client, _n_found FROM public.nda_agreements n
     WHERE n.consultant_id = t.consultant_id AND n.client_id = t.client_id AND n.revoked_at IS NULL
     ORDER BY n.created_at DESC LIMIT 1;
    _nda_state := CASE WHEN NOT COALESCE(_n_found, false) THEN 'none'
                       WHEN _n_cons IS NOT NULL AND _n_client IS NOT NULL THEN 'signed' ELSE 'consultant_signed' END;
    IF _nda_state = 'signed' THEN _nda := GREATEST(_n_cons, _n_client); END IF;
  END IF;

  -- Work in progress: first work log, timesheet, meeting start, message or "in progress" status after the engagement
  -- is ready (team tickets) or after a consultant was selected (legacy tickets).
  _floor := COALESCE(_conf, _sel, t.created_at);
  IF NOT (_gated AND _conf IS NULL) THEN
    _work := LEAST(
      (SELECT min(x.created_at) FROM public.ticket_work_logs x WHERE x.ticket_id = _ticket AND x.created_at >= _floor),
      (SELECT min(x.created_at) FROM public.ticket_timesheet_submissions x WHERE x.ticket_id = _ticket AND x.created_at >= _floor),
      (SELECT min(x.started_at) FROM public.sessions x WHERE x.ticket_id = _ticket AND x.started_at >= _floor),
      (SELECT min(x.created_at) FROM public.ticket_team_messages x WHERE x.ticket_id = _ticket AND x.created_at >= _floor),
      (SELECT min(m.created_at) FROM public.messages m JOIN public.sessions s ON s.id = m.session_id
        WHERE s.ticket_id = _ticket AND m.created_at >= _floor AND t.consultant_id IS NOT NULL),
      (SELECT min(a.created_at) FROM public.audit_logs a
        WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket AND a.action = 'tickets.updated'
          AND a.metadata #>> '{new,status}' = 'in_progress' AND a.created_at >= _floor));
  END IF;

  SELECT x.at, x.by_user INTO _deliv, _deliv_by FROM public.tt_last_transition(_ticket, ARRAY['resolved'], ARRAY['resolved']) x;
  _deliv := COALESCE(_deliv, t.resolved_at);
  SELECT x.at, x.by_user INTO _closed, _closed_by FROM public.tt_last_transition(_ticket, ARRAY['closed'], ARRAY['closed']) x;
  IF t.status::text = 'closed' THEN _closed := COALESCE(_closed, t.close_outcome_at, t.resolved_at, t.updated_at); END IF;
  SELECT x.at, x.by_user INTO _reopen, _reopen_by
    FROM public.tt_last_transition(_ticket, ARRAY['new', 'under_review', 'matched', 'in_progress', 'waiting_for_client'],
                                   ARRAY[]::text[], ARRAY['resolved', 'closed']) x;

  SELECT * INTO w FROM public.ticket_working_status s WHERE s.ticket_id = _ticket;
  IF FOUND THEN
    _working := jsonb_build_object('key', w.status_key, 'set_at', w.set_at, 'set_by_role', w.set_by_role, 'note', w.note,
      'expected_date', w.expected_date, 'responsible', w.responsible, 'version', w.version);
  ELSE
    _working := jsonb_build_object('key', 'not_started', 'set_at', t.created_at, 'set_by_role', 'system', 'note', NULL,
      'expected_date', NULL, 'responsible', NULL, 'version', 1);
  END IF;

  RETURN jsonb_build_object(
    'created_at', t.created_at, 'status', t.status::text, 'close_outcome', t.close_outcome,
    'details_ok', _details, 'details_at', CASE WHEN _details THEN t.created_at END, 'brd_at', _brd,
    'bids_at', _bids, 'bids_open', COALESCE(t.open_for_bids, false),
    'selected_at', _sel, 'has_consultant', t.consultant_id IS NOT NULL,
    'rate_at', _rate, 'rate_proposed', _rate_prop,
    'nda_at', _nda, 'nda_state', _nda_state,
    'gated', _gated, 'confirmed_at', _conf,
    'work_at', _work, 'delivered_at', _deliv, 'closed_at', _closed, 'reopened_at', _reopen,
    'team_next', _next,
    -- BRD approval gate (docs/sql/ticket-brd-approval.sql; a no-op stub returns NULL before that file is applied).
    'brd_approval', public.tt_brd_approval_fact(_ticket),
    'actors', jsonb_build_object('submitted', 'client', 'rate', CASE WHEN _rate_by IS NULL THEN 'client' ELSE public.tt_actor_role(_ticket, _rate_by) END,
      'nda', 'both', 'brd', 'consultant', 'confirmed', 'both', 'work', 'consultant',
      'delivered', CASE WHEN _deliv IS NULL THEN NULL ELSE public.tt_actor_role(_ticket, _deliv_by) END,
      'closed', CASE WHEN _closed IS NULL THEN NULL ELSE public.tt_actor_role(_ticket, _closed_by) END,
      'reopened', CASE WHEN _reopen IS NULL THEN NULL ELSE public.tt_actor_role(_ticket, _reopen_by) END),
    'working', _working);
END
$$;
REVOKE ALL ON FUNCTION public.tt_facts(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ read RPCs (browser)

-- Tracking of one ticket for the signed-in person: role, settings, facts, working status history, allowed statuses.
CREATE OR REPLACE FUNCTION public.tt_ticket_tracking(_ticket uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _role text; s jsonb := public.tt_settings(); _allowed jsonb;
BEGIN
  _role := public.tt_viewer_role(_ticket, _uid);
  IF _role IS NULL THEN RETURN jsonb_build_object('enabled', COALESCE((s ->> 'enabled')::boolean, false), 'role', NULL); END IF;
  IF NOT COALESCE((s ->> 'enabled')::boolean, false) AND _role <> 'admin' THEN
    RETURN jsonb_build_object('enabled', false, 'role', _role);
  END IF;
  SELECT COALESCE(jsonb_agg(x ->> 'key' ORDER BY (x ->> 'order')::int), '[]'::jsonb) INTO _allowed
    FROM jsonb_array_elements(s -> 'statuses') x
   WHERE COALESCE((x ->> 'enabled')::boolean, true)
     AND (_role = 'admin' OR (_role IN ('client', 'consultant') AND COALESCE((s -> 'matrix' -> (x ->> 'key') ->> _role)::boolean, false)));
  RETURN jsonb_build_object(
    'enabled', COALESCE((s ->> 'enabled')::boolean, false),
    'role', _role,
    'settings', s,
    'facts', public.tt_facts(_ticket),
    'allowed', _allowed,
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('at', e.created_at, 'from', e.from_key, 'to', e.to_key, 'by', e.actor_role,
                         'note', e.note, 'expected_date', e.expected_date, 'responsible', e.responsible, 'backfill', e.backfill) ORDER BY e.created_at)
                         FROM (SELECT * FROM public.ticket_working_status_events e2 WHERE e2.ticket_id = _ticket ORDER BY e2.created_at DESC LIMIT 300) e), '[]'::jsonb));
END
$$;
REVOKE ALL ON FUNCTION public.tt_ticket_tracking(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_ticket_tracking(uuid) TO authenticated;

-- Facts for the tickets of a list (at most 200), only those the caller may read; nothing while the feature is off
-- (except for admins).
CREATE OR REPLACE FUNCTION public.tt_list_facts(_tickets uuid[])
 RETURNS TABLE(ticket_id uuid, role text, facts jsonb) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE _uid uuid := auth.uid(); _on boolean := COALESCE((public.tt_settings() ->> 'enabled')::boolean, false); _id uuid; _r text;
BEGIN
  IF _uid IS NULL OR _tickets IS NULL THEN RETURN; END IF;
  IF NOT _on AND NOT public.tt_is_admin(_uid) THEN RETURN; END IF;
  FOREACH _id IN ARRAY _tickets[1:200] LOOP
    _r := public.tt_viewer_role(_id, _uid);
    IF _r IS NOT NULL THEN
      ticket_id := _id; role := _r; facts := public.tt_facts(_id);
      RETURN NEXT;
    END IF;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.tt_list_facts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_list_facts(uuid[]) TO authenticated;

-- The unified timeline (newest first, max 500): system events from existing tables, manual working status changes,
-- and comment milestones (message counts per day and side - never message text). Consultants see only their own
-- bids, rates, match requests, team steps, confirmations and timesheets, so a team member never sees a competitor.
CREATE OR REPLACE FUNCTION public.tt_timeline(_ticket uuid)
 RETURNS TABLE(event_at timestamptz, source text, kind text, actor_role text, params jsonb)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE
  _uid uuid := auth.uid(); _role text; t public.tickets; _me uuid; _gated boolean; _full boolean;
BEGIN
  _role := public.tt_viewer_role(_ticket, _uid);
  IF _role IS NULL THEN RETURN; END IF;
  IF NOT COALESCE((public.tt_settings() ->> 'enabled')::boolean, false) AND _role <> 'admin' THEN RETURN; END IF;
  SELECT * INTO t FROM public.tickets WHERE id = _ticket;
  SELECT c.id INTO _me FROM public.consultants c WHERE c.user_id = _uid LIMIT 1;
  _gated := COALESCE(public.team_ticket_gated(_ticket), false);
  _full := _role IN ('client', 'admin');
  RETURN QUERY
  SELECT x.event_at, x.source, x.kind, x.actor_role, x.params FROM (
    SELECT t.created_at AS event_at, 'system'::text AS source, 'created'::text AS kind, 'client'::text AS actor_role, '{}'::jsonb AS params
    UNION ALL
    SELECT a.created_at, 'system', 'status', public.tt_actor_role(_ticket, a.user_id),
           jsonb_build_object('from', a.metadata #>> '{old,status}', 'to', a.metadata #>> '{new,status}')
      FROM public.audit_logs a
     WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket AND a.action = 'tickets.updated'
       AND a.metadata #>> '{new,status}' IS NOT NULL AND a.metadata #>> '{new,status}' IS DISTINCT FROM a.metadata #>> '{old,status}'
    UNION ALL
    SELECT a.created_at, 'system', CASE WHEN a.metadata #>> '{new,consultant_id}' IS NULL THEN 'consultant_removed' ELSE 'consultant_assigned' END,
           public.tt_actor_role(_ticket, a.user_id), '{}'::jsonb
      FROM public.audit_logs a
     WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket AND a.action = 'tickets.updated'
       AND (a.metadata -> 'new') ? 'consultant_id' AND a.metadata #>> '{new,consultant_id}' IS DISTINCT FROM a.metadata #>> '{old,consultant_id}'
    UNION ALL
    SELECT a.created_at, 'system', 'sla_breached', 'system', '{}'::jsonb
      FROM public.audit_logs a
     WHERE a.entity_type = 'tickets' AND a.entity_id = _ticket AND a.action = 'tickets.updated'
       AND a.metadata #>> '{new,sla_breached}' = 'true' AND a.metadata #>> '{old,sla_breached}' IS DISTINCT FROM 'true'
    UNION ALL SELECT t.plan_submitted_at, 'system', 'plan_submitted', 'consultant', '{}'::jsonb
    UNION ALL SELECT t.plan_approved_at, 'system', 'plan_approved', 'client', '{}'::jsonb
    UNION ALL SELECT t.plan_rejected_at, 'system', 'plan_rejected', 'client', '{}'::jsonb
    UNION ALL SELECT t.critical_first_reply_at, 'system', 'critical_reply', 'consultant', '{}'::jsonb
    UNION ALL SELECT t.close_outcome_at, 'system', 'outcome', public.tt_actor_role(_ticket, t.close_outcome_by), jsonb_build_object('outcome', t.close_outcome)
    UNION ALL
    SELECT m.created_at, 'system', 'match_sent', 'client', '{}'::jsonb FROM public.ticket_match_requests m
     WHERE m.ticket_id = _ticket AND (_full OR m.consultant_id = _me)
    UNION ALL
    SELECT m.responded_at, 'system', 'match_answered', 'consultant', jsonb_build_object('status', m.status::text) FROM public.ticket_match_requests m
     WHERE m.ticket_id = _ticket AND (_full OR m.consultant_id = _me)
    UNION ALL
    SELECT p.created_at, 'system', 'bid_received', 'consultant', '{}'::jsonb FROM public.proposals p
     WHERE p.ticket_id = _ticket AND (_full OR p.consultant_id = _me)
    UNION ALL
    SELECT e.created_at, 'system', 'team_step', e.actor_role, jsonb_build_object('from', e.from_status, 'to', e.to_status)
      FROM public.ticket_team_member_events e WHERE e.ticket_id = _ticket AND (_full OR e.consultant_id = _me)
    UNION ALL
    SELECT r.created_at, 'system', 'rate_proposed', 'consultant', '{}'::jsonb FROM public.ticket_rates r
     WHERE r.ticket_id = _ticket AND (_full OR r.consultant_id = _me)
    UNION ALL
    SELECT r.decided_at, 'system', 'rate_decided', public.tt_actor_role(_ticket, r.decided_by), jsonb_build_object('status', r.status)
      FROM public.ticket_rates r WHERE r.ticket_id = _ticket AND r.status <> 'proposed' AND (_full OR r.consultant_id = _me)
    UNION ALL
    SELECT n.signed_at, 'system', 'nda_consultant_signed', 'consultant', '{}'::jsonb FROM public.nda_agreements n
     WHERE NOT _gated AND n.consultant_id = t.consultant_id AND n.client_id = t.client_id
    UNION ALL
    SELECT n.client_signed_at, 'system', 'nda_client_signed', 'client', '{}'::jsonb FROM public.nda_agreements n
     WHERE NOT _gated AND n.consultant_id = t.consultant_id AND n.client_id = t.client_id
    UNION ALL
    SELECT c.consultant_confirmed_at, 'system', 'engagement_confirmed', 'consultant', '{}'::jsonb FROM public.engagement_confirmations c
     WHERE c.ticket_id = _ticket AND (_full OR c.consultant_id = _me)
    UNION ALL
    SELECT c.client_confirmed_at, 'system', 'engagement_confirmed', 'client', '{}'::jsonb FROM public.engagement_confirmations c
     WHERE c.ticket_id = _ticket AND (_full OR c.consultant_id = _me)
    UNION ALL
    SELECT d.created_at, 'system', CASE WHEN d.file_name ILIKE 'BRD\_%' THEN 'brd_attached' ELSE 'document_added' END,
           public.tt_actor_role(_ticket, d.uploaded_by),
           jsonb_build_object('version', substring(d.file_name FROM '_v([0-9]+)_'), 'name', left(d.file_name, 120))
      FROM public.ticket_documents d WHERE d.ticket_id = _ticket
    UNION ALL
    -- BRD approval rounds and decisions (docs/sql/ticket-brd-approval.sql; a no-op stub returns no rows before that).
    SELECT h.event_at, h.source, h.kind, h.actor_role, h.params FROM public.tt_brd_approval_events(_ticket, _uid) h
    UNION ALL
    SELECT s.submitted_at, 'system', 'timesheet_submitted', 'consultant', jsonb_build_object('hours', s.total_hours)
      FROM public.ticket_timesheet_submissions s WHERE s.ticket_id = _ticket AND (_full OR s.submitted_by = _uid)
    UNION ALL
    SELECT s.signed_at, 'system', 'timesheet_approved', 'client', jsonb_build_object('hours', s.total_hours)
      FROM public.ticket_timesheet_submissions s WHERE s.ticket_id = _ticket AND (_full OR s.submitted_by = _uid)
    UNION ALL
    SELECT i.created_at, 'system', 'invoice_sent', 'consultant', '{}'::jsonb FROM public.ticket_invoices i
     WHERE i.ticket_id = _ticket AND (_full OR i.consultant_id = _me)
    UNION ALL
    SELECT i.decided_at, 'system', 'invoice_decided', 'client', jsonb_build_object('status', i.status) FROM public.ticket_invoices i
     WHERE i.ticket_id = _ticket AND (_full OR i.consultant_id = _me)
    UNION ALL
    SELECT s.created_at, 'system', 'meeting_scheduled', 'system', jsonb_build_object('at', s.scheduled_at) FROM public.sessions s WHERE s.ticket_id = _ticket
    UNION ALL
    SELECT s.ended_at, 'system', 'meeting_completed', 'both', '{}'::jsonb FROM public.sessions s
     WHERE s.ticket_id = _ticket AND s.status::text = 'completed'
    UNION ALL
    SELECT e.created_at, 'manual', 'working_status', e.actor_role,
           jsonb_build_object('from', e.from_key, 'to', e.to_key, 'note', e.note, 'expected_date', e.expected_date,
                              'responsible', e.responsible, 'backfill', e.backfill)
      FROM public.ticket_working_status_events e WHERE e.ticket_id = _ticket
    UNION ALL
    SELECT max(m.created_at), 'comment', 'messages', CASE WHEN max(m.sender_role) = 'client' THEN 'client' ELSE 'consultant' END,
           jsonb_build_object('count', count(*), 'day', to_char(date_trunc('day', m.created_at), 'YYYY-MM-DD'))
      FROM public.ticket_team_messages m WHERE m.ticket_id = _ticket
     GROUP BY (m.sender_role = 'client'), date_trunc('day', m.created_at)
    UNION ALL
    SELECT max(m.created_at), 'comment', 'messages', CASE WHEN bool_and(m.sender_id = t.client_id) THEN 'client' ELSE 'consultant' END,
           jsonb_build_object('count', count(*), 'day', to_char(date_trunc('day', m.created_at), 'YYYY-MM-DD'))
      FROM public.messages m JOIN public.sessions s ON s.id = m.session_id WHERE s.ticket_id = _ticket
     GROUP BY (m.sender_id = t.client_id), date_trunc('day', m.created_at)
    UNION ALL
    SELECT c.created_at, 'comment', 'timesheet_comment', CASE WHEN c.author_role = 'client' THEN 'client' WHEN c.author_role = 'admin' THEN 'admin' ELSE 'consultant' END, '{}'::jsonb
      FROM public.ticket_timesheet_comments c JOIN public.ticket_timesheet_submissions s ON s.id = c.submission_id
     WHERE s.ticket_id = _ticket AND (_full OR s.submitted_by = _uid)
  ) x
  WHERE x.event_at IS NOT NULL
  ORDER BY x.event_at DESC
  LIMIT 500;
END
$$;
REVOKE ALL ON FUNCTION public.tt_timeline(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_timeline(uuid) TO authenticated;

-- ------------------------------------------------------------------ notifications

CREATE OR REPLACE FUNCTION public.tt_wake()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regprocedure('public.job_invoke_headers()') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_tracking_email_queue q WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5) THEN RETURN; END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := public.job_invoke_headers(), body := '{}'::jsonb)$q$
    USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/ticket-tracking-run';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ticket tracking e-mail wake-up skipped: %', SQLERRM;
END
$$;
REVOKE ALL ON FUNCTION public.tt_wake() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tt_queue_wake_trigger()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$ BEGIN PERFORM public.tt_wake(); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION public.tt_queue_wake_trigger() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_tt_queue_wake ON public.ticket_tracking_email_queue;
CREATE TRIGGER trg_tt_queue_wake AFTER INSERT ON public.ticket_tracking_email_queue
  FOR EACH STATEMENT EXECUTE FUNCTION public.tt_queue_wake_trigger();

CREATE OR REPLACE FUNCTION public.tt_status_label(_key text, _lang text)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT CASE WHEN _lang = 'ar' THEN x ->> 'label_ar' ELSE x ->> 'label_en' END
                     FROM jsonb_array_elements(public.tt_settings() -> 'statuses') x WHERE x ->> 'key' = _key LIMIT 1), _key)
$$;
REVOKE ALL ON FUNCTION public.tt_status_label(text, text) FROM PUBLIC, anon, authenticated;

-- In-app notice with throttling: an unread tracking notice for the same ticket within the window is updated.
CREATE OR REPLACE FUNCTION public.tt_push_notice(_user uuid, _ticket uuid, _role text, _title text, _body text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _link text := CASE WHEN _role = 'client' THEN '/client/tickets/' ELSE '/consultant/cases/' END || _ticket::text;
  _win int := COALESCE((public.tt_settings() ->> 'throttle_minutes')::int, 15);
  _nid uuid;
BEGIN
  IF _user IS NULL THEN RETURN; END IF;
  SELECT n.id INTO _nid FROM public.notifications n
   WHERE n.user_id = _user AND n.type = 'ticket_tracking' AND n.link = _link AND NOT COALESCE(n.is_read, false)
     AND n.created_at > now() - make_interval(mins => _win)
   ORDER BY n.created_at DESC LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF _nid IS NOT NULL THEN
    UPDATE public.notifications SET title = left(_title, 200), body = left(_body, 1000), created_at = now() WHERE id = _nid;
  ELSE
    PERFORM public.safe_insert_notification(_user, left(_title, 200), left(_body, 1000), 'ticket_tracking', _link);
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.tt_push_notice(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- E-mail queue with a leading-edge throttle for status e-mails (one per person and ticket per window).
CREATE OR REPLACE FUNCTION public.tt_queue_email(_user uuid, _ticket uuid, _role text, _kind text, _payload jsonb, _dedupe text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s jsonb := public.tt_settings(); _win int := COALESCE((s ->> 'throttle_minutes')::int, 15);
BEGIN
  IF _user IS NULL OR NOT COALESCE((s ->> 'email_enabled')::boolean, true) THEN RETURN; END IF;
  IF _kind IN ('status', 'completed') AND EXISTS (
       SELECT 1 FROM public.ticket_tracking_email_queue q
        WHERE q.user_id = _user AND q.ticket_id = _ticket AND q.kind IN ('status', 'completed')
          AND q.created_at > now() - make_interval(mins => _win)) THEN
    RETURN;
  END IF;
  INSERT INTO public.ticket_tracking_email_queue (user_id, ticket_id, kind, payload, dedupe_key)
  VALUES (_user, _ticket, _kind, _payload || jsonb_build_object('path',
            CASE WHEN _role = 'client' THEN '/client/tickets/' ELSE '/consultant/cases/' END || _ticket::text), left(_dedupe, 300))
  ON CONFLICT (dedupe_key) DO NOTHING;
END
$$;
REVOKE ALL ON FUNCTION public.tt_queue_email(uuid, uuid, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tt_lang(_user uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT CASE WHEN (SELECT p.preferred_language FROM public.profiles p WHERE p.user_id = _user LIMIT 1) = 'ar' THEN 'ar' ELSE 'en' END $$;
REVOKE ALL ON FUNCTION public.tt_lang(uuid) FROM PUBLIC, anon, authenticated;

-- Tells everybody on the ticket except the actor (names never appear: "the client", "the consultant").
CREATE OR REPLACE FUNCTION public.tt_notify_change(_ticket uuid, _actor uuid, _actor_role text, _to text, _note text, _version int)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  r record; _lang text; _title text; _body text; _who text; _label text; _kind text;
  _tt text := (SELECT left(t.title, 120) FROM public.tickets t WHERE t.id = _ticket);
  _n text := NULLIF(left(btrim(COALESCE(_note, '')), 200), '');
BEGIN
  FOR r IN SELECT * FROM public.tt_recipients(_ticket) LOOP
    CONTINUE WHEN r.user_id = _actor;
    _lang := public.tt_lang(r.user_id);
    _label := public.tt_status_label(_to, _lang);
    _who := CASE _actor_role WHEN 'client' THEN CASE WHEN _lang = 'ar' THEN 'العميل' ELSE 'the client' END
                             WHEN 'admin' THEN CASE WHEN _lang = 'ar' THEN 'فريق الدعم' ELSE 'the support team' END
                             ELSE CASE WHEN _lang = 'ar' THEN 'الاستشاري' ELSE 'the consultant' END END;
    _kind := CASE WHEN _to = 'completed' AND _actor_role = 'consultant' AND r.role = 'client' THEN 'completed' ELSE 'status' END;
    IF _kind = 'completed' THEN
      _title := CASE WHEN _lang = 'ar' THEN 'يرجى تأكيد الحل' ELSE 'Please confirm the resolution' END;
      _body := CASE WHEN _lang = 'ar'
        THEN '«' || _tt || '»: أشار الاستشاري إلى أن عمله مكتمل. يرجى مراجعة العمل وتأكيد الحل، أو اختيار «يحتاج إلى إعادة عمل». لم يتم إغلاق التذكرة.'
        ELSE '"' || _tt || '": the consultant marked their part as complete. Please check the work and confirm the resolution, or choose "Needs rework". The ticket has not been closed.' END;
    ELSE
      _title := CASE WHEN _lang = 'ar' THEN 'تم تحديث حالة العمل' ELSE 'Working status updated' END;
      _body := CASE WHEN _lang = 'ar' THEN '«' || _tt || '»: ' || _label || ' - بواسطة ' || _who || '.'
                    ELSE '"' || _tt || '": ' || _label || ' - set by ' || _who || '.' END
               || CASE WHEN _n IS NULL THEN '' ELSE CASE WHEN _lang = 'ar' THEN ' ملاحظة: ' ELSE ' Note: ' END || _n END;
    END IF;
    PERFORM public.tt_push_notice(r.user_id, _ticket, r.role, _title, _body);
    PERFORM public.tt_queue_email(r.user_id, _ticket, r.role, _kind,
      jsonb_build_object('lang', _lang, 'ticket_title', _tt, 'status_label', _label, 'actor', _actor_role, 'note', _n),
      'tt:' || _kind || ':' || _ticket::text || ':' || r.user_id::text || ':v' || _version::text);
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.tt_notify_change(uuid, uuid, text, text, text, int) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ the only write path

CREATE OR REPLACE FUNCTION public.tt_set_working_status(_ticket uuid, _status text, _note text DEFAULT NULL,
  _expected_date date DEFAULT NULL, _responsible text DEFAULT NULL, _expected_version integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid(); s jsonb := public.tt_settings(); _role text; t public.tickets; w public.ticket_working_status;
  _def jsonb; _n text := NULLIF(btrim(COALESCE(_note, '')), ''); _max int; _v int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  _role := public.tt_viewer_role(_ticket, _uid);
  IF _role IS NULL OR _role = 'observer' THEN RAISE EXCEPTION 'You can not change the working status of this ticket' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE((s ->> 'enabled')::boolean, false) AND _role <> 'admin' THEN
    RAISE EXCEPTION 'Working status is switched off' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO t FROM public.tickets WHERE id = _ticket;
  IF t.status::text = 'closed' AND _role <> 'admin' THEN
    RAISE EXCEPTION 'This ticket is closed' USING ERRCODE = '55000';
  END IF;
  SELECT x INTO _def FROM jsonb_array_elements(s -> 'statuses') x
   WHERE x ->> 'key' = _status AND COALESCE((x ->> 'enabled')::boolean, true) LIMIT 1;
  IF _def IS NULL THEN RAISE EXCEPTION 'Unknown working status' USING ERRCODE = '22023'; END IF;
  IF _role <> 'admin' AND NOT COALESCE((s -> 'matrix' -> _status ->> _role)::boolean, false) THEN
    RAISE EXCEPTION 'This working status can not be set by the %', _role USING ERRCODE = '42501';
  END IF;
  _max := COALESCE((s ->> 'note_max')::int, 1000);
  IF _n IS NOT NULL AND char_length(_n) > _max THEN
    RAISE EXCEPTION 'The note is too long (% characters at most)', _max USING ERRCODE = '22023';
  END IF;
  IF _n IS NULL AND COALESCE((s -> 'matrix' -> _status ->> 'note')::boolean, false) THEN
    RAISE EXCEPTION 'Please add a short note for this working status' USING ERRCODE = '22023';
  END IF;
  IF _n IS NOT NULL AND public.contact_details_in_text(_n) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal.'
      USING ERRCODE = '22023';
  END IF;
  IF _responsible IS NOT NULL AND _responsible NOT IN ('client', 'consultant', 'both', 'third_party') THEN
    RAISE EXCEPTION 'Unknown responsible side' USING ERRCODE = '22023';
  END IF;
  IF _expected_date IS NOT NULL AND (_expected_date < current_date OR _expected_date > current_date + 365) THEN
    RAISE EXCEPTION 'The expected date must be between today and one year from now' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ticket_working_status (ticket_id, status_key, set_by_role, set_at, version)
  VALUES (_ticket, 'not_started', 'system', t.created_at, 1) ON CONFLICT (ticket_id) DO NOTHING;
  SELECT * INTO w FROM public.ticket_working_status WHERE ticket_id = _ticket FOR UPDATE;

  IF _expected_version IS NOT NULL AND _expected_version <> w.version THEN
    RAISE EXCEPTION 'The working status was changed by someone else a moment ago; please reload' USING ERRCODE = '40001',
      HINT = 'current_version=' || w.version::text;
  END IF;
  -- Idempotent: the same status with the same details is not a change (no event, no notification, no rate limit hit).
  IF w.status_key = _status AND w.note IS NOT DISTINCT FROM _n AND w.expected_date IS NOT DISTINCT FROM _expected_date
     AND w.responsible IS NOT DISTINCT FROM _responsible THEN
    RETURN jsonb_build_object('version', w.version, 'changed', false);
  END IF;
  IF NOT public.check_rate_limit('tt-status:' || _uid::text, COALESCE((s ->> 'rate_limit_per_hour')::int, 30), 3600) THEN
    RAISE EXCEPTION 'Too many working status changes in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;

  _v := w.version + 1;
  UPDATE public.ticket_working_status SET
    status_key = _status, note = _n, expected_date = _expected_date, responsible = _responsible,
    set_by = _uid, set_by_role = _role, set_at = now(), version = _v,
    last_reminder_on = NULL, overdue_reminders = 0, review_reminded_on = NULL, review_reminders = 0
   WHERE ticket_id = _ticket;
  INSERT INTO public.ticket_working_status_events (ticket_id, from_key, to_key, note, expected_date, responsible, actor_id, actor_role)
  VALUES (_ticket, w.status_key, _status, _n, _expected_date, _responsible, _uid, _role);
  IF _role = 'admin' THEN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (_uid, 'ticket_working_status.admin_set', 'ticket', _ticket,
            jsonb_build_object('from', w.status_key, 'to', _status, 'note', _n, 'expected_date', _expected_date, 'responsible', _responsible));
  END IF;
  BEGIN
    PERFORM public.tt_notify_change(_ticket, _uid, _role, _status, _n, _v);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'ticket tracking notification skipped: %', SQLERRM;
  END;
  RETURN jsonb_build_object('version', _v, 'changed', true);
END
$$;
REVOKE ALL ON FUNCTION public.tt_set_working_status(uuid, text, text, date, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_set_working_status(uuid, text, text, date, text, integer) TO authenticated;

-- ------------------------------------------------------------------ e-mail worker RPCs (service role only)

CREATE OR REPLACE FUNCTION public.tt_claim_emails(_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, user_id uuid, ticket_id uuid, kind text, payload jsonb, dedupe_key text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
#variable_conflict use_column
BEGIN
  -- Rows for people who are no longer on the ticket, or while the feature is off, are dropped (not sent later).
  UPDATE public.ticket_tracking_email_queue q SET failed_at = now(), last_error = 'not_applicable'
   WHERE q.sent_at IS NULL AND q.failed_at IS NULL
     AND (NOT COALESCE((public.tt_settings() ->> 'enabled')::boolean, false)
          OR public.tt_viewer_role(q.ticket_id, q.user_id) IS NULL
          OR EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = q.ticket_id AND t.status::text = 'closed' AND q.kind <> 'status'));
  RETURN QUERY
  UPDATE public.ticket_tracking_email_queue q SET attempts = q.attempts + 1, lease_until = now() + interval '10 minutes'
   WHERE q.id IN (SELECT q2.id FROM public.ticket_tracking_email_queue q2
                   WHERE q2.sent_at IS NULL AND q2.failed_at IS NULL AND q2.attempts < 5
                     AND (q2.lease_until IS NULL OR q2.lease_until < now())
                   ORDER BY q2.created_at LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
                   FOR UPDATE SKIP LOCKED)
  RETURNING q.id, q.user_id, q.ticket_id, q.kind, q.payload, q.dedupe_key;
END
$$;
REVOKE ALL ON FUNCTION public.tt_claim_emails(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tt_claim_emails(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.tt_finish_email(_id uuid, _ok boolean, _error text DEFAULT NULL)
 RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  UPDATE public.ticket_tracking_email_queue SET
    sent_at = CASE WHEN _ok THEN now() END,
    failed_at = CASE WHEN NOT _ok AND attempts >= 5 THEN now() END,
    last_error = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error, 'failed'), 200) END,
    lease_until = NULL
   WHERE id = _id
$$;
REVOKE ALL ON FUNCTION public.tt_finish_email(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tt_finish_email(uuid, boolean, text) TO service_role;

-- ------------------------------------------------------------------ daily reminders

-- Once a day: "due tomorrow" and "overdue" to the responsible side, and "ready for your review for N days" to the
-- client. Max one reminder per item per day, capped counts, bounded to 500 rows, never for rows the backfill made.
CREATE OR REPLACE FUNCTION public.tt_reminder_sweep()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  s jsonb := public.tt_settings(); r record; rec record; _kind text; _court text; _roles text[]; _n int := 0;
  _days int := COALESCE((s ->> 'review_reminder_days')::int, 3);
  _maxr int := COALESCE((s ->> 'max_review_reminders')::int, 3);
  _maxo int := COALESCE((s ->> 'max_overdue_reminders')::int, 3);
  _lang text; _title text; _body text; _label text;
BEGIN
  IF NOT COALESCE((s ->> 'enabled')::boolean, false) THEN RETURN 0; END IF;
  FOR r IN
    SELECT w.*, t.title, t.status::text AS ticket_status
      FROM public.ticket_working_status w JOIN public.tickets t ON t.id = w.ticket_id
     WHERE t.status::text <> 'closed' AND COALESCE(t.close_outcome, '') <> 'cancelled'
       AND w.set_by_role <> 'system' AND w.status_key <> 'completed'
       AND w.last_reminder_on IS DISTINCT FROM current_date
       AND ((w.expected_date = current_date + 1)
         OR (w.expected_date < current_date AND w.overdue_reminders < _maxo)
         OR (w.status_key = 'ready_for_review' AND w.review_reminders < _maxr AND w.set_at::date <= current_date - _days
             AND (w.review_reminded_on IS NULL OR w.review_reminded_on <= current_date - _days)))
     ORDER BY w.set_at
     LIMIT 500
  LOOP
    BEGIN
      _kind := CASE WHEN r.expected_date = current_date + 1 THEN 'due_tomorrow'
                    WHEN r.expected_date < current_date AND r.overdue_reminders < _maxo THEN 'overdue'
                    ELSE 'review' END;
      IF _kind = 'review' THEN
        _roles := ARRAY['client'];
      ELSE
        _court := COALESCE(r.responsible, (SELECT x ->> 'court' FROM jsonb_array_elements(s -> 'statuses') x WHERE x ->> 'key' = r.status_key LIMIT 1), 'none');
        IF _court = 'other' THEN _court := CASE r.set_by_role WHEN 'client' THEN 'consultant' WHEN 'consultant' THEN 'client' ELSE 'none' END; END IF;
        _roles := CASE WHEN _court IN ('client', 'consultant') THEN ARRAY[_court] ELSE ARRAY['client', 'consultant'] END;
      END IF;
      FOR rec IN SELECT * FROM public.tt_recipients(r.ticket_id) x WHERE x.role = ANY (_roles) LOOP
        _lang := public.tt_lang(rec.user_id);
        _label := public.tt_status_label(r.status_key, _lang);
        IF _kind = 'review' THEN
          _title := CASE WHEN _lang = 'ar' THEN 'العمل بانتظار مراجعتك' ELSE 'Work is waiting for your review' END;
          _body := CASE WHEN _lang = 'ar' THEN '«' || left(r.title, 120) || '» جاهز لمراجعتك منذ ' || _days || ' أيام أو أكثر.'
                        ELSE '"' || left(r.title, 120) || '" has been ready for your review for ' || _days || ' days or more.' END;
        ELSIF _kind = 'due_tomorrow' THEN
          _title := CASE WHEN _lang = 'ar' THEN 'الموعد المتوقع غداً' ELSE 'Expected date is tomorrow' END;
          _body := CASE WHEN _lang = 'ar' THEN '«' || left(r.title, 120) || '»: ' || _label || ' - الموعد المتوقع ' || to_char(r.expected_date, 'YYYY-MM-DD') || '.'
                        ELSE '"' || left(r.title, 120) || '": ' || _label || ' - expected by ' || to_char(r.expected_date, 'YYYY-MM-DD') || '.' END;
        ELSE
          _title := CASE WHEN _lang = 'ar' THEN 'تجاوز الموعد المتوقع' ELSE 'Expected date has passed' END;
          _body := CASE WHEN _lang = 'ar' THEN '«' || left(r.title, 120) || '»: ' || _label || ' - كان الموعد المتوقع ' || to_char(r.expected_date, 'YYYY-MM-DD') || '.'
                        ELSE '"' || left(r.title, 120) || '": ' || _label || ' - was expected by ' || to_char(r.expected_date, 'YYYY-MM-DD') || '.' END;
        END IF;
        PERFORM public.tt_push_notice(rec.user_id, r.ticket_id, rec.role, _title, _body);
        PERFORM public.tt_queue_email(rec.user_id, r.ticket_id, rec.role, _kind,
          jsonb_build_object('lang', _lang, 'ticket_title', left(r.title, 120), 'status_label', _label,
                             'expected_date', r.expected_date, 'days', _days),
          'tt:' || _kind || ':' || r.ticket_id::text || ':' || rec.user_id::text || ':' || current_date::text);
      END LOOP;
      UPDATE public.ticket_working_status SET
        last_reminder_on = current_date,
        overdue_reminders = overdue_reminders + CASE WHEN _kind = 'overdue' THEN 1 ELSE 0 END,
        review_reminders = review_reminders + CASE WHEN _kind = 'review' THEN 1 ELSE 0 END,
        review_reminded_on = CASE WHEN _kind = 'review' THEN current_date ELSE review_reminded_on END
       WHERE ticket_id = r.ticket_id;
      _n := _n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ticket tracking reminder skipped for %: %', r.ticket_id, SQLERRM;
    END;
  END LOOP;
  RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.tt_reminder_sweep() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'ticket-tracking-reminders';
    PERFORM cron.schedule('ticket-tracking-reminders', '43 6 * * *', 'SELECT public.tt_reminder_sweep()');
  END IF;
END
$do$;

-- ------------------------------------------------------------------ admin

CREATE OR REPLACE FUNCTION public.tt_admin_set_settings(_value jsonb, _reason text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid(); _before jsonb := public.tt_settings(); _after jsonb; x jsonb; _keys text[] := ARRAY[]::text[];
  _k text; _m jsonb; _num text;
BEGIN
  IF NOT public.tt_is_admin(_uid) THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF _value IS NULL OR jsonb_typeof(_value) <> 'object' THEN RAISE EXCEPTION 'Invalid settings' USING ERRCODE = '22023'; END IF;
  _after := _before;
  IF _value ? 'enabled' THEN
    IF jsonb_typeof(_value -> 'enabled') <> 'boolean' THEN RAISE EXCEPTION 'enabled must be true or false' USING ERRCODE = '22023'; END IF;
    _after := _after || jsonb_build_object('enabled', _value -> 'enabled');
  END IF;
  IF _value ? 'email_enabled' THEN
    IF jsonb_typeof(_value -> 'email_enabled') <> 'boolean' THEN RAISE EXCEPTION 'email_enabled must be true or false' USING ERRCODE = '22023'; END IF;
    _after := _after || jsonb_build_object('email_enabled', _value -> 'email_enabled');
  END IF;
  FOREACH _num IN ARRAY ARRAY['note_max:50:2000', 'rate_limit_per_hour:1:200', 'throttle_minutes:1:240', 'review_reminder_days:1:30',
                               'max_review_reminders:0:10', 'max_overdue_reminders:0:10', 'stuck_days:1:90'] LOOP
    _k := split_part(_num, ':', 1);
    IF _value ? _k THEN
      IF jsonb_typeof(_value -> _k) <> 'number' OR (_value ->> _k)::numeric <> floor((_value ->> _k)::numeric)
         OR (_value ->> _k)::int < split_part(_num, ':', 2)::int OR (_value ->> _k)::int > split_part(_num, ':', 3)::int THEN
        RAISE EXCEPTION '% must be a whole number between % and %', _k, split_part(_num, ':', 2), split_part(_num, ':', 3) USING ERRCODE = '22023';
      END IF;
      _after := _after || jsonb_build_object(_k, (_value ->> _k)::int);
    END IF;
  END LOOP;
  IF _value ? 'statuses' THEN
    IF jsonb_typeof(_value -> 'statuses') <> 'array' OR jsonb_array_length(_value -> 'statuses') NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'The working status list must have 1 to 20 entries' USING ERRCODE = '22023';
    END IF;
    FOR x IN SELECT * FROM jsonb_array_elements(_value -> 'statuses') LOOP
      IF jsonb_typeof(x) <> 'object' OR COALESCE(x ->> 'key', '') !~ '^[a-z_]{2,40}$' OR (x ->> 'key') = ANY (_keys)
         OR char_length(btrim(COALESCE(x ->> 'label_en', ''))) NOT BETWEEN 1 AND 60
         OR char_length(btrim(COALESCE(x ->> 'label_ar', ''))) NOT BETWEEN 1 AND 60
         OR COALESCE(x ->> 'color', '') NOT IN ('muted', 'primary', 'accent', 'info', 'success', 'warning', 'destructive')
         OR COALESCE(x ->> 'icon', '') NOT IN ('circle', 'search', 'hourglass', 'user-clock', 'key', 'wrench', 'flask', 'eye', 'rotate', 'pause', 'check')
         OR COALESCE(x ->> 'court', '') NOT IN ('client', 'consultant', 'both', 'third_party', 'none', 'other')
         OR jsonb_typeof(x -> 'order') <> 'number' OR jsonb_typeof(x -> 'enabled') <> 'boolean'
         OR public.contact_details_in_text(x ->> 'label_en') OR public.contact_details_in_text(x ->> 'label_ar') THEN
        RAISE EXCEPTION 'Invalid working status entry: %', left(COALESCE(x ->> 'key', '?'), 40) USING ERRCODE = '22023';
      END IF;
      _keys := _keys || (x ->> 'key');
    END LOOP;
    FOREACH _k IN ARRAY ARRAY['not_started', 'on_hold', 'ready_for_review', 'needs_rework', 'completed'] LOOP
      IF NOT _k = ANY (_keys) THEN RAISE EXCEPTION 'The status "%" can be renamed or switched off, not removed', _k USING ERRCODE = '22023'; END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_value -> 'statuses') x WHERE x ->> 'key' = 'not_started' AND (x ->> 'enabled')::boolean) THEN
      RAISE EXCEPTION '"Not started" must stay switched on' USING ERRCODE = '22023';
    END IF;
    _after := _after || jsonb_build_object('statuses', _value -> 'statuses');
  END IF;
  IF _value ? 'matrix' THEN
    IF jsonb_typeof(_value -> 'matrix') <> 'object' THEN RAISE EXCEPTION 'Invalid permission matrix' USING ERRCODE = '22023'; END IF;
    _after := _after || jsonb_build_object('matrix', _value -> 'matrix');
  END IF;
  -- Every status needs a complete matrix row (client / consultant / note as true or false).
  FOR x IN SELECT * FROM jsonb_array_elements(_after -> 'statuses') LOOP
    _m := _after -> 'matrix' -> (x ->> 'key');
    IF _m IS NULL OR jsonb_typeof(_m -> 'client') <> 'boolean' OR jsonb_typeof(_m -> 'consultant') <> 'boolean' OR jsonb_typeof(_m -> 'note') <> 'boolean' THEN
      RAISE EXCEPTION 'The permission matrix has no complete row for "%"', x ->> 'key' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.platform_settings (key, value) VALUES ('ticket_tracking', _after)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (_uid, 'ticket_tracking.settings_changed', 'platform_settings', NULL,
          jsonb_build_object('before', _before, 'after', _after, 'reason', NULLIF(left(btrim(COALESCE(_reason, '')), 500), '')));
  RETURN _after;
END
$$;
REVOKE ALL ON FUNCTION public.tt_admin_set_settings(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_admin_set_settings(jsonb, text) TO authenticated;

-- Admin overview: counts per working status of open tickets and the tickets stuck in one status for more than N days.
CREATE OR REPLACE FUNCTION public.tt_admin_overview(_days integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s jsonb := public.tt_settings(); _d int;
BEGIN
  IF NOT public.tt_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  _d := LEAST(GREATEST(COALESCE(_days, (s ->> 'stuck_days')::int, 7), 1), 365);
  RETURN jsonb_build_object(
    'settings', s,
    'days', _d,
    'counts', COALESCE((SELECT jsonb_object_agg(k, n) FROM (
        SELECT COALESCE(w.status_key, 'not_started') k, count(*) n FROM public.tickets t
          LEFT JOIN public.ticket_working_status w ON w.ticket_id = t.id
         WHERE t.status::text <> 'closed' GROUP BY 1) z), '{}'::jsonb),
    'stuck', COALESCE((SELECT jsonb_agg(z ORDER BY z.days DESC) FROM (
        SELECT t.id AS ticket_id, left(t.title, 120) AS title, t.status::text AS status, COALESCE(w.status_key, 'not_started') AS status_key,
               COALESCE(w.set_by_role, 'system') AS set_by_role, floor(extract(epoch FROM now() - COALESCE(w.set_at, t.created_at)) / 86400)::int AS days,
               w.expected_date
          FROM public.tickets t LEFT JOIN public.ticket_working_status w ON w.ticket_id = t.id
         WHERE t.status::text <> 'closed' AND COALESCE(w.set_at, t.created_at) < now() - make_interval(days => _d)
         ORDER BY COALESCE(w.set_at, t.created_at) LIMIT 50) z), '[]'::jsonb),
    'changes_7d', (SELECT count(*) FROM public.ticket_working_status_events e WHERE e.created_at > now() - interval '7 days' AND NOT e.backfill));
END
$$;
REVOKE ALL ON FUNCTION public.tt_admin_overview(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tt_admin_overview(integer) TO authenticated;

-- ------------------------------------------------------------------ new tickets + backfill (no notifications)

CREATE OR REPLACE FUNCTION public.tt_on_ticket_insert()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  BEGIN
    INSERT INTO public.ticket_working_status (ticket_id, status_key, set_by_role, set_at, version)
    VALUES (NEW.id, 'not_started', 'system', COALESCE(NEW.created_at, now()), 1) ON CONFLICT (ticket_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'working status row skipped: %', SQLERRM;  -- never blocks creating a ticket
  END;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.tt_on_ticket_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_tt_ticket_insert ON public.tickets;
CREATE TRIGGER trg_tt_ticket_insert AFTER INSERT ON public.tickets FOR EACH ROW EXECUTE FUNCTION public.tt_on_ticket_insert();

-- Backfill rule (documented in docs/ticket-tracking.md): waiting_for_client -> "Waiting for client information",
-- in_progress -> "In analysis", resolved -> "Ready for client review", closed -> "Completed (from my side)",
-- everything else -> "Not started". Set by 'system' (so no reminders) at the ticket's last update; one history row each
-- marked backfill. Inserting directly (not through tt_set_working_status) means no notifications.
WITH ins AS (
  INSERT INTO public.ticket_working_status (ticket_id, status_key, set_by_role, set_at, version)
  SELECT t.id,
         CASE t.status::text WHEN 'waiting_for_client' THEN 'waiting_client_info' WHEN 'in_progress' THEN 'in_analysis'
                             WHEN 'resolved' THEN 'ready_for_review' WHEN 'closed' THEN 'completed' ELSE 'not_started' END,
         'system', COALESCE(t.updated_at, t.created_at), 1
    FROM public.tickets t
  ON CONFLICT (ticket_id) DO NOTHING
  RETURNING ticket_id, status_key, set_at
)
INSERT INTO public.ticket_working_status_events (ticket_id, from_key, to_key, actor_role, backfill, created_at)
SELECT ins.ticket_id, NULL, ins.status_key, 'system', true, ins.set_at FROM ins;

-- Tighten table privileges (the project's default privileges give new tables full rights to anon/authenticated;
-- RLS already blocks writes, this removes the rights themselves). The browser only reads through the tt_* RPCs.
REVOKE ALL ON public.ticket_working_status, public.ticket_working_status_events, public.ticket_tracking_email_queue FROM anon, authenticated;
GRANT SELECT ON public.ticket_working_status, public.ticket_working_status_events TO authenticated;
