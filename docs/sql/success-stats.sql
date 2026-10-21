-- Feature W addition: requests + success statistics and the Success level on every consultant ring.
-- Prepared for the owner to apply; NOT applied by the app. Safe to run more than once.
--
-- Uses live objects: consultants, tickets, ticket_team_members, ticket_assignments, client_reviews,
--   ticket_satisfaction_surveys, user_admin_state (tags), platform_settings, platform_flag, has_role,
--   safe_insert_notification, audit_logs, pg_cron.
--
-- What counts (per consultant and ticket, one engagement):
--   * worked     = team row ready/active (or legacy active), or the ticket's consultant, or a lead/support assignment
--                  when no team row exists.
--   * solved     = ticket resolved/closed and confirmed by the client (ticket closed, a client review for this
--                  consultant, or an answered satisfaction survey), unless marked "not solved".
--   * not solved = after work started: removed / replaced / withdrawn / expired, or the client marked the ticket
--                  as not solved or cancelled (tickets.close_outcome).
--   * not counted: never started (declined, expired invitations, withdrawn before ready, bids not chosen),
--                  admin-voided, merged duplicates, test data (client or consultant tagged "test" in the Users console),
--                  still open, resolved but not yet confirmed.
-- The browser only ever gets counts per consultant (consultant_success_stats); never per-ticket data.

-- 1. Settings (admin-editable). `success_min_requests` wins over success_levels.min_requests when both are set.
INSERT INTO public.platform_settings (key, value) VALUES ('success_public', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.platform_settings (key, value)
VALUES ('success_levels', '{"bronze": 60, "silver": 80, "gold": 85, "platinum": 100, "min_requests": 5}'::jsonb)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.platform_settings (key, value) VALUES ('success_min_requests', '5'::jsonb) ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.success_int(_v JSONB, _k TEXT, _def INT, _lo INT, _hi INT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN (_v ->> _k) ~ '^\d{1,3}$' AND (_v ->> _k)::INT BETWEEN _lo AND _hi THEN (_v ->> _k)::INT ELSE _def END
$$;

CREATE OR REPLACE FUNCTION public.success_settings()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v JSONB;
  m JSONB;
  o JSONB;
BEGIN
  SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value END INTO v FROM public.platform_settings WHERE key = 'success_levels';
  v := COALESCE(v, '{}'::jsonb);
  SELECT value INTO m FROM public.platform_settings WHERE key = 'success_min_requests';
  o := jsonb_build_object(
    'bronze', public.success_int(v, 'bronze', 60, 1, 100),
    'silver', public.success_int(v, 'silver', 80, 1, 100),
    'gold', public.success_int(v, 'gold', 85, 1, 100),
    'platinum', public.success_int(v, 'platinum', 100, 1, 100),
    'min_requests', COALESCE(public.success_int(jsonb_build_object('n', m #>> '{}'), 'n', NULL, 1, 100),
                             public.success_int(v, 'min_requests', 5, 1, 100)));
  IF NOT ((o->>'bronze')::INT < (o->>'silver')::INT AND (o->>'silver')::INT < (o->>'gold')::INT AND (o->>'gold')::INT < (o->>'platinum')::INT) THEN
    o := o || '{"bronze": 60, "silver": 80, "gold": 85, "platinum": 100}'::jsonb;
  END IF;
  RETURN o;
END;
$$;
REVOKE ALL ON FUNCTION public.success_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.success_settings() TO anon, authenticated, service_role;

-- Level from whole numbers only (no rounding): Platinum only when every request was solved.
CREATE OR REPLACE FUNCTION public.success_level(_total INT, _solved INT, _s JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(_total, 0) <= 0 OR _total < (_s->>'min_requests')::INT THEN 'new'
    WHEN _solved * 100 >= (_s->>'platinum')::INT * _total THEN 'platinum'
    WHEN _solved * 100 >= (_s->>'gold')::INT * _total THEN 'gold'
    WHEN _solved * 100 >= (_s->>'silver')::INT * _total THEN 'silver'
    WHEN _solved * 100 >= (_s->>'bronze')::INT * _total THEN 'bronze'
    ELSE 'none' END
$$;

-- Shown percentage: rounded down, so 99.9 % reads 99 % and only "all solved" reads 100 %.
CREATE OR REPLACE FUNCTION public.success_pct(_total INT, _solved INT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN COALESCE(_total, 0) > 0 THEN floor(_solved * 100.0 / _total)::INT END
$$;

-- Public part of the settings.
CREATE OR REPLACE FUNCTION public.success_public_config()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.success_settings() || jsonb_build_object('public', public.platform_flag('success_public', true))
$$;
REVOKE ALL ON FUNCTION public.success_public_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.success_public_config() TO anon, authenticated, service_role;

-- 2. "Not solved" / "cancelled" marker set by the ticket's client (or an admin) through client_set_ticket_outcome only.
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS close_outcome TEXT;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS close_outcome_at TIMESTAMPTZ;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS close_outcome_by UUID;
DO $$ BEGIN
  ALTER TABLE public.tickets ADD CONSTRAINT tickets_close_outcome_chk CHECK (close_outcome IS NULL OR close_outcome IN ('unresolved', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.tickets.close_outcome IS 'Feature W success stats: client said the request ended unsolved (unresolved) or was cancelled. Set only by client_set_ticket_outcome.';

CREATE OR REPLACE FUNCTION public.guard_ticket_close_outcome()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.close_outcome IS DISTINCT FROM OLD.close_outcome OR NEW.close_outcome_at IS DISTINCT FROM OLD.close_outcome_at
      OR NEW.close_outcome_by IS DISTINCT FROM OLD.close_outcome_by)
     AND auth.uid() IS NOT NULL AND COALESCE(current_setting('app.success_outcome', true), '') <> 'on' THEN
    RAISE EXCEPTION 'The request outcome can only be changed with "Mark as not solved".' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_ticket_close_outcome ON public.tickets;
CREATE TRIGGER trg_guard_ticket_close_outcome BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.guard_ticket_close_outcome();

-- 3. Tables. Browser roles read their own rows (admins all); nobody writes directly.
CREATE TABLE IF NOT EXISTS public.success_engagement_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('void', 'solved')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (consultant_id, ticket_id)
);

CREATE TABLE IF NOT EXISTS public.success_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'voided', 'solved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  admin_note TEXT,
  UNIQUE (consultant_id, ticket_id)
);
CREATE INDEX IF NOT EXISTS success_disputes_status_idx ON public.success_disputes (status, created_at);

CREATE TABLE IF NOT EXISTS public.consultant_success_stats (
  consultant_id UUID PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  requests_total INT NOT NULL DEFAULT 0,
  solved INT NOT NULL DEFAULT 0,
  not_solved INT NOT NULL DEFAULT 0,
  requests_12m INT NOT NULL DEFAULT 0,
  solved_12m INT NOT NULL DEFAULT 0,
  not_solved_12m INT NOT NULL DEFAULT 0,
  open_count INT NOT NULL DEFAULT 0,
  awaiting_confirmation INT NOT NULL DEFAULT 0,
  excluded JSONB NOT NULL DEFAULT '{}'::jsonb,
  level TEXT NOT NULL DEFAULT 'new',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.success_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL DEFAULT 'nightly' CHECK (kind IN ('nightly', 'manual')),
  consultants INT NOT NULL DEFAULT 0,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.success_engagement_overrides, public.success_disputes, public.consultant_success_stats TO authenticated;
GRANT ALL ON public.success_engagement_overrides, public.success_disputes, public.consultant_success_stats, public.success_runs TO service_role;
ALTER TABLE public.success_engagement_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.success_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultant_success_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.success_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Own or admin read" ON public.success_engagement_overrides;
CREATE POLICY "Own or admin read" ON public.success_engagement_overrides FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Own or admin read" ON public.success_disputes;
CREATE POLICY "Own or admin read" ON public.success_disputes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Own or admin read" ON public.consultant_success_stats;
CREATE POLICY "Own or admin read" ON public.consultant_success_stats FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- 4. One row per engagement of one consultant, classified (internal; the wrappers below decide who sees what).
CREATE OR REPLACE FUNCTION public.success_engagements(_cid UUID)
RETURNS TABLE (ticket_id UUID, title TEXT, outcome TEXT, reason TEXT, ended_at TIMESTAMPTZ, confirmed BOOLEAN, disputable BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (SELECT c.id, c.user_id FROM public.consultants c WHERE c.id = _cid),
  tm AS (
    SELECT DISTINCT ON (m.ticket_id) m.ticket_id, m.status, m.is_legacy, m.ready_at, m.ended_at, m.updated_at,
           (m.ready_at IS NOT NULL OR m.status IN ('ready', 'active') OR (m.is_legacy AND m.status = 'active')) AS started
      FROM public.ticket_team_members m
     WHERE m.consultant_id = _cid
     ORDER BY m.ticket_id, (m.ready_at IS NOT NULL OR m.status IN ('ready', 'active')) DESC, m.updated_at DESC
  ),
  asg AS (
    SELECT a.ticket_id, bool_or(a.status = 'removed') AS removed, bool_and(a.status = 'removed') AS all_removed, max(a.updated_at) AS updated_at
      FROM public.ticket_assignments a
     WHERE a.consultant_id = _cid AND a.role <> 'observer'
     GROUP BY a.ticket_id
  ),
  src AS (
    SELECT t.id AS ticket_id FROM public.tickets t WHERE t.consultant_id = _cid
    UNION SELECT tm.ticket_id FROM tm
    UNION SELECT asg.ticket_id FROM asg
  ),
  x AS (
    SELECT t.id, t.title, t.status::TEXT AS t_status, t.close_outcome, t.close_outcome_at, t.resolved_at, t.updated_at AS t_updated,
           t.merged_into_ticket_id, t.client_id,
           tm.status AS m_status, tm.ended_at AS m_ended, tm.updated_at AS m_updated,
           (COALESCE(tm.started, false) OR t.consultant_id = _cid OR (tm.ticket_id IS NULL AND asg.ticket_id IS NOT NULL)) AS started,
           (COALESCE(tm.started, false) AND tm.status IN ('removed', 'replaced', 'withdrawn', 'expired'))
             OR (tm.ticket_id IS NULL AND COALESCE(asg.all_removed, false) AND t.consultant_id IS DISTINCT FROM _cid) AS ended_badly,
           asg.updated_at AS a_updated,
           o.kind AS override,
           (t.status::TEXT = 'closed'
             OR EXISTS (SELECT 1 FROM public.client_reviews r WHERE r.ticket_id = t.id AND r.consultant_id = _cid AND NOT COALESCE(r.hidden, false))
             OR EXISTS (SELECT 1 FROM public.ticket_satisfaction_surveys s WHERE s.ticket_id = t.id AND s.responded_at IS NOT NULL
                          AND s.rating IS NOT NULL AND (s.consultant_id IS NULL OR s.consultant_id = _cid))) AS confirmed,
           EXISTS (SELECT 1 FROM public.user_admin_state u
                    WHERE u.user_id IN (t.client_id, (SELECT me.user_id FROM me))
                      AND EXISTS (SELECT 1 FROM unnest(COALESCE(u.tags, '{}'::TEXT[])) tg WHERE lower(btrim(tg)) IN ('test', 'test data', 'test-data', 'testdata'))) AS is_test
      FROM src
      JOIN public.tickets t ON t.id = src.ticket_id
      LEFT JOIN tm ON tm.ticket_id = t.id
      LEFT JOIN asg ON asg.ticket_id = t.id
      LEFT JOIN public.success_engagement_overrides o ON o.consultant_id = _cid AND o.ticket_id = t.id
     WHERE EXISTS (SELECT 1 FROM me)
  ),
  y AS (
    SELECT x.*,
      CASE
        WHEN x.merged_into_ticket_id IS NOT NULL THEN 'excluded_merged'
        WHEN x.is_test THEN 'excluded_test'
        WHEN x.override = 'void' THEN 'excluded_voided'
        WHEN NOT x.started THEN 'excluded_never_started'
        WHEN x.override = 'solved' THEN 'solved'
        WHEN x.ended_badly THEN 'not_solved'
        WHEN x.close_outcome IN ('unresolved', 'cancelled') THEN 'not_solved'
        WHEN x.t_status IN ('resolved', 'closed') AND x.confirmed THEN 'solved'
        WHEN x.t_status IN ('resolved', 'closed') THEN 'awaiting_confirmation'
        ELSE 'open' END AS outcome,
      CASE
        WHEN x.override = 'solved' THEN 'admin_reviewed'
        WHEN x.ended_badly THEN 'member_' || COALESCE(x.m_status, 'removed')
        WHEN x.close_outcome IS NOT NULL THEN 'client_' || x.close_outcome
        ELSE NULL END AS reason
      FROM x
  )
  SELECT y.id, y.title, y.outcome, y.reason,
         CASE
           WHEN y.outcome = 'not_solved' AND y.ended_badly THEN COALESCE(y.m_ended, y.m_updated, y.a_updated, y.t_updated)
           WHEN y.outcome = 'not_solved' THEN COALESCE(y.close_outcome_at, y.t_updated)
           WHEN y.outcome IN ('solved', 'awaiting_confirmation') THEN COALESCE(y.resolved_at, y.t_updated)
           ELSE NULL END,
         y.confirmed,
         y.outcome = 'not_solved' AND y.override IS NULL
  FROM y
$$;
REVOKE ALL ON FUNCTION public.success_engagements(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.success_engagements(UUID) TO service_role;

-- 5. Recalculation (same style as responsiveness: per consultant, all consultants nightly, admin on demand).
CREATE OR REPLACE FUNCTION public.success_recompute(_cid UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s JSONB := public.success_settings();
  r RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.consultants WHERE id = _cid) THEN RETURN; END IF;
  SELECT
    count(*) FILTER (WHERE e.outcome IN ('solved', 'not_solved'))::INT AS total,
    count(*) FILTER (WHERE e.outcome = 'solved')::INT AS solved,
    count(*) FILTER (WHERE e.outcome = 'not_solved')::INT AS not_solved,
    count(*) FILTER (WHERE e.outcome IN ('solved', 'not_solved') AND e.ended_at >= now() - interval '12 months')::INT AS total_12,
    count(*) FILTER (WHERE e.outcome = 'solved' AND e.ended_at >= now() - interval '12 months')::INT AS solved_12,
    count(*) FILTER (WHERE e.outcome = 'not_solved' AND e.ended_at >= now() - interval '12 months')::INT AS not_solved_12,
    count(*) FILTER (WHERE e.outcome = 'open')::INT AS open_n,
    count(*) FILTER (WHERE e.outcome = 'awaiting_confirmation')::INT AS awaiting,
    jsonb_build_object(
      'never_started', count(*) FILTER (WHERE e.outcome = 'excluded_never_started'),
      'voided', count(*) FILTER (WHERE e.outcome = 'excluded_voided'),
      'merged', count(*) FILTER (WHERE e.outcome = 'excluded_merged'),
      'test', count(*) FILTER (WHERE e.outcome = 'excluded_test')) AS excluded
    INTO r
    FROM public.success_engagements(_cid) e;
  INSERT INTO public.consultant_success_stats AS t (consultant_id, requests_total, solved, not_solved, requests_12m, solved_12m, not_solved_12m,
                                                   open_count, awaiting_confirmation, excluded, level, computed_at)
  VALUES (_cid, r.total, r.solved, r.not_solved, r.total_12, r.solved_12, r.not_solved_12, r.open_n, r.awaiting, r.excluded,
          public.success_level(r.total, r.solved, s), now())
  ON CONFLICT (consultant_id) DO UPDATE SET
    requests_total = EXCLUDED.requests_total, solved = EXCLUDED.solved, not_solved = EXCLUDED.not_solved,
    requests_12m = EXCLUDED.requests_12m, solved_12m = EXCLUDED.solved_12m, not_solved_12m = EXCLUDED.not_solved_12m,
    open_count = EXCLUDED.open_count, awaiting_confirmation = EXCLUDED.awaiting_confirmation, excluded = EXCLUDED.excluded,
    level = EXCLUDED.level, computed_at = EXCLUDED.computed_at;
END;
$$;
REVOKE ALL ON FUNCTION public.success_recompute(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.success_recompute(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.success_recompute_all(_kind TEXT DEFAULT 'nightly')
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid UUID;
  v_n INT := 0;
BEGIN
  FOR v_cid IN SELECT c.id FROM public.consultants c ORDER BY c.id LIMIT 20000 LOOP
    PERFORM public.success_recompute(v_cid);
    v_n := v_n + 1;
  END LOOP;
  INSERT INTO public.success_runs (kind, consultants) VALUES (CASE WHEN _kind = 'manual' THEN 'manual' ELSE 'nightly' END, v_n);
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.success_recompute_all(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.success_recompute_all(TEXT) TO service_role;

-- Recalculate the people involved when a request or an engagement changes state (never blocks the change itself).
CREATE OR REPLACE FUNCTION public.success_on_ticket_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_cid UUID;
BEGIN
  BEGIN
    FOR v_cid IN
      SELECT DISTINCT c FROM (
        SELECT NEW.consultant_id AS c UNION SELECT OLD.consultant_id
        UNION SELECT m.consultant_id FROM public.ticket_team_members m WHERE m.ticket_id = NEW.id
        UNION SELECT a.consultant_id FROM public.ticket_assignments a WHERE a.ticket_id = NEW.id) z
      WHERE c IS NOT NULL
    LOOP
      PERFORM public.success_recompute(v_cid);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'success stats recalculation skipped: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_success_ticket_change ON public.tickets;
CREATE TRIGGER trg_success_ticket_change AFTER UPDATE OF status, close_outcome, consultant_id, merged_into_ticket_id ON public.tickets
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.close_outcome IS DISTINCT FROM NEW.close_outcome
                     OR OLD.consultant_id IS DISTINCT FROM NEW.consultant_id OR OLD.merged_into_ticket_id IS DISTINCT FROM NEW.merged_into_ticket_id)
  EXECUTE FUNCTION public.success_on_ticket_change();

CREATE OR REPLACE FUNCTION public.success_on_member_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.success_recompute(NEW.consultant_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'success stats recalculation skipped: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_success_member_change ON public.ticket_team_members;
CREATE TRIGGER trg_success_member_change AFTER INSERT OR UPDATE OF status ON public.ticket_team_members
  FOR EACH ROW WHEN (NEW.status IN ('ready', 'active', 'removed', 'replaced', 'withdrawn', 'expired'))
  EXECUTE FUNCTION public.success_on_member_change();

-- 6. What everyone may see: counts per consultant, plus the level and percentage only from the minimum sample
--    and from Bronze up. Visitors (not signed in) only see verified consultants with a visible profile.
CREATE OR REPLACE FUNCTION public.consultant_success_stats(_consultant_ids UUID[] DEFAULT NULL)
RETURNS TABLE (consultant_id UUID, requests_total INT, solved INT, not_solved INT, success_rate INT, level TEXT,
               requests_12m INT, solved_12m INT, success_rate_12m INT, level_12m TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  s JSONB := public.success_settings();
BEGIN
  IF NOT public.platform_flag('success_public', true) THEN RETURN; END IF;
  RETURN QUERY
  SELECT c.id,
         COALESCE(x.requests_total, 0), COALESCE(x.solved, 0), COALESCE(x.not_solved, 0),
         CASE WHEN public.success_level(COALESCE(x.requests_total, 0), COALESCE(x.solved, 0), s) NOT IN ('new', 'none')
              THEN public.success_pct(x.requests_total, x.solved) END,
         public.success_level(COALESCE(x.requests_total, 0), COALESCE(x.solved, 0), s),
         COALESCE(x.requests_12m, 0), COALESCE(x.solved_12m, 0),
         CASE WHEN public.success_level(COALESCE(x.requests_12m, 0), COALESCE(x.solved_12m, 0), s) NOT IN ('new', 'none')
              THEN public.success_pct(x.requests_12m, x.solved_12m) END,
         public.success_level(COALESCE(x.requests_12m, 0), COALESCE(x.solved_12m, 0), s)
    FROM public.consultants c
    LEFT JOIN public.consultant_success_stats x ON x.consultant_id = c.id
   WHERE (_consultant_ids IS NULL OR c.id = ANY (_consultant_ids[1:500]))
     AND (auth.uid() IS NOT NULL OR (c.verification_status::TEXT = 'verified' AND COALESCE(c.profile_visible, true)))
   LIMIT 3000;
END;
$$;
REVOKE ALL ON FUNCTION public.consultant_success_stats(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consultant_success_stats(UUID[]) TO anon, authenticated, service_role;

-- 7. The consultant's own view: their engagements (own tickets only), so they can ask for a review of a "not solved".
CREATE OR REPLACE FUNCTION public.my_success()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_cid UUID;
BEGIN
  SELECT id INTO v_cid FROM public.consultants WHERE user_id = auth.uid() LIMIT 1;
  IF v_cid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'settings', public.success_settings(),
    'stats', (SELECT to_jsonb(x) - 'excluded' FROM public.consultant_success_stats x WHERE x.consultant_id = v_cid),
    'engagements', COALESCE((SELECT jsonb_agg(jsonb_build_object('ticket_id', e.ticket_id, 'title', left(e.title, 120), 'outcome', e.outcome,
                                   'reason', e.reason, 'ended_at', e.ended_at, 'disputable', e.disputable
                                     AND e.ended_at >= now() - interval '30 days'
                                     AND NOT EXISTS (SELECT 1 FROM public.success_disputes d WHERE d.consultant_id = v_cid AND d.ticket_id = e.ticket_id)) ORDER BY e.ended_at DESC NULLS FIRST)
                               FROM public.success_engagements(v_cid) e WHERE e.outcome IN ('solved', 'not_solved', 'awaiting_confirmation', 'open')), '[]'::jsonb),
    'disputes', COALESCE((SELECT jsonb_agg(to_jsonb(d) - 'reviewed_by' ORDER BY d.created_at DESC) FROM public.success_disputes d WHERE d.consultant_id = v_cid), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.my_success() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_success() TO authenticated;

CREATE OR REPLACE FUNCTION public.consultant_dispute_success(_ticket_id UUID, _reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cid UUID;
  v_reason TEXT := btrim(COALESCE(_reason, ''));
  e RECORD;
  v_id UUID;
  v_admin UUID;
BEGIN
  SELECT id INTO v_cid FROM public.consultants WHERE user_id = auth.uid() LIMIT 1;
  IF v_cid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO e FROM public.success_engagements(v_cid) x WHERE x.ticket_id = _ticket_id;
  IF NOT FOUND OR e.outcome <> 'not_solved' OR NOT e.disputable THEN RAISE EXCEPTION 'Only a request counted as not solved can be reviewed'; END IF;
  IF e.ended_at < now() - interval '30 days' THEN RAISE EXCEPTION 'Reviews can be asked for up to 30 days after the request ended'; END IF;
  IF length(v_reason) < 10 OR length(v_reason) > 500 THEN RAISE EXCEPTION 'Please give a reason of 10 to 500 characters'; END IF;
  INSERT INTO public.success_disputes (consultant_id, ticket_id, reason) VALUES (v_cid, _ticket_id, v_reason)
  ON CONFLICT (consultant_id, ticket_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'A review was already asked for this request'; END IF;
  FOR v_admin IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin') LOOP
    PERFORM public.safe_insert_notification(v_admin, 'Success review requested', 'A consultant asked for a review of a request counted as not solved.',
      'success', '/admin/responsiveness?tab=success');
  END LOOP;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.consultant_dispute_success(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultant_dispute_success(UUID, TEXT) TO authenticated;

-- 8. The ticket's client (or an admin) records that a request ended unsolved or was cancelled after work started.
CREATE OR REPLACE FUNCTION public.client_set_ticket_outcome(_ticket_id UUID, _outcome TEXT, _reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t RECORD;
  v_admin BOOLEAN := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin');
BEGIN
  IF _outcome IS NOT NULL AND _outcome NOT IN ('unresolved', 'cancelled') THEN RAISE EXCEPTION 'Unknown outcome'; END IF;
  SELECT * INTO t FROM public.tickets WHERE id = _ticket_id FOR UPDATE;
  IF NOT FOUND OR (t.client_id IS DISTINCT FROM auth.uid() AND NOT v_admin) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF _outcome = 'unresolved' AND t.status::TEXT NOT IN ('resolved', 'closed') THEN RAISE EXCEPTION 'Only a resolved or closed request can be marked as not solved'; END IF;
  PERFORM set_config('app.success_outcome', 'on', true);
  UPDATE public.tickets SET close_outcome = _outcome, close_outcome_at = CASE WHEN _outcome IS NULL THEN NULL ELSE now() END,
         close_outcome_by = CASE WHEN _outcome IS NULL THEN NULL ELSE auth.uid() END
   WHERE id = _ticket_id;
  PERFORM set_config('app.success_outcome', '', true);
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'ticket_close_outcome_set', 'ticket', _ticket_id,
          jsonb_build_object('outcome', _outcome, 'previous', t.close_outcome, 'reason', NULLIF(left(btrim(COALESCE(_reason, '')), 500), ''), 'by_admin', v_admin AND t.client_id IS DISTINCT FROM auth.uid()));
END;
$$;
REVOKE ALL ON FUNCTION public.client_set_ticket_outcome(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_set_ticket_outcome(UUID, TEXT, TEXT) TO authenticated;

-- 9. Admin: full breakdown (incl. excluded counts and every engagement), void/restore, review queue, recalculation.
CREATE OR REPLACE FUNCTION public.admin_success_breakdown(_cid UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'settings', public.success_settings(),
    'public', public.platform_flag('success_public', true),
    'stats', (SELECT to_jsonb(x) FROM public.consultant_success_stats x WHERE x.consultant_id = _cid),
    'engagements', COALESCE((SELECT jsonb_agg(jsonb_build_object('ticket_id', e.ticket_id, 'title', left(e.title, 160), 'outcome', e.outcome, 'reason', e.reason,
                                   'ended_at', e.ended_at, 'confirmed', e.confirmed,
                                   'override', (SELECT jsonb_build_object('kind', o.kind, 'reason', o.reason, 'at', o.created_at) FROM public.success_engagement_overrides o
                                                 WHERE o.consultant_id = _cid AND o.ticket_id = e.ticket_id)) ORDER BY e.ended_at DESC NULLS FIRST)
                               FROM public.success_engagements(_cid) e), '[]'::jsonb),
    'disputes', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.created_at DESC) FROM public.success_disputes d WHERE d.consultant_id = _cid), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_success_breakdown(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_success_breakdown(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_success_override(_cid UUID, _ticket_id UUID, _action TEXT, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason TEXT := btrim(COALESCE(_reason, ''));
  v_prev TEXT;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF _action NOT IN ('void', 'clear') THEN RAISE EXCEPTION 'Unknown action'; END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 500 THEN RAISE EXCEPTION 'Please give a reason of 3 to 500 characters'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.success_engagements(_cid) e WHERE e.ticket_id = _ticket_id) THEN RAISE EXCEPTION 'Engagement not found'; END IF;
  SELECT kind INTO v_prev FROM public.success_engagement_overrides WHERE consultant_id = _cid AND ticket_id = _ticket_id;
  IF _action = 'void' THEN
    INSERT INTO public.success_engagement_overrides (consultant_id, ticket_id, kind, reason, created_by)
    VALUES (_cid, _ticket_id, 'void', v_reason, auth.uid())
    ON CONFLICT (consultant_id, ticket_id) DO UPDATE SET kind = 'void', reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = now();
  ELSE
    DELETE FROM public.success_engagement_overrides WHERE consultant_id = _cid AND ticket_id = _ticket_id;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), CASE WHEN _action = 'void' THEN 'success_engagement_voided' ELSE 'success_engagement_restored' END, 'ticket', _ticket_id,
          jsonb_build_object('consultant_id', _cid, 'reason', v_reason, 'previous', v_prev));
  PERFORM public.success_recompute(_cid);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_success_override(UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_success_override(UUID, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_success_disputes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY (x.status = 'pending') DESC, x.created_at DESC) FROM (
      SELECT d.id, d.consultant_id, d.ticket_id, p.display_name AS name, d.reason, d.status, d.created_at, d.reviewed_at, d.admin_note,
             left(t.title, 120) AS ticket_title, t.status::TEXT AS ticket_status, t.close_outcome
        FROM public.success_disputes d
        JOIN public.consultants c ON c.id = d.consultant_id
        LEFT JOIN public.profiles p ON p.user_id = c.user_id
        LEFT JOIN public.tickets t ON t.id = d.ticket_id
       ORDER BY d.created_at DESC
       LIMIT 300) x), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_success_disputes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_success_disputes() TO authenticated;

-- _decision: 'void' (remove from the statistics), 'solved' (count as solved) or 'reject' (keep "not solved").
CREATE OR REPLACE FUNCTION public.admin_review_success_dispute(_dispute_id UUID, _decision TEXT, _note TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d RECORD;
  v_note TEXT := NULLIF(left(btrim(COALESCE(_note, '')), 500), '');
  v_user UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF _decision NOT IN ('void', 'solved', 'reject') THEN RAISE EXCEPTION 'Unknown decision'; END IF;
  SELECT * INTO d FROM public.success_disputes WHERE id = _dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review request not found'; END IF;
  IF d.status <> 'pending' THEN RAISE EXCEPTION 'This review request was already decided'; END IF;
  UPDATE public.success_disputes
     SET status = CASE _decision WHEN 'void' THEN 'voided' WHEN 'solved' THEN 'solved' ELSE 'rejected' END,
         reviewed_by = auth.uid(), reviewed_at = now(), admin_note = v_note
   WHERE id = _dispute_id;
  IF _decision <> 'reject' THEN
    INSERT INTO public.success_engagement_overrides (consultant_id, ticket_id, kind, reason, created_by)
    VALUES (d.consultant_id, d.ticket_id, _decision, COALESCE(v_note, 'Review request accepted'), auth.uid())
    ON CONFLICT (consultant_id, ticket_id) DO UPDATE SET kind = EXCLUDED.kind, reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = now();
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'success_dispute_' || _decision, 'ticket', d.ticket_id,
          jsonb_build_object('dispute_id', d.id, 'consultant_id', d.consultant_id, 'note', v_note));
  SELECT user_id INTO v_user FROM public.consultants WHERE id = d.consultant_id;
  IF v_user IS NOT NULL THEN
    PERFORM public.safe_insert_notification(v_user, 'Your review request was answered',
      CASE _decision WHEN 'reject' THEN 'The request stays counted as not solved.' WHEN 'solved' THEN 'The request now counts as solved.'
                     ELSE 'The request no longer counts in your success statistics.' END,
      'success', '/consultant/responsiveness');
  END IF;
  PERFORM public.success_recompute(d.consultant_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_success_dispute(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_success_dispute(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_recompute_success()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN public.success_recompute_all('manual');
END;
$$;
REVOKE ALL ON FUNCTION public.admin_recompute_success() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recompute_success() TO authenticated;

-- 10. First statistics, then every night at 01:41 UTC. Credential-free: the job runs the database function directly.
SELECT public.success_recompute_all('manual');

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'success-stats-nightly';
SELECT cron.schedule('success-stats-nightly', '41 1 * * *', $$SELECT public.success_recompute_all('nightly')$$);

-- Checks after applying:
--   SELECT public.success_public_config();
--   SELECT * FROM public.consultant_success_stats(NULL) LIMIT 5;
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'success-stats-nightly';
