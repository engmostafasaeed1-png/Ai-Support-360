-- M30 (timesheet): the hourly rate that the client approves, one timesheet per round of work, comments between client and consultant, and clear statuses.
-- Found by the audit of 2026-10-04 (replay on the live database, rolled back): (1) the same hours could be approved and billed twice (one entry sits in two approved timesheets in production),
-- (2) entries of an approved timesheet could still be edited or deleted, (3) the consultant typed any hourly rate on every entry (default 0, 99999 accepted), nobody approved it,
-- (4) "not billable" hours were charged, (5) "Manual / DocuSign / Adobe Sign" saved a draft that the client never saw, (6) a timesheet sent back had no status of its own, no comment was required and no comment history existed.
-- Nothing is deleted. Old timesheets and the invoice stay as they are; the one existing entry is linked to the timesheet that was invoiced.

-- ===== A. small helper for the notice texts (not callable from the browser) =====
CREATE FUNCTION public.ts_num(_n numeric)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT rtrim(rtrim(to_char(COALESCE(_n, 0), 'FM999999990.00'), '0'), '.')
$function$;
REVOKE ALL ON FUNCTION public.ts_num(numeric) FROM PUBLIC, anon, authenticated;

-- ===== B. the hourly rate per ticket and consultant, approved by the client =====
CREATE TABLE public.ticket_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  hourly_rate numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'proposed',
  source text NOT NULL DEFAULT 'consultant',
  proposed_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_rates_rate_check CHECK (hourly_rate > 0 AND hourly_rate <= 100000),
  CONSTRAINT ticket_rates_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ticket_rates_status_check CHECK (status IN ('proposed', 'approved', 'rejected', 'replaced')),
  CONSTRAINT ticket_rates_source_check CHECK (source IN ('consultant', 'proposal')),
  CONSTRAINT ticket_rates_note_check CHECK (decision_note IS NULL OR char_length(decision_note) <= 500)
);
-- one open proposal and one approved rate for each ticket and consultant
CREATE UNIQUE INDEX ticket_rates_one_proposed ON public.ticket_rates (ticket_id, consultant_id) WHERE status = 'proposed';
CREATE UNIQUE INDEX ticket_rates_one_approved ON public.ticket_rates (ticket_id, consultant_id) WHERE status = 'approved';
CREATE INDEX ticket_rates_ticket_idx ON public.ticket_rates (ticket_id);
CREATE TRIGGER update_ticket_rates_updated_at BEFORE UPDATE ON public.ticket_rates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.ticket_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ticket owner reads the rates of the ticket" ON public.ticket_rates
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_rates.ticket_id AND t.client_id = auth.uid()));
CREATE POLICY "Company members read the rates of the company tickets" ON public.ticket_rates
  FOR SELECT TO authenticated
  USING (public.ticket_in_my_company(ticket_id));
CREATE POLICY "Consultants read their own rates" ON public.ticket_rates
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ticket_rates.consultant_id AND c.user_id = auth.uid()));
CREATE POLICY "Admins read all rates" ON public.ticket_rates
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role));
-- rates are written by the functions below only
REVOKE ALL ON public.ticket_rates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ticket_rates TO authenticated;

-- ===== C. the entries and the timesheets =====
ALTER TABLE public.ticket_work_logs
  ADD COLUMN submission_id uuid REFERENCES public.ticket_timesheet_submissions(id) ON DELETE SET NULL;
CREATE INDEX ticket_work_logs_submission_idx ON public.ticket_work_logs (submission_id);
-- no rate means "not approved yet", never a free hour
ALTER TABLE public.ticket_work_logs ALTER COLUMN hourly_rate DROP DEFAULT;
-- an hour that is not billable costs nothing
ALTER TABLE public.ticket_work_logs ALTER COLUMN total_cost SET EXPRESSION AS (CASE WHEN billable THEN hours * hourly_rate ELSE 0::numeric END);

ALTER TABLE public.ticket_timesheet_submissions
  ADD COLUMN billable_hours numeric NOT NULL DEFAULT 0,
  ADD COLUMN hourly_rate numeric,
  ADD COLUMN vat_percent numeric,
  ADD COLUMN vat_amount numeric,
  ADD COLUMN grand_total numeric,
  ADD COLUMN submitted_at timestamptz,
  ADD COLUMN submit_count integer NOT NULL DEFAULT 1;

-- old rows: all hours were billed, the submission time is the creation time, the invoiced ones keep the numbers of their invoice
UPDATE public.ticket_timesheet_submissions SET billable_hours = COALESCE(total_hours, 0), submitted_at = created_at;
UPDATE public.ticket_timesheet_submissions s
   SET vat_amount = p.vat_amount,
       grand_total = p.amount,
       vat_percent = CASE WHEN COALESCE(s.total_cost, 0) > 0 THEN round(p.vat_amount * 100 / s.total_cost, 2) END
  FROM public.payments p
 WHERE p.timesheet_id = s.id AND s.status = 'signed';

-- the one existing entry belongs to the timesheet that was invoiced (else the first approved one) so that it can never be billed a second time
UPDATE public.ticket_work_logs l
   SET submission_id = x.sid
  FROM (
    SELECT DISTINCT ON (l2.id) l2.id AS lid, s.id AS sid
      FROM public.ticket_work_logs l2
      JOIN public.consultants c ON c.id = l2.consultant_id
      JOIN public.ticket_timesheet_submissions s ON s.ticket_id = l2.ticket_id AND s.submitted_by = c.user_id AND s.status = 'signed'
      LEFT JOIN public.payments p ON p.timesheet_id = s.id
     WHERE l2.submission_id IS NULL
     ORDER BY l2.id, (p.id IS NOT NULL) DESC, s.signed_at
  ) x
 WHERE l.id = x.lid;

ALTER TABLE public.ticket_timesheet_submissions
  ADD CONSTRAINT ticket_timesheet_status_check CHECK (status IN ('draft', 'submitted', 'changes_requested', 'signed'));

-- ===== D. comments between client and consultant =====
CREATE TABLE public.ticket_timesheet_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.ticket_timesheet_submissions(id) ON DELETE CASCADE,
  author_id uuid NOT NULL,
  author_role text NOT NULL,
  kind text NOT NULL DEFAULT 'comment',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_timesheet_comments_role_check CHECK (author_role IN ('client', 'consultant')),
  CONSTRAINT ticket_timesheet_comments_kind_check CHECK (kind IN ('comment', 'change_request', 'approval', 'resubmitted')),
  CONSTRAINT ticket_timesheet_comments_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000)
);
CREATE INDEX ticket_timesheet_comments_submission_idx ON public.ticket_timesheet_comments (submission_id, created_at);
ALTER TABLE public.ticket_timesheet_comments ENABLE ROW LEVEL SECURITY;
-- a comment can be read by everybody who can read its timesheet (the row security of the timesheet decides)
CREATE POLICY "Comments follow the timesheet" ON public.ticket_timesheet_comments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ticket_timesheet_submissions s WHERE s.id = ticket_timesheet_comments.submission_id));
REVOKE ALL ON public.ticket_timesheet_comments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ticket_timesheet_comments TO authenticated;

-- ===== E. guards =====
-- E1. entries: what the consultant may write. The rate always comes from the rate that the client approved (typed values are ignored),
-- an entry that sits in a timesheet that was sent to the client or approved can not be changed, every entry says what was done.
CREATE OR REPLACE FUNCTION public.validate_work_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _rate numeric;
  _locked boolean;
BEGIN
  IF NEW.hours IS NULL OR NEW.hours <= 0 OR NEW.hours > 24 THEN
    RAISE EXCEPTION 'Hours must be greater than 0 and at most 24 per entry' USING ERRCODE = '22023';
  END IF;
  IF NEW.work_date IS NOT NULL AND (NEW.work_date > current_date + 1 OR NEW.work_date < current_date - 365) THEN
    RAISE EXCEPTION 'The work date must be within the last year and not in the future' USING ERRCODE = '22023';
  END IF;
  IF NEW.hourly_rate IS NOT NULL AND (NEW.hourly_rate < 0 OR NEW.hourly_rate > 100000) THEN
    RAISE EXCEPTION 'Invalid hourly rate' USING ERRCODE = '22023';
  END IF;
  IF NEW.description IS NOT NULL AND char_length(NEW.description) > 5000 THEN
    RAISE EXCEPTION 'The description is too long' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF char_length(btrim(COALESCE(NEW.description, ''))) < 3 THEN
    RAISE EXCEPTION 'Describe what was done (at least 3 characters)' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.submission_id := NULL;
    SELECT r.hourly_rate INTO _rate
      FROM public.ticket_rates r
     WHERE r.ticket_id = NEW.ticket_id AND r.consultant_id = NEW.consultant_id AND r.status = 'approved';
    NEW.hourly_rate := _rate;
  ELSE
    IF OLD.submission_id IS NOT NULL THEN
      SELECT s.status IN ('submitted', 'signed') INTO _locked FROM public.ticket_timesheet_submissions s WHERE s.id = OLD.submission_id;
      IF COALESCE(_locked, false) THEN
        RAISE EXCEPTION 'This entry is part of a timesheet that was sent to the client and can not be changed' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.ticket_id IS DISTINCT FROM OLD.ticket_id OR NEW.consultant_id IS DISTINCT FROM OLD.consultant_id THEN
      RAISE EXCEPTION 'An entry can not be moved to another ticket or consultant' USING ERRCODE = '42501';
    END IF;
    NEW.submission_id := OLD.submission_id;
    NEW.hourly_rate := OLD.hourly_rate;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION public.guard_work_log_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() = 1 AND public.is_untrusted_writer() AND OLD.submission_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.ticket_timesheet_submissions s WHERE s.id = OLD.submission_id AND s.status IN ('submitted', 'signed')) THEN
    RAISE EXCEPTION 'This entry is part of a timesheet that was sent to the client and can not be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;
CREATE TRIGGER trg_guard_work_log_delete BEFORE DELETE ON public.ticket_work_logs FOR EACH ROW EXECUTE FUNCTION public.guard_work_log_delete();

-- E2. timesheets: a timesheet is created by "submit_timesheet" and answered by "respond_to_timesheet", never written from the browser
CREATE OR REPLACE FUNCTION public.guard_timesheet_signature()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Use "Submit for approval" to send a timesheet to the client' USING ERRCODE = '42501';
  END IF;
  RAISE EXCEPTION 'A timesheet is changed through the approval buttons and comments only' USING ERRCODE = '42501';
END;
$function$;

-- E3. a timesheet that was sent to the client can not be deleted from the browser (it would erase the comments of the client); only an old, never sent draft can
CREATE OR REPLACE FUNCTION public.guard_timesheet_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF pg_trigger_depth() = 1 AND public.is_untrusted_writer() AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'A timesheet that was sent to the client can not be deleted' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$function$;

-- the old notice fired on every insert; the new functions send their own notices (also for a timesheet that is submitted again)
DROP TRIGGER IF EXISTS trg_notify_timesheet_submitted ON public.ticket_timesheet_submissions;
DROP FUNCTION IF EXISTS public.notify_timesheet_submitted();

-- ===== F. the VAT percentage for the summary on screen (the invoice itself still uses the platform setting at the time of the approval) =====
CREATE FUNCTION public.timesheet_vat_percent()
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(public.payment_vat_percent(), 0)
$function$;
REVOKE ALL ON FUNCTION public.timesheet_vat_percent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.timesheet_vat_percent() TO authenticated;

-- ===== G. the rate: the consultant proposes it, the client approves it (an accepted bid counts as approved) =====
CREATE FUNCTION public.propose_ticket_rate(_ticket_id uuid, _hourly_rate numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _t record;
  _cons uuid;
  _rate numeric := round(_hourly_rate, 2);
  _cur text;
  _locked text;
  _appr record;
  _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _rate IS NULL OR _rate <= 0 OR _rate > 100000 THEN
    RAISE EXCEPTION 'Enter a valid hourly rate' USING ERRCODE = '22023';
  END IF;
  SELECT t.id, t.client_id, t.title, t.consultant_id, t.cost_currency INTO _t FROM public.tickets t WHERE t.id = _ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501';
  END IF;
  SELECT c.id INTO _cons FROM public.consultants c WHERE c.user_id = auth.uid() AND c.verification_status = 'verified';
  IF _cons IS NULL OR NOT (_t.consultant_id = _cons OR EXISTS (
       SELECT 1 FROM public.ticket_assignments a WHERE a.ticket_id = _ticket_id AND a.consultant_id = _cons AND a.status = 'active')) THEN
    RAISE EXCEPTION 'Only a consultant working on this ticket can propose an hourly rate' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('rate-propose:' || auth.uid()::text, 20, 3600) THEN
    RAISE EXCEPTION 'Too many rate proposals in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  -- one currency for a ticket and consultant: the one of the first rate, else the currency of the ticket
  SELECT r.currency INTO _locked FROM public.ticket_rates r
   WHERE r.ticket_id = _ticket_id AND r.consultant_id = _cons AND r.status IN ('approved', 'replaced')
   ORDER BY r.created_at LIMIT 1;
  _cur := COALESCE(_locked, upper(NULLIF(btrim(_t.cost_currency), '')), 'USD');
  SELECT r.id, r.hourly_rate INTO _appr FROM public.ticket_rates r
   WHERE r.ticket_id = _ticket_id AND r.consultant_id = _cons AND r.status = 'approved';
  IF FOUND AND _appr.hourly_rate = _rate THEN
    RETURN _appr.id;
  END IF;
  UPDATE public.ticket_rates SET status = 'replaced'
   WHERE ticket_id = _ticket_id AND consultant_id = _cons AND status = 'proposed';
  INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status, source, proposed_by)
  VALUES (_ticket_id, _cons, _rate, _cur, 'proposed', 'consultant', auth.uid())
  RETURNING id INTO _id;
  PERFORM public.safe_insert_notification(_t.client_id, 'Hourly rate awaiting your approval',
    'The consultant proposed ' || public.ts_num(_rate) || ' ' || _cur || ' per hour for "' || left(COALESCE(_t.title, 'your ticket'), 80)
      || '". Approve it so that the timesheet can be billed.',
    'ticket', '/client/tickets/' || _ticket_id::text);
  RETURN _id;
END;
$function$;
REVOKE ALL ON FUNCTION public.propose_ticket_rate(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_ticket_rate(uuid, numeric) TO authenticated;

CREATE FUNCTION public.respond_to_ticket_rate(_rate_id uuid, _approve boolean, _note text DEFAULT NULL)
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
      CASE WHEN _approve
           THEN 'The client approved ' || public.ts_num(_r.hourly_rate) || ' ' || _r.currency || ' per hour for "' || left(COALESCE(_r.title, 'the ticket'), 80) || '". You can submit your timesheet now.'
           ELSE 'The client declined ' || public.ts_num(_r.hourly_rate) || ' ' || _r.currency || ' per hour for "' || left(COALESCE(_r.title, 'the ticket'), 80) || '": ' || left(_n, 200)
      END,
      'ticket', '/consultant/tickets/' || _r.ticket_id::text);
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.respond_to_ticket_rate(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_ticket_rate(uuid, boolean, text) TO authenticated;

-- an accepted bid is the client's approval of the rate in the bid
CREATE FUNCTION public.approve_rate_from_proposal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _t record;
  _cur text;
  _locked text;
  _cons_user uuid;
  _rate numeric;
BEGIN
  IF NEW.status::text <> 'accepted' OR (TG_OP = 'UPDATE' AND OLD.status::text = 'accepted') THEN
    RETURN NEW;
  END IF;
  _rate := round(NEW.proposed_rate, 2);
  IF _rate IS NULL OR _rate <= 0 OR _rate > 100000 THEN
    RETURN NEW;
  END IF;
  SELECT t.client_id, t.cost_currency INTO _t FROM public.tickets t WHERE t.id = NEW.ticket_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  SELECT r.currency INTO _locked FROM public.ticket_rates r
   WHERE r.ticket_id = NEW.ticket_id AND r.consultant_id = NEW.consultant_id AND r.status IN ('approved', 'replaced')
   ORDER BY r.created_at LIMIT 1;
  _cur := COALESCE(_locked, upper(NULLIF(btrim(_t.cost_currency), '')), 'USD');
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = NEW.consultant_id;
  UPDATE public.ticket_rates SET status = 'replaced'
   WHERE ticket_id = NEW.ticket_id AND consultant_id = NEW.consultant_id AND status IN ('proposed', 'approved');
  INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status, source, proposed_by, decided_by, decided_at, decision_note)
  VALUES (NEW.ticket_id, NEW.consultant_id, _rate, _cur, 'approved', 'proposal', _cons_user, COALESCE(auth.uid(), _t.client_id), now(),
          'Accepted proposal (version ' || COALESCE(NEW.version, 1) || ')');
  UPDATE public.ticket_work_logs SET hourly_rate = _rate
   WHERE ticket_id = NEW.ticket_id AND consultant_id = NEW.consultant_id AND hourly_rate IS NULL AND submission_id IS NULL;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_approve_rate_from_proposal
  AFTER INSERT OR UPDATE OF status ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.approve_rate_from_proposal();

-- ===== H. submit the timesheet: all the entries that are not in an approved or waiting timesheet yet =====
CREATE FUNCTION public.submit_timesheet(_ticket_id uuid, _message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _cons uuid;
  _t record;
  _open_id uuid;
  _open_count integer;
  _sid uuid;
  _msg text := left(btrim(COALESCE(_message, '')), 1000);
  _n integer;
  _blank integer;
  _norate integer;
  _hours numeric;
  _bill numeric;
  _cost numeric;
  _rates integer;
  _rate numeric;
  _cur text;
  _again boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT c.id INTO _cons FROM public.consultants c WHERE c.user_id = _uid AND c.verification_status = 'verified';
  SELECT t.id, t.client_id, t.title, t.consultant_id, t.cost_currency INTO _t FROM public.tickets t WHERE t.id = _ticket_id;
  IF _cons IS NULL OR _t.id IS NULL OR NOT (_t.consultant_id = _cons OR EXISTS (
       SELECT 1 FROM public.ticket_assignments a WHERE a.ticket_id = _ticket_id AND a.consultant_id = _cons AND a.status = 'active')) THEN
    RAISE EXCEPTION 'Only a consultant working on this ticket can submit a timesheet' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('timesheet-submit:' || _uid::text, 30, 3600) THEN
    RAISE EXCEPTION 'Too many submissions in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ticket_timesheet_submissions s WHERE s.ticket_id = _ticket_id AND s.submitted_by = _uid AND s.status = 'submitted') THEN
    RAISE EXCEPTION 'A timesheet is already waiting for the answer of the client' USING ERRCODE = '42501';
  END IF;
  -- a timesheet that the client sent back is submitted again (same timesheet, new round)
  SELECT s.id, s.submit_count INTO _open_id, _open_count
    FROM public.ticket_timesheet_submissions s
   WHERE s.ticket_id = _ticket_id AND s.submitted_by = _uid AND s.status = 'changes_requested'
   ORDER BY s.created_at DESC LIMIT 1
   FOR UPDATE;
  _again := _open_id IS NOT NULL;
  SELECT count(*),
         count(*) FILTER (WHERE char_length(btrim(COALESCE(l.description, ''))) < 3),
         count(*) FILTER (WHERE l.billable AND l.hourly_rate IS NULL),
         COALESCE(sum(l.hours), 0),
         COALESCE(sum(l.hours) FILTER (WHERE l.billable), 0),
         COALESCE(sum(l.total_cost), 0),
         count(DISTINCT l.hourly_rate) FILTER (WHERE l.billable),
         min(l.hourly_rate) FILTER (WHERE l.billable)
    INTO _n, _blank, _norate, _hours, _bill, _cost, _rates, _rate
    FROM public.ticket_work_logs l
   WHERE l.ticket_id = _ticket_id AND l.consultant_id = _cons AND (l.submission_id IS NULL OR l.submission_id = _open_id);
  IF _n = 0 THEN
    RAISE EXCEPTION 'There is no new work to submit. Add an entry first.' USING ERRCODE = '22023';
  END IF;
  IF _blank > 0 THEN
    RAISE EXCEPTION 'Every entry needs a description before the timesheet is submitted' USING ERRCODE = '22023';
  END IF;
  IF _norate > 0 THEN
    RAISE EXCEPTION 'Your hourly rate for this ticket has not been approved yet. Propose it and wait for the client to approve it.' USING ERRCODE = '22023';
  END IF;
  SELECT r.currency INTO _cur FROM public.ticket_rates r
   WHERE r.ticket_id = _ticket_id AND r.consultant_id = _cons AND r.status IN ('approved', 'replaced')
   ORDER BY (r.status = 'approved') DESC, r.created_at DESC LIMIT 1;
  _cur := COALESCE(_cur, upper(NULLIF(btrim(_t.cost_currency), '')), 'USD');
  IF _again THEN
    _sid := _open_id;
    UPDATE public.ticket_timesheet_submissions
       SET status = 'submitted', total_hours = _hours, billable_hours = _bill, total_cost = _cost, cost_currency = _cur,
           hourly_rate = CASE WHEN _rates = 1 THEN _rate END, signature_method = 'in_app', submitted_at = now(), submit_count = _open_count + 1
     WHERE id = _sid;
  ELSE
    INSERT INTO public.ticket_timesheet_submissions
      (ticket_id, submitted_by, status, total_hours, billable_hours, total_cost, cost_currency, hourly_rate, signature_method, submitted_at, submit_count, notes)
    VALUES
      (_ticket_id, _uid, 'submitted', _hours, _bill, _cost, _cur, CASE WHEN _rates = 1 THEN _rate END, 'in_app', now(), 1,
       'Timesheet for "' || left(COALESCE(_t.title, 'ticket'), 120) || '"')
    RETURNING id INTO _sid;
  END IF;
  UPDATE public.ticket_work_logs SET submission_id = _sid
   WHERE ticket_id = _ticket_id AND consultant_id = _cons AND (submission_id IS NULL OR submission_id = _sid);
  IF _msg <> '' THEN
    INSERT INTO public.ticket_timesheet_comments (submission_id, author_id, author_role, kind, body)
    VALUES (_sid, _uid, 'consultant', CASE WHEN _again THEN 'resubmitted' ELSE 'comment' END, _msg);
  END IF;
  PERFORM public.safe_insert_notification(_t.client_id,
    CASE WHEN _again THEN 'Timesheet submitted again for your approval' ELSE 'Timesheet submitted for your approval' END,
    public.ts_num(_hours) || ' h, ' || public.ts_num(_cost) || ' ' || _cur || ' on "' || left(COALESCE(_t.title, 'your ticket'), 80) || '"'
      || CASE WHEN _msg <> '' THEN '. Message: ' || left(_msg, 160) ELSE '' END,
    'ticket', '/client/tickets/' || _ticket_id::text);
  RETURN _sid;
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_timesheet(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_timesheet(uuid, text) TO authenticated;

-- ===== I. the client approves the timesheet or asks for changes (a comment is required for changes) =====
CREATE OR REPLACE FUNCTION public.respond_to_timesheet(_submission_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
  _name text;
  _title text;
  _cons uuid;
  _n text := left(btrim(COALESCE(_note, '')), 1000);
  _cur text;
  _vat_pct numeric;
  _vat numeric;
  _grand numeric;
  _billed numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT s.id, s.status, s.submitted_by, s.ticket_id, s.total_hours, s.billable_hours, s.total_cost, s.cost_currency, t.client_id, t.title INTO _s
    FROM public.ticket_timesheet_submissions s JOIN public.tickets t ON t.id = s.ticket_id
   WHERE s.id = _submission_id AND t.client_id = auth.uid()
   FOR UPDATE OF s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timesheet not found' USING ERRCODE = '42501';
  END IF;
  IF _s.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted timesheet can be approved or sent back' USING ERRCODE = '42501';
  END IF;
  IF NOT _approve AND char_length(_n) < 3 THEN
    RAISE EXCEPTION 'Please tell the consultant what to change' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('timesheet-respond:' || auth.uid()::text, 60, 3600) THEN
    RAISE EXCEPTION 'Too many answers in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  _cur := COALESCE(NULLIF(btrim(_s.cost_currency), ''), 'USD');
  _title := left(COALESCE(_s.title, 'ticket'), 80);
  _billed := COALESCE(NULLIF(_s.billable_hours, 0), _s.total_hours, 0);
  IF _approve THEN
    SELECT p.display_name INTO _name FROM public.profiles p WHERE p.user_id = auth.uid();
    _vat_pct := COALESCE(public.payment_vat_percent(), 0);
    _vat := round(COALESCE(_s.total_cost, 0) * _vat_pct / 100, 2);
    _grand := COALESCE(_s.total_cost, 0) + _vat;
    UPDATE public.ticket_timesheet_submissions
       SET status = 'signed', signed_at = now(), signed_by_name = COALESCE(NULLIF(btrim(_name), ''), 'Client'), signature_method = 'in_app',
           vat_percent = _vat_pct, vat_amount = _vat, grand_total = _grand
     WHERE id = _s.id;
    IF _n <> '' THEN
      INSERT INTO public.ticket_timesheet_comments (submission_id, author_id, author_role, kind, body) VALUES (_s.id, auth.uid(), 'client', 'approval', _n);
    END IF;
    -- bill the approved hours (only for hours filed by a consultant)
    SELECT c.id INTO _cons FROM public.consultants c WHERE c.user_id = _s.submitted_by;
    IF _cons IS NOT NULL AND COALESCE(_s.total_cost, 0) > 0 THEN
      INSERT INTO public.payments (client_id, consultant_id, ticket_id, timesheet_id, amount, vat_amount, currency, status, kind, description, due_date, payment_method)
      VALUES (_s.client_id, _cons, _s.ticket_id, _s.id, _grand, _vat, _cur, 'pending', 'invoice',
              'Timesheet: ' || public.ts_num(_billed) || ' h on "' || _title || '"', now() + interval '14 days', 'bank_transfer')
      ON CONFLICT (timesheet_id) WHERE timesheet_id IS NOT NULL DO NOTHING;
      IF FOUND THEN
        PERFORM public.safe_insert_notification(auth.uid(), 'Invoice created',
          'An invoice of ' || public.ts_num(_grand) || ' ' || _cur || ' was created for the approved timesheet. Open Payments & Invoices for the bank details.', 'payment', '/client/payments');
      END IF;
    END IF;
  ELSE
    UPDATE public.ticket_timesheet_submissions SET status = 'changes_requested' WHERE id = _s.id;
    INSERT INTO public.ticket_timesheet_comments (submission_id, author_id, author_role, kind, body) VALUES (_s.id, auth.uid(), 'client', 'change_request', _n);
  END IF;
  IF _s.submitted_by IS DISTINCT FROM auth.uid() THEN
    PERFORM public.safe_insert_notification(_s.submitted_by,
      CASE WHEN _approve THEN 'Timesheet approved' ELSE 'Timesheet needs changes' END,
      CASE WHEN _approve
           THEN 'The client approved your timesheet (' || public.ts_num(_billed) || ' h, ' || public.ts_num(_s.total_cost) || ' ' || _cur || ') on "' || _title || '".'
           ELSE 'The client asked for changes on "' || _title || '": ' || left(_n, 200)
      END,
      'ticket', '/consultant/tickets/' || _s.ticket_id::text);
  END IF;
END;
$function$;

-- ===== J. comments: the client and the consultant of a timesheet can write to each other =====
CREATE FUNCTION public.add_timesheet_comment(_submission_id uuid, _body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
  _role text;
  _other uuid;
  _b text := btrim(COALESCE(_body, ''));
  _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF char_length(_b) < 1 THEN
    RAISE EXCEPTION 'Write a comment first' USING ERRCODE = '22023';
  END IF;
  IF char_length(_b) > 1000 THEN
    RAISE EXCEPTION 'The comment is too long (1000 characters at most)' USING ERRCODE = '22023';
  END IF;
  SELECT s.id, s.ticket_id, s.submitted_by, t.client_id, t.title INTO _s
    FROM public.ticket_timesheet_submissions s JOIN public.tickets t ON t.id = s.ticket_id
   WHERE s.id = _submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timesheet not found' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() = _s.client_id THEN
    _role := 'client';
    _other := _s.submitted_by;
  ELSIF auth.uid() = _s.submitted_by THEN
    _role := 'consultant';
    _other := _s.client_id;
  ELSE
    RAISE EXCEPTION 'Timesheet not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('timesheet-comment:' || auth.uid()::text, 30, 3600) THEN
    RAISE EXCEPTION 'Too many comments in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.ticket_timesheet_comments (submission_id, author_id, author_role, kind, body)
  VALUES (_s.id, auth.uid(), _role, 'comment', _b)
  RETURNING id INTO _id;
  IF _other IS NOT NULL AND _other IS DISTINCT FROM auth.uid() THEN
    PERFORM public.safe_insert_notification(_other, 'New comment on a timesheet',
      'On "' || left(COALESCE(_s.title, 'a ticket'), 80) || '": ' || left(_b, 200),
      'ticket', CASE WHEN _role = 'client' THEN '/consultant/tickets/' ELSE '/client/tickets/' END || _s.ticket_id::text);
  END IF;
  RETURN _id;
END;
$function$;
REVOKE ALL ON FUNCTION public.add_timesheet_comment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_timesheet_comment(uuid, text) TO authenticated;

-- ===== K. trigger functions are not callable from the browser =====
-- New functions are open to visitors and signed-in users by default in this project; a trigger function needs no such right to fire.
-- The two new ones, and the four trigger functions of M25, M26 and M27 that were left open (handle_new_user and process_referral_signup stay as they are: the sign-up needs them).
REVOKE ALL ON FUNCTION public.guard_work_log_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_rate_from_proposal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_linkedin_url() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_credly_username() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_consultant_geo() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_admins_consultant_applied() FROM PUBLIC, anon, authenticated;