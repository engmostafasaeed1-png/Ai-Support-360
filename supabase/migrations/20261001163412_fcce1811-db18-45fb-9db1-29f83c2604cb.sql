-- Client-cycle hardening M8 (findings F29, F11, F28):
-- a ticket the client did not offer to consultants is no longer readable by every verified consultant (so a private invitation is private),
-- the extra consultants of a meeting are told by the database, the cost / effort plan flow tells both sides.

-- ---------------------------------------------------------------------------------------------
-- F29: a consultant sees a ticket only when the client offered it (open for bids), invited the consultant
-- (match request / proposal / assignment) or assigned them. The dropped policy let every verified consultant read every new ticket.
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Consultants can view open tickets for bidding" ON public.tickets;

-- ---------------------------------------------------------------------------------------------
-- F11 (meetings): the client invites extra consultants to a meeting; the notices are created by the database.
-- (the consultant of the session itself is already told by the session trigger)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_to_meeting(_session_id uuid, _consultant_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
  _title text;
  _c record;
  _n integer := 0;
  _when text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _consultant_ids IS NULL OR cardinality(_consultant_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(_consultant_ids) > 20 THEN
    RAISE EXCEPTION 'Too many invitees' USING ERRCODE = '22023';
  END IF;
  SELECT s.id, s.client_id, s.consultant_id, s.ticket_id, s.scheduled_at, s.session_type, s.meeting_url INTO _s
  FROM public.sessions s WHERE s.id = _session_id;
  IF NOT FOUND OR _s.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Meeting not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('meeting-invite:' || auth.uid()::text, 40, 3600) THEN
    RAISE EXCEPTION 'Too many invitations in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  SELECT t.title INTO _title FROM public.tickets t WHERE t.id = _s.ticket_id;
  _when := CASE WHEN _s.scheduled_at IS NOT NULL
                THEN to_char(_s.scheduled_at AT TIME ZONE 'UTC', 'Mon DD, YYYY "at" HH24:MI "UTC"')
                ELSE 'a time to be agreed' END;
  FOR _c IN
    SELECT c.user_id FROM public.consultants c
    WHERE c.id = ANY (_consultant_ids) AND c.verification_status = 'verified' AND c.id IS DISTINCT FROM _s.consultant_id
  LOOP
    PERFORM public.safe_insert_notification(_c.user_id, 'Meeting Invitation',
      'You are invited to a ' || COALESCE(_s.session_type::text, 'meeting') || ' meeting for "' || COALESCE(_title, 'a ticket') || '" on ' || _when
        || CASE WHEN _s.meeting_url IS NOT NULL THEN '. Join: ' || _s.meeting_url ELSE '.' END,
      'session', '/consultant/cases');
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$function$;
REVOKE ALL ON FUNCTION public.invite_to_meeting(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_meeting(uuid, uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- F28: the plan flow. The consultant's submission now tells the client; the client's answer tells the consultant.
-- (same signature and defaults as before)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_ticket_plan(_ticket_id uuid, _planned_hours numeric, _planned_cost numeric, _cost_currency text DEFAULT 'USD', _breakdown jsonb DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _t record;
  _cur text := COALESCE(NULLIF(btrim(_cost_currency), ''), 'USD');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _planned_hours IS NULL OR _planned_hours <= 0 OR _planned_hours > 10000 OR _planned_cost IS NULL OR _planned_cost < 0 OR _planned_cost > 100000000 THEN
    RAISE EXCEPTION 'Please enter a valid number of hours and a valid cost' USING ERRCODE = '22023';
  END IF;
  SELECT t.id, t.client_id, t.title INTO _t
  FROM public.tickets t
  JOIN public.consultants c ON c.id = t.consultant_id
  WHERE t.id = _ticket_id AND c.user_id = auth.uid() AND c.verification_status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the consultant assigned to this ticket can submit a plan' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tickets SET
    planned_hours = _planned_hours,
    planned_cost = _planned_cost,
    cost_currency = _cur,
    cost_breakdown = _breakdown,
    plan_submitted_at = now(),
    plan_approved_at = NULL,
    plan_approved_by = NULL,
    plan_rejected_at = NULL,
    plan_rejection_reason = NULL
  WHERE id = _ticket_id;
  PERFORM public.notify_unread_once(_t.client_id, 'Plan awaiting your approval',
    'A cost and effort plan (' || _planned_hours || ' h, ' || _planned_cost || ' ' || _cur || ') was submitted for "' || COALESCE(_t.title, 'your ticket') || '". Please review it.',
    'ticket', '/client/tickets/' || _ticket_id);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_ticket_plan(uuid, numeric, numeric, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_ticket_plan(uuid, numeric, numeric, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_plan_decision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _cons_user uuid;
BEGIN
  IF NEW.consultant_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
  IF _cons_user IS NULL OR _cons_user IS NOT DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;
  IF NEW.plan_approved_at IS NOT NULL AND OLD.plan_approved_at IS DISTINCT FROM NEW.plan_approved_at THEN
    PERFORM public.safe_insert_notification(_cons_user, 'Plan approved',
      'The client approved your plan for "' || NEW.title || '". You can start working.', 'ticket', '/consultant/cases/' || NEW.id);
  ELSIF NEW.plan_rejected_at IS NOT NULL AND OLD.plan_rejected_at IS DISTINCT FROM NEW.plan_rejected_at THEN
    PERFORM public.safe_insert_notification(_cons_user, 'Plan rejected',
      'The client asked for a revised plan for "' || NEW.title || '"'
        || CASE WHEN NEW.plan_rejection_reason IS NOT NULL THEN ': ' || left(NEW.plan_rejection_reason, 300) ELSE '.' END,
      'ticket', '/consultant/cases/' || NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_plan_decision() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_plan_decision ON public.tickets;
CREATE TRIGGER trg_notify_plan_decision AFTER UPDATE OF plan_approved_at, plan_rejected_at ON public.tickets
  FOR EACH ROW
  WHEN (OLD.plan_approved_at IS DISTINCT FROM NEW.plan_approved_at OR OLD.plan_rejected_at IS DISTINCT FROM NEW.plan_rejected_at)
  EXECUTE FUNCTION public.notify_plan_decision();