REVOKE ALL ON FUNCTION public.referral_note_payer() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_referral_note_payer ON public.payments;
CREATE TRIGGER trg_referral_note_payer
AFTER INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.referral_note_payer();
CREATE OR REPLACE FUNCTION public.referral_on_payout_details_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_u uuid;
BEGIN
IF TG_OP = 'UPDATE' AND (NEW.iban, NEW.account_number, NEW.account_holder, NEW.bank_name)
IS NOT DISTINCT FROM (OLD.iban, OLD.account_number, OLD.account_holder, OLD.bank_name) THEN
RETURN NULL;
END IF;
SELECT user_id INTO _u FROM public.consultants WHERE id = NEW.consultant_id;
IF _u IS NULL THEN RETURN NULL; END IF;
IF TG_OP = 'UPDATE' THEN
PERFORM public.safe_insert_notification(_u, 'Your bank details were changed',
'Your payout bank details were changed. If this was not you, contact support immediately. For your safety, referral payouts wait '
|| (public.referral_settings() ->> 'payout_change_hold_days') || ' days after a change.', 'security', '/consultant/earnings');
INSERT INTO public.referral_email_queue (user_id, kind, days) VALUES (_u, 'payout_details_changed', (public.referral_settings() ->> 'payout_change_hold_days')::int);
END IF;
PERFORM public.referral_log(auth.uid(), 'payout_details_changed', NEW.consultant_id, NULL, NULL, NULL, NULL, NULL, TG_OP);
RETURN NULL;
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'payout details notice skipped: %', SQLERRM;
RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.referral_on_payout_details_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_referral_on_payout_details_change ON public.consultant_payout_details;
CREATE TRIGGER trg_referral_on_payout_details_change
AFTER INSERT OR UPDATE ON public.consultant_payout_details
FOR EACH ROW EXECUTE FUNCTION public.referral_on_payout_details_change();
CREATE OR REPLACE FUNCTION public.referral_referrer_payable(_cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _cid AND c.verification_status::text = 'verified')
AND NOT public.referral_consultant_suspended(_cid)
AND EXISTS (SELECT 1 FROM public.consultant_payout_details d
WHERE d.consultant_id = _cid AND d.verified_at IS NOT NULL
AND greatest(d.verified_at, COALESCE(d.updated_at, d.created_at), d.created_at)
<= now() - make_interval(days => public.referral_setting_num('payout_details_change_hold_days', 7, 0, 60)::int))
$$;
REVOKE ALL ON FUNCTION public.referral_referrer_payable(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_bundle_payouts(_actor uuid DEFAULT NULL)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
g record;
s jsonb := public.referral_settings();
_min numeric := greatest((s->>'min_payout')::numeric, 0.01);
_ids uuid[];
_total numeric;
_po uuid;
_n int := 0;
_admin record;
BEGIN
PERFORM pg_advisory_xact_lock(hashtext('referral_bundle_payouts'));
FOR g IN
SELECT l.referrer_consultant_id AS cid, l.currency
FROM public.referral_reward_lines l
WHERE l.status = 'available'
GROUP BY 1, 2
HAVING sum(l.amount) >= _min
LOOP
IF NOT public.referral_referrer_payable(g.cid) THEN CONTINUE; END IF;
SELECT array_agg(x.id), sum(x.amount) INTO _ids, _total FROM (
SELECT l.id, l.amount FROM public.referral_reward_lines l
WHERE l.referrer_consultant_id = g.cid AND l.currency = g.currency AND l.status = 'available'
FOR UPDATE) x;
IF _total IS NULL OR _total < _min THEN CONTINUE; END IF;
INSERT INTO public.payouts (consultant_id, amount, currency, status, reference, gross_amount, commission_percent, commission_amount, note)
VALUES (g.cid, public.referral_money(_total), g.currency, 'pending', 'referral:' || gen_random_uuid()::text, public.referral_money(_total), 0, 0, 'Referral reward')
RETURNING id INTO _po;
UPDATE public.referral_reward_lines SET status = 'in_payout', referral_payout_id = _po, updated_at = now() WHERE id = ANY (_ids);
PERFORM public.referral_log(_actor, 'referral_payout_created', g.cid, NULL, NULL, _po, NULL,
jsonb_build_object('amount', round(_total, 2), 'currency', g.currency, 'lines', cardinality(_ids)), NULL);
FOR _admin IN SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin') LOOP
PERFORM public.safe_insert_notification(_admin.user_id, 'Referral payout to review',
'A referral reward payout of ' || to_char(round(_total, 2), 'FM999999990.00') || ' ' || g.currency || ' is ready in Payments, Payouts.', 'payment', '/admin/payments');
END LOOP;
_n := _n + 1;
END LOOP;
RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.referral_bundle_payouts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_bundle_payouts(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.referral_weekly_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_signups int; _verified int; _review int; _money text;
BEGIN
SELECT count(*) INTO _signups FROM public.consultant_referrals WHERE attributed_at > now() - interval '7 days';
SELECT count(*) INTO _verified FROM public.consultant_referrals WHERE verified_notified_at > now() - interval '7 days';
SELECT count(*) INTO _review FROM public.consultant_referrals WHERE status IN ('review', 'held');
SELECT string_agg(format('%s %s pending, %s available, %s paid this week', currency, to_char(p, 'FM999999990.00'), to_char(a, 'FM999999990.00'), to_char(w, 'FM999999990.00')), '; ')
INTO _money
FROM (SELECT currency,
COALESCE(sum(amount) FILTER (WHERE status = 'pending'), 0) p,
COALESCE(sum(amount) FILTER (WHERE status = 'available'), 0) a,
COALESCE(sum(amount) FILTER (WHERE status = 'paid' AND paid_at > now() - interval '7 days'), 0) w
FROM public.referral_reward_lines GROUP BY currency) t;
INSERT INTO public.notifications (user_id, title, body, type, link)
SELECT DISTINCT ur.user_id, 'Weekly referral summary',
format('%s new referral sign-up(s), %s referred consultant(s) verified this week, %s referral(s) waiting for review. Rewards: %s.',
_signups, _verified, _review, COALESCE(_money, 'none yet')),
'admin_digest', '/admin/referrals'
FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin');
END
$$;
REVOKE ALL ON FUNCTION public.referral_weekly_digest() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_nightly()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_n int;
_m int;
_bad int;
_keep int := (public.referral_settings() ->> 'retention_days')::int;
_sw jsonb;
BEGIN
_sw := public.referral_activation_sweep();
PERFORM public.referral_create_reward(po.id)
FROM public.payouts po JOIN public.consultant_referrals r ON r.referred_consultant_id = po.consultant_id
WHERE po.status::text = 'completed' AND COALESCE(po.reference, '') NOT LIKE 'referral:%' AND po.updated_at > now() - interval '90 days'
AND NOT EXISTS (SELECT 1 FROM public.referral_reward_lines l WHERE l.source_payout_id = po.id AND l.kind = 'reward');
_m := public.referral_mature_lines(now());
_n := public.referral_bundle_payouts(NULL);
UPDATE public.referral_adjust_requests SET status = 'expired' WHERE status = 'pending' AND expires_at <= now();
DELETE FROM public.referral_devices WHERE last_seen_at < now() - make_interval(days => _keep);
DELETE FROM public.referral_party_signals WHERE last_seen_at < now() - make_interval(days => _keep);
DELETE FROM public.referral_attribution_signals WHERE created_at < now() - make_interval(days => _keep);
DELETE FROM public.referral_code_attempts WHERE window_start < now() - interval '2 days' AND (locked_until IS NULL OR locked_until < now());
UPDATE public.referral_acknowledgements SET ip_hash = NULL, user_agent = NULL
WHERE accepted_at < now() - make_interval(days => _keep) AND (ip_hash IS NOT NULL OR user_agent IS NOT NULL);
_bad := public.referral_daily_reconcile();
PERFORM public.referral_wake();
RETURN jsonb_build_object('referral_payouts', _n, 'matured', _m, 'reconcile_problems', _bad) || _sw;
END
$$;
REVOKE ALL ON FUNCTION public.referral_nightly() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_nightly() TO service_role;
CREATE OR REPLACE FUNCTION public.referral_validate_code(_code text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_ip text := public.referral_hash(public.referral_request_ip());
_who text[] := array_remove(ARRAY[CASE WHEN _ip IS NOT NULL THEN 'ip:' || _ip END,
CASE WHEN auth.uid() IS NOT NULL THEN 'u:' || auth.uid()::text END], NULL);
_referrer uuid;
BEGIN
IF cardinality(_who) = 0 THEN _who := ARRAY['anon']; END IF;
IF EXISTS (SELECT 1 FROM unnest(_who) w WHERE NOT public.check_rate_limit('refval:' || w, 30, 600)) OR public.referral_code_locked(_who) THEN
RAISE EXCEPTION 'Too many code checks. Please wait a few minutes and try again.' USING ERRCODE = 'P0001';
END IF;
IF NOT COALESCE((public.referral_settings() ->> 'enabled')::boolean, false) THEN
RETURN jsonb_build_object('valid', false);
END IF;
IF public.referral_norm_code(_code) IS NOT NULL AND length(replace(public.referral_norm_code(_code), '-', '')) >= 7 THEN
_referrer := public.referral_find_code(_code);
END IF;
IF _referrer IS NULL THEN
PERFORM public.referral_code_failed(_who);
RETURN jsonb_build_object('valid', false);
END IF;
RETURN jsonb_build_object('valid', true, 'name', public.referral_masked_name(_referrer));
END
$$;
REVOKE ALL ON FUNCTION public.referral_validate_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_validate_code(text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_track_click(_code text)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_who text := COALESCE(public.referral_hash(public.referral_request_ip()), 'u:' || COALESCE(auth.uid()::text, 'anon'));
_referrer uuid;
BEGIN
IF public.referral_norm_code(_code) IS NULL THEN RETURN; END IF;
IF NOT public.check_rate_limit('refclickip:' || _who, 60, 3600) THEN RETURN; END IF;
_referrer := public.referral_find_code(_code);
IF _referrer IS NULL THEN RETURN; END IF;
IF NOT public.check_rate_limit('refclick:' || _who || ':' || _referrer::text, 1, 43200) THEN RETURN; END IF;
INSERT INTO public.referral_clicks (consultant_id, day, clicks) VALUES (_referrer, (now() AT TIME ZONE 'Asia/Riyadh')::date, 1)
ON CONFLICT (consultant_id, day) DO UPDATE SET clicks = public.referral_clicks.clicks + 1;
END
$$;
REVOKE ALL ON FUNCTION public.referral_track_click(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_track_click(text) TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_can_claim(_cid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
s jsonb := public.referral_settings();
_created timestamptz;
_launch timestamptz := (s ->> 'launch_at')::timestamptz;
_until timestamptz := (s ->> 'claim_until')::timestamptz;
BEGIN
IF _cid IS NULL OR EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id = _cid) THEN RETURN false; END IF;
IF EXISTS (SELECT 1 FROM public.payouts p WHERE p.consultant_id = _cid) THEN RETURN false; END IF;
SELECT u.created_at INTO _created FROM public.consultants c JOIN auth.users u ON u.id = c.user_id WHERE c.id = _cid;
IF _created IS NULL THEN RETURN false; END IF;
IF _created >= now() - make_interval(days => (s ->> 'claim_days')::int) AND (_launch IS NULL OR _created >= _launch) THEN RETURN true; END IF;
RETURN _launch IS NOT NULL AND _created < _launch AND _until IS NOT NULL AND now() <= _until;
END
$$;
REVOKE ALL ON FUNCTION public.referral_can_claim(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_claim(_code text, _device text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
_created timestamptz;
_res text;
_referrer uuid;
BEGIN
IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants can use a referral code' USING ERRCODE = '42501'; END IF;
IF NOT public.check_rate_limit('refclaim:' || auth.uid()::text, 10, 3600)
OR public.referral_code_locked(ARRAY['u:' || auth.uid()::text, 'ip:' || COALESCE(public.referral_hash(public.referral_request_ip()), '-')]) THEN
RAISE EXCEPTION 'Too many attempts. Please try again later.' USING ERRCODE = 'P0001';
END IF;
IF EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id = _cid) THEN
RETURN jsonb_build_object('result', 'already');
END IF;
IF NOT public.referral_can_claim(_cid) THEN
RETURN jsonb_build_object('result', 'too_late');
END IF;
_res := public.referral_attribute(_cid, _code, 'claim', _device, public.referral_request_ip());
IF _res = 'invalid' THEN
PERFORM public.referral_code_failed(array_remove(ARRAY['u:' || auth.uid()::text,
'ip:' || public.referral_hash(public.referral_request_ip())], NULL));
END IF;
IF _res = 'ok' THEN
SELECT referrer_consultant_id INTO _referrer FROM public.consultant_referrals WHERE referred_consultant_id = _cid;
RETURN jsonb_build_object('result', 'ok', 'name', public.referral_masked_name(_referrer));
END IF;
RETURN jsonb_build_object('result', _res);
END
$$;
REVOKE ALL ON FUNCTION public.referral_claim(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_claim(text, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.my_referral_overview(_device text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
s jsonb := public.referral_settings();
x record;
_code text;
BEGIN
IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants can open the referral programme' USING ERRCODE = '42501'; END IF;
_code := public.referral_ensure_code(_cid);
PERFORM public.referral_note_device(_cid, _device, public.referral_request_ip());
SELECT * INTO x FROM public.consultant_referral_codes WHERE consultant_id = _cid;
RETURN jsonb_build_object(
'settings', jsonb_build_object('enabled', s->'enabled', 'rate_percent', s->'rate_percent', 'months', s->'months',
'min_payout', s->'min_payout', 'terms_version', s->'terms_version', 'pass_mark', s->'pass_mark',
'activation_days', s->'activation_days', 'tiers', s->'tiers', 'hold_days', s->'hold_days',
'min_invoice', s->'min_invoice', 'monthly_cap', s->'monthly_cap', 'monthly_cap_referred', s->'monthly_cap_referred',
'max_per_referred', s->'max_per_referred', 'payout_change_hold_days', s->'payout_change_hold_days',
'tier_requires_paid', s->'tier_requires_paid', 'tier_paid_days', s->'tier_paid_days', 'rules_texts', s->'rules_texts',
'terms_published_at', (SELECT v.published_at FROM public.referral_terms_versions v WHERE v.version = (s->>'terms_version')::int)),
'sim_defaults', jsonb_build_object(
'own_rate', (SELECT c.hourly_rate FROM public.consultants c WHERE c.id = _cid),
'platform_rate', (SELECT CASE WHEN count(*) >= 5 THEN round(avg(ts.hourly_rate), 0) END FROM public.ticket_timesheet_submissions ts
WHERE ts.status = 'signed' AND ts.hourly_rate > 0 AND ts.updated_at > now() - interval '12 months')),
'tier', public.referral_tier_for(public.referral_verified_count(_cid)),
'activation', jsonb_build_object(
'pass_mark', s->'pass_mark',
'interview_passed', public.referral_passed_at(_cid) IS NOT NULL,
'interview_passed_at', public.referral_passed_at(_cid),
'best_score', public.referral_best_score(_cid),
'acknowledged', public.referral_acked_at(_cid) IS NOT NULL,
'active', public.referral_passed_at(_cid) IS NOT NULL AND public.referral_acked_at(_cid) IS NOT NULL),
'code', _code,
'previous_code', x.previous_code,
'edits_left', greatest(0, 1 - COALESCE(x.edits_used, 0)),
'disabled', x.disabled_at IS NOT NULL,
'terms_accepted_version', (SELECT max(a.version) FROM public.referral_acknowledgements a WHERE a.consultant_id = _cid),
'funnel', jsonb_build_object(
'clicks', (SELECT COALESCE(sum(c.clicks), 0) FROM public.referral_clicks c WHERE c.consultant_id = _cid),
'signups', (SELECT count(*) FROM public.consultant_referrals r WHERE r.referrer_consultant_id = _cid AND r.status <> 'removed'),
'verified', (SELECT count(*) FROM public.consultant_referrals r JOIN public.consultants c ON c.id = r.referred_consultant_id
WHERE r.referrer_consultant_id = _cid AND r.status <> 'removed' AND c.verification_status::text = 'verified'),
'paying', (SELECT count(*) FROM public.consultant_referrals r WHERE r.referrer_consultant_id = _cid AND r.status <> 'removed' AND r.first_paid_at IS NOT NULL)),
'earnings', COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', currency, 'pending', p, 'available', a, 'held', h,
'in_payout', i, 'paid', d, 'lifetime', t) ORDER BY currency)
FROM (SELECT l.currency,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'pending'), 0) p,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'available'), 0) a,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'held'), 0) h,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'in_payout'), 0) i,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'paid'), 0) d,
COALESCE(sum(l.amount) FILTER (WHERE l.status <> 'reversed'), 0) t
FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = _cid GROUP BY l.currency) e), '[]'::jsonb),
'claim', jsonb_build_object('can_claim', public.referral_can_claim(_cid),
'until', CASE WHEN (SELECT u.created_at FROM auth.users u WHERE u.id = auth.uid()) < (s ->> 'launch_at')::timestamptz
THEN (s ->> 'claim_until')::timestamptz
ELSE (SELECT u.created_at FROM auth.users u WHERE u.id = auth.uid()) + make_interval(days => (s ->> 'claim_days')::int) END),
'eligibility', jsonb_build_object(
'verified', EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _cid AND c.verification_status::text = 'verified'),
'policy', public.referral_policy_ok(_cid),
'suspended', public.referral_consultant_suspended(_cid),
'payout_details', EXISTS (SELECT 1 FROM public.consultant_payout_details d WHERE d.consultant_id = _cid),
'profile_submitted', EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _cid AND c.profile_submitted_at IS NOT NULL)));
END
$$;
REVOKE ALL ON FUNCTION public.my_referral_overview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_overview(text) TO authenticated;
DROP FUNCTION IF EXISTS public.my_referrals();
CREATE OR REPLACE FUNCTION public.my_referrals()
RETURNS TABLE (referred_name text, status text, attributed_at timestamptz, verified boolean, first_paid_at timestamptz,
window_ends_at timestamptz, earned jsonb, activation_status text, chip text, my_next text, their_next text,
activated_at timestamptz, activation_expires_at timestamptz, they_passed boolean, they_acknowledged boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
BEGIN
IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants can open the referral programme' USING ERRCODE = '42501'; END IF;
RETURN QUERY
SELECT public.referral_masked_name(r.referred_consultant_id),
CASE WHEN r.status IN ('review', 'held') THEN 'on_review'
WHEN r.window_ends_at IS NOT NULL AND r.window_ends_at <= now() THEN 'ended'
WHEN r.first_paid_at IS NOT NULL THEN 'paying'
WHEN c.verification_status::text = 'verified' THEN 'verified'
ELSE 'signed_up' END,
r.attributed_at, c.verification_status::text = 'verified', r.first_paid_at, r.window_ends_at,
COALESCE((SELECT jsonb_object_agg(e.currency, e.total) FROM (
SELECT l.currency, sum(l.amount) total FROM public.referral_reward_lines l
WHERE l.referrer_consultant_id = _cid AND l.referred_consultant_id = r.referred_consultant_id AND l.status <> 'reversed'
GROUP BY l.currency) e), '{}'::jsonb),
r.activation_status, public.referral_chip(r.referred_consultant_id, _cid),
public.referral_next_step(r.referred_consultant_id, _cid), public.referral_next_step(r.referred_consultant_id, r.referred_consultant_id),
r.activated_at, r.activation_expires_at,
public.referral_passed_at(r.referred_consultant_id) IS NOT NULL, public.referral_acked_at(r.referred_consultant_id) IS NOT NULL
FROM public.consultant_referrals r
JOIN public.consultants c ON c.id = r.referred_consultant_id
WHERE r.referrer_consultant_id = _cid AND r.status <> 'removed'
ORDER BY r.attributed_at DESC
LIMIT 500;
END
$$;
REVOKE ALL ON FUNCTION public.my_referrals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referrals() TO authenticated;
CREATE OR REPLACE FUNCTION public.my_referral_invite()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
r record;
s jsonb := public.referral_settings();
BEGIN
IF _cid IS NULL THEN RETURN NULL; END IF;
SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = _cid AND status <> 'removed';
IF NOT FOUND THEN RETURN NULL; END IF;
RETURN jsonb_build_object(
'referrer_name', public.referral_masked_name(r.referrer_consultant_id),
'activation_status', r.activation_status,
'chip', public.referral_chip(_cid, _cid),
'my_next', public.referral_next_step(_cid, _cid),
'their_next', public.referral_next_step(_cid, r.referrer_consultant_id),
'attributed_at', r.attributed_at,
'activation_expires_at', r.activation_expires_at,
'activated_at', r.activated_at,
'i_passed_at', public.referral_passed_at(_cid),
'they_passed', public.referral_passed_at(r.referrer_consultant_id) IS NOT NULL,
'i_acknowledged_at', public.referral_acked_at(_cid),
'they_acknowledged', public.referral_acked_at(r.referrer_consultant_id) IS NOT NULL,
'pass_mark', s->'pass_mark', 'rate_percent', s->'rate_percent', 'tiers', s->'tiers', 'months', s->'months', 'terms_version', s->'terms_version');
END
$$;
REVOKE ALL ON FUNCTION public.my_referral_invite() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_invite() TO authenticated;
CREATE OR REPLACE FUNCTION public.my_referral_history(_limit int DEFAULT 200)
RETURNS TABLE (created_at timestamptz, kind text, status text, amount numeric, currency text, fee_amount numeric, rate_percent numeric,
referred_name text, note text, available_at timestamptz, paid_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
BEGIN
IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants can open the referral programme' USING ERRCODE = '42501'; END IF;
RETURN QUERY
SELECT l.created_at, l.kind, l.status, l.amount, l.currency, l.fee_amount, l.rate_percent,
public.referral_masked_name(l.referred_consultant_id), l.note, l.available_at, l.paid_at
FROM public.referral_reward_lines l
WHERE l.referrer_consultant_id = _cid
ORDER BY l.created_at DESC
LIMIT greatest(1, least(COALESCE(_limit, 200), 1000));
END
$$;
REVOKE ALL ON FUNCTION public.my_referral_history(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_history(int) TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_accept_terms(_version int, _source text DEFAULT 'page', _language text DEFAULT 'en', _user_agent text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
_v int := (public.referral_settings() ->> 'terms_version')::int;
_is_referred boolean;
_is_referrer boolean;
BEGIN
IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants can accept the referral terms' USING ERRCODE = '42501'; END IF;
IF _version IS DISTINCT FROM _v THEN RAISE EXCEPTION 'The terms changed. Please reload the page.' USING ERRCODE = '22023'; END IF;
IF NOT public.check_rate_limit('refack:' || auth.uid()::text, 10, 3600) THEN
RAISE EXCEPTION 'Too many attempts. Please try again later.' USING ERRCODE = 'P0001';
END IF;
IF public.referral_acked_at(_cid) IS NOT NULL THEN RETURN; END IF;
_is_referred := EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id = _cid);
_is_referrer := _source IN ('page', 'share') OR EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referrer_consultant_id = _cid);
INSERT INTO public.referral_acknowledgements (consultant_id, user_id, version, role, source, language, user_agent, ip_hash)
VALUES (_cid, auth.uid(), _v,
CASE WHEN _is_referred AND _is_referrer THEN 'both' WHEN _is_referred THEN 'referred' ELSE 'referrer' END,
CASE WHEN _source IN ('page', 'share', 'signup', 'popup') THEN _source ELSE 'page' END,
CASE WHEN _language = 'ar' THEN 'ar' ELSE 'en' END, left(_user_agent, 300), public.referral_hash(public.referral_request_ip()));
PERFORM public.referral_log(auth.uid(), 'terms_accepted', _cid, NULL, NULL, NULL, NULL, jsonb_build_object('version', _v, 'source', _source), NULL);
END
$$;
REVOKE ALL ON FUNCTION public.referral_accept_terms(int, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_accept_terms(int, text, text, text) TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_update_code(_code text)
RETURNS text
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
_c text := public.referral_norm_code(_code);
x record;
BEGIN
IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants have a referral code' USING ERRCODE = '42501'; END IF;
IF NOT public.check_rate_limit('refcode:' || auth.uid()::text, 5, 3600) THEN
RAISE EXCEPTION 'Too many attempts. Please try again later.' USING ERRCODE = 'P0001';
END IF;
PERFORM public.referral_ensure_code(_cid);
SELECT * INTO x FROM public.consultant_referral_codes WHERE consultant_id = _cid FOR UPDATE;
IF x.edits_used >= 1 THEN RAISE EXCEPTION 'You have already changed your code once.' USING ERRCODE = '42501'; END IF;
IF x.disabled_at IS NOT NULL THEN RAISE EXCEPTION 'Your code is switched off. Please contact support.' USING ERRCODE = '42501'; END IF;
IF _c IS NULL OR _c !~ '^[A-Z0-9]{2,12}(-[A-Z0-9]{1,12}){0,3}$' OR length(_c) NOT BETWEEN 7 AND 32 OR length(replace(_c, '-', '')) < 7 THEN
RAISE EXCEPTION 'Use at least 7 letters and numbers (up to 32 characters), groups separated by a dash (for example SAP-MOSTAFA-7K2M9QX).' USING ERRCODE = '22023';
END IF;
IF public.referral_code_blocked_word(_c) THEN RAISE EXCEPTION 'Please choose another code.' USING ERRCODE = '22023'; END IF;
IF upper(x.code) = _c THEN RETURN x.code; END IF;
IF public.referral_code_taken(_c, _cid) THEN RAISE EXCEPTION 'This code is already taken.' USING ERRCODE = '23505'; END IF;
UPDATE public.consultant_referral_codes SET previous_code = code, code = _c, edits_used = edits_used + 1, updated_at = now() WHERE consultant_id = _cid;
PERFORM public.referral_log(auth.uid(), 'code_changed', _cid, NULL, NULL, NULL, jsonb_build_object('code', x.code), jsonb_build_object('code', _c), NULL);
RETURN _c;
END
$$;
REVOKE ALL ON FUNCTION public.referral_update_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_update_code(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN jsonb_build_object(
'settings', public.referral_settings(),
'referrers', (SELECT count(DISTINCT referrer_consultant_id) FROM public.consultant_referrals WHERE status <> 'removed'),
'referred', (SELECT count(*) FROM public.consultant_referrals WHERE status <> 'removed'),
'verified', (SELECT count(*) FROM public.consultant_referrals r JOIN public.consultants c ON c.id = r.referred_consultant_id
WHERE r.status <> 'removed' AND c.verification_status::text = 'verified'),
'paying', (SELECT count(*) FROM public.consultant_referrals WHERE status <> 'removed' AND first_paid_at IS NOT NULL),
'review', (SELECT count(*) FROM public.consultant_referrals WHERE status IN ('review', 'held')),
'tier_distribution', COALESCE((SELECT jsonb_object_agg(n, c) FROM (
SELECT public.referral_tier_for(public.referral_verified_count(x.rid)) ->> 'name' AS n, count(*) AS c
FROM (SELECT DISTINCT referrer_consultant_id AS rid FROM public.consultant_referrals WHERE status <> 'removed') x
GROUP BY 1) d), '{}'::jsonb),
'pending_activation', (SELECT count(*) FROM public.consultant_referrals WHERE status <> 'removed' AND activation_status = 'pending'),
'active_pairs', (SELECT count(*) FROM public.consultant_referrals WHERE status <> 'removed' AND activation_status = 'active'),
'expired', (SELECT count(*) FROM public.consultant_referrals WHERE status <> 'removed' AND activation_status = 'expired'),
'money', COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', currency, 'pending', p, 'available', a, 'held', h, 'in_payout', i,
'paid', d, 'this_month', m) ORDER BY currency)
FROM (SELECT l.currency,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'pending'), 0) p,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'available'), 0) a,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'held'), 0) h,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'in_payout'), 0) i,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'paid'), 0) d,
COALESCE(sum(l.amount) FILTER (WHERE l.status <> 'reversed'
AND l.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh')), 0) m
FROM public.referral_reward_lines l GROUP BY l.currency) t), '[]'::jsonb));
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_overview() TO authenticated;
DROP FUNCTION IF EXISTS public.admin_referral_referrals(text, text, int, int);