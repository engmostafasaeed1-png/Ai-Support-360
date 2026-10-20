-- =============================================================================
-- Feature I — Team engagement: four gates before any consultant starts work.
-- PREPARED ONLY. NOT APPLIED BY THE ASSISTANT. Apply once, as a whole.
--
-- Safe for live data (additive):
--   * No table, column or row is dropped, renamed or retyped.
--   * Existing tables stay the source of truth: ticket_match_requests (invite /
--     accept), proposals (bids, counter-offers), ticket_rates (hourly rate incl.
--     the critical surcharge), nda_agreements (one NDA per consultant and client,
--     signed by both). The new team rows only mirror their progress.
--   * "Assigned" keeps its current meaning: an active ticket_assignments row
--     and/or tickets.consultant_id. On gated tickets these are written ONLY by
--     team_activate() after all four gates pass, so every existing access rule
--     (files, remote access, chat, contact details, timesheets) follows the gates
--     without being rewritten. M60 contact-bypass checks are untouched and every
--     new free-text field goes through contact_details_in_text().
--   * Consultants already working on tickets are copied in as legacy/active, so
--     running work is never blocked.
--   * Gates apply only to tickets that have at least one non-legacy team member,
--     i.e. tickets where the client used the new team flow.
--   * Kill switch: platform setting team_engagement.enabled (default true).
--   * Clients AND administrators invite/remove several consultants per ticket through the same
--     team_* functions and four gates; administrator changes are written to audit_logs.
--   * Sections 15-16: consultant-initiated team requests (max team size, 3 open per consultant per
--     ticket, one per 24 h, 7-day block after a decline) and a shared team thread.
--
-- The four gates per consultant:
--   1 accepted  : consultant accepted the invitation, or sent a bid
--   2 rate      : the client approved the hourly rate (critical +30 % included)
--   3 nda       : an active NDA between consultant and client, signed by both
--   4 confirmed : the current engagement confirmation is confirmed by both and
--                 still matches the approved rate
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Settings (admin-editable row; defaults also live in team_settings()).
-- -----------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value)
VALUES ('team_engagement', '{"enabled":true,"response_hours":24,"critical_response_minutes":30,"removal_notice_hours":48,"nudge_hours":24,"reinvite_after_decline_days":7,"max_team_size":5,"team_request_max_pending":3,"team_request_cooldown_hours":24,"team_request_redecline_days":7,"team_chat_per_minute":20}'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.team_settings()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT '{"enabled":true,"response_hours":24,"critical_response_minutes":30,"removal_notice_hours":48,"nudge_hours":24,"reinvite_after_decline_days":7,"max_team_size":5,"team_request_max_pending":3,"team_request_cooldown_hours":24,"team_request_redecline_days":7,"team_chat_per_minute":20}'::jsonb
      || COALESCE((SELECT CASE WHEN jsonb_typeof(s.value) = 'object' THEN s.value END
                     FROM public.platform_settings s WHERE s.key = 'team_engagement'), '{}'::jsonb)
$$;
REVOKE ALL ON FUNCTION public.team_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_settings() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Tables
-- -----------------------------------------------------------------------------
CREATE TABLE public.ticket_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  engagement_mode text NOT NULL DEFAULT 'normal' CHECK (engagement_mode IN ('normal', 'bid')),
  team_role text NOT NULL DEFAULT 'support' CHECK (team_role IN ('lead', 'support')),
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'selected' CHECK (status IN (
    'selected', 'invited', 'viewed', 'accepted', 'bid_sent', 'rate_approved', 'nda_signed', 'ready', 'active',
    'declined', 'expired', 'withdrawn', 'not_selected', 'removed', 'replaced')),
  is_legacy boolean NOT NULL DEFAULT false,
  invite_message text CHECK (invite_message IS NULL OR char_length(invite_message) <= 2000),
  availability_note text CHECK (availability_note IS NULL OR char_length(availability_note) <= 500),
  end_reason text CHECK (end_reason IS NULL OR char_length(end_reason) <= 500),
  blocked_reason text CHECK (blocked_reason IS NULL OR blocked_reason IN ('nda_revoked')),
  match_request_id uuid REFERENCES public.ticket_match_requests(id) ON DELETE SET NULL,
  proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  replaced_by uuid REFERENCES public.ticket_team_members(id) ON DELETE SET NULL,
  invited_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  bid_sent_at timestamptz,
  rate_approved_at timestamptz,
  nda_signed_at timestamptz,
  confirmed_at timestamptz,
  ready_at timestamptz,
  declined_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz,
  suggest_next boolean NOT NULL DEFAULT false,
  notice_until timestamptz,
  pending_end_status text CHECK (pending_end_status IS NULL OR pending_end_status IN ('removed', 'replaced')),
  end_requested_by uuid,
  client_nudged_at timestamptz,
  consultant_nudged_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ticket_team_members IS 'Feature I: one row per consultant engagement on a ticket; status mirrors match requests, bids, rates, NDAs and engagement confirmations. Written only by team_* functions.';

-- one live engagement per consultant and ticket; one primary per ticket
CREATE UNIQUE INDEX ticket_team_members_one_live ON public.ticket_team_members (ticket_id, consultant_id)
  WHERE status IN ('selected', 'invited', 'viewed', 'accepted', 'bid_sent', 'rate_approved', 'nda_signed', 'ready', 'active');
CREATE UNIQUE INDEX ticket_team_members_one_primary ON public.ticket_team_members (ticket_id)
  WHERE is_primary AND status IN ('selected', 'invited', 'viewed', 'accepted', 'bid_sent', 'rate_approved', 'nda_signed', 'ready', 'active');
CREATE INDEX ticket_team_members_consultant_idx ON public.ticket_team_members (consultant_id, status);
CREATE INDEX ticket_team_members_expiry_idx ON public.ticket_team_members (expires_at) WHERE status IN ('invited', 'viewed');
CREATE INDEX ticket_team_members_notice_idx ON public.ticket_team_members (notice_until) WHERE notice_until IS NOT NULL;

CREATE TABLE public.ticket_team_member_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.ticket_team_members(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL,
  consultant_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid,
  actor_role text NOT NULL CHECK (actor_role IN ('client', 'consultant', 'admin', 'system')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ticket_team_member_events IS 'Feature I: append-only status history of team members.';
CREATE INDEX ticket_team_member_events_member_idx ON public.ticket_team_member_events (member_id, created_at);
CREATE INDEX ticket_team_member_events_ticket_idx ON public.ticket_team_member_events (ticket_id, created_at);

CREATE TABLE public.engagement_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.ticket_team_members(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL,
  consultant_id uuid NOT NULL,
  client_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  scope_summary text NOT NULL CHECK (char_length(scope_summary) BETWEEN 10 AND 4000),
  rate_id uuid REFERENCES public.ticket_rates(id) ON DELETE SET NULL,
  hourly_rate numeric NOT NULL CHECK (hourly_rate > 0),
  currency text NOT NULL,
  base_rate numeric,
  surcharge_percent numeric,
  estimated_hours numeric CHECK (estimated_hours IS NULL OR (estimated_hours > 0 AND estimated_hours <= 10000)),
  start_date date NOT NULL,
  response_commitment text NOT NULL CHECK (char_length(response_commitment) BETWEEN 3 AND 500),
  prepared_by uuid,
  consultant_confirmed_at timestamptz,
  client_confirmed_at timestamptz,
  superseded_at timestamptz,
  superseded_reason text CHECK (superseded_reason IS NULL OR superseded_reason IN ('revised', 'rate_changed', 'ticket_edited', 'member_ended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, version)
);
COMMENT ON TABLE public.engagement_confirmations IS 'Feature I: engagement summary (scope, rate, optional hours, start date, response commitment) that both sides confirm before work starts. Versioned; never edited after confirmation.';
CREATE UNIQUE INDEX engagement_confirmations_one_open ON public.engagement_confirmations (member_id) WHERE superseded_at IS NULL;
CREATE INDEX engagement_confirmations_ticket_idx ON public.engagement_confirmations (ticket_id);

-- Data API access: read-only for signed-in users (RLS below); all writes go through SECURITY DEFINER functions.
GRANT SELECT ON public.ticket_team_members TO authenticated;
GRANT ALL ON public.ticket_team_members TO service_role;
GRANT SELECT ON public.ticket_team_member_events TO authenticated;
GRANT ALL ON public.ticket_team_member_events TO service_role;
GRANT SELECT ON public.engagement_confirmations TO authenticated;
GRANT ALL ON public.engagement_confirmations TO service_role;

ALTER TABLE public.ticket_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_team_member_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_confirmations ENABLE ROW LEVEL SECURITY;

-- Clients and their company colleagues see the whole team; a consultant sees only their own rows.
CREATE POLICY "Ticket owners see their team" ON public.ticket_team_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND t.client_id = auth.uid()));
CREATE POLICY "Company members see the company's teams" ON public.ticket_team_members FOR SELECT TO authenticated
  USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Consultants see their own engagements" ON public.ticket_team_members FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Admins see all teams" ON public.ticket_team_members FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Ticket owners see team history" ON public.ticket_team_member_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND t.client_id = auth.uid()));
CREATE POLICY "Company members see team history" ON public.ticket_team_member_events FOR SELECT TO authenticated
  USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Consultants see their own history" ON public.ticket_team_member_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Admins see all team history" ON public.ticket_team_member_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Ticket owners see confirmations" ON public.engagement_confirmations FOR SELECT TO authenticated
  USING (client_id = auth.uid());
CREATE POLICY "Company members see confirmations" ON public.engagement_confirmations FOR SELECT TO authenticated
  USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Consultants see their own confirmations" ON public.engagement_confirmations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Admins see all confirmations" ON public.engagement_confirmations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER update_ticket_team_members_updated_at BEFORE UPDATE ON public.ticket_team_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 3. Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_live(_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _status IN ('selected', 'invited', 'viewed', 'accepted', 'bid_sent', 'rate_approved', 'nda_signed', 'ready', 'active')
$$;

CREATE OR REPLACE FUNCTION public.team_pre_ready(_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT _status IN ('selected', 'invited', 'viewed', 'accepted', 'bid_sent', 'rate_approved', 'nda_signed')
$$;

CREATE OR REPLACE FUNCTION public.team_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
$$;

CREATE OR REPLACE FUNCTION public.team_ticket_gated(_ticket_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((public.team_settings() ->> 'enabled')::boolean, true)
     AND EXISTS (SELECT 1 FROM public.ticket_team_members m WHERE m.ticket_id = _ticket_id AND NOT m.is_legacy)
$$;

-- passed all gates (or legacy) and may work on the ticket
CREATE OR REPLACE FUNCTION public.team_member_started(_ticket_id uuid, _consultant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.ticket_team_members m
                 WHERE m.ticket_id = _ticket_id AND m.consultant_id = _consultant_id AND m.status IN ('ready', 'active'))
$$;

CREATE OR REPLACE FUNCTION public.team_consultant_name(_consultant_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT NULLIF(btrim(p.display_name), '') FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id
                   WHERE c.id = _consultant_id), 'A consultant')
$$;

-- M60: the same contact-bypass protection as bids, questions and chat.
CREATE OR REPLACE FUNCTION public.team_assert_clean_text(_text text)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF public.contact_details_in_text(_text) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.'
      USING ERRCODE = '22023';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.team_notify(_user_id uuid, _title text, _body text, _link text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user_id IS NOT NULL THEN
    PERFORM public.safe_insert_notification(_user_id, left(_title, 200), left(_body, 1000), 'ticket', _link);
  END IF;
END $$;

-- Audit trail for team actions (administrator actions, team requests). Stores ids and status codes only, never contact data.
CREATE OR REPLACE FUNCTION public.team_audit(_action text, _entity_type text, _entity_id uuid, _meta jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), left(_action, 100), left(_entity_type, 60), _entity_id,
          COALESCE(_meta, '{}'::jsonb) || jsonb_build_object('actor_role', CASE WHEN auth.uid() IS NULL THEN 'system'
                                                                               WHEN public.team_is_admin() THEN 'admin' ELSE 'user' END));
END $$;

-- Gate state of one member, read from the source tables.
CREATE OR REPLACE FUNCTION public.team_gates(_member_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ticket uuid; _cons uuid; _client uuid;
  _match_acc boolean; _bid_pending boolean; _bid_acc boolean;
  _rate_id uuid; _rate_proposed boolean;
  _nda_id uuid; _nda_cons timestamptz; _nda_client timestamptz;
  _conf_id uuid; _conf_rate uuid; _conf_c timestamptz; _conf_k timestamptz;
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

  RETURN jsonb_build_object(
    'accepted', _match_acc OR _bid_pending OR _bid_acc,
    'bid_pending', _bid_pending,
    'bid_accepted', _bid_acc,
    'rate', _rate_id IS NOT NULL,
    'rate_id', _rate_id,
    'rate_proposed', _rate_proposed,
    'nda', _nda_id IS NOT NULL AND _nda_cons IS NOT NULL AND _nda_client IS NOT NULL,
    'nda_state', CASE WHEN _nda_id IS NULL THEN 'none' WHEN _nda_client IS NULL THEN 'consultant_signed' ELSE 'signed' END,
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
    WHEN 'prepare_confirmation' THEN 'prepare the engagement confirmation'
    WHEN 'confirm' THEN 'confirm the engagement summary'
    ELSE 'review the request' END
$$;

-- -----------------------------------------------------------------------------
-- 4. Status history
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_log_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  _role := CASE
    WHEN auth.uid() IS NULL THEN 'system'
    WHEN public.team_is_admin() THEN 'admin'
    WHEN EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = NEW.consultant_id AND c.user_id = auth.uid()) THEN 'consultant'
    ELSE 'client' END;
  INSERT INTO public.ticket_team_member_events (member_id, ticket_id, consultant_id, from_status, to_status, actor_id, actor_role, reason)
  VALUES (NEW.id, NEW.ticket_id, NEW.consultant_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, auth.uid(), _role,
          left(COALESCE(NULLIF(current_setting('app.team_reason', true), ''),
                        CASE WHEN NOT public.team_live(NEW.status) THEN NEW.end_reason END), 500));
  -- administrators adding or removing consultants leave an audit entry as well
  IF _role = 'admin' THEN
    PERFORM public.team_audit('team_member.' || NEW.status, 'ticket', NEW.ticket_id,
      jsonb_build_object('member_id', NEW.id, 'consultant_id', NEW.consultant_id,
                         'from_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, 'to_status', NEW.status));
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_team_log_event AFTER INSERT OR UPDATE OF status ON public.ticket_team_members
  FOR EACH ROW EXECUTE FUNCTION public.team_log_event();

-- -----------------------------------------------------------------------------
-- 5. Recompute + activation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_activate(_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _client uuid; _title text; _ticket_consultant uuid; _st text; _cons_user uuid; _name text;
BEGIN
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id;
  IF NOT FOUND OR m.status <> 'ready' THEN RETURN; END IF;
  SELECT t.client_id, t.title, t.consultant_id, t.status::text INTO _client, _title, _ticket_consultant, _st
    FROM public.tickets t WHERE t.id = m.ticket_id FOR UPDATE;

  PERFORM set_config('app.team_activation', '1', true);
  INSERT INTO public.ticket_assignments (ticket_id, consultant_id, role, work_mode, status, assigned_by, notes)
  VALUES (m.ticket_id, m.consultant_id, (CASE WHEN m.team_role = 'lead' THEN 'lead' ELSE 'support' END)::public.assignment_role,
          'collaborative'::public.assignment_work_mode, 'active'::public.assignment_status, m.created_by,
          'Engagement confirmed by both sides')
  ON CONFLICT (ticket_id, consultant_id) DO UPDATE
    SET status = 'active'::public.assignment_status, role = EXCLUDED.role, updated_at = now();

  -- the first consultant who is ready becomes the ticket's consultant; the client can start right away
  IF _ticket_consultant IS NULL THEN
    UPDATE public.tickets SET consultant_id = m.consultant_id,
      status = CASE WHEN status::text IN ('new', 'under_review', 'matched') THEN 'in_progress'::public.ticket_status ELSE status END
     WHERE id = m.ticket_id;
  ELSIF _st IN ('new', 'under_review', 'matched') THEN
    UPDATE public.tickets SET status = 'in_progress'::public.ticket_status WHERE id = m.ticket_id;
  END IF;
  PERFORM set_config('app.team_activation', '0', true);

  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = m.consultant_id;
  _name := public.team_consultant_name(m.consultant_id);
  PERFORM public.team_notify(_cons_user, 'Ready to start',
    'All four steps are done for "' || left(COALESCE(_title, 'the request'), 80) || '": you can start working and log your time.',
    '/consultant/tickets/' || m.ticket_id);
  PERFORM public.team_notify(_client, 'Consultant ready to start',
    _name || ' passed all four steps for "' || left(COALESCE(_title, 'your request'), 80) || '" and can start now.',
    '/client/tickets/' || m.ticket_id || '?tab=work');
END $$;

CREATE OR REPLACE FUNCTION public.team_recompute(_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; g jsonb; s text;
  _acc boolean; _rate boolean; _nda boolean; _conf boolean;
BEGIN
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id FOR UPDATE;
  IF NOT FOUND OR m.is_legacy OR NOT public.team_pre_ready(m.status) OR (m.status = 'selected' AND m.invited_at IS NULL) THEN RETURN; END IF;
  g := public.team_gates(m.id);
  _acc := (g ->> 'accepted')::boolean; _rate := (g ->> 'rate')::boolean;
  _nda := (g ->> 'nda')::boolean; _conf := (g ->> 'confirmed')::boolean;
  s := CASE
    WHEN _acc AND _rate AND _nda AND _conf THEN 'ready'
    WHEN _acc AND _rate AND _nda THEN 'nda_signed'
    WHEN _acc AND _rate THEN 'rate_approved'
    WHEN (g ->> 'bid_pending')::boolean THEN 'bid_sent'
    WHEN _acc THEN 'accepted'
    WHEN m.viewed_at IS NOT NULL THEN 'viewed'
    ELSE 'invited' END;
  UPDATE public.ticket_team_members SET
    status = s,
    accepted_at = CASE WHEN _acc THEN COALESCE(accepted_at, now()) ELSE accepted_at END,
    bid_sent_at = CASE WHEN (g ->> 'bid_pending')::boolean OR (g ->> 'bid_accepted')::boolean THEN COALESCE(bid_sent_at, now()) ELSE bid_sent_at END,
    rate_approved_at = CASE WHEN _rate THEN COALESCE(rate_approved_at, now()) ELSE rate_approved_at END,
    nda_signed_at = CASE WHEN _nda THEN COALESCE(nda_signed_at, now()) ELSE nda_signed_at END,
    confirmed_at = CASE WHEN _conf THEN COALESCE(confirmed_at, now()) ELSE NULL END,
    ready_at = CASE WHEN s = 'ready' THEN now() ELSE ready_at END,
    expires_at = CASE WHEN _acc THEN NULL ELSE expires_at END
  WHERE id = m.id;
  IF s = 'ready' THEN PERFORM public.team_activate(m.id); END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Ending a member (withdraw / decline / remove with notice / replace)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_finalize_end(_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _final text; _next uuid; _client uuid; _title text; _cons_user uuid;
BEGIN
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id FOR UPDATE;
  IF NOT FOUND OR NOT public.team_live(m.status) THEN RETURN; END IF;
  _final := COALESCE(m.pending_end_status, 'removed');
  UPDATE public.ticket_team_members SET status = _final, ended_at = now(), notice_until = NULL, pending_end_status = NULL, is_primary = false
   WHERE id = m.id;
  UPDATE public.engagement_confirmations SET superseded_at = now(), superseded_reason = 'member_ended'
   WHERE member_id = m.id AND superseded_at IS NULL AND (consultant_confirmed_at IS NULL OR client_confirmed_at IS NULL);

  PERFORM set_config('app.team_activation', '1', true);
  UPDATE public.ticket_assignments SET status = 'removed'::public.assignment_status
   WHERE ticket_id = m.ticket_id AND consultant_id = m.consultant_id AND status = 'active';
  SELECT tm.consultant_id INTO _next FROM public.ticket_team_members tm
   WHERE tm.ticket_id = m.ticket_id AND tm.id <> m.id AND tm.status IN ('ready', 'active')
   ORDER BY tm.is_primary DESC, tm.ready_at NULLS LAST LIMIT 1;
  UPDATE public.tickets SET consultant_id = _next WHERE id = m.ticket_id AND consultant_id = m.consultant_id;
  PERFORM set_config('app.team_activation', '0', true);

  SELECT t.client_id, t.title INTO _client, _title FROM public.tickets t WHERE t.id = m.ticket_id;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = m.consultant_id;
  PERFORM public.team_notify(_cons_user, 'Removed from the team',
    'You are no longer on the team for "' || left(COALESCE(_title, 'the request'), 80) || '". Your logged hours and invoices are kept.',
    '/consultant/requests');
  PERFORM public.team_notify(_client, 'Team member removed',
    public.team_consultant_name(m.consultant_id) || ' left the team for "' || left(COALESCE(_title, 'your request'), 80) || '". Logged hours and invoices are kept.',
    '/client/tickets/' || m.ticket_id || '?tab=work');
END $$;

-- Internal: end a member as the caller (client side, consultant side, admin or system).
CREATE OR REPLACE FUNCTION public.team_end_internal(_member_id uuid, _reason text, _final text, _by_consultant boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _hours numeric; _client uuid; _title text; _cons_user uuid; _r text := NULLIF(btrim(COALESCE(_reason, '')), '');
  _status text;
BEGIN
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id FOR UPDATE;
  IF NOT FOUND OR NOT public.team_live(m.status) THEN RAISE EXCEPTION 'This consultant is no longer on the team' USING ERRCODE = '22023'; END IF;
  SELECT t.client_id, t.title INTO _client, _title FROM public.tickets t WHERE t.id = m.ticket_id;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = m.consultant_id;
  IF _r IS NOT NULL THEN PERFORM public.team_assert_clean_text(_r); END IF;
  PERFORM set_config('app.team_reason', COALESCE(_r, ''), true);

  IF m.status IN ('selected', 'invited', 'viewed', 'bid_sent') THEN
    -- before acceptance: withdraw (client) or decline (consultant) at once
    _status := CASE WHEN _by_consultant THEN 'declined' WHEN _final = 'replaced' THEN 'replaced' ELSE 'withdrawn' END;
    UPDATE public.ticket_team_members SET status = _status, ended_at = now(), end_reason = _r, expires_at = NULL,
      declined_at = CASE WHEN _by_consultant THEN now() ELSE declined_at END,
      suggest_next = _by_consultant, is_primary = false, end_requested_by = auth.uid()
     WHERE id = m.id;
    UPDATE public.ticket_match_requests
       SET status = (CASE WHEN _by_consultant THEN 'rejected' ELSE 'withdrawn' END)::public.match_request_status,
           responded_at = CASE WHEN _by_consultant THEN now() ELSE responded_at END
     WHERE ticket_id = m.ticket_id AND consultant_id = m.consultant_id AND status = 'pending';
    UPDATE public.proposals
       SET status = (CASE WHEN _by_consultant THEN 'withdrawn' ELSE 'rejected' END)::public.proposal_status,
           withdrawn_at = CASE WHEN _by_consultant THEN now() ELSE withdrawn_at END,
           rejection_reason = CASE WHEN _by_consultant THEN rejection_reason ELSE 'Invitation withdrawn' END
     WHERE ticket_id = m.ticket_id AND consultant_id = m.consultant_id AND status = 'pending';
    IF _by_consultant THEN
      PERFORM public.team_notify(_client, 'Invitation declined',
        public.team_consultant_name(m.consultant_id) || ' declined the invitation for "' || left(COALESCE(_title, 'your request'), 80) || '". See the next best match on the Team panel.',
        '/client/tickets/' || m.ticket_id || '?tab=work');
    END IF;
    RETURN jsonb_build_object('status', _status);
  ELSIF public.team_pre_ready(m.status) THEN
    -- accepted but not started: nobody has access yet, so it ends at once
    _status := CASE WHEN _by_consultant THEN 'declined' WHEN _final = 'replaced' THEN 'replaced' ELSE 'removed' END;
    UPDATE public.ticket_team_members SET status = _status, ended_at = now(), end_reason = _r, is_primary = false,
      declined_at = CASE WHEN _by_consultant THEN now() ELSE declined_at END, suggest_next = _by_consultant,
      end_requested_by = auth.uid()
     WHERE id = m.id;
    UPDATE public.engagement_confirmations SET superseded_at = now(), superseded_reason = 'member_ended'
     WHERE member_id = m.id AND superseded_at IS NULL;
    IF _by_consultant THEN
      PERFORM public.team_notify(_client, 'Consultant withdrew',
        public.team_consultant_name(m.consultant_id) || ' withdrew from "' || left(COALESCE(_title, 'your request'), 80) || '". See the next best match on the Team panel.',
        '/client/tickets/' || m.ticket_id || '?tab=work');
    ELSE
      PERFORM public.team_notify(_cons_user, 'Removed from the team',
        'The client removed you from "' || left(COALESCE(_title, 'the request'), 80) || '" before work started.', '/consultant/requests');
    END IF;
    RETURN jsonb_build_object('status', _status);
  END IF;

  -- ready / active: a notice period applies
  IF auth.uid() IS NOT NULL AND char_length(COALESCE(_r, '')) < 3 THEN
    RAISE EXCEPTION 'Please give a short reason (at least 3 characters)' USING ERRCODE = '22023';
  END IF;
  IF m.notice_until IS NOT NULL THEN RAISE EXCEPTION 'A removal is already scheduled' USING ERRCODE = '22023'; END IF;
  _hours := GREATEST(COALESCE((public.team_settings() ->> 'removal_notice_hours')::numeric, 48), 0);
  UPDATE public.ticket_team_members SET pending_end_status = CASE WHEN _final = 'replaced' THEN 'replaced' ELSE 'removed' END,
    end_reason = _r, end_requested_by = auth.uid(), notice_until = now() + make_interval(secs => (_hours * 3600)::double precision)
   WHERE id = m.id;
  IF _hours = 0 THEN
    PERFORM public.team_finalize_end(m.id);
    RETURN jsonb_build_object('status', COALESCE(_final, 'removed'));
  END IF;
  PERFORM public.team_notify(CASE WHEN _by_consultant THEN _client ELSE _cons_user END, 'Team change scheduled',
    CASE WHEN _by_consultant THEN public.team_consultant_name(m.consultant_id) || ' will leave' ELSE 'You will leave' END
      || ' the team for "' || left(COALESCE(_title, 'the request'), 80) || '" in ' || _hours::text || ' hours. Logged hours and invoices are kept.',
    CASE WHEN _by_consultant THEN '/client/tickets/' || m.ticket_id || '?tab=work' ELSE '/consultant/tickets/' || m.ticket_id END);
  RETURN jsonb_build_object('status', m.status, 'notice_until', now() + make_interval(secs => (_hours * 3600)::double precision));
END $$;

-- -----------------------------------------------------------------------------
-- 7. Client / consultant actions (RPCs)
-- -----------------------------------------------------------------------------
-- Invite selected consultants. _items: [{"consultant_id": uuid, "mode": "normal"|"bid", "role": "lead"|"support", "primary": bool}]
CREATE OR REPLACE FUNCTION public.team_invite(_ticket_id uuid, _items jsonb, _message text DEFAULT NULL, _bid_deadline timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb := public.team_settings(); t record; it jsonb; _cons uuid; _mode text; _role text; _primary boolean;
  _msg text := NULLIF(btrim(COALESCE(_message, '')), ''); _expires timestamptz; _mr_id uuid; _mr_st text; _member uuid; _cons_user uuid;
  invited jsonb := '[]'::jsonb; already jsonb := '[]'::jsonb; skipped jsonb := '[]'::jsonb; _busy integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  IF NOT COALESCE((cfg ->> 'enabled')::boolean, true) THEN RAISE EXCEPTION 'Team engagement is switched off' USING ERRCODE = '42501'; END IF;
  SELECT tk.id, tk.client_id, tk.title, tk.status::text AS st, tk.critical_response INTO t FROM public.tickets tk WHERE tk.id = _ticket_id FOR UPDATE;
  IF NOT FOUND OR (t.client_id <> auth.uid() AND NOT public.team_is_admin()) THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501'; END IF;
  IF t.st IN ('resolved', 'closed') THEN RAISE EXCEPTION 'This ticket is already finished' USING ERRCODE = '22023'; END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 OR jsonb_array_length(_items) > 20 THEN
    RAISE EXCEPTION 'Choose between 1 and 20 consultants' USING ERRCODE = '22023';
  END IF;
  IF _msg IS NOT NULL THEN
    IF char_length(_msg) > 2000 THEN RAISE EXCEPTION 'The message is too long' USING ERRCODE = '22023'; END IF;
    PERFORM public.team_assert_clean_text(_msg);
  END IF;
  IF _bid_deadline IS NOT NULL AND (_bid_deadline < now() + interval '1 hour' OR _bid_deadline > now() + interval '30 days') THEN
    RAISE EXCEPTION 'The bid deadline must be between 1 hour and 30 days from now' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('team-invite:' || auth.uid()::text, 60, 3600) THEN
    RAISE EXCEPTION 'Too many invitations in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
    BEGIN
      _cons := (it ->> 'consultant_id')::uuid;
    EXCEPTION WHEN others THEN
      skipped := skipped || jsonb_build_object('consultant_id', it ->> 'consultant_id', 'reason', 'invalid'); CONTINUE;
    END;
    _mode := CASE WHEN it ->> 'mode' = 'bid' THEN 'bid' ELSE 'normal' END;
    _role := CASE WHEN it ->> 'role' = 'lead' THEN 'lead' ELSE 'support' END;
    _primary := COALESCE((it ->> 'primary')::boolean, false);

    IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _cons AND c.verification_status = 'verified') THEN
      skipped := skipped || jsonb_build_object('consultant_id', _cons, 'reason', 'not_verified'); CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.ticket_team_members m WHERE m.ticket_id = _ticket_id AND m.consultant_id = _cons AND public.team_live(m.status)) THEN
      already := already || to_jsonb(_cons); CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.ticket_team_members m WHERE m.ticket_id = _ticket_id AND m.consultant_id = _cons AND m.status = 'declined'
                AND m.declined_at > now() - make_interval(days => COALESCE((cfg ->> 'reinvite_after_decline_days')::int, 7))) THEN
      skipped := skipped || jsonb_build_object('consultant_id', _cons, 'reason', 'declined_recently'); CONTINUE;
    END IF;
    -- maximum team size (platform setting max_team_size, default 5); legacy members count too
    IF (SELECT count(*) FROM public.ticket_team_members m WHERE m.ticket_id = _ticket_id AND public.team_live(m.status))
       >= GREATEST(COALESCE((cfg ->> 'max_team_size')::int, 5), 1) THEN
      skipped := skipped || jsonb_build_object('consultant_id', _cons, 'reason', 'team_full'); CONTINUE;
    END IF;

    _expires := CASE
      WHEN _mode = 'bid' AND _bid_deadline IS NOT NULL THEN _bid_deadline
      WHEN t.critical_response THEN now() + make_interval(mins => COALESCE((cfg ->> 'critical_response_minutes')::int, 30))
      ELSE now() + make_interval(hours => COALESCE((cfg ->> 'response_hours')::int, 24)) END;

    -- reuse the existing invitation row (one per ticket and consultant)
    _mr_id := NULL; _mr_st := NULL;
    SELECT r.id, r.status::text INTO _mr_id, _mr_st FROM public.ticket_match_requests r WHERE r.ticket_id = _ticket_id AND r.consultant_id = _cons;
    SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = _cons;
    IF _mr_id IS NULL THEN
      INSERT INTO public.ticket_match_requests (ticket_id, consultant_id, sent_by, message)
      VALUES (_ticket_id, _cons, auth.uid(), CASE WHEN _mode = 'bid' THEN 'Private bid invitation' || COALESCE(': ' || _msg, '') ELSE _msg END)
      RETURNING id INTO _mr_id;
    ELSIF _mr_st IN ('rejected', 'withdrawn') THEN
      UPDATE public.ticket_match_requests SET status = 'pending'::public.match_request_status, responded_at = NULL WHERE id = _mr_id;
      PERFORM public.team_notify(_cons_user, 'New invitation',
        'You are invited again to "' || left(COALESCE(t.title, 'a request'), 80) || '". Please answer before ' || to_char(_expires AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' (Riyadh time).',
        '/consultant/requests');
    END IF;

    IF _primary THEN
      UPDATE public.ticket_team_members SET is_primary = false WHERE ticket_id = _ticket_id AND is_primary AND public.team_live(status);
    END IF;
    IF _role = 'lead' THEN
      UPDATE public.ticket_team_members SET team_role = 'support' WHERE ticket_id = _ticket_id AND team_role = 'lead' AND public.team_live(status);
    END IF;

    INSERT INTO public.ticket_team_members (ticket_id, consultant_id, engagement_mode, team_role, is_primary, status, invite_message, match_request_id, created_by)
    VALUES (_ticket_id, _cons, _mode, _role, _primary, 'selected', _msg, _mr_id, auth.uid())
    RETURNING id INTO _member;
    UPDATE public.ticket_team_members SET status = 'invited', invited_at = now(), expires_at = _expires WHERE id = _member;
    PERFORM public.team_recompute(_member);  -- an earlier accepted invitation or bid counts straight away

    SELECT count(*) INTO _busy FROM public.ticket_team_members m
     WHERE m.consultant_id = _cons AND m.ticket_id <> _ticket_id AND m.status IN ('ready', 'active');
    invited := invited || jsonb_build_object('consultant_id', _cons, 'member_id', _member, 'expires_at', _expires, 'active_elsewhere', _busy);
  END LOOP;

  RETURN jsonb_build_object('invited', invited, 'already', already, 'skipped', skipped);
END $$;

CREATE OR REPLACE FUNCTION public.team_mark_viewed(_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ticket_team_members m SET viewed_at = now()
   WHERE m.id = _member_id AND m.viewed_at IS NULL AND m.status = 'invited'
     AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = m.consultant_id AND c.user_id = auth.uid());
  IF FOUND THEN PERFORM public.team_recompute(_member_id); END IF;
END $$;

-- Internal: store a consultant rate for a team member (critical surcharge applied as in propose_ticket_rate).
CREATE OR REPLACE FUNCTION public.team_insert_rate(_member_id uuid, _hourly_rate numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _t record; _base numeric := round(_hourly_rate, 2); _pct numeric; _rate numeric; _cur text; _locked text;
  _appr_id uuid; _appr_rate numeric; _id uuid;
BEGIN
  IF _base IS NULL OR _base <= 0 OR _base > 100000 THEN RAISE EXCEPTION 'Enter a valid hourly rate' USING ERRCODE = '22023'; END IF;
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id;
  SELECT tk.client_id, tk.title, tk.cost_currency INTO _t FROM public.tickets tk WHERE tk.id = m.ticket_id;
  IF NOT public.check_rate_limit('rate-propose:' || auth.uid()::text, 20, 3600) THEN
    RAISE EXCEPTION 'Too many rate proposals in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  _pct := public.critical_surcharge_for(m.ticket_id, m.consultant_id);
  _rate := CASE WHEN _pct > 0 THEN round(_base * (1 + _pct / 100), 2) ELSE _base END;
  IF _rate > 100000 THEN RAISE EXCEPTION 'Enter a valid hourly rate' USING ERRCODE = '22023'; END IF;
  SELECT r.currency INTO _locked FROM public.ticket_rates r
   WHERE r.ticket_id = m.ticket_id AND r.consultant_id = m.consultant_id AND r.status IN ('approved', 'replaced') ORDER BY r.created_at LIMIT 1;
  _cur := COALESCE(_locked, upper(NULLIF(btrim(_t.cost_currency), '')), 'USD');
  SELECT r.id, r.hourly_rate INTO _appr_id, _appr_rate FROM public.ticket_rates r
   WHERE r.ticket_id = m.ticket_id AND r.consultant_id = m.consultant_id AND r.status = 'approved';
  IF _appr_id IS NOT NULL AND _appr_rate = _rate THEN RETURN _appr_id; END IF;
  UPDATE public.ticket_rates SET status = 'replaced' WHERE ticket_id = m.ticket_id AND consultant_id = m.consultant_id AND status = 'proposed';
  INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status, source, proposed_by, base_rate, surcharge_percent)
  VALUES (m.ticket_id, m.consultant_id, _rate, _cur, 'proposed', 'consultant', auth.uid(),
          CASE WHEN _pct > 0 THEN _base END, CASE WHEN _pct > 0 THEN _pct END)
  RETURNING id INTO _id;
  PERFORM public.team_notify(_t.client_id, 'Hourly rate awaiting your approval',
    public.team_consultant_name(m.consultant_id) || ' proposed ' || public.ts_num(_rate) || ' ' || _cur || ' per hour'
      || CASE WHEN _pct > 0 THEN ' (including the ' || public.ts_num(_pct) || ' % critical response surcharge)' ELSE '' END
      || ' for "' || left(COALESCE(_t.title, 'your request'), 80) || '".',
    '/client/tickets/' || m.ticket_id || '?tab=work');
  RETURN _id;
END $$;

-- Consultant answers a normal request: accept (with hourly rate and availability) or decline.
CREATE OR REPLACE FUNCTION public.team_respond(_member_id uuid, _accept boolean, _hourly_rate numeric DEFAULT NULL, _availability text DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _avail text := NULLIF(btrim(COALESCE(_availability, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = m.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified') THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '42501';
  END IF;
  IF NOT _accept THEN
    RETURN public.team_end_internal(_member_id, _reason, 'removed', true);
  END IF;
  IF m.status NOT IN ('invited', 'viewed', 'accepted') THEN RAISE EXCEPTION 'This invitation can no longer be answered' USING ERRCODE = '22023'; END IF;
  IF m.engagement_mode = 'bid' THEN RAISE EXCEPTION 'This is a bid request: please send your bid with the bid form' USING ERRCODE = '22023'; END IF;
  IF _avail IS NULL OR char_length(_avail) < 3 OR char_length(_avail) > 500 THEN
    RAISE EXCEPTION 'Please describe your availability (3 to 500 characters)' USING ERRCODE = '22023';
  END IF;
  PERFORM public.team_assert_clean_text(_avail);
  IF _hourly_rate IS NULL THEN RAISE EXCEPTION 'Please confirm your hourly rate' USING ERRCODE = '22023'; END IF;

  -- accept the invitation first: a reply to a critical request in time records the +30 % surcharge
  UPDATE public.ticket_match_requests SET status = 'accepted'::public.match_request_status, responded_at = now()
   WHERE ticket_id = m.ticket_id AND consultant_id = m.consultant_id AND status = 'pending';
  UPDATE public.ticket_team_members SET availability_note = _avail WHERE id = m.id;
  PERFORM public.team_insert_rate(m.id, _hourly_rate);
  PERFORM public.team_recompute(m.id);
  RETURN jsonb_build_object('status', (SELECT status FROM public.ticket_team_members WHERE id = m.id));
END $$;

-- Consultant proposes a new rate after the client declined one (counter-offer for normal requests).
CREATE OR REPLACE FUNCTION public.team_propose_rate(_member_id uuid, _hourly_rate numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = m.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified') THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.team_pre_ready(m.status) OR NOT (public.team_gates(m.id) ->> 'accepted')::boolean THEN
    RAISE EXCEPTION 'Accept the invitation first; once you have started, use the rate card on the ticket' USING ERRCODE = '22023';
  END IF;
  _id := public.team_insert_rate(m.id, _hourly_rate);
  PERFORM public.team_recompute(m.id);
  RETURN _id;
END $$;

-- Client accepts a bid inside the team flow (no assignment yet). _only_this = choose this consultant only.
CREATE OR REPLACE FUNCTION public.team_accept_bid(_proposal_id uuid, _only_this boolean DEFAULT false, _role text DEFAULT 'support', _primary boolean DEFAULT false, _client_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.proposals; t record; _member uuid; _notes text := left(NULLIF(btrim(COALESCE(_client_notes, '')), ''), 2000);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  IF NOT COALESCE((public.team_settings() ->> 'enabled')::boolean, true) THEN RAISE EXCEPTION 'Team engagement is switched off' USING ERRCODE = '42501'; END IF;
  SELECT * INTO p FROM public.proposals WHERE id = _proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proposal not found' USING ERRCODE = '42501'; END IF;
  SELECT tk.id, tk.client_id, tk.status::text AS st INTO t FROM public.tickets tk WHERE tk.id = p.ticket_id FOR UPDATE;
  IF t.client_id <> auth.uid() AND NOT public.team_is_admin() THEN RAISE EXCEPTION 'Proposal not found' USING ERRCODE = '42501'; END IF;
  IF p.status::text <> 'pending' THEN RAISE EXCEPTION 'This proposal has already been answered' USING ERRCODE = '22023'; END IF;
  IF t.st IN ('resolved', 'closed') THEN RAISE EXCEPTION 'This ticket is already finished' USING ERRCODE = '22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = p.consultant_id AND c.verification_status = 'verified') THEN
    RAISE EXCEPTION 'This consultant is not verified at the moment' USING ERRCODE = '42501';
  END IF;
  IF _notes IS NOT NULL THEN PERFORM public.team_assert_clean_text(_notes); END IF;

  IF _primary THEN
    UPDATE public.ticket_team_members SET is_primary = false WHERE ticket_id = p.ticket_id AND is_primary AND public.team_live(status) AND consultant_id <> p.consultant_id;
  END IF;
  IF _role = 'lead' THEN
    UPDATE public.ticket_team_members SET team_role = 'support' WHERE ticket_id = p.ticket_id AND team_role = 'lead' AND public.team_live(status) AND consultant_id <> p.consultant_id;
  END IF;
  -- a bidder from open bidding joins the team here; an invited bidder already has a row
  SELECT id INTO _member FROM public.ticket_team_members
   WHERE ticket_id = p.ticket_id AND consultant_id = p.consultant_id AND public.team_live(status);
  IF _member IS NULL THEN
    INSERT INTO public.ticket_team_members (ticket_id, consultant_id, engagement_mode, team_role, is_primary, status, proposal_id, created_by)
    VALUES (p.ticket_id, p.consultant_id, 'bid', CASE WHEN _role = 'lead' THEN 'lead' ELSE 'support' END, _primary, 'selected', p.id, auth.uid())
    RETURNING id INTO _member;
    UPDATE public.ticket_team_members SET status = 'bid_sent', invited_at = p.created_at, bid_sent_at = p.created_at WHERE id = _member;
  ELSE
    UPDATE public.ticket_team_members SET proposal_id = p.id,
      is_primary = is_primary OR _primary, team_role = CASE WHEN _role = 'lead' THEN 'lead' ELSE team_role END
     WHERE id = _member;
  END IF;

  -- the existing rate trigger approves the bid rate (critical surcharge included)
  UPDATE public.proposals SET status = 'accepted', client_notes = _notes WHERE id = p.id;

  IF _only_this THEN
    UPDATE public.proposals SET status = 'rejected', rejection_reason = 'another_chosen'
     WHERE ticket_id = p.ticket_id AND id <> p.id AND status = 'pending';
    UPDATE public.proposal_counters SET status = 'cancelled', responded_at = now()
     WHERE ticket_id = p.ticket_id AND status = 'pending';
    PERFORM set_config('app.team_reason', 'another_chosen', true);
    UPDATE public.ticket_team_members SET status = 'not_selected', ended_at = now(), end_reason = 'another_chosen', expires_at = NULL, is_primary = false
     WHERE ticket_id = p.ticket_id AND id <> _member AND engagement_mode = 'bid' AND status IN ('invited', 'viewed', 'bid_sent');
    -- bid invitations that were never answered are closed too (the withdrawal notice says another consultant was chosen)
    UPDATE public.ticket_match_requests r SET status = 'withdrawn'::public.match_request_status
     WHERE r.ticket_id = p.ticket_id AND r.consultant_id <> p.consultant_id AND r.status = 'pending'
       AND EXISTS (SELECT 1 FROM public.ticket_team_members m WHERE m.ticket_id = r.ticket_id AND m.consultant_id = r.consultant_id
                    AND m.status = 'not_selected' AND m.end_reason = 'another_chosen');
    PERFORM set_config('app.team_reason', '', true);
  END IF;
  PERFORM public.team_recompute(_member);
  RETURN _member;
END $$;

-- Prepare (or revise) the engagement confirmation. The person who prepares it confirms it at the same time.
CREATE OR REPLACE FUNCTION public.team_prepare_confirmation(_member_id uuid, _scope text, _start_date date, _response_commitment text, _estimated_hours numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _client uuid; _title text; _is_client boolean; _is_cons boolean; g jsonb;
  _r record; _v integer; _id uuid; _cons_user uuid;
  _s text := btrim(COALESCE(_scope, '')); _c text := btrim(COALESCE(_response_commitment, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Team member not found' USING ERRCODE = '42501'; END IF;
  SELECT t.client_id, t.title INTO _client, _title FROM public.tickets t WHERE t.id = m.ticket_id;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = m.consultant_id;
  _is_client := _client = auth.uid();
  _is_cons := _cons_user = auth.uid();
  IF NOT (_is_client OR _is_cons) THEN RAISE EXCEPTION 'Team member not found' USING ERRCODE = '42501'; END IF;
  IF NOT public.team_pre_ready(m.status) THEN RAISE EXCEPTION 'The engagement can not be changed at this stage' USING ERRCODE = '22023'; END IF;
  g := public.team_gates(m.id);
  IF NOT (g ->> 'accepted')::boolean OR NOT (g ->> 'rate')::boolean THEN
    RAISE EXCEPTION 'The consultant must accept and the hourly rate must be approved first' USING ERRCODE = '22023';
  END IF;
  IF char_length(_s) < 10 OR char_length(_s) > 4000 THEN RAISE EXCEPTION 'Describe the scope in 10 to 4000 characters' USING ERRCODE = '22023'; END IF;
  IF char_length(_c) < 3 OR char_length(_c) > 500 THEN RAISE EXCEPTION 'Describe the response commitment in 3 to 500 characters' USING ERRCODE = '22023'; END IF;
  IF _start_date IS NULL OR _start_date < (now() AT TIME ZONE 'Asia/Riyadh')::date - 1 OR _start_date > current_date + 365 THEN
    RAISE EXCEPTION 'Choose a start date from today up to one year ahead' USING ERRCODE = '22023';
  END IF;
  IF _estimated_hours IS NOT NULL AND (_estimated_hours <= 0 OR _estimated_hours > 10000) THEN
    RAISE EXCEPTION 'Enter a valid number of hours' USING ERRCODE = '22023';
  END IF;
  PERFORM public.team_assert_clean_text(_s);
  PERFORM public.team_assert_clean_text(_c);

  SELECT r.id, r.hourly_rate, r.currency, r.base_rate, r.surcharge_percent INTO _r
    FROM public.ticket_rates r WHERE r.id = (g ->> 'rate_id')::uuid;
  UPDATE public.engagement_confirmations SET superseded_at = now(), superseded_reason = 'revised'
   WHERE member_id = m.id AND superseded_at IS NULL;
  SELECT COALESCE(max(version), 0) + 1 INTO _v FROM public.engagement_confirmations WHERE member_id = m.id;
  INSERT INTO public.engagement_confirmations (member_id, ticket_id, consultant_id, client_id, version, scope_summary, rate_id, hourly_rate, currency,
    base_rate, surcharge_percent, estimated_hours, start_date, response_commitment, prepared_by, consultant_confirmed_at, client_confirmed_at)
  VALUES (m.id, m.ticket_id, m.consultant_id, _client, _v, _s, _r.id, _r.hourly_rate, _r.currency, _r.base_rate, _r.surcharge_percent,
    _estimated_hours, _start_date, _c, auth.uid(), CASE WHEN _is_cons THEN now() END, CASE WHEN _is_client THEN now() END)
  RETURNING id INTO _id;

  PERFORM public.team_notify(CASE WHEN _is_client THEN _cons_user ELSE _client END, 'Please confirm the engagement',
    'The engagement summary for "' || left(COALESCE(_title, 'the request'), 80) || '" is ready: scope, rate and start date. Please review and confirm it.',
    CASE WHEN _is_client THEN '/consultant/requests' ELSE '/client/tickets/' || m.ticket_id || '?tab=work' END);
  PERFORM public.team_recompute(m.id);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.team_confirm(_confirmation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.engagement_confirmations; _cons_user uuid; _status text; _rate uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO c FROM public.engagement_confirmations WHERE id = _confirmation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confirmation not found' USING ERRCODE = '42501'; END IF;
  SELECT cc.user_id INTO _cons_user FROM public.consultants cc WHERE cc.id = c.consultant_id;
  IF auth.uid() <> c.client_id AND auth.uid() IS DISTINCT FROM _cons_user THEN RAISE EXCEPTION 'Confirmation not found' USING ERRCODE = '42501'; END IF;
  IF c.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'This summary was replaced by a newer version' USING ERRCODE = '22023'; END IF;
  SELECT status INTO _status FROM public.ticket_team_members WHERE id = c.member_id;
  IF NOT public.team_pre_ready(_status) THEN RAISE EXCEPTION 'The engagement can not be changed at this stage' USING ERRCODE = '22023'; END IF;
  SELECT r.id INTO _rate FROM public.ticket_rates r WHERE r.ticket_id = c.ticket_id AND r.consultant_id = c.consultant_id AND r.status = 'approved';
  IF _rate IS DISTINCT FROM c.rate_id THEN
    UPDATE public.engagement_confirmations SET superseded_at = now(), superseded_reason = 'rate_changed' WHERE id = c.id;
    RAISE EXCEPTION 'The hourly rate changed: please prepare the summary again' USING ERRCODE = '22023';
  END IF;
  IF auth.uid() = c.client_id THEN
    UPDATE public.engagement_confirmations SET client_confirmed_at = COALESCE(client_confirmed_at, now()) WHERE id = c.id;
  ELSE
    UPDATE public.engagement_confirmations SET consultant_confirmed_at = COALESCE(consultant_confirmed_at, now()) WHERE id = c.id;
  END IF;
  PERFORM public.team_recompute(c.member_id);
  RETURN jsonb_build_object('status', (SELECT status FROM public.ticket_team_members WHERE id = c.member_id));
END $$;

-- Either side refuses the NDA: the engagement ends before any access is given.
CREATE OR REPLACE FUNCTION public.team_refuse_nda(_member_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _client uuid; _cons_user uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id;
  SELECT t.client_id INTO _client FROM public.tickets t WHERE t.id = m.ticket_id;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = m.consultant_id;
  IF m.id IS NULL OR (auth.uid() IS DISTINCT FROM _client AND auth.uid() IS DISTINCT FROM _cons_user) THEN
    RAISE EXCEPTION 'Team member not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.team_pre_ready(m.status) THEN RAISE EXCEPTION 'The NDA step is already complete' USING ERRCODE = '22023'; END IF;
  RETURN public.team_end_internal(_member_id, 'NDA refused' || COALESCE(': ' || NULLIF(btrim(COALESCE(_reason, '')), ''), ''), 'removed', auth.uid() = _cons_user);
END $$;

-- Client withdraws / removes, or consultant leaves. After the start a notice period applies.
CREATE OR REPLACE FUNCTION public.team_end_member(_member_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _client uuid; _cons_user uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id;
  SELECT t.client_id INTO _client FROM public.tickets t WHERE t.id = m.ticket_id;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = m.consultant_id;
  IF m.id IS NULL OR NOT (auth.uid() = _client OR auth.uid() = _cons_user OR public.team_is_admin()) THEN
    RAISE EXCEPTION 'Team member not found' USING ERRCODE = '42501';
  END IF;
  RETURN public.team_end_internal(_member_id, _reason, 'removed', auth.uid() = _cons_user AND auth.uid() IS DISTINCT FROM _client);
END $$;

CREATE OR REPLACE FUNCTION public.team_cancel_end(_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ticket_team_members SET notice_until = NULL, pending_end_status = NULL, end_reason = NULL, end_requested_by = NULL
   WHERE id = _member_id AND notice_until IS NOT NULL AND notice_until > now()
     AND (end_requested_by = auth.uid() OR public.team_is_admin());
  IF NOT FOUND THEN RAISE EXCEPTION 'No scheduled removal that you can cancel' USING ERRCODE = '22023'; END IF;
END $$;

-- Replace a member: invite the new consultant with the same role, then end the old one (notice applies if started).
CREATE OR REPLACE FUNCTION public.team_replace_member(_member_id uuid, _new_consultant_id uuid, _mode text DEFAULT 'normal', _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _client uuid; res jsonb; _new uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id;
  SELECT t.client_id INTO _client FROM public.tickets t WHERE t.id = m.ticket_id;
  IF m.id IS NULL OR (_client <> auth.uid() AND NOT public.team_is_admin()) THEN RAISE EXCEPTION 'Team member not found' USING ERRCODE = '42501'; END IF;
  IF _new_consultant_id = m.consultant_id THEN RAISE EXCEPTION 'Choose a different consultant' USING ERRCODE = '22023'; END IF;
  res := public.team_invite(m.ticket_id, jsonb_build_array(jsonb_build_object('consultant_id', _new_consultant_id, 'mode', _mode, 'role', m.team_role, 'primary', false)), NULL, NULL);
  _new := ((res -> 'invited' -> 0) ->> 'member_id')::uuid;
  IF _new IS NULL THEN RETURN res; END IF;
  PERFORM public.team_end_internal(_member_id, _reason, 'replaced', false);
  UPDATE public.ticket_team_members SET replaced_by = _new WHERE id = _member_id;
  RETURN res || jsonb_build_object('replaced', _member_id);
END $$;

-- Lead / primary. A started primary becomes the ticket's consultant.
CREATE OR REPLACE FUNCTION public.team_set_role(_member_id uuid, _role text, _primary boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _client uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id FOR UPDATE;
  SELECT t.client_id INTO _client FROM public.tickets t WHERE t.id = m.ticket_id;
  IF m.id IS NULL OR (_client <> auth.uid() AND NOT public.team_is_admin()) THEN RAISE EXCEPTION 'Team member not found' USING ERRCODE = '42501'; END IF;
  IF NOT public.team_live(m.status) THEN RAISE EXCEPTION 'This consultant is no longer on the team' USING ERRCODE = '22023'; END IF;
  IF _role NOT IN ('lead', 'support') THEN RAISE EXCEPTION 'Unknown role' USING ERRCODE = '22023'; END IF;
  IF _role = 'lead' THEN
    UPDATE public.ticket_team_members SET team_role = 'support' WHERE ticket_id = m.ticket_id AND id <> m.id AND team_role = 'lead' AND public.team_live(status);
  END IF;
  IF _primary THEN
    UPDATE public.ticket_team_members SET is_primary = false WHERE ticket_id = m.ticket_id AND id <> m.id AND is_primary AND public.team_live(status);
  END IF;
  UPDATE public.ticket_team_members SET team_role = _role, is_primary = COALESCE(_primary, false) WHERE id = m.id;
  IF public.team_is_admin() THEN
    PERFORM public.team_audit('team_member.role', 'ticket', m.ticket_id,
      jsonb_build_object('member_id', m.id, 'consultant_id', m.consultant_id, 'role', _role, 'primary', COALESCE(_primary, false)));
  END IF;
  IF m.status IN ('ready', 'active') THEN
    PERFORM set_config('app.team_activation', '1', true);
    UPDATE public.ticket_assignments SET role = (CASE WHEN _role = 'lead' THEN 'lead' ELSE 'support' END)::public.assignment_role
     WHERE ticket_id = m.ticket_id AND consultant_id = m.consultant_id AND status = 'active';
    IF _primary THEN
      UPDATE public.tickets SET consultant_id = m.consultant_id WHERE id = m.ticket_id AND consultant_id IS DISTINCT FROM m.consultant_id;
    END IF;
    PERFORM set_config('app.team_activation', '0', true);
  END IF;
END $$;

-- Remind the side that must act next, at most once per nudge_hours per side.
CREATE OR REPLACE FUNCTION public.team_nudge(_member_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ticket_team_members; _client uuid; _title text; _cons_user uuid; _side text; nx jsonb; _last timestamptz;
  _hours int := COALESCE((public.team_settings() ->> 'nudge_hours')::int, 24);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO m FROM public.ticket_team_members WHERE id = _member_id FOR UPDATE;
  SELECT t.client_id, t.title INTO _client, _title FROM public.tickets t WHERE t.id = m.ticket_id;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = m.consultant_id;
  _side := CASE WHEN auth.uid() = _client THEN 'client' WHEN auth.uid() = _cons_user THEN 'consultant' END;
  IF m.id IS NULL OR _side IS NULL THEN RAISE EXCEPTION 'Team member not found' USING ERRCODE = '42501'; END IF;
  nx := public.team_next_step(m.id);
  IF nx ->> 'actor' = 'none' THEN RAISE EXCEPTION 'There is nothing to remind about' USING ERRCODE = '22023'; END IF;
  IF nx ->> 'actor' = _side THEN RAISE EXCEPTION 'The next step is yours: %', public.team_step_text(nx ->> 'step') USING ERRCODE = '22023'; END IF;
  _last := CASE WHEN _side = 'client' THEN m.client_nudged_at ELSE m.consultant_nudged_at END;
  IF _last IS NOT NULL AND _last > now() - make_interval(hours => _hours) THEN
    RAISE EXCEPTION 'You can send one reminder every % hours', _hours USING ERRCODE = '54000';
  END IF;
  IF _side = 'client' THEN
    UPDATE public.ticket_team_members SET client_nudged_at = now() WHERE id = m.id;
    PERFORM public.team_notify(_cons_user, 'Reminder from the client',
      'Please ' || public.team_step_text(nx ->> 'step') || ' for "' || left(COALESCE(_title, 'the request'), 80) || '".', '/consultant/requests');
  ELSE
    UPDATE public.ticket_team_members SET consultant_nudged_at = now() WHERE id = m.id;
    PERFORM public.team_notify(_client, 'Reminder from ' || public.team_consultant_name(m.consultant_id),
      'Please ' || public.team_step_text(nx ->> 'step') || ' for "' || left(COALESCE(_title, 'your request'), 80) || '".',
      '/client/tickets/' || m.ticket_id || '?tab=work');
  END IF;
  RETURN now() + make_interval(hours => _hours);
END $$;

-- Team panel data. Clients, company colleagues and admins get every member; a consultant gets only their own row.
-- Contains no contact details, bank data or other consultants' private fields.
CREATE OR REPLACE FUNCTION public.team_panel(_ticket_id uuid)
RETURNS TABLE (
  member_id uuid, consultant_id uuid, display_name text, avatar_url text, engagement_mode text, team_role text, is_primary boolean,
  status text, is_legacy boolean, gates jsonb, next_step jsonb, availability_note text,
  approved_rate numeric, proposed_rate numeric, rate_currency text, rate_surcharge_percent numeric,
  confirmation jsonb, invited_at timestamptz, viewed_at timestamptz, accepted_at timestamptz, bid_sent_at timestamptz,
  rate_approved_at timestamptz, nda_signed_at timestamptz, confirmed_at timestamptz, ready_at timestamptz, ended_at timestamptz,
  expires_at timestamptz, notice_until timestamptz, end_reason text, blocked_reason text, suggest_next boolean,
  client_nudged_at timestamptz, consultant_nudged_at timestamptz, ticket_gated boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE _all boolean; _me uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  _all := EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket_id AND t.client_id = auth.uid())
          OR public.ticket_in_my_company(_ticket_id) OR public.team_is_admin();
  SELECT c.id INTO _me FROM public.consultants c WHERE c.user_id = auth.uid();
  IF NOT _all AND _me IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.id, m.consultant_id, public.team_consultant_name(m.consultant_id), p.avatar_url, m.engagement_mode, m.team_role, m.is_primary,
         m.status, m.is_legacy, public.team_gates(m.id), public.team_next_step(m.id), m.availability_note,
         ra.hourly_rate, rp.hourly_rate, COALESCE(ra.currency, rp.currency), COALESCE(ra.surcharge_percent, rp.surcharge_percent),
         (SELECT to_jsonb(ec) - 'client_id' FROM public.engagement_confirmations ec WHERE ec.member_id = m.id AND ec.superseded_at IS NULL),
         m.invited_at, m.viewed_at, m.accepted_at, m.bid_sent_at, m.rate_approved_at, m.nda_signed_at, m.confirmed_at, m.ready_at, m.ended_at,
         m.expires_at, m.notice_until, m.end_reason, m.blocked_reason, m.suggest_next, m.client_nudged_at, m.consultant_nudged_at,
         public.team_ticket_gated(_ticket_id)
    FROM public.ticket_team_members m
    JOIN public.consultants c ON c.id = m.consultant_id
    LEFT JOIN public.profiles p ON p.user_id = c.user_id
    LEFT JOIN public.ticket_rates ra ON ra.ticket_id = m.ticket_id AND ra.consultant_id = m.consultant_id AND ra.status = 'approved'
    LEFT JOIN public.ticket_rates rp ON rp.ticket_id = m.ticket_id AND rp.consultant_id = m.consultant_id AND rp.status = 'proposed'
   WHERE m.ticket_id = _ticket_id AND (_all OR m.consultant_id = _me)
   ORDER BY public.team_live(m.status) DESC, m.is_primary DESC, (m.team_role = 'lead') DESC, m.created_at;
END $$;

-- -----------------------------------------------------------------------------
-- 8. Sync triggers: existing tables drive the team status
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_sync_match_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _client uuid; _title text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  FOR r IN SELECT id, status FROM public.ticket_team_members
            WHERE ticket_id = NEW.ticket_id AND consultant_id = NEW.consultant_id AND NOT is_legacy AND public.team_pre_ready(status) LOOP
    IF NEW.status::text = 'rejected' AND r.status IN ('selected', 'invited', 'viewed') THEN
      -- declined from the existing requests page
      UPDATE public.ticket_team_members SET status = 'declined', declined_at = now(), ended_at = now(), suggest_next = true, expires_at = NULL, is_primary = false
       WHERE id = r.id;
      SELECT t.client_id, t.title INTO _client, _title FROM public.tickets t WHERE t.id = NEW.ticket_id;
      PERFORM public.team_notify(_client, 'Invitation declined',
        public.team_consultant_name(NEW.consultant_id) || ' declined the invitation for "' || left(COALESCE(_title, 'your request'), 80) || '". See the next best match on the Team panel.',
        '/client/tickets/' || NEW.ticket_id || '?tab=work');
    ELSE
      PERFORM public.team_recompute(r.id);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_team_sync_match_request AFTER UPDATE OF status ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.team_sync_match_request();

CREATE OR REPLACE FUNCTION public.team_sync_proposal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _other boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  _other := EXISTS (SELECT 1 FROM public.proposals p WHERE p.ticket_id = NEW.ticket_id AND p.consultant_id = NEW.consultant_id
                     AND p.id <> NEW.id AND p.status::text IN ('pending', 'accepted'));
  FOR r IN SELECT id, engagement_mode FROM public.ticket_team_members
            WHERE ticket_id = NEW.ticket_id AND consultant_id = NEW.consultant_id AND NOT is_legacy AND public.team_pre_ready(status) LOOP
    IF TG_OP = 'UPDATE' AND NEW.status::text = 'withdrawn' AND COALESCE(NEW.rejection_reason, '') <> 'superseded' AND NOT _other AND r.engagement_mode = 'bid' THEN
      UPDATE public.ticket_team_members SET status = 'withdrawn', end_reason = 'bid_withdrawn', ended_at = now(), suggest_next = true, is_primary = false WHERE id = r.id;
    ELSIF TG_OP = 'UPDATE' AND NEW.status::text = 'rejected' AND NOT _other AND r.engagement_mode = 'bid' THEN
      UPDATE public.ticket_team_members SET status = 'not_selected', end_reason = left(COALESCE(NULLIF(NEW.rejection_reason, ''), 'not_selected'), 500),
        ended_at = now(), is_primary = false WHERE id = r.id;
    ELSE
      IF NEW.status::text IN ('pending', 'accepted') THEN
        UPDATE public.ticket_team_members SET proposal_id = NEW.id WHERE id = r.id;
      END IF;
      PERFORM public.team_recompute(r.id);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_team_sync_proposal AFTER INSERT OR UPDATE OF status ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.team_sync_proposal();

CREATE OR REPLACE FUNCTION public.team_sync_rate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
  FOR r IN SELECT id FROM public.ticket_team_members
            WHERE ticket_id = NEW.ticket_id AND consultant_id = NEW.consultant_id AND NOT is_legacy AND public.team_pre_ready(status) LOOP
    IF NEW.status = 'approved' THEN
      -- a summary confirmed for another rate is no longer valid
      UPDATE public.engagement_confirmations SET superseded_at = now(), superseded_reason = 'rate_changed'
       WHERE member_id = r.id AND superseded_at IS NULL AND rate_id IS DISTINCT FROM NEW.id;
    END IF;
    PERFORM public.team_recompute(r.id);
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_team_sync_rate AFTER INSERT OR UPDATE OF status ON public.ticket_rates
  FOR EACH ROW EXECUTE FUNCTION public.team_sync_rate();

CREATE OR REPLACE FUNCTION public.team_sync_nda()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _cons_user uuid;
BEGIN
  FOR r IN SELECT m.id, m.status, m.ticket_id, m.blocked_reason, t.title FROM public.ticket_team_members m JOIN public.tickets t ON t.id = m.ticket_id
            WHERE m.consultant_id = NEW.consultant_id AND t.client_id = NEW.client_id AND NOT m.is_legacy AND public.team_live(m.status) LOOP
    IF r.status IN ('ready', 'active') THEN
      IF NEW.revoked_at IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.revoked_at IS NULL) AND r.blocked_reason IS NULL THEN
        UPDATE public.ticket_team_members SET blocked_reason = 'nda_revoked' WHERE id = r.id;
        SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
        PERFORM public.team_notify(_cons_user, 'NDA revoked',
          'The NDA with the client was revoked. Remote access for "' || left(COALESCE(r.title, 'the request'), 80) || '" stays closed until a new NDA is signed by both.',
          '/consultant/tickets/' || r.ticket_id);
        PERFORM public.team_notify(NEW.client_id, 'NDA revoked',
          'The NDA with ' || public.team_consultant_name(NEW.consultant_id) || ' was revoked for "' || left(COALESCE(r.title, 'your request'), 80) || '". Sign a new one or remove the consultant on the Team panel.',
          '/client/tickets/' || r.ticket_id || '?tab=work');
      ELSIF NEW.revoked_at IS NULL AND NEW.client_signed_at IS NOT NULL AND r.blocked_reason = 'nda_revoked' THEN
        UPDATE public.ticket_team_members SET blocked_reason = NULL WHERE id = r.id;
      END IF;
    ELSE
      PERFORM public.team_recompute(r.id);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_team_sync_nda AFTER INSERT OR UPDATE ON public.nda_agreements
  FOR EACH ROW EXECUTE FUNCTION public.team_sync_nda();

CREATE OR REPLACE FUNCTION public.team_sync_confirmation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.team_recompute(NEW.member_id);
  RETURN NULL;
END $$;
CREATE TRIGGER trg_team_sync_confirmation AFTER UPDATE ON public.engagement_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.team_sync_confirmation();

-- Client edits the request after inviting: everyone on the team is told (at most once per 10 minutes),
-- and summaries not yet confirmed by both must be confirmed again.
CREATE OR REPLACE FUNCTION public.team_sync_ticket_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF ROW(NEW.title, NEW.description, NEW.sap_modules, NEW.area_details) IS NOT DISTINCT FROM ROW(OLD.title, OLD.description, OLD.sap_modules, OLD.area_details) THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT m.id, m.status, c.user_id FROM public.ticket_team_members m JOIN public.consultants c ON c.id = m.consultant_id
            WHERE m.ticket_id = NEW.id AND NOT m.is_legacy AND public.team_live(m.status) LOOP
    IF public.team_pre_ready(r.status) THEN
      UPDATE public.engagement_confirmations SET superseded_at = now(), superseded_reason = 'ticket_edited'
       WHERE member_id = r.id AND superseded_at IS NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = r.user_id AND n.title = 'Request updated'
                    AND n.link LIKE '%' || NEW.id::text || '%' AND n.created_at > now() - interval '10 minutes') THEN
      PERFORM public.team_notify(r.user_id, 'Request updated',
        'The client updated "' || left(COALESCE(NEW.title, 'the request'), 80) || '". Please review the changes'
          || CASE WHEN public.team_pre_ready(r.status) THEN ' before you confirm.' ELSE '.' END,
        CASE WHEN public.team_pre_ready(r.status) THEN '/consultant/requests?ticket=' || NEW.id ELSE '/consultant/tickets/' || NEW.id END);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_team_sync_ticket_edit AFTER UPDATE OF title, description, sap_modules, area_details ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.team_sync_ticket_edit();

-- First logged hours: Ready -> Active.
CREATE OR REPLACE FUNCTION public.team_mark_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ticket_team_members SET status = 'active'
   WHERE ticket_id = NEW.ticket_id AND consultant_id = NEW.consultant_id AND status = 'ready';
  RETURN NULL;
END $$;
CREATE TRIGGER trg_team_mark_active AFTER INSERT ON public.ticket_work_logs
  FOR EACH ROW EXECUTE FUNCTION public.team_mark_active();

-- Assignments made outside the team flow (non-gated tickets, admin overrides) get a matching team row,
-- so a later team invitation never locks out a consultant who is already working.
CREATE OR REPLACE FUNCTION public.team_ensure_member(_ticket_id uuid, _consultant_id uuid, _lead boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _st text;
BEGIN
  IF _ticket_id IS NULL OR _consultant_id IS NULL THEN RETURN; END IF;
  SELECT id, status INTO _id, _st FROM public.ticket_team_members
   WHERE ticket_id = _ticket_id AND consultant_id = _consultant_id AND public.team_live(status);
  IF _id IS NULL THEN
    PERFORM set_config('app.team_reason', 'assigned outside the team flow', true);
    INSERT INTO public.ticket_team_members (ticket_id, consultant_id, engagement_mode, team_role, status, is_legacy, accepted_at, ready_at, created_by)
    VALUES (_ticket_id, _consultant_id, 'normal', CASE WHEN _lead THEN 'lead' ELSE 'support' END, 'active', true, now(), now(), auth.uid());
    PERFORM set_config('app.team_reason', '', true);
  ELSIF public.team_pre_ready(_st) THEN
    -- on a gated ticket only an administrator gets here (the guards block everyone else);
    -- with the kill switch off, a direct assignment also lands here
    PERFORM set_config('app.team_reason', 'assigned directly', true);
    UPDATE public.ticket_team_members SET status = 'ready', ready_at = now(), expires_at = NULL WHERE id = _id;
    PERFORM set_config('app.team_reason', '', true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.team_sync_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.team_activation', true) = '1' THEN RETURN NULL; END IF;
  IF TG_OP <> 'DELETE' THEN
    IF NEW.status::text = 'active' THEN
      PERFORM public.team_ensure_member(NEW.ticket_id, NEW.consultant_id, NEW.role::text = 'lead');
    END IF;
    IF TG_OP = 'INSERT' OR OLD.status::text <> 'active' OR (NEW.status::text = 'active' AND NEW.consultant_id = OLD.consultant_id) THEN
      RETURN NULL;
    END IF;
  END IF;
  -- an assignment ended (deleted, deactivated or moved to another consultant): end the legacy row
  UPDATE public.ticket_team_members m SET status = 'removed', ended_at = now(), end_reason = 'assignment ended', is_primary = false
   WHERE m.ticket_id = OLD.ticket_id AND m.consultant_id = OLD.consultant_id AND m.is_legacy AND m.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = OLD.ticket_id AND t.consultant_id = OLD.consultant_id)
     AND NOT EXISTS (SELECT 1 FROM public.ticket_assignments a WHERE a.ticket_id = OLD.ticket_id AND a.consultant_id = OLD.consultant_id AND a.status = 'active');
  RETURN NULL;
END $$;
CREATE TRIGGER trg_team_sync_assignment AFTER INSERT OR UPDATE OF status, consultant_id OR DELETE ON public.ticket_assignments
  FOR EACH ROW EXECUTE FUNCTION public.team_sync_assignment();

CREATE OR REPLACE FUNCTION public.team_sync_ticket_consultant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.team_activation', true) = '1' THEN RETURN NULL; END IF;
  IF NEW.consultant_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.consultant_id IS DISTINCT FROM OLD.consultant_id) THEN
    PERFORM public.team_ensure_member(NEW.id, NEW.consultant_id, true);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.consultant_id IS NOT NULL AND NEW.consultant_id IS DISTINCT FROM OLD.consultant_id THEN
    UPDATE public.ticket_team_members m SET status = 'removed', ended_at = now(), end_reason = 'unassigned', is_primary = false
     WHERE m.ticket_id = NEW.id AND m.consultant_id = OLD.consultant_id AND m.is_legacy AND m.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM public.ticket_assignments a WHERE a.ticket_id = NEW.id AND a.consultant_id = OLD.consultant_id AND a.status = 'active');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_team_sync_ticket_consultant AFTER INSERT OR UPDATE OF consultant_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.team_sync_ticket_consultant();

-- -----------------------------------------------------------------------------
-- 9. Gate guards (only on gated tickets). Administrators go through the same four gates when adding consultants;
--    they may only skip the removal notice, and every such override is audited.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_guard_ticket()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin boolean;
BEGIN
  IF current_setting('app.team_activation', true) = '1' OR auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NOT public.team_ticket_gated(NEW.id) THEN RETURN NEW; END IF;
  _admin := public.team_is_admin();
  IF NEW.consultant_id IS DISTINCT FROM OLD.consultant_id THEN
    IF NEW.consultant_id IS NOT NULL AND NOT public.team_member_started(NEW.id, NEW.consultant_id) THEN
      RAISE EXCEPTION 'This consultant can start only after all four steps: accepted, hourly rate approved, NDA signed by both and engagement confirmed by both'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.consultant_id IS NOT NULL AND public.team_member_started(NEW.id, OLD.consultant_id) THEN
      IF NOT _admin THEN
        RAISE EXCEPTION 'Use the Team panel to change or remove a consultant (a notice period applies)' USING ERRCODE = '42501';
      END IF;
      PERFORM public.team_audit('team_override.ticket_consultant', 'ticket', NEW.id,
        jsonb_build_object('from_consultant_id', OLD.consultant_id, 'to_consultant_id', NEW.consultant_id));
    END IF;
  END IF;
  IF NEW.status::text = 'in_progress' AND OLD.status::text <> 'in_progress'
     AND NOT EXISTS (SELECT 1 FROM public.ticket_team_members m WHERE m.ticket_id = NEW.id AND m.status IN ('ready', 'active')) THEN
    RAISE EXCEPTION 'Team forming - waiting for confirmations: the request can move to In progress once a consultant has passed all four steps'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_team_guard_ticket BEFORE UPDATE OF consultant_id, status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.team_guard_ticket();

CREATE OR REPLACE FUNCTION public.team_guard_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _admin boolean;
BEGIN
  IF current_setting('app.team_activation', true) = '1' OR auth.uid() IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  _admin := public.team_is_admin();
  IF TG_OP = 'DELETE' THEN
    IF public.team_ticket_gated(OLD.ticket_id) AND OLD.status::text = 'active' AND public.team_member_started(OLD.ticket_id, OLD.consultant_id) THEN
      IF NOT _admin THEN
        RAISE EXCEPTION 'Use the Team panel to remove a consultant (a notice period applies)' USING ERRCODE = '42501';
      END IF;
      PERFORM public.team_audit('team_override.assignment_removed', 'ticket', OLD.ticket_id, jsonb_build_object('consultant_id', OLD.consultant_id));
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status::text = 'active' AND (NEW.status::text <> 'active' OR NEW.consultant_id IS DISTINCT FROM OLD.consultant_id)
     AND public.team_ticket_gated(OLD.ticket_id) AND public.team_member_started(OLD.ticket_id, OLD.consultant_id) THEN
    IF NOT _admin THEN
      RAISE EXCEPTION 'Use the Team panel to remove a consultant (a notice period applies)' USING ERRCODE = '42501';
    END IF;
    PERFORM public.team_audit('team_override.assignment_removed', 'ticket', OLD.ticket_id, jsonb_build_object('consultant_id', OLD.consultant_id));
  END IF;
  IF NEW.status::text = 'active' AND (TG_OP = 'INSERT' OR OLD.status::text <> 'active' OR NEW.consultant_id IS DISTINCT FROM OLD.consultant_id)
     AND public.team_ticket_gated(NEW.ticket_id) AND NOT public.team_member_started(NEW.ticket_id, NEW.consultant_id) THEN
    RAISE EXCEPTION 'This consultant can join the team only after all four steps: accepted, hourly rate approved, NDA signed by both and engagement confirmed by both'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_team_guard_assignment BEFORE INSERT OR UPDATE OR DELETE ON public.ticket_assignments
  FOR EACH ROW EXECUTE FUNCTION public.team_guard_assignment();

CREATE OR REPLACE FUNCTION public.team_guard_work_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.team_ticket_gated(NEW.ticket_id) AND NOT public.team_member_started(NEW.ticket_id, NEW.consultant_id) THEN
    RAISE EXCEPTION 'Time can be logged once all four steps are done: accepted, hourly rate approved, NDA signed by both and engagement confirmed by both'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_team_guard_work_log BEFORE INSERT ON public.ticket_work_logs
  FOR EACH ROW EXECUTE FUNCTION public.team_guard_work_log();

-- -----------------------------------------------------------------------------
-- 10. Access additions (additive; existing branches unchanged)
-- -----------------------------------------------------------------------------
-- Pending team members keep seeing the ticket summary row even after another member became the ticket's consultant
-- (today that branch stops once tickets.consultant_id is set). Files, remote access, chat and contact details still
-- require an active assignment, which only team_activate() creates on gated tickets.
CREATE OR REPLACE FUNCTION public.consultant_has_ticket_link(_ticket_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.ticket_assignments a JOIN public.consultants c ON c.id = a.consultant_id
    WHERE a.ticket_id = _ticket_id AND c.user_id = auth.uid() AND a.status = 'active'
  ) OR EXISTS (
    SELECT 1 FROM public.ticket_match_requests m
    JOIN public.consultants c ON c.id = m.consultant_id
    JOIN public.tickets t ON t.id = m.ticket_id
    WHERE m.ticket_id = _ticket_id AND c.user_id = auth.uid() AND m.status IN ('pending', 'accepted')
      AND (t.consultant_id IS NULL OR t.consultant_id = c.id)
  ) OR EXISTS (
    SELECT 1 FROM public.proposals p
    JOIN public.consultants c ON c.id = p.consultant_id
    JOIN public.tickets t ON t.id = p.ticket_id
    WHERE p.ticket_id = _ticket_id AND c.user_id = auth.uid()
      AND (t.consultant_id IS NULL OR t.consultant_id = c.id)
  ) OR EXISTS (
    SELECT 1 FROM public.ticket_team_members tm JOIN public.consultants c ON c.id = tm.consultant_id
    WHERE tm.ticket_id = _ticket_id AND c.user_id = auth.uid() AND public.team_live(tm.status)
  )
$function$;

-- Invited bidders can still bid when another team member already started.
CREATE POLICY "Invited team members can bid" ON public.proposals FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = proposals.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified')
  AND EXISTS (SELECT 1 FROM public.ticket_team_members tm JOIN public.tickets t ON t.id = tm.ticket_id
              WHERE tm.ticket_id = proposals.ticket_id AND tm.consultant_id = proposals.consultant_id
                AND tm.status IN ('invited', 'viewed', 'bid_sent') AND t.status::text NOT IN ('resolved', 'closed'))
);

-- Started team members on gated tickets see the ticket's files (today only the ticket's main consultant does).
CREATE POLICY "Started team members can view ticket docs" ON public.ticket_documents FOR SELECT TO authenticated
USING (
  public.team_ticket_gated(ticket_id)
  AND EXISTS (SELECT 1 FROM public.ticket_team_members tm JOIN public.consultants c ON c.id = tm.consultant_id
              WHERE tm.ticket_id = ticket_documents.ticket_id AND c.user_id = auth.uid() AND tm.status IN ('ready', 'active'))
);

-- Bid notifications on gated tickets no longer claim the request is assigned.
CREATE OR REPLACE FUNCTION public.notify_proposal_events()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _title text;
  _cons_user uuid;
  _cons_name text;
  _v text;
BEGIN
  SELECT t.client_id, t.title INTO _client, _title FROM public.tickets t WHERE t.id = NEW.ticket_id;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
  SELECT p.display_name INTO _cons_name FROM public.profiles p WHERE p.user_id = _cons_user;
  IF TG_OP = 'INSERT' THEN
    _v := CASE WHEN COALESCE(NEW.version, 1) > 1 THEN ' (v' || NEW.version || ')' ELSE '' END;
    IF _client IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_client, 'New bid received' || _v,
        COALESCE(_cons_name, 'A consultant') || ' bid on "' || COALESCE(_title, 'your request') || '": ' || COALESCE(NEW.proposed_rate::text, '?') || '/hr, '
          || COALESCE(NEW.estimated_hours::text, '?') || ' h estimated.', 'ticket', '/client/tickets/' || NEW.ticket_id || '?tab=bids');
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status::text = 'accepted' AND _cons_user IS NOT NULL THEN
      IF public.team_ticket_gated(NEW.ticket_id) THEN
        PERFORM public.safe_insert_notification(_cons_user, 'Your bid was accepted',
          'The client accepted your bid for "' || COALESCE(_title, 'a request') || '". Next: sign the NDA and confirm the engagement summary before you start.', 'ticket', '/consultant/requests');
      ELSE
        PERFORM public.safe_insert_notification(_cons_user, 'Your bid was accepted',
          'The client accepted your bid for "' || COALESCE(_title, 'a request') || '". The request is now assigned to you.', 'ticket', '/consultant/proposals');
      END IF;
    ELSIF NEW.status::text = 'rejected' AND _cons_user IS NOT NULL THEN
      IF NEW.rejection_reason = 'another_chosen' THEN
        PERFORM public.safe_insert_notification(_cons_user, 'Another consultant was chosen',
          'The client chose another consultant for "' || COALESCE(_title, 'a request') || '". Thank you for bidding.', 'ticket', '/consultant/proposals');
      ELSE
        PERFORM public.safe_insert_notification(_cons_user, 'Your bid was declined',
          'Your bid for "' || COALESCE(_title, 'a request') || '" was declined.' || CASE WHEN NEW.rejection_reason IS NOT NULL AND NEW.rejection_reason <> '' THEN ' Reason: ' || left(NEW.rejection_reason, 200) ELSE '' END,
          'ticket', '/consultant/proposals');
      END IF;
    ELSIF NEW.status::text = 'withdrawn' AND COALESCE(NEW.rejection_reason, '') <> 'superseded' AND _client IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_client, 'A bid was withdrawn',
        COALESCE(_cons_name, 'A consultant') || ' withdrew the bid for "' || COALESCE(_title, 'your request') || '".', 'ticket', '/client/tickets/' || NEW.ticket_id || '?tab=bids');
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.shortlisted IS TRUE AND OLD.shortlisted IS NOT TRUE AND _cons_user IS NOT NULL THEN
    PERFORM public.safe_insert_notification(_cons_user, 'You are on the shortlist',
      'The client shortlisted your bid for "' || COALESCE(_title, 'a request') || '".', 'ticket', '/consultant/proposals');
  END IF;
  RETURN NEW;
END
$function$;

-- Accepted invitations on gated tickets: the client is told the next step, not "you can now choose them".
CREATE OR REPLACE FUNCTION public.notify_match_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client_id uuid;
  _ticket_title text;
  _tenant uuid;
  _consultant_name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    SELECT t.client_id, t.title, t.tenant_id INTO _client_id, _ticket_title, _tenant FROM public.tickets t WHERE t.id = NEW.ticket_id;
    SELECT p.display_name INTO _consultant_name FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id WHERE c.id = NEW.consultant_id;
    IF public.team_ticket_gated(NEW.ticket_id) THEN
      INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
      VALUES (_client_id, 'Consultant Accepted Match',
        'Consultant "' || COALESCE(_consultant_name, 'A consultant') || '" accepted the invitation for "' || COALESCE(_ticket_title, 'your ticket') || '". Next: approve the hourly rate on the Team panel.',
        'match_request', '/client/tickets/' || NEW.ticket_id || '?tab=work', _tenant);
    ELSE
      INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
      VALUES (_client_id, 'Consultant Accepted Match',
        'Consultant "' || COALESCE(_consultant_name, 'A consultant') || '" accepted the match for "' || COALESCE(_ticket_title, 'your ticket') || '". You can now choose them.',
        'match_request', '/client/tickets/' || NEW.ticket_id, _tenant);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Withdrawn invitations: honest wording when the team flow closed them (no answer in time / another consultant chosen).
CREATE OR REPLACE FUNCTION public.notify_match_request_withdrawn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user uuid;
  _title text;
  _why text := COALESCE(current_setting('app.team_reason', true), '');
BEGIN
  IF NEW.status::text = 'withdrawn' AND OLD.status::text IS DISTINCT FROM 'withdrawn' THEN
    IF _why = 'no answer in time' THEN RETURN NEW; END IF;  -- team_sweep sends its own notice
    SELECT c.user_id INTO _consultant_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
    SELECT t.title INTO _title FROM public.tickets t WHERE t.id = NEW.ticket_id;
    IF _consultant_user IS NOT NULL THEN
      IF _why = 'another_chosen' THEN
        PERFORM public.safe_insert_notification(_consultant_user, 'Another consultant was chosen',
          'The client chose another consultant for "' || COALESCE(_title, 'a ticket') || '". Thank you for your time.', 'match_request', '/consultant/requests');
      ELSE
        PERFORM public.safe_insert_notification(_consultant_user, 'Match request withdrawn',
          'The client withdrew the match request for "' || COALESCE(_title, 'a ticket') || '".', 'match_request', '/consultant/requests');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Rate answers: before the start on a gated ticket the next step is the NDA / confirmation, not the timesheet.
-- Identical to the current function except for the wording of the two messages.
CREATE OR REPLACE FUNCTION public.respond_to_ticket_rate(_rate_id uuid, _approve boolean, _note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _r record;
  _title text;
  _cons_user uuid;
  _n text := left(btrim(COALESCE(_note, '')), 500);
  _forming boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT r.id, r.ticket_id, r.consultant_id, r.hourly_rate, r.currency, r.status, t.title INTO _r
    FROM public.ticket_rates r JOIN public.tickets t ON t.id = r.ticket_id
   WHERE r.id = _rate_id AND t.client_id = auth.uid()
   FOR UPDATE OF r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rate not found' USING ERRCODE = '42501';
  END IF;
  IF _r.status <> 'proposed' THEN
    RAISE EXCEPTION 'Only a proposed rate can be approved or declined' USING ERRCODE = '42501';
  END IF;
  IF NOT _approve AND char_length(_n) < 3 THEN
    RAISE EXCEPTION 'Please tell the consultant why the rate is declined' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('rate-respond:' || auth.uid()::text, 60, 3600) THEN
    RAISE EXCEPTION 'Too many answers in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = _r.consultant_id;
  _forming := public.team_ticket_gated(_r.ticket_id) AND NOT public.team_member_started(_r.ticket_id, _r.consultant_id);
  IF _approve THEN
    UPDATE public.ticket_rates SET status = 'replaced'
     WHERE ticket_id = _r.ticket_id AND consultant_id = _r.consultant_id AND status = 'approved';
    UPDATE public.ticket_rates
       SET status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = NULLIF(_n, '')
     WHERE id = _r.id;
    -- the hours logged before any rate was approved get this rate
    UPDATE public.ticket_work_logs SET hourly_rate = _r.hourly_rate
     WHERE ticket_id = _r.ticket_id AND consultant_id = _r.consultant_id AND hourly_rate IS NULL AND submission_id IS NULL;
  ELSE
    UPDATE public.ticket_rates
       SET status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = _n
     WHERE id = _r.id;
  END IF;
  IF _cons_user IS NOT NULL AND _cons_user IS DISTINCT FROM auth.uid() THEN
    PERFORM public.safe_insert_notification(_cons_user,
      CASE WHEN _approve THEN 'Hourly rate approved' ELSE 'Hourly rate declined' END,
      CASE WHEN _approve AND _forming
           THEN 'The client approved ' || public.ts_num(_r.hourly_rate) || ' ' || _r.currency || ' per hour for "' || left(COALESCE(_r.title, 'the ticket'), 80) || '". Next: sign the NDA and confirm the engagement summary.'
           WHEN _approve
           THEN 'The client approved ' || public.ts_num(_r.hourly_rate) || ' ' || _r.currency || ' per hour for "' || left(COALESCE(_r.title, 'the ticket'), 80) || '". You can submit your timesheet now.'
           ELSE 'The client declined ' || public.ts_num(_r.hourly_rate) || ' ' || _r.currency || ' per hour for "' || left(COALESCE(_r.title, 'the ticket'), 80) || '": ' || left(_n, 200)
                || CASE WHEN _forming THEN ' You can propose a new rate on the invitation.' ELSE '' END
      END,
      'ticket', CASE WHEN _forming THEN '/consultant/requests' ELSE '/consultant/tickets/' || _r.ticket_id::text END);
  END IF;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 11. Expiry + scheduled removals (service only; run by pg_cron every minute)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _expired int := 0; _ended int := 0; _requests int := 0;
BEGIN
  FOR r IN SELECT m.id, m.ticket_id, m.consultant_id, t.client_id, t.title, c.user_id AS cons_user
             FROM public.ticket_team_members m
             JOIN public.tickets t ON t.id = m.ticket_id
             JOIN public.consultants c ON c.id = m.consultant_id
            WHERE m.status IN ('invited', 'viewed') AND m.expires_at IS NOT NULL AND m.expires_at <= now()
            ORDER BY m.expires_at
            LIMIT 500
            FOR UPDATE OF m SKIP LOCKED LOOP
    PERFORM set_config('app.team_reason', 'no answer in time', true);
    UPDATE public.ticket_team_members SET status = 'expired', ended_at = now(), end_reason = 'no answer in time', suggest_next = true, is_primary = false
     WHERE id = r.id;
    UPDATE public.ticket_match_requests SET status = 'withdrawn'::public.match_request_status
     WHERE ticket_id = r.ticket_id AND consultant_id = r.consultant_id AND status = 'pending';
    PERFORM public.team_notify(r.client_id, 'No answer in time',
      public.team_consultant_name(r.consultant_id) || ' did not answer in time for "' || left(COALESCE(r.title, 'your request'), 80) || '". See the next best match on the Team panel.',
      '/client/tickets/' || r.ticket_id || '?tab=work');
    PERFORM public.team_notify(r.cons_user, 'Invitation expired',
      'The invitation for "' || left(COALESCE(r.title, 'a request'), 80) || '" expired without an answer.', '/consultant/requests');
    _expired := _expired + 1;
  END LOOP;
  PERFORM set_config('app.team_reason', '', true);

  FOR r IN SELECT m.id FROM public.ticket_team_members m
            WHERE m.notice_until IS NOT NULL AND m.notice_until <= now() AND public.team_live(m.status)
            ORDER BY m.notice_until LIMIT 200 FOR UPDATE SKIP LOCKED LOOP
    PERFORM public.team_finalize_end(r.id);
    _ended := _ended + 1;
  END LOOP;
  _requests := public.team_requests_sweep();  -- section 15
  RETURN jsonb_build_object('expired', _expired, 'ended', _ended, 'requests', _requests);
END $$;

-- -----------------------------------------------------------------------------
-- 12. Function privileges
-- -----------------------------------------------------------------------------
-- internal helpers: not callable through the Data API
REVOKE ALL ON FUNCTION public.team_gates(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_next_step(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_notify(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_audit(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_activate(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_recompute(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_finalize_end(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_end_internal(uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_insert_rate(uuid, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_ensure_member(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_sweep() TO service_role;
REVOKE ALL ON FUNCTION public.team_log_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_sync_match_request() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_sync_proposal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_sync_rate() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_sync_nda() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_sync_confirmation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_sync_ticket_edit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_mark_active() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_sync_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_sync_ticket_consultant() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_guard_ticket() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_guard_assignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_guard_work_log() FROM PUBLIC, anon, authenticated;

-- helpers used inside RLS policies / by the app
GRANT EXECUTE ON FUNCTION public.team_live(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_pre_ready(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_ticket_gated(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.team_member_started(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.team_consultant_name(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_assert_clean_text(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_step_text(text) FROM PUBLIC, anon;

-- actions (each checks the caller itself)
REVOKE ALL ON FUNCTION public.team_invite(uuid, jsonb, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_mark_viewed(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_respond(uuid, boolean, numeric, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_propose_rate(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_accept_bid(uuid, boolean, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_prepare_confirmation(uuid, text, date, text, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_confirm(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_refuse_nda(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_end_member(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_cancel_end(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_replace_member(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_set_role(uuid, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_nudge(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_panel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_invite(uuid, jsonb, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_mark_viewed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_respond(uuid, boolean, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_propose_rate(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_accept_bid(uuid, boolean, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_prepare_confirmation(uuid, text, date, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_confirm(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_refuse_nda(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_end_member(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_cancel_end(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_replace_member(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_set_role(uuid, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_nudge(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_panel(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 13. Copy consultants who already work on tickets (legacy/active). Source rows are untouched.
-- -----------------------------------------------------------------------------
SELECT set_config('app.team_reason', 'legacy backfill', true);

INSERT INTO public.ticket_team_members (ticket_id, consultant_id, engagement_mode, team_role, is_primary, status, is_legacy, accepted_at, ready_at, created_by, created_at)
SELECT a.ticket_id, a.consultant_id, 'normal',
       CASE WHEN a.role::text = 'lead' THEN 'lead' ELSE 'support' END,
       (t.consultant_id IS NOT DISTINCT FROM a.consultant_id),
       'active', true, a.created_at, a.created_at, a.assigned_by, a.created_at
  FROM public.ticket_assignments a
  JOIN public.tickets t ON t.id = a.ticket_id
 WHERE a.status::text = 'active';

INSERT INTO public.ticket_team_members (ticket_id, consultant_id, engagement_mode, team_role, is_primary, status, is_legacy, accepted_at, ready_at, created_at)
SELECT t.id, t.consultant_id, 'normal', 'lead', true, 'active', true, t.updated_at, t.updated_at, t.updated_at
  FROM public.tickets t
 WHERE t.consultant_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.ticket_team_members m WHERE m.ticket_id = t.id AND m.consultant_id = t.consultant_id);

SELECT set_config('app.team_reason', '', true);

-- -----------------------------------------------------------------------------
-- 14. Schedule (every minute so the 30-minute critical window is respected)
-- -----------------------------------------------------------------------------
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'team-engagement-sweep';
SELECT cron.schedule('team-engagement-sweep', '* * * * *', $cron$SELECT public.team_sweep()$cron$);

-- -----------------------------------------------------------------------------
-- 15. Consultant-initiated team requests ("Request an additional consultant")
--     An accepted or working consultant asks the client to add someone. The client (or an
--     administrator) approves, declines or chooses someone else; an approval only INVITES the
--     consultant, who then goes through the normal four gates. The client pays each consultant's
--     own approved rate (payer is always 'client'; no rate sharing between consultants).
--     Free text goes through the M60 contact check; suggested consultants are referenced by id
--     only and shown through public profile cards in the portal.
-- -----------------------------------------------------------------------------
CREATE TABLE public.ticket_team_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  requester_member_id uuid NOT NULL REFERENCES public.ticket_team_members(id) ON DELETE CASCADE,
  requester_consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 300),
  needed_skill text CHECK (needed_skill IS NULL OR char_length(needed_skill) <= 120),
  suggested_consultant_id uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
  chosen_consultant_id uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
  estimated_hours numeric CHECK (estimated_hours IS NULL OR (estimated_hours > 0 AND estimated_hours <= 1000)),
  payer text NOT NULL DEFAULT 'client' CHECK (payer = 'client'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn', 'expired')),
  decision_note text CHECK (decision_note IS NULL OR char_length(decision_note) <= 500),
  decided_by uuid,
  decided_role text CHECK (decided_role IS NULL OR decided_role IN ('client', 'admin', 'consultant', 'system')),
  decided_at timestamptz,
  created_member_id uuid REFERENCES public.ticket_team_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ticket_team_requests IS 'Feature I: a team member asks the client to add a consultant. Written only by team_* request functions.';
CREATE INDEX ticket_team_requests_ticket_idx ON public.ticket_team_requests (ticket_id, status, created_at DESC);
CREATE INDEX ticket_team_requests_requester_idx ON public.ticket_team_requests (requester_consultant_id, created_at DESC);
CREATE INDEX ticket_team_requests_suggested_idx ON public.ticket_team_requests (ticket_id, suggested_consultant_id, status);

GRANT SELECT ON public.ticket_team_requests TO authenticated;
GRANT ALL ON public.ticket_team_requests TO service_role;
ALTER TABLE public.ticket_team_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ticket owners see team requests" ON public.ticket_team_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_id AND t.client_id = auth.uid()));
CREATE POLICY "Company members see team requests" ON public.ticket_team_requests FOR SELECT TO authenticated
  USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Requesters see their own team requests" ON public.ticket_team_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = requester_consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Admins see all team requests" ON public.ticket_team_requests FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Statuses in which a consultant may ask for an additional consultant (accepted onwards, including legacy active).
CREATE OR REPLACE FUNCTION public.team_can_request_status(_status text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _status IN ('accepted', 'rate_approved', 'nda_signed', 'ready', 'active')
$$;

CREATE OR REPLACE FUNCTION public.team_notify_admins(_title text, _body text, _link text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT ur.user_id FROM public.user_roles ur
            WHERE ur.role::text IN ('admin', 'super_admin') LIMIT 20 LOOP
    PERFORM public.team_notify(r.user_id, _title, _body, _link);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.team_request_additional(
  _ticket_id uuid, _reason text, _needed_skill text DEFAULT NULL,
  _suggested_consultant_id uuid DEFAULT NULL, _estimated_hours numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cfg jsonb := public.team_settings(); t record; m public.ticket_team_members; _me uuid; _id uuid; _name text;
  _r text := NULLIF(btrim(COALESCE(_reason, '')), ''); _skill text := NULLIF(btrim(COALESCE(_needed_skill, '')), '');
  _max int := GREATEST(COALESCE((cfg ->> 'max_team_size')::int, 5), 1);
  _pending int := GREATEST(COALESCE((cfg ->> 'team_request_max_pending')::int, 3), 1);
  _cool int := GREATEST(COALESCE((cfg ->> 'team_request_cooldown_hours')::int, 24), 0);
  _redecline int := GREATEST(COALESCE((cfg ->> 'team_request_redecline_days')::int, 7), 0);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  IF NOT COALESCE((cfg ->> 'enabled')::boolean, true) THEN RAISE EXCEPTION 'Team engagement is switched off' USING ERRCODE = '42501'; END IF;
  SELECT c.id INTO _me FROM public.consultants c WHERE c.user_id = auth.uid();
  IF _me IS NULL THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501'; END IF;
  -- one request at a time per consultant, so the limits below cannot be raced
  PERFORM pg_advisory_xact_lock(hashtext('team-request:' || _me::text));

  SELECT tk.id, tk.client_id, tk.title, tk.status::text AS st, tk.sap_modules INTO t FROM public.tickets tk WHERE tk.id = _ticket_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO m FROM public.ticket_team_members tm
   WHERE tm.ticket_id = _ticket_id AND tm.consultant_id = _me AND public.team_can_request_status(tm.status) LIMIT 1;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Only a consultant who accepted this request can ask for an additional consultant' USING ERRCODE = '42501';
  END IF;
  IF t.st IN ('resolved', 'closed') THEN RAISE EXCEPTION 'This ticket is already finished' USING ERRCODE = '22023'; END IF;

  IF _r IS NULL OR char_length(_r) < 3 OR char_length(_r) > 300 THEN
    RAISE EXCEPTION 'Please give a short reason (3 to 300 characters)' USING ERRCODE = '22023';
  END IF;
  PERFORM public.team_assert_clean_text(_r);
  _skill := COALESCE(_skill, NULLIF(array_to_string(t.sap_modules, ', '), ''));
  IF _skill IS NOT NULL THEN
    _skill := left(_skill, 120);
    PERFORM public.team_assert_clean_text(_skill);
  END IF;
  IF _estimated_hours IS NOT NULL AND (_estimated_hours <= 0 OR _estimated_hours > 1000) THEN
    RAISE EXCEPTION 'Estimated extra hours must be between 0 and 1000' USING ERRCODE = '22023';
  END IF;

  IF _suggested_consultant_id IS NOT NULL THEN
    IF _suggested_consultant_id = _me THEN RAISE EXCEPTION 'You cannot suggest yourself' USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _suggested_consultant_id AND c.verification_status = 'verified') THEN
      RAISE EXCEPTION 'Please choose a verified consultant from the portal' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ticket_team_members tm WHERE tm.ticket_id = _ticket_id AND tm.consultant_id = _suggested_consultant_id AND public.team_live(tm.status)) THEN
      RAISE EXCEPTION 'This consultant is already on the team' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ticket_team_requests q WHERE q.ticket_id = _ticket_id AND q.status = 'pending'
                AND _suggested_consultant_id IN (q.suggested_consultant_id, q.chosen_consultant_id)) THEN
      RAISE EXCEPTION 'This consultant is already suggested in an open request' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ticket_team_requests q WHERE q.ticket_id = _ticket_id AND q.status = 'declined'
                AND q.suggested_consultant_id = _suggested_consultant_id
                AND q.decided_at > now() - make_interval(days => _redecline)) THEN
      RAISE EXCEPTION 'The client declined this consultant recently; you can suggest them again after % days', _redecline USING ERRCODE = '54000';
    END IF;
  END IF;

  IF (SELECT count(*) FROM public.ticket_team_members tm WHERE tm.ticket_id = _ticket_id AND public.team_live(tm.status)) >= _max THEN
    RAISE EXCEPTION 'The team is already full (% consultants)', _max USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.ticket_team_requests q WHERE q.ticket_id = _ticket_id AND q.requester_consultant_id = _me AND q.status = 'pending') >= _pending THEN
    RAISE EXCEPTION 'You already have % open team requests on this ticket', _pending USING ERRCODE = '54000';
  END IF;
  IF _cool > 0 AND EXISTS (SELECT 1 FROM public.ticket_team_requests q WHERE q.requester_consultant_id = _me
                            AND q.created_at > now() - make_interval(hours => _cool)) THEN
    RAISE EXCEPTION 'You can send one team request every % hours', _cool USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.ticket_team_requests (ticket_id, requester_member_id, requester_consultant_id, reason, needed_skill, suggested_consultant_id, estimated_hours)
  VALUES (_ticket_id, m.id, _me, _r, _skill, _suggested_consultant_id, _estimated_hours)
  RETURNING id INTO _id;
  PERFORM public.team_audit('team_request.created', 'ticket_team_request', _id,
    jsonb_build_object('ticket_id', _ticket_id, 'requester_consultant_id', _me, 'suggested_consultant_id', _suggested_consultant_id));

  _name := public.team_consultant_name(_me);
  PERFORM public.team_notify(t.client_id, 'Team request',
    _name || ' asks to add a consultant to "' || left(COALESCE(t.title, 'your request'), 80) || '": ' || left(_r, 200),
    '/client/tickets/' || _ticket_id || '?tab=work');
  PERFORM public.team_notify_admins('Team request (copy)',
    _name || ' asks to add a consultant to "' || left(COALESCE(t.title, 'a request'), 80) || '".',
    '/admin/tickets/' || _ticket_id);
  RETURN _id;
END $$;

-- Client (or administrator) answers: 'approve' (invite the suggested consultant), 'choose' (invite someone else) or 'decline'.
CREATE OR REPLACE FUNCTION public.team_decide_request(_request_id uuid, _decision text, _consultant_id uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.ticket_team_requests; t record; _admin boolean := public.team_is_admin(); _req_user uuid; _target uuid;
  _n text := NULLIF(btrim(COALESCE(_note, '')), ''); res jsonb; _member uuid; _why text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO q FROM public.ticket_team_requests WHERE id = _request_id FOR UPDATE;
  SELECT tk.client_id, tk.title INTO t FROM public.tickets tk WHERE tk.id = q.ticket_id;
  IF q.id IS NULL OR (t.client_id IS DISTINCT FROM auth.uid() AND NOT _admin) THEN
    RAISE EXCEPTION 'Team request not found' USING ERRCODE = '42501';
  END IF;
  IF q.status <> 'pending' THEN RAISE EXCEPTION 'This team request was already answered' USING ERRCODE = '22023'; END IF;
  IF _n IS NOT NULL THEN
    IF char_length(_n) > 500 THEN RAISE EXCEPTION 'The note is too long' USING ERRCODE = '22023'; END IF;
    PERFORM public.team_assert_clean_text(_n);
  END IF;
  SELECT c.user_id INTO _req_user FROM public.consultants c WHERE c.id = q.requester_consultant_id;

  IF _decision = 'decline' THEN
    UPDATE public.ticket_team_requests SET status = 'declined', decision_note = _n, decided_by = auth.uid(),
      decided_role = CASE WHEN auth.uid() = t.client_id THEN 'client' ELSE 'admin' END, decided_at = now()
     WHERE id = q.id;
    PERFORM public.team_audit('team_request.declined', 'ticket_team_request', q.id, jsonb_build_object('ticket_id', q.ticket_id));
    PERFORM public.team_notify(_req_user, 'Team request declined',
      'The client declined your request to add a consultant to "' || left(COALESCE(t.title, 'the request'), 80) || '".'
        || COALESCE(' Note: ' || left(_n, 200), ''),
      '/consultant/tickets/' || q.ticket_id);
    RETURN jsonb_build_object('status', 'declined');
  ELSIF _decision NOT IN ('approve', 'choose') THEN
    RAISE EXCEPTION 'Unknown decision' USING ERRCODE = '22023';
  END IF;

  _target := CASE WHEN _decision = 'choose' THEN _consultant_id ELSE COALESCE(_consultant_id, q.suggested_consultant_id) END;
  IF _target IS NULL THEN RAISE EXCEPTION 'Please choose a consultant to invite' USING ERRCODE = '22023'; END IF;
  IF _target = q.requester_consultant_id THEN RAISE EXCEPTION 'This consultant is already on the team' USING ERRCODE = '22023'; END IF;

  -- the normal invitation path: four gates, team size, verified-only, recent-decline rules all apply
  res := public.team_invite(q.ticket_id,
    jsonb_build_array(jsonb_build_object('consultant_id', _target, 'mode', 'normal', 'role', 'support', 'primary', false)),
    'Invited at the request of a team member: ' || q.reason, NULL);
  _member := ((res -> 'invited' -> 0) ->> 'member_id')::uuid;
  IF _member IS NULL THEN
    _why := COALESCE((res -> 'skipped' -> 0) ->> 'reason', CASE WHEN jsonb_array_length(COALESCE(res -> 'already', '[]'::jsonb)) > 0 THEN 'already_on_team' END, 'unknown');
    RAISE EXCEPTION '%', CASE _why
      WHEN 'team_full' THEN 'The team is already full'
      WHEN 'already_on_team' THEN 'This consultant is already on the team'
      WHEN 'not_verified' THEN 'This consultant is not verified'
      WHEN 'declined_recently' THEN 'This consultant declined recently and cannot be invited again yet'
      ELSE 'This consultant could not be invited' END USING ERRCODE = '22023';
  END IF;

  UPDATE public.ticket_team_requests SET status = 'approved', decision_note = _n, decided_by = auth.uid(),
    decided_role = CASE WHEN auth.uid() = t.client_id THEN 'client' ELSE 'admin' END, decided_at = now(),
    chosen_consultant_id = CASE WHEN _target IS DISTINCT FROM q.suggested_consultant_id THEN _target END,
    created_member_id = _member
   WHERE id = q.id;
  PERFORM public.team_audit('team_request.approved', 'ticket_team_request', q.id,
    jsonb_build_object('ticket_id', q.ticket_id, 'invited_consultant_id', _target, 'member_id', _member, 'decision', _decision));
  PERFORM public.team_notify(_req_user, 'Team request approved',
    public.team_consultant_name(_target) || ' was invited to the team for "' || left(COALESCE(t.title, 'the request'), 80)
      || '"' || CASE WHEN _target IS DISTINCT FROM q.suggested_consultant_id AND q.suggested_consultant_id IS NOT NULL
                     THEN ' (the client chose a different consultant)' ELSE '' END
      || '. They start once the four steps are done.',
    '/consultant/tickets/' || q.ticket_id);
  RETURN jsonb_build_object('status', 'approved', 'member_id', _member, 'consultant_id', _target);
END $$;

CREATE OR REPLACE FUNCTION public.team_withdraw_request(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.ticket_team_requests;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO q FROM public.ticket_team_requests WHERE id = _request_id FOR UPDATE;
  IF q.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = q.requester_consultant_id AND c.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Team request not found' USING ERRCODE = '42501';
  END IF;
  IF q.status <> 'pending' THEN RAISE EXCEPTION 'This team request was already answered' USING ERRCODE = '22023'; END IF;
  UPDATE public.ticket_team_requests SET status = 'withdrawn', decided_by = auth.uid(), decided_role = 'consultant', decided_at = now() WHERE id = q.id;
  PERFORM public.team_audit('team_request.withdrawn', 'ticket_team_request', q.id, jsonb_build_object('ticket_id', q.ticket_id));
END $$;

-- Request cards for the ticket page: clients, company colleagues and admins get all; a consultant gets only their own.
-- Display names only; no contact details or private profile fields.
CREATE OR REPLACE FUNCTION public.team_requests(_ticket_id uuid)
RETURNS TABLE (
  request_id uuid, status text, reason text, needed_skill text, estimated_hours numeric, payer text,
  requester_consultant_id uuid, requester_name text, suggested_consultant_id uuid, suggested_name text,
  chosen_consultant_id uuid, chosen_name text, created_member_id uuid, decision_note text, decided_role text,
  decided_at timestamptz, created_at timestamptz, mine boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _all boolean; _me uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  _all := EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket_id AND t.client_id = auth.uid())
          OR public.ticket_in_my_company(_ticket_id) OR public.team_is_admin();
  SELECT c.id INTO _me FROM public.consultants c WHERE c.user_id = auth.uid();
  RETURN QUERY
  SELECT q.id, q.status, q.reason, q.needed_skill, q.estimated_hours, q.payer,
         q.requester_consultant_id, public.team_consultant_name(q.requester_consultant_id),
         q.suggested_consultant_id, CASE WHEN q.suggested_consultant_id IS NOT NULL THEN public.team_consultant_name(q.suggested_consultant_id) END,
         q.chosen_consultant_id, CASE WHEN q.chosen_consultant_id IS NOT NULL THEN public.team_consultant_name(q.chosen_consultant_id) END,
         q.created_member_id, q.decision_note, q.decided_role, q.decided_at, q.created_at,
         (_me IS NOT NULL AND q.requester_consultant_id = _me)
    FROM public.ticket_team_requests q
   WHERE q.ticket_id = _ticket_id AND (_all OR (_me IS NOT NULL AND q.requester_consultant_id = _me))
   ORDER BY q.created_at DESC
   LIMIT 100;
END $$;

-- Called from team_sweep(): open requests end when the requester left, the ticket finished, or nobody answered in 14 days.
CREATE OR REPLACE FUNCTION public.team_requests_sweep()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; _n int := 0;
BEGIN
  FOR r IN SELECT q.id, q.ticket_id FROM public.ticket_team_requests q
             JOIN public.tickets t ON t.id = q.ticket_id
             LEFT JOIN public.ticket_team_members m ON m.id = q.requester_member_id
            WHERE q.status = 'pending'
              AND (m.id IS NULL OR NOT public.team_can_request_status(m.status)
                   OR t.status::text IN ('resolved', 'closed') OR q.created_at < now() - interval '14 days')
            ORDER BY q.created_at LIMIT 500
            FOR UPDATE OF q SKIP LOCKED LOOP
    UPDATE public.ticket_team_requests SET status = 'expired', decided_role = 'system', decided_at = now() WHERE id = r.id;
    PERFORM public.team_audit('team_request.expired', 'ticket_team_request', r.id, jsonb_build_object('ticket_id', r.ticket_id));
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;

-- -----------------------------------------------------------------------------
-- 16. Team thread: one shared conversation per ticket for the client, company colleagues,
--     administrators and members who passed all four gates (ready / active, legacy included).
--     Display names only; text only; M60 contact check on every message. The existing private
--     client-consultant threads (sessions + messages) are unchanged.
-- -----------------------------------------------------------------------------
CREATE TABLE public.ticket_team_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('client', 'consultant', 'admin')),
  sender_consultant_id uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ticket_team_messages IS 'Feature I: shared team thread per ticket. Written only by team_post_message().';
CREATE INDEX ticket_team_messages_ticket_idx ON public.ticket_team_messages (ticket_id, created_at DESC);

GRANT SELECT ON public.ticket_team_messages TO authenticated;
GRANT ALL ON public.ticket_team_messages TO service_role;
ALTER TABLE public.ticket_team_messages ENABLE ROW LEVEL SECURITY;

-- 'client' | 'consultant' | 'admin' when the caller may use the team thread, otherwise NULL.
CREATE OR REPLACE FUNCTION public.team_thread_role(_ticket_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket_id AND t.client_id = auth.uid()) OR public.ticket_in_my_company(_ticket_id) THEN 'client'
    WHEN EXISTS (SELECT 1 FROM public.ticket_team_members m JOIN public.consultants c ON c.id = m.consultant_id
                  WHERE m.ticket_id = _ticket_id AND c.user_id = auth.uid() AND m.status IN ('ready', 'active')) THEN 'consultant'
    WHEN public.team_is_admin() THEN 'admin'
  END
$$;

CREATE POLICY "Team thread participants read messages" ON public.ticket_team_messages FOR SELECT TO authenticated
  USING (public.team_thread_role(ticket_id) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.team_post_message(_ticket_id uuid, _body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _role text := public.team_thread_role(_ticket_id); _b text := NULLIF(btrim(COALESCE(_body, '')), ''); _id uuid; _cons uuid;
  _per_min int := GREATEST(COALESCE((public.team_settings() ->> 'team_chat_per_minute')::int, 20), 1);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  IF _role IS NULL THEN RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501'; END IF;
  IF _b IS NULL OR char_length(_b) > 4000 THEN RAISE EXCEPTION 'Write a message of up to 4000 characters' USING ERRCODE = '22023'; END IF;
  PERFORM public.team_assert_clean_text(_b);
  IF NOT public.check_rate_limit('team-chat:' || auth.uid()::text, _per_min, 60) THEN
    RAISE EXCEPTION 'You are sending messages too quickly; please wait a moment' USING ERRCODE = '54000';
  END IF;
  IF _role = 'consultant' THEN SELECT c.id INTO _cons FROM public.consultants c WHERE c.user_id = auth.uid(); END IF;
  INSERT INTO public.ticket_team_messages (ticket_id, sender_id, sender_role, sender_consultant_id, body)
  VALUES (_ticket_id, auth.uid(), _role, _cons, _b) RETURNING id INTO _id;
  RETURN _id;
END $$;

-- Thread page (newest first). Names: consultant display name, client display name, or "Administrator".
CREATE OR REPLACE FUNCTION public.team_thread(_ticket_id uuid, _before timestamptz DEFAULT NULL, _limit integer DEFAULT 50)
RETURNS TABLE (message_id uuid, sender_role text, sender_name text, mine boolean, body text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.team_thread_role(_ticket_id) IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT tm.id, tm.sender_role,
         CASE tm.sender_role
           WHEN 'consultant' THEN public.team_consultant_name(tm.sender_consultant_id)
           WHEN 'admin' THEN 'Administrator'
           ELSE COALESCE((SELECT NULLIF(btrim(p.display_name), '') FROM public.profiles p WHERE p.user_id = tm.sender_id), 'Client') END,
         tm.sender_id = auth.uid(), tm.body, tm.created_at
    FROM public.ticket_team_messages tm
   WHERE tm.ticket_id = _ticket_id AND (_before IS NULL OR tm.created_at < _before)
   ORDER BY tm.created_at DESC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 100);
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ticket_team_messages;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 17. Privileges for sections 15 and 16
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.team_notify_admins(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_requests_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_requests_sweep() TO service_role;
GRANT EXECUTE ON FUNCTION public.team_can_request_status(text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.team_thread_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_thread_role(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.team_request_additional(uuid, text, text, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_decide_request(uuid, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_withdraw_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_requests(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_post_message(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.team_thread(uuid, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_request_additional(uuid, text, text, uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_decide_request(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_withdraw_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_requests(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_post_message(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_thread(uuid, timestamptz, integer) TO authenticated;

-- =============================================================================
-- To switch the gates off without removing anything:
--   UPDATE public.platform_settings SET value = value || '{"enabled": false}'::jsonb WHERE key = 'team_engagement';
-- =============================================================================
