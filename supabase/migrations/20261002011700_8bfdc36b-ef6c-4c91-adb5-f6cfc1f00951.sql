-- Client-cycle hardening M11 (new finding F31 and the database side of finding F22):
-- A. Match requests: a consultant could re-point their own request to ANY ticket (which then opened that ticket to them and made them
--    "related" to its client) and rewrite who sent it and its text. Those columns are now frozen. A consultant can only accept or reject
--    a pending request; the client can only withdraw a pending one (new) and the consultant is told.
-- B. NDAs: the client can revoke an NDA (and nothing else: the signed content stays frozen); the consultant is told.
-- C. Projects: the client can edit their own project (not its owner / company, nor its consultant once set); the consultant is told about a status change.
-- D. Tickets: the assigned consultant can hand the ticket back to the client, resume work or mark it resolved through one function (30 changes per hour).

-- ===== A. match requests =====
CREATE FUNCTION public.guard_match_request_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _is_ticket_owner boolean;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.ticket_id, NEW.consultant_id, NEW.sent_by, NEW.message, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.ticket_id, OLD.consultant_id, OLD.sent_by, OLD.message, OLD.created_at) THEN
    RAISE EXCEPTION 'A match request can not be re-pointed or rewritten' USING ERRCODE = '42501';
  END IF;
  _is_ticket_owner := EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = OLD.ticket_id AND t.client_id = auth.uid());
  IF _is_ticket_owner THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status::text = 'pending' AND NEW.status::text = 'withdrawn') THEN
      RAISE EXCEPTION 'The client can only withdraw a pending match request' USING ERRCODE = '42501';
    END IF;
    IF NEW.responded_at IS DISTINCT FROM OLD.responded_at THEN
      RAISE EXCEPTION 'The answer time is set by the consultant' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status::text = 'pending' AND NEW.status::text IN ('accepted', 'rejected')) THEN
      RAISE EXCEPTION 'The consultant can only accept or reject a pending match request' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_match_request_columns() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_match_request_columns BEFORE UPDATE ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_match_request_columns();

CREATE POLICY "Clients can withdraw match requests on own tickets" ON public.ticket_match_requests
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_match_requests.ticket_id AND t.client_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_match_requests.ticket_id AND t.client_id = auth.uid()));

CREATE FUNCTION public.notify_match_request_withdrawn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user uuid;
  _title text;
BEGIN
  IF NEW.status::text = 'withdrawn' AND OLD.status::text IS DISTINCT FROM 'withdrawn' THEN
    SELECT c.user_id INTO _consultant_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
    SELECT t.title INTO _title FROM public.tickets t WHERE t.id = NEW.ticket_id;
    IF _consultant_user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_consultant_user, 'Match request withdrawn',
        'The client withdrew the match request for "' || COALESCE(_title, 'a ticket') || '".', 'match_request', '/consultant/requests');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_match_request_withdrawn() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_notify_match_request_withdrawn AFTER UPDATE OF status ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_match_request_withdrawn();

-- ===== B. NDA revocation =====
CREATE FUNCTION public.guard_nda_revocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.consultant_id, NEW.client_id, NEW.signature_data, NEW.signature_type, NEW.nda_content, NEW.ip_address, NEW.signed_at, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.consultant_id, OLD.client_id, OLD.signature_data, OLD.signature_type, OLD.nda_content, OLD.ip_address, OLD.signed_at, OLD.created_at) THEN
    RAISE EXCEPTION 'A signed NDA can not be edited; it can only be revoked' USING ERRCODE = '42501';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This NDA is already revoked' USING ERRCODE = '42501';
  END IF;
  IF NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'The only change allowed on a signed NDA is to revoke it' USING ERRCODE = '42501';
  END IF;
  NEW.revoked_at := now();
  NEW.revoked_by := auth.uid();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_nda_revocation() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_nda_revocation BEFORE UPDATE ON public.nda_agreements
  FOR EACH ROW EXECUTE FUNCTION public.guard_nda_revocation();

CREATE POLICY "Clients can revoke their NDAs" ON public.nda_agreements
  FOR UPDATE TO authenticated
  USING (auth.uid() = client_id AND revoked_at IS NULL)
  WITH CHECK (auth.uid() = client_id);

CREATE FUNCTION public.notify_nda_revoked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user uuid;
BEGIN
  IF NEW.revoked_at IS NOT NULL AND OLD.revoked_at IS NULL THEN
    SELECT c.user_id INTO _consultant_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
    IF _consultant_user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_consultant_user, 'NDA revoked',
        'A client revoked the Non-Disclosure Agreement you signed. Sign a new one to continue working with them.', 'nda', '/consultant/requests');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_nda_revoked() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_notify_nda_revoked AFTER UPDATE OF revoked_at ON public.nda_agreements
  FOR EACH ROW EXECUTE FUNCTION public.notify_nda_revoked();

-- ===== C. projects =====
CREATE FUNCTION public.guard_project_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.client_id, NEW.tenant_id, NEW.created_at) IS DISTINCT FROM ROW(OLD.client_id, OLD.tenant_id, OLD.created_at) THEN
    RAISE EXCEPTION 'The owner and the company of a project can not be changed' USING ERRCODE = '42501';
  END IF;
  IF OLD.consultant_id IS NOT NULL AND NEW.consultant_id IS DISTINCT FROM OLD.consultant_id THEN
    RAISE EXCEPTION 'The consultant of a project can not be changed once it is set' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_project_columns() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_project_columns BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_columns();

CREATE POLICY "Clients can update own projects" ON public.projects
  FOR UPDATE TO authenticated
  USING (auth.uid() = client_id)
  WITH CHECK (auth.uid() = client_id AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id)));

CREATE FUNCTION public.notify_project_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.consultant_id IS NOT NULL THEN
    SELECT c.user_id INTO _consultant_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
    IF _consultant_user IS NOT NULL THEN
      PERFORM public.safe_insert_notification(_consultant_user, 'Project status changed',
        'The project "' || NEW.title || '" is now ' || replace(NEW.status::text, '_', ' ') || '.', 'project', '/consultant/cases');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.notify_project_status_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_notify_project_status_change AFTER UPDATE OF status ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.notify_project_status_change();

-- ===== D. the assigned consultant moves the ticket forward / hands it back =====
CREATE FUNCTION public.consultant_set_ticket_status(_ticket_id uuid, _status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _current text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _status IS NULL OR _status NOT IN ('in_progress', 'waiting_for_client', 'resolved') THEN
    RAISE EXCEPTION 'A consultant can only set in progress, waiting for client or resolved' USING ERRCODE = '22023';
  END IF;
  SELECT t.status::text INTO _current
  FROM public.tickets t JOIN public.consultants c ON c.id = t.consultant_id
  WHERE t.id = _ticket_id AND c.user_id = auth.uid() AND c.verification_status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501';
  END IF;
  IF _current NOT IN ('matched', 'in_progress', 'waiting_for_client') THEN
    RAISE EXCEPTION 'The status of this ticket can not be changed from here' USING ERRCODE = '42501';
  END IF;
  IF _current = _status THEN
    RETURN;
  END IF;
  IF NOT public.check_rate_limit('ticket-status:' || auth.uid()::text, 30, 3600) THEN
    RAISE EXCEPTION 'Too many status changes in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  UPDATE public.tickets SET status = _status::public.ticket_status WHERE id = _ticket_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.consultant_set_ticket_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_set_ticket_status(uuid, text) TO authenticated;