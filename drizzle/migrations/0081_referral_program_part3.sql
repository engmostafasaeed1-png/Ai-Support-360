CREATE OR REPLACE FUNCTION public.referral_attribute(_referred uuid, _code text, _source text, _device text, _ip text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_c text := public.referral_norm_code(_code);
_referrer uuid;
_flags text[] := '{}';
_dh text := public.referral_hash(NULLIF(left(COALESCE(_device, ''), 128), ''));
_ih text := public.referral_hash(_ip);
_u1 uuid;
_u2 uuid;
_e1 text;
_e2 text;
_n int;
BEGIN
IF _c IS NULL OR _referred IS NULL THEN RETURN 'none'; END IF;
IF NOT COALESCE((public.referral_settings() ->> 'enabled')::boolean, false) THEN RETURN 'off'; END IF;
IF EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id = _referred) THEN RETURN 'already'; END IF;
_referrer := public.referral_find_code(_c);
IF _referrer IS NULL THEN RETURN 'invalid'; END IF;
IF _referrer = _referred THEN RETURN 'self'; END IF;
SELECT c.user_id INTO _u1 FROM public.consultants c WHERE c.id = _referred;
SELECT c.user_id INTO _u2 FROM public.consultants c WHERE c.id = _referrer;
IF _u1 = _u2 THEN RETURN 'self'; END IF;
SELECT public.referral_norm_email(u.email) INTO _e1 FROM auth.users u WHERE u.id = _u1;
SELECT public.referral_norm_email(u.email) INTO _e2 FROM auth.users u WHERE u.id = _u2;
IF _e1 IS NOT NULL AND _e1 = _e2 THEN RETURN 'self'; END IF;
IF public.referral_is_loop(_referrer, _referred) THEN RETURN 'loop'; END IF;
_flags := public.referral_attribution_flags(_referrer, _referred, _dh, _ih);
INSERT INTO public.consultant_referrals (referred_consultant_id, referrer_consultant_id, code, source, flags, flag_score, status,
activation_expires_at, referred_verified_at)
VALUES (_referred, _referrer, _c, CASE WHEN _source IN ('signup', 'claim', 'admin') THEN _source ELSE 'signup' END, _flags,
public.referral_flag_score(_flags),
CASE WHEN public.referral_flag_score(_flags) >= (public.referral_settings() ->> 'flag_threshold')::int THEN 'review' ELSE 'active' END,
now() + make_interval(days => (public.referral_settings() ->> 'activation_days')::int),
CASE WHEN EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _referred AND c.verification_status::text = 'verified') THEN now() END)
ON CONFLICT (referred_consultant_id) DO NOTHING;
GET DIAGNOSTICS _n = ROW_COUNT;
IF _n = 0 THEN RETURN 'already'; END IF;
INSERT INTO public.referral_attribution_signals (referred_consultant_id, device_hash, ip_hash) VALUES (_referred, _dh, _ih)
ON CONFLICT (referred_consultant_id) DO NOTHING;
PERFORM public.referral_note_device(_referred, _device, _ip);
PERFORM public.referral_log(NULL, 'attributed', _referrer, _referred, NULL, NULL, NULL,
jsonb_build_object('code', _c, 'source', _source, 'flags', _flags), NULL);
PERFORM public.referral_notify(_referrer, 'signup', _referred, NULL, NULL);
PERFORM public.referral_notify(_referred, 'invited', _referrer, NULL, NULL);
RETURN 'ok';
END
$$;
REVOKE ALL ON FUNCTION public.referral_attribute(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_on_consultant_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_meta jsonb;
BEGIN
BEGIN
PERFORM public.referral_ensure_code(NEW.id);
SELECT u.raw_user_meta_data INTO _meta FROM auth.users u WHERE u.id = NEW.user_id;
IF NULLIF(_meta ->> 'referral_code', '') IS NOT NULL
AND NOT COALESCE((_meta ->> 'referral_captured_at') ~ '^\d{4}-\d{2}-\d{2}T?' AND (_meta ->> 'referral_captured_at')::timestamptz < now() - interval '30 days', false) THEN
PERFORM public.referral_attribute(NEW.id, _meta ->> 'referral_code', 'signup', _meta ->> 'referral_device', public.referral_request_ip());
IF (_meta ->> 'referral_ack_version') ~ '^\d{1,4}$'
AND (_meta ->> 'referral_ack_version')::int = (public.referral_settings() ->> 'terms_version')::int
AND EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id = NEW.id) THEN
INSERT INTO public.referral_acknowledgements (consultant_id, user_id, version, role, source, language, user_agent)
VALUES (NEW.id, NEW.user_id, (_meta ->> 'referral_ack_version')::int, 'referred', 'signup',
CASE WHEN _meta ->> 'referral_ack_lang' = 'ar' THEN 'ar' ELSE 'en' END, left(_meta ->> 'referral_ack_ua', 300));
END IF;
END IF;
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'referral sign-up handling skipped: %', SQLERRM;
END;
RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_referral_on_consultant_insert ON public.consultants;
CREATE TRIGGER trg_referral_on_consultant_insert
AFTER INSERT ON public.consultants
FOR EACH ROW EXECUTE FUNCTION public.referral_on_consultant_insert();
CREATE OR REPLACE FUNCTION public.referral_on_consultant_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
r record;
BEGIN
IF NEW.verification_status::text = 'verified' AND OLD.verification_status::text IS DISTINCT FROM 'verified' THEN
UPDATE public.consultant_referrals SET referred_verified_at = now(), updated_at = now() WHERE referred_consultant_id = NEW.id;
BEGIN
SELECT * INTO r FROM public.consultant_referrals
WHERE referred_consultant_id = NEW.id AND status <> 'removed' AND verified_notified_at IS NULL FOR UPDATE;
IF FOUND THEN
UPDATE public.consultant_referrals SET verified_notified_at = now(), updated_at = now() WHERE referred_consultant_id = NEW.id;
PERFORM public.referral_notify(r.referrer_consultant_id, 'verified', NEW.id, NULL, NULL);
PERFORM public.referral_log(NULL, 'referred_verified', r.referrer_consultant_id, NEW.id, NULL, NULL, NULL, NULL, NULL);
END IF;
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'referral verified notice skipped: %', SQLERRM;
END;
END IF;
RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_referral_on_consultant_verified ON public.consultants;
CREATE TRIGGER trg_referral_on_consultant_verified
AFTER UPDATE OF verification_status ON public.consultants
FOR EACH ROW EXECUTE FUNCTION public.referral_on_consultant_verified();
CREATE OR REPLACE FUNCTION public.referral_check_activation(_referred uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
r record;
_rp timestamptz;
_dp timestamptz;
_ok boolean;
BEGIN
SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = _referred FOR UPDATE;
IF NOT FOUND THEN RETURN NULL; END IF;
IF r.status = 'removed' OR r.activation_status <> 'pending' THEN RETURN r.activation_status; END IF;
_rp := public.referral_passed_at(r.referrer_consultant_id);
_dp := public.referral_passed_at(r.referred_consultant_id);
_ok := _rp IS NOT NULL AND _dp IS NOT NULL
AND public.referral_acked_at(r.referrer_consultant_id) IS NOT NULL AND public.referral_acked_at(r.referred_consultant_id) IS NOT NULL;
IF r.activation_expires_at IS NOT NULL AND now() >= r.activation_expires_at THEN
UPDATE public.consultant_referrals SET activation_status = 'expired', expired_at = now(), updated_at = now() WHERE referred_consultant_id = _referred;
PERFORM public.referral_log(NULL, 'activation_expired', r.referrer_consultant_id, _referred, NULL, NULL, NULL, NULL, NULL);
PERFORM public.referral_notify(r.referrer_consultant_id, 'expired', _referred, NULL, NULL);
PERFORM public.referral_notify(_referred, 'expired', r.referrer_consultant_id, NULL, NULL);
RETURN 'expired';
END IF;
IF _ok THEN
UPDATE public.consultant_referrals
SET activation_status = 'active', activated_at = now(), updated_at = now(),
referrer_passed_notified_at = COALESCE(referrer_passed_notified_at, now()),
referred_passed_notified_at = COALESCE(referred_passed_notified_at, now())
WHERE referred_consultant_id = _referred;
PERFORM public.referral_log(NULL, 'activated', r.referrer_consultant_id, _referred, NULL, NULL, NULL, jsonb_build_object('activated_at', now()), NULL);
PERFORM public.referral_notify(r.referrer_consultant_id, 'active', _referred, NULL, NULL);
PERFORM public.referral_notify(_referred, 'active', r.referrer_consultant_id, NULL, NULL);
RETURN 'active';
END IF;
IF _rp IS NOT NULL AND r.referrer_passed_notified_at IS NULL THEN
UPDATE public.consultant_referrals SET referrer_passed_notified_at = now(), updated_at = now() WHERE referred_consultant_id = _referred;
PERFORM public.referral_log(NULL, 'referrer_passed', r.referrer_consultant_id, _referred, NULL, NULL, NULL, NULL, NULL);
IF NOT EXISTS (SELECT 1 FROM public.referral_email_queue q JOIN public.consultants c ON c.user_id = q.user_id
WHERE c.id = r.referrer_consultant_id AND q.kind = 'passed_self') THEN
PERFORM public.referral_notify(r.referrer_consultant_id, 'passed_self', _referred, NULL, NULL, public.referral_next_step(_referred, r.referrer_consultant_id));
END IF;
PERFORM public.referral_notify(_referred, 'passed_other', r.referrer_consultant_id, NULL, NULL, public.referral_next_step(_referred, _referred));
END IF;
IF _dp IS NOT NULL AND r.referred_passed_notified_at IS NULL THEN
UPDATE public.consultant_referrals SET referred_passed_notified_at = now(), updated_at = now() WHERE referred_consultant_id = _referred;
PERFORM public.referral_log(NULL, 'referred_passed', r.referrer_consultant_id, _referred, NULL, NULL, NULL, NULL, NULL);
IF NOT EXISTS (SELECT 1 FROM public.referral_email_queue q JOIN public.consultants c ON c.user_id = q.user_id
WHERE c.id = _referred AND q.kind = 'passed_self') THEN
PERFORM public.referral_notify(_referred, 'passed_self', r.referrer_consultant_id, NULL, NULL, public.referral_next_step(_referred, _referred));
END IF;
PERFORM public.referral_notify(r.referrer_consultant_id, 'passed_other', _referred, NULL, NULL, public.referral_next_step(_referred, r.referrer_consultant_id));
END IF;
RETURN 'pending';
END
$$;
REVOKE ALL ON FUNCTION public.referral_check_activation(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_check_consultant(_cid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
x record;
BEGIN
FOR x IN SELECT referred_consultant_id FROM public.consultant_referrals
WHERE (referred_consultant_id = _cid OR referrer_consultant_id = _cid) AND activation_status = 'pending' AND status <> 'removed'
LOOP
PERFORM public.referral_check_activation(x.referred_consultant_id);
END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.referral_check_consultant(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_on_interview_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NEW.interview_type::text = 'ai' AND NEW.status::text IN ('completed', 'reviewed') THEN
BEGIN
PERFORM public.referral_check_consultant(NEW.consultant_id);
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'referral activation check skipped: %', SQLERRM;
END;
END IF;
RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_referral_on_interview_change ON public.interview_sessions;
CREATE TRIGGER trg_referral_on_interview_change
AFTER INSERT OR UPDATE OF status, overall_score ON public.interview_sessions
FOR EACH ROW EXECUTE FUNCTION public.referral_on_interview_change();
CREATE OR REPLACE FUNCTION public.referral_on_ack()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
PERFORM public.referral_check_consultant(NEW.consultant_id);
RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_referral_on_ack ON public.referral_acknowledgements;
CREATE TRIGGER trg_referral_on_ack
AFTER INSERT ON public.referral_acknowledgements
FOR EACH ROW EXECUTE FUNCTION public.referral_on_ack();
CREATE OR REPLACE FUNCTION public.referral_activation_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
x record;
_st text;
_rem int := 0;
_exp int := 0;
BEGIN
FOR x IN SELECT * FROM public.consultant_referrals WHERE activation_status = 'pending' AND status <> 'removed' ORDER BY attributed_at LIMIT 2000 LOOP
_st := public.referral_check_activation(x.referred_consultant_id);
IF _st = 'expired' THEN _exp := _exp + 1; CONTINUE; END IF;
IF _st <> 'pending' THEN CONTINUE; END IF;
IF x.attributed_at <= now() - interval '45 days' AND x.reminder_45_at IS NULL THEN
UPDATE public.consultant_referrals SET reminder_45_at = now(), reminder_14_at = COALESCE(reminder_14_at, now()) WHERE referred_consultant_id = x.referred_consultant_id;
ELSIF x.attributed_at <= now() - interval '14 days' AND x.reminder_14_at IS NULL THEN
UPDATE public.consultant_referrals SET reminder_14_at = now() WHERE referred_consultant_id = x.referred_consultant_id;
ELSE
CONTINUE;
END IF;
PERFORM public.referral_notify(x.referrer_consultant_id, 'reminder', x.referred_consultant_id, NULL, NULL,
public.referral_next_step(x.referred_consultant_id, x.referrer_consultant_id));
PERFORM public.referral_notify(x.referred_consultant_id, 'reminder', x.referrer_consultant_id, NULL, NULL,
public.referral_next_step(x.referred_consultant_id, x.referred_consultant_id));
_rem := _rem + 1;
END LOOP;
RETURN jsonb_build_object('reminded', _rem, 'expired', _exp);
END
$$;
REVOKE ALL ON FUNCTION public.referral_activation_sweep() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_reward_block_reason(_referrer uuid, _referred uuid, _status text, _window_ends timestamptz, _at timestamptz,
_activation text, _activated_at timestamptz)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NOT COALESCE((public.referral_settings() ->> 'enabled')::boolean, false) THEN RETURN 'programme_off'; END IF;
IF _status = 'removed' THEN RETURN 'removed'; END IF;
IF _referrer = _referred THEN RETURN 'own_work'; END IF;
IF _activation IS DISTINCT FROM 'active' THEN RETURN 'not_active'; END IF;
IF _activated_at IS NULL OR _at < _activated_at THEN RETURN 'before_activation'; END IF;
IF _window_ends IS NULL OR _at >= _window_ends THEN RETURN 'outside_window'; END IF;
IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _referred AND c.verification_status::text = 'verified') THEN RETURN 'referred_not_verified'; END IF;
IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _referrer AND c.verification_status::text = 'verified') THEN RETURN 'referrer_not_verified'; END IF;
IF public.referral_consultant_suspended(_referrer) THEN RETURN 'referrer_suspended'; END IF;
IF NOT public.referral_policy_ok(_referrer) THEN RETURN 'referrer_policy'; END IF;
RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.referral_reward_block_reason(uuid, uuid, text, timestamptz, timestamptz, text, timestamptz) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_on_payout_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
r record;
s jsonb := public.referral_settings();
BEGIN
IF COALESCE(NEW.reference, '') LIKE 'referral:%' THEN RETURN NULL; END IF;
SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = NEW.consultant_id FOR UPDATE;
IF NOT FOUND THEN RETURN NULL; END IF;
PERFORM public.referral_check_activation(NEW.consultant_id);
IF r.first_paid_at IS NULL THEN
UPDATE public.consultant_referrals
SET first_paid_at = NEW.created_at, window_ends_at = NEW.created_at + make_interval(months => (s->>'months')::int), updated_at = now()
WHERE referred_consultant_id = NEW.consultant_id;
PERFORM public.referral_log(NULL, 'first_paid', r.referrer_consultant_id, NEW.consultant_id, NULL, NEW.id, NULL,
jsonb_build_object('window_ends_at', NEW.created_at + make_interval(months => (s->>'months')::int)), NULL);
END IF;
IF NEW.status::text = 'completed' THEN PERFORM public.referral_create_reward(NEW.id); END IF;
RETURN NULL;
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'referral window skipped for payout %: %', NEW.id, SQLERRM;
RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_referral_on_payout_insert ON public.payouts;
CREATE TRIGGER trg_referral_on_payout_insert
AFTER INSERT ON public.payouts
FOR EACH ROW EXECUTE FUNCTION public.referral_on_payout_insert();
CREATE OR REPLACE FUNCTION public.referral_create_reward(_payout uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
po record;
pay record;
r record;
s jsonb := public.referral_settings();
_why text;
_fee numeric;
_rate numeric;
_tier jsonb;
_amt numeric;
_cur text;
_status text := 'pending';
_hold text;
_line uuid;
_flags text[] := '{}';
_ur uuid; _ud uuid;
_used numeric;
BEGIN
SELECT * INTO po FROM public.payouts WHERE id = _payout FOR UPDATE;
IF NOT FOUND OR COALESCE(po.reference, '') LIKE 'referral:%' OR po.status::text <> 'completed' THEN RETURN NULL; END IF;
SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = po.consultant_id FOR UPDATE;
IF NOT FOUND THEN RETURN NULL; END IF;
SELECT id INTO _line FROM public.referral_reward_lines WHERE source_payout_id = po.id AND kind = 'reward';
IF _line IS NOT NULL THEN RETURN _line; END IF;
_cur := upper(COALESCE(po.currency, 'USD'));
_why := public.referral_reward_block_reason(r.referrer_consultant_id, r.referred_consultant_id, r.status, r.window_ends_at, po.created_at,
r.activation_status, r.activated_at);
IF _why IS NULL THEN
SELECT * INTO pay FROM public.payments WHERE id = po.payment_id;
IF NOT FOUND THEN _why := 'no_invoice';
ELSIF pay.status::text <> 'completed' THEN _why := 'payment_not_cleared';
END IF;
END IF;
_fee := public.referral_money(COALESCE(po.gross_amount, po.amount, 0));
IF _why IS NULL AND _fee <= 0 THEN _why := 'no_fee'; END IF;
IF _why IS NULL AND _fee < (s ->> 'min_invoice')::numeric THEN _why := 'below_min_invoice'; END IF;
IF _why IS NULL AND NOT ('same_bank' = ANY (r.flags)) AND public.referral_same_bank(r.referrer_consultant_id, r.referred_consultant_id) THEN
PERFORM public.referral_add_flags(r.referred_consultant_id, ARRAY['same_bank'], 'Same bank account found at payout');
SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = po.consultant_id;
END IF;
IF _why IS NOT NULL THEN
PERFORM public.referral_log(NULL, 'reward_skipped', r.referrer_consultant_id, r.referred_consultant_id, NULL, po.id, NULL, NULL, _why);
RETURN NULL;
END IF;
_tier := public.referral_tier_for(public.referral_verified_count(r.referrer_consultant_id));
_rate := (_tier ->> 'rate')::numeric;
_amt := public.referral_money(_fee * _rate / 100);
IF _amt <= 0 THEN
PERFORM public.referral_log(NULL, 'reward_skipped', r.referrer_consultant_id, r.referred_consultant_id, NULL, po.id, NULL, NULL, 'no_fee');
RETURN NULL;
END IF;
SELECT user_id INTO _ur FROM public.consultants WHERE id = r.referrer_consultant_id;
SELECT user_id INTO _ud FROM public.consultants WHERE id = r.referred_consultant_id;
_flags := ARRAY(SELECT 'client_' || x FROM unnest(public.referral_related_flags(pay.client_id, _ur) || public.referral_related_flags(pay.client_id, _ud)) x GROUP BY x);
IF pay.tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = pay.tenant_id AND tm.user_id IN (_ur, _ud)) THEN
_flags := array_append(_flags, 'tenant_member');
END IF;
SELECT COALESCE(sum(amount), 0) INTO _used FROM public.referral_reward_lines
WHERE referrer_consultant_id = r.referrer_consultant_id AND currency = _cur AND kind IN ('reward', 'reversal') AND status <> 'reversed'
AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh');
IF (s ->> 'monthly_cap') IS NOT NULL AND _used + _amt > (s ->> 'monthly_cap')::numeric THEN _flags := array_append(_flags, 'cap_referrer_month'); END IF;
SELECT COALESCE(sum(amount), 0) INTO _used FROM public.referral_reward_lines
WHERE referred_consultant_id = r.referred_consultant_id AND currency = _cur AND kind IN ('reward', 'reversal') AND status <> 'reversed'
AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh');
IF (s ->> 'monthly_cap_referred') IS NOT NULL AND _used + _amt > (s ->> 'monthly_cap_referred')::numeric THEN _flags := array_append(_flags, 'cap_referred_month'); END IF;
SELECT COALESCE(sum(amount), 0) INTO _used FROM public.referral_reward_lines
WHERE referred_consultant_id = r.referred_consultant_id AND currency = _cur AND kind IN ('reward', 'reversal') AND status <> 'reversed';
IF (s ->> 'max_per_referred') IS NOT NULL AND _used + _amt > (s ->> 'max_per_referred')::numeric THEN _flags := array_append(_flags, 'cap_referred_total'); END IF;
IF r.status IN ('review', 'held') THEN
_status := 'held'; _hold := CASE WHEN r.status = 'review' THEN 'review' ELSE 'admin' END;
ELSIF EXISTS (SELECT 1 FROM unnest(_flags) f WHERE f LIKE 'client_%' OR f = 'tenant_member') THEN
_status := 'held'; _hold := 'related_party';
ELSIF EXISTS (SELECT 1 FROM unnest(_flags) f WHERE f LIKE 'cap_%') THEN
_status := 'held'; _hold := 'cap';
ELSIF (s ->> 'hold_days')::int = 0 THEN
_status := 'available';
END IF;
INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, referred_consultant_id, source_payout_id, payment_id,
fee_amount, rate_percent, tier_name, tier_count, amount, currency, status, hold_reason, flags,
released_at, matures_at, available_at)
VALUES ('reward:payout:' || po.id::text, 'reward', r.referrer_consultant_id, r.referred_consultant_id, po.id, po.payment_id,
_fee, _rate, _tier ->> 'name', (_tier ->> 'count')::int, _amt, _cur, _status, _hold, _flags,
now(), now() + make_interval(days => (s ->> 'hold_days')::int), CASE WHEN _status = 'available' THEN now() END)
ON CONFLICT DO NOTHING
RETURNING id INTO _line;
IF _line IS NULL THEN
SELECT id INTO _line FROM public.referral_reward_lines WHERE source_payout_id = po.id AND kind = 'reward';
RETURN _line;
END IF;
PERFORM public.referral_log(NULL, 'reward_created', r.referrer_consultant_id, r.referred_consultant_id, _line, po.id, NULL,
jsonb_build_object('fee', _fee, 'rate', _rate, 'tier', _tier ->> 'name', 'tier_count', _tier ->> 'count', 'amount', _amt,
'currency', _cur, 'status', _status, 'hold', _hold, 'flags', _flags), NULL);
IF _hold IN ('related_party', 'cap') THEN
INSERT INTO public.notifications (user_id, title, body, type, link)
SELECT DISTINCT ur.user_id, 'Referral reward held for review',
format('A referral reward of %s %s was held (%s). Please review it in Referrals, Reward lines.', to_char(_amt, 'FM999999990.00'), _cur,
CASE WHEN _hold = 'cap' THEN 'monthly or total cap exceeded' ELSE 'the paying client may be related to the referrer or the referred consultant' END),
'security', '/admin/referrals'
FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin');
END IF;
IF r.first_reward_notified_at IS NULL THEN
UPDATE public.consultant_referrals SET first_reward_notified_at = now(), updated_at = now() WHERE referred_consultant_id = r.referred_consultant_id;
PERFORM public.referral_notify(r.referrer_consultant_id, 'first_reward', r.referred_consultant_id, _amt, _cur);
END IF;
RETURN _line;
END
$$;
REVOKE ALL ON FUNCTION public.referral_create_reward(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_create_reward(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.referral_mature_lines(_now timestamptz DEFAULT now())
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_n int;
BEGIN
WITH due AS (
SELECT l.id FROM public.referral_reward_lines l
JOIN public.payouts po ON po.id = l.source_payout_id
JOIN public.payments p ON p.id = l.payment_id
WHERE l.kind = 'reward' AND l.status = 'pending' AND l.matures_at <= _now
AND po.status::text = 'completed' AND p.status::text = 'completed'
FOR UPDATE OF l SKIP LOCKED)
UPDATE public.referral_reward_lines x SET status = 'available', available_at = _now, updated_at = now()
FROM due WHERE x.id = due.id;
GET DIAGNOSTICS _n = ROW_COUNT;
RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.referral_mature_lines(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_mature_lines(timestamptz) TO service_role;
CREATE OR REPLACE FUNCTION public.referral_release_status(_line uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT CASE WHEN l.kind <> 'reward' THEN 'available'
WHEN l.matures_at IS NOT NULL AND l.matures_at <= now() AND po.status::text = 'completed' AND p.status::text = 'completed' THEN 'available'
ELSE 'pending' END
FROM public.referral_reward_lines l
LEFT JOIN public.payouts po ON po.id = l.source_payout_id
LEFT JOIN public.payments p ON p.id = l.payment_id
WHERE l.id = _line
$$;
REVOKE ALL ON FUNCTION public.referral_release_status(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_on_payout_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
IF COALESCE(NEW.reference, '') LIKE 'referral:%' THEN
IF NEW.status::text = 'completed' THEN
UPDATE public.referral_reward_lines SET status = 'paid', paid_at = now(), updated_at = now()
WHERE referral_payout_id = NEW.id AND status = 'in_payout';
PERFORM public.referral_log(NULL, 'referral_payout_paid', NEW.consultant_id, NULL, NULL, NEW.id, NULL,
jsonb_build_object('amount', NEW.amount, 'currency', NEW.currency), NULL);
ELSIF NEW.status::text = 'failed' THEN
UPDATE public.referral_reward_lines SET status = 'available', referral_payout_id = NULL, updated_at = now()
WHERE referral_payout_id = NEW.id AND status = 'in_payout';
END IF;
RETURN NULL;
END IF;
IF NEW.status::text = 'completed' THEN
BEGIN
PERFORM public.referral_create_reward(NEW.id);
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'referral reward skipped for payout %: %', NEW.id, SQLERRM;
END;
END IF;
RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_referral_on_payout_status ON public.payouts;
CREATE TRIGGER trg_referral_on_payout_status
AFTER UPDATE OF status ON public.payouts
FOR EACH ROW EXECUTE FUNCTION public.referral_on_payout_status();
CREATE OR REPLACE FUNCTION public.referral_reverse_line(_line uuid, _actor uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
l record;
_new uuid;
_st text;
BEGIN
SELECT * INTO l FROM public.referral_reward_lines WHERE id = _line FOR UPDATE;
IF NOT FOUND OR l.kind <> 'reward' OR l.status = 'reversed' THEN RETURN NULL; END IF;
IF EXISTS (SELECT 1 FROM public.referral_reward_lines x WHERE x.reverses_line_id = l.id) THEN RETURN NULL; END IF;
_st := CASE WHEN l.status IN ('pending', 'held', 'available') THEN 'reversed' ELSE 'available' END;
IF _st = 'reversed' THEN
UPDATE public.referral_reward_lines SET status = 'reversed', updated_at = now() WHERE id = l.id;
END IF;
INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, referred_consultant_id, source_payout_id, payment_id,
reverses_line_id, fee_amount, rate_percent, tier_name, tier_count, amount, currency, status, note, created_by, available_at)
VALUES ('reversal:' || l.id::text, 'reversal', l.referrer_consultant_id, l.referred_consultant_id, l.source_payout_id, l.payment_id,
l.id, l.fee_amount, l.rate_percent, l.tier_name, l.tier_count, -l.amount, l.currency, _st, left(COALESCE(_reason, 'Reversed'), 300), _actor,
CASE WHEN _st = 'available' THEN now() END)
ON CONFLICT (unique_key) DO NOTHING
RETURNING id INTO _new;
PERFORM public.referral_log(_actor, 'reward_reversed', l.referrer_consultant_id, l.referred_consultant_id, l.id, l.source_payout_id,
jsonb_build_object('status', l.status, 'amount', l.amount),
jsonb_build_object('reversal_line', _new, 'reversal_status', _st), _reason);
RETURN _new;
END
$$;
REVOKE ALL ON FUNCTION public.referral_reverse_line(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_on_payment_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
l record;
BEGIN
IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
IF NEW.status::text = 'refunded' THEN
FOR l IN SELECT x.id FROM public.referral_reward_lines x WHERE x.payment_id = NEW.id AND x.kind = 'reward' AND x.status <> 'reversed' LOOP
PERFORM public.referral_reverse_line(l.id, NULL, 'Client payment refunded');
END LOOP;
ELSIF NEW.status::text = 'disputed' THEN
FOR l IN SELECT x.* FROM public.referral_reward_lines x WHERE x.payment_id = NEW.id AND x.kind = 'reward' AND x.status IN ('pending', 'available') LOOP
UPDATE public.referral_reward_lines SET status = 'held', hold_reason = 'dispute', updated_at = now() WHERE id = l.id;
PERFORM public.referral_log(NULL, 'reward_held', l.referrer_consultant_id, l.referred_consultant_id, l.id, l.source_payout_id,
jsonb_build_object('status', l.status), jsonb_build_object('status', 'held'), 'Client payment disputed');
END LOOP;
ELSIF NEW.status::text = 'completed' AND OLD.status::text = 'disputed' THEN
UPDATE public.referral_reward_lines x
SET status = public.referral_release_status(x.id), hold_reason = NULL, updated_at = now(),
available_at = CASE WHEN public.referral_release_status(x.id) = 'available' THEN now() END
WHERE x.payment_id = NEW.id AND x.kind = 'reward' AND x.status = 'held' AND x.hold_reason = 'dispute';
END IF;
RETURN NULL;
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'referral payment handling skipped for payment %: %', NEW.id, SQLERRM;
RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_referral_on_payment_status ON public.payments;
CREATE TRIGGER trg_referral_on_payment_status
AFTER UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.referral_on_payment_status();
CREATE OR REPLACE FUNCTION public.referral_note_payer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_h text;
BEGIN
IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM NEW.client_id THEN RETURN NULL; END IF;
_h := public.referral_hash(public.referral_request_ip());
IF _h IS NOT NULL THEN
INSERT INTO public.referral_party_signals (user_id, kind, hash) VALUES (NEW.client_id, 'ip', _h)
ON CONFLICT (user_id, kind, hash) DO UPDATE SET last_seen_at = now();
END IF;
RETURN NULL;
EXCEPTION WHEN OTHERS THEN
RETURN NULL;
END
$$;