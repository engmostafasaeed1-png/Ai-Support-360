-- ===== M36 part 1: access rules (QA defects DEF-014, 018, 019, 020, 027, 030, 031) =====

-- DEF-014: trigger functions must not be callable through the API
REVOKE EXECUTE ON FUNCTION public.guard_verification_item() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_referral_signup() FROM PUBLIC, anon, authenticated;

-- DEF-019: only a super administrator can grant, change or remove the administrator roles
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins can insert roles" ON public.user_roles;
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "Super admins manage all roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));
CREATE POLICY "Admins manage client and consultant roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role) AND role IN ('client'::app_role, 'consultant'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND role IN ('client'::app_role, 'consultant'::app_role));

-- DEF-018: internal notes only for the consultant who is really on the ticket (verified, active assignment) and for admins
CREATE OR REPLACE FUNCTION public.can_use_internal_notes(_ticket_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
      OR EXISTS (
           SELECT 1 FROM public.consultants c
            WHERE c.id = public.ticket_consultant_for_me(_ticket_id)
              AND c.verification_status = 'verified')
$function$;
REVOKE EXECUTE ON FUNCTION public.can_use_internal_notes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_use_internal_notes(uuid) TO authenticated;

DROP POLICY IF EXISTS "Consultants can view notes on assigned tickets" ON public.ticket_internal_notes;
CREATE POLICY "Consultants can view notes on assigned tickets" ON public.ticket_internal_notes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'consultant'::app_role) AND public.can_use_internal_notes(ticket_id));
DROP POLICY IF EXISTS "Staff authors can insert own notes" ON public.ticket_internal_notes;
CREATE POLICY "Staff authors can insert own notes" ON public.ticket_internal_notes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id
              AND (public.has_role(auth.uid(), 'consultant'::app_role) OR public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role))
              AND public.can_use_internal_notes(ticket_id));

-- DEF-020: the requester can not decide the change request (CAB decision, status after submission, CAB flag, assignee)
CREATE OR REPLACE FUNCTION public.guard_change_request_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NULL OR NEW.status NOT IN ('draft', 'submitted') THEN
      NEW.status := 'draft';
    END IF;
    NEW.cab_decision := NULL;
    NEW.cab_decision_at := NULL;
    NEW.cab_notes := NULL;
    NEW.assigned_to := NULL;
    NEW.actual_start := NULL;
    NEW.actual_end := NULL;
    NEW.cab_required := (NEW.change_type IS DISTINCT FROM 'standard');
    RETURN NEW;
  END IF;
  IF ROW(NEW.cab_decision, NEW.cab_decision_at, NEW.cab_notes, NEW.assigned_to, NEW.cab_required, NEW.requested_by, NEW.tenant_id, NEW.actual_start, NEW.actual_end)
     IS DISTINCT FROM ROW(OLD.cab_decision, OLD.cab_decision_at, OLD.cab_notes, OLD.assigned_to, OLD.cab_required, OLD.requested_by, OLD.tenant_id, OLD.actual_start, OLD.actual_end) THEN
    RAISE EXCEPTION 'The CAB decision, assignee and execution dates of a change request are set by the change board' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'draft' AND NEW.status IN ('submitted', 'cancelled'))
         OR (OLD.status IN ('submitted', 'cab_review') AND NEW.status = 'cancelled')) THEN
      RAISE EXCEPTION 'The status of this change request can only be moved by the change board' USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.status NOT IN ('draft') THEN
    IF ROW(NEW.title, NEW.description, NEW.change_type, NEW.risk_level, NEW.rollback_plan, NEW.implementation_plan, NEW.affected_services, NEW.affected_modules, NEW.scheduled_start, NEW.scheduled_end, NEW.ticket_id)
       IS DISTINCT FROM ROW(OLD.title, OLD.description, OLD.change_type, OLD.risk_level, OLD.rollback_plan, OLD.implementation_plan, OLD.affected_services, OLD.affected_modules, OLD.scheduled_start, OLD.scheduled_end, OLD.ticket_id) THEN
      RAISE EXCEPTION 'A submitted change request can not be edited; withdraw it and create a new one' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_guard_change_request_decision ON public.change_requests;
CREATE TRIGGER trg_guard_change_request_decision
  BEFORE INSERT OR UPDATE ON public.change_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_change_request_decision();
REVOKE EXECUTE ON FUNCTION public.guard_change_request_decision() FROM PUBLIC, anon, authenticated;

-- DEF-027: the link checks apply to administrators too (only the platform itself and the service role are exempt)
CREATE OR REPLACE FUNCTION public.guard_url_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _col text;
  _raw text;
  _val text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  FOREACH _col IN ARRAY TG_ARGV LOOP
    _raw := to_jsonb(NEW) ->> _col;
    IF _raw IS NULL OR btrim(_raw) = '' THEN
      CONTINUE;
    END IF;
    IF TG_OP = 'UPDATE' AND _raw IS NOT DISTINCT FROM (to_jsonb(OLD) ->> _col) THEN
      CONTINUE;
    END IF;

    _val := btrim(_raw);

    -- any scheme other than http(s) is refused ("host:port" is not a scheme)
    IF _val ~* '^[a-z][a-z0-9+.-]*:(?!\d+([/?#]|$))' AND _val !~* '^https?:' THEN
      RAISE EXCEPTION 'Invalid link in "%": only http(s) URLs are allowed', _col USING ERRCODE = '22023';
    END IF;

    IF _val !~* '^https?://' THEN
      _val := 'https://' || _val;
    END IF;

    IF length(_val) > 2048 OR _val !~* '^https?://[^[:space:]<>"''`]+$' THEN
      RAISE EXCEPTION 'Invalid link in "%": not a valid http(s) URL', _col USING ERRCODE = '22023';
    END IF;

    IF _val IS DISTINCT FROM _raw THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(_col, _val));
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_path_or_url_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _col text;
  _raw text;
  _val text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  FOREACH _col IN ARRAY TG_ARGV LOOP
    _raw := to_jsonb(NEW) ->> _col;
    IF _raw IS NULL OR btrim(_raw) = '' THEN
      CONTINUE;
    END IF;
    IF TG_OP = 'UPDATE' AND _raw IS NOT DISTINCT FROM (to_jsonb(OLD) ->> _col) THEN
      CONTINUE;
    END IF;

    _val := btrim(_raw);

    IF _val ~* '^[a-z][a-z0-9+.-]*:(?!\d+([/?#]|$))' AND _val !~* '^https?://' THEN
      RAISE EXCEPTION 'Invalid file reference in "%": script-capable or unknown URL scheme', _col USING ERRCODE = '22023';
    END IF;
    IF _val ~* '^https?://' AND (length(_val) > 2048 OR _val !~* '^https?://[^[:space:]<>"''`]+$') THEN
      RAISE EXCEPTION 'Invalid file reference in "%": not a valid http(s) URL', _col USING ERRCODE = '22023';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- DEF-030: a bid must have a sensible rate, hours, timeline and a cover letter (existing rows are not re-checked)
ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_rate_range CHECK (proposed_rate > 0 AND proposed_rate <= 100000) NOT VALID,
  ADD CONSTRAINT proposals_hours_range CHECK (estimated_hours IS NULL OR (estimated_hours >= 0 AND estimated_hours <= 100000)) NOT VALID,
  ADD CONSTRAINT proposals_timeline_range CHECK (timeline_days IS NULL OR (timeline_days >= 0 AND timeline_days <= 3650)) NOT VALID,
  ADD CONSTRAINT proposals_letter_not_blank CHECK (cover_letter IS NOT NULL AND btrim(cover_letter) <> '') NOT VALID;

-- DEF-031: accepting a bid is one server step in one transaction
CREATE OR REPLACE FUNCTION public.accept_proposal(_proposal_id uuid, _client_notes text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.proposals;
  _t public.tickets;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO _p FROM public.proposals WHERE id = _proposal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _t FROM public.tickets WHERE id = _p.ticket_id FOR UPDATE;
  IF NOT FOUND OR (_t.client_id <> auth.uid() AND NOT COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false)) THEN
    RAISE EXCEPTION 'Proposal not found' USING ERRCODE = '42501';
  END IF;
  IF _p.status::text <> 'pending' THEN
    RAISE EXCEPTION 'This proposal has already been answered' USING ERRCODE = '22023';
  END IF;
  IF _t.status::text IN ('resolved', 'closed') THEN
    RAISE EXCEPTION 'This ticket is already finished' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _p.consultant_id AND c.verification_status = 'verified') THEN
    RAISE EXCEPTION 'This consultant is not verified at the moment' USING ERRCODE = '42501';
  END IF;

  UPDATE public.proposals
     SET status = 'accepted', client_notes = left(NULLIF(btrim(COALESCE(_client_notes, '')), ''), 2000)
   WHERE id = _p.id;
  UPDATE public.tickets
     SET consultant_id = _p.consultant_id, status = 'in_progress'
   WHERE id = _t.id;
  UPDATE public.proposals
     SET status = 'rejected'
   WHERE ticket_id = _t.id AND id <> _p.id AND status = 'pending';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.accept_proposal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_proposal(uuid, text) TO authenticated;

-- ===== M36 part 2: data integrity (QA defects DEF-016, 017, 026, 034, 041, 048, 055, 064) =====

-- DEF-016: a consultant can not be booked twice for the same time (sessions of 0 minutes count as one hour)
CREATE OR REPLACE FUNCTION public.guard_session_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _from timestamptz;
  _to timestamptz;
BEGIN
  IF NEW.consultant_id IS NULL OR NEW.scheduled_at IS NULL OR NEW.status::text NOT IN ('scheduled', 'in_progress') THEN
    RETURN NEW;
  END IF;
  _from := NEW.scheduled_at;
  _to := NEW.scheduled_at + make_interval(mins => GREATEST(COALESCE(NULLIF(NEW.duration_minutes, 0), 60), 1));
  PERFORM pg_advisory_xact_lock(hashtextextended('session-slot:' || NEW.consultant_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.sessions s
     WHERE s.consultant_id = NEW.consultant_id
       AND s.id <> NEW.id
       AND s.status::text IN ('scheduled', 'in_progress')
       AND s.scheduled_at IS NOT NULL
       AND s.scheduled_at < _to
       AND s.scheduled_at + make_interval(mins => GREATEST(COALESCE(NULLIF(s.duration_minutes, 0), 60), 1)) > _from
  ) THEN
    RAISE EXCEPTION 'This consultant is already booked at that time' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_guard_session_overlap ON public.sessions;
CREATE TRIGGER trg_guard_session_overlap
  BEFORE INSERT OR UPDATE OF consultant_id, scheduled_at, duration_minutes, status ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_overlap();
REVOKE EXECUTE ON FUNCTION public.guard_session_overlap() FROM PUBLIC, anon, authenticated;

-- DEF-055: a session belongs to the company of its ticket; a notification about a ticket or session to the company of that ticket
CREATE OR REPLACE FUNCTION public.default_session_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.ticket_id IS NOT NULL THEN
    SELECT t.tenant_id INTO NEW.tenant_id FROM public.tickets t WHERE t.id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_default_session_tenant ON public.sessions;
CREATE TRIGGER trg_default_session_tenant
  BEFORE INSERT ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.default_session_tenant();
REVOKE EXECUTE ON FUNCTION public.default_session_tenant() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.default_notification_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
BEGIN
  IF NEW.tenant_id IS NULL AND NEW.link IS NOT NULL THEN
    BEGIN
      _id := substring(NEW.link from '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')::uuid;
    EXCEPTION WHEN others THEN
      _id := NULL;
    END;
    IF _id IS NOT NULL THEN
      SELECT t.tenant_id INTO NEW.tenant_id FROM public.tickets t WHERE t.id = _id;
      IF NEW.tenant_id IS NULL THEN
        SELECT s.tenant_id INTO NEW.tenant_id FROM public.sessions s WHERE s.id = _id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_default_notification_tenant ON public.notifications;
CREATE TRIGGER trg_default_notification_tenant
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.default_notification_tenant();
REVOKE EXECUTE ON FUNCTION public.default_notification_tenant() FROM PUBLIC, anon, authenticated;

-- DEF-017: a parent ticket must be another ticket of the same client (and company) and must not create a loop
CREATE OR REPLACE FUNCTION public.guard_ticket_parent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _parent public.tickets;
  _loop boolean;
BEGIN
  IF NEW.parent_ticket_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_ticket_id IS NOT DISTINCT FROM OLD.parent_ticket_id THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_ticket_id = NEW.id THEN
    RAISE EXCEPTION 'A ticket can not be its own parent' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO _parent FROM public.tickets WHERE id = NEW.parent_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The parent ticket does not exist' USING ERRCODE = '23503';
  END IF;
  IF _parent.client_id IS DISTINCT FROM NEW.client_id
     OR (_parent.tenant_id IS NOT NULL AND NEW.tenant_id IS NOT NULL AND _parent.tenant_id IS DISTINCT FROM NEW.tenant_id) THEN
    RAISE EXCEPTION 'The parent ticket must belong to the same client and company' USING ERRCODE = '23514';
  END IF;
  WITH RECURSIVE up(id, parent_id, depth) AS (
    SELECT t.id, t.parent_ticket_id, 1 FROM public.tickets t WHERE t.id = NEW.parent_ticket_id
    UNION ALL
    SELECT t.id, t.parent_ticket_id, up.depth + 1 FROM public.tickets t JOIN up ON t.id = up.parent_id WHERE up.depth < 50
  )
  SELECT EXISTS (SELECT 1 FROM up WHERE up.id = NEW.id OR up.parent_id = NEW.id) INTO _loop;
  IF _loop THEN
    RAISE EXCEPTION 'This parent would create a loop in the ticket hierarchy' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_guard_ticket_parent ON public.tickets;
CREATE TRIGGER trg_guard_ticket_parent
  BEFORE INSERT OR UPDATE OF parent_ticket_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_parent();
REVOKE EXECUTE ON FUNCTION public.guard_ticket_parent() FROM PUBLIC, anon, authenticated;

-- DEF-048: the resolved date follows the status (set when resolved or closed, cleared when the ticket is re-opened)
CREATE OR REPLACE FUNCTION public.tickets_set_resolved_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status::text IN ('resolved', 'closed') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.resolved_at := COALESCE(NEW.resolved_at, now());
    ELSIF OLD.status::text NOT IN ('resolved', 'closed') THEN
      NEW.resolved_at := now();
    ELSE
      NEW.resolved_at := COALESCE(NEW.resolved_at, OLD.resolved_at, now());
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status::text IN ('resolved', 'closed') THEN
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_tickets_set_resolved_at ON public.tickets;
CREATE TRIGGER trg_tickets_set_resolved_at
  BEFORE INSERT OR UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_set_resolved_at();
REVOKE EXECUTE ON FUNCTION public.tickets_set_resolved_at() FROM PUBLIC, anon, authenticated;

UPDATE public.tickets t
   SET resolved_at = COALESCE(
         (SELECT min(a.created_at) FROM public.audit_logs a
           WHERE a.entity_type = 'tickets' AND a.entity_id = t.id AND a.action = 'tickets.updated'
             AND a.metadata #>> '{new,status}' IN ('resolved', 'closed')),
         t.updated_at)
 WHERE t.status::text IN ('resolved', 'closed') AND t.resolved_at IS NULL;

-- DEF-026: a consultant who resolves a ticket can send the resolution summary with the status change
DROP FUNCTION IF EXISTS public.consultant_set_ticket_status(uuid, text);
CREATE OR REPLACE FUNCTION public.consultant_set_ticket_status(_ticket_id uuid, _status text, _resolution text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _current text;
  _note text := NULLIF(btrim(COALESCE(_resolution, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _status IS NULL OR _status NOT IN ('in_progress', 'waiting_for_client', 'resolved') THEN
    RAISE EXCEPTION 'A consultant can only set in progress, waiting for client or resolved' USING ERRCODE = '22023';
  END IF;
  IF _note IS NOT NULL AND char_length(_note) > 10000 THEN
    RAISE EXCEPTION 'The resolution summary is too long (10000 characters at most)' USING ERRCODE = '22023';
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
  IF _status = 'resolved' AND _note IS NOT NULL THEN
    UPDATE public.tickets SET status = _status::public.ticket_status, resolution_notes = _note WHERE id = _ticket_id;
  ELSE
    UPDATE public.tickets SET status = _status::public.ticket_status WHERE id = _ticket_id;
  END IF;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.consultant_set_ticket_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_set_ticket_status(uuid, text, text) TO authenticated;

-- DEF-034: a company needs a name
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_name_not_blank CHECK (char_length(btrim(name)) BETWEEN 1 AND 200);

-- DEF-041: the connection status and the last-sync time are written by the platform (service role) only
CREATE OR REPLACE FUNCTION public.guard_integration_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.status := 'inactive';
      NEW.last_synced_at := NULL;
    ELSE
      NEW.status := OLD.status;
      NEW.last_synced_at := OLD.last_synced_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_guard_integration_status ON public.integrations;
CREATE TRIGGER trg_guard_integration_status
  BEFORE INSERT OR UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.guard_integration_status();
REVOKE EXECUTE ON FUNCTION public.guard_integration_status() FROM PUBLIC, anon, authenticated;

-- DEF-064: one active interview template per SAP area, level and role
CREATE UNIQUE INDEX IF NOT EXISTS interview_templates_scope_active_uq
  ON public.interview_templates (sap_module, seniority, role_focus) WHERE is_active;