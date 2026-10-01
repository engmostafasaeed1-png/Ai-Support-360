-- Client-cycle hardening M4 (findings F11, F09, F21):
-- notifications along the client journey are created by the database (the browser can not write them for other people),
-- ratings feed the consultant profile and are announced, the survey notice links to a page the recipient can use.

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
-- one unread notice per (user, title, link): chatty events (chat, hours) do not flood the bell
CREATE OR REPLACE FUNCTION public.notify_unread_once(_user_id uuid, _title text, _body text, _type text, _link text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _user_id IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = _user_id AND n.title = _title AND n.link IS NOT DISTINCT FROM _link AND COALESCE(n.is_read, false) = false
  ) THEN
    RETURN;
  END IF;
  PERFORM public.safe_insert_notification(_user_id, _title, _body, _type, _link);
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_unread_once(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recompute_consultant_rating(_consultant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.consultants c SET
    rating = COALESCE((SELECT round(avg(r.score)::numeric, 2) FROM public.ratings r WHERE r.consultant_id = _consultant_id), 0),
    total_reviews = (SELECT count(*)::integer FROM public.ratings r WHERE r.consultant_id = _consultant_id)
  WHERE c.id = _consultant_id
$function$;
REVOKE ALL ON FUNCTION public.recompute_consultant_rating(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Proposals: the client hears about a new offer, the consultant hears the answer
-- ---------------------------------------------------------------------------------------------
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
  IF TG_OP = 'INSERT' THEN
    SELECT p.display_name INTO _cons_name FROM public.profiles p WHERE p.user_id = _cons_user;
    _v := CASE WHEN COALESCE(NEW.version, 1) > 1 THEN ' (v' || NEW.version || ')' ELSE '' END;
    IF _client IS NOT NULL THEN
      PERFORM public.safe_insert_notification(
        _client,
        'New Proposal Received' || _v,
        COALESCE(_cons_name, 'A consultant') || ' submitted a proposal' || _v || ' for "' || COALESCE(_title, 'your ticket') || '" - '
          || COALESCE(NEW.proposed_rate::text, '?') || '/hr, ' || COALESCE(NEW.estimated_hours::text, '?') || ' h estimated.',
        'ticket',
        '/client/tickets/' || NEW.ticket_id
      );
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('accepted', 'rejected') THEN
    IF _cons_user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(
        _cons_user,
        CASE WHEN NEW.status::text = 'accepted' THEN 'Proposal Accepted' ELSE 'Proposal Declined' END,
        'Your proposal for "' || COALESCE(_title, 'a ticket') || '" was ' || NEW.status::text || '.',
        'ticket',
        '/consultant/proposals'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_proposal_events() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_proposal_events ON public.proposals;
CREATE TRIGGER trg_notify_proposal_events AFTER INSERT OR UPDATE OF status ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.notify_proposal_events();

-- ---------------------------------------------------------------------------------------------
-- Sessions: rescheduled / cancelled / completed (confirmed and started already exist)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_session_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _cons_user uuid;
  _actor uuid := auth.uid();
  _type text;
  _when text;
  _title text;
  _body text;
  _extra text := '';
BEGIN
  IF NEW.consultant_id IS NOT NULL THEN
    SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
  END IF;
  _type := COALESCE(NEW.session_type::text, 'session');
  IF NEW.status::text = 'scheduled' AND OLD.status::text = 'scheduled' AND NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
    _when := CASE WHEN NEW.scheduled_at IS NOT NULL
                  THEN to_char(NEW.scheduled_at AT TIME ZONE 'UTC', 'Mon DD, YYYY "at" HH24:MI "UTC"')
                  ELSE 'a new time' END;
    _title := 'Session Rescheduled';
    _body := 'Your ' || _type || ' session has been moved to ' || _when || '.';
  ELSIF NEW.status::text = 'cancelled' AND OLD.status::text <> 'cancelled' THEN
    _title := 'Session Cancelled';
    _body := 'Your ' || _type || ' session was cancelled.';
  ELSIF NEW.status::text = 'completed' AND OLD.status::text <> 'completed' THEN
    _title := 'Session Completed';
    _body := 'Your ' || _type || ' session has ended.';
    _extra := ' Please take a moment to rate it.';
  ELSE
    RETURN NEW;
  END IF;
  IF NEW.client_id IS NOT NULL AND _actor IS DISTINCT FROM NEW.client_id THEN
    PERFORM public.safe_insert_notification(NEW.client_id, _title, _body || _extra, 'session', '/client/sessions/' || NEW.id);
  END IF;
  IF _cons_user IS NOT NULL AND _actor IS DISTINCT FROM _cons_user THEN
    PERFORM public.safe_insert_notification(_cons_user, _title, _body, 'session', '/consultant/sessions/' || NEW.id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_session_changes() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_session_changes ON public.sessions;
CREATE TRIGGER trg_notify_session_changes AFTER UPDATE ON public.sessions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.scheduled_at IS DISTINCT FROM NEW.scheduled_at)
  EXECUTE FUNCTION public.notify_session_changes();

-- ---------------------------------------------------------------------------------------------
-- Chat, hours and timesheets
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _cons_user uuid;
  _to uuid;
  _link text;
BEGIN
  IF NEW.message_type::text = 'system' THEN
    RETURN NEW;
  END IF;
  SELECT s.client_id, c.user_id INTO _client, _cons_user
  FROM public.sessions s LEFT JOIN public.consultants c ON c.id = s.consultant_id
  WHERE s.id = NEW.session_id;
  IF NEW.sender_id = _client THEN
    _to := _cons_user;
    _link := '/consultant/chat/' || NEW.session_id;
  ELSIF NEW.sender_id = _cons_user THEN
    _to := _client;
    _link := '/client/chat/' || NEW.session_id;
  ELSE
    RETURN NEW;
  END IF;
  PERFORM public.notify_unread_once(_to, 'New message', 'You have a new message in your session chat.', 'session', _link);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_chat_message() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_chat_message ON public.messages;
CREATE TRIGGER trg_notify_chat_message AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_chat_message();

CREATE OR REPLACE FUNCTION public.notify_work_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _title text;
BEGIN
  SELECT t.client_id, t.title INTO _client, _title FROM public.tickets t WHERE t.id = NEW.ticket_id;
  PERFORM public.notify_unread_once(_client, 'Hours logged on your ticket',
    'New hours were logged on "' || COALESCE(_title, 'your ticket') || '".', 'ticket', '/client/tickets/' || NEW.ticket_id);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_work_log() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_work_log ON public.ticket_work_logs;
CREATE TRIGGER trg_notify_work_log AFTER INSERT ON public.ticket_work_logs
  FOR EACH ROW EXECUTE FUNCTION public.notify_work_log();

CREATE OR REPLACE FUNCTION public.notify_timesheet_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _title text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'submitted' THEN
    RETURN NEW;
  END IF;
  SELECT t.client_id, t.title INTO _client, _title FROM public.tickets t WHERE t.id = NEW.ticket_id;
  IF _client IS NOT NULL AND NEW.submitted_by IS DISTINCT FROM _client THEN
    PERFORM public.safe_insert_notification(_client, 'Timesheet submitted for your approval',
      'A timesheet (' || COALESCE(NEW.total_hours::text, '?') || ' h) was submitted for "' || COALESCE(_title, 'your ticket') || '".',
      'ticket', '/client/tickets/' || NEW.ticket_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_timesheet_submitted() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_timesheet_submitted ON public.ticket_timesheet_submissions;
CREATE TRIGGER trg_notify_timesheet_submitted AFTER INSERT ON public.ticket_timesheet_submissions
  FOR EACH ROW EXECUTE FUNCTION public.notify_timesheet_submitted();

-- ---------------------------------------------------------------------------------------------
-- Milestones
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_milestone_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _cons_user uuid;
  _ptitle text;
  _actor uuid := auth.uid();
  _body text;
BEGIN
  IF NEW.escrow_status IS NOT DISTINCT FROM OLD.escrow_status THEN
    RETURN NEW;
  END IF;
  SELECT p.client_id, p.title, c.user_id INTO _client, _ptitle, _cons_user
  FROM public.projects p LEFT JOIN public.consultants c ON c.id = p.consultant_id
  WHERE p.id = NEW.project_id;
  _body := 'Milestone "' || NEW.title || '" of project "' || COALESCE(_ptitle, 'your project') || '"';
  IF NEW.escrow_status::text = 'funded' AND _cons_user IS NOT NULL AND _actor IS DISTINCT FROM _cons_user THEN
    PERFORM public.safe_insert_notification(_cons_user, 'Milestone funded', _body || ' is funded - you can start.', 'payment', '/consultant/cases');
  ELSIF NEW.escrow_status::text = 'submitted' AND _client IS NOT NULL AND _actor IS DISTINCT FROM _client THEN
    PERFORM public.safe_insert_notification(_client, 'Milestone submitted for approval', _body || ' was submitted for your approval.', 'payment', '/client/milestones');
  ELSIF NEW.escrow_status::text = 'approved' AND _cons_user IS NOT NULL AND _actor IS DISTINCT FROM _cons_user THEN
    PERFORM public.safe_insert_notification(_cons_user, 'Milestone approved', _body || ' was approved.', 'payment', '/consultant/cases');
  ELSIF NEW.escrow_status::text = 'released' AND _cons_user IS NOT NULL AND _actor IS DISTINCT FROM _cons_user THEN
    PERFORM public.safe_insert_notification(_cons_user, 'Milestone released', _body || ' was released.', 'payment', '/consultant/earnings');
  ELSIF NEW.escrow_status::text = 'disputed' THEN
    IF _client IS NOT NULL AND _actor IS DISTINCT FROM _client THEN
      PERFORM public.safe_insert_notification(_client, 'Milestone disputed', _body || ' is now disputed.', 'payment', '/client/milestones');
    END IF;
    IF _cons_user IS NOT NULL AND _actor IS DISTINCT FROM _cons_user THEN
      PERFORM public.safe_insert_notification(_cons_user, 'Milestone disputed', _body || ' is now disputed.', 'payment', '/consultant/cases');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_milestone_events() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_milestone_events ON public.milestones;
CREATE TRIGGER trg_notify_milestone_events AFTER UPDATE OF escrow_status ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.notify_milestone_events();

-- ---------------------------------------------------------------------------------------------
-- Invoice disputes: admins and the consultant hear about a new one, the client hears the outcome
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_dispute_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _admin record;
  _cons_user uuid;
BEGIN
  IF NEW.consultant_id IS NOT NULL THEN
    SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
  END IF;
  IF TG_OP = 'INSERT' THEN
    FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
      PERFORM public.safe_insert_notification(_admin.user_id, 'Invoice dispute opened',
        'A client disputed an invoice (' || COALESCE(NEW.reason_category, 'other') || ').', 'payment', '/admin');
    END LOOP;
    IF _cons_user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_cons_user, 'A client disputed your invoice',
        'A client opened a dispute (' || COALESCE(NEW.reason_category, 'other') || '). The platform team will review it.', 'payment', '/consultant/earnings');
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.safe_insert_notification(NEW.client_id, 'Dispute ' || replace(COALESCE(NEW.status, 'updated'), '_', ' '),
      'Your invoice dispute is now "' || replace(COALESCE(NEW.status, 'updated'), '_', ' ') || '".'
        || CASE WHEN NEW.resolution_notes IS NOT NULL THEN ' ' || NEW.resolution_notes ELSE '' END,
      'payment', '/client/invoices');
    IF _cons_user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_cons_user, 'Invoice dispute ' || replace(COALESCE(NEW.status, 'updated'), '_', ' '),
        'The dispute on your invoice is now "' || replace(COALESCE(NEW.status, 'updated'), '_', ' ') || '".', 'payment', '/consultant/earnings');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_dispute_events() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_dispute_events ON public.invoice_disputes;
CREATE TRIGGER trg_notify_dispute_events AFTER INSERT OR UPDATE OF status ON public.invoice_disputes
  FOR EACH ROW EXECUTE FUNCTION public.notify_dispute_events();

-- ---------------------------------------------------------------------------------------------
-- Extra consultants added to a ticket
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_assignment_added()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _cons_user uuid;
  _title text;
BEGIN
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
  SELECT t.title INTO _title FROM public.tickets t WHERE t.id = NEW.ticket_id;
  IF _cons_user IS NOT NULL AND _cons_user IS DISTINCT FROM auth.uid() THEN
    PERFORM public.safe_insert_notification(_cons_user, 'Added to a ticket',
      'You were added as ' || NEW.role::text || ' on "' || COALESCE(_title, 'a ticket') || '".', 'ticket', '/consultant/cases/' || NEW.ticket_id);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_assignment_added() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_assignment_added ON public.ticket_assignments;
CREATE TRIGGER trg_notify_assignment_added AFTER INSERT ON public.ticket_assignments
  FOR EACH ROW EXECUTE FUNCTION public.notify_assignment_added();

-- ---------------------------------------------------------------------------------------------
-- F09: ratings feed the consultant profile and are announced (without naming the client)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.on_rating_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _cons_user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_consultant_rating(OLD.consultant_id);
    RETURN OLD;
  END IF;
  PERFORM public.recompute_consultant_rating(NEW.consultant_id);
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
  IF _cons_user IS NOT NULL THEN
    PERFORM public.safe_insert_notification(_cons_user, 'New rating received',
      'A client rated a session: ' || NEW.score || '/5.', 'info', '/consultant/reviews');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.on_rating_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_on_rating_change ON public.ratings;
CREATE TRIGGER trg_on_rating_change AFTER INSERT OR DELETE ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.on_rating_change();

CREATE OR REPLACE FUNCTION public.notify_csat_received()
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
  IF _cons_user IS NOT NULL THEN
    PERFORM public.safe_insert_notification(_cons_user, 'Client satisfaction received',
      'A client rated a ticket you worked on: ' || NEW.rating || '/5.', 'info', '/consultant/reviews');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_csat_received() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_notify_csat_received ON public.ticket_satisfaction_surveys;
CREATE TRIGGER trg_notify_csat_received AFTER INSERT ON public.ticket_satisfaction_surveys
  FOR EACH ROW EXECUTE FUNCTION public.notify_csat_received();

-- ---------------------------------------------------------------------------------------------
-- F21: the survey notice links to a page the recipient is allowed to use (same function name and trigger as before)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_satisfaction_survey_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (
    NEW.rated_by,
    'Satisfaction Survey Requested',
    'Please rate your recent experience. Your feedback helps us improve.',
    'survey',
    CASE WHEN NEW.role = 'consultant' THEN '/consultant/satisfaction' ELSE '/client/satisfaction' END
  );
  RETURN NEW;
END;
$function$;