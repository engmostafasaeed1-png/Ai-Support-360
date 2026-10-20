-- Feature M: consultant responsiveness statistics (fair metrics, warnings, card level, blended rating, ranking, disputes).
-- NOT APPLIED by the agent: review and apply yourself, AFTER docs/sql/assignment-response.sql (Feature L).
--
-- What it counts (all computed here, never in the browser):
--   request  assignment requests / invitations (ticket_match_requests, Feature L deadline)        -> main split
--   bid      private bid invitations (same table, response_kind 'bid')                            -> main split
--   critical critical alarms (critical_alerts; answered by a proposal or by dismissing the alarm)  -> Critical split
--            (Critical direct requests are in both the main and the Critical split)
--   chat     client chat messages on active tickets (answered by the consultant's next message)    -> chat split
-- Warnings, the "No response" count and the visible badge use the main split only (personally addressed requests);
-- broadcast alarms and chat only feed their own statistics.
--
-- Fairness: every event is checked when it ARRIVES. Outside the consultant's declared availability (weekly / one-date
-- slots in their time zone, or the working week 08:00-20:00 when no slots exist), during a period marked unavailable,
-- while marked busy, or at the stated capacity, it is "not counted" (neither numerator nor denominator).
-- Nothing public before 5 counted requests in 90 days; nothing at all on cards until `responsiveness_public` is on.
-- Idempotent: safe to run twice.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'ticket_match_requests' AND column_name = 'response_due_at') THEN
    RAISE EXCEPTION 'Apply docs/sql/assignment-response.sql (Feature L) first';
  END IF;
END $$;

-- 1. Consultant inputs: stated capacity and periods marked unavailable in advance (vacation / pause).
ALTER TABLE public.consultants ADD COLUMN IF NOT EXISTS max_active_tickets INT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consultants_max_active_tickets_check') THEN
    ALTER TABLE public.consultants
      ADD CONSTRAINT consultants_max_active_tickets_check CHECK (max_active_tickets IS NULL OR max_active_tickets BETWEEN 1 AND 50);
  END IF;
END $$;
COMMENT ON COLUMN public.consultants.max_active_tickets IS 'Stated capacity (active tickets); requests at capacity are not counted in responsiveness. Set through consultant_set_capacity.';

CREATE TABLE IF NOT EXISTS public.consultant_unavailable_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consultant_unavailable_periods_idx ON public.consultant_unavailable_periods (consultant_id, starts_at, ends_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultant_unavailable_periods TO authenticated;
GRANT ALL ON public.consultant_unavailable_periods TO service_role;
ALTER TABLE public.consultant_unavailable_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Consultants manage own unavailable periods" ON public.consultant_unavailable_periods;
CREATE POLICY "Consultants manage own unavailable periods" ON public.consultant_unavailable_periods
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "Admins read unavailable periods" ON public.consultant_unavailable_periods;
CREATE POLICY "Admins read unavailable periods" ON public.consultant_unavailable_periods
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Periods are declared in advance: no back-dated start, a started period can only be shortened or extended forward.
CREATE OR REPLACE FUNCTION public.guard_unavailable_period()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ends_at <= NEW.starts_at THEN RAISE EXCEPTION 'The end must be after the start'; END IF;
  IF NEW.ends_at - NEW.starts_at > interval '180 days' THEN RAISE EXCEPTION 'A period can last at most 180 days'; END IF;
  NEW.reason := NULLIF(left(btrim(COALESCE(NEW.reason, '')), 120), '');
  IF TG_OP = 'INSERT' THEN
    IF NEW.starts_at < now() - interval '5 minutes' THEN RAISE EXCEPTION 'Periods must be marked in advance'; END IF;
  ELSE
    IF NEW.consultant_id <> OLD.consultant_id THEN RAISE EXCEPTION 'not allowed'; END IF;
    IF OLD.starts_at <= now() AND NEW.starts_at <> OLD.starts_at THEN RAISE EXCEPTION 'A started period keeps its start'; END IF;
    IF OLD.starts_at > now() AND NEW.starts_at < now() - interval '5 minutes' THEN RAISE EXCEPTION 'Periods must be marked in advance'; END IF;
    IF OLD.starts_at <= now() AND NEW.ends_at < now() - interval '5 minutes' THEN RAISE EXCEPTION 'The end cannot move into the past'; END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_unavailable_period ON public.consultant_unavailable_periods;
CREATE TRIGGER trg_guard_unavailable_period
  BEFORE INSERT OR UPDATE ON public.consultant_unavailable_periods
  FOR EACH ROW EXECUTE FUNCTION public.guard_unavailable_period();

-- 2. Events, notices, disputes, cached statistics, runs.
CREATE TABLE IF NOT EXISTS public.responsiveness_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('request', 'bid', 'critical', 'chat')),
  source_id UUID NOT NULL,
  ticket_id UUID,
  session_id UUID,
  received_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ,
  is_critical BOOLEAN NOT NULL DEFAULT false,
  responded_at TIMESTAMPTZ,
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'responded', 'no_response', 'withdrawn', 'voided')),
  resolved_at TIMESTAMPTZ,
  counted BOOLEAN NOT NULL,
  excluded_reason TEXT CHECK (excluded_reason IN ('outside_hours', 'unavailable_period', 'busy', 'capacity')),
  voided_at TIMESTAMPTZ,
  voided_by UUID,
  void_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, source_id)
);
CREATE INDEX IF NOT EXISTS responsiveness_events_consultant_idx ON public.responsiveness_events (consultant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS responsiveness_events_pending_idx ON public.responsiveness_events (due_at) WHERE outcome = 'pending';
CREATE INDEX IF NOT EXISTS responsiveness_events_session_idx ON public.responsiveness_events (session_id) WHERE kind = 'chat' AND outcome = 'pending';

CREATE TABLE IF NOT EXISTS public.responsiveness_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_id UUID NOT NULL REFERENCES public.responsiveness_events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('counted', 'not_counted', 'warning_1', 'warning_2', 'warning_3', 'warning_4', 'warning_5',
                                     'badge_visible', 'dispute_upheld', 'dispute_rejected')),
  count_30d INT NOT NULL DEFAULT 0,
  warnings_total INT NOT NULL DEFAULT 2,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  emailed_at TIMESTAMPTZ,
  email_error TEXT,
  acked_at TIMESTAMPTZ,
  UNIQUE (event_id, kind)
);
CREATE INDEX IF NOT EXISTS responsiveness_notices_user_idx ON public.responsiveness_notices (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS responsiveness_notices_mail_idx ON public.responsiveness_notices (created_at) WHERE emailed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.responsiveness_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE REFERENCES public.responsiveness_events(id) ON DELETE CASCADE,
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'upheld', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  admin_note TEXT
);
CREATE INDEX IF NOT EXISTS responsiveness_disputes_status_idx ON public.responsiveness_disputes (status, created_at);

CREATE TABLE IF NOT EXISTS public.consultant_responsiveness (
  consultant_id UUID PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  level TEXT NOT NULL DEFAULT 'new',
  public_level TEXT NOT NULL DEFAULT 'new',
  counted_90d INT NOT NULL DEFAULT 0,
  rate_90d INT,
  median_90d INT,
  no_response_30d INT NOT NULL DEFAULT 0,
  warnings_sent INT NOT NULL DEFAULT 0,
  stars NUMERIC,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.responsiveness_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL DEFAULT 'sweep' CHECK (kind IN ('sweep', 'nightly')),
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS responsiveness_runs_idx ON public.responsiveness_runs (kind, ran_at DESC);

-- Consultants read their own rows; admins read everything; nobody writes directly (functions below do).
GRANT SELECT ON public.responsiveness_events, public.responsiveness_notices, public.responsiveness_disputes,
                public.consultant_responsiveness TO authenticated;
GRANT ALL ON public.responsiveness_events, public.responsiveness_notices, public.responsiveness_disputes,
             public.consultant_responsiveness, public.responsiveness_runs TO service_role;
ALTER TABLE public.responsiveness_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsiveness_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsiveness_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_responsiveness ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.responsiveness_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own or admin read" ON public.responsiveness_events;
CREATE POLICY "Own or admin read" ON public.responsiveness_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Own or admin read" ON public.responsiveness_notices;
CREATE POLICY "Own or admin read" ON public.responsiveness_notices FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Own or admin read" ON public.responsiveness_disputes;
CREATE POLICY "Own or admin read" ON public.responsiveness_disputes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Own or admin read" ON public.consultant_responsiveness;
CREATE POLICY "Own or admin read" ON public.consultant_responsiveness FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- 3. Settings (admin-editable; same rules as readRespSettings in supabase/functions/_shared/responsiveness.ts).
INSERT INTO public.platform_settings (key, value)
VALUES ('responsiveness_public', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.platform_settings (key, value)
VALUES ('responsiveness_settings', jsonb_build_object(
  'min_sample', 5, 'rate_threshold', 60, 'warnings', 2, 'review_weight', 15,
  'excellent_median', 60, 'excellent_rate', 90, 'good_median', 240, 'good_rate', 80, 'fair_median', 1440,
  'chat_window', 1440, 'dispute_days', 7, 'default_start', '08:00', 'default_end', '20:00'))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.responsiveness_int(_v JSONB, _k TEXT, _def INT, _lo INT, _hi INT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN (_v ->> _k) ~ '^\d{1,6}$' AND (_v ->> _k)::INT BETWEEN _lo AND _hi THEN (_v ->> _k)::INT ELSE _def END
$$;

CREATE OR REPLACE FUNCTION public.responsiveness_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB;
  o JSONB;
  st TEXT;
  en TEXT;
BEGIN
  SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value ELSE '{}'::jsonb END INTO v
    FROM public.platform_settings WHERE key = 'responsiveness_settings';
  v := COALESCE(v, '{}'::jsonb);
  o := jsonb_build_object(
    'min_sample', public.responsiveness_int(v, 'min_sample', 5, 1, 100),
    'rate_threshold', public.responsiveness_int(v, 'rate_threshold', 60, 0, 100),
    'warnings', public.responsiveness_int(v, 'warnings', 2, 1, 5),
    'review_weight', public.responsiveness_int(v, 'review_weight', 15, 0, 50),
    'excellent_median', public.responsiveness_int(v, 'excellent_median', 60, 1, 10080),
    'excellent_rate', public.responsiveness_int(v, 'excellent_rate', 90, 0, 100),
    'good_median', public.responsiveness_int(v, 'good_median', 240, 1, 10080),
    'good_rate', public.responsiveness_int(v, 'good_rate', 80, 0, 100),
    'fair_median', public.responsiveness_int(v, 'fair_median', 1440, 1, 10080),
    'chat_window', public.responsiveness_int(v, 'chat_window', 1440, 60, 10080),
    'dispute_days', public.responsiveness_int(v, 'dispute_days', 7, 1, 30));
  IF NOT ((o->>'excellent_median')::INT < (o->>'good_median')::INT AND (o->>'good_median')::INT < (o->>'fair_median')::INT) THEN
    o := o || '{"excellent_median": 60, "good_median": 240, "fair_median": 1440}'::jsonb;
  END IF;
  IF NOT ((o->>'excellent_rate')::INT >= (o->>'good_rate')::INT AND (o->>'good_rate')::INT >= (o->>'rate_threshold')::INT) THEN
    o := o || '{"excellent_rate": 90, "good_rate": 80, "rate_threshold": 60}'::jsonb;
  END IF;
  st := CASE WHEN (v->>'default_start') ~ '^([01]\d|2[0-3]):[0-5]\d$' THEN v->>'default_start' ELSE '08:00' END;
  en := CASE WHEN (v->>'default_end') ~ '^([01]\d|2[0-3]):[0-5]\d$' THEN v->>'default_end' ELSE '20:00' END;
  IF st >= en THEN st := '08:00'; en := '20:00'; END IF;
  RETURN o || jsonb_build_object('default_start', st, 'default_end', en);
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responsiveness_settings() TO authenticated, service_role;

-- Public part of the settings (the blended rating needs the weight and the switch).
CREATE OR REPLACE FUNCTION public.responsiveness_public_config()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'public', public.platform_flag('responsiveness_public', false),
    'review_weight', (public.responsiveness_settings() ->> 'review_weight')::INT,
    'min_sample', (public.responsiveness_settings() ->> 'min_sample')::INT)
$$;
REVOKE ALL ON FUNCTION public.responsiveness_public_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responsiveness_public_config() TO authenticated, service_role;

-- 4. Fairness check at arrival (mirror of availabilityExclusion). NULL = available, so the event counts.
CREATE OR REPLACE FUNCTION public.responsiveness_exclusion(_cid UUID, _at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  s JSONB := public.responsiveness_settings();
  tz TEXT;
  loc TIMESTAMP;
  dow INT;
  d DATE;
  tm TIME;
  n_active INT;
  days INT[];
BEGIN
  SELECT id, timezone, availability_status::TEXT AS st, working_week, max_active_tickets INTO c
    FROM public.consultants WHERE id = _cid;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM public.consultant_unavailable_periods p
              WHERE p.consultant_id = _cid AND _at >= p.starts_at AND _at < p.ends_at) THEN
    RETURN 'unavailable_period';
  END IF;
  -- The status only reflects the moment of arrival when checked live (triggers run at arrival).
  IF c.st = 'busy' AND _at > now() - interval '10 minutes' THEN
    RETURN 'busy';
  END IF;
  IF c.max_active_tickets IS NOT NULL AND _at > now() - interval '10 minutes' THEN
    SELECT count(DISTINCT a.ticket_id) INTO n_active
      FROM public.ticket_assignments a WHERE a.consultant_id = _cid AND a.status = 'active';
    IF n_active >= c.max_active_tickets THEN RETURN 'capacity'; END IF;
  END IF;

  tz := COALESCE(NULLIF(c.timezone, ''), 'Asia/Riyadh');
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz) THEN tz := 'Asia/Riyadh'; END IF;
  loc := _at AT TIME ZONE tz;
  dow := EXTRACT(DOW FROM loc)::INT;
  d := loc::DATE;
  tm := loc::TIME;

  IF EXISTS (SELECT 1 FROM public.availability_slots sl
              WHERE sl.consultant_id = _cid AND (sl.specific_date IS NULL OR abs(sl.specific_date - d) <= 30)) THEN
    IF EXISTS (SELECT 1 FROM public.availability_slots sl
                WHERE sl.consultant_id = _cid
                  AND ((sl.specific_date IS NULL AND sl.day_of_week = dow) OR sl.specific_date = d)
                  AND tm >= sl.start_time AND (sl.end_time <= sl.start_time OR tm < sl.end_time)) THEN
      RETURN NULL;
    END IF;
    RETURN 'outside_hours';
  END IF;

  days := CASE c.working_week
            WHEN 'Monday to Friday' THEN ARRAY[1, 2, 3, 4, 5]
            WHEN 'Flexible (both)' THEN ARRAY[0, 1, 2, 3, 4, 5]
            ELSE ARRAY[0, 1, 2, 3, 4] END;
  IF dow = ANY (days) AND tm >= (s->>'default_start')::TIME AND tm < (s->>'default_end')::TIME THEN
    RETURN NULL;
  END IF;
  RETURN 'outside_hours';
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_exclusion(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_exclusion(UUID, TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.responsiveness_add_event(
  _cid UUID, _kind TEXT, _source UUID, _ticket UUID, _session UUID, _received TIMESTAMPTZ, _due TIMESTAMPTZ, _critical BOOLEAN)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ex TEXT := public.responsiveness_exclusion(_cid, _received);
  v_id UUID;
BEGIN
  INSERT INTO public.responsiveness_events
    (consultant_id, kind, source_id, ticket_id, session_id, received_at, due_at, is_critical, counted, excluded_reason)
  VALUES (_cid, _kind, _source, _ticket, _session, _received, _due, COALESCE(_critical, false), v_ex IS NULL, v_ex)
  ON CONFLICT (kind, source_id) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_add_event(UUID, TEXT, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_add_event(UUID, TEXT, UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, BOOLEAN) TO service_role;

-- 5. Metrics (mirror of computeMetrics), level, public level and stars.
CREATE OR REPLACE FUNCTION public.responsiveness_metrics(_cid UUID, _since TIMESTAMPTZ, _scope TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH e AS (
    SELECT ev.counted, ev.outcome,
           (ev.counted AND ev.outcome IN ('responded', 'no_response')) AS c,
           CASE WHEN ev.counted AND ev.outcome = 'responded'
                THEN GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ev.responded_at, ev.received_at) - ev.received_at)) / 60.0) END AS mins
      FROM public.responsiveness_events ev
     WHERE ev.consultant_id = _cid
       AND (_since IS NULL OR ev.received_at >= _since)
       AND ev.outcome <> 'withdrawn'
       AND CASE _scope
             WHEN 'main' THEN ev.kind IN ('request', 'bid')
             WHEN 'critical' THEN ev.kind = 'critical' OR (ev.kind IN ('request', 'bid') AND ev.is_critical)
             ELSE ev.kind = 'chat' END
  )
  SELECT jsonb_build_object(
    'received', count(*),
    'counted', count(*) FILTER (WHERE c),
    'not_counted', count(*) FILTER (WHERE NOT counted OR outcome = 'voided'),
    'responded', count(*) FILTER (WHERE c AND outcome = 'responded'),
    'no_response', count(*) FILTER (WHERE c AND outcome = 'no_response'),
    'rate', CASE WHEN count(*) FILTER (WHERE c) > 0
                 THEN round(100.0 * count(*) FILTER (WHERE c AND outcome = 'responded') / count(*) FILTER (WHERE c))::INT END,
    'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY mins))::NUMERIC)::INT,
    'avg', round(avg(mins)::NUMERIC)::INT,
    'p90', round((percentile_cont(0.9) WITHIN GROUP (ORDER BY mins))::NUMERIC)::INT,
    'buckets', jsonb_build_object(
      'lt15', count(*) FILTER (WHERE mins < 15),
      'lt60', count(*) FILTER (WHERE mins >= 15 AND mins < 60),
      'lt240', count(*) FILTER (WHERE mins >= 60 AND mins < 240),
      'lt1440', count(*) FILTER (WHERE mins >= 240 AND mins < 1440),
      'later', count(*) FILTER (WHERE mins >= 1440)))
    FROM e
$$;
REVOKE ALL ON FUNCTION public.responsiveness_metrics(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_metrics(UUID, TIMESTAMPTZ, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.responsiveness_level(_counted INT, _rate INT, _median INT, _s JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _counted < (_s->>'min_sample')::INT THEN 'new'
    WHEN _median IS NOT NULL AND _median < (_s->>'excellent_median')::INT AND COALESCE(_rate, 0) >= (_s->>'excellent_rate')::INT THEN 'excellent'
    WHEN _median IS NOT NULL AND _median < (_s->>'good_median')::INT AND COALESCE(_rate, 0) >= (_s->>'good_rate')::INT THEN 'good'
    WHEN _median IS NOT NULL AND _median < (_s->>'fair_median')::INT AND COALESCE(_rate, 0) >= (_s->>'rate_threshold')::INT THEN 'fair'
    ELSE 'needs_improvement' END
$$;

CREATE OR REPLACE FUNCTION public.responsiveness_public_level(_level TEXT, _counted INT, _rate INT, _nr30 INT, _s JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _level = 'new' OR _counted < (_s->>'min_sample')::INT THEN 'new'
    WHEN _nr30 >= (_s->>'warnings')::INT + 1 OR COALESCE(_rate, 0) < (_s->>'rate_threshold')::INT THEN 'needs_improvement'
    WHEN _level = 'needs_improvement' THEN 'fair'
    ELSE _level END
$$;

CREATE OR REPLACE FUNCTION public.responsiveness_stars(_level TEXT, _rate INT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _level WHEN 'excellent' THEN 5 WHEN 'good' THEN 4 WHEN 'fair' THEN 3
                     WHEN 'needs_improvement' THEN CASE WHEN COALESCE(_rate, 0) < 30 THEN 1 ELSE 2 END END::NUMERIC
$$;

CREATE OR REPLACE FUNCTION public.responsiveness_recompute(_cid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s JSONB := public.responsiveness_settings();
  m90 JSONB;
  m30 JSONB;
  v_level TEXT;
  v_public TEXT;
  v_counted INT;
  v_rate INT;
  v_median INT;
  v_nr30 INT;
  v_trend JSONB;
BEGIN
  m90 := public.responsiveness_metrics(_cid, now() - interval '90 days', 'main');
  m30 := public.responsiveness_metrics(_cid, now() - interval '30 days', 'main');
  v_counted := (m90->>'counted')::INT;
  v_rate := (m90->>'rate')::INT;
  v_median := (m90->>'median')::INT;
  v_nr30 := (m30->>'no_response')::INT;
  v_level := public.responsiveness_level(v_counted, v_rate, v_median, s);
  v_public := public.responsiveness_public_level(v_level, v_counted, v_rate, v_nr30, s);

  -- Trend: 12 weeks (Monday start), counted requests, rate and median per week.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('week', to_char(w.wk, 'YYYY-MM-DD')) || x.m ORDER BY w.wk), '[]'::jsonb) INTO v_trend
    FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS w(wk)
    CROSS JOIN LATERAL (
      SELECT jsonb_build_object(
        'counted', count(*) FILTER (WHERE ev.counted AND ev.outcome IN ('responded', 'no_response')),
        'rate', CASE WHEN count(*) FILTER (WHERE ev.counted AND ev.outcome IN ('responded', 'no_response')) > 0
                     THEN round(100.0 * count(*) FILTER (WHERE ev.counted AND ev.outcome = 'responded')
                                / count(*) FILTER (WHERE ev.counted AND ev.outcome IN ('responded', 'no_response')))::INT END,
        'median', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY
                    CASE WHEN ev.counted AND ev.outcome = 'responded'
                         THEN GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(ev.responded_at, ev.received_at) - ev.received_at)) / 60.0) END))::NUMERIC)::INT) AS m
        FROM public.responsiveness_events ev
       WHERE ev.consultant_id = _cid AND ev.kind IN ('request', 'bid')
         AND ev.received_at >= w.wk AND ev.received_at < w.wk + interval '1 week'
    ) x;

  INSERT INTO public.consultant_responsiveness AS r
    (consultant_id, stats, level, public_level, counted_90d, rate_90d, median_90d, no_response_30d, warnings_sent, stars, computed_at)
  VALUES (
    _cid,
    jsonb_build_object(
      'd30', jsonb_build_object('main', m30,
                                'critical', public.responsiveness_metrics(_cid, now() - interval '30 days', 'critical'),
                                'chat', public.responsiveness_metrics(_cid, now() - interval '30 days', 'chat')),
      'd90', jsonb_build_object('main', m90,
                                'critical', public.responsiveness_metrics(_cid, now() - interval '90 days', 'critical'),
                                'chat', public.responsiveness_metrics(_cid, now() - interval '90 days', 'chat')),
      'all', jsonb_build_object('main', public.responsiveness_metrics(_cid, NULL, 'main'),
                                'critical', public.responsiveness_metrics(_cid, NULL, 'critical'),
                                'chat', public.responsiveness_metrics(_cid, NULL, 'chat')),
      'trend', v_trend),
    v_level, v_public, v_counted, v_rate, v_median, v_nr30,
    (SELECT count(*) FROM public.responsiveness_notices n
      WHERE n.consultant_id = _cid AND (n.kind LIKE 'warning_%' OR n.kind = 'badge_visible') AND n.created_at >= now() - interval '90 days'),
    public.responsiveness_stars(v_public, v_rate),
    now())
  ON CONFLICT (consultant_id) DO UPDATE
    SET stats = EXCLUDED.stats, level = EXCLUDED.level, public_level = EXCLUDED.public_level,
        counted_90d = EXCLUDED.counted_90d, rate_90d = EXCLUDED.rate_90d, median_90d = EXCLUDED.median_90d,
        no_response_30d = EXCLUDED.no_response_30d, warnings_sent = EXCLUDED.warnings_sent,
        stars = EXCLUDED.stars, computed_at = EXCLUDED.computed_at;
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_recompute(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_recompute(UUID) TO service_role;

-- 6. Notices: in-app line now, popup until acknowledged, e-mail through the responsiveness-run function.
CREATE OR REPLACE FUNCTION public.responsiveness_notify(_event_id UUID, _kind TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev RECORD;
  s JSONB := public.responsiveness_settings();
  v_w INT := (s->>'warnings')::INT;
  v_n INT;
  v_lang TEXT;
  v_title TEXT;
  v_t TEXT;
  v_b TEXT;
  v_k INT;
BEGIN
  SELECT e.*, c.user_id AS uid, t.title AS ttitle INTO ev
    FROM public.responsiveness_events e
    JOIN public.consultants c ON c.id = e.consultant_id
    LEFT JOIN public.tickets t ON t.id = e.ticket_id
   WHERE e.id = _event_id;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) INTO v_n FROM public.responsiveness_events x
   WHERE x.consultant_id = ev.consultant_id AND x.kind IN ('request', 'bid') AND x.counted AND x.outcome = 'no_response'
     AND x.received_at >= now() - interval '30 days';

  INSERT INTO public.responsiveness_notices (consultant_id, user_id, event_id, kind, count_30d, warnings_total)
  VALUES (ev.consultant_id, ev.uid, _event_id, _kind, v_n, v_w)
  ON CONFLICT (event_id, kind) DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;

  v_lang := public.assignment_user_lang(ev.uid);
  v_title := left(COALESCE(ev.ttitle, CASE WHEN v_lang = 'ar' THEN 'طلب' ELSE 'a request' END), 80);
  IF _kind LIKE 'warning_%' THEN
    v_k := substr(_kind, 9)::INT;
    IF v_lang = 'ar' THEN
      v_t := 'تحذير ' || v_k || ' من ' || v_w || ': لا يوجد رد';
      v_b := 'لم ترد على "' || v_title || '" في الوقت المحدد، ويُحتسب ذلك ضمن نسبة ردك. تحذير ' || v_k || ' من ' || v_w
             || ': تكرار عدم الرد سيُظهر شارة "الاستجابة" على بطاقتك ويؤثر على ترتيبك. يمكنك الاعتراض خلال ' || (s->>'dispute_days') || ' أيام.';
    ELSE
      v_t := 'Warning ' || v_k || ' of ' || v_w || ': no response';
      v_b := 'You did not answer "' || v_title || '" in time and it counts against your response rate. Warning ' || v_k || ' of ' || v_w
             || ': repeated non-response will show a Response badge on your card and affect your ranking. You can dispute it within '
             || (s->>'dispute_days') || ' days.';
    END IF;
  ELSIF _kind = 'badge_visible' THEN
    IF v_lang = 'ar' THEN
      v_t := 'مؤشر الاستجابة: يحتاج إلى تحسين';
      v_b := 'لم ترد على "' || v_title || '" في الوقت المحدد. هذه المرة رقم ' || v_n || ' خلال 30 يوماً، لذا يمكن أن يظهر مؤشر الاستجابة على بطاقتك بمستوى "يحتاج إلى تحسين" ويؤثر على ترتيبك. يتحسن تلقائياً عندما ترد على الطلبات الجديدة في الوقت.';
    ELSE
      v_t := 'Responsiveness: Needs improvement';
      v_b := 'You did not answer "' || v_title || '" in time. This is no-response number ' || v_n || ' in 30 days, so your Responsiveness indicator can show "Needs improvement" on your card and affects your ranking. It recovers automatically as you answer new requests in time.';
    END IF;
  ELSIF _kind = 'counted' THEN
    IF v_lang = 'ar' THEN
      v_t := 'عدم رد محتسب';
      v_b := 'لم ترد على "' || v_title || '" في الوقت المحدد، ويُحتسب ذلك ضمن نسبة ردك (' || v_n || ' خلال آخر 30 يوماً).';
    ELSE
      v_t := 'No response counted';
      v_b := 'You did not answer "' || v_title || '" in time. It counts against your response rate (' || v_n || ' in the last 30 days).';
    END IF;
  ELSIF _kind = 'not_counted' THEN
    IF v_lang = 'ar' THEN
      v_t := 'لا يوجد رد، غير محتسب';
      v_b := 'لم ترد على "' || v_title || '" في الوقت المحدد، لكنه وصل خارج أوقات توفرك، لذلك لا يُحتسب في نسبة ردك.';
    ELSE
      v_t := 'No response, not counted';
      v_b := 'You did not answer "' || v_title || '" in time, but it arrived outside your availability, so it is not counted in your response rate.';
    END IF;
  ELSIF _kind = 'dispute_upheld' THEN
    v_t := CASE WHEN v_lang = 'ar' THEN 'تم قبول اعتراضك' ELSE 'Dispute accepted' END;
    v_b := CASE WHEN v_lang = 'ar' THEN 'أُزيل عدم الرد على "' || v_title || '" من إحصاءاتك.'
                ELSE 'The no-response on "' || v_title || '" was removed from your statistics.' END;
  ELSE
    v_t := CASE WHEN v_lang = 'ar' THEN 'لم يُقبل اعتراضك' ELSE 'Dispute not accepted' END;
    v_b := CASE WHEN v_lang = 'ar' THEN 'لا يزال عدم الرد على "' || v_title || '" محتسباً.'
                ELSE 'The no-response on "' || v_title || '" still counts.' END;
  END IF;
  PERFORM public.safe_insert_notification(ev.uid, v_t, v_b, 'responsiveness', '/consultant/responsiveness?event=' || _event_id);
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_notify(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_notify(UUID, TEXT) TO service_role;

-- A request or bid invitation reached "No response": counted or not, warning 1..N, then the badge notice.
CREATE OR REPLACE FUNCTION public.responsiveness_on_no_response(_event_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev RECORD;
  v_w INT := (public.responsiveness_settings() ->> 'warnings')::INT;
  v_n INT;
  v_kind TEXT;
BEGIN
  SELECT * INTO ev FROM public.responsiveness_events WHERE id = _event_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF ev.kind IN ('request', 'bid') THEN
    IF ev.counted THEN
      SELECT count(*) INTO v_n FROM public.responsiveness_events x
       WHERE x.consultant_id = ev.consultant_id AND x.kind IN ('request', 'bid') AND x.counted AND x.outcome = 'no_response'
         AND x.received_at >= now() - interval '30 days';
      v_kind := CASE WHEN v_n <= v_w THEN 'warning_' || GREATEST(v_n, 1)
                     WHEN v_n = v_w + 1 THEN 'badge_visible'
                     ELSE 'counted' END;
    ELSE
      v_kind := 'not_counted';
    END IF;
    PERFORM public.responsiveness_notify(_event_id, v_kind);
  END IF;
  PERFORM public.responsiveness_recompute(ev.consultant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_on_no_response(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_on_no_response(UUID) TO service_role;

-- 7. Event triggers. Every one of them swallows its own errors so requests, alarms and chat never break.
CREATE OR REPLACE FUNCTION public.responsiveness_match_request_ins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.response_due_at IS NOT NULL AND NEW.status::TEXT = 'pending' THEN
    PERFORM public.responsiveness_add_event(NEW.consultant_id, CASE WHEN NEW.response_kind = 'bid' THEN 'bid' ELSE 'request' END,
      NEW.id, NEW.ticket_id, NULL, NEW.created_at, NEW.response_due_at, NEW.is_critical);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness request insert skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_match_request_ins ON public.ticket_match_requests;
CREATE TRIGGER trg_responsiveness_match_request_ins
  AFTER INSERT ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_match_request_ins();

CREATE OR REPLACE FUNCTION public.responsiveness_match_request_upd()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status::TEXT IN ('accepted', 'rejected') THEN
    -- A decline in time is a response; an answer after "No response" (after Wait longer) keeps the no-response.
    UPDATE public.responsiveness_events
       SET outcome = 'responded', responded_at = COALESCE(NEW.responded_at, now()), resolved_at = now()
     WHERE kind IN ('request', 'bid') AND source_id = NEW.id AND outcome = 'pending'
     RETURNING consultant_id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.responsiveness_recompute(v_id); END IF;
  ELSIF NEW.status::TEXT = 'withdrawn' THEN
    UPDATE public.responsiveness_events SET outcome = 'withdrawn', resolved_at = now()
     WHERE kind IN ('request', 'bid') AND source_id = NEW.id AND outcome = 'pending';
  ELSIF NEW.status::TEXT = 'expired' THEN
    UPDATE public.responsiveness_events SET outcome = 'no_response', resolved_at = now()
     WHERE kind IN ('request', 'bid') AND source_id = NEW.id AND outcome = 'pending'
     RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN PERFORM public.responsiveness_on_no_response(v_id); END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness request update skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_match_request_upd ON public.ticket_match_requests;
CREATE TRIGGER trg_responsiveness_match_request_upd
  AFTER UPDATE OF status ON public.ticket_match_requests
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_match_request_upd();

-- Critical alarms: answered by a proposal (critical_replies) or by dismissing the alarm (a decline).
CREATE OR REPLACE FUNCTION public.responsiveness_critical_alert_ins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mins INT;
BEGIN
  SELECT COALESCE(t.critical_minutes, 30) INTO v_mins FROM public.tickets t WHERE t.id = NEW.ticket_id;
  PERFORM public.responsiveness_add_event(NEW.consultant_id, 'critical', NEW.id, NEW.ticket_id, NULL,
    COALESCE(NEW.alerted_at, now()), COALESCE(NEW.alerted_at, now()) + make_interval(mins => COALESCE(v_mins, 30)), true);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness critical alert skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_critical_alert_ins ON public.critical_alerts;
CREATE TRIGGER trg_responsiveness_critical_alert_ins
  AFTER INSERT ON public.critical_alerts
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_critical_alert_ins();

CREATE OR REPLACE FUNCTION public.responsiveness_critical_alert_dismiss()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.dismissed_at IS NULL AND NEW.dismissed_at IS NOT NULL THEN
    UPDATE public.responsiveness_events SET outcome = 'responded', responded_at = NEW.dismissed_at, resolved_at = now()
     WHERE kind = 'critical' AND source_id = NEW.id AND outcome = 'pending' AND (due_at IS NULL OR NEW.dismissed_at <= due_at);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness critical dismiss skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_critical_alert_dismiss ON public.critical_alerts;
CREATE TRIGGER trg_responsiveness_critical_alert_dismiss
  AFTER UPDATE OF dismissed_at ON public.critical_alerts
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_critical_alert_dismiss();

CREATE OR REPLACE FUNCTION public.responsiveness_critical_reply_ins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.responsiveness_events SET outcome = 'responded', responded_at = COALESCE(NEW.replied_at, now()), resolved_at = now()
   WHERE kind = 'critical' AND ticket_id = NEW.ticket_id AND consultant_id = NEW.consultant_id AND outcome = 'pending';
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness critical reply skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_critical_reply_ins ON public.critical_replies;
CREATE TRIGGER trg_responsiveness_critical_reply_ins
  AFTER INSERT ON public.critical_replies
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_critical_reply_ins();

-- Client chat on active tickets: the first unanswered client message opens an event, the consultant's next message answers it.
CREATE OR REPLACE FUNCTION public.responsiveness_message_ins()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ss RECORD;
  v_win INT;
BEGIN
  IF NEW.message_type::TEXT = 'system' THEN RETURN NEW; END IF;
  SELECT s.id, s.client_id, s.consultant_id, s.ticket_id, c.user_id AS cuid, t.status::TEXT AS tstatus INTO ss
    FROM public.sessions s
    JOIN public.consultants c ON c.id = s.consultant_id
    JOIN public.tickets t ON t.id = s.ticket_id
   WHERE s.id = NEW.session_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.sender_id = ss.cuid THEN
    UPDATE public.responsiveness_events SET outcome = 'responded', responded_at = NEW.created_at, resolved_at = now()
     WHERE kind = 'chat' AND session_id = ss.id AND outcome = 'pending';
  ELSIF NEW.sender_id = ss.client_id AND ss.tstatus IN ('matched', 'in_progress', 'waiting_for_client')
        AND NOT EXISTS (SELECT 1 FROM public.responsiveness_events e WHERE e.kind = 'chat' AND e.session_id = ss.id AND e.outcome = 'pending') THEN
    v_win := (public.responsiveness_settings() ->> 'chat_window')::INT;
    PERFORM public.responsiveness_add_event(ss.consultant_id, 'chat', NEW.id, ss.ticket_id, ss.id,
      NEW.created_at, NEW.created_at + make_interval(mins => v_win), false);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'responsiveness chat skipped (%)', SQLSTATE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_responsiveness_message_ins ON public.messages;
CREATE TRIGGER trg_responsiveness_message_ins
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.responsiveness_message_ins();

-- 8. Backfill: Feature L requests that already exist (no notices for them). Availability uses today's slots and periods.
INSERT INTO public.responsiveness_events
  (consultant_id, kind, source_id, ticket_id, received_at, due_at, is_critical, responded_at, outcome, resolved_at, counted, excluded_reason)
SELECT q.consultant_id, CASE WHEN q.response_kind = 'bid' THEN 'bid' ELSE 'request' END, q.id, q.ticket_id, q.created_at,
       q.response_due_at, q.is_critical,
       CASE WHEN q.status::TEXT IN ('accepted', 'rejected') AND q.expired_at IS NULL THEN q.responded_at END,
       CASE WHEN q.expired_at IS NOT NULL OR q.status::TEXT = 'expired' THEN 'no_response'
            WHEN q.status::TEXT IN ('accepted', 'rejected') THEN 'responded'
            WHEN q.status::TEXT = 'withdrawn' THEN 'withdrawn'
            ELSE 'pending' END,
       CASE WHEN q.status::TEXT <> 'pending' THEN COALESCE(q.expired_at, q.responded_at, q.updated_at) END,
       public.responsiveness_exclusion(q.consultant_id, q.created_at) IS NULL,
       public.responsiveness_exclusion(q.consultant_id, q.created_at)
  FROM public.ticket_match_requests q
 WHERE q.response_due_at IS NOT NULL
ON CONFLICT (kind, source_id) DO NOTHING;

-- 9. Consultant actions.
CREATE OR REPLACE FUNCTION public.consultant_set_capacity(_max INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _max IS NOT NULL AND (_max < 1 OR _max > 50) THEN RAISE EXCEPTION 'Capacity must be between 1 and 50 active tickets'; END IF;
  UPDATE public.consultants SET max_active_tickets = _max WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.consultant_set_capacity(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_set_capacity(INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.consultant_dispute_no_response(_event_id UUID, _reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev RECORD;
  v_days INT := (public.responsiveness_settings() ->> 'dispute_days')::INT;
  v_reason TEXT := btrim(COALESCE(_reason, ''));
  v_id UUID;
  v_admin UUID;
BEGIN
  SELECT e.* INTO ev FROM public.responsiveness_events e JOIN public.consultants c ON c.id = e.consultant_id
   WHERE e.id = _event_id AND c.user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF ev.kind NOT IN ('request', 'bid') OR ev.outcome <> 'no_response' OR NOT ev.counted THEN
    RAISE EXCEPTION 'Only a counted no-response can be disputed';
  END IF;
  IF now() > COALESCE(ev.resolved_at, ev.received_at) + make_interval(days => v_days) THEN
    RAISE EXCEPTION 'The dispute window of % days has passed', v_days;
  END IF;
  IF length(v_reason) < 10 OR length(v_reason) > 500 THEN RAISE EXCEPTION 'Please give a reason of 10 to 500 characters'; END IF;
  INSERT INTO public.responsiveness_disputes (event_id, consultant_id, reason) VALUES (_event_id, ev.consultant_id, v_reason)
  ON CONFLICT (event_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'This no-response was already disputed'; END IF;
  FOR v_admin IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin') LOOP
    PERFORM public.safe_insert_notification(v_admin, 'Responsiveness dispute', 'A consultant disputed a counted no-response.',
      'responsiveness', '/admin/responsiveness?tab=disputes');
  END LOOP;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.consultant_dispute_no_response(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_dispute_no_response(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.ack_responsiveness_notice(_notice_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.responsiveness_notices SET acked_at = now() WHERE id = _notice_id AND user_id = auth.uid() AND acked_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.ack_responsiveness_notice(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ack_responsiveness_notice(UUID) TO authenticated;

-- "My responsiveness": recalculated on demand (when older than 5 minutes).
CREATE OR REPLACE FUNCTION public.my_responsiveness()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid UUID;
  v_cap INT;
  r RECORD;
  s JSONB := public.responsiveness_settings();
BEGIN
  SELECT id, max_active_tickets INTO v_cid, v_cap FROM public.consultants WHERE user_id = auth.uid();
  IF v_cid IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultant_responsiveness WHERE consultant_id = v_cid AND computed_at > now() - interval '5 minutes') THEN
    PERFORM public.responsiveness_recompute(v_cid);
  END IF;
  SELECT * INTO r FROM public.consultant_responsiveness WHERE consultant_id = v_cid;
  RETURN jsonb_build_object(
    'public_on', public.platform_flag('responsiveness_public', false),
    'settings', s,
    'summary', jsonb_build_object('level', r.level, 'public_level', r.public_level, 'counted_90d', r.counted_90d,
                                  'rate_90d', r.rate_90d, 'median_90d', r.median_90d, 'no_response_30d', r.no_response_30d,
                                  'warnings_sent', r.warnings_sent, 'stars', r.stars, 'computed_at', r.computed_at),
    'stats', r.stats,
    'capacity', v_cap,
    'active_tickets', (SELECT count(DISTINCT a.ticket_id) FROM public.ticket_assignments a WHERE a.consultant_id = v_cid AND a.status = 'active'),
    'events', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.received_at DESC) FROM (
        SELECT e.id, e.kind, e.received_at, e.due_at, e.responded_at, e.resolved_at, e.outcome, e.counted, e.excluded_reason,
               e.is_critical, left(t.title, 120) AS ticket_title, d.status AS dispute_status, d.admin_note AS dispute_note
          FROM public.responsiveness_events e
          LEFT JOIN public.tickets t ON t.id = e.ticket_id
          LEFT JOIN public.responsiveness_disputes d ON d.event_id = e.id
         WHERE e.consultant_id = v_cid AND e.received_at >= now() - interval '90 days'
         ORDER BY e.received_at DESC
         LIMIT 200) x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.my_responsiveness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_responsiveness() TO authenticated;

-- 10. What clients and the matcher may see: level, median and rate only; nothing while responsiveness_public is off.
CREATE OR REPLACE FUNCTION public.responsiveness_public_summary(_consultant_ids UUID[] DEFAULT NULL)
RETURNS TABLE (consultant_id UUID, level TEXT, median_minutes INT, response_rate INT, stars NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.platform_flag('responsiveness_public', false) THEN RETURN; END IF;
  RETURN QUERY
  SELECT c.id,
         COALESCE(r.public_level, 'new'),
         CASE WHEN COALESCE(r.public_level, 'new') <> 'new' THEN r.median_90d END,
         CASE WHEN COALESCE(r.public_level, 'new') <> 'new' THEN r.rate_90d END,
         CASE WHEN COALESCE(r.public_level, 'new') <> 'new' THEN r.stars END
    FROM public.consultants c
    LEFT JOIN public.consultant_responsiveness r ON r.consultant_id = c.id
   WHERE (_consultant_ids IS NULL OR c.id = ANY (_consultant_ids[1:500]))
   LIMIT 3000;
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_public_summary(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.responsiveness_public_summary(UUID[]) TO authenticated, service_role;

-- 11. Admin.
CREATE OR REPLACE FUNCTION public.admin_responsiveness_overview()
RETURNS TABLE (consultant_id UUID, name TEXT, level TEXT, public_level TEXT, counted_90d INT, rate_90d INT, median_90d INT,
               no_response_30d INT, warnings_sent INT, disputes_open INT, disputes_total INT, computed_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT r.consultant_id, p.display_name, r.level, r.public_level, r.counted_90d, r.rate_90d, r.median_90d, r.no_response_30d,
         r.warnings_sent,
         (SELECT count(*) FROM public.responsiveness_disputes d WHERE d.consultant_id = r.consultant_id AND d.status = 'pending')::INT,
         (SELECT count(*) FROM public.responsiveness_disputes d WHERE d.consultant_id = r.consultant_id)::INT,
         r.computed_at
    FROM public.consultant_responsiveness r
    JOIN public.consultants c ON c.id = r.consultant_id
    LEFT JOIN public.profiles p ON p.user_id = c.user_id;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_responsiveness_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_responsiveness_overview() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_responsiveness_disputes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY (x.status = 'pending') DESC, x.created_at DESC) FROM (
      SELECT d.id, d.event_id, d.consultant_id, p.display_name AS name, d.reason, d.status, d.created_at, d.reviewed_at, d.admin_note,
             e.kind, e.received_at, e.due_at, e.excluded_reason, left(t.title, 120) AS ticket_title
        FROM public.responsiveness_disputes d
        JOIN public.responsiveness_events e ON e.id = d.event_id
        JOIN public.consultants c ON c.id = d.consultant_id
        LEFT JOIN public.profiles p ON p.user_id = c.user_id
        LEFT JOIN public.tickets t ON t.id = e.ticket_id
       ORDER BY d.created_at DESC
       LIMIT 300) x), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_responsiveness_disputes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_responsiveness_disputes() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_responsiveness_dispute(_dispute_id UUID, _uphold BOOLEAN, _note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d RECORD;
  v_note TEXT := NULLIF(left(btrim(COALESCE(_note, '')), 500), '');
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO d FROM public.responsiveness_disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute not found'; END IF;
  IF d.status <> 'pending' THEN RAISE EXCEPTION 'This dispute was already reviewed'; END IF;
  UPDATE public.responsiveness_disputes
     SET status = CASE WHEN _uphold THEN 'upheld' ELSE 'rejected' END, reviewed_by = auth.uid(), reviewed_at = now(), admin_note = v_note
   WHERE id = _dispute_id;
  IF _uphold THEN
    UPDATE public.responsiveness_events SET outcome = 'voided', voided_at = now(), voided_by = auth.uid(), void_reason = v_note
     WHERE id = d.event_id AND outcome = 'no_response';
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), CASE WHEN _uphold THEN 'responsiveness_no_response_voided' ELSE 'responsiveness_dispute_rejected' END,
          'responsiveness_event', d.event_id,
          jsonb_build_object('dispute_id', d.id, 'consultant_id', d.consultant_id, 'note', v_note));
  PERFORM public.responsiveness_notify(d.event_id, CASE WHEN _uphold THEN 'dispute_upheld' ELSE 'dispute_rejected' END);
  PERFORM public.responsiveness_recompute(d.consultant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_responsiveness_dispute(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_responsiveness_dispute(UUID, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.responsiveness_recompute_all()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid UUID;
  v_n INT := 0;
BEGIN
  FOR v_cid IN
    SELECT DISTINCT x.cid FROM (
      SELECT e.consultant_id AS cid FROM public.responsiveness_events e
      UNION SELECT r.consultant_id FROM public.consultant_responsiveness r) x
     LIMIT 5000
  LOOP
    PERFORM public.responsiveness_recompute(v_cid);
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO public.responsiveness_runs (kind) VALUES ('nightly');
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_recompute_all() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_recompute_all() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_recompute_responsiveness()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN public.responsiveness_recompute_all();
END;
$$;
REVOKE ALL ON FUNCTION public.admin_recompute_responsiveness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recompute_responsiveness() TO authenticated;

-- 12. Sweep (service role only): closes overdue alarms and chats, recalculates nightly, hands out e-mails.
CREATE OR REPLACE FUNCTION public.responsiveness_sweep()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_touched UUID[];
  v_cid UUID;
  v_nightly INT := 0;
BEGIN
  IF (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO public.responsiveness_runs (kind) VALUES ('sweep');

  WITH due AS (
    SELECT e.id, e.consultant_id,
           CASE WHEN t.status::TEXT IN ('resolved', 'closed')
                  OR (e.kind = 'critical' AND t.critical_first_reply_by IS NOT NULL AND t.critical_first_reply_by <> e.consultant_id)
                  OR (t.consultant_id IS NOT NULL AND t.consultant_id <> e.consultant_id AND e.kind = 'critical')
                THEN 'withdrawn' ELSE 'no_response' END AS outcome
      FROM public.responsiveness_events e
      JOIN public.consultants c ON c.id = e.consultant_id
      LEFT JOIN public.tickets t ON t.id = e.ticket_id
     WHERE e.outcome = 'pending' AND e.kind IN ('critical', 'chat') AND e.due_at <= now()
     ORDER BY e.due_at
     LIMIT 2000
     FOR UPDATE OF e SKIP LOCKED
  ), upd AS (
    UPDATE public.responsiveness_events e SET outcome = due.outcome, resolved_at = now()
      FROM due WHERE e.id = due.id
    RETURNING e.consultant_id
  )
  SELECT array_agg(DISTINCT consultant_id) INTO v_touched FROM upd;

  IF v_touched IS NOT NULL THEN
    FOREACH v_cid IN ARRAY v_touched LOOP PERFORM public.responsiveness_recompute(v_cid); END LOOP;
  END IF;

  -- Nightly: once per night (01:00-05:00 Riyadh), recovery of old no-responses happens here as they leave the windows.
  IF EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Riyadh') BETWEEN 1 AND 4
     AND NOT EXISTS (SELECT 1 FROM public.responsiveness_runs r WHERE r.kind = 'nightly' AND r.ran_at > now() - interval '20 hours') THEN
    v_nightly := public.responsiveness_recompute_all();
  END IF;

  RETURN jsonb_build_object('closed', COALESCE(array_length(v_touched, 1), 0), 'nightly', v_nightly);
END;
$$;
REVOKE ALL ON FUNCTION public.responsiveness_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.responsiveness_sweep() TO service_role;

CREATE OR REPLACE FUNCTION public.claim_responsiveness_notices(_limit INT DEFAULT 100)
RETURNS TABLE (notice_id UUID, kind TEXT, user_id UUID, lang TEXT, ticket_title TEXT, count_30d INT, warnings_total INT,
               dispute_days INT, event_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_days INT := (public.responsiveness_settings() ->> 'dispute_days')::INT;
BEGIN
  IF (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  WITH picked AS (
    SELECT n.id FROM public.responsiveness_notices n
     WHERE n.emailed_at IS NULL AND n.created_at > now() - interval '3 days'
     ORDER BY n.created_at
     LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 200)
     FOR UPDATE SKIP LOCKED
  ), upd AS (
    UPDATE public.responsiveness_notices n SET emailed_at = now() FROM picked WHERE n.id = picked.id
    RETURNING n.id, n.kind, n.user_id, n.event_id, n.count_30d, n.warnings_total
  )
  SELECT u.id, u.kind, u.user_id, public.assignment_user_lang(u.user_id), left(t.title, 120), u.count_30d, u.warnings_total, v_days, u.event_id
    FROM upd u
    JOIN public.responsiveness_events e ON e.id = u.event_id
    LEFT JOIN public.tickets t ON t.id = e.ticket_id;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_responsiveness_notices(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_responsiveness_notices(INT) TO service_role;

-- 13. Critical alarms: consultants whose public indicator is "Needs improvement" are left out of the automatic alarm
--     while responsiveness_public is on (they still see the request under Open requests). Otherwise unchanged.
CREATE OR REPLACE FUNCTION public.critical_alert_targets(_ticket_id uuid)
 RETURNS TABLE(consultant_id uuid, user_id uuid, area_match boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client uuid;
  _areas text[];
  _toks text[];
  _demote boolean := public.platform_flag('responsiveness_public', false);
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
       AND NOT (_demote AND EXISTS (SELECT 1 FROM public.consultant_responsiveness r
                                     WHERE r.consultant_id = c.id AND r.public_level = 'needs_improvement'))
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

-- 14. First statistics, then the sweep every 10 minutes (credential-free; the service-only RPCs and the function's
--     8-minute guard bound the work; responses contain counts only).
DO $$
DECLARE v_cid UUID;
BEGIN
  FOR v_cid IN SELECT DISTINCT consultant_id FROM public.responsiveness_events LOOP
    PERFORM public.responsiveness_recompute(v_cid);
  END LOOP;
END $$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'responsiveness-run';
SELECT cron.schedule(
  'responsiveness-run',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/responsiveness-run',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
