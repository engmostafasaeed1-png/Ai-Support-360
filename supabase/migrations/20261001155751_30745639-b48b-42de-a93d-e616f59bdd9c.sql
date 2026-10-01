-- Client-cycle hardening M2 (findings F02, F05, F06, F07, F08, F16):
-- real-engagement checks on inserts that reach into other people's accounts, verified-consultant guard,
-- proposal terms frozen for the wrong party, interview column guard, bidding closes on assignment,
-- consultants linked to a ticket can read it.

-- ---------------------------------------------------------------------------------------------
-- Helpers. SECURITY DEFINER so they can read rows the caller can not see; they only return booleans.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ticket_owned_by(_ticket_id uuid, _client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = _ticket_id AND t.client_id = _client_id)
$function$;

CREATE OR REPLACE FUNCTION public.is_ticket_participant(_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.tickets t LEFT JOIN public.consultants c ON c.id = t.consultant_id
    WHERE t.id = _ticket_id AND (t.client_id = auth.uid() OR c.user_id = auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM public.ticket_assignments a JOIN public.consultants c2 ON c2.id = a.consultant_id
    WHERE a.ticket_id = _ticket_id AND c2.user_id = auth.uid() AND a.status = 'active'
  )
$function$;

CREATE OR REPLACE FUNCTION public.consultant_has_ticket_link(_ticket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
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
  )
$function$;

CREATE OR REPLACE FUNCTION public.consultant_related_to_client(_consultant_id uuid, _client_id uuid, _include_bids boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    EXISTS (SELECT 1 FROM public.tickets t WHERE t.client_id = _client_id AND t.consultant_id = _consultant_id)
    OR EXISTS (SELECT 1 FROM public.ticket_assignments a JOIN public.tickets t ON t.id = a.ticket_id
               WHERE t.client_id = _client_id AND a.consultant_id = _consultant_id AND a.status = 'active')
    OR EXISTS (SELECT 1 FROM public.ticket_match_requests m JOIN public.tickets t ON t.id = m.ticket_id
               WHERE t.client_id = _client_id AND m.consultant_id = _consultant_id AND m.status IN ('pending', 'accepted'))
    OR EXISTS (SELECT 1 FROM public.ticket_interviews i WHERE i.client_id = _client_id AND i.consultant_id = _consultant_id)
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.client_id = _client_id AND p.consultant_id = _consultant_id)
    OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.client_id = _client_id AND s.consultant_id = _consultant_id)
    OR EXISTS (SELECT 1 FROM public.shared_remote_configs r WHERE r.client_id = _client_id AND r.consultant_id = _consultant_id)
    OR (_include_bids AND EXISTS (SELECT 1 FROM public.proposals pr JOIN public.tickets t ON t.id = pr.ticket_id
                                  WHERE t.client_id = _client_id AND pr.consultant_id = _consultant_id))
$function$;

REVOKE ALL ON FUNCTION public.ticket_owned_by(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_ticket_participant(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consultant_has_ticket_link(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consultant_related_to_client(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_owned_by(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_ticket_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultant_has_ticket_link(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultant_related_to_client(uuid, uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------------------------
-- F05: a client can only pick VERIFIED consultants (tickets, assignments, sessions, match requests,
-- projects, shared remote access, environments, interviews). Trusted writers (admin / service) are exempt.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_verified_consultant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _new_id uuid;
  _old_id uuid;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  _new_id := NULLIF(to_jsonb(NEW) ->> TG_ARGV[0], '')::uuid;
  IF _new_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    _old_id := NULLIF(to_jsonb(OLD) ->> TG_ARGV[0], '')::uuid;
    IF _old_id IS NOT DISTINCT FROM _new_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _new_id AND c.verification_status = 'verified') THEN
    RAISE EXCEPTION 'Only verified consultants can be selected' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_verified_consultant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_verified_consultant ON public.tickets;
CREATE TRIGGER trg_guard_verified_consultant BEFORE INSERT OR UPDATE OF consultant_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_consultant('consultant_id');
DROP TRIGGER IF EXISTS trg_guard_verified_consultant ON public.ticket_assignments;
CREATE TRIGGER trg_guard_verified_consultant BEFORE INSERT ON public.ticket_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_consultant('consultant_id');
DROP TRIGGER IF EXISTS trg_guard_verified_consultant ON public.sessions;
CREATE TRIGGER trg_guard_verified_consultant BEFORE INSERT ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_consultant('consultant_id');
DROP TRIGGER IF EXISTS trg_guard_verified_consultant ON public.ticket_match_requests;
CREATE TRIGGER trg_guard_verified_consultant BEFORE INSERT ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_consultant('consultant_id');
DROP TRIGGER IF EXISTS trg_guard_verified_consultant ON public.projects;
CREATE TRIGGER trg_guard_verified_consultant BEFORE INSERT OR UPDATE OF consultant_id ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_consultant('consultant_id');
DROP TRIGGER IF EXISTS trg_guard_verified_consultant ON public.shared_remote_configs;
CREATE TRIGGER trg_guard_verified_consultant BEFORE INSERT ON public.shared_remote_configs
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_consultant('consultant_id');
DROP TRIGGER IF EXISTS trg_guard_verified_consultant ON public.remote_environments;
CREATE TRIGGER trg_guard_verified_consultant BEFORE INSERT OR UPDATE OF consultant_id ON public.remote_environments
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_consultant('consultant_id');
DROP TRIGGER IF EXISTS trg_guard_verified_consultant ON public.ticket_interviews;
CREATE TRIGGER trg_guard_verified_consultant BEFORE INSERT ON public.ticket_interviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_verified_consultant('consultant_id');

-- ---------------------------------------------------------------------------------------------
-- F02: relationship checks on inserts that reach into other people's accounts.
-- ---------------------------------------------------------------------------------------------
-- proposals: verified consultants only, on a ticket they can see that is not taken by someone else
DROP POLICY IF EXISTS "Consultants can create own proposals" ON public.proposals;
CREATE POLICY "Verified consultants can bid on tickets they can see" ON public.proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = proposals.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified')
    AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = proposals.ticket_id
                AND (t.consultant_id IS NULL OR t.consultant_id = proposals.consultant_id)
                AND t.status NOT IN ('resolved', 'closed'))
  );

-- sessions: a client books on their own ticket; a consultant only with a client they really work with
DROP POLICY IF EXISTS "Participants can create sessions" ON public.sessions;
CREATE POLICY "Participants can create sessions with a real engagement" ON public.sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      auth.uid() = client_id
      AND (ticket_id IS NULL OR public.ticket_owned_by(sessions.ticket_id, auth.uid()))
      AND (tenant_id IS NULL OR public.is_tenant_member(auth.uid(), tenant_id))
    )
    OR (
      EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = sessions.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified')
      AND public.consultant_related_to_client(sessions.consultant_id, sessions.client_id, false)
      AND (ticket_id IS NULL OR public.ticket_owned_by(sessions.ticket_id, sessions.client_id))
    )
  );

-- NDAs: only a verified consultant, only for a client who invited / works with them
DROP POLICY IF EXISTS "Consultants can create NDAs" ON public.nda_agreements;
CREATE POLICY "Verified consultants can sign NDAs for clients they work with" ON public.nda_agreements
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = nda_agreements.consultant_id AND c.user_id = auth.uid() AND c.verification_status = 'verified')
    AND public.consultant_related_to_client(nda_agreements.consultant_id, nda_agreements.client_id, true)
  );

-- proposal attachments: only on your own proposal
DROP POLICY IF EXISTS "Users can insert own proposal attachments" ON public.proposal_attachments;
CREATE POLICY "Consultants attach files to their own proposals" ON public.proposal_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.proposals p JOIN public.consultants c ON c.id = p.consultant_id
                WHERE p.id = proposal_attachments.proposal_id AND c.user_id = auth.uid())
  );

-- timesheet submissions: only the client or a consultant working on the ticket may file one
DROP POLICY IF EXISTS "Submitters can manage own submissions" ON public.ticket_timesheet_submissions;
CREATE POLICY "Submitters can view own submissions" ON public.ticket_timesheet_submissions
  FOR SELECT TO authenticated USING (auth.uid() = submitted_by);
CREATE POLICY "Submitters can edit own submissions" ON public.ticket_timesheet_submissions
  FOR UPDATE TO authenticated USING (auth.uid() = submitted_by) WITH CHECK (auth.uid() = submitted_by);
CREATE POLICY "Submitters can delete own submissions" ON public.ticket_timesheet_submissions
  FOR DELETE TO authenticated USING (auth.uid() = submitted_by);
CREATE POLICY "Only the client or a consultant on the ticket can file a timesheet" ON public.ticket_timesheet_submissions
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = submitted_by AND public.is_ticket_participant(ticket_timesheet_submissions.ticket_id));

-- work logs: the consultant added through "Assigned consultants" may log hours as well (F16)
DROP POLICY IF EXISTS "Consultants manage own work logs on assigned tickets" ON public.ticket_work_logs;
CREATE POLICY "Consultants manage own work logs on assigned tickets" ON public.ticket_work_logs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ticket_work_logs.consultant_id AND c.user_id = auth.uid()))
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ticket_work_logs.consultant_id AND c.user_id = auth.uid())
    AND (
      EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_work_logs.ticket_id AND t.consultant_id = ticket_work_logs.consultant_id)
      OR EXISTS (SELECT 1 FROM public.ticket_assignments a WHERE a.ticket_id = ticket_work_logs.ticket_id
                 AND a.consultant_id = ticket_work_logs.consultant_id AND a.status = 'active')
    )
  );

-- consultants linked to a ticket (extra consultant, invited by match request, bidder on a ticket nobody has taken) can read it (F16)
DROP POLICY IF EXISTS "Consultants can view tickets they are linked to" ON public.tickets;
CREATE POLICY "Consultants can view tickets they are linked to" ON public.tickets
  FOR SELECT TO authenticated USING (public.consultant_has_ticket_link(tickets.id));

-- ---------------------------------------------------------------------------------------------
-- F07: ticket interviews - only on the client's own ticket; who may write which column
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Clients can create interviews for own tickets" ON public.ticket_interviews;
CREATE POLICY "Clients can create interviews for own tickets" ON public.ticket_interviews
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = client_id AND public.ticket_owned_by(ticket_interviews.ticket_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.guard_ticket_interview_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.started_at := NULL;
    NEW.ended_at := NULL;
    NEW.transcript := NULL;
    NEW.ai_summary := NULL;
    NEW.body_language_analysis := NULL;
    NEW.facial_verification_result := NULL;
    NEW.overall_recommendation := NULL;
    NEW.consultant_notes := NULL;
    RETURN NEW;
  END IF;
  IF ROW(NEW.ticket_id, NEW.client_id, NEW.consultant_id, NEW.room_id) IS DISTINCT FROM ROW(OLD.ticket_id, OLD.client_id, OLD.consultant_id, OLD.room_id) THEN
    RAISE EXCEPTION 'Interview parties and room can not be changed' USING ERRCODE = '42501';
  END IF;
  IF ROW(NEW.transcript, NEW.ai_summary, NEW.body_language_analysis, NEW.facial_verification_result, NEW.overall_recommendation)
     IS DISTINCT FROM ROW(OLD.transcript, OLD.ai_summary, OLD.body_language_analysis, OLD.facial_verification_result, OLD.overall_recommendation) THEN
    RAISE EXCEPTION 'Interview analysis fields are managed by the platform' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NOT DISTINCT FROM OLD.client_id THEN
    IF NEW.consultant_notes IS DISTINCT FROM OLD.consultant_notes THEN
      RAISE EXCEPTION 'Only the consultant can change the consultant notes' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.client_notes IS DISTINCT FROM OLD.client_notes THEN
    RAISE EXCEPTION 'Only the client can change the client notes' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_ticket_interview_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_ticket_interview_columns ON public.ticket_interviews;
CREATE TRIGGER trg_guard_ticket_interview_columns BEFORE INSERT OR UPDATE ON public.ticket_interviews
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_interview_columns();

-- ---------------------------------------------------------------------------------------------
-- F06: proposal terms. The client answers (accept / reject + note) but can not rewrite the offer;
-- the consultant can not rewrite an offer the client has already answered.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_proposal_status()
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
  _is_ticket_owner := EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = NEW.ticket_id AND t.client_id = auth.uid());
  IF _is_ticket_owner THEN
    IF TG_OP = 'UPDATE' THEN
      IF ROW(NEW.ticket_id, NEW.consultant_id, NEW.cover_letter, NEW.proposed_rate, NEW.estimated_hours, NEW.timeline_days, NEW.version, NEW.parent_proposal_id)
         IS DISTINCT FROM ROW(OLD.ticket_id, OLD.consultant_id, OLD.cover_letter, OLD.proposed_rate, OLD.estimated_hours, OLD.timeline_days, OLD.version, OLD.parent_proposal_id) THEN
        RAISE EXCEPTION 'The client can accept or reject a proposal but can not change its terms' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.client_notes := NULL;
    RETURN NEW;
  END IF;
  IF ROW(NEW.ticket_id, NEW.consultant_id, NEW.client_notes) IS DISTINCT FROM ROW(OLD.ticket_id, OLD.consultant_id, OLD.client_notes) THEN
    RAISE EXCEPTION 'Only the ticket owner can change proposal ownership or notes' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text <> 'withdrawn' THEN
    RAISE EXCEPTION 'Only the ticket owner can accept or reject a proposal' USING ERRCODE = '42501';
  END IF;
  IF OLD.status::text <> 'pending'
     AND ROW(NEW.cover_letter, NEW.proposed_rate, NEW.estimated_hours, NEW.timeline_days, NEW.version, NEW.parent_proposal_id)
         IS DISTINCT FROM ROW(OLD.cover_letter, OLD.proposed_rate, OLD.estimated_hours, OLD.timeline_days, OLD.version, OLD.parent_proposal_id) THEN
    RAISE EXCEPTION 'The offer can not be changed after the client has answered it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------------------------
-- F08: once a ticket has a consultant it is no longer open for bids.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_bidding_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.consultant_id IS NOT NULL AND NEW.consultant_id IS DISTINCT FROM OLD.consultant_id THEN
    NEW.open_for_bids := false;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.close_bidding_on_assignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_close_bidding_on_assignment ON public.tickets;
CREATE TRIGGER trg_close_bidding_on_assignment BEFORE UPDATE OF consultant_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.close_bidding_on_assignment();