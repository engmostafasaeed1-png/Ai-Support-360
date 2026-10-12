-- lovable-cron-fallback-reviewed: bid deadlines are time-based; owner-specified 5-minute closing window, no row change happens at the deadline
-- M64: the bidding system, end to end.
--  tickets: bid_deadline, bidding_closed_at, bidding_closed_reason; automatic closing when the deadline passes (cron every 5 minutes)
--  proposals: rejection_reason, shortlisted, withdrawn_at; a new version supersedes the older pending versions; clear notices for every bid event
--  counter-offers: one round per consultant and request (RPCs counter_offer, respond_to_counter, cancel_counter)
--  questions before bidding: consultants ask, the client answers, answers are shown to all bidders without names (view ticket_questions_public)
--  bid counts for the consultants' list (RPC ticket_bid_counts); a notice to matching consultants when a request opens for bids

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS bid_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS bidding_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS bidding_closed_reason text;

ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS shortlisted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;

-- 1. the deadline and the closing time of a request ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_ticket_bidding()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
  IF public.is_untrusted_writer() THEN
    IF NEW.bid_deadline IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.bid_deadline IS DISTINCT FROM OLD.bid_deadline)
       AND (NEW.bid_deadline <= now() OR NEW.bid_deadline > now() + interval '30 days') THEN
      RAISE EXCEPTION 'The bidding deadline must be in the future and within 30 days' USING ERRCODE = '22023';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.bidding_closed_at IS DISTINCT FROM OLD.bidding_closed_at OR NEW.bidding_closed_reason IS DISTINCT FROM OLD.bidding_closed_reason) THEN
      RAISE EXCEPTION 'The closing of the bidding is set by the system' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.open_for_bids IS TRUE AND OLD.open_for_bids IS NOT TRUE THEN
      NEW.bidding_closed_at := NULL; NEW.bidding_closed_reason := NULL;
    ELSIF NEW.open_for_bids IS NOT TRUE AND OLD.open_for_bids IS TRUE AND NEW.bidding_closed_at IS NULL THEN
      NEW.bidding_closed_at := now();
      NEW.bidding_closed_reason := CASE WHEN NEW.consultant_id IS NOT NULL AND OLD.consultant_id IS DISTINCT FROM NEW.consultant_id THEN 'assigned' ELSE 'manual' END;
    END IF;
    IF NEW.open_for_bids IS NOT TRUE THEN NEW.bid_deadline := NULL; END IF;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_ticket_bidding ON public.tickets;
CREATE TRIGGER trg_guard_ticket_bidding BEFORE INSERT OR UPDATE OF open_for_bids, bid_deadline, bidding_closed_at, bidding_closed_reason, consultant_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_bidding();

-- 2. a notice to the matching consultants when a request opens for bids -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_open_for_bids()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _areas text[];
  _c record;
  _when text;
BEGIN
  IF NEW.open_for_bids IS NOT TRUE OR NEW.consultant_id IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.open_for_bids IS TRUE THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(DISTINCT lower(btrim(a))) INTO _areas
    FROM unnest(COALESCE(NEW.sap_modules, ARRAY[]::text[]) || ARRAY[NEW.sap_module]) a WHERE a IS NOT NULL AND btrim(a) <> '';
  IF _areas IS NULL THEN
    RETURN NULL;
  END IF;
  _when := CASE WHEN NEW.bid_deadline IS NULL THEN 'No deadline.' ELSE 'Bids close on ' || to_char(NEW.bid_deadline AT TIME ZONE 'UTC', 'Mon DD, YYYY "at" HH24:MI "UTC"') || '.' END;
  FOR _c IN
    SELECT DISTINCT c.user_id
      FROM public.consultants c
      JOIN public.consultant_skills s ON s.consultant_id = c.id
     WHERE c.verification_status = 'verified'::verification_status AND c.new_case_alerts IS NOT FALSE
       AND lower(btrim(s.sap_module)) = ANY (_areas)
       AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = c.user_id AND n.link = '/consultant/open-tickets?ticket=' || NEW.id::text AND n.created_at > now() - interval '1 hour')
     LIMIT 300
  LOOP
    PERFORM public.safe_insert_notification(_c.user_id, 'New request open for bids',
      '"' || left(COALESCE(NEW.title, 'A request'), 80) || '" matches your SAP modules. ' || _when, 'ticket', '/consultant/open-tickets?ticket=' || NEW.id::text);
  END LOOP;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS trg_notify_open_for_bids ON public.tickets;
CREATE TRIGGER trg_notify_open_for_bids AFTER INSERT OR UPDATE OF open_for_bids ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.notify_open_for_bids();

-- 3. bids: guard of the new columns, a new version supersedes the old ones, notices ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_proposal_extras()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
DECLARE
  _owner boolean;
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  _owner := EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = NEW.ticket_id AND t.client_id = auth.uid());
  IF TG_OP = 'INSERT' THEN
    NEW.rejection_reason := NULL; NEW.shortlisted := false; NEW.withdrawn_at := NULL;
    RETURN NEW;
  END IF;
  IF _owner THEN
    IF NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
      RAISE EXCEPTION 'Only the consultant can withdraw a bid' USING ERRCODE = '42501';
    END IF;
    IF NEW.rejection_reason IS NOT NULL AND NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
       AND (char_length(NEW.rejection_reason) > 300 OR public.contact_details_in_text(NEW.rejection_reason)) THEN
      RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF NEW.shortlisted IS DISTINCT FROM OLD.shortlisted OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
      RAISE EXCEPTION 'Only the client can shortlist or reject a bid' USING ERRCODE = '42501';
    END IF;
    IF NEW.status::text = 'withdrawn' AND OLD.status::text <> 'withdrawn' THEN
      IF OLD.status::text <> 'pending' THEN
        RAISE EXCEPTION 'Only a bid that the client has not answered yet can be withdrawn' USING ERRCODE = '42501';
      END IF;
      NEW.withdrawn_at := now();
    ELSIF NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
      RAISE EXCEPTION 'The withdrawal time is set by the system' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_proposal_extras ON public.proposals;
CREATE TRIGGER trg_guard_proposal_extras BEFORE INSERT OR UPDATE ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.guard_proposal_extras();

CREATE OR REPLACE FUNCTION public.supersede_older_bids()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  UPDATE public.proposals
     SET status = 'withdrawn', withdrawn_at = now(), rejection_reason = 'superseded'
   WHERE ticket_id = NEW.ticket_id AND consultant_id = NEW.consultant_id AND id <> NEW.id AND status = 'pending';
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS trg_supersede_older_bids ON public.proposals;
CREATE TRIGGER trg_supersede_older_bids AFTER INSERT ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.supersede_older_bids();

CREATE OR REPLACE FUNCTION public.notify_proposal_events()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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
      PERFORM public.safe_insert_notification(_cons_user, 'Your bid was accepted',
        'The client accepted your bid for "' || COALESCE(_title, 'a request') || '". The request is now assigned to you.', 'ticket', '/consultant/proposals');
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

-- the notice trigger must also fire when the client shortlists a bid
DROP TRIGGER IF EXISTS trg_notify_proposal_events ON public.proposals;
CREATE TRIGGER trg_notify_proposal_events AFTER INSERT OR UPDATE OF status, shortlisted ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.notify_proposal_events();

-- the client who chooses a bid: the other pending bids are declined with the reason "another consultant was chosen"
CREATE OR REPLACE FUNCTION public.accept_proposal(_proposal_id uuid, _client_notes text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
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
     SET status = 'rejected', rejection_reason = 'another_chosen'
   WHERE ticket_id = _t.id AND id <> _p.id AND status = 'pending';
  UPDATE public.proposal_counters SET status = 'cancelled', responded_at = now() WHERE ticket_id = _t.id AND status = 'pending';
END;
$function$;

-- 4. counter-offers: one round per consultant and request -----------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proposal_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  proposed_rate numeric NOT NULL CHECK (proposed_rate > 0 AND proposed_rate <= 100000),
  estimated_hours numeric NOT NULL CHECK (estimated_hours >= 0 AND estimated_hours <= 100000),
  timeline_days integer CHECK (timeline_days IS NULL OR (timeline_days >= 0 AND timeline_days <= 3650)),
  message text CHECK (message IS NULL OR char_length(message) <= 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  new_proposal_id uuid REFERENCES public.proposals(id) ON DELETE SET NULL,
  UNIQUE (ticket_id, consultant_id)
);
ALTER TABLE public.proposal_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "The two parties read the counter-offer" ON public.proposal_counters FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = proposal_counters.ticket_id AND t.client_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = proposal_counters.consultant_id AND c.user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON public.proposal_counters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.proposal_counters TO authenticated;

CREATE OR REPLACE FUNCTION public.counter_offer(_proposal_id uuid, _rate numeric, _hours numeric, _days integer, _message text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _p public.proposals;
  _t public.tickets;
  _id uuid;
  _cons_user uuid;
  _msg text := NULLIF(btrim(COALESCE(_message, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO _p FROM public.proposals WHERE id = _proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bid not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _t FROM public.tickets WHERE id = _p.ticket_id;
  IF _t.client_id <> auth.uid() THEN RAISE EXCEPTION 'Bid not found' USING ERRCODE = '42501'; END IF;
  IF _p.status::text <> 'pending' THEN RAISE EXCEPTION 'Only a bid that is still open can get a counter-offer' USING ERRCODE = '22023'; END IF;
  IF _t.status::text IN ('resolved', 'closed') OR _t.consultant_id IS NOT NULL THEN RAISE EXCEPTION 'This request is no longer open for bids' USING ERRCODE = '22023'; END IF;
  IF _rate IS NULL OR _rate <= 0 OR _rate > 100000 OR _hours IS NULL OR _hours < 0 OR _hours > 100000 OR (_days IS NOT NULL AND (_days < 0 OR _days > 3650)) THEN
    RAISE EXCEPTION 'The counter-offer terms are not valid' USING ERRCODE = '22023';
  END IF;
  IF _msg IS NOT NULL AND (char_length(_msg) > 1000 OR public.contact_details_in_text(_msg)) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.proposal_counters WHERE ticket_id = _p.ticket_id AND consultant_id = _p.consultant_id) THEN
    RAISE EXCEPTION 'You already made a counter-offer to this consultant on this request' USING ERRCODE = '22023';
  END IF;
  IF NOT public.client_review_rate_ok() THEN RAISE EXCEPTION 'Too many attempts. Please wait a while and try again.' USING ERRCODE = '54000'; END IF;
  INSERT INTO public.proposal_counters (proposal_id, ticket_id, consultant_id, proposed_rate, estimated_hours, timeline_days, message, created_by)
  VALUES (_p.id, _p.ticket_id, _p.consultant_id, _rate, _hours, _days, _msg, auth.uid()) RETURNING id INTO _id;
  SELECT c.user_id INTO _cons_user FROM public.consultants c WHERE c.id = _p.consultant_id;
  PERFORM public.safe_insert_notification(_cons_user, 'Counter-offer received',
    'The client proposes ' || _rate::text || '/hr, ' || _hours::text || ' h for "' || left(COALESCE(_t.title, 'a request'), 80) || '". Accept or decline in My bids.', 'ticket', '/consultant/proposals');
  RETURN _id;
END
$function$;

CREATE OR REPLACE FUNCTION public.respond_to_counter(_counter_id uuid, _accept boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _c public.proposal_counters;
  _p public.proposals;
  _t public.tickets;
  _new uuid;
  _client uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO _c FROM public.proposal_counters WHERE id = _counter_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.consultants x WHERE x.id = _c.consultant_id AND x.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Counter-offer not found' USING ERRCODE = '42501';
  END IF;
  IF _c.status <> 'pending' THEN RAISE EXCEPTION 'This counter-offer was already answered' USING ERRCODE = '22023'; END IF;
  SELECT * INTO _t FROM public.tickets WHERE id = _c.ticket_id;
  _client := _t.client_id;
  IF _t.consultant_id IS NOT NULL OR _t.status::text IN ('resolved', 'closed') THEN
    UPDATE public.proposal_counters SET status = 'cancelled', responded_at = now() WHERE id = _c.id;
    RAISE EXCEPTION 'This request is no longer open for bids' USING ERRCODE = '22023';
  END IF;
  IF NOT _accept THEN
    UPDATE public.proposal_counters SET status = 'declined', responded_at = now() WHERE id = _c.id;
    PERFORM public.safe_insert_notification(_client, 'Counter-offer declined',
      'The consultant declined your counter-offer for "' || left(COALESCE(_t.title, 'your request'), 80) || '". Their original bid is still open.', 'ticket', '/client/tickets/' || _c.ticket_id || '?tab=bids');
    RETURN NULL;
  END IF;
  SELECT * INTO _p FROM public.proposals WHERE id = _c.proposal_id;
  INSERT INTO public.proposals (ticket_id, consultant_id, cover_letter, proposed_rate, estimated_hours, timeline_days, version, parent_proposal_id)
  VALUES (_p.ticket_id, _p.consultant_id, _p.cover_letter, _c.proposed_rate, _c.estimated_hours, _c.timeline_days,
          COALESCE((SELECT max(version) FROM public.proposals WHERE ticket_id = _p.ticket_id AND consultant_id = _p.consultant_id), 1) + 1, _p.id)
  RETURNING id INTO _new;
  UPDATE public.proposal_counters SET status = 'accepted', responded_at = now(), new_proposal_id = _new WHERE id = _c.id;
  PERFORM public.safe_insert_notification(_client, 'Counter-offer accepted',
    'The consultant accepted your counter-offer for "' || left(COALESCE(_t.title, 'your request'), 80) || '". The new bid is ready: you can accept it now.', 'ticket', '/client/tickets/' || _c.ticket_id || '?tab=bids');
  RETURN _new;
END
$function$;

CREATE OR REPLACE FUNCTION public.cancel_counter(_counter_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  UPDATE public.proposal_counters c SET status = 'cancelled', responded_at = now()
   WHERE c.id = _counter_id AND c.status = 'pending' AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = c.ticket_id AND t.client_id = auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Counter-offer not found' USING ERRCODE = '42501'; END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.counter_offer(uuid, numeric, numeric, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.respond_to_counter(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_counter(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.counter_offer(uuid, numeric, numeric, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_counter(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_counter(uuid) TO authenticated;

-- 5. questions before bidding ----------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(question) BETWEEN 5 AND 500),
  answer text CHECK (answer IS NULL OR char_length(answer) <= 1000),
  answered_at timestamptz,
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_questions_ticket_idx ON public.ticket_questions (ticket_id, created_at);
ALTER TABLE public.ticket_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Client, asking consultant and admin read the questions" ON public.ticket_questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = ticket_questions.ticket_id AND t.client_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ticket_questions.consultant_id AND c.user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON public.ticket_questions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ticket_questions TO authenticated;

-- the answered questions of a request open for bids, without the name of the asker, for verified consultants
CREATE OR REPLACE VIEW public.ticket_questions_public AS
  SELECT q.id, q.ticket_id, q.question, q.answer, q.created_at, q.answered_at
    FROM public.ticket_questions q JOIN public.tickets t ON t.id = q.ticket_id
   WHERE q.answer IS NOT NULL AND NOT q.hidden
     AND (t.open_for_bids OR t.consultant_id IS NOT NULL OR t.bidding_closed_at IS NOT NULL)
     AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = auth.uid() AND c.verification_status = 'verified'::verification_status);
REVOKE ALL ON public.ticket_questions_public FROM PUBLIC, anon;
GRANT SELECT ON public.ticket_questions_public TO authenticated;

CREATE OR REPLACE FUNCTION public.ask_ticket_question(_ticket_id uuid, _question text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _cons uuid;
  _t public.tickets;
  _q text := btrim(COALESCE(_question, ''));
  _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT c.id INTO _cons FROM public.consultants c WHERE c.user_id = auth.uid() AND c.verification_status = 'verified'::verification_status;
  IF _cons IS NULL THEN RAISE EXCEPTION 'Only verified consultants can ask a question' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _t FROM public.tickets WHERE id = _ticket_id;
  IF NOT FOUND OR _t.open_for_bids IS NOT TRUE OR _t.consultant_id IS NOT NULL THEN RAISE EXCEPTION 'This request is not open for bids' USING ERRCODE = '22023'; END IF;
  IF char_length(_q) < 5 OR char_length(_q) > 500 THEN RAISE EXCEPTION 'A question has 5 to 500 characters' USING ERRCODE = '22023'; END IF;
  IF public.contact_details_in_text(_q) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.ticket_questions WHERE ticket_id = _ticket_id AND consultant_id = _cons) >= 5 THEN
    RAISE EXCEPTION 'You can ask up to 5 questions on one request' USING ERRCODE = '22023';
  END IF;
  IF NOT public.client_review_rate_ok() THEN RAISE EXCEPTION 'Too many attempts. Please wait a while and try again.' USING ERRCODE = '54000'; END IF;
  INSERT INTO public.ticket_questions (ticket_id, consultant_id, question) VALUES (_ticket_id, _cons, _q) RETURNING id INTO _id;
  PERFORM public.safe_insert_notification(_t.client_id, 'A consultant asked a question',
    'About "' || left(COALESCE(_t.title, 'your request'), 80) || '": ' || left(_q, 140), 'ticket', '/client/tickets/' || _ticket_id || '?tab=bids');
  RETURN _id;
END
$function$;

CREATE OR REPLACE FUNCTION public.answer_ticket_question(_question_id uuid, _answer text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _q public.ticket_questions;
  _t public.tickets;
  _a text := btrim(COALESCE(_answer, ''));
  _asker uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '28000'; END IF;
  SELECT * INTO _q FROM public.ticket_questions WHERE id = _question_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Question not found' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _t FROM public.tickets WHERE id = _q.ticket_id;
  IF _t.client_id <> auth.uid() THEN RAISE EXCEPTION 'Question not found' USING ERRCODE = '42501'; END IF;
  IF char_length(_a) < 1 OR char_length(_a) > 1000 THEN RAISE EXCEPTION 'An answer has 1 to 1000 characters' USING ERRCODE = '22023'; END IF;
  IF public.contact_details_in_text(_a) THEN
    RAISE EXCEPTION 'Please do not write e-mail addresses, phone numbers, web links or messenger names here: contact details are shared inside the portal once you are assigned to a request.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.ticket_questions SET answer = _a, answered_at = now() WHERE id = _q.id;
  SELECT c.user_id INTO _asker FROM public.consultants c WHERE c.id = _q.consultant_id;
  PERFORM public.safe_insert_notification(_asker, 'Your question was answered',
    'The client answered your question about "' || left(COALESCE(_t.title, 'a request'), 80) || '".', 'ticket', '/consultant/open-tickets?ticket=' || _q.ticket_id::text);
END
$function$;

CREATE OR REPLACE FUNCTION public.hide_ticket_question(_question_id uuid, _hidden boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  UPDATE public.ticket_questions q SET hidden = _hidden
   WHERE q.id = _question_id AND EXISTS (SELECT 1 FROM public.tickets t WHERE t.id = q.ticket_id AND t.client_id = auth.uid());
  IF NOT FOUND THEN RAISE EXCEPTION 'Question not found' USING ERRCODE = '42501'; END IF;
END
$function$;

REVOKE ALL ON FUNCTION public.ask_ticket_question(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.answer_ticket_question(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hide_ticket_question(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ask_ticket_question(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.answer_ticket_question(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hide_ticket_question(uuid, boolean) TO authenticated;

-- 6. bid counts for the consultants' list (no rates, no names) ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ticket_bid_counts(_ticket_ids uuid[])
RETURNS TABLE(ticket_id uuid, bids integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT p.ticket_id, count(DISTINCT p.consultant_id)::integer
    FROM public.proposals p JOIN public.tickets t ON t.id = p.ticket_id
   WHERE p.ticket_id = ANY (_ticket_ids[1:100]) AND p.status = 'pending' AND t.open_for_bids
     AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = auth.uid() AND c.verification_status = 'verified'::verification_status)
   GROUP BY p.ticket_id
$function$;
REVOKE ALL ON FUNCTION public.ticket_bid_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ticket_bid_counts(uuid[]) TO authenticated;

-- 7. closing when the deadline passes ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.close_expired_bidding()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _t record;
  _n integer := 0;
  _bids integer;
  _b record;
BEGIN
  FOR _t IN SELECT id, client_id, title FROM public.tickets WHERE open_for_bids AND bid_deadline IS NOT NULL AND bid_deadline <= now() FOR UPDATE SKIP LOCKED LOOP
    UPDATE public.tickets SET open_for_bids = false, bidding_closed_at = now(), bidding_closed_reason = 'deadline', bid_deadline = NULL WHERE id = _t.id;
    SELECT count(DISTINCT consultant_id) INTO _bids FROM public.proposals WHERE ticket_id = _t.id AND status = 'pending';
    PERFORM public.safe_insert_notification(_t.client_id, 'Bidding closed',
      'Bidding for "' || left(COALESCE(_t.title, 'your request'), 80) || '" closed. ' || _bids || CASE WHEN _bids = 1 THEN ' bid is' ELSE ' bids are' END || ' waiting for your decision.',
      'ticket', '/client/tickets/' || _t.id || '?tab=bids');
    FOR _b IN SELECT DISTINCT c.user_id FROM public.proposals p JOIN public.consultants c ON c.id = p.consultant_id WHERE p.ticket_id = _t.id AND p.status = 'pending' LOOP
      PERFORM public.safe_insert_notification(_b.user_id, 'Bidding closed',
        'Bidding for "' || left(COALESCE(_t.title, 'a request'), 80) || '" closed. The client is reviewing the bids.', 'ticket', '/consultant/proposals');
    END LOOP;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END
$function$;
REVOKE ALL ON FUNCTION public.close_expired_bidding() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'close-expired-bidding') THEN
    PERFORM cron.schedule('close-expired-bidding', '*/5 * * * *', 'SELECT public.close_expired_bidding()');
  END IF;
END
$cron$;
