-- Two-layer ticket tracking: AUTOMATIC stage (derived, read-only) + MANUAL working status (new data).
-- PREPARED ONLY - NOT APPLIED. Review, then apply once; re-running is safe (IF NOT EXISTS / CREATE OR REPLACE).
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
    'actors', jsonb_build_object('submitted', 'client', 'rate', CASE WHEN _rate_by IS NULL THEN 'client' ELSE public.tt_actor_role(_ticket, _rate_by) END,
      'nda', 'both', 'confirmed', 'both', 'work', 'consultant',
      'delivered', CASE WHEN _deliv IS NULL THEN NULL ELSE public.tt_actor_role(_ticket, _deliv_by) END,
      'closed', CASE WHEN _closed IS NULL THEN NULL ELSE public.tt_actor_role(_ticket, _closed_by) END,
      'reopened', CASE WHEN _reopen IS NULL THEN NULL ELSE public.tt_actor_role(_ticket, _reopen_by) END),
    'working', _working);
END
$$;
REVOKE ALL ON FUNCTION public.tt_facts(uuid) FROM PUBLIC, anon, authenticated;