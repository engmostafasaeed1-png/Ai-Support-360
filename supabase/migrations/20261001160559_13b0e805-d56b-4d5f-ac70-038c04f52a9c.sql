-- Client-cycle hardening M3 (findings F12, F13, F14, F18, F19):
-- strangers can no longer write into other companies / tickets / environments, surveys can not be forged or re-pointed,
-- disputes are tied to the client's own invoice, SLA policies stay private, and the demo_requests read policy works.

-- ---------------------------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER, boolean / id results only)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_session_participant(_session_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.sessions s LEFT JOIN public.consultants c ON c.id = s.consultant_id
    WHERE s.id = _session_id AND (s.client_id = auth.uid() OR c.user_id = auth.uid())
  )
$function$;

CREATE OR REPLACE FUNCTION public.users_share_engagement(_user_a uuid, _user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (SELECT 1 FROM public.tickets t JOIN public.consultants c ON c.id = t.consultant_id
            WHERE (t.client_id = _user_a AND c.user_id = _user_b) OR (t.client_id = _user_b AND c.user_id = _user_a))
    OR EXISTS (SELECT 1 FROM public.sessions s JOIN public.consultants c ON c.id = s.consultant_id
               WHERE (s.client_id = _user_a AND c.user_id = _user_b) OR (s.client_id = _user_b AND c.user_id = _user_a))
    OR EXISTS (SELECT 1 FROM public.projects p JOIN public.consultants c ON c.id = p.consultant_id
               WHERE (p.client_id = _user_a AND c.user_id = _user_b) OR (p.client_id = _user_b AND c.user_id = _user_a))
    OR EXISTS (SELECT 1 FROM public.ticket_assignments a JOIN public.tickets t ON t.id = a.ticket_id JOIN public.consultants c ON c.id = a.consultant_id
               WHERE a.status = 'active' AND ((t.client_id = _user_a AND c.user_id = _user_b) OR (t.client_id = _user_b AND c.user_id = _user_a)))
$function$;

CREATE OR REPLACE FUNCTION public.share_a_company(_user_a uuid, _user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.tenant_members a JOIN public.tenant_members b ON b.tenant_id = a.tenant_id
                 WHERE a.user_id = _user_a AND b.user_id = _user_b)
$function$;

CREATE OR REPLACE FUNCTION public.bp_matches_ticket_client(_bp_id uuid, _ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.business_processes bp JOIN public.tickets t ON t.client_id = bp.client_id
                 WHERE bp.id = _bp_id AND t.id = _ticket_id)
$function$;

CREATE OR REPLACE FUNCTION public.ticket_consultant_id(_ticket_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT t.consultant_id FROM public.tickets t WHERE t.id = _ticket_id
$function$;

REVOKE ALL ON FUNCTION public.is_session_participant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.users_share_engagement(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.share_a_company(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.bp_matches_ticket_client(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ticket_consultant_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_session_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.users_share_engagement(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.share_a_company(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bp_matches_ticket_client(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_consultant_id(uuid) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- F12: no more writing into other companies, tickets or environments
-- ---------------------------------------------------------------------------------------------
-- company membership is needed to file anything INTO a company
DROP POLICY IF EXISTS "Clients can create tickets" ON public.tickets;
CREATE POLICY "Clients can create tickets" ON public.tickets
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = client_id AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id)));

DROP POLICY IF EXISTS "Clients can create projects" ON public.projects;
CREATE POLICY "Clients can create projects" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = client_id AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id)));

DROP POLICY IF EXISTS "Users can create major incidents" ON public.major_incidents;
CREATE POLICY "Users can create major incidents" ON public.major_incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id))
    AND (ticket_id IS NULL OR public.is_ticket_participant(ticket_id))
  );

DROP POLICY IF EXISTS "Users can create problems" ON public.problems;
CREATE POLICY "Users can create problems" ON public.problems
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id)));

DROP POLICY IF EXISTS "Users can post updates" ON public.major_incident_updates;
CREATE POLICY "Users can post updates on incidents they can see" ON public.major_incident_updates
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = posted_by
    AND EXISTS (SELECT 1 FROM public.major_incidents mi WHERE mi.id = major_incident_updates.major_incident_id)
  );

DROP POLICY IF EXISTS "Users can link incidents" ON public.problem_incidents;
CREATE POLICY "Users can link their tickets to problems they can see" ON public.problem_incidents
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = linked_by
    AND public.is_ticket_participant(problem_incidents.ticket_id)
    AND EXISTS (SELECT 1 FROM public.problems p WHERE p.id = problem_incidents.problem_id)
  );

-- tags, links and process links: only people who work on the ticket
DROP POLICY IF EXISTS "Tag creators can manage own" ON public.ticket_tags;
CREATE POLICY "Participants can tag their tickets" ON public.ticket_tags
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = added_by AND public.is_ticket_participant(ticket_tags.ticket_id));
CREATE POLICY "Tag creators can edit own tags" ON public.ticket_tags
  FOR UPDATE TO authenticated USING (auth.uid() = added_by) WITH CHECK (auth.uid() = added_by);
CREATE POLICY "Tag creators and the ticket owner can remove tags" ON public.ticket_tags
  FOR DELETE TO authenticated USING (auth.uid() = added_by OR public.ticket_owned_by(ticket_tags.ticket_id, auth.uid()));

DROP POLICY IF EXISTS "Users can create links" ON public.ticket_links;
CREATE POLICY "Participants can link their tickets" ON public.ticket_links
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND public.is_ticket_participant(ticket_links.source_ticket_id)
    AND public.is_ticket_participant(ticket_links.target_ticket_id)
  );
CREATE POLICY "Link creators can remove their links" ON public.ticket_links
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

DROP POLICY IF EXISTS "Authenticated users can manage ticket-process links" ON public.ticket_business_processes;
CREATE POLICY "Participants can link processes of the ticket's client" ON public.ticket_business_processes
  FOR INSERT TO authenticated
  WITH CHECK (
    linked_by = auth.uid()
    AND public.is_ticket_participant(ticket_business_processes.ticket_id)
    AND public.bp_matches_ticket_client(ticket_business_processes.business_process_id, ticket_business_processes.ticket_id)
  );
CREATE POLICY "Linkers and the ticket owner can remove process links" ON public.ticket_business_processes
  FOR DELETE TO authenticated
  USING (linked_by = auth.uid() OR public.ticket_owned_by(ticket_business_processes.ticket_id, auth.uid()));

-- tasks: yourself or a colleague from the same company
DROP POLICY IF EXISTS "Users can create tasks" ON public.tasks;
CREATE POLICY "Users can create tasks for themselves or company colleagues" ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = created_by
    AND (assignee_id IS NULL OR assignee_id = auth.uid() OR public.share_a_company(auth.uid(), assignee_id))
    AND (ticket_id IS NULL OR public.is_ticket_participant(ticket_id))
  );
DROP POLICY IF EXISTS "Users can update own or assigned tasks" ON public.tasks;
CREATE POLICY "Users can update own or assigned tasks" ON public.tasks
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by OR auth.uid() = assignee_id)
  WITH CHECK (
    (auth.uid() = created_by OR auth.uid() = assignee_id)
    AND (assignee_id IS NULL OR assignee_id = auth.uid() OR assignee_id = created_by OR public.share_a_company(auth.uid(), assignee_id))
  );

-- remote environments: only people who can see the environment may log sessions, snapshots or VM actions on it
DROP POLICY IF EXISTS "Users can insert own environment sessions" ON public.environment_sessions;
CREATE POLICY "Users log sessions on environments they can see" ON public.environment_sessions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = environment_sessions.environment_id)
  );
DROP POLICY IF EXISTS "Users can create snapshots" ON public.vmware_snapshots;
CREATE POLICY "Users create snapshots on environments they can see" ON public.vmware_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = vmware_snapshots.environment_id)
  );
DROP POLICY IF EXISTS "Users can create actions" ON public.vmware_vm_actions;
CREATE POLICY "Users queue actions on environments they can see" ON public.vmware_vm_actions
  FOR INSERT TO authenticated
  WITH CHECK (
    initiated_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.remote_environments re WHERE re.id = vmware_vm_actions.environment_id)
  );

-- change requests and playbook runs: only about tickets you work on; the assignee must be a verified consultant
DROP POLICY IF EXISTS "Users can create change requests" ON public.change_requests;
CREATE POLICY "Users can create change requests" ON public.change_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = requested_by
    AND (ticket_id IS NULL OR public.is_ticket_participant(ticket_id))
    AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id))
  );
DROP TRIGGER IF EXISTS trg_guard_verified_consultant ON public.change_requests;
CREATE TRIGGER trg_guard_verified_consultant BEFORE INSERT OR UPDATE OF assigned_to ON public.change_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_consultant('assigned_to');

DROP POLICY IF EXISTS "Users can create executions" ON public.playbook_executions;
CREATE POLICY "Users can run playbooks on their own tickets" ON public.playbook_executions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = executed_by AND (ticket_id IS NULL OR public.is_ticket_participant(ticket_id)));

-- ---------------------------------------------------------------------------------------------
-- F13: surveys
-- ---------------------------------------------------------------------------------------------
-- "ask somebody I worked with to rate me": empty, pending, between two people who share an engagement (administrators exempt)
DROP POLICY IF EXISTS "Users can create surveys" ON public.satisfaction_surveys;
CREATE POLICY "Users can ask someone they worked with to rate them" ON public.satisfaction_surveys
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      requested_by = auth.uid()
      AND rated_user = auth.uid()
      AND rated_by <> auth.uid()
      AND COALESCE(status, 'pending') = 'pending'
      AND communication_score IS NULL AND technical_quality_score IS NULL AND timeliness_score IS NULL
      AND professionalism_score IS NULL AND overall_score IS NULL AND comment IS NULL
      AND public.users_share_engagement(auth.uid(), rated_by)
      AND (ticket_id IS NULL OR public.is_ticket_participant(ticket_id))
      AND (session_id IS NULL OR public.is_session_participant(session_id))
    )
  );

CREATE OR REPLACE FUNCTION public.guard_satisfaction_survey()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.rated_by, NEW.rated_user, NEW.role, NEW.ticket_id, NEW.session_id, NEW.requested_by)
     IS DISTINCT FROM ROW(OLD.rated_by, OLD.rated_user, OLD.role, OLD.ticket_id, OLD.session_id, OLD.requested_by) THEN
    RAISE EXCEPTION 'A survey can not be re-pointed' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'completed'
     AND ROW(NEW.communication_score, NEW.technical_quality_score, NEW.timeliness_score, NEW.professionalism_score, NEW.overall_score, NEW.comment, NEW.status)
         IS DISTINCT FROM ROW(OLD.communication_score, OLD.technical_quality_score, OLD.timeliness_score, OLD.professionalism_score, OLD.overall_score, OLD.comment, OLD.status) THEN
    RAISE EXCEPTION 'A completed survey can not be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_satisfaction_survey() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_satisfaction_survey ON public.satisfaction_surveys;
CREATE TRIGGER trg_guard_satisfaction_survey BEFORE UPDATE ON public.satisfaction_surveys
  FOR EACH ROW EXECUTE FUNCTION public.guard_satisfaction_survey();

-- ticket CSAT: the client rates their OWN ticket, once, about the consultant who worked on it
DROP POLICY IF EXISTS "Clients can manage own surveys" ON public.ticket_satisfaction_surveys;
CREATE POLICY "Clients can view own CSAT" ON public.ticket_satisfaction_surveys
  FOR SELECT TO authenticated USING (auth.uid() = client_id);
CREATE POLICY "Clients rate their own tickets" ON public.ticket_satisfaction_surveys
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = client_id
    AND public.ticket_owned_by(ticket_satisfaction_surveys.ticket_id, auth.uid())
    AND consultant_id IS NOT DISTINCT FROM public.ticket_consultant_id(ticket_satisfaction_surveys.ticket_id)
  );
CREATE POLICY "Clients can edit own CSAT" ON public.ticket_satisfaction_surveys
  FOR UPDATE TO authenticated USING (auth.uid() = client_id) WITH CHECK (auth.uid() = client_id);
CREATE POLICY "Clients can delete own CSAT" ON public.ticket_satisfaction_surveys
  FOR DELETE TO authenticated USING (auth.uid() = client_id);
CREATE UNIQUE INDEX IF NOT EXISTS ticket_csat_one_per_ticket ON public.ticket_satisfaction_surveys (ticket_id, client_id);

CREATE OR REPLACE FUNCTION public.guard_csat_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.ticket_id, NEW.client_id, NEW.consultant_id) IS DISTINCT FROM ROW(OLD.ticket_id, OLD.client_id, OLD.consultant_id) THEN
    RAISE EXCEPTION 'A satisfaction rating can not be moved to another ticket or consultant' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_csat_columns() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_csat_columns ON public.ticket_satisfaction_surveys;
CREATE TRIGGER trg_guard_csat_columns BEFORE UPDATE ON public.ticket_satisfaction_surveys
  FOR EACH ROW EXECUTE FUNCTION public.guard_csat_columns();

-- ---------------------------------------------------------------------------------------------
-- F14: invoice disputes
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Clients create own disputes" ON public.invoice_disputes;
CREATE POLICY "Clients dispute their own invoices" ON public.invoice_disputes
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = client_id
    AND COALESCE(status, 'open') = 'open'
    AND EXISTS (SELECT 1 FROM public.payments p
                WHERE p.id = invoice_disputes.payment_id AND p.client_id = auth.uid()
                  AND p.consultant_id IS NOT DISTINCT FROM invoice_disputes.consultant_id)
  );
CREATE POLICY "Consultants see disputes on their invoices" ON public.invoice_disputes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = invoice_disputes.consultant_id AND c.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_invoice_dispute_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.payment_id, NEW.client_id, NEW.consultant_id, NEW.status, NEW.resolution_notes, NEW.resolved_by, NEW.resolved_at)
     IS DISTINCT FROM ROW(OLD.payment_id, OLD.client_id, OLD.consultant_id, OLD.status, OLD.resolution_notes, OLD.resolved_by, OLD.resolved_at) THEN
    RAISE EXCEPTION 'Only an administrator can resolve or re-assign a dispute' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_invoice_dispute_columns() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_invoice_dispute_columns ON public.invoice_disputes;
CREATE TRIGGER trg_guard_invoice_dispute_columns BEFORE UPDATE ON public.invoice_disputes
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_dispute_columns();

-- ---------------------------------------------------------------------------------------------
-- F18: SLA policies stay private to their owner (system-wide ones stay visible to everybody)
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated can view active SLA policies" ON public.ticket_sla_policies;
DROP POLICY IF EXISTS "Authenticated can view relevant client SLA policies" ON public.ticket_sla_policies;
CREATE POLICY "People can see the SLA policy of tickets they can see" ON public.ticket_sla_policies
  FOR SELECT TO authenticated
  USING (is_active = true AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.sla_policy_id = ticket_sla_policies.id));

-- ---------------------------------------------------------------------------------------------
-- F19: demo_requests - read the caller's e-mail from the token instead of querying auth.users
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view their own demo requests" ON public.demo_requests;
CREATE POLICY "Users can view their own demo requests" ON public.demo_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR lower(email) = lower(COALESCE(auth.jwt() ->> 'email', '')));