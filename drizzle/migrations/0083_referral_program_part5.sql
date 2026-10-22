CREATE OR REPLACE FUNCTION public.admin_referral_referrals(_search text DEFAULT NULL, _filter text DEFAULT 'all', _limit int DEFAULT 200, _offset int DEFAULT 0)
RETURNS TABLE (referred_id uuid, referred_name text, referred_public text, referrer_id uuid, referrer_name text, code text, source text,
attributed_at timestamptz, status text, flags text[], signals text[], verified boolean, first_paid_at timestamptz,
window_ends_at timestamptz, earned jsonb, approved_at timestamptz, activation_status text, activated_at timestamptz,
activation_expires_at timestamptz, referrer_passed boolean, referred_passed boolean, referrer_acknowledged boolean,
referred_acknowledged boolean, referrer_best_score numeric, referred_best_score numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_q text := NULLIF(lower(btrim(COALESCE(_search, ''))), '');
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN QUERY
WITH base AS (
SELECT r.*, sig.ip_hash, pd.display_name AS dname, pr.display_name AS rname, c.verification_status::text = 'verified' AS is_verified,
lower(split_part(ud.email, '@', 2)) AS dom
FROM public.consultant_referrals r
LEFT JOIN public.referral_attribution_signals sig ON sig.referred_consultant_id = r.referred_consultant_id
JOIN public.consultants c ON c.id = r.referred_consultant_id
JOIN public.consultants cr ON cr.id = r.referrer_consultant_id
LEFT JOIN public.profiles pd ON pd.user_id = c.user_id
LEFT JOIN public.profiles pr ON pr.user_id = cr.user_id
LEFT JOIN auth.users ud ON ud.id = c.user_id
)
SELECT b.referred_consultant_id, b.dname, public.referral_masked_name(b.referred_consultant_id), b.referrer_consultant_id, b.rname,
b.code, b.source, b.attributed_at, b.status, b.flags,
array_remove(ARRAY[
CASE WHEN b.ip_hash IS NOT NULL AND (SELECT count(*) FROM base y WHERE y.referrer_consultant_id = b.referrer_consultant_id AND y.ip_hash = b.ip_hash) >= 3 THEN 'many_from_same_ip' END,
CASE WHEN b.dom IS NOT NULL AND NOT public.referral_free_domain(b.dom)
AND (SELECT count(*) FROM base y WHERE y.referrer_consultant_id = b.referrer_consultant_id AND y.dom = b.dom) >= 3 THEN 'many_from_same_email_domain' END
], NULL),
b.is_verified, b.first_paid_at, b.window_ends_at,
COALESCE((SELECT jsonb_object_agg(e.currency, e.total) FROM (
SELECT l.currency, sum(l.amount) total FROM public.referral_reward_lines l
WHERE l.referred_consultant_id = b.referred_consultant_id AND l.status <> 'reversed' GROUP BY l.currency) e), '{}'::jsonb),
b.approved_at, b.activation_status, b.activated_at, b.activation_expires_at,
public.referral_passed_at(b.referrer_consultant_id) IS NOT NULL, public.referral_passed_at(b.referred_consultant_id) IS NOT NULL,
public.referral_acked_at(b.referrer_consultant_id) IS NOT NULL, public.referral_acked_at(b.referred_consultant_id) IS NOT NULL,
public.referral_best_score(b.referrer_consultant_id), public.referral_best_score(b.referred_consultant_id)
FROM base b
WHERE (_q IS NULL OR lower(COALESCE(b.dname, '')) LIKE '%' || _q || '%' OR lower(COALESCE(b.rname, '')) LIKE '%' || _q || '%' OR lower(b.code) LIKE '%' || _q || '%')
AND (COALESCE(_filter, 'all') = 'all'
OR (_filter = 'flagged' AND (cardinality(b.flags) > 0 OR b.status = 'review'))
OR (_filter = 'held' AND b.status IN ('held', 'review'))
OR (_filter = 'paying' AND b.first_paid_at IS NOT NULL)
OR (_filter = 'removed' AND b.status = 'removed')
OR (_filter = 'pending_activation' AND b.activation_status = 'pending' AND b.status <> 'removed')
OR (_filter = 'active_pairs' AND b.activation_status = 'active' AND b.status <> 'removed')
OR (_filter = 'expired' AND b.activation_status = 'expired'))
ORDER BY b.attributed_at DESC
LIMIT greatest(1, least(COALESCE(_limit, 200), 1000)) OFFSET greatest(0, COALESCE(_offset, 0));
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_referrals(text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_referrals(text, text, int, int) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_referrers(_search text DEFAULT NULL, _limit int DEFAULT 200)
RETURNS TABLE (referrer_id uuid, referrer_name text, code text, disabled boolean, referred int, verified int, paying int, money jsonb,
last_referral_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_q text := NULLIF(lower(btrim(COALESCE(_search, ''))), '');
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN QUERY
SELECT k.consultant_id, p.display_name, k.code, k.disabled_at IS NOT NULL,
(SELECT count(*)::int FROM public.consultant_referrals r WHERE r.referrer_consultant_id = k.consultant_id AND r.status <> 'removed'),
(SELECT count(*)::int FROM public.consultant_referrals r JOIN public.consultants c2 ON c2.id = r.referred_consultant_id
WHERE r.referrer_consultant_id = k.consultant_id AND r.status <> 'removed' AND c2.verification_status::text = 'verified'),
(SELECT count(*)::int FROM public.consultant_referrals r WHERE r.referrer_consultant_id = k.consultant_id AND r.status <> 'removed' AND r.first_paid_at IS NOT NULL),
COALESCE((SELECT jsonb_object_agg(t.currency, jsonb_build_object('pending', t.p, 'available', t.a, 'paid', t.d)) FROM (
SELECT l.currency,
COALESCE(sum(l.amount) FILTER (WHERE l.status IN ('pending', 'held')), 0) p,
COALESCE(sum(l.amount) FILTER (WHERE l.status IN ('available', 'in_payout')), 0) a,
COALESCE(sum(l.amount) FILTER (WHERE l.status = 'paid'), 0) d
FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = k.consultant_id GROUP BY l.currency) t), '{}'::jsonb),
(SELECT max(r.attributed_at) FROM public.consultant_referrals r WHERE r.referrer_consultant_id = k.consultant_id)
FROM public.consultant_referral_codes k
JOIN public.consultants c ON c.id = k.consultant_id
LEFT JOIN public.profiles p ON p.user_id = c.user_id
WHERE (EXISTS (SELECT 1 FROM public.consultant_referrals r WHERE r.referrer_consultant_id = k.consultant_id) OR k.disabled_at IS NOT NULL OR _q IS NOT NULL)
AND (_q IS NULL OR lower(COALESCE(p.display_name, '')) LIKE '%' || _q || '%' OR lower(k.code) LIKE '%' || _q || '%')
ORDER BY 9 DESC NULLS LAST
LIMIT greatest(1, least(COALESCE(_limit, 200), 1000));
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_referrers(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_referrers(text, int) TO authenticated;
DROP FUNCTION IF EXISTS public.admin_referral_lines(text, int, int);
CREATE OR REPLACE FUNCTION public.admin_referral_lines(_status text DEFAULT NULL, _limit int DEFAULT 300, _offset int DEFAULT 0)
RETURNS TABLE (id uuid, created_at timestamptz, kind text, status text, hold_reason text, amount numeric, currency text, fee_amount numeric,
rate_percent numeric, tier_name text, tier_count int, flags text[], matures_at timestamptz, referrer_id uuid, referrer_name text, referred_id uuid, referred_name text, source_payout_id uuid,
payment_id uuid, referral_payout_id uuid, note text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN QUERY
SELECT l.id, l.created_at, l.kind, l.status, l.hold_reason, l.amount, l.currency, l.fee_amount, l.rate_percent, l.tier_name, l.tier_count,
l.flags, l.matures_at, l.referrer_consultant_id, pr.display_name, l.referred_consultant_id, pd.display_name, l.source_payout_id, l.payment_id,
l.referral_payout_id, l.note
FROM public.referral_reward_lines l
LEFT JOIN public.consultants cr ON cr.id = l.referrer_consultant_id
LEFT JOIN public.profiles pr ON pr.user_id = cr.user_id
LEFT JOIN public.consultants cd ON cd.id = l.referred_consultant_id
LEFT JOIN public.profiles pd ON pd.user_id = cd.user_id
WHERE _status IS NULL OR l.status = _status
ORDER BY l.created_at DESC
LIMIT greatest(1, least(COALESCE(_limit, 300), 2000)) OFFSET greatest(0, COALESCE(_offset, 0));
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_lines(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_lines(text, int, int) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_events(_limit int DEFAULT 200)
RETURNS TABLE (created_at timestamptz, action text, actor_name text, referrer_name text, referred_name text, reason text, before jsonb, after jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN QUERY
SELECT e.created_at, e.action, pa.display_name, pr.display_name, pd.display_name, e.reason, e.before, e.after
FROM public.referral_events e
LEFT JOIN public.profiles pa ON pa.user_id = e.actor
LEFT JOIN public.consultants cr ON cr.id = e.referrer_consultant_id
LEFT JOIN public.profiles pr ON pr.user_id = cr.user_id
LEFT JOIN public.consultants cd ON cd.id = e.referred_consultant_id
LEFT JOIN public.profiles pd ON pd.user_id = cd.user_id
ORDER BY e.created_at DESC
LIMIT greatest(1, least(COALESCE(_limit, 200), 1000));
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_events(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_events(int) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_action(_action text, _id uuid, _reason text, _amount numeric DEFAULT NULL,
_currency text DEFAULT NULL, _new_referrer uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_actor uuid := auth.uid();
_why text := left(btrim(COALESCE(_reason, '')), 500);
l record;
r record;
_n int;
_new uuid;
_before jsonb;
_cur text := upper(btrim(COALESCE(_currency, 'USD')));
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
IF NOT public.check_rate_limit('refadmin:' || _actor::text, 120, 600) THEN
RAISE EXCEPTION 'Too many changes in a short time. Please wait a few minutes.' USING ERRCODE = 'P0001';
END IF;
IF length(_why) < 5 THEN RAISE EXCEPTION 'Write a short reason (at least 5 characters).' USING ERRCODE = '22023'; END IF;
IF _action = 'run_payouts' THEN
_n := public.referral_bundle_payouts(_actor);
PERFORM public.referral_log(_actor, 'run_payouts', NULL, NULL, NULL, NULL, NULL, jsonb_build_object('created', _n), _why);
RETURN jsonb_build_object('created', _n);
END IF;
IF _action IN ('approve_line', 'hold_line', 'reverse_line') THEN
SELECT * INTO l FROM public.referral_reward_lines WHERE id = _id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Reward line not found' USING ERRCODE = '42704'; END IF;
IF public.referral_admin_is_party(ARRAY[l.referrer_consultant_id, l.referred_consultant_id]) THEN
RAISE EXCEPTION 'You can not change your own referral account. Ask another administrator.' USING ERRCODE = '42501';
END IF;
IF _action = 'approve_line' THEN
IF l.status <> 'held' THEN RAISE EXCEPTION 'Only held lines can be approved' USING ERRCODE = '22023'; END IF;
UPDATE public.referral_reward_lines x
SET status = public.referral_release_status(x.id), hold_reason = NULL,
available_at = CASE WHEN public.referral_release_status(x.id) = 'available' THEN now() END, updated_at = now()
WHERE x.id = l.id;
ELSIF _action = 'hold_line' THEN
IF l.status NOT IN ('pending', 'available') THEN RAISE EXCEPTION 'Only pending or available lines can be held' USING ERRCODE = '22023'; END IF;
UPDATE public.referral_reward_lines SET status = 'held', hold_reason = 'admin', updated_at = now() WHERE id = l.id;
ELSE
_new := public.referral_reverse_line(l.id, _actor, _why);
IF _new IS NULL THEN RAISE EXCEPTION 'This line can not be reversed (already reversed or not a reward)' USING ERRCODE = '22023'; END IF;
RETURN jsonb_build_object('reversal_line', _new);
END IF;
PERFORM public.referral_log(_actor, _action, l.referrer_consultant_id, l.referred_consultant_id, l.id, l.source_payout_id,
jsonb_build_object('status', l.status), (SELECT jsonb_build_object('status', x.status) FROM public.referral_reward_lines x WHERE x.id = l.id), _why);
RETURN jsonb_build_object('ok', true);
END IF;
IF _action = 'adjust' THEN
IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _id) THEN RAISE EXCEPTION 'Consultant not found' USING ERRCODE = '42704'; END IF;
IF public.referral_admin_is_party(ARRAY[_id]) THEN
RAISE EXCEPTION 'You can not adjust your own referral account. Ask another administrator.' USING ERRCODE = '42501';
END IF;
IF _amount IS NULL OR public.referral_money(_amount) = 0 OR abs(_amount) > 100000 THEN RAISE EXCEPTION 'Enter an amount other than 0 (up to 100000)' USING ERRCODE = '22023'; END IF;
IF _cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Currency must be a 3-letter code' USING ERRCODE = '22023'; END IF;
IF abs(public.referral_money(_amount)) > (public.referral_settings() ->> 'four_eyes_amount')::numeric THEN
INSERT INTO public.referral_adjust_requests (consultant_id, amount, currency, reason, requested_by)
VALUES (_id, public.referral_money(_amount), _cur, _why, _actor) RETURNING id INTO _new;
PERFORM public.referral_log(_actor, 'adjust_requested', _id, NULL, NULL, NULL, NULL,
jsonb_build_object('request', _new, 'amount', public.referral_money(_amount), 'currency', _cur), _why);
INSERT INTO public.notifications (user_id, title, body, type, link)
SELECT DISTINCT ur.user_id, 'Referral adjustment waiting for your approval',
format('An administrator asked for a referral adjustment of %s %s. A second super administrator must approve it.',
to_char(public.referral_money(_amount), 'FM999999990.00'), _cur), 'security', '/admin/referrals'
FROM public.user_roles ur WHERE ur.role = 'super_admin' AND ur.user_id <> _actor;
RETURN jsonb_build_object('pending_approval', _new);
END IF;
INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, amount, currency, status, note, created_by, available_at)
VALUES ('adjust:' || gen_random_uuid()::text, 'adjustment', _id, public.referral_money(_amount), _cur, 'available', _why, _actor, now())
RETURNING id INTO _new;
PERFORM public.referral_log(_actor, 'adjust', _id, NULL, _new, NULL, NULL, jsonb_build_object('amount', public.referral_money(_amount), 'currency', _cur), _why);
RETURN jsonb_build_object('line', _new);
END IF;
IF _action = 'set_referrer' THEN
IF EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id = _id) THEN
RAISE EXCEPTION 'This consultant already has a referrer. Use "Change referrer".' USING ERRCODE = '22023';
END IF;
IF _new_referrer IS NULL OR NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _new_referrer) THEN
RAISE EXCEPTION 'Choose the referrer' USING ERRCODE = '22023';
END IF;
IF public.referral_admin_is_party(ARRAY[_id, _new_referrer]) THEN
RAISE EXCEPTION 'You can not change your own referral account. Ask another administrator.' USING ERRCODE = '42501';
END IF;
_n := 0;
DECLARE _res text; BEGIN
_res := public.referral_attribute(_id, public.referral_ensure_code(_new_referrer), 'admin', NULL, NULL);
IF _res <> 'ok' THEN RAISE EXCEPTION 'The referrer can not be set (%).', _res USING ERRCODE = '22023'; END IF;
END;
PERFORM public.referral_log(_actor, 'set_referrer', _new_referrer, _id, NULL, NULL, NULL, jsonb_build_object('referrer', _new_referrer), _why);
RETURN jsonb_build_object('ok', true);
END IF;
IF _action IN ('resend', 'revive') THEN
SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = _id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Referral not found' USING ERRCODE = '42704'; END IF;
IF _action = 'revive' AND public.referral_admin_is_party(ARRAY[_id, r.referrer_consultant_id]) THEN
RAISE EXCEPTION 'You can not change your own referral account. Ask another administrator.' USING ERRCODE = '42501';
END IF;
IF _action = 'revive' THEN
IF r.activation_status <> 'expired' THEN RAISE EXCEPTION 'Only expired referrals can be revived' USING ERRCODE = '22023'; END IF;
UPDATE public.consultant_referrals
SET activation_status = 'pending', expired_at = NULL, reminder_14_at = NULL, reminder_45_at = NULL, attributed_at = attributed_at,
activation_expires_at = now() + make_interval(days => (public.referral_settings() ->> 'activation_days')::int), updated_at = now()
WHERE referred_consultant_id = _id;
PERFORM public.referral_log(_actor, 'revive', r.referrer_consultant_id, _id, NULL, NULL, jsonb_build_object('activation', 'expired'), jsonb_build_object('activation', 'pending'), _why);
PERFORM public.referral_check_activation(_id);
RETURN jsonb_build_object('ok', true);
END IF;
IF r.activation_status <> 'pending' THEN RAISE EXCEPTION 'Only pending referrals get reminders' USING ERRCODE = '22023'; END IF;
IF r.admin_resend_at IS NOT NULL AND r.admin_resend_at > now() - interval '24 hours' THEN
RAISE EXCEPTION 'A reminder was already sent in the last 24 hours' USING ERRCODE = 'P0001';
END IF;
UPDATE public.consultant_referrals SET admin_resend_at = now(), updated_at = now() WHERE referred_consultant_id = _id;
_n := 0;
IF public.referral_acked_at(r.referrer_consultant_id) IS NULL THEN PERFORM public.referral_notify(r.referrer_consultant_id, 'ack_request', _id, NULL, NULL); _n := _n + 1;
ELSIF public.referral_passed_at(r.referrer_consultant_id) IS NULL THEN
PERFORM public.referral_notify(r.referrer_consultant_id, 'reminder', _id, NULL, NULL, 'pass_interview'); _n := _n + 1; END IF;
IF public.referral_acked_at(_id) IS NULL THEN PERFORM public.referral_notify(_id, 'ack_request', r.referrer_consultant_id, NULL, NULL); _n := _n + 1;
ELSIF public.referral_passed_at(_id) IS NULL THEN
PERFORM public.referral_notify(_id, 'reminder', r.referrer_consultant_id, NULL, NULL, 'pass_interview'); _n := _n + 1; END IF;
PERFORM public.referral_log(_actor, 'resend', r.referrer_consultant_id, _id, NULL, NULL, NULL, jsonb_build_object('notices', _n), _why);
RETURN jsonb_build_object('sent', _n);
END IF;
IF _action IN ('approve_referral', 'hold_referral', 'remove_referral', 'change_referrer') THEN
SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = _id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Referral not found' USING ERRCODE = '42704'; END IF;
IF public.referral_admin_is_party(ARRAY[_id, r.referrer_consultant_id, _new_referrer]) THEN
RAISE EXCEPTION 'You can not change your own referral account. Ask another administrator.' USING ERRCODE = '42501';
END IF;
IF _action = 'approve_referral' THEN
UPDATE public.consultant_referrals SET status = 'active', approved_at = now(), approved_by = _actor, updated_at = now() WHERE referred_consultant_id = _id;
UPDATE public.referral_reward_lines x
SET status = public.referral_release_status(x.id), hold_reason = NULL,
available_at = CASE WHEN public.referral_release_status(x.id) = 'available' THEN now() END, updated_at = now()
WHERE x.referred_consultant_id = _id AND x.status = 'held' AND x.hold_reason IN ('review', 'admin');
ELSIF _action = 'hold_referral' THEN
UPDATE public.consultant_referrals SET status = 'held', updated_at = now() WHERE referred_consultant_id = _id;
UPDATE public.referral_reward_lines SET status = 'held', hold_reason = 'admin', updated_at = now()
WHERE referred_consultant_id = _id AND status IN ('pending', 'available');
ELSIF _action = 'remove_referral' THEN
UPDATE public.consultant_referrals SET status = 'removed', updated_at = now() WHERE referred_consultant_id = _id;
ELSE
IF _new_referrer IS NULL OR NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _new_referrer) THEN
RAISE EXCEPTION 'Choose the new referrer' USING ERRCODE = '22023';
END IF;
IF _new_referrer = _id THEN RAISE EXCEPTION 'A consultant can not refer themselves' USING ERRCODE = '22023'; END IF;
IF public.referral_is_loop(_new_referrer, _id) THEN RAISE EXCEPTION 'This would create a referral loop' USING ERRCODE = '22023'; END IF;
UPDATE public.consultant_referrals
SET referrer_consultant_id = _new_referrer, code = COALESCE(public.referral_ensure_code(_new_referrer), code), source = 'admin', updated_at = now()
WHERE referred_consultant_id = _id;
END IF;
PERFORM public.referral_log(_actor, _action, COALESCE(_new_referrer, r.referrer_consultant_id), _id, NULL, NULL,
jsonb_build_object('status', r.status, 'referrer', r.referrer_consultant_id),
(SELECT jsonb_build_object('status', x.status, 'referrer', x.referrer_consultant_id) FROM public.consultant_referrals x WHERE x.referred_consultant_id = _id),
_why);
RETURN jsonb_build_object('ok', true);
END IF;
IF _action IN ('disable_code', 'enable_code') THEN
IF _action = 'enable_code' AND public.referral_admin_is_party(ARRAY[_id]) THEN
RAISE EXCEPTION 'You can not change your own referral account. Ask another administrator.' USING ERRCODE = '42501';
END IF;
PERFORM public.referral_ensure_code(_id);
SELECT jsonb_build_object('disabled_at', x.disabled_at, 'reason', x.disabled_reason) INTO _before FROM public.consultant_referral_codes x WHERE x.consultant_id = _id;
UPDATE public.consultant_referral_codes
SET disabled_at = CASE WHEN _action = 'disable_code' THEN now() END,
disabled_reason = CASE WHEN _action = 'disable_code' THEN _why END, updated_at = now()
WHERE consultant_id = _id;
GET DIAGNOSTICS _n = ROW_COUNT;
IF _n = 0 THEN RAISE EXCEPTION 'Consultant not found' USING ERRCODE = '42704'; END IF;
PERFORM public.referral_log(_actor, _action, _id, NULL, NULL, NULL, _before,
(SELECT jsonb_build_object('disabled_at', x.disabled_at, 'reason', x.disabled_reason) FROM public.consultant_referral_codes x WHERE x.consultant_id = _id), _why);
RETURN jsonb_build_object('ok', true);
END IF;
RAISE EXCEPTION 'Unknown action' USING ERRCODE = '22023';
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_action(text, uuid, text, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_action(text, uuid, text, numeric, text, uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_set_settings(_settings jsonb, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_before jsonb := public.referral_settings();
_why text := left(btrim(COALESCE(_reason, '')), 500);
_v jsonb;
_k text;
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
IF NOT public.check_rate_limit('refsettings:' || auth.uid()::text, 20, 3600) THEN
RAISE EXCEPTION 'Too many changes in a short time. Please wait a few minutes.' USING ERRCODE = 'P0001';
END IF;
IF length(_why) < 5 THEN RAISE EXCEPTION 'Write a short reason (at least 5 characters).' USING ERRCODE = '22023'; END IF;
IF jsonb_typeof(_settings) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Settings must be an object' USING ERRCODE = '22023'; END IF;
FOR _k, _v IN SELECT key, value FROM jsonb_each(_settings) LOOP
IF _k = 'enabled' THEN
IF jsonb_typeof(_v) <> 'boolean' THEN RAISE EXCEPTION 'enabled must be true or false' USING ERRCODE = '22023'; END IF;
INSERT INTO public.platform_settings (key, value) VALUES ('referral_enabled', _v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
ELSIF _k = 'claim_until' THEN
BEGIN
PERFORM (_v #>> '{}')::timestamptz;
EXCEPTION WHEN OTHERS THEN
RAISE EXCEPTION 'claim_until must be a date and time' USING ERRCODE = '22023';
END;
INSERT INTO public.platform_settings (key, value) VALUES ('referral_claim_until', to_jsonb((_v #>> '{}')::timestamptz))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
ELSIF _k IN ('pass_mark', 'activation_days') THEN
IF jsonb_typeof(_v) <> 'number' OR (_v #>> '{}')::numeric <> trunc((_v #>> '{}')::numeric)
OR (_k = 'pass_mark' AND ((_v #>> '{}')::numeric < 0 OR (_v #>> '{}')::numeric > 100))
OR (_k = 'activation_days' AND ((_v #>> '{}')::numeric < 1 OR (_v #>> '{}')::numeric > 365)) THEN
RAISE EXCEPTION 'Value out of range for %', _k USING ERRCODE = '22023';
END IF;
INSERT INTO public.platform_settings (key, value)
VALUES (CASE WHEN _k = 'pass_mark' THEN 'referral_min_interview_score' ELSE 'referral_activation_days' END, _v)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
ELSIF _k = 'tiers' THEN
DECLARE _p text := public.referral_tiers_valid(_v, COALESCE((_settings ->> 'max_rate')::numeric, public.referral_setting_num('referral_max_rate', 2, 0.01, 10)));
BEGIN
IF _p IS NOT NULL THEN RAISE EXCEPTION '%', _p USING ERRCODE = '22023'; END IF;
END;
INSERT INTO public.platform_settings (key, value) VALUES ('referral_tiers', _v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
ELSIF _k = 'max_rate' THEN
IF jsonb_typeof(_v) <> 'number' OR (_v #>> '{}')::numeric < 0.1 OR (_v #>> '{}')::numeric > 10 THEN
RAISE EXCEPTION 'The maximum rate must be between 0.1 and 10 %%' USING ERRCODE = '22023';
END IF;
IF public.referral_tiers_valid(COALESCE(_settings -> 'tiers', public.referral_tiers()), (_v #>> '{}')::numeric) IS NOT NULL THEN
RAISE EXCEPTION 'A tier rate is above the new maximum' USING ERRCODE = '22023';
END IF;
INSERT INTO public.platform_settings (key, value) VALUES ('referral_max_rate', _v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
ELSIF _k IN ('months', 'min_payout', 'claim_days') THEN
IF jsonb_typeof(_v) <> 'number'
OR (_k = 'months' AND ((_v #>> '{}')::numeric < 1 OR (_v #>> '{}')::numeric > 60 OR (_v #>> '{}')::numeric <> trunc((_v #>> '{}')::numeric)))
OR (_k = 'min_payout' AND ((_v #>> '{}')::numeric < 0 OR (_v #>> '{}')::numeric > 100000))
OR (_k = 'claim_days' AND ((_v #>> '{}')::numeric < 0 OR (_v #>> '{}')::numeric > 30 OR (_v #>> '{}')::numeric <> trunc((_v #>> '{}')::numeric))) THEN
RAISE EXCEPTION 'Value out of range for %', _k USING ERRCODE = '22023';
END IF;
INSERT INTO public.platform_settings (key, value) VALUES ('referral_' || _k, _v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
ELSIF _k IN ('max_per_referred', 'monthly_cap', 'monthly_cap_referred') THEN
IF NOT (jsonb_typeof(_v) = 'null' OR (jsonb_typeof(_v) = 'number' AND (_v #>> '{}')::numeric > 0 AND (_v #>> '{}')::numeric <= 10000000)) THEN
RAISE EXCEPTION 'Use an empty value (no cap) or a positive amount for %', _k USING ERRCODE = '22023';
END IF;
INSERT INTO public.platform_settings (key, value)
VALUES (CASE _k WHEN 'max_per_referred' THEN 'referral_max_reward_per_referred' WHEN 'monthly_cap' THEN 'referral_monthly_cap_per_referrer'
ELSE 'referral_monthly_cap_per_referred' END, _v)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
ELSIF _k IN ('hold_days', 'min_invoice', 'flag_threshold', 'velocity_day', 'velocity_ip', 'tier_paid_days', 'four_eyes_amount',
'payout_change_hold_days', 'retention_days') THEN
DECLARE
_lo numeric := CASE _k WHEN 'hold_days' THEN 0 WHEN 'min_invoice' THEN 0 WHEN 'flag_threshold' THEN 1 WHEN 'velocity_day' THEN 1
WHEN 'velocity_ip' THEN 1 WHEN 'tier_paid_days' THEN 1 WHEN 'four_eyes_amount' THEN 0
WHEN 'payout_change_hold_days' THEN 0 ELSE 30 END;
_hi numeric := CASE _k WHEN 'hold_days' THEN 90 WHEN 'min_invoice' THEN 100000 WHEN 'flag_threshold' THEN 10 WHEN 'velocity_day' THEN 1000
WHEN 'velocity_ip' THEN 1000 WHEN 'tier_paid_days' THEN 365 WHEN 'four_eyes_amount' THEN 100000
WHEN 'payout_change_hold_days' THEN 60 ELSE 1095 END;
BEGIN
IF jsonb_typeof(_v) <> 'number' OR (_v #>> '{}')::numeric < _lo OR (_v #>> '{}')::numeric > _hi
OR (_k NOT IN ('min_invoice', 'four_eyes_amount') AND (_v #>> '{}')::numeric <> trunc((_v #>> '{}')::numeric)) THEN
RAISE EXCEPTION 'Value out of range for % (% to %)', _k, _lo, _hi USING ERRCODE = '22023';
END IF;
END;
INSERT INTO public.platform_settings (key, value)
VALUES (CASE _k WHEN 'hold_days' THEN 'referral_hold_days' WHEN 'min_invoice' THEN 'referral_min_invoice'
WHEN 'flag_threshold' THEN 'referral_review_flag_threshold' WHEN 'velocity_day' THEN 'referral_velocity_per_day'
WHEN 'velocity_ip' THEN 'referral_velocity_per_ip' WHEN 'tier_paid_days' THEN 'referral_tier_paid_days'
WHEN 'four_eyes_amount' THEN 'referral_adjust_four_eyes_amount' WHEN 'payout_change_hold_days' THEN 'payout_details_change_hold_days'
ELSE 'referral_signal_retention_days' END, _v)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
ELSIF _k = 'rules_texts' THEN
IF jsonb_typeof(_v) <> 'object' OR EXISTS (
SELECT 1 FROM jsonb_each(_v) e
WHERE e.key NOT IN ('overview', 'prerequisites', 'earn', 'rates', 'payment', 'rules', 'simulator')
OR jsonb_typeof(e.value) <> 'object'
OR EXISTS (SELECT 1 FROM jsonb_each(e.value) l
WHERE l.key NOT IN ('en', 'ar') OR jsonb_typeof(l.value) <> 'string'
OR length(l.value #>> '{}') > 600 OR (l.value #>> '{}') ~ '[<>]')) THEN
RAISE EXCEPTION 'Section notes must be plain text (no < or >), English and Arabic, up to 600 characters each' USING ERRCODE = '22023';
END IF;
INSERT INTO public.platform_settings (key, value) VALUES ('referral_rules_texts', _v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
ELSIF _k = 'tier_requires_paid' THEN
IF jsonb_typeof(_v) <> 'boolean' THEN RAISE EXCEPTION 'tier_requires_paid must be true or false' USING ERRCODE = '22023'; END IF;
INSERT INTO public.platform_settings (key, value) VALUES ('referral_tier_requires_paid', _v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
ELSE
RAISE EXCEPTION 'Unknown setting %', _k USING ERRCODE = '22023';
END IF;
END LOOP;
PERFORM public.referral_log(auth.uid(), 'settings_changed', NULL, NULL, NULL, NULL, _before, public.referral_settings(), _why);
RETURN public.referral_settings();
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_set_settings(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_set_settings(jsonb, text) TO authenticated;