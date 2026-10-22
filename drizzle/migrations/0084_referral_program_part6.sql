CREATE OR REPLACE FUNCTION public.admin_referral_export(_kind text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_rows jsonb;
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
IF NOT public.check_rate_limit('refexport:' || auth.uid()::text, 20, 3600) THEN
RAISE EXCEPTION 'Too many exports. Please try again later.' USING ERRCODE = 'P0001';
END IF;
IF _kind = 'lines' THEN
SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO _rows FROM public.admin_referral_lines(NULL, 2000, 0) t;
ELSIF _kind = 'referrals' THEN
SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO _rows FROM public.admin_referral_referrals(NULL, 'all', 1000, 0) t;
ELSE
RAISE EXCEPTION 'Unknown export' USING ERRCODE = '22023';
END IF;
PERFORM public.referral_log(auth.uid(), 'export', NULL, NULL, NULL, NULL, NULL, jsonb_build_object('kind', _kind, 'rows', jsonb_array_length(_rows)), 'CSV export');
RETURN _rows;
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_export(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_export(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.process_referral_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
_referral_code text;
_referrer_id uuid;
BEGIN
_referral_code := NEW.raw_user_meta_data->>'referral_code';
IF _referral_code IS NULL OR _referral_code = '' THEN
RETURN NEW;
END IF;
SELECT user_id INTO _referrer_id FROM public.profiles WHERE referral_code = _referral_code;
IF _referrer_id IS NULL OR _referrer_id = NEW.id THEN
RETURN NEW;
END IF;
IF lower(COALESCE(NEW.raw_user_meta_data->>'role', '')) = 'consultant'
AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = _referrer_id) THEN
RETURN NEW;
END IF;
UPDATE public.referrals
SET status = 'registered', referred_user_id = NEW.id, updated_at = now()
WHERE referral_code = _referral_code
AND (referred_email = NEW.email OR referred_email IS NULL)
AND status = 'pending';
IF NOT FOUND THEN
INSERT INTO public.referrals (referrer_id, referral_code, referred_user_id, status, referred_email)
VALUES (_referrer_id, _referral_code, NEW.id, 'registered', NEW.email);
END IF;
INSERT INTO public.notifications (user_id, title, body, type, link)
VALUES (_referrer_id, 'Someone joined with your referral link',
'Your $25 credit is added when the new member completes a first paid invoice.', 'referral', public.referrals_link_for(_referrer_id));
RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION public.grant_referral_rewards(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
_ref public.referrals;
_confirmed boolean;
_rewarded integer;
BEGIN
IF _user_id IS NULL THEN
RETURN;
END IF;
IF EXISTS (SELECT 1 FROM public.consultant_referrals cr JOIN public.consultants c ON c.id = cr.referred_consultant_id WHERE c.user_id = _user_id) THEN
RETURN;
END IF;
SELECT * INTO _ref FROM public.referrals
WHERE referred_user_id = _user_id AND status = 'registered'
ORDER BY created_at LIMIT 1 FOR UPDATE;
IF NOT FOUND THEN
RETURN;
END IF;
SELECT (u.email_confirmed_at IS NOT NULL) INTO _confirmed FROM auth.users u WHERE u.id = _user_id;
IF NOT COALESCE(_confirmed, false) THEN
RETURN;
END IF;
SELECT count(*) INTO _rewarded FROM public.referrals WHERE referrer_id = _ref.referrer_id AND status = 'rewarded';
IF _rewarded >= 20 THEN
UPDATE public.referrals SET status = 'expired', updated_at = now() WHERE id = _ref.id;
RETURN;
END IF;
INSERT INTO public.referral_rewards (referral_id, user_id, reward_type, amount, currency, description)
VALUES (_ref.id, _ref.referrer_id, 'credit', 25, 'USD', 'Referral bonus - the member you invited completed a first paid invoice'),
(_ref.id, _user_id, 'discount', 15, 'USD', 'Welcome bonus - you joined through a referral and completed a first paid invoice')
ON CONFLICT DO NOTHING;
UPDATE public.referrals SET status = 'rewarded', updated_at = now() WHERE id = _ref.id;
INSERT INTO public.notifications (user_id, title, body, type, link)
VALUES (_ref.referrer_id, 'Referral reward earned', 'The member you invited completed a first paid invoice. You earned a $25 credit.', 'referral', public.referrals_link_for(_ref.referrer_id));
END;
$function$;
CREATE OR REPLACE FUNCTION public.referral_calc_target(_consultant uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_me uuid := public.referral_my_consultant();
BEGIN
IF _consultant IS NULL OR _consultant = _me THEN
IF _me IS NULL THEN RAISE EXCEPTION 'Only consultants can open referral calculations' USING ERRCODE = '42501'; END IF;
RETURN _me;
END IF;
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'You can only see your own referral calculations' USING ERRCODE = '42501'; END IF;
RETURN _consultant;
END
$$;
REVOKE ALL ON FUNCTION public.referral_calc_target(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_ref_key(_referrer uuid, _referred uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT left(public.referral_hash('ref:' || _referrer::text || ':' || _referred::text), 16)
$$;
REVOKE ALL ON FUNCTION public.referral_ref_key(uuid, uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_engagement_ref(_referrer uuid, _engagement uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT CASE WHEN _engagement IS NULL THEN NULL ELSE 'Engagement #' || upper(left(public.referral_hash('eng:' || _referrer::text || ':' || _engagement::text), 4)) END
$$;
REVOKE ALL ON FUNCTION public.referral_engagement_ref(uuid, uuid) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.referral_lines_for(uuid, text, date, date, text);
CREATE OR REPLACE FUNCTION public.referral_lines_for(_cid uuid, _ref_key text, _from date, _to date, _status text)
RETURNS TABLE (created_at timestamptz, ref_key text, referred_name text, kind text, status text, engagement_ref text, approved_hours numeric,
man_days numeric, fee_amount numeric, rate_percent numeric, tier_name text, amount numeric, currency text,
payment_status text, client_paid_at timestamptz, payout_status text, payout_released_at timestamptz,
referral_payout_due date, note text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT l.created_at,
CASE WHEN l.referred_consultant_id IS NULL THEN NULL ELSE public.referral_ref_key(l.referrer_consultant_id, l.referred_consultant_id) END,
public.referral_masked_name(l.referred_consultant_id),
l.kind, l.status,
public.referral_engagement_ref(l.referrer_consultant_id, COALESCE(p.ticket_id, p.id)),
ts.billable_hours,
CASE WHEN ts.billable_hours IS NULL THEN NULL ELSE round(ts.billable_hours / 8, 2) END,
l.fee_amount, l.rate_percent, l.tier_name, l.amount, l.currency,
p.status::text, p.paid_at, po.status::text, CASE WHEN po.status::text = 'completed' THEN po.paid_at END,
rp.due_by,
CASE WHEN l.kind = 'reward' THEN NULL ELSE l.note END
FROM public.referral_reward_lines l
LEFT JOIN public.payouts po ON po.id = l.source_payout_id
LEFT JOIN public.payments p ON p.id = COALESCE(l.payment_id, po.payment_id)
LEFT JOIN public.ticket_timesheet_submissions ts ON ts.id = p.timesheet_id AND l.kind = 'reward'
LEFT JOIN public.payouts rp ON rp.id = l.referral_payout_id
WHERE l.referrer_consultant_id = _cid
AND (_ref_key IS NULL OR (l.referred_consultant_id IS NOT NULL AND public.referral_ref_key(l.referrer_consultant_id, l.referred_consultant_id) = _ref_key))
AND (_from IS NULL OR l.created_at >= _from::timestamptz)
AND (_to IS NULL OR l.created_at < (_to + 1)::timestamptz)
AND (_status IS NULL OR _status = 'all'
OR (_status = 'pending' AND l.status IN ('pending', 'held'))
OR (_status = 'available' AND l.status IN ('available', 'in_payout'))
OR (_status = 'paid' AND l.status = 'paid')
OR (_status = 'reversed' AND (l.status = 'reversed' OR l.kind = 'reversal')))
ORDER BY l.created_at DESC
LIMIT 5000
$$;
REVOKE ALL ON FUNCTION public.referral_lines_for(uuid, text, date, date, text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_summary_for(_cid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
s jsonb := public.referral_settings();
_next jsonb;
BEGIN
SELECT jsonb_build_object('date', p.due_by, 'amount', p.amount, 'currency', p.currency, 'kind', 'scheduled') INTO _next
FROM public.payouts p
WHERE p.consultant_id = _cid AND p.reference LIKE 'referral:%' AND p.status::text <> 'completed'
ORDER BY p.due_by NULLS LAST LIMIT 1;
IF _next IS NULL THEN
SELECT jsonb_build_object('date', public.payout_due_date(((now() AT TIME ZONE 'Africa/Cairo')::date) + 1), 'amount', t.a, 'currency', t.currency, 'kind', 'estimated')
INTO _next
FROM (SELECT l.currency, sum(l.amount) a FROM public.referral_reward_lines l
WHERE l.referrer_consultant_id = _cid AND l.status = 'available' GROUP BY l.currency
HAVING sum(l.amount) >= greatest((s->>'min_payout')::numeric, 0.01) ORDER BY 2 DESC LIMIT 1) t;
END IF;
RETURN jsonb_build_object(
'settings', jsonb_build_object('rate_percent', s->'rate_percent', 'months', s->'months', 'min_payout', s->'min_payout', 'tiers', s->'tiers'),
'referred', jsonb_build_object(
'total', (SELECT count(*) FROM public.consultant_referrals r WHERE r.referrer_consultant_id = _cid AND r.status <> 'removed'),
'verified', (SELECT count(*) FROM public.consultant_referrals r JOIN public.consultants c ON c.id = r.referred_consultant_id
WHERE r.referrer_consultant_id = _cid AND r.status <> 'removed' AND c.verification_status::text = 'verified'),
'paying', (SELECT count(*) FROM public.consultant_referrals r WHERE r.referrer_consultant_id = _cid AND r.status <> 'removed' AND r.first_paid_at IS NOT NULL)),
'earnings', COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', e.currency, 'pending', e.p, 'available', e.a, 'paid', e.d, 'lifetime', e.t,
'adjustments', e.adj, 'min_payout', (s->>'min_payout')::numeric) ORDER BY e.currency)
FROM (SELECT l.currency,
COALESCE(sum(l.amount) FILTER (WHERE l.status IN ('pending', 'held')), 0) p,
COALESCE(sum(l.amount) FILTER (WHERE l.status IN ('available', 'in_payout')), 0) a,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'paid'), 0) d,
COALESCE(sum(l.amount) FILTER (WHERE l.status <> 'reversed'), 0) t,
COALESCE(sum(l.amount) FILTER (WHERE l.kind = 'adjustment'), 0) adj
FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = _cid GROUP BY l.currency) e), '[]'::jsonb),
'available_now', COALESCE((SELECT jsonb_object_agg(x.currency, x.a) FROM (
SELECT l.currency, sum(l.amount) a FROM public.referral_reward_lines l
WHERE l.referrer_consultant_id = _cid AND l.status = 'available' GROUP BY l.currency) x), '{}'::jsonb),
'next_payout', _next,
'tier', public.referral_tier_for(public.referral_verified_count(_cid)),
'tiers', s -> 'tiers',
'last_updated', GREATEST((SELECT max(l.updated_at) FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = _cid),
(SELECT max(r.updated_at) FROM public.consultant_referrals r WHERE r.referrer_consultant_id = _cid)),
'generated_at', now());
END
$$;
REVOKE ALL ON FUNCTION public.referral_summary_for(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_calc_summary(_consultant uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT public.referral_summary_for(public.referral_calc_target(_consultant))
$$;
REVOKE ALL ON FUNCTION public.referral_calc_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_calc_summary(uuid) TO authenticated;
DROP FUNCTION IF EXISTS public.referral_calc_referrals(uuid, date, date, text);
CREATE OR REPLACE FUNCTION public.referral_calc_referrals(_consultant uuid DEFAULT NULL, _from date DEFAULT NULL, _to date DEFAULT NULL, _status text DEFAULT NULL)
RETURNS TABLE (ref_key text, referred_name text, activation_status text, first_paid_at timestamptz, window_ends_at timestamptz, currency text,
approved_hours numeric, man_days numeric, fee_base numeric, rate_min numeric, rate_percent numeric, reward_earned numeric, reversed numeric,
net numeric, pending numeric, available numeric, paid numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_calc_target(_consultant);
_rate numeric := (public.referral_tier_for(public.referral_verified_count(_cid)) ->> 'rate')::numeric;
BEGIN
RETURN QUERY
WITH l AS (SELECT * FROM public.referral_lines_for(_cid, NULL, _from, _to, _status))
SELECT public.referral_ref_key(r.referrer_consultant_id, r.referred_consultant_id), public.referral_masked_name(r.referred_consultant_id),
r.activation_status, r.first_paid_at, r.window_ends_at, COALESCE(x.currency, 'USD'),
COALESCE(x.hours, 0), round(COALESCE(x.hours, 0) / 8, 2), COALESCE(x.fee, 0), COALESCE(x.rate_lo, _rate), COALESCE(x.rate, _rate),
COALESCE(x.earned, 0), COALESCE(x.rev, 0), COALESCE(x.earned, 0) + COALESCE(x.rev, 0),
COALESCE(x.pend, 0), COALESCE(x.avail, 0), COALESCE(x.paid, 0)
FROM public.consultant_referrals r
LEFT JOIN LATERAL (
SELECT l.currency,
sum(l.approved_hours) FILTER (WHERE l.kind = 'reward') hours,
sum(l.fee_amount) FILTER (WHERE l.kind = 'reward') fee,
max(l.rate_percent) FILTER (WHERE l.kind = 'reward') rate,
min(l.rate_percent) FILTER (WHERE l.kind = 'reward') rate_lo,
sum(l.amount) FILTER (WHERE l.kind = 'reward') earned,
sum(l.amount) FILTER (WHERE l.kind = 'reversal') rev,
sum(l.amount) FILTER (WHERE l.status IN ('pending', 'held')) pend,
sum(l.amount) FILTER (WHERE l.status IN ('available', 'in_payout')) avail,
sum(l.amount) FILTER (WHERE l.status = 'paid') paid
FROM l WHERE l.ref_key = public.referral_ref_key(r.referrer_consultant_id, r.referred_consultant_id)
GROUP BY l.currency) x ON true
WHERE r.referrer_consultant_id = _cid AND r.status <> 'removed'
ORDER BY r.attributed_at DESC, 6;
END
$$;
REVOKE ALL ON FUNCTION public.referral_calc_referrals(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_calc_referrals(uuid, date, date, text) TO authenticated;
DROP FUNCTION IF EXISTS public.referral_calc_lines(uuid, text, date, date, text);
CREATE OR REPLACE FUNCTION public.referral_calc_lines(_consultant uuid DEFAULT NULL, _ref_key text DEFAULT NULL, _from date DEFAULT NULL,
_to date DEFAULT NULL, _status text DEFAULT NULL)
RETURNS TABLE (created_at timestamptz, ref_key text, referred_name text, kind text, status text, engagement_ref text, approved_hours numeric,
man_days numeric, fee_amount numeric, rate_percent numeric, tier_name text, amount numeric, currency text,
payment_status text, client_paid_at timestamptz, payout_status text, payout_released_at timestamptz,
referral_payout_due date, note text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT * FROM public.referral_lines_for(public.referral_calc_target(_consultant), NULLIF(_ref_key, ''), _from, _to, _status)
$$;
REVOKE ALL ON FUNCTION public.referral_calc_lines(uuid, text, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_calc_lines(uuid, text, date, date, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_calc_monthly(_consultant uuid DEFAULT NULL, _months int DEFAULT 12)
RETURNS TABLE (month date, currency text, earned numeric, paid numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_calc_target(_consultant);
_start date := (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') - make_interval(months => greatest(1, least(COALESCE(_months, 12), 36)) - 1))::date;
BEGIN
RETURN QUERY
WITH m AS (SELECT generate_series(_start, (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh'))::date, interval '1 month')::date AS month),
cur AS (SELECT DISTINCT l.currency FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = _cid
UNION SELECT 'USD' WHERE NOT EXISTS (SELECT 1 FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = _cid))
SELECT m.month, cur.currency,
COALESCE((SELECT sum(l.amount) FROM public.referral_reward_lines l
WHERE l.referrer_consultant_id = _cid AND l.currency = cur.currency AND l.status <> 'reversed'
AND date_trunc('month', l.created_at AT TIME ZONE 'Asia/Riyadh')::date = m.month), 0),
COALESCE((SELECT sum(l.amount) FROM public.referral_reward_lines l
WHERE l.referrer_consultant_id = _cid AND l.currency = cur.currency AND l.status = 'paid'
AND date_trunc('month', l.paid_at AT TIME ZONE 'Asia/Riyadh')::date = m.month), 0)
FROM m CROSS JOIN cur
ORDER BY 1, 2;
END
$$;
REVOKE ALL ON FUNCTION public.referral_calc_monthly(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_calc_monthly(uuid, int) TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_calc_forecast(_consultant uuid DEFAULT NULL)
RETURNS TABLE (currency text, timesheets int, approved_hours numeric, expected_fee numeric, expected_reward numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_calc_target(_consultant);
_rate numeric := (public.referral_tier_for(public.referral_verified_count(_cid)) ->> 'rate')::numeric;
BEGIN
RETURN QUERY
SELECT COALESCE(ts.cost_currency, 'USD'), count(*)::int, sum(ts.billable_hours), round(sum(ts.billable_hours * ts.hourly_rate), 2),
sum(round(round(ts.billable_hours * ts.hourly_rate, 2) * _rate / 100, 2))
FROM public.consultant_referrals r
JOIN public.consultants c ON c.id = r.referred_consultant_id
JOIN public.ticket_timesheet_submissions ts ON ts.submitted_by = c.user_id
WHERE r.referrer_consultant_id = _cid AND r.status = 'active' AND r.activation_status = 'active'
AND ts.status = 'signed' AND ts.billable_hours > 0 AND ts.hourly_rate > 0
AND COALESCE(ts.signed_at, ts.updated_at) >= r.activated_at
AND (r.window_ends_at IS NULL OR r.window_ends_at > now())
AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.timesheet_id = ts.id AND p.status::text IN ('completed', 'refunded'))
GROUP BY 1;
END
$$;
REVOKE ALL ON FUNCTION public.referral_calc_forecast(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_calc_forecast(uuid) TO authenticated;
CREATE TABLE IF NOT EXISTS public.referral_statements (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
period_month date NOT NULL,
generated_at timestamptz NOT NULL DEFAULT now(),
summary jsonb NOT NULL,
lines jsonb NOT NULL DEFAULT '[]'::jsonb,
UNIQUE (consultant_id, period_month)
);
GRANT SELECT ON public.referral_statements TO authenticated;
GRANT ALL ON public.referral_statements TO service_role;
ALTER TABLE public.referral_statements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own referral statements or admin" ON public.referral_statements;
CREATE POLICY "Own referral statements or admin" ON public.referral_statements
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE OR REPLACE FUNCTION public.referral_generate_statements(_month date DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_m date := COALESCE(date_trunc('month', _month)::date, (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') - interval '1 month')::date);
_end date := (_m + interval '1 month' - interval '1 day')::date;
x record;
_lines jsonb;
_sum jsonb;
_id uuid;
_n int := 0;
_user uuid;
BEGIN
FOR x IN SELECT DISTINCT referrer_consultant_id AS cid FROM public.consultant_referrals
UNION SELECT DISTINCT referrer_consultant_id FROM public.referral_reward_lines LOOP
SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO _lines FROM public.referral_lines_for(x.cid, NULL, _m, _end, NULL) t;
_sum := public.referral_summary_for(x.cid) || jsonb_build_object(
'month_net', COALESCE((SELECT jsonb_object_agg(c, a) FROM (
SELECT e ->> 'currency' c, sum(CASE WHEN e ->> 'status' = 'reversed' THEN 0 ELSE (e ->> 'amount')::numeric END) a
FROM jsonb_array_elements(_lines) e GROUP BY 1) q), '{}'::jsonb),
'month_lines', jsonb_array_length(_lines));
INSERT INTO public.referral_statements (consultant_id, period_month, summary, lines)
VALUES (x.cid, _m, _sum, _lines)
ON CONFLICT (consultant_id, period_month) DO NOTHING
RETURNING id INTO _id;
IF _id IS NOT NULL THEN
_n := _n + 1;
SELECT c.user_id INTO _user FROM public.consultants c WHERE c.id = x.cid;
PERFORM public.safe_insert_notification(_user, 'Your referral statement is ready',
format('Your referral statement for %s is ready in Refer & earn, Referral calculations.', to_char(_m, 'FMMonth YYYY')),
'referral', '/consultant/referrals?tab=calculations');
_id := NULL;
END IF;
END LOOP;
RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.referral_generate_statements(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_generate_statements(date) TO service_role;
CREATE OR REPLACE FUNCTION public.referral_calc_statements(_consultant uuid DEFAULT NULL)
RETURNS TABLE (id uuid, period_month date, generated_at timestamptz, summary jsonb, lines jsonb)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT s.id, s.period_month, s.generated_at, s.summary, s.lines FROM public.referral_statements s
WHERE s.consultant_id = public.referral_calc_target(_consultant)
ORDER BY s.period_month DESC LIMIT 36
$$;
REVOKE ALL ON FUNCTION public.referral_calc_statements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_calc_statements(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_reconcile_rows(_consultant uuid DEFAULT NULL, _only_problems boolean DEFAULT true)
RETURNS TABLE (consultant_id uuid, consultant_name text, check_name text, ok boolean, expected numeric, actual numeric, detail text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
RETURN QUERY
WITH c AS (
SELECT DISTINCT l.referrer_consultant_id AS cid FROM public.referral_reward_lines l WHERE _consultant IS NULL OR l.referrer_consultant_id = _consultant
UNION SELECT _consultant WHERE _consultant IS NOT NULL
), checks AS (
SELECT c.cid, 'reward_formula'::text AS chk,
(SELECT count(*) = 0 FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = c.cid AND l.kind = 'reward'
AND l.amount <> public.referral_money(l.fee_amount * l.rate_percent / 100)) AS ok,
(SELECT COALESCE(sum(public.referral_money(l.fee_amount * l.rate_percent / 100)), 0) FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = c.cid AND l.kind = 'reward') AS expected,
(SELECT COALESCE(sum(l.amount), 0) FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = c.cid AND l.kind = 'reward') AS actual,
'Each reward = fee x rate, rounded to 2 decimals (caps hold a line, they never change its amount)'::text AS detail
FROM c
UNION ALL
SELECT c.cid, 'reversal_mirror',
(SELECT count(*) = 0 FROM public.referral_reward_lines v JOIN public.referral_reward_lines o ON o.id = v.reverses_line_id
WHERE v.referrer_consultant_id = c.cid AND v.kind = 'reversal' AND v.amount <> -o.amount),
(SELECT COALESCE(-sum(o.amount), 0) FROM public.referral_reward_lines v JOIN public.referral_reward_lines o ON o.id = v.reverses_line_id
WHERE v.referrer_consultant_id = c.cid AND v.kind = 'reversal'),
(SELECT COALESCE(sum(v.amount), 0) FROM public.referral_reward_lines v WHERE v.referrer_consultant_id = c.cid AND v.kind = 'reversal'),
'Every reversal equals minus its reward'
FROM c
UNION ALL
SELECT c.cid, 'referral_payouts_equal_lines',
(SELECT count(*) = 0 FROM public.payouts p WHERE p.consultant_id = c.cid AND p.reference LIKE 'referral:%'
AND p.amount <> (SELECT COALESCE(sum(l.amount), 0) FROM public.referral_reward_lines l WHERE l.referral_payout_id = p.id)),
(SELECT COALESCE(sum(l.amount), 0) FROM public.referral_reward_lines l JOIN public.payouts p ON p.id = l.referral_payout_id WHERE p.consultant_id = c.cid),
(SELECT COALESCE(sum(p.amount), 0) FROM public.payouts p WHERE p.consultant_id = c.cid AND p.reference LIKE 'referral:%'),
'Each referral payout equals the lines grouped into it'
FROM c
UNION ALL
SELECT c.cid, 'paid_lines_equal_paid_payouts',
(SELECT COALESCE(sum(l.amount), 0) FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = c.cid AND l.status = 'paid')
= (SELECT COALESCE(sum(p.amount), 0) FROM public.payouts p WHERE p.consultant_id = c.cid AND p.reference LIKE 'referral:%' AND p.status::text = 'completed'),
(SELECT COALESCE(sum(p.amount), 0) FROM public.payouts p WHERE p.consultant_id = c.cid AND p.reference LIKE 'referral:%' AND p.status::text = 'completed'),
(SELECT COALESCE(sum(l.amount), 0) FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = c.cid AND l.status = 'paid'),
'Paid lines equal completed referral payouts'
FROM c
UNION ALL
SELECT c.cid, 'rate_within_tiers_cap',
(SELECT count(*) = 0 FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = c.cid AND l.kind = 'reward'
AND (l.rate_percent > (public.referral_settings() ->> 'max_rate')::numeric OR l.tier_name IS NULL)),
(public.referral_settings() ->> 'max_rate')::numeric,
(SELECT max(l.rate_percent) FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = c.cid AND l.kind = 'reward'),
'Every reward line stores its tier and a rate within the maximum'
FROM c
UNION ALL
SELECT c.cid, 'in_payout_lines_open_payouts',
(SELECT count(*) = 0 FROM public.referral_reward_lines l LEFT JOIN public.payouts p ON p.id = l.referral_payout_id
WHERE l.referrer_consultant_id = c.cid AND l.status = 'in_payout' AND (p.id IS NULL OR p.status::text IN ('completed', 'failed'))),
NULL::numeric, NULL::numeric, 'Lines in a payout belong to an open referral payout'
FROM c
UNION ALL
SELECT c.cid, 'available_after_hold',
(SELECT count(*) = 0 FROM public.referral_reward_lines l
WHERE l.referrer_consultant_id = c.cid AND l.kind = 'reward' AND l.status IN ('available', 'in_payout', 'paid')
AND (l.matures_at IS NULL OR l.available_at < l.matures_at)),
NULL::numeric, NULL::numeric, 'No reward became available before its hold period ended'
FROM c
UNION ALL
SELECT c.cid, 'one_reward_per_payout',
(SELECT count(*) = 0 FROM (SELECT l.source_payout_id FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = c.cid AND l.kind = 'reward'
AND l.source_payout_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d),
NULL::numeric, NULL::numeric, 'No payout produced two rewards'
FROM c
)
SELECT k.cid, p.display_name, k.chk, k.ok, k.expected, k.actual, k.detail
FROM checks k
LEFT JOIN public.consultants cc ON cc.id = k.cid
LEFT JOIN public.profiles p ON p.user_id = cc.user_id
WHERE NOT COALESCE(_only_problems, true) OR NOT k.ok
ORDER BY 2, 3
LIMIT 2000;
END
$$;
REVOKE ALL ON FUNCTION public.referral_reconcile_rows(uuid, boolean) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_reconcile(_consultant uuid DEFAULT NULL, _only_problems boolean DEFAULT true)
RETURNS TABLE (consultant_id uuid, consultant_name text, check_name text, ok boolean, expected numeric, actual numeric, detail text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN QUERY SELECT * FROM public.referral_reconcile_rows(_consultant, _only_problems);
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_reconcile(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_reconcile(uuid, boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_rate_history(_limit int DEFAULT 100)
RETURNS TABLE (changed_at timestamptz, changed_by text, old_tiers jsonb, new_tiers jsonb, old_max numeric, new_max numeric, reason text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN QUERY
SELECT e.created_at, p.display_name, e.before -> 'tiers', e.after -> 'tiers', (e.before ->> 'max_rate')::numeric, (e.after ->> 'max_rate')::numeric, e.reason
FROM public.referral_events e LEFT JOIN public.profiles p ON p.user_id = e.actor
WHERE e.action = 'settings_changed'
AND ((e.before -> 'tiers') IS DISTINCT FROM (e.after -> 'tiers') OR (e.before -> 'max_rate') IS DISTINCT FROM (e.after -> 'max_rate'))
ORDER BY e.created_at DESC
LIMIT greatest(1, least(COALESCE(_limit, 100), 500));
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_rate_history(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_rate_history(int) TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_backfill_preview()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT jsonb_build_object(
'consultants', count(*),
'eligible', count(*) FILTER (WHERE c.verification_status::text NOT IN ('rejected', 'suspended')),
'already_have_code', count(*) FILTER (WHERE k.consultant_id IS NOT NULL),
'will_create', count(*) FILTER (WHERE c.verification_status::text NOT IN ('rejected', 'suspended') AND k.consultant_id IS NULL),
'excluded_rejected_or_suspended', count(*) FILTER (WHERE c.verification_status::text IN ('rejected', 'suspended')))
FROM public.consultants c LEFT JOIN public.consultant_referral_codes k ON k.consultant_id = c.id
$$;
REVOKE ALL ON FUNCTION public.referral_backfill_preview() FROM PUBLIC, anon, authenticated;