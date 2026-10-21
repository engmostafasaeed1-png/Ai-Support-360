-- Feature W success statistics: post-apply checks. One transaction, rolled back at the end (no data is kept).
-- Run in a scratch database after docs/sql/success-stats.sql. Raises an exception on the first failed check.
BEGIN;
SET LOCAL client_min_messages = warning;
CREATE TEMP TABLE _ids AS SELECT
  '00000000-0000-0000-0000-0000000000a1'::uuid AS admin,
  '00000000-0000-0000-0000-0000000000b1'::uuid AS client,
  '00000000-0000-0000-0000-0000000000b2'::uuid AS client2,
  '00000000-0000-0000-0000-0000000000b9'::uuid AS tester,
  '00000000-0000-0000-0000-0000000000c1'::uuid AS cons_user,
  '00000000-0000-0000-0000-00000000cc01'::uuid AS cons,
  '00000000-0000-0000-0000-0000000000c2'::uuid AS hidden_user,
  '00000000-0000-0000-0000-00000000cc02'::uuid AS hidden_cons;
GRANT SELECT ON _ids TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', CASE WHEN _u IS NULL THEN '' ELSE json_build_object('sub', _u, 'role', 'authenticated')::text END, true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.check(_ok boolean, _what text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT COALESCE(_ok, false) THEN RAISE EXCEPTION 'FAILED: %', _what; END IF; END $$;

INSERT INTO public.user_roles (user_id, role) SELECT admin, 'admin' FROM _ids;
INSERT INTO public.consultants (id, user_id) SELECT cons, cons_user FROM _ids;
INSERT INTO public.consultants (id, user_id, verification_status) SELECT hidden_cons, hidden_user, 'pending' FROM _ids;
INSERT INTO public.user_admin_state (user_id, tags) SELECT tester, ARRAY['Test'] FROM _ids;

-- Fixtures: one ticket per case, title = expected outcome.
CREATE TEMP TABLE _t (n int PRIMARY KEY, id uuid DEFAULT gen_random_uuid());
INSERT INTO _t (n) SELECT generate_series(1, 16);
GRANT SELECT ON _t TO authenticated;
INSERT INTO public.tickets (id, client_id, title, status, resolved_at, consultant_id)
SELECT t.id, CASE WHEN t.n = 12 THEN i.tester ELSE i.client END, 'case ' || t.n,
       CASE WHEN t.n IN (1, 10) THEN 'closed' WHEN t.n IN (2, 3, 14, 13) THEN 'resolved' WHEN t.n = 11 THEN 'closed' ELSE 'in_progress' END,
       CASE WHEN t.n IN (1, 2, 3, 10, 11, 13, 14) THEN now() - interval '2 days' END,
       CASE WHEN t.n = 14 THEN i.cons END
  FROM _t t, _ids i;
UPDATE public.tickets SET merged_into_ticket_id = (SELECT id FROM _t WHERE n = 1) WHERE id = (SELECT id FROM _t WHERE n = 11);
INSERT INTO public.ticket_team_members (ticket_id, consultant_id, status, ready_at, ended_at)
SELECT t.id, i.cons,
       CASE t.n WHEN 5 THEN 'removed' WHEN 6 THEN 'declined' WHEN 7 THEN 'expired' WHEN 8 THEN 'withdrawn' WHEN 9 THEN 'not_selected' WHEN 15 THEN 'removed' WHEN 16 THEN 'withdrawn' ELSE 'active' END,
       CASE WHEN t.n IN (6, 7, 8, 9) THEN NULL WHEN t.n = 15 THEN now() - interval '30 months' ELSE now() - interval '10 days' END,
       CASE t.n WHEN 5 THEN now() - interval '1 day' WHEN 15 THEN now() - interval '2 years' WHEN 16 THEN now() - interval '3 days' END
  FROM _t t, _ids i WHERE t.n NOT IN (14);
INSERT INTO public.client_reviews (ticket_id, consultant_id) SELECT id, (SELECT cons FROM _ids) FROM _t WHERE n IN (2, 12);
INSERT INTO public.ticket_satisfaction_surveys (ticket_id, consultant_id, rating, responded_at) SELECT id, NULL, 4, now() FROM _t WHERE n IN (14, 13);
INSERT INTO public.success_engagement_overrides (consultant_id, ticket_id, kind, reason) SELECT (SELECT cons FROM _ids), id, 'void', 'admin test void' FROM _t WHERE n = 13;

-- 1. Level boundaries (whole-number maths, default thresholds 60/80/85/100, minimum 5).
DO $$
DECLARE s jsonb := public.success_settings();
BEGIN
  PERFORM pg_temp.check(public.success_level(100, 59, s) = 'none', '59 % no level');
  PERFORM pg_temp.check(public.success_level(100, 60, s) = 'bronze', '60 % Bronze');
  PERFORM pg_temp.check(public.success_level(100, 79, s) = 'bronze', '79 % Bronze');
  PERFORM pg_temp.check(public.success_level(100, 80, s) = 'silver', '80 % Silver');
  PERFORM pg_temp.check(public.success_level(100, 84, s) = 'silver', '84 % Silver');
  PERFORM pg_temp.check(public.success_level(100, 85, s) = 'gold', '85 % Gold');
  PERFORM pg_temp.check(public.success_level(100, 99, s) = 'gold', '99 % Gold');
  PERFORM pg_temp.check(public.success_level(100, 100, s) = 'platinum', '100 % Platinum');
  PERFORM pg_temp.check(public.success_level(1000, 999, s) = 'gold', '99.9 % stays Gold');
  PERFORM pg_temp.check(public.success_pct(1000, 999) = 99, '99.9 % shows 99');
  PERFORM pg_temp.check(public.success_level(4, 4, s) = 'new', 'below minimum sample is New');
  PERFORM pg_temp.check(public.success_level(5, 5, s) = 'platinum', 'minimum sample reached');
  PERFORM pg_temp.check(public.success_level(0, 0, s) = 'new', 'no requests is New');
END $$;
-- Minimum sample is admin-editable; a broken threshold order falls back to the defaults.
UPDATE public.platform_settings SET value = '8' WHERE key = 'success_min_requests';
UPDATE public.platform_settings SET value = '{"bronze": 90, "silver": 80, "gold": 85, "platinum": 100}' WHERE key = 'success_levels';
SELECT pg_temp.check((public.success_settings() ->> 'min_requests')::int = 8 AND (public.success_settings() ->> 'bronze')::int = 60, 'settings validated');
SELECT pg_temp.check(public.success_level(7, 7, public.success_settings()) = 'new', 'min 8 → 7 is New');
UPDATE public.platform_settings SET value = '5' WHERE key = 'success_min_requests';
UPDATE public.platform_settings SET value = '{"bronze": 60, "silver": 80, "gold": 85, "platinum": 100, "min_requests": 5}' WHERE key = 'success_levels';

-- 2. Exclusions and classification.
SELECT public.success_recompute((SELECT cons FROM _ids));
DO $$
DECLARE r record; o jsonb;
BEGIN
  SELECT jsonb_object_agg(split_part(e.title, ' ', 2), e.outcome) INTO o FROM public.success_engagements((SELECT cons FROM _ids)) e;
  PERFORM pg_temp.check(o ->> '1' = 'solved', 'closed ticket solved');
  PERFORM pg_temp.check(o ->> '2' = 'solved', 'resolved + client review solved');
  PERFORM pg_temp.check(o ->> '3' = 'awaiting_confirmation', 'resolved without client confirmation not counted yet');
  PERFORM pg_temp.check(o ->> '4' = 'open', 'in progress not counted');
  PERFORM pg_temp.check(o ->> '5' = 'not_solved', 'removed after start not solved');
  PERFORM pg_temp.check(o ->> '6' = 'excluded_never_started', 'declined excluded');
  PERFORM pg_temp.check(o ->> '7' = 'excluded_never_started', 'expired invitation excluded');
  PERFORM pg_temp.check(o ->> '8' = 'excluded_never_started', 'withdrawn before ready excluded');
  PERFORM pg_temp.check(o ->> '9' = 'excluded_never_started', 'bid not chosen excluded');
  PERFORM pg_temp.check(o ->> '11' = 'excluded_merged', 'merged duplicate excluded');
  PERFORM pg_temp.check(o ->> '12' = 'excluded_test', 'test client excluded');
  PERFORM pg_temp.check(o ->> '13' = 'excluded_voided', 'admin void excluded');
  PERFORM pg_temp.check(o ->> '14' = 'solved', 'legacy ticket consultant + survey solved');
  PERFORM pg_temp.check(o ->> '15' = 'not_solved', 'old removal not solved');
  PERFORM pg_temp.check(o ->> '16' = 'not_solved', 'withdrawn after start not solved');
  SELECT * INTO r FROM public.consultant_success_stats x WHERE x.consultant_id = (SELECT cons FROM _ids);
  -- solved 1, 2, 14; not solved 5, 15, 16; ticket 10 is still in progress.
  PERFORM pg_temp.check(r.requests_total = 6 AND r.solved = 3 AND r.not_solved = 3, format('all-time counts %s/%s/%s', r.requests_total, r.solved, r.not_solved));
  PERFORM pg_temp.check(r.requests_12m = 5 AND r.solved_12m = 3, '12-month counts');
  PERFORM pg_temp.check(r.level = 'none' AND r.awaiting_confirmation = 1 AND r.open_count = 2, 'level none at 50 %, awaiting/open');
  PERFORM pg_temp.check((r.excluded ->> 'never_started')::int = 4 AND (r.excluded ->> 'voided')::int = 1 AND (r.excluded ->> 'merged')::int = 1 AND (r.excluded ->> 'test')::int = 1, 'excluded counts');
END $$;

-- 3. The client marks ticket 10 as not solved; nobody can set the marker directly.
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT client FROM _ids));
DO $$ BEGIN
  BEGIN UPDATE public.tickets SET close_outcome = 'unresolved' WHERE id = (SELECT id FROM _t WHERE n = 10); RAISE EXCEPTION 'direct update allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.success_engagements((SELECT cons FROM _ids)); RAISE EXCEPTION 'engagement list callable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.admin_success_breakdown((SELECT cons FROM _ids)); RAISE EXCEPTION 'admin breakdown callable by client';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT public.client_set_ticket_outcome((SELECT id FROM _t WHERE n = 10), 'unresolved', 'Still failing');
SELECT pg_temp.as_user((SELECT client2 FROM _ids));
DO $$ BEGIN
  BEGIN PERFORM public.client_set_ticket_outcome((SELECT id FROM _t WHERE n = 1), 'unresolved', 'x'); RAISE EXCEPTION 'other client could mark';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT pg_temp.as_user(NULL);
SELECT pg_temp.check((SELECT outcome FROM public.success_engagements((SELECT cons FROM _ids)) WHERE title = 'case 10') = 'not_solved', 'client unresolved → not solved');
-- Ticket 3 gets closed: the trigger recalculates on its own.
UPDATE public.tickets SET status = 'closed' WHERE id = (SELECT id FROM _t WHERE n = 3);
SELECT pg_temp.check((SELECT solved = 4 AND not_solved = 4 AND requests_total = 8 FROM public.consultant_success_stats WHERE consultant_id = (SELECT cons FROM _ids)), 'trigger recalculated');

-- 4. Public read: counts only, level/percent only from Bronze and the minimum; visitors only see verified visible consultants.
SET LOCAL ROLE anon;
DO $$
DECLARE r record; n int;
BEGIN
  SELECT * INTO r FROM public.consultant_success_stats(ARRAY[(SELECT cons FROM _ids)]);
  PERFORM pg_temp.check(r.requests_total = 8 AND r.solved = 4 AND r.level = 'none' AND r.success_rate IS NULL, 'below 60 %: counts only');
  PERFORM pg_temp.check(r.requests_12m = 7 AND r.solved_12m = 4 AND r.success_rate_12m IS NULL, '12 months 57 %: no percentage');
  SELECT count(*) INTO n FROM public.consultant_success_stats(ARRAY[(SELECT hidden_cons FROM _ids)]);
  PERFORM pg_temp.check(n = 0, 'visitor cannot see unverified consultant');
END $$;
RESET ROLE;
SELECT pg_temp.check(NOT EXISTS (
  SELECT 1 FROM information_schema.routines r JOIN information_schema.parameters p ON p.specific_name = r.specific_name
   WHERE r.routine_name = 'consultant_success_stats' AND p.parameter_mode = 'OUT' AND p.parameter_name ~ '(ticket|title|client)'), 'no per-ticket columns');

-- 5. Review request: the consultant asks, the admin counts it as solved (audited, notified).
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user((SELECT cons_user FROM _ids));
DO $$ BEGIN
  BEGIN PERFORM public.consultant_dispute_success((SELECT id FROM _t WHERE n = 1), 'This one was solved, no need'); RAISE EXCEPTION 'solved disputable';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Only a request%' THEN RAISE; END IF; END;
  BEGIN PERFORM public.consultant_dispute_success((SELECT id FROM _t WHERE n = 15), 'Removed two years ago, unfair'); RAISE EXCEPTION 'old removal disputable';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE 'Reviews can be asked%' THEN RAISE; END IF; END;
END $$;
SELECT pg_temp.check(public.consultant_dispute_success((SELECT id FROM _t WHERE n = 5), 'The client removed me after I delivered the fix.') IS NOT NULL, 'dispute created');
SELECT pg_temp.check(jsonb_array_length(public.my_success() -> 'disputes') = 1, 'my_success lists the dispute');
SELECT pg_temp.as_user((SELECT admin FROM _ids));
SELECT public.admin_review_success_dispute((SELECT id FROM public.success_disputes LIMIT 1), 'solved', 'Fix confirmed in the logs');
SELECT public.admin_set_success_override((SELECT cons FROM _ids), (SELECT id FROM _t WHERE n = 16), 'void', 'Duplicate engagement');
RESET ROLE;
SELECT pg_temp.as_user(NULL);
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.consultant_success_stats x WHERE x.consultant_id = (SELECT cons FROM _ids);
  -- solved 1, 2, 3, 5, 14; not solved 10, 15; 16 voided.
  PERFORM pg_temp.check(r.requests_total = 7 AND r.solved = 5 AND r.not_solved = 2 AND r.level = 'bronze', format('after review %s/%s %s', r.solved, r.requests_total, r.level));
  PERFORM pg_temp.check(r.requests_12m = 6 AND r.solved_12m = 5, '12 months after review');
  PERFORM pg_temp.check((SELECT count(*) FROM public.audit_logs WHERE action IN ('success_dispute_solved', 'success_engagement_voided', 'ticket_close_outcome_set')) = 3, 'audited');
  PERFORM pg_temp.check(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = (SELECT cons_user FROM _ids) AND type = 'success'), 'consultant notified');
END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.check((SELECT success_rate = 71 AND level = 'bronze' AND success_rate_12m = 83 AND level_12m = 'silver'
  FROM public.consultant_success_stats(ARRAY[(SELECT cons FROM _ids)])), 'public rate 71 % Bronze, 12 months 83 % Silver');
RESET ROLE;

-- 6. Public display switch.
UPDATE public.platform_settings SET value = 'false' WHERE key = 'success_public';
SELECT pg_temp.check((SELECT count(*) FROM public.consultant_success_stats(NULL)) = 0, 'switch off hides everything');
SELECT pg_temp.check((public.success_public_config() ->> 'public')::boolean = false, 'config reports off');

-- 7. Nightly job is a plain database call (no credentials).
SELECT pg_temp.check((SELECT command FROM cron.job WHERE jobname = 'success-stats-nightly') NOT ILIKE '%http%', 'credential-free job');

SELECT 'success-stats checks passed' AS result;
ROLLBACK;
