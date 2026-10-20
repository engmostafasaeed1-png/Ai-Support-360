-- Feature M part 1 (docs/sql/responsiveness.sql steps 1-5): inputs, events, notices, disputes, stats, settings readers, fairness, metrics.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'ticket_match_requests' AND column_name = 'response_due_at') THEN
    RAISE EXCEPTION 'Apply docs/sql/assignment-response.sql (Feature L) first';
  END IF;
END $$;

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