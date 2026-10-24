-- ============================================================================================================
-- BRD approval by the assigned consultant(s) before work starts.        PREPARED ONLY - NOT APPLIED.
-- Needs (already applied): docs/sql/team-engagement.sql, docs/sql/ticket-brd.sql, docs/sql/ticket-tracking.sql.
-- Run once in a transaction; safe to re-run (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS).
-- Then run docs/sql/ticket-brd-approval.test.sql (it rolls back).
--
-- What it adds
--   * settings keys inside platform_settings.ticket_brd: approval_gate ('off' | 'recommended' (default) | 'required'),
--     approval_all_members (default off: only the lead consultant must approve), approval_allow_no_change (default
--     off), reminder / client notice / admin escalation days, reminder cap, decisions per hour, approval e-mails;
--   * ticket_brd_approval_requests: one approval round per submitted version (exact version + content hash), at most
--     one open round per ticket; a newer submission closes the open round as superseded;
--   * ticket_brd_approvals: immutable decisions (approved / changes_requested / declined) per consultant and round;
--   * ticket_brd_approval_waivers: audited admin waiver ("work may start without an approved BRD");
--   * ticket_brd_approval_notices (dedupe of reminders) and ticket_brd_approval_email_queue (service role only);
--   * the gate brd_gate_state / brd_gate_blocks, used by team_gates / team_next_step (step 'approve_brd' or
--     'update_brd' after the NDA), by the stage facts (tt_facts -> 'brd_approval') and the timeline (tt_timeline),
--     and enforced by triggers on engagement confirmations, work logs and timesheet submission (mode 'required');
--   * the BRD reader rule also lets a team member read once the NDA is signed by both (team status nda_signed), so
--     the consultant can review the document before the engagement confirmation.
--
-- Rules
--   * Not "required" and no BRD submitted -> nothing blocks. "Recommended" never blocks, it only shows the state.
--   * Approval binds one exact version and its content hash; a change of the document needs a new round.
--   * Decisions are written only by brd_decide_approval (server checks the caller, the round, the version, the note
--     and the rate limit); browsers cannot read or write these tables (no grants to anon / authenticated).
--   * Name privacy: people are shown through brd_person_name (consultant_name_for, Feature X).
--   * Contact details in notes are refused (contact_details_in_text, M60).
-- Shared functions redefined here carry the same combined body as their home file (checked by a test):
--   brd_default_settings, admin_brd_set_settings, brd_role_for, brd_consultant_readers (ticket-brd.sql),
--   team_gates, team_next_step, team_step_text (team-engagement.sql), tt_facts, tt_timeline (ticket-tracking.sql).
-- The home files create no-op stubs of the hooks team_brd_gate, tt_brd_approval_fact and tt_brd_approval_events
-- only while they do not exist, so files can be applied in any order without dropping this feature.
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
    'comments_per_user_per_day', 60,
    'approval_gate', 'recommended',
    'approval_all_members', false,
    'approval_allow_no_change', false,
    'approval_email', true,
    'approval_remind_days', 2,
    'approval_client_days', 3,
    'approval_escalate_days', 5,
    'approval_max_reminders', 5,
    'approval_decisions_per_hour', 20
  )
$$;

CREATE OR REPLACE FUNCTION public.admin_brd_set_settings(_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  before jsonb := public.brd_settings();
  merged jsonb := public.brd_settings();
  k text;
  v jsonb;
  lo integer;
  hi integer;
BEGIN
  IF NOT public.brd_is_admin(uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF _value IS NULL OR jsonb_typeof(_value) <> 'object' THEN RAISE EXCEPTION 'brd_invalid_settings' USING ERRCODE = '22023'; END IF;
  FOR k, v IN SELECT * FROM jsonb_each(_value) LOOP
    IF k IN ('enabled', 'require_nda', 'approval_all_members', 'approval_allow_no_change', 'approval_email') THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'brd_invalid_setting %', k USING ERRCODE = '22023'; END IF;
    ELSIF k IN ('ai_calls_per_ticket_per_day', 'ai_calls_per_client_per_day', 'deep_calls_per_ticket_per_day', 'max_attachments', 'max_attachment_chars', 'comments_per_user_per_day') THEN
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
         OR (v #>> '{}')::integer < 0
         OR (k = 'max_attachment_chars' AND (v #>> '{}')::integer > 20000)
         OR (k = 'max_attachments' AND (v #>> '{}')::integer > 10)
         OR (k LIKE '%per_day' AND (v #>> '{}')::integer > 1000) THEN
        RAISE EXCEPTION 'brd_invalid_setting %', k USING ERRCODE = '22023';
      END IF;
    ELSIF k IN ('approval_remind_days', 'approval_client_days', 'approval_escalate_days', 'approval_max_reminders', 'approval_decisions_per_hour') THEN
      lo := (k = 'approval_max_reminders')::int # 1;
      hi := (ARRAY[30, 60, 90, 20, 200])[array_position(ARRAY['approval_remind_days', 'approval_client_days', 'approval_escalate_days', 'approval_max_reminders', 'approval_decisions_per_hour'], k)];
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric)
         OR (v #>> '{}')::integer < lo OR (v #>> '{}')::integer > hi THEN
        RAISE EXCEPTION 'brd_invalid_setting %', k USING ERRCODE = '22023';
      END IF;
    ELSIF k = 'approval_gate' THEN
      IF jsonb_typeof(v) <> 'string' OR (v #>> '{}') NOT IN ('off', 'recommended', 'required') THEN
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
REVOKE ALL ON FUNCTION public.admin_brd_set_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_brd_set_settings(jsonb) TO authenticated;

-- ------------------------------------------------------------------------------------------------ reader rule
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
  -- The ticket-document reader rule for consultants: the ticket's consultant, or a team member on a team-gated
  -- ticket once the NDA is signed by both (nda_signed) or started (ready/active), so the BRD can be approved before
  -- the engagement confirmation. Plain match requests, bids and support assignments are not readers.
  SELECT c.id INTO cid
  FROM public.consultants c
  WHERE c.user_id = _uid
    AND (c.id = t.consultant_id
         OR (public.team_ticket_gated(_ticket) AND EXISTS (
               SELECT 1 FROM public.ticket_team_members tm
               WHERE tm.ticket_id = _ticket AND tm.consultant_id = c.id AND tm.status IN ('nda_signed', 'ready', 'active'))))
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

-- Users who may read attached versions as consultants (for notices).
CREATE OR REPLACE FUNCTION public.brd_consultant_readers(_ticket uuid)
RETURNS TABLE (user_id uuid, consultant_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT c.user_id, c.id
  FROM public.consultants c
  WHERE (c.id = (SELECT consultant_id FROM public.tickets WHERE id = _ticket)
         OR c.id IN (SELECT tm.consultant_id FROM public.ticket_team_members tm WHERE tm.ticket_id = _ticket AND tm.status IN ('nda_signed', 'ready', 'active')))
    AND public.brd_role_for(_ticket, c.user_id) = 'consultant'
$$;

-- ------------------------------------------------------------------------------------------------ tables
CREATE TABLE IF NOT EXISTS public.ticket_brd_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  brd_id uuid NOT NULL REFERENCES public.ticket_brds(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  version_status text NOT NULL CHECK (version_status IN ('draft', 'final')),
  previous_version integer,
  no_material_change boolean NOT NULL DEFAULT false,
  carried_from uuid REFERENCES public.ticket_brd_approval_requests(id) ON DELETE SET NULL,
  submit_note text NOT NULL DEFAULT '' CHECK (char_length(submit_note) <= 500),
  submitted_by uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  approved_at timestamptz,
  closed_at timestamptz,
  closed_reason text CHECK (closed_reason IS NULL OR closed_reason IN ('superseded', 'withdrawn')),
  closed_by uuid,
  close_note text CHECK (close_note IS NULL OR char_length(close_note) <= 500),
  client_noticed_at timestamptz,
  escalated_at timestamptz,
  CHECK ((closed_at IS NULL) = (closed_reason IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_brd_approval_requests_open_idx ON public.ticket_brd_approval_requests (ticket_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS ticket_brd_approval_requests_ticket_idx ON public.ticket_brd_approval_requests (ticket_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.ticket_brd_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.ticket_brd_approval_requests(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  version integer NOT NULL,
  content_hash text NOT NULL,
  consultant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  member_role text NOT NULL CHECK (member_role IN ('lead', 'support')),
  decision text NOT NULL CHECK (decision IN ('approved', 'changes_requested', 'declined')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 4000),
  confirmed_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, consultant_id),
  CHECK (decision <> 'approved' OR confirmed_read)
);
CREATE INDEX IF NOT EXISTS ticket_brd_approvals_ticket_idx ON public.ticket_brd_approvals (ticket_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ticket_brd_approval_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  admin_id uuid NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 5 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_brd_approval_waivers_active_idx ON public.ticket_brd_approval_waivers (ticket_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.ticket_brd_approval_notices (
  dedupe_key text PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.ticket_brd_approval_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_brd_approval_notices_req_idx ON public.ticket_brd_approval_notices (request_id, user_id, kind);

CREATE TABLE IF NOT EXISTS public.ticket_brd_approval_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('request', 'reminder', 'fyi', 'approved', 'changes_requested', 'declined', 'client_waiting', 'admin_declined', 'admin_escalation')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text
);
CREATE INDEX IF NOT EXISTS ticket_brd_approval_email_queue_pending_idx ON public.ticket_brd_approval_email_queue (created_at)
  WHERE sent_at IS NULL AND failed_at IS NULL;

-- Browsers never touch these tables: everything goes through the functions below.
REVOKE ALL ON public.ticket_brd_approval_requests, public.ticket_brd_approvals, public.ticket_brd_approval_waivers,
              public.ticket_brd_approval_notices, public.ticket_brd_approval_email_queue FROM anon, authenticated;
GRANT ALL ON public.ticket_brd_approval_requests, public.ticket_brd_approvals, public.ticket_brd_approval_waivers,
             public.ticket_brd_approval_notices, public.ticket_brd_approval_email_queue TO service_role;
ALTER TABLE public.ticket_brd_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_brd_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_brd_approval_waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_brd_approval_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_brd_approval_email_queue ENABLE ROW LEVEL SECURITY;  -- no policies: functions / service role only

-- Rounds: identity, version and hash never change; only the one-time marks below may be set (never cleared).
CREATE OR REPLACE FUNCTION public.brd_guard_approval_request()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.tickets WHERE id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'BRD approval rounds cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id <> OLD.id OR NEW.ticket_id <> OLD.ticket_id OR NEW.brd_id <> OLD.brd_id OR NEW.version <> OLD.version
     OR NEW.content_hash <> OLD.content_hash OR NEW.version_status <> OLD.version_status
     OR NEW.previous_version IS DISTINCT FROM OLD.previous_version OR NEW.no_material_change <> OLD.no_material_change
     OR NEW.submit_note <> OLD.submit_note OR NEW.submitted_by <> OLD.submitted_by OR NEW.submitted_at <> OLD.submitted_at
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR (OLD.carried_from IS NOT NULL AND NEW.carried_from IS NOT NULL AND NEW.carried_from <> OLD.carried_from)
     OR (OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at)
     OR (OLD.closed_at IS NOT NULL AND (NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.closed_reason IS DISTINCT FROM OLD.closed_reason
                                         OR NEW.closed_by IS DISTINCT FROM OLD.closed_by OR NEW.close_note IS DISTINCT FROM OLD.close_note))
     OR (OLD.client_noticed_at IS NOT NULL AND NEW.client_noticed_at IS DISTINCT FROM OLD.client_noticed_at)
     OR (OLD.escalated_at IS NOT NULL AND NEW.escalated_at IS DISTINCT FROM OLD.escalated_at) THEN
    RAISE EXCEPTION 'BRD approval rounds are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS brd_guard_approval_request ON public.ticket_brd_approval_requests;
CREATE TRIGGER brd_guard_approval_request BEFORE UPDATE OR DELETE ON public.ticket_brd_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.brd_guard_approval_request();

-- Decisions are append-only (same guard as the BRD audit tables: only the ticket cascade may remove them).
DROP TRIGGER IF EXISTS brd_guard_approvals ON public.ticket_brd_approvals;
CREATE TRIGGER brd_guard_approvals BEFORE UPDATE OR DELETE ON public.ticket_brd_approvals
  FOR EACH ROW EXECUTE FUNCTION public.brd_guard_append_only();

CREATE OR REPLACE FUNCTION public.brd_guard_approval_waiver()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.tickets WHERE id = OLD.ticket_id) THEN
      RAISE EXCEPTION 'BRD approval waivers cannot be deleted' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.id <> OLD.id OR NEW.ticket_id <> OLD.ticket_id OR NEW.admin_id <> OLD.admin_id OR NEW.reason <> OLD.reason
     OR NEW.created_at <> OLD.created_at OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'BRD approval waivers are immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS brd_guard_approval_waiver ON public.ticket_brd_approval_waivers;
CREATE TRIGGER brd_guard_approval_waiver BEFORE UPDATE OR DELETE ON public.ticket_brd_approval_waivers
  FOR EACH ROW EXECUTE FUNCTION public.brd_guard_approval_waiver();

-- ------------------------------------------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION public.brd_content_hash(_c jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT encode(sha256(convert_to(COALESCE(_c, '{}'::jsonb)::text, 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION public.brd_approval_mode(_s jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN _s ->> 'approval_gate' IN ('off', 'recommended', 'required') THEN _s ->> 'approval_gate' ELSE 'recommended' END
$$;

-- The lead consultant: the started/accepted team lead (else the primary or first accepted member) on team tickets,
-- else the ticket's consultant, else the active lead assignment.
CREATE OR REPLACE FUNCTION public.brd_approval_lead(_ticket uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT m.consultant_id FROM public.ticket_team_members m
      WHERE m.ticket_id = _ticket AND NOT m.is_legacy AND public.team_live(m.status)
        AND m.status NOT IN ('selected', 'invited', 'viewed')
      ORDER BY (m.team_role = 'lead') DESC, m.is_primary DESC, m.created_at LIMIT 1),
    (SELECT t.consultant_id FROM public.tickets t WHERE t.id = _ticket),
    (SELECT a.consultant_id FROM public.ticket_assignments a
      WHERE a.ticket_id = _ticket AND a.status::text = 'active' AND a.role::text = 'lead' ORDER BY a.created_at LIMIT 1))
$$;

-- Who must approve: the lead, plus every other consultant who can read the BRD when approval_all_members is on.
-- Observers never approve.
CREATE OR REPLACE FUNCTION public.brd_approval_required(_ticket uuid)
RETURNS TABLE (consultant_id uuid, user_id uuid, member_role text, can_read boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH lead AS (SELECT public.brd_approval_lead(_ticket) AS cid),
  obs AS (SELECT a.consultant_id FROM public.ticket_assignments a
           WHERE a.ticket_id = _ticket AND a.status::text = 'active' AND a.role::text = 'observer' AND a.consultant_id IS NOT NULL),
  ids AS (
    SELECT cid FROM lead WHERE cid IS NOT NULL
    UNION
    SELECT r.consultant_id FROM public.brd_consultant_readers(_ticket) r
     WHERE COALESCE((public.brd_settings() ->> 'approval_all_members')::boolean, false)
  )
  SELECT c.id, c.user_id, CASE WHEN c.id = (SELECT cid FROM lead) THEN 'lead' ELSE 'support' END,
         COALESCE(public.brd_role_for(_ticket, c.user_id) = 'consultant', false)
    FROM ids JOIN public.consultants c ON c.id = ids.cid
   WHERE c.user_id IS NOT NULL AND c.id NOT IN (SELECT o.consultant_id FROM obs o)
$$;

-- State of one round: pending | approved | changes_requested | rejected | superseded | withdrawn.
CREATE OR REPLACE FUNCTION public.brd_round_state(_request uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r public.ticket_brd_approval_requests;
  _req uuid[];
  _ok integer := 0; _chg integer := 0; _dec integer := 0;
  _state text;
BEGIN
  SELECT * INTO r FROM public.ticket_brd_approval_requests WHERE id = _request;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  SELECT COALESCE(array_agg(x.consultant_id), ARRAY[]::uuid[]) INTO _req FROM public.brd_approval_required(r.ticket_id) x;
  SELECT count(*) FILTER (WHERE a.decision = 'approved'), count(*) FILTER (WHERE a.decision = 'changes_requested'),
         count(*) FILTER (WHERE a.decision = 'declined')
    INTO _ok, _chg, _dec
    FROM public.ticket_brd_approvals a WHERE a.request_id = r.id AND a.consultant_id = ANY (_req);
  _state := CASE
    WHEN r.closed_at IS NOT NULL THEN r.closed_reason
    WHEN _dec > 0 THEN 'rejected'
    WHEN _chg > 0 THEN 'changes_requested'
    WHEN cardinality(_req) > 0 AND _ok >= cardinality(_req) THEN 'approved'
    WHEN r.carried_from IS NOT NULL AND r.approved_at IS NOT NULL THEN 'approved'
    ELSE 'pending' END;
  RETURN jsonb_build_object('state', _state, 'required', cardinality(_req), 'approved', _ok,
                            'approved_at', r.approved_at, 'carried', r.carried_from IS NOT NULL);
END
$$;

-- The gate for one ticket (and optionally one consultant). blocks = true only when the feature is on, the mode is
-- 'required', no admin waiver exists, a BRD round is open (submitted and not withdrawn) and no approved BRD covers
-- the work (with approval_all_members: none approved by this consultant).
CREATE OR REPLACE FUNCTION public.brd_gate_state(_ticket uuid, _consultant uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := public.brd_settings();
  _enabled boolean := COALESCE((s ->> 'enabled')::boolean, false);
  _mode text := public.brd_approval_mode(s);
  _all boolean := COALESCE((s ->> 'approval_all_members')::boolean, false);
  r public.ticket_brd_approval_requests;
  w public.ticket_brd_approval_waivers;
  st jsonb;
  _first timestamptz; _appr_v integer; _ok boolean := false; _state text := 'not_requested';
BEGIN
  SELECT * INTO w FROM public.ticket_brd_approval_waivers x WHERE x.ticket_id = _ticket AND x.revoked_at IS NULL LIMIT 1;
  SELECT * INTO r FROM public.ticket_brd_approval_requests x WHERE x.ticket_id = _ticket ORDER BY x.submitted_at DESC LIMIT 1;
  IF r.id IS NOT NULL THEN st := public.brd_round_state(r.id); _state := st ->> 'state'; END IF;
  SELECT min(x.approved_at) INTO _first FROM public.ticket_brd_approval_requests x WHERE x.ticket_id = _ticket AND x.approved_at IS NOT NULL;
  SELECT x.version INTO _appr_v FROM public.ticket_brd_approval_requests x
   WHERE x.ticket_id = _ticket AND x.approved_at IS NOT NULL ORDER BY x.submitted_at DESC LIMIT 1;
  IF _state = 'approved' THEN
    _ok := true; _first := COALESCE(_first, now()); _appr_v := COALESCE(r.version, _appr_v);
  ELSIF _first IS NOT NULL THEN
    _ok := NOT _all OR _consultant IS NULL
           OR NOT EXISTS (SELECT 1 FROM public.brd_approval_required(_ticket) q WHERE q.consultant_id = _consultant AND q.can_read)
           OR EXISTS (SELECT 1 FROM public.ticket_brd_approvals a JOIN public.ticket_brd_approval_requests q ON q.id = a.request_id
                       WHERE q.ticket_id = _ticket AND q.approved_at IS NOT NULL AND a.consultant_id = _consultant AND a.decision = 'approved');
  END IF;
  RETURN jsonb_build_object(
    'enabled', _enabled, 'mode', _mode, 'waived', w.id IS NOT NULL, 'waived_at', w.created_at,
    'state', _state, 'version', r.version, 'submitted_at', r.submitted_at, 'due_at', r.due_at,
    'open', r.id IS NOT NULL AND r.closed_at IS NULL,
    'approved_at', _first, 'approved_version', _appr_v, 'covered', _ok,
    'blocks', _enabled AND _mode = 'required' AND w.id IS NULL AND r.id IS NOT NULL AND r.closed_at IS NULL AND NOT _ok);
END
$$;

CREATE OR REPLACE FUNCTION public.brd_gate_blocks(_ticket uuid, _consultant uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((public.brd_gate_state(_ticket, _consultant) ->> 'blocks')::boolean, false)
$$;

-- Hooks used by the shared team / tracking functions (their home files hold no-op stubs).
CREATE OR REPLACE FUNCTION public.team_brd_gate(_ticket uuid, _consultant uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.brd_gate_state(_ticket, _consultant)
$$;

CREATE OR REPLACE FUNCTION public.tt_brd_approval_fact(_ticket uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.brd_gate_state(_ticket, NULL)
$$;

CREATE OR REPLACE FUNCTION public.tt_brd_approval_events(_ticket uuid, _viewer uuid)
RETURNS TABLE (event_at timestamptz, source text, kind text, actor_role text, params jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.created_at, 'system'::text,
         CASE e.action WHEN 'approval_requested' THEN 'brd_submitted' WHEN 'approval_approved' THEN 'brd_approved'
                       WHEN 'approval_changes_requested' THEN 'brd_changes' WHEN 'approval_declined' THEN 'brd_declined'
                       WHEN 'approval_superseded' THEN 'brd_superseded' WHEN 'approval_withdrawn' THEN 'brd_withdrawn'
                       WHEN 'approval_waived' THEN 'brd_waived' ELSE 'brd_waiver_revoked' END,
         public.tt_actor_role(_ticket, e.actor_id),
         jsonb_strip_nulls(jsonb_build_object(
           'version', e.version,
           'note', CASE WHEN e.action IN ('approval_approved', 'approval_changes_requested', 'approval_declined', 'approval_withdrawn') THEN NULLIF(e.detail ->> 'note', '') END,
           'who', CASE WHEN e.detail ? 'consultant_id' THEN public.brd_person_name(e.actor_id, (e.detail ->> 'consultant_id')::uuid, _viewer) END,
           'no_change', CASE WHEN (e.detail ->> 'no_change')::boolean THEN true END))
    FROM public.ticket_brd_events e
   WHERE e.ticket_id = _ticket AND e.action IN ('approval_requested', 'approval_approved', 'approval_changes_requested', 'approval_declined',
                                                'approval_superseded', 'approval_withdrawn', 'approval_waived', 'approval_waiver_revoked')
$$;

REVOKE ALL ON FUNCTION public.brd_content_hash(jsonb), public.brd_approval_mode(jsonb), public.brd_approval_lead(uuid),
  public.brd_approval_required(uuid), public.brd_round_state(uuid), public.brd_gate_state(uuid, uuid), public.brd_gate_blocks(uuid, uuid),
  public.team_brd_gate(uuid, uuid), public.tt_brd_approval_fact(uuid), public.tt_brd_approval_events(uuid, uuid),
  public.brd_guard_approval_request(), public.brd_guard_approval_waiver() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ notices + e-mail
CREATE OR REPLACE FUNCTION public.brd_approval_wake()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regprocedure('public.job_invoke_headers()') IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ticket_brd_approval_email_queue q WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5) THEN RETURN; END IF;
  EXECUTE $q$SELECT net.http_post(url := $1, headers := public.job_invoke_headers(), body := '{}'::jsonb)$q$
    USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/brd-approval-run';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'BRD approval e-mail wake-up skipped: %', SQLERRM;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_approval_wake_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN PERFORM public.brd_approval_wake(); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS trg_brd_approval_wake ON public.ticket_brd_approval_email_queue;
CREATE TRIGGER trg_brd_approval_wake AFTER INSERT ON public.ticket_brd_approval_email_queue
  FOR EACH STATEMENT EXECUTE FUNCTION public.brd_approval_wake_trigger();

CREATE OR REPLACE FUNCTION public.brd_approval_lang(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN (SELECT p.preferred_language FROM public.profiles p WHERE p.user_id = _user LIMIT 1) = 'ar' THEN 'ar' ELSE 'en' END
$$;

-- One in-app notice (+ optional e-mail) per person and event; dedupe keys make retries and re-runs harmless.
CREATE OR REPLACE FUNCTION public.brd_approval_notify(_request uuid, _user uuid, _ticket uuid, _type text, _title text, _body text,
  _link text, _email_kind text, _payload jsonb, _dedupe text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s jsonb := public.brd_settings(); _n integer;
BEGIN
  IF _user IS NULL THEN RETURN false; END IF;
  INSERT INTO public.ticket_brd_approval_notices (dedupe_key, request_id, user_id, kind) VALUES (left(_dedupe, 300), _request, _user, _type)
  ON CONFLICT (dedupe_key) DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RETURN false; END IF;
  PERFORM public.safe_insert_notification(_user, left(_title, 200), left(_body, 1000), _type, _link);
  IF _email_kind IS NOT NULL AND COALESCE((s ->> 'approval_email')::boolean, true) THEN
    INSERT INTO public.ticket_brd_approval_email_queue (user_id, ticket_id, kind, payload, dedupe_key)
    VALUES (_user, _ticket, _email_kind, COALESCE(_payload, '{}'::jsonb) || jsonb_build_object('lang', public.brd_approval_lang(_user), 'path', _link),
            left('brd-approval:' || _dedupe, 300))
    ON CONFLICT (dedupe_key) DO NOTHING;
  END IF;
  RETURN true;
END
$$;

-- Plain-text excerpt of the Purpose section (already masked by the BRD save rules) for the request e-mail.
CREATE OR REPLACE FUNCTION public.brd_approval_summary(_content jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT left(btrim(regexp_replace(regexp_replace(COALESCE(
           (SELECT x ->> 'html' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(_content -> 'sections') = 'array' THEN _content -> 'sections' ELSE '[]'::jsonb END) x
             WHERE x ->> 'key' = 'purpose' LIMIT 1), ''),
         '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), 240)
$$;

REVOKE ALL ON FUNCTION public.brd_approval_wake(), public.brd_approval_wake_trigger(), public.brd_approval_lang(uuid),
  public.brd_approval_notify(uuid, uuid, uuid, text, text, text, text, text, jsonb, text), public.brd_approval_summary(jsonb)
  FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ actions
-- Client (or admin) submits one attached version for approval. Same open version again = no-op. A different version
-- closes the open round as superseded. _no_change (admin setting) carries the last approval over: the consultants
-- are told (FYI) instead of asked again.
CREATE OR REPLACE FUNCTION public.brd_submit_for_approval(_ticket uuid, _version integer, _no_change boolean DEFAULT false, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  s jsonb := public.brd_settings();
  b public.ticket_brds;
  v public.ticket_brd_versions;
  cur public.ticket_brd_approval_requests;
  prev public.ticket_brd_approval_requests;
  _id uuid; _hash text; _n text := left(btrim(COALESCE(_note, '')), 500);
  _title text; _prev_v integer; rec record; _sent integer := 0; _no_access integer := 0;
  _days integer := GREATEST(COALESCE((s ->> 'approval_remind_days')::int, 2), 1);
  _link text := '/consultant/cases/' || _ticket::text || '/brd';
BEGIN
  IF NOT public.brd_can_write_for(_ticket, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF public.brd_approval_mode(s) = 'off' THEN RAISE EXCEPTION 'brd_approval_off' USING ERRCODE = '22023'; END IF;
  IF NOT public.check_rate_limit('brd-approval-submit:' || uid::text, 30, 3600) THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000'; END IF;
  IF public.contact_details_in_text(_n) THEN RAISE EXCEPTION 'contact_details_not_allowed' USING ERRCODE = '22023'; END IF;
  SELECT * INTO b FROM public.ticket_brds WHERE ticket_id = _ticket FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION 'brd_not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v FROM public.ticket_brd_versions WHERE brd_id = b.id AND version = _version;
  IF v.id IS NULL OR v.archived_at IS NOT NULL THEN RAISE EXCEPTION 'brd_version_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.brd_version_attached(_ticket, _version) THEN RAISE EXCEPTION 'brd_attach_first' USING ERRCODE = '22023'; END IF;
  _hash := public.brd_content_hash(v.content);

  SELECT * INTO cur FROM public.ticket_brd_approval_requests WHERE ticket_id = _ticket AND closed_at IS NULL FOR UPDATE;
  IF cur.id IS NOT NULL AND cur.version = _version AND cur.content_hash = _hash THEN
    RETURN jsonb_build_object('request_id', cur.id, 'version', cur.version, 'unchanged', true, 'notified', 0, 'waiting_access', 0);
  END IF;

  SELECT * INTO prev FROM public.ticket_brd_approval_requests
   WHERE ticket_id = _ticket AND approved_at IS NOT NULL ORDER BY submitted_at DESC LIMIT 1;
  _prev_v := prev.version;
  IF COALESCE(_no_change, false) THEN
    IF NOT COALESCE((s ->> 'approval_allow_no_change')::boolean, false) THEN RAISE EXCEPTION 'brd_no_change_not_allowed' USING ERRCODE = '22023'; END IF;
    IF prev.id IS NULL THEN RAISE EXCEPTION 'brd_no_approved_version' USING ERRCODE = '22023'; END IF;
  END IF;

  IF cur.id IS NOT NULL THEN
    UPDATE public.ticket_brd_approval_requests SET closed_at = now(), closed_reason = 'superseded', closed_by = uid WHERE id = cur.id;
    PERFORM public.brd_log_event(_ticket, b.id, uid, 'approval_superseded', cur.version, jsonb_build_object('request_id', cur.id, 'by_version', _version));
  END IF;

  INSERT INTO public.ticket_brd_approval_requests (ticket_id, brd_id, version, content_hash, version_status, previous_version,
    no_material_change, carried_from, submit_note, submitted_by, due_at, approved_at)
  VALUES (_ticket, b.id, _version, _hash, v.status, _prev_v, COALESCE(_no_change, false),
    CASE WHEN COALESCE(_no_change, false) THEN prev.id END, _n, uid, now() + make_interval(days => _days),
    CASE WHEN COALESCE(_no_change, false) THEN now() END)
  RETURNING id INTO _id;
  PERFORM public.brd_log_event(_ticket, b.id, uid, 'approval_requested', _version,
    jsonb_build_object('request_id', _id, 'hash', _hash, 'no_change', COALESCE(_no_change, false), 'note', _n));

  SELECT tk.title INTO _title FROM public.tickets tk WHERE tk.id = _ticket;
  FOR rec IN SELECT * FROM public.brd_approval_required(_ticket) LOOP
    IF NOT rec.can_read THEN _no_access := _no_access + 1; CONTINUE; END IF;
    IF COALESCE(_no_change, false) THEN
      PERFORM public.brd_approval_notify(_id, rec.user_id, _ticket, 'brd_approval_info',
        'BRD v' || _version || ' shared (no material change)',
        'BRD v' || _version || ' of "' || left(COALESCE(_title, 'your ticket'), 120) || '" has no material change; your approval of v' || _prev_v || ' still applies.',
        _link, 'fyi', jsonb_build_object('version', _version, 'previous_version', _prev_v, 'ticket_title', left(COALESCE(_title, ''), 120)),
        'fyi:' || _id || ':' || rec.user_id);
    ELSE
      PERFORM public.brd_approval_notify(_id, rec.user_id, _ticket, 'brd_approval_request',
        'Please approve BRD v' || _version,
        'BRD v' || _version || ' of "' || left(COALESCE(_title, 'your ticket'), 120) || '" is ready for your approval.',
        _link, 'request', jsonb_build_object('version', _version, 'previous_version', _prev_v, 'ticket_title', left(COALESCE(_title, ''), 120),
          'summary', public.brd_approval_summary(v.content), 'due_at', now() + make_interval(days => _days), 'note', _n),
        'request:' || _id || ':' || rec.user_id);
    END IF;
    _sent := _sent + 1;
  END LOOP;
  RETURN jsonb_build_object('request_id', _id, 'version', _version, 'unchanged', false, 'notified', _sent, 'waiting_access', _no_access,
                            'carried', COALESCE(_no_change, false));
END
$$;

-- Client (or admin) withdraws the open round ("Proceed without BRD"): nothing blocks afterwards.
CREATE OR REPLACE FUNCTION public.brd_withdraw_approval(_ticket uuid, _reason text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  r public.ticket_brd_approval_requests;
  _n text := left(btrim(COALESCE(_reason, '')), 500);
  _title text; rec record;
BEGIN
  IF NOT public.brd_can_write_for(_ticket, uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF public.contact_details_in_text(_n) THEN RAISE EXCEPTION 'contact_details_not_allowed' USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM public.ticket_brd_approval_requests WHERE ticket_id = _ticket AND closed_at IS NULL FOR UPDATE;
  IF r.id IS NULL THEN RETURN false; END IF;
  UPDATE public.ticket_brd_approval_requests SET closed_at = now(), closed_reason = 'withdrawn', closed_by = uid, close_note = NULLIF(_n, '') WHERE id = r.id;
  PERFORM public.brd_log_event(_ticket, r.brd_id, uid, 'approval_withdrawn', r.version, jsonb_build_object('request_id', r.id, 'note', _n));
  SELECT tk.title INTO _title FROM public.tickets tk WHERE tk.id = _ticket;
  FOR rec IN SELECT * FROM public.brd_approval_required(_ticket) WHERE can_read LOOP
    PERFORM public.brd_approval_notify(r.id, rec.user_id, _ticket, 'brd_approval_info',
      'BRD v' || r.version || ' approval withdrawn',
      'The client withdrew the approval request for BRD v' || r.version || ' of "' || left(COALESCE(_title, 'your ticket'), 120) || '". No approval is needed now.',
      '/consultant/cases/' || _ticket::text, NULL, NULL, 'withdrawn:' || r.id || ':' || rec.user_id);
  END LOOP;
  RETURN true;
END
$$;

-- A required approver decides on the open round. The decision binds the round's exact version and content hash.
CREATE OR REPLACE FUNCTION public.brd_decide_approval(_ticket uuid, _version integer, _decision text, _note text DEFAULT NULL, _confirm_read boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  s jsonb := public.brd_settings();
  _cons uuid;
  q record;
  r public.ticket_brd_approval_requests;
  a public.ticket_brd_approvals;
  st jsonb; _state text;
  _n text := btrim(COALESCE(_note, ''));
  _title text; _client uuid; _who text; rec record;
  _per_hour integer := GREATEST(COALESCE((s ->> 'approval_decisions_per_hour')::int, 20), 1);
  _clink text := '/client/tickets/' || _ticket::text || '/brd';
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF NOT COALESCE((s ->> 'enabled')::boolean, false) OR public.brd_approval_mode(s) = 'off' THEN RAISE EXCEPTION 'brd_approval_off' USING ERRCODE = '22023'; END IF;
  IF public.brd_role_for(_ticket, uid) IS DISTINCT FROM 'consultant' THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  _cons := public.brd_consultant_of(uid);
  SELECT * INTO q FROM public.brd_approval_required(_ticket) x WHERE x.consultant_id = _cons;
  IF q.consultant_id IS NULL THEN RAISE EXCEPTION 'brd_not_an_approver' USING ERRCODE = '42501'; END IF;
  IF _decision NOT IN ('approved', 'changes_requested', 'declined') THEN RAISE EXCEPTION 'brd_invalid_decision' USING ERRCODE = '22023'; END IF;
  IF char_length(_n) > 2000 THEN RAISE EXCEPTION 'brd_note_too_long' USING ERRCODE = '22023'; END IF;
  IF _decision <> 'approved' AND char_length(_n) < 10 THEN RAISE EXCEPTION 'brd_note_required' USING ERRCODE = '22023'; END IF;
  IF public.contact_details_in_text(_n) THEN RAISE EXCEPTION 'contact_details_not_allowed' USING ERRCODE = '22023'; END IF;
  IF _decision = 'approved' AND NOT COALESCE(_confirm_read, false) THEN RAISE EXCEPTION 'brd_confirm_read_required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO r FROM public.ticket_brd_approval_requests WHERE ticket_id = _ticket AND closed_at IS NULL FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'brd_approval_not_open' USING ERRCODE = '22023'; END IF;
  IF r.version <> _version THEN
    RAISE EXCEPTION 'brd_approval_superseded: a newer version (v%) was submitted, please review it', r.version USING ERRCODE = '40001';
  END IF;
  IF NOT public.brd_version_attached(_ticket, r.version) THEN RAISE EXCEPTION 'brd_approval_not_open' USING ERRCODE = '22023'; END IF;

  SELECT * INTO a FROM public.ticket_brd_approvals WHERE request_id = r.id AND consultant_id = _cons;
  IF a.id IS NOT NULL THEN
    IF a.decision = _decision THEN
      RETURN jsonb_build_object('unchanged', true, 'state', public.brd_round_state(r.id) ->> 'state', 'version', r.version);
    END IF;
    RAISE EXCEPTION 'brd_already_decided' USING ERRCODE = '23505';
  END IF;
  IF NOT public.check_rate_limit('brd-approval-decide:' || uid::text, _per_hour, 3600) THEN RAISE EXCEPTION 'rate_limited' USING ERRCODE = '54000'; END IF;

  INSERT INTO public.ticket_brd_approvals (request_id, ticket_id, version, content_hash, consultant_id, user_id, member_role, decision, note, confirmed_read)
  VALUES (r.id, _ticket, r.version, r.content_hash, _cons, uid, q.member_role, _decision, _n, _decision = 'approved');
  st := public.brd_round_state(r.id);
  _state := st ->> 'state';
  IF _state = 'approved' AND r.approved_at IS NULL THEN
    UPDATE public.ticket_brd_approval_requests SET approved_at = now() WHERE id = r.id;
  END IF;
  PERFORM public.brd_log_event(_ticket, r.brd_id, uid, 'approval_' || _decision, r.version,
    jsonb_build_object('request_id', r.id, 'consultant_id', _cons, 'role', q.member_role, 'note', _n, 'hash', r.content_hash));

  SELECT tk.title, tk.client_id INTO _title, _client FROM public.tickets tk WHERE tk.id = _ticket;
  _who := public.brd_person_name(uid, _cons, _client);
  IF _decision = 'approved' THEN
    IF _state = 'approved' THEN
      PERFORM public.brd_approval_notify(r.id, _client, _ticket, 'brd_approval_approved',
        'BRD v' || r.version || ' approved - work can start',
        _who || ' approved BRD v' || r.version || ' of "' || left(COALESCE(_title, 'your ticket'), 120) || '".',
        _clink, 'approved', jsonb_build_object('version', r.version, 'ticket_title', left(COALESCE(_title, ''), 120), 'who', _who, 'note', left(_n, 600)),
        'approved:' || r.id || ':' || _client);
    ELSE
      PERFORM public.brd_approval_notify(r.id, _client, _ticket, 'brd_approval_info',
        'BRD v' || r.version || ': ' || (st ->> 'approved') || ' of ' || (st ->> 'required') || ' approvals',
        _who || ' approved BRD v' || r.version || '. Waiting for the other team members.',
        _clink, NULL, NULL, 'partial:' || r.id || ':' || _cons);
    END IF;
  ELSIF _decision = 'changes_requested' THEN
    PERFORM public.brd_approval_notify(r.id, _client, _ticket, 'brd_approval_changes',
      'Changes requested on BRD v' || r.version,
      _who || ' asked for changes: ' || left(_n, 300),
      _clink, 'changes_requested', jsonb_build_object('version', r.version, 'ticket_title', left(COALESCE(_title, ''), 120), 'who', _who, 'note', left(_n, 1500)),
      'changes:' || r.id || ':' || _cons);
  ELSE
    PERFORM public.brd_approval_notify(r.id, _client, _ticket, 'brd_approval_declined',
      'BRD v' || r.version || ' declined',
      _who || ' declined BRD v' || r.version || ': ' || left(_n, 300),
      _clink, 'declined', jsonb_build_object('version', r.version, 'ticket_title', left(COALESCE(_title, ''), 120), 'who', _who, 'note', left(_n, 1500)),
      'declined:' || r.id || ':' || _cons);
    FOR rec IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role::text IN ('admin', 'super_admin') LOOP
      PERFORM public.brd_approval_notify(r.id, rec.user_id, _ticket, 'brd_approval_declined',
        'A consultant declined BRD v' || r.version,
        public.brd_person_name(uid, _cons, rec.user_id) || ' declined BRD v' || r.version || ' of ticket ' || public.brd_ref(_ticket) || ': ' || left(_n, 300),
        '/admin/tickets/' || _ticket::text, 'admin_declined',
        jsonb_build_object('version', r.version, 'ticket_title', left(COALESCE(_title, ''), 120), 'ref', public.brd_ref(_ticket),
                           'who', public.brd_person_name(uid, _cons, rec.user_id), 'note', left(_n, 1500)),
        'admin-declined:' || r.id || ':' || _cons || ':' || rec.user_id);
    END LOOP;
  END IF;
  RETURN jsonb_build_object('unchanged', false, 'state', _state, 'version', r.version, 'approved', (st ->> 'approved')::int, 'required', (st ->> 'required')::int);
END
$$;

-- Admin waiver (with reason, audited) or its revocation.
CREATE OR REPLACE FUNCTION public.admin_brd_waive_approval(_ticket uuid, _waive boolean, _reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  _r text := btrim(COALESCE(_reason, ''));
  w public.ticket_brd_approval_waivers;
  _brd uuid; _client uuid; _title text; rec record; _req uuid;
BEGIN
  IF NOT public.brd_is_admin(uid) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  IF char_length(_r) < 5 OR char_length(_r) > 500 THEN RAISE EXCEPTION 'brd_reason_required' USING ERRCODE = '22023'; END IF;
  SELECT tk.client_id, tk.title INTO _client, _title FROM public.tickets tk WHERE tk.id = _ticket;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT id INTO _brd FROM public.ticket_brds WHERE ticket_id = _ticket;
  SELECT * INTO w FROM public.ticket_brd_approval_waivers WHERE ticket_id = _ticket AND revoked_at IS NULL FOR UPDATE;
  IF COALESCE(_waive, false) THEN
    IF w.id IS NOT NULL THEN RETURN false; END IF;
    INSERT INTO public.ticket_brd_approval_waivers (ticket_id, admin_id, reason) VALUES (_ticket, uid, _r) RETURNING * INTO w;
  ELSE
    IF w.id IS NULL THEN RETURN false; END IF;
    UPDATE public.ticket_brd_approval_waivers SET revoked_at = now(), revoked_by = uid, revoke_reason = _r WHERE id = w.id;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (uid, CASE WHEN _waive THEN 'brd_approval_waived' ELSE 'brd_approval_waiver_revoked' END, 'tickets', _ticket,
          jsonb_build_object('waiver_id', w.id, 'reason', _r));
  PERFORM public.brd_log_event(_ticket, _brd, uid, CASE WHEN _waive THEN 'approval_waived' ELSE 'approval_waiver_revoked' END, NULL,
                               jsonb_build_object('waiver_id', w.id));
  SELECT id INTO _req FROM public.ticket_brd_approval_requests WHERE ticket_id = _ticket ORDER BY submitted_at DESC LIMIT 1;
  IF _req IS NOT NULL AND _waive THEN
    PERFORM public.brd_approval_notify(_req, _client, _ticket, 'brd_approval_info', 'BRD approval waived by an administrator',
      'Work on "' || left(COALESCE(_title, 'your ticket'), 120) || '" may start without an approved BRD.', '/client/tickets/' || _ticket::text,
      NULL, NULL, 'waived:' || w.id || ':' || _client);
    FOR rec IN SELECT * FROM public.brd_approval_required(_ticket) LOOP
      PERFORM public.brd_approval_notify(_req, rec.user_id, _ticket, 'brd_approval_info', 'BRD approval waived by an administrator',
        'Work on "' || left(COALESCE(_title, 'your ticket'), 120) || '" may start without an approved BRD.', '/consultant/cases/' || _ticket::text,
        NULL, NULL, 'waived:' || w.id || ':' || rec.user_id);
    END LOOP;
  END IF;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.brd_submit_for_approval(uuid, integer, boolean, text), public.brd_withdraw_approval(uuid, text),
  public.brd_decide_approval(uuid, integer, text, text, boolean), public.admin_brd_waive_approval(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brd_submit_for_approval(uuid, integer, boolean, text), public.brd_withdraw_approval(uuid, text),
  public.brd_decide_approval(uuid, integer, text, text, boolean), public.admin_brd_waive_approval(uuid, boolean, text) TO authenticated;

-- ------------------------------------------------------------------------------------------------ reads
-- Everything the approval panel needs for the signed-in person. Consultants see rounds of attached versions and
-- their own decisions; company colleagues read only. Waiver reasons are shown to admins only.
CREATE OR REPLACE FUNCTION public.brd_approval_get(_ticket uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  _role text := public.brd_role_for(_ticket, uid);
  s jsonb := public.brd_settings();
  _cons uuid; _gate jsonb; _rounds jsonb; _req jsonb; _open public.ticket_brd_approval_requests; _me jsonb; _w jsonb;
  _is_appr boolean := false; _can_read boolean := false; _mine text;
BEGIN
  IF _role IS NULL THEN RETURN jsonb_build_object('role', NULL); END IF;
  IF NOT COALESCE((s ->> 'enabled')::boolean, false) AND _role <> 'admin' THEN RETURN jsonb_build_object('role', _role, 'enabled', false); END IF;
  IF _role = 'consultant' THEN _cons := public.brd_consultant_of(uid); END IF;
  _gate := public.brd_gate_state(_ticket, _cons);
  SELECT * INTO _open FROM public.ticket_brd_approval_requests WHERE ticket_id = _ticket AND closed_at IS NULL;

  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.at DESC), '[]'::jsonb) INTO _rounds FROM (
    SELECT q.submitted_at AS at, jsonb_build_object(
      'id', q.id, 'version', q.version, 'state', public.brd_round_state(q.id) ->> 'state', 'hash', q.content_hash,
      'version_status', q.version_status, 'submitted_at', q.submitted_at, 'submitted_by', public.brd_person_name(q.submitted_by, NULL, uid),
      'due_at', q.due_at, 'approved_at', q.approved_at, 'closed_at', q.closed_at, 'closed_reason', q.closed_reason, 'close_note', q.close_note,
      'no_material_change', q.no_material_change, 'previous_version', q.previous_version, 'submit_note', NULLIF(q.submit_note, ''),
      'decisions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'who', public.brd_person_name(a.user_id, a.consultant_id, uid), 'role', a.member_role, 'decision', a.decision,
          'note', NULLIF(a.note, ''), 'at', a.created_at, 'mine', a.user_id = uid, 'hash', a.content_hash) ORDER BY a.created_at)
        FROM public.ticket_brd_approvals a WHERE a.request_id = q.id), '[]'::jsonb)) AS j
      FROM public.ticket_brd_approval_requests q
     WHERE q.ticket_id = _ticket
       AND (_role <> 'consultant' OR public.brd_version_attached(_ticket, q.version)
            OR EXISTS (SELECT 1 FROM public.ticket_brd_approvals a WHERE a.request_id = q.id AND a.user_id = uid))
     ORDER BY q.submitted_at DESC LIMIT 30) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'who', public.brd_person_name(x.user_id, x.consultant_id, uid), 'role', x.member_role, 'can_read', x.can_read, 'mine', x.user_id = uid,
      'decision', (SELECT a.decision FROM public.ticket_brd_approvals a WHERE a.request_id = _open.id AND a.consultant_id = x.consultant_id))
      ORDER BY (x.member_role = 'lead') DESC), '[]'::jsonb)
    INTO _req FROM public.brd_approval_required(_ticket) x;

  IF _cons IS NOT NULL THEN
    SELECT true, x.can_read INTO _is_appr, _can_read FROM public.brd_approval_required(_ticket) x WHERE x.consultant_id = _cons;
    SELECT a.decision INTO _mine FROM public.ticket_brd_approvals a WHERE a.request_id = _open.id AND a.consultant_id = _cons;
  END IF;
  _me := jsonb_build_object('is_approver', COALESCE(_is_appr, false),
    'can_decide', COALESCE(_is_appr, false) AND COALESCE(_can_read, false) AND _open.id IS NOT NULL AND _mine IS NULL
                  AND COALESCE((s ->> 'enabled')::boolean, false) AND public.brd_approval_mode(s) <> 'off',
    'decision', _mine, 'can_submit', public.brd_can_write_for(_ticket, uid) AND public.brd_approval_mode(s) <> 'off',
    'can_waive', _role = 'admin');

  SELECT jsonb_build_object('active', true, 'at', w.created_at,
           'reason', CASE WHEN _role = 'admin' THEN w.reason END, 'by', CASE WHEN _role = 'admin' THEN public.brd_person_name(w.admin_id, NULL, uid) END)
    INTO _w FROM public.ticket_brd_approval_waivers w WHERE w.ticket_id = _ticket AND w.revoked_at IS NULL;

  RETURN jsonb_build_object('role', _role, 'enabled', COALESCE((s ->> 'enabled')::boolean, false), 'gate', _gate, 'rounds', _rounds,
    'required', _req, 'me', _me, 'waiver', COALESCE(_w, jsonb_build_object('active', false)),
    'settings', jsonb_build_object('mode', public.brd_approval_mode(s), 'all_members', COALESCE((s ->> 'approval_all_members')::boolean, false),
      'allow_no_change', COALESCE((s ->> 'approval_allow_no_change')::boolean, false), 'remind_days', COALESCE((s ->> 'approval_remind_days')::int, 2)));
END
$$;

-- Ticket lists: approval state per ticket the caller may read (max 300 ids); needs_me = I must decide.
CREATE OR REPLACE FUNCTION public.brd_approval_list(_tickets uuid[])
RETURNS TABLE (ticket_id uuid, state text, version integer, mode text, blocks boolean, needs_me boolean, waiting_consultant boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE uid uuid := auth.uid(); s jsonb := public.brd_settings(); _cons uuid; _t uuid; _role text; g jsonb; _open uuid;
BEGIN
  IF uid IS NULL OR _tickets IS NULL OR NOT COALESCE((s ->> 'enabled')::boolean, false) OR public.brd_approval_mode(s) = 'off' THEN RETURN; END IF;
  _cons := public.brd_consultant_of(uid);
  FOREACH _t IN ARRAY (SELECT array_agg(DISTINCT x) FROM unnest(_tickets[1:300]) x) LOOP
    _role := public.brd_role_for(_t, uid);
    CONTINUE WHEN _role IS NULL;
    SELECT q.id INTO _open FROM public.ticket_brd_approval_requests q WHERE q.ticket_id = _t AND q.closed_at IS NULL;
    CONTINUE WHEN _open IS NULL AND NOT EXISTS (SELECT 1 FROM public.ticket_brd_approval_requests q WHERE q.ticket_id = _t);
    g := public.brd_gate_state(_t, CASE WHEN _role = 'consultant' THEN _cons END);
    ticket_id := _t; state := g ->> 'state'; version := (g ->> 'version')::int; mode := g ->> 'mode'; blocks := (g ->> 'blocks')::boolean;
    needs_me := _role = 'consultant' AND _open IS NOT NULL AND g ->> 'state' = 'pending'
                AND EXISTS (SELECT 1 FROM public.brd_approval_required(_t) x WHERE x.consultant_id = _cons AND x.can_read)
                AND NOT EXISTS (SELECT 1 FROM public.ticket_brd_approvals a WHERE a.request_id = _open AND a.consultant_id = _cons);
    waiting_consultant := _open IS NOT NULL AND g ->> 'state' = 'pending';
    RETURN NEXT;
  END LOOP;
END
$$;

-- Admin overview counts for the settings card.
CREATE OR REPLACE FUNCTION public.admin_brd_approval_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.brd_is_admin(auth.uid()) THEN RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'open', (SELECT count(*) FROM public.ticket_brd_approval_requests WHERE closed_at IS NULL),
    'approved_30d', (SELECT count(*) FROM public.ticket_brd_approval_requests WHERE approved_at > now() - interval '30 days'),
    'declined_30d', (SELECT count(*) FROM public.ticket_brd_approvals WHERE decision = 'declined' AND created_at > now() - interval '30 days'),
    'changes_30d', (SELECT count(*) FROM public.ticket_brd_approvals WHERE decision = 'changes_requested' AND created_at > now() - interval '30 days'),
    'overdue', (SELECT count(*) FROM public.ticket_brd_approval_requests WHERE closed_at IS NULL AND approved_at IS NULL AND due_at < now()),
    'waivers', (SELECT count(*) FROM public.ticket_brd_approval_waivers WHERE revoked_at IS NULL));
END
$$;

REVOKE ALL ON FUNCTION public.brd_approval_get(uuid), public.brd_approval_list(uuid[]), public.admin_brd_approval_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.brd_approval_get(uuid), public.brd_approval_list(uuid[]), public.admin_brd_approval_overview() TO authenticated;

-- ------------------------------------------------------------------------------------------------ team gate (combined bodies)
-- Gate state of one member, read from the source tables.
CREATE OR REPLACE FUNCTION public.team_gates(_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ticket uuid; _cons uuid; _client uuid;
  _match_acc boolean; _bid_pending boolean; _bid_acc boolean;
  _rate_id uuid; _rate_proposed boolean;
  _nda_id uuid; _nda_cons timestamptz; _nda_client timestamptz;
  _conf_id uuid; _conf_rate uuid; _conf_c timestamptz; _conf_k timestamptz;
  _brd jsonb;
BEGIN
  SELECT m.ticket_id, m.consultant_id, t.client_id INTO _ticket, _cons, _client
    FROM public.ticket_team_members m JOIN public.tickets t ON t.id = m.ticket_id WHERE m.id = _member_id;
  IF _ticket IS NULL THEN RETURN NULL; END IF;

  _match_acc := EXISTS (SELECT 1 FROM public.ticket_match_requests r
                        WHERE r.ticket_id = _ticket AND r.consultant_id = _cons AND r.status::text = 'accepted');
  _bid_pending := EXISTS (SELECT 1 FROM public.proposals p
                          WHERE p.ticket_id = _ticket AND p.consultant_id = _cons AND p.status::text = 'pending');
  _bid_acc := EXISTS (SELECT 1 FROM public.proposals p
                      WHERE p.ticket_id = _ticket AND p.consultant_id = _cons AND p.status::text = 'accepted');

  SELECT r.id INTO _rate_id FROM public.ticket_rates r
   WHERE r.ticket_id = _ticket AND r.consultant_id = _cons AND r.status = 'approved' LIMIT 1;
  _rate_proposed := EXISTS (SELECT 1 FROM public.ticket_rates r
                            WHERE r.ticket_id = _ticket AND r.consultant_id = _cons AND r.status = 'proposed');

  SELECT n.id, n.signed_at, n.client_signed_at INTO _nda_id, _nda_cons, _nda_client
    FROM public.nda_agreements n
   WHERE n.consultant_id = _cons AND n.client_id = _client AND n.revoked_at IS NULL
   ORDER BY n.created_at DESC LIMIT 1;

  SELECT c.id, c.rate_id, c.consultant_confirmed_at, c.client_confirmed_at INTO _conf_id, _conf_rate, _conf_c, _conf_k
    FROM public.engagement_confirmations c WHERE c.member_id = _member_id AND c.superseded_at IS NULL;

  -- BRD approval gate (docs/sql/ticket-brd-approval.sql; a no-op stub before that file is applied).
  _brd := public.team_brd_gate(_ticket, _cons);

  RETURN jsonb_build_object(
    'accepted', _match_acc OR _bid_pending OR _bid_acc,
    'bid_pending', _bid_pending,
    'bid_accepted', _bid_acc,
    'rate', _rate_id IS NOT NULL,
    'rate_id', _rate_id,
    'rate_proposed', _rate_proposed,
    'nda', _nda_id IS NOT NULL AND _nda_cons IS NOT NULL AND _nda_client IS NOT NULL,
    'nda_state', CASE WHEN _nda_id IS NULL THEN 'none' WHEN _nda_client IS NULL THEN 'consultant_signed' ELSE 'signed' END,
    'brd_blocks', COALESCE((_brd ->> 'blocks')::boolean, false),
    'brd_state', _brd ->> 'state',
    'confirmation_id', _conf_id,
    'consultant_confirmed', _conf_c IS NOT NULL,
    'client_confirmed', _conf_k IS NOT NULL,
    'confirmed', _conf_id IS NOT NULL AND _conf_c IS NOT NULL AND _conf_k IS NOT NULL
                 AND _rate_id IS NOT NULL AND _conf_rate IS NOT DISTINCT FROM _rate_id);
END $$;

-- Who must act next, and which step (codes are translated by the app).
CREATE OR REPLACE FUNCTION public.team_next_step(_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _status text; _mode text; g jsonb;
BEGIN
  SELECT m.status, m.engagement_mode INTO _status, _mode FROM public.ticket_team_members m WHERE m.id = _member_id;
  IF _status IS NULL OR NOT public.team_pre_ready(_status) THEN
    RETURN jsonb_build_object('actor', 'none', 'step', CASE WHEN _status IN ('ready', 'active') THEN 'ready' ELSE 'ended' END);
  END IF;
  g := public.team_gates(_member_id);
  IF NOT (g ->> 'accepted')::boolean THEN
    RETURN jsonb_build_object('actor', 'consultant', 'step', CASE WHEN _mode = 'bid' THEN 'send_bid' ELSE 'respond' END);
  ELSIF NOT (g ->> 'rate')::boolean THEN
    IF (g ->> 'bid_pending')::boolean THEN RETURN jsonb_build_object('actor', 'client', 'step', 'choose_bid'); END IF;
    IF (g ->> 'rate_proposed')::boolean THEN RETURN jsonb_build_object('actor', 'client', 'step', 'approve_rate'); END IF;
    RETURN jsonb_build_object('actor', 'consultant', 'step', 'propose_rate');
  ELSIF NOT (g ->> 'nda')::boolean THEN
    IF g ->> 'nda_state' = 'consultant_signed' THEN RETURN jsonb_build_object('actor', 'client', 'step', 'sign_nda'); END IF;
    RETURN jsonb_build_object('actor', 'consultant', 'step', 'sign_nda');
  ELSIF COALESCE((g ->> 'brd_blocks')::boolean, false) THEN
    IF g ->> 'brd_state' IN ('changes_requested', 'rejected') THEN RETURN jsonb_build_object('actor', 'client', 'step', 'update_brd'); END IF;
    RETURN jsonb_build_object('actor', 'consultant', 'step', 'approve_brd');
  ELSIF g ->> 'confirmation_id' IS NULL THEN
    RETURN jsonb_build_object('actor', 'client', 'step', 'prepare_confirmation');
  ELSIF NOT (g ->> 'consultant_confirmed')::boolean THEN
    RETURN jsonb_build_object('actor', 'consultant', 'step', 'confirm');
  ELSIF NOT (g ->> 'client_confirmed')::boolean THEN
    RETURN jsonb_build_object('actor', 'client', 'step', 'confirm');
  END IF;
  RETURN jsonb_build_object('actor', 'none', 'step', 'ready');
END $$;

CREATE OR REPLACE FUNCTION public.team_step_text(_step text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _step
    WHEN 'respond' THEN 'accept or decline the invitation and confirm your hourly rate and availability'
    WHEN 'send_bid' THEN 'send your bid'
    WHEN 'choose_bid' THEN 'review and choose the bid'
    WHEN 'propose_rate' THEN 'propose an hourly rate'
    WHEN 'approve_rate' THEN 'approve or decline the proposed hourly rate'
    WHEN 'sign_nda' THEN 'sign the NDA'
    WHEN 'approve_brd' THEN 'review and approve the BRD'
    WHEN 'update_brd' THEN 'update the BRD and submit it again'
    WHEN 'prepare_confirmation' THEN 'prepare the engagement confirmation'
    WHEN 'confirm' THEN 'confirm the engagement summary'
    ELSE 'review the request' END
$$;

-- ------------------------------------------------------------------------------------------------ tracking (combined bodies)
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

-- ------------------------------------------------------------------------------------------------ enforcement
-- Mode 'required' only (brd_gate_blocks): no engagement confirmation, work log or timesheet submission while the
-- open BRD round is not approved. System jobs (no signed-in caller) and admins are not stopped.
CREATE OR REPLACE FUNCTION public.brd_gate_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cons uuid; _check boolean := false;
BEGIN
  IF auth.uid() IS NULL OR public.brd_is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'engagement_confirmations' THEN
    _check := NEW.superseded_at IS NULL AND (TG_OP = 'INSERT'
              OR (OLD.consultant_confirmed_at IS NULL AND NEW.consultant_confirmed_at IS NOT NULL)
              OR (OLD.client_confirmed_at IS NULL AND NEW.client_confirmed_at IS NOT NULL));
    _cons := NEW.consultant_id;
  ELSIF TG_TABLE_NAME = 'ticket_work_logs' THEN
    _check := true; _cons := NEW.consultant_id;
  ELSIF TG_TABLE_NAME = 'ticket_timesheet_submissions' THEN
    _check := NEW.status = 'submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'submitted');
    _cons := public.brd_consultant_of(NEW.submitted_by);
  END IF;
  IF _check AND public.brd_gate_blocks(NEW.ticket_id, _cons) THEN
    RAISE EXCEPTION 'Waiting for BRD approval: the assigned consultant must approve the latest BRD before work can start.'
      USING ERRCODE = 'P0001', HINT = 'brd_approval_required';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.brd_gate_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS brd_gate_guard ON public.engagement_confirmations;
CREATE TRIGGER brd_gate_guard BEFORE INSERT OR UPDATE ON public.engagement_confirmations FOR EACH ROW EXECUTE FUNCTION public.brd_gate_guard();
DROP TRIGGER IF EXISTS brd_gate_guard ON public.ticket_work_logs;
CREATE TRIGGER brd_gate_guard BEFORE INSERT ON public.ticket_work_logs FOR EACH ROW EXECUTE FUNCTION public.brd_gate_guard();
DROP TRIGGER IF EXISTS brd_gate_guard ON public.ticket_timesheet_submissions;
CREATE TRIGGER brd_gate_guard BEFORE INSERT OR UPDATE OF status ON public.ticket_timesheet_submissions FOR EACH ROW EXECUTE FUNCTION public.brd_gate_guard();

-- Unattaching the version of the open round closes that round as withdrawn (consultants can no longer read it).
CREATE OR REPLACE FUNCTION public.brd_approval_on_unattach()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ticket_brd_approval_requests;
BEGIN
  IF NEW.doc_type IS DISTINCT FROM 'brd' OR OLD.unattached_at IS NOT NULL OR NEW.unattached_at IS NULL THEN RETURN NULL; END IF;
  IF public.brd_version_attached(NEW.ticket_id, NEW.brd_version) THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.ticket_brd_approval_requests WHERE ticket_id = NEW.ticket_id AND closed_at IS NULL AND version = NEW.brd_version FOR UPDATE;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.ticket_brd_approval_requests SET closed_at = now(), closed_reason = 'withdrawn', closed_by = auth.uid(), close_note = 'unattached' WHERE id = r.id;
  PERFORM public.brd_log_event(NEW.ticket_id, r.brd_id, auth.uid(), 'approval_withdrawn', r.version, jsonb_build_object('request_id', r.id, 'note', ''));
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.brd_approval_on_unattach() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS brd_approval_on_unattach ON public.ticket_documents;
CREATE TRIGGER brd_approval_on_unattach AFTER UPDATE OF unattached_at ON public.ticket_documents
  FOR EACH ROW EXECUTE FUNCTION public.brd_approval_on_unattach();

-- ------------------------------------------------------------------------------------------------ e-mail worker RPCs
CREATE OR REPLACE FUNCTION public.brd_approval_claim_emails(_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, user_id uuid, ticket_id uuid, kind text, payload jsonb, dedupe_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  -- Rows for people who can no longer open the ticket, or while the feature is off, are dropped (not sent later).
  UPDATE public.ticket_brd_approval_email_queue q SET failed_at = now(), last_error = 'not_applicable'
   WHERE q.sent_at IS NULL AND q.failed_at IS NULL
     AND (NOT COALESCE((public.brd_settings() ->> 'enabled')::boolean, false)
          OR public.brd_role_for(q.ticket_id, q.user_id) IS NULL);
  RETURN QUERY
  UPDATE public.ticket_brd_approval_email_queue q SET attempts = q.attempts + 1, lease_until = now() + interval '10 minutes'
   WHERE q.id IN (SELECT q2.id FROM public.ticket_brd_approval_email_queue q2
                   WHERE q2.sent_at IS NULL AND q2.failed_at IS NULL AND q2.attempts < 5
                     AND (q2.lease_until IS NULL OR q2.lease_until < now())
                   ORDER BY q2.created_at LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
                   FOR UPDATE SKIP LOCKED)
  RETURNING q.id, q.user_id, q.ticket_id, q.kind, q.payload, q.dedupe_key;
END
$$;

CREATE OR REPLACE FUNCTION public.brd_approval_finish_email(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.ticket_brd_approval_email_queue SET
    sent_at = CASE WHEN _ok THEN now() END,
    failed_at = CASE WHEN NOT _ok AND attempts >= 5 THEN now() END,
    last_error = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error, 'failed'), 200) END,
    lease_until = NULL
   WHERE id = _id
$$;

-- What changed since the previous approved version (section keys only): the worker compares the two contents.
CREATE OR REPLACE FUNCTION public.brd_approval_email_contents(_ticket uuid, _version integer, _previous integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'current', (SELECT v.content FROM public.ticket_brd_versions v WHERE v.ticket_id = _ticket AND v.version = _version LIMIT 1),
    'previous', (SELECT v.content FROM public.ticket_brd_versions v WHERE v.ticket_id = _ticket AND v.version = _previous LIMIT 1))
$$;

REVOKE ALL ON FUNCTION public.brd_approval_claim_emails(integer), public.brd_approval_finish_email(uuid, boolean, text),
  public.brd_approval_email_contents(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.brd_approval_claim_emails(integer), public.brd_approval_finish_email(uuid, boolean, text),
  public.brd_approval_email_contents(uuid, integer, integer) TO service_role;

-- ------------------------------------------------------------------------------------------------ daily reminders
-- Pending rounds: reminder to each approver who has not decided every approval_remind_days (max
-- approval_max_reminders), one "still waiting" notice to the client after approval_client_days, one escalation to
-- administrators after approval_escalate_days. Bounded to 500 rounds; closed tickets are skipped.
CREATE OR REPLACE FUNCTION public.brd_approval_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s jsonb := public.brd_settings();
  _remind int := GREATEST(COALESCE((s ->> 'approval_remind_days')::int, 2), 1);
  _client_d int := GREATEST(COALESCE((s ->> 'approval_client_days')::int, 3), 1);
  _esc int := GREATEST(COALESCE((s ->> 'approval_escalate_days')::int, 5), 1);
  _max int := GREATEST(COALESCE((s ->> 'approval_max_reminders')::int, 5), 0);
  r record; a record; ad record; _days int; _n int := 0; _sent int; _title text; _client uuid;
BEGIN
  IF NOT COALESCE((s ->> 'enabled')::boolean, false) OR public.brd_approval_mode(s) = 'off' THEN RETURN 0; END IF;
  FOR r IN SELECT q.* FROM public.ticket_brd_approval_requests q JOIN public.tickets t ON t.id = q.ticket_id
            WHERE q.closed_at IS NULL AND q.approved_at IS NULL AND t.status::text NOT IN ('closed', 'resolved')
            ORDER BY q.submitted_at LIMIT 500 LOOP
    BEGIN
      CONTINUE WHEN public.brd_round_state(r.id) ->> 'state' <> 'pending';
      _days := floor(extract(epoch FROM now() - r.submitted_at) / 86400)::int;
      CONTINUE WHEN _days < _remind;
      SELECT tk.title, tk.client_id INTO _title, _client FROM public.tickets tk WHERE tk.id = r.ticket_id;
      FOR a IN SELECT x.* FROM public.brd_approval_required(r.ticket_id) x
                WHERE x.can_read AND NOT EXISTS (SELECT 1 FROM public.ticket_brd_approvals d WHERE d.request_id = r.id AND d.consultant_id = x.consultant_id) LOOP
        SELECT count(*) INTO _sent FROM public.ticket_brd_approval_notices n WHERE n.request_id = r.id AND n.user_id = a.user_id AND n.kind = 'brd_approval_reminder';
        CONTINUE WHEN _sent >= _max OR _days % _remind <> 0;
        IF public.brd_approval_notify(r.id, a.user_id, r.ticket_id, 'brd_approval_reminder',
             'Reminder: please approve BRD v' || r.version,
             'BRD v' || r.version || ' of "' || left(COALESCE(_title, 'your ticket'), 120) || '" has waited ' || _days || ' days for your approval.',
             '/consultant/cases/' || r.ticket_id::text || '/brd', 'reminder',
             jsonb_build_object('version', r.version, 'previous_version', r.previous_version, 'ticket_title', left(COALESCE(_title, ''), 120), 'days', _days, 'due_at', r.due_at),
             'remind:' || r.id || ':' || a.user_id || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')) THEN
          _n := _n + 1;
        END IF;
      END LOOP;
      IF _days >= _client_d AND r.client_noticed_at IS NULL THEN
        PERFORM public.brd_approval_notify(r.id, _client, r.ticket_id, 'brd_approval_waiting',
          'Still waiting for BRD v' || r.version || ' approval',
          'The consultant has not yet approved BRD v' || r.version || ' of "' || left(COALESCE(_title, 'your ticket'), 120) || '" (' || _days || ' days).',
          '/client/tickets/' || r.ticket_id::text || '/brd', 'client_waiting',
          jsonb_build_object('version', r.version, 'ticket_title', left(COALESCE(_title, ''), 120), 'days', _days),
          'client-waiting:' || r.id);
        UPDATE public.ticket_brd_approval_requests SET client_noticed_at = now() WHERE id = r.id;
        _n := _n + 1;
      END IF;
      IF _days >= _esc AND r.escalated_at IS NULL THEN
        FOR ad IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role::text IN ('admin', 'super_admin') LOOP
          PERFORM public.brd_approval_notify(r.id, ad.user_id, r.ticket_id, 'brd_approval_escalated',
            'BRD approval overdue on ticket ' || public.brd_ref(r.ticket_id),
            'BRD v' || r.version || ' has waited ' || _days || ' days for consultant approval.',
            '/admin/tickets/' || r.ticket_id::text, 'admin_escalation',
            jsonb_build_object('version', r.version, 'ticket_title', left(COALESCE(_title, ''), 120), 'ref', public.brd_ref(r.ticket_id), 'days', _days),
            'escalate:' || r.id || ':' || ad.user_id);
        END LOOP;
        UPDATE public.ticket_brd_approval_requests SET escalated_at = now() WHERE id = r.id;
        _n := _n + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'BRD approval reminder skipped for %: %', r.ticket_id, SQLERRM;
    END;
  END LOOP;
  RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.brd_approval_sweep() FROM PUBLIC, anon, authenticated;

DO $do$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.unschedule(j.jobid) FROM cron.job j WHERE j.jobname = 'brd-approval-reminders';
    PERFORM cron.schedule('brd-approval-reminders', '27 7 * * *', 'SELECT public.brd_approval_sweep()');
  END IF;
END
$do$;
