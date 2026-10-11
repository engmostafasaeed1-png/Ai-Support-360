-- lovable-cron-fallback-reviewed: per-minute tick required to detect expired critical reply windows and send 10-minute reminders; max 1 minute delay, 1440 runs/day accepted
-- M56: optional critical response service (default: reply within 30 minutes, +30 % for the consultant who replies in time).
-- A client can opt in (urgency Critical), choose a longer window or a higher surcharge, and commits to it. Verified consultants who cover the SAP area are alerted.
-- A consultant who replies (proposal or accepted match) within the window earns the surcharge on the approved hourly rate.
-- Nobody replies in time: no surcharge. While nobody is assigned the client can extend the window and raise the surcharge.
-- Every change is additive; existing tickets are untouched.

-- 1. settings (admin changes them through admin_set_critical_service)
INSERT INTO public.platform_settings (key, value)
SELECT 'critical_service', jsonb_build_object('enabled', true, 'minutes', 30, 'surcharge_percent', 30, 'max_minutes', 240, 'max_surcharge_percent', 100)
 WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings WHERE key = 'critical_service');

-- 2. ticket columns
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS critical_response boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS critical_minutes integer,
  ADD COLUMN IF NOT EXISTS critical_surcharge_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS critical_committed_at timestamptz,
  ADD COLUMN IF NOT EXISTS critical_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS critical_status text,
  ADD COLUMN IF NOT EXISTS critical_first_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS critical_first_reply_by uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS critical_extensions integer NOT NULL DEFAULT 0;

ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_critical_consistent;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_critical_consistent CHECK (
  (NOT critical_response
     AND critical_minutes IS NULL AND critical_surcharge_percent IS NULL AND critical_committed_at IS NULL
     AND critical_due_at IS NULL AND critical_status IS NULL AND critical_first_reply_at IS NULL AND critical_first_reply_by IS NULL
     AND critical_extensions = 0)
  OR
  (critical_response
     AND critical_minutes IS NOT NULL AND critical_minutes BETWEEN 5 AND 720
     AND critical_surcharge_percent IS NOT NULL AND critical_surcharge_percent BETWEEN 0 AND 300
     AND critical_committed_at IS NOT NULL AND critical_due_at IS NOT NULL
     AND critical_status IS NOT NULL AND critical_status IN ('waiting', 'answered', 'missed')
     AND critical_extensions BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS tickets_critical_waiting_idx ON public.tickets (critical_due_at) WHERE critical_response AND critical_status = 'waiting';

-- 3. the approved rate remembers the consultant's own number and the surcharge that was added
ALTER TABLE public.ticket_rates
  ADD COLUMN IF NOT EXISTS base_rate numeric(12,2),
  ADD COLUMN IF NOT EXISTS surcharge_percent numeric(5,2);

-- 4. alerts, replies and the history of changes (written only by the functions below)
CREATE TABLE IF NOT EXISTS public.critical_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alerted_at timestamptz NOT NULL DEFAULT now(),
  last_alerted_at timestamptz NOT NULL DEFAULT now(),
  alert_count integer NOT NULL DEFAULT 1,
  dismissed_at timestamptz,
  emailed_at timestamptz,
  emailed_ext integer,
  UNIQUE (ticket_id, consultant_id)
);
CREATE INDEX IF NOT EXISTS critical_alerts_user_idx ON public.critical_alerts (user_id, alerted_at DESC);
CREATE INDEX IF NOT EXISTS critical_alerts_ticket_idx ON public.critical_alerts (ticket_id);

CREATE TABLE IF NOT EXISTS public.critical_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  replied_at timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL CHECK (kind IN ('proposal', 'match_accepted')),
  UNIQUE (ticket_id, consultant_id)
);

CREATE TABLE IF NOT EXISTS public.critical_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('extended', 'boosted', 'extended_and_boosted')),
  by_user uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  old_due_at timestamptz,
  new_due_at timestamptz,
  old_percent numeric(5,2),
  new_percent numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS critical_events_ticket_idx ON public.critical_events (ticket_id, created_at);

ALTER TABLE public.critical_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.critical_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.critical_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.critical_alerts FROM anon, authenticated;
REVOKE ALL ON public.critical_replies FROM anon, authenticated;
REVOKE ALL ON public.critical_events FROM anon, authenticated;
GRANT SELECT ON public.critical_alerts TO authenticated;
GRANT SELECT ON public.critical_replies TO authenticated;
GRANT SELECT ON public.critical_events TO authenticated;

DROP POLICY IF EXISTS "Consultants read their own critical alerts" ON public.critical_alerts;
CREATE POLICY "Consultants read their own critical alerts" ON public.critical_alerts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read critical alerts" ON public.critical_alerts;
CREATE POLICY "Admins read critical alerts" ON public.critical_alerts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Consultants read their own critical replies" ON public.critical_replies;
CREATE POLICY "Consultants read their own critical replies" ON public.critical_replies
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = critical_replies.consultant_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "Admins read critical replies" ON public.critical_replies;
CREATE POLICY "Admins read critical replies" ON public.critical_replies
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins read critical events" ON public.critical_events;
CREATE POLICY "Admins read critical events" ON public.critical_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

DO $pub$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.critical_alerts;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$pub$;

-- 5. terms (what the client is told and what the consultant earns) and the admin switch
CREATE OR REPLACE FUNCTION public.critical_service_terms()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT jsonb_build_object(
    'enabled', COALESCE((SELECT (s.value ->> 'enabled')::boolean FROM public.platform_settings s WHERE s.key = 'critical_service'), false),
    'minutes', COALESCE((SELECT (s.value ->> 'minutes')::integer FROM public.platform_settings s WHERE s.key = 'critical_service'), 30),
    'surcharge_percent', COALESCE((SELECT (s.value ->> 'surcharge_percent')::numeric FROM public.platform_settings s WHERE s.key = 'critical_service'), 30),
    'max_minutes', COALESCE((SELECT (s.value ->> 'max_minutes')::integer FROM public.platform_settings s WHERE s.key = 'critical_service'), 240),
    'max_surcharge_percent', COALESCE((SELECT (s.value ->> 'max_surcharge_percent')::numeric FROM public.platform_settings s WHERE s.key = 'critical_service'), 100)
  )
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_critical_service(_enabled boolean, _minutes integer, _percent numeric, _max_minutes integer, _max_percent numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _val jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'Only an administrator can change the critical service' USING ERRCODE = '42501';
  END IF;
  IF _enabled IS NULL OR _minutes IS NULL OR _percent IS NULL OR _max_minutes IS NULL OR _max_percent IS NULL THEN
    RAISE EXCEPTION 'Fill in the switch, the reply window, the surcharge and both limits' USING ERRCODE = '22023';
  END IF;
  IF _minutes < 5 OR _minutes > 720 THEN
    RAISE EXCEPTION 'The reply window must be between 5 and 720 minutes' USING ERRCODE = '22023';
  END IF;
  IF _percent < 0 OR _percent > 300 THEN
    RAISE EXCEPTION 'The surcharge must be between 0 and 300 percent' USING ERRCODE = '22023';
  END IF;
  IF _max_minutes < _minutes OR _max_minutes > 720 THEN
    RAISE EXCEPTION 'The longest window must be at least the standard window and at most 720 minutes' USING ERRCODE = '22023';
  END IF;
  IF _max_percent < _percent OR _max_percent > 300 THEN
    RAISE EXCEPTION 'The highest surcharge must be at least the standard surcharge and at most 300 percent' USING ERRCODE = '22023';
  END IF;
  _val := jsonb_build_object('enabled', _enabled, 'minutes', _minutes, 'surcharge_percent', round(_percent, 2),
                             'max_minutes', _max_minutes, 'max_surcharge_percent', round(_max_percent, 2));
  UPDATE public.platform_settings SET value = _val WHERE key = 'critical_service';
  IF NOT FOUND THEN
    INSERT INTO public.platform_settings (key, value) VALUES ('critical_service', _val);
  END IF;
  RETURN public.critical_service_terms();
END
$function$;

-- 6. words of an SAP area ("SAP FI/CO" and "SAP CO" share CO; the generic words are ignored)
CREATE OR REPLACE FUNCTION public.sap_area_tokens(_name text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $function$
  SELECT COALESCE(array_agg(DISTINCT w ORDER BY w), '{}'::text[])
    FROM (
      SELECT regexp_split_to_table(lower(regexp_replace(COALESCE(_name, ''), '[^A-Za-z0-9]+', ' ', 'g')), '\s+') AS w
    ) x
   WHERE char_length(w) >= 2
     AND w NOT IN ('sap', 'for', 'and', 'of', 'the', 'on', 'premise', 'cloud', 'private', 'public', 'edition', 'other',
                   'business', 'data', 'new', 'with', 'management', 'solution')
$function$;

-- who is alerted: verified consultants who cover the ticket's areas (their skills or technologies share a word with one of the areas);
-- when nobody matches, every verified consultant. Never the client's own profile; consultants who switched new case alerts off are skipped.
CREATE OR REPLACE FUNCTION public.critical_alert_targets(_ticket_id uuid)
RETURNS TABLE (consultant_id uuid, user_id uuid, area_match boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _client uuid;
  _areas text[];
  _toks text[];
BEGIN
  SELECT t.client_id, COALESCE(t.sap_modules, '{}'::text[]) INTO _client, _areas FROM public.tickets t WHERE t.id = _ticket_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT COALESCE(array_agg(DISTINCT x), '{}'::text[]) INTO _toks
    FROM unnest(_areas) a, unnest(public.sap_area_tokens(a)) x;
  RETURN QUERY
  WITH elig AS (
    SELECT c.id AS cid, c.user_id AS uid, c.sap_technologies AS techs
      FROM public.consultants c
     WHERE c.verification_status = 'verified'
       AND c.user_id <> _client
       AND COALESCE(c.new_case_alerts, true)
  ), matched AS (
    SELECT e.cid, e.uid
      FROM elig e
     WHERE EXISTS (SELECT 1 FROM public.consultant_skills s
                    WHERE s.consultant_id = e.cid AND public.sap_area_tokens(s.sap_module) && _toks)
        OR EXISTS (SELECT 1 FROM unnest(COALESCE(e.techs, '{}'::text[])) tech WHERE public.sap_area_tokens(tech) && _toks)
  )
  SELECT m.cid, m.uid, true FROM matched m
  UNION ALL
  SELECT e.cid, e.uid, false FROM elig e WHERE NOT EXISTS (SELECT 1 FROM matched);
END
$function$;

-- 7. a new critical ticket: the client may choose a longer window or a higher surcharge (never below the standard terms, never above the limits),
-- the ticket is opened for bids
CREATE OR REPLACE FUNCTION public.tickets_critical_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _terms jsonb;
  _min integer;
  _pct numeric;
BEGIN
  IF NEW.critical_response IS NOT TRUE THEN
    NEW.critical_response := false;
    NEW.critical_minutes := NULL;
    NEW.critical_surcharge_percent := NULL;
    NEW.critical_committed_at := NULL;
    NEW.critical_due_at := NULL;
    NEW.critical_status := NULL;
    NEW.critical_first_reply_at := NULL;
    NEW.critical_first_reply_by := NULL;
    NEW.critical_extensions := 0;
    RETURN NEW;
  END IF;
  _terms := public.critical_service_terms();
  IF NOT (_terms ->> 'enabled')::boolean THEN
    RAISE EXCEPTION 'The critical response service is not available at the moment' USING ERRCODE = '22023';
  END IF;
  IF NEW.urgency::text <> 'critical' THEN
    RAISE EXCEPTION 'The critical response service needs the urgency Critical' USING ERRCODE = '22023';
  END IF;
  _min := GREATEST(COALESCE(NEW.critical_minutes, (_terms ->> 'minutes')::integer), (_terms ->> 'minutes')::integer);
  IF _min > (_terms ->> 'max_minutes')::integer THEN
    RAISE EXCEPTION 'The reply window can be % minutes at most', (_terms ->> 'max_minutes') USING ERRCODE = '22023';
  END IF;
  _pct := round(GREATEST(COALESCE(NEW.critical_surcharge_percent, (_terms ->> 'surcharge_percent')::numeric), (_terms ->> 'surcharge_percent')::numeric), 2);
  IF _pct > (_terms ->> 'max_surcharge_percent')::numeric THEN
    RAISE EXCEPTION 'The surcharge can be % percent at most', (_terms ->> 'max_surcharge_percent') USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('critical-ticket:' || NEW.client_id::text, 3, 3600) THEN
    RAISE EXCEPTION 'Too many critical requests in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  NEW.critical_minutes := _min;
  NEW.critical_surcharge_percent := _pct;
  NEW.critical_committed_at := now();
  NEW.critical_due_at := now() + make_interval(mins => _min);
  NEW.critical_status := 'waiting';
  NEW.critical_first_reply_at := NULL;
  NEW.critical_first_reply_by := NULL;
  NEW.critical_extensions := 0;
  NEW.open_for_bids := true;
  NEW.opened_for_bids_at := now();
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_tickets_critical_insert ON public.tickets;
CREATE TRIGGER trg_tickets_critical_insert BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.tickets_critical_before_insert();

-- the alarm: one alert row and one notice per consultant, a confirmation for the client, a notice for the administrators
CREATE OR REPLACE FUNCTION public.critical_alarm_fanout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _r record;
  _admin uuid;
  _n integer := 0;
  _areas text;
  _mins integer := NEW.critical_minutes;
  _pct text := public.ts_num(NEW.critical_surcharge_percent);
BEGIN
  _areas := COALESCE(NULLIF(array_to_string(COALESCE(NEW.sap_modules, '{}'::text[]), ', '), ''), 'SAP');
  FOR _r IN SELECT * FROM public.critical_alert_targets(NEW.id) LOOP
    INSERT INTO public.critical_alerts (ticket_id, consultant_id, user_id)
    VALUES (NEW.id, _r.consultant_id, _r.user_id)
    ON CONFLICT (ticket_id, consultant_id) DO NOTHING;
    PERFORM public.safe_insert_notification(_r.user_id,
      'CRITICAL request - reply within ' || _mins || ' minutes (+' || _pct || '%)',
      'A client needs urgent help with ' || left(_areas, 160) || '. Reply with a proposal within ' || _mins
        || ' minutes and your hourly rate gets +' || _pct || '% on this ticket.',
      'critical_request', '/consultant/open-tickets?critical=' || NEW.id::text);
    _n := _n + 1;
  END LOOP;
  PERFORM public.safe_insert_notification(NEW.client_id,
    'Critical request sent',
    CASE WHEN _n > 0
         THEN _n || CASE WHEN _n = 1 THEN ' consultant was alerted and has ' ELSE ' consultants were alerted and have ' END || _mins
              || ' minutes to reply. If a consultant replies in time, +' || _pct
              || '% is added to that consultant''s hourly rate on this ticket. If nobody replies in time, no surcharge applies.'
         ELSE 'No consultant could be alerted right now. Your request stays open for bids and no surcharge applies unless a consultant replies within ' || _mins || ' minutes.'
    END,
    'critical_request', '/client/tickets/' || NEW.id::text);
  FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.safe_insert_notification(_admin,
      'Critical ' || _mins || '-minute request',
      _n || CASE WHEN _n = 1 THEN ' consultant was alerted for "' ELSE ' consultants were alerted for "' END
        || left(COALESCE(NEW.title, 'a ticket'), 80) || '" (' || left(_areas, 80) || ').',
      'critical_request', '/admin/tickets/' || NEW.id::text);
  END LOOP;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_tickets_critical_alarm ON public.tickets;
CREATE TRIGGER trg_tickets_critical_alarm AFTER INSERT ON public.tickets
  FOR EACH ROW WHEN (NEW.critical_response) EXECUTE FUNCTION public.critical_alarm_fanout();

-- 8. replies: a proposal or an accepted match request is a reply; the first reply of every consultant counts
CREATE OR REPLACE FUNCTION public.critical_record_reply(_ticket uuid, _consultant uuid, _kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _t public.tickets;
  _in_time boolean;
  _mins integer;
BEGIN
  SELECT * INTO _t FROM public.tickets WHERE id = _ticket AND critical_response FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO public.critical_replies (ticket_id, consultant_id, kind)
  VALUES (_ticket, _consultant, _kind)
  ON CONFLICT (ticket_id, consultant_id) DO NOTHING;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  _in_time := now() <= _t.critical_due_at;
  UPDATE public.tickets
     SET critical_first_reply_at = COALESCE(critical_first_reply_at, now()),
         critical_first_reply_by = COALESCE(critical_first_reply_by, _consultant),
         critical_status = CASE WHEN _in_time AND critical_status = 'waiting' THEN 'answered' ELSE critical_status END
   WHERE id = _ticket;
  IF _in_time AND _t.critical_status = 'waiting' THEN
    _mins := GREATEST(0, floor(extract(epoch FROM (now() - _t.critical_committed_at)) / 60))::integer;
    PERFORM public.safe_insert_notification(_t.client_id,
      'A consultant replied to your critical request',
      'The first reply came ' || CASE WHEN _mins < 1 THEN 'within the first minute' ELSE 'after ' || _mins || ' minutes' END
        || '. If you accept that consultant''s proposal, +'
        || public.ts_num(_t.critical_surcharge_percent) || '% is added to their hourly rate on this ticket.',
      'critical_request', '/client/tickets/' || _ticket::text);
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.critical_proposal_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  PERFORM public.critical_record_reply(NEW.ticket_id, NEW.consultant_id, 'proposal');
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_critical_proposal_reply ON public.proposals;
CREATE TRIGGER trg_critical_proposal_reply AFTER INSERT ON public.proposals
  FOR EACH ROW EXECUTE FUNCTION public.critical_proposal_reply();

CREATE OR REPLACE FUNCTION public.critical_match_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NEW.status::text = 'accepted' AND OLD.status::text = 'pending' THEN
    PERFORM public.critical_record_reply(NEW.ticket_id, NEW.consultant_id, 'match_accepted');
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_critical_match_reply ON public.ticket_match_requests;
CREATE TRIGGER trg_critical_match_reply AFTER UPDATE OF status ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.critical_match_reply();

-- the surcharge a consultant earns on this ticket: the current percentage of the ticket when the consultant replied in time, else 0
CREATE OR REPLACE FUNCTION public.critical_surcharge_for(_ticket uuid, _consultant uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $function$
  SELECT COALESCE((
    SELECT t.critical_surcharge_percent
      FROM public.tickets t
      JOIN public.critical_replies r ON r.ticket_id = t.id AND r.consultant_id = _consultant
     WHERE t.id = _ticket AND t.critical_response AND r.replied_at <= t.critical_due_at
  ), 0)
$function$;

-- 9. the surcharge is part of the approved hourly rate (timesheets and invoices keep reading ticket_rates.hourly_rate)
CREATE OR REPLACE FUNCTION public.approve_rate_from_proposal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _t record;
  _cur text;
  _locked text;
  _cons_user uuid;
  _rate numeric;
  _base numeric;
  _pct numeric;
BEGIN
  IF NEW.status::text <> 'accepted' OR (TG_OP = 'UPDATE' AND OLD.status::text = 'accepted') THEN
    RETURN NEW;
  END IF;
  _base := round(NEW.proposed_rate, 2);
  IF _base IS NULL OR _base <= 0 OR _base > 100000 THEN
    RETURN NEW;
  END IF;
  _pct := public.critical_surcharge_for(NEW.ticket_id, NEW.consultant_id);
  _rate := CASE WHEN _pct > 0 THEN round(_base * (1 + _pct / 100), 2) ELSE _base END;
  IF _rate > 100000 THEN
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
  INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status, source, proposed_by, decided_by, decided_at, decision_note, base_rate, surcharge_percent)
  VALUES (NEW.ticket_id, NEW.consultant_id, _rate, _cur, 'approved', 'proposal', _cons_user, COALESCE(auth.uid(), _t.client_id), now(),
          'Accepted proposal (version ' || COALESCE(NEW.version, 1) || ')'
            || CASE WHEN _pct > 0 THEN ' with +' || public.ts_num(_pct) || '% critical-response surcharge on ' || public.ts_num(_base) ELSE '' END,
          CASE WHEN _pct > 0 THEN _base END, CASE WHEN _pct > 0 THEN _pct END);
  UPDATE public.ticket_work_logs SET hourly_rate = _rate
   WHERE ticket_id = NEW.ticket_id AND consultant_id = NEW.consultant_id AND hourly_rate IS NULL AND submission_id IS NULL;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.propose_ticket_rate(_ticket_id uuid, _hourly_rate numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _t record;
  _cons uuid;
  _base numeric := round(_hourly_rate, 2);
  _rate numeric;
  _pct numeric;
  _cur text;
  _locked text;
  _appr record;
  _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _base IS NULL OR _base <= 0 OR _base > 100000 THEN
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
  -- a consultant who replied to a critical request in time earns the surcharge on top of the number they propose
  _pct := public.critical_surcharge_for(_ticket_id, _cons);
  _rate := CASE WHEN _pct > 0 THEN round(_base * (1 + _pct / 100), 2) ELSE _base END;
  IF _rate > 100000 THEN
    RAISE EXCEPTION 'Enter a valid hourly rate' USING ERRCODE = '22023';
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
  INSERT INTO public.ticket_rates (ticket_id, consultant_id, hourly_rate, currency, status, source, proposed_by, base_rate, surcharge_percent)
  VALUES (_ticket_id, _cons, _rate, _cur, 'proposed', 'consultant', auth.uid(), CASE WHEN _pct > 0 THEN _base END, CASE WHEN _pct > 0 THEN _pct END)
  RETURNING id INTO _id;
  PERFORM public.safe_insert_notification(_t.client_id, 'Hourly rate awaiting your approval',
    'The consultant proposed ' || public.ts_num(_rate) || ' ' || _cur || ' per hour'
      || CASE WHEN _pct > 0 THEN ' (' || public.ts_num(_base) || ' + ' || public.ts_num(_pct) || '% critical-response surcharge)' ELSE '' END
      || ' for "' || left(COALESCE(_t.title, 'your ticket'), 80)
      || '". Approve it so that the timesheet can be billed.',
    'ticket', '/client/tickets/' || _ticket_id::text);
  RETURN _id;
END
$function$;

-- 10. the critical fields of a ticket cannot be edited by the client (same guard as the SLA fields)
CREATE OR REPLACE FUNCTION public.guard_ticket_protected_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $function$
BEGIN
  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF ROW(NEW.client_id, NEW.tenant_id, NEW.sla_policy_id, NEW.sla_response_deadline, NEW.first_response_at, NEW.sla_breached,
         NEW.critical_response, NEW.critical_minutes, NEW.critical_surcharge_percent, NEW.critical_committed_at,
         NEW.critical_due_at, NEW.critical_status, NEW.critical_first_reply_at, NEW.critical_first_reply_by, NEW.critical_extensions)
     IS DISTINCT FROM
     ROW(OLD.client_id, OLD.tenant_id, OLD.sla_policy_id, OLD.sla_response_deadline, OLD.first_response_at, OLD.sla_breached,
         OLD.critical_response, OLD.critical_minutes, OLD.critical_surcharge_percent, OLD.critical_committed_at,
         OLD.critical_due_at, OLD.critical_status, OLD.critical_first_reply_at, OLD.critical_first_reply_by, OLD.critical_extensions) THEN
    RAISE EXCEPTION 'Ticket ownership, tenant and SLA tracking fields cannot be edited' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

-- 11. the client extends the window and/or raises the surcharge while nobody is assigned
CREATE OR REPLACE FUNCTION public.critical_extend(_ticket_id uuid, _extra_minutes integer, _new_percent numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _terms jsonb;
  _t public.tickets;
  _extra integer := COALESCE(_extra_minutes, 0);
  _pct numeric;
  _pcts text;
  _raised boolean;
  _longer boolean;
  _new_due timestamptz;
  _answered boolean;
  _left integer;
  _r record;
  _admin uuid;
  _n integer := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO _t FROM public.tickets WHERE id = _ticket_id AND critical_response FOR UPDATE;
  IF NOT FOUND OR NOT (_t.client_id = _uid OR COALESCE(public.has_role(_uid, 'admin'::app_role), false)) THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501';
  END IF;
  _terms := public.critical_service_terms();
  IF NOT (_terms ->> 'enabled')::boolean THEN
    RAISE EXCEPTION 'The critical response service is not available at the moment' USING ERRCODE = '22023';
  END IF;
  IF _t.consultant_id IS NOT NULL OR _t.status::text IN ('resolved', 'closed') THEN
    RAISE EXCEPTION 'A consultant is already working on this ticket, so it can not be extended' USING ERRCODE = '22023';
  END IF;
  IF _extra < 0 OR _extra > (_terms ->> 'max_minutes')::integer THEN
    RAISE EXCEPTION 'You can add between 0 and % minutes at a time', (_terms ->> 'max_minutes') USING ERRCODE = '22023';
  END IF;
  _pct := round(COALESCE(_new_percent, _t.critical_surcharge_percent), 2);
  IF _pct < _t.critical_surcharge_percent THEN
    RAISE EXCEPTION 'The surcharge can only be raised' USING ERRCODE = '22023';
  END IF;
  IF _pct > (_terms ->> 'max_surcharge_percent')::numeric THEN
    RAISE EXCEPTION 'The surcharge can be % percent at most', (_terms ->> 'max_surcharge_percent') USING ERRCODE = '22023';
  END IF;
  _raised := _pct > _t.critical_surcharge_percent;
  _longer := _extra > 0;
  IF NOT _raised AND NOT _longer THEN
    RAISE EXCEPTION 'Add minutes or raise the surcharge' USING ERRCODE = '22023';
  END IF;
  IF _t.critical_due_at <= now() AND NOT _longer THEN
    RAISE EXCEPTION 'The reply window has passed: add minutes as well' USING ERRCODE = '22023';
  END IF;
  IF _t.critical_extensions >= 5 THEN
    RAISE EXCEPTION 'This request was already extended 5 times' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('critical-extend:' || _uid::text, 20, 3600) THEN
    RAISE EXCEPTION 'Too many changes in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  _new_due := CASE WHEN _longer THEN GREATEST(now(), _t.critical_due_at) + make_interval(mins => _extra) ELSE _t.critical_due_at END;
  -- a reply that falls inside the new window counts, so a late reply can qualify after the extension
  _answered := EXISTS (SELECT 1 FROM public.critical_replies r WHERE r.ticket_id = _t.id AND r.replied_at <= _new_due);
  UPDATE public.tickets
     SET critical_due_at = _new_due,
         critical_surcharge_percent = _pct,
         critical_extensions = critical_extensions + 1,
         critical_status = CASE WHEN _answered THEN 'answered' ELSE 'waiting' END
   WHERE id = _t.id;
  INSERT INTO public.critical_events (ticket_id, kind, by_user, old_due_at, new_due_at, old_percent, new_percent)
  VALUES (_t.id, CASE WHEN _raised AND _longer THEN 'extended_and_boosted' WHEN _raised THEN 'boosted' ELSE 'extended' END,
          _uid, _t.critical_due_at, _new_due, _t.critical_surcharge_percent, _pct);
  _left := GREATEST(1, ceil(extract(epoch FROM (_new_due - now())) / 60))::integer;
  _pcts := public.ts_num(_pct);
  -- consultants who cover the areas and were never alerted are alerted now
  FOR _r IN SELECT x.consultant_id AS cid, x.user_id AS uid FROM public.critical_alert_targets(_t.id) x LOOP
    INSERT INTO public.critical_alerts (ticket_id, consultant_id, user_id)
    VALUES (_t.id, _r.cid, _r.uid)
    ON CONFLICT (ticket_id, consultant_id) DO NOTHING;
  END LOOP;
  -- everybody who did not reply is alarmed again; the ones who dismissed the alert only when the surcharge went up
  FOR _r IN
    SELECT a.id, a.user_id
      FROM public.critical_alerts a
     WHERE a.ticket_id = _t.id
       AND NOT EXISTS (SELECT 1 FROM public.critical_replies p WHERE p.ticket_id = a.ticket_id AND p.consultant_id = a.consultant_id)
       AND (a.dismissed_at IS NULL OR _raised)
  LOOP
    UPDATE public.critical_alerts SET last_alerted_at = now(), alert_count = alert_count + 1, dismissed_at = NULL WHERE id = _r.id;
    PERFORM public.safe_insert_notification(_r.user_id,
      'UPDATED critical request - reply within ' || _left || ' minutes (+' || _pcts || '%)',
      'The client changed the terms. Reply with a proposal within ' || _left || ' minutes and your hourly rate gets +' || _pcts || '% on this ticket.',
      'critical_request', '/consultant/open-tickets?critical=' || _t.id::text);
    _n := _n + 1;
  END LOOP;
  IF _raised THEN
    FOR _r IN SELECT c.user_id AS uid FROM public.critical_replies p JOIN public.consultants c ON c.id = p.consultant_id WHERE p.ticket_id = _t.id LOOP
      PERFORM public.safe_insert_notification(_r.uid,
        'The surcharge was raised to +' || _pcts || '%',
        'The client raised the critical-response surcharge on a ticket you replied to. If your proposal is accepted, your hourly rate gets +' || _pcts || '%.',
        'critical_request', '/consultant/proposals');
    END LOOP;
  END IF;
  PERFORM public.safe_insert_notification(_t.client_id,
    'Critical request updated',
    'The reply window now ends in ' || _left || ' minutes and the surcharge is +' || _pcts || '%. '
      || _n || CASE WHEN _n = 1 THEN ' consultant was alerted again.' ELSE ' consultants were alerted again.' END,
    'critical_request', '/client/tickets/' || _t.id::text);
  FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
    PERFORM public.safe_insert_notification(_admin,
      'Critical request extended',
      'The client changed "' || left(COALESCE(_t.title, 'a ticket'), 80) || '": reply window ends in ' || _left || ' minutes, surcharge +' || _pcts || '%.',
      'critical_request', '/admin/tickets/' || _t.id::text);
  END LOOP;
  RETURN public.critical_ticket_view(_t.id);
END
$function$;

-- 12. screens: the state of a critical ticket, the alerts of a consultant, dismissing an alert
CREATE OR REPLACE FUNCTION public.critical_ticket_view(_ticket_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _t public.tickets;
  _my uuid;
  _ok boolean;
  _terms jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO _t FROM public.tickets WHERE id = _ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501';
  END IF;
  SELECT c.id INTO _my FROM public.consultants c WHERE c.user_id = _uid AND c.verification_status = 'verified';
  _ok := _t.client_id = _uid
      OR COALESCE(public.ticket_in_my_company(_ticket_id), false)
      OR COALESCE(public.has_role(_uid, 'admin'::app_role), false)
      OR (_my IS NOT NULL AND (_t.consultant_id = _my OR _t.open_for_bids
          OR EXISTS (SELECT 1 FROM public.critical_alerts a WHERE a.ticket_id = _ticket_id AND a.consultant_id = _my)
          OR EXISTS (SELECT 1 FROM public.critical_replies r WHERE r.ticket_id = _ticket_id AND r.consultant_id = _my)));
  IF NOT _ok THEN
    RAISE EXCEPTION 'Ticket not found' USING ERRCODE = '42501';
  END IF;
  IF NOT _t.critical_response THEN
    RETURN jsonb_build_object('critical_response', false);
  END IF;
  _terms := public.critical_service_terms();
  RETURN jsonb_build_object(
    'critical_response', true,
    'status', _t.critical_status,
    'due_at', _t.critical_due_at,
    'committed_at', _t.critical_committed_at,
    'minutes', _t.critical_minutes,
    'surcharge_percent', _t.critical_surcharge_percent,
    'first_reply_at', _t.critical_first_reply_at,
    'extensions', _t.critical_extensions,
    'max_minutes', _terms -> 'max_minutes',
    'max_surcharge_percent', _terms -> 'max_surcharge_percent',
    'can_extend', (_t.consultant_id IS NULL AND _t.status::text NOT IN ('resolved', 'closed') AND _t.critical_extensions < 5
                   AND (_t.client_id = _uid OR COALESCE(public.has_role(_uid, 'admin'::app_role), false))
                   AND (_terms ->> 'enabled')::boolean),
    'alerted_count', (SELECT count(*) FROM public.critical_alerts a WHERE a.ticket_id = _ticket_id),
    'reply_count', (SELECT count(*) FROM public.critical_replies r WHERE r.ticket_id = _ticket_id),
    'in_time_consultants', COALESCE((SELECT jsonb_agg(r.consultant_id) FROM public.critical_replies r
                                      WHERE r.ticket_id = _ticket_id AND r.replied_at <= _t.critical_due_at), '[]'::jsonb),
    'my_reply_at', (SELECT r.replied_at FROM public.critical_replies r WHERE r.ticket_id = _ticket_id AND r.consultant_id = _my),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'at', e.created_at, 'old_due_at', e.old_due_at,
                                                          'new_due_at', e.new_due_at, 'old_percent', e.old_percent, 'new_percent', e.new_percent)
                                         ORDER BY e.created_at)
                          FROM public.critical_events e WHERE e.ticket_id = _ticket_id), '[]'::jsonb)
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.critical_my_alerts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _res jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ticket_id', t.id,
           'title', left(COALESCE(t.title, ''), 160),
           'areas', COALESCE(t.sap_modules, '{}'::text[]),
           'due_at', t.critical_due_at,
           'minutes', t.critical_minutes,
           'surcharge_percent', t.critical_surcharge_percent,
           'status', t.critical_status,
           'extensions', t.critical_extensions,
           'alerted_at', a.alerted_at,
           'last_alerted_at', a.last_alerted_at,
           'dismissed_at', a.dismissed_at,
           'replied_at', r.replied_at
         ) ORDER BY t.critical_due_at DESC), '[]'::jsonb)
    INTO _res
    FROM public.critical_alerts a
    JOIN public.tickets t ON t.id = a.ticket_id AND t.critical_response
    LEFT JOIN public.critical_replies r ON r.ticket_id = a.ticket_id AND r.consultant_id = a.consultant_id
   WHERE a.user_id = _uid AND a.alerted_at > now() - interval '24 hours';
  RETURN _res;
END
$function$;

CREATE OR REPLACE FUNCTION public.critical_dismiss_alert(_ticket_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  UPDATE public.critical_alerts SET dismissed_at = now()
   WHERE ticket_id = _ticket_id AND user_id = auth.uid() AND dismissed_at IS NULL;
END
$function$;

-- 13. every minute: windows that passed without a reply in time, and reminders every 10 minutes
CREATE OR REPLACE FUNCTION public.critical_service_tick()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _t record;
  _a record;
  _admin uuid;
  _n integer := 0;
  _left integer;
BEGIN
  FOR _t IN
    SELECT t.id, t.client_id, t.title, t.status, t.critical_minutes, t.critical_surcharge_percent, t.critical_extensions
      FROM public.tickets t
     WHERE t.critical_response AND t.critical_status = 'waiting' AND t.critical_due_at < now()
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.tickets SET critical_status = 'missed' WHERE id = _t.id;
    _n := _n + 1;
    IF _t.status::text NOT IN ('resolved', 'closed') THEN
      PERFORM public.safe_insert_notification(_t.client_id,
        'No consultant replied in time',
        'Nobody replied to your critical request "' || left(COALESCE(_t.title, 'your ticket'), 80) || '" within the reply window, so no +'
          || public.ts_num(_t.critical_surcharge_percent) || '% surcharge applies. The request stays open and consultants can still reply at their normal rate. You can extend the time or raise the surcharge on the ticket page.',
        'critical_request', '/client/tickets/' || _t.id::text);
      FOR _admin IN SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = 'admin' LOOP
        PERFORM public.safe_insert_notification(_admin,
          'Critical request without a reply',
          'Nobody replied within the reply window to "' || left(COALESCE(_t.title, 'a ticket'), 80) || '". You may want to contact a consultant yourself.',
          'critical_request', '/admin/tickets/' || _t.id::text);
      END LOOP;
    END IF;
  END LOOP;

  FOR _a IN
    SELECT a.id, a.user_id, a.ticket_id, t.critical_due_at
      FROM public.critical_alerts a
      JOIN public.tickets t ON t.id = a.ticket_id
     WHERE t.critical_response AND t.critical_status = 'waiting' AND t.critical_due_at > now()
       AND a.dismissed_at IS NULL
       AND a.last_alerted_at <= now() - interval '10 minutes'
       AND NOT EXISTS (SELECT 1 FROM public.critical_replies r WHERE r.ticket_id = a.ticket_id AND r.consultant_id = a.consultant_id)
     FOR UPDATE OF a SKIP LOCKED
  LOOP
    UPDATE public.critical_alerts SET last_alerted_at = now(), alert_count = alert_count + 1 WHERE id = _a.id;
    _left := GREATEST(1, ceil(extract(epoch FROM (_a.critical_due_at - now())) / 60))::integer;
    PERFORM public.safe_insert_notification(_a.user_id,
      'REMINDER - critical request, ' || _left || ' minutes left',
      'Reply with a proposal within ' || _left || ' minutes to earn the critical-response surcharge on this ticket.',
      'critical_request', '/consultant/open-tickets?critical=' || _a.ticket_id::text);
  END LOOP;
  RETURN _n;
END
$function$;

-- 14. who may call what
REVOKE ALL ON FUNCTION public.sap_area_tokens(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.critical_alert_targets(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tickets_critical_before_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.critical_alarm_fanout() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.critical_record_reply(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.critical_proposal_reply() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.critical_match_reply() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.critical_surcharge_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.critical_service_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.critical_service_terms() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_critical_service(boolean, integer, numeric, integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.critical_extend(uuid, integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.critical_ticket_view(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.critical_my_alerts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.critical_dismiss_alert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.critical_service_terms() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_critical_service(boolean, integer, numeric, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.critical_extend(uuid, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.critical_ticket_view(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.critical_my_alerts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.critical_dismiss_alert(uuid) TO authenticated;

-- 15. the minute-by-minute check
DO $cron$
BEGIN
  PERFORM cron.unschedule('critical_service_tick');
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$cron$;
SELECT cron.schedule('critical_service_tick', '* * * * *', 'SELECT public.critical_service_tick()');