-- Client-cycle hardening M14 (finding F15: the parts that need no payment provider; replaces the untested draft):
-- A. Milestones: a client can no longer mark a milestone as funded or push it through the escrow steps by hand. Funding is confirmed by the platform
--    (an administrator, later a payment webhook). The client can approve a submitted milestone, release an approved one, or open a dispute; the
--    submission, approval and release times are the server time; the amount of a funded milestone is frozen; a milestone with money behind it can not be deleted by a browser user.
-- B. Releasing an approved milestone that was funded creates a PENDING payout for the consultant (full milestone amount; the administrator adjusts the commission and pays)
--    and tells the administrators. One payout per milestone (unique reference "milestone:<id>").
-- C. Timesheets: the client of a ticket approves ("signed") or sends back a submitted timesheet inside the platform and the person who filed it is told;
--    a signed timesheet is final (no edit, no direct delete); the totals of a timesheet can not be higher than the work that is logged.

-- ===== A. milestones: escrow steps =====
CREATE OR REPLACE FUNCTION public.guard_milestone_escrow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _is_project_client boolean;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  _is_project_client := EXISTS (
    SELECT 1 FROM public.projects p WHERE p.id = NEW.project_id AND p.client_id = auth.uid()
  );
  IF _is_project_client THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.escrow_status::text <> 'unfunded'
         OR NEW.funded_at IS NOT NULL OR NEW.submitted_at IS NOT NULL OR NEW.approved_at IS NOT NULL OR NEW.released_at IS NOT NULL THEN
        RAISE EXCEPTION 'A new milestone starts unfunded' USING ERRCODE = '42501';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.funded_at IS DISTINCT FROM OLD.funded_at OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
      RAISE EXCEPTION 'Funding and submission times are set by the platform' USING ERRCODE = '42501';
    END IF;
    IF OLD.funded_at IS NOT NULL AND (NEW.amount IS DISTINCT FROM OLD.amount OR NEW.currency IS DISTINCT FROM OLD.currency) THEN
      RAISE EXCEPTION 'The amount of a funded milestone can not be changed' USING ERRCODE = '42501';
    END IF;
    IF NEW.escrow_status IS DISTINCT FROM OLD.escrow_status THEN
      IF NOT ((OLD.escrow_status::text = 'submitted' AND NEW.escrow_status::text = 'approved')
           OR (OLD.escrow_status::text = 'approved' AND NEW.escrow_status::text = 'released')
           OR (NEW.escrow_status::text = 'disputed' AND OLD.escrow_status::text IN ('funded', 'in_progress', 'submitted', 'approved'))) THEN
        RAISE EXCEPTION 'Funding is confirmed by the platform after the payment arrived; you can approve a submitted milestone, release an approved one or open a dispute' USING ERRCODE = '42501';
      END IF;
      IF NEW.escrow_status::text = 'approved' THEN
        NEW.approved_at := now();
      END IF;
      IF NEW.escrow_status::text = 'released' THEN
        NEW.released_at := now();
      END IF;
    ELSIF NEW.approved_at IS DISTINCT FROM OLD.approved_at OR NEW.released_at IS DISTINCT FROM OLD.released_at THEN
      RAISE EXCEPTION 'Approval and release times are set by the platform' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Only the project client can create milestones' USING ERRCODE = '42501';
  END IF;

  IF ROW(NEW.project_id, NEW.title, NEW.description, NEW.amount, NEW.currency, NEW.position,
         NEW.due_date, NEW.funded_at, NEW.approved_at, NEW.released_at)
     IS DISTINCT FROM
     ROW(OLD.project_id, OLD.title, OLD.description, OLD.amount, OLD.currency, OLD.position,
         OLD.due_date, OLD.funded_at, OLD.approved_at, OLD.released_at) THEN
    RAISE EXCEPTION 'Milestone terms and escrow timestamps are controlled by the project client' USING ERRCODE = '42501';
  END IF;
  IF NEW.escrow_status IS DISTINCT FROM OLD.escrow_status
     AND NOT (OLD.escrow_status::text IN ('funded', 'in_progress') AND NEW.escrow_status::text IN ('in_progress', 'submitted')) THEN
    RAISE EXCEPTION 'Consultants can only start or submit a funded milestone' USING ERRCODE = '42501';
  END IF;
  IF NEW.escrow_status::text = 'submitted' AND OLD.escrow_status::text <> 'submitted' THEN
    NEW.submitted_at := now();
  ELSIF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'The submission time is set by the platform' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.guard_milestone_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() = 1 AND public.is_untrusted_writer() AND OLD.funded_at IS NOT NULL THEN
    RAISE EXCEPTION 'A funded milestone can not be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_milestone_delete() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_milestone_delete BEFORE DELETE ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.guard_milestone_delete();

-- ===== B. a released milestone creates a pending payout =====
CREATE UNIQUE INDEX payouts_one_per_milestone ON public.payouts (reference) WHERE reference LIKE 'milestone:%';

CREATE FUNCTION public.create_payout_on_release()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _consultant uuid;
  _admin record;
  _ref text := 'milestone:' || NEW.id::text;
BEGIN
  IF NEW.escrow_status::text = 'released' AND OLD.escrow_status::text IS DISTINCT FROM 'released' AND NEW.funded_at IS NOT NULL THEN
    SELECT p.consultant_id INTO _consultant FROM public.projects p WHERE p.id = NEW.project_id;
    IF _consultant IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.payouts x WHERE x.reference = _ref) THEN
      INSERT INTO public.payouts (consultant_id, amount, currency, status, reference)
      VALUES (_consultant, NEW.amount, NEW.currency, 'pending', _ref);
      FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
        PERFORM public.safe_insert_notification(_admin.user_id, 'Payout to review',
          'A milestone was released: a pending payout of ' || NEW.amount::text || ' ' || COALESCE(NEW.currency, 'USD') || ' needs your review.', 'payment', '/admin');
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_payout_on_release() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_create_payout_on_release AFTER UPDATE OF escrow_status ON public.milestones
  FOR EACH ROW EXECUTE FUNCTION public.create_payout_on_release();

-- ===== C. timesheets =====
CREATE OR REPLACE FUNCTION public.guard_timesheet_signature()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _h numeric;
  _c numeric;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.signed_at      := NULL;
    NEW.signed_by_name := NULL;
    NEW.signature_data := NULL;
    IF NEW.status NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'A new timesheet can only be saved as draft or submitted' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF OLD.status = 'signed' THEN
      RAISE EXCEPTION 'A signed timesheet can not be changed' USING ERRCODE = '42501';
    END IF;
    IF ROW(NEW.ticket_id, NEW.submitted_by, NEW.signed_at, NEW.signed_by_name, NEW.signature_data)
       IS DISTINCT FROM ROW(OLD.ticket_id, OLD.submitted_by, OLD.signed_at, OLD.signed_by_name, OLD.signature_data) THEN
      RAISE EXCEPTION 'Timesheet signature fields are managed by the platform' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION 'Timesheet approval is managed by the platform' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.total_hours IS DISTINCT FROM OLD.total_hours OR NEW.total_cost IS DISTINCT FROM OLD.total_cost THEN
    IF COALESCE(NEW.total_hours, 0) < 0 OR COALESCE(NEW.total_cost, 0) < 0 THEN
      RAISE EXCEPTION 'The timesheet totals can not be negative' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(sum(l.hours), 0), COALESCE(sum(l.total_cost), 0) INTO _h, _c
    FROM public.ticket_work_logs l WHERE l.ticket_id = NEW.ticket_id;
    IF COALESCE(NEW.total_hours, 0) > _h + 0.001 OR COALESCE(NEW.total_cost, 0) > _c + 0.01 THEN
      RAISE EXCEPTION 'The timesheet totals are higher than the logged work' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.guard_timesheet_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() = 1 AND public.is_untrusted_writer() AND OLD.status = 'signed' THEN
    RAISE EXCEPTION 'A signed timesheet can not be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_timesheet_delete() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_guard_timesheet_delete BEFORE DELETE ON public.ticket_timesheet_submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_timesheet_delete();

CREATE FUNCTION public.respond_to_timesheet(_submission_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
  _name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT s.id, s.status, s.submitted_by, s.ticket_id INTO _s
  FROM public.ticket_timesheet_submissions s JOIN public.tickets t ON t.id = s.ticket_id
  WHERE s.id = _submission_id AND t.client_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timesheet not found' USING ERRCODE = '42501';
  END IF;
  IF _s.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted timesheet can be approved or sent back' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('timesheet-respond:' || auth.uid()::text, 60, 3600) THEN
    RAISE EXCEPTION 'Too many answers in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  IF _approve THEN
    SELECT p.display_name INTO _name FROM public.profiles p WHERE p.user_id = auth.uid();
    UPDATE public.ticket_timesheet_submissions
    SET status = 'signed', signed_at = now(), signed_by_name = COALESCE(NULLIF(btrim(_name), ''), 'Client'), signature_method = 'in_app'
    WHERE id = _s.id;
  ELSE
    UPDATE public.ticket_timesheet_submissions
    SET status = 'draft',
        notes = left(COALESCE(notes || E'\n', '') || 'Sent back by the client' || COALESCE(': ' || NULLIF(left(btrim(_note), 500), ''), ''), 4000)
    WHERE id = _s.id;
  END IF;
  IF _s.submitted_by IS DISTINCT FROM auth.uid() THEN
    PERFORM public.safe_insert_notification(_s.submitted_by,
      CASE WHEN _approve THEN 'Timesheet approved' ELSE 'Timesheet sent back' END,
      CASE WHEN _approve THEN 'The client approved your timesheet.' ELSE 'The client sent your timesheet back with a note. Review it and submit it again.' END,
      'ticket', '/consultant/tickets/' || _s.ticket_id::text);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_to_timesheet(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_timesheet(uuid, boolean, text) TO authenticated;