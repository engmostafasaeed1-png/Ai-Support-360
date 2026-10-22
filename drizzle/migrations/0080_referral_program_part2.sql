CREATE OR REPLACE FUNCTION public.referral_code_blocked_word(_code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
SELECT upper(COALESCE(_code, '')) ~ '(FUCK|SHIT|CUNT|PUSSY|BITCH|NIGG|WHORE|SLUT|PORN|BASTARD|WANK|MOTHERF)'
OR EXISTS (SELECT 1 FROM unnest(string_to_array(upper(COALESCE(_code, '')), '-')) s
WHERE s IN ('ASS', 'SEX', 'SEXY', 'XXX', 'FAG', 'KKK', 'NAZI', 'RAPE', 'TIT', 'TITS', 'DICK', 'COCK',
'PENIS', 'ANUS', 'DAMN', 'HELL', 'KILL', 'SUCK', 'PIMP', 'DRUG', 'DRUGS'))
OR upper(COALESCE(_code, '')) IN ('ADMIN', 'SUPPORT', 'TEST', 'NULL', 'AISUPPORT360')
$$;
CREATE OR REPLACE FUNCTION public.referral_random(_n int)
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i - 1) % 31), 1), '' ORDER BY i)
FROM (SELECT extensions.gen_random_bytes(greatest(1, _n)) AS b) x, generate_series(1, greatest(1, _n)) i
$$;
CREATE OR REPLACE FUNCTION public.referral_name_part(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
SELECT left(regexp_replace(upper(split_part(
regexp_replace(btrim(COALESCE(_name, '')), '^(dr|eng|mr|mrs|ms|prof)\.?\s+', '', 'i'), ' ', 1)), '[^A-Z]', '', 'g'), 8)
$$;
CREATE OR REPLACE FUNCTION public.referral_code_taken(_code text, _except uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT EXISTS (SELECT 1 FROM public.consultant_referral_codes x
WHERE (upper(x.code) = upper(_code) OR upper(x.previous_code) = upper(_code))
AND x.consultant_id IS DISTINCT FROM _except)
OR EXISTS (SELECT 1 FROM public.profiles p WHERE upper(p.referral_code) = upper(_code))
$$;
REVOKE ALL ON FUNCTION public.referral_code_taken(text, uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_ensure_code(_cid uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_c text;
_name text;
_part text;
_try int := 0;
BEGIN
SELECT code INTO _c FROM public.consultant_referral_codes WHERE consultant_id = _cid;
IF FOUND THEN RETURN _c; END IF;
SELECT p.display_name INTO _name FROM public.consultants c LEFT JOIN public.profiles p ON p.user_id = c.user_id WHERE c.id = _cid;
IF NOT FOUND THEN RETURN NULL; END IF;
_part := public.referral_name_part(_name);
IF length(_part) < 2 OR public.referral_code_blocked_word(_part) THEN _part := NULL; END IF;
LOOP
_try := _try + 1;
_c := 'SAP-' || COALESCE(_part || '-', '') || public.referral_random(7 + CASE WHEN _try > 5 THEN 2 ELSE 0 END);
IF NOT public.referral_code_taken(_c) AND NOT public.referral_code_blocked_word(_c) THEN
INSERT INTO public.consultant_referral_codes (consultant_id, code) VALUES (_cid, _c) ON CONFLICT DO NOTHING;
SELECT code INTO _c FROM public.consultant_referral_codes WHERE consultant_id = _cid;
IF FOUND THEN RETURN _c; END IF;
END IF;
IF _try > 25 THEN RAISE EXCEPTION 'Could not create a referral code'; END IF;
END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.referral_ensure_code(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_find_code(_code text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT id FROM (
SELECT x.consultant_id AS id, 1 AS o FROM public.consultant_referral_codes x
WHERE x.disabled_at IS NULL AND (upper(x.code) = public.referral_norm_code(_code) OR upper(x.previous_code) = public.referral_norm_code(_code))
UNION ALL
SELECT c.id, 2 FROM public.profiles p JOIN public.consultants c ON c.user_id = p.user_id
WHERE upper(p.referral_code) = public.referral_norm_code(_code)
AND NOT EXISTS (SELECT 1 FROM public.consultant_referral_codes x WHERE x.consultant_id = c.id AND x.disabled_at IS NOT NULL)
) t ORDER BY o LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.referral_find_code(text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_is_loop(_referrer uuid, _referred uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
WITH RECURSIVE up(id, depth) AS (
SELECT _referrer, 0
UNION ALL
SELECT r.referrer_consultant_id, up.depth + 1 FROM public.consultant_referrals r JOIN up ON r.referred_consultant_id = up.id
WHERE up.depth < 25 AND r.status <> 'removed'
)
SELECT EXISTS (SELECT 1 FROM up WHERE id = _referred)
$$;
REVOKE ALL ON FUNCTION public.referral_is_loop(uuid, uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_same_bank(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT EXISTS (
SELECT 1 FROM public.consultant_payout_details x, public.consultant_payout_details y
WHERE x.consultant_id = _a AND y.consultant_id = _b
AND ((NULLIF(upper(regexp_replace(COALESCE(x.iban, ''), '\s', '', 'g')), '') = NULLIF(upper(regexp_replace(COALESCE(y.iban, ''), '\s', '', 'g')), ''))
OR (NULLIF(regexp_replace(COALESCE(x.account_number, ''), '[\s-]', '', 'g'), '') = NULLIF(regexp_replace(COALESCE(y.account_number, ''), '[\s-]', '', 'g'), ''))))
$$;
REVOKE ALL ON FUNCTION public.referral_same_bank(uuid, uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_note_device(_cid uuid, _device text, _ip text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_dh text := public.referral_hash(NULLIF(left(COALESCE(_device, ''), 128), ''));
_ih text := public.referral_hash(_ip);
BEGIN
IF _cid IS NULL THEN RETURN; END IF;
IF _dh IS NOT NULL THEN
INSERT INTO public.referral_devices (consultant_id, kind, hash) VALUES (_cid, 'device', _dh)
ON CONFLICT (consultant_id, kind, hash) DO UPDATE SET last_seen_at = now();
END IF;
IF _ih IS NOT NULL THEN
INSERT INTO public.referral_devices (consultant_id, kind, hash) VALUES (_cid, 'ip', _ih)
ON CONFLICT (consultant_id, kind, hash) DO UPDATE SET last_seen_at = now();
END IF;
PERFORM public.referral_add_flags(x.referred_consultant_id,
array_remove(ARRAY[
CASE WHEN _dh IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_devices d WHERE d.consultant_id = x.other AND d.kind = 'device' AND d.hash = _dh) THEN 'same_device' END,
CASE WHEN _ih IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_devices d WHERE d.consultant_id = x.other AND d.kind = 'ip' AND d.hash = _ih) THEN 'same_ip' END], NULL),
'Seen at a later sign-in')
FROM (SELECT r.referred_consultant_id, CASE WHEN r.referred_consultant_id = _cid THEN r.referrer_consultant_id ELSE r.referred_consultant_id END AS other
FROM public.consultant_referrals r
WHERE (r.referred_consultant_id = _cid OR r.referrer_consultant_id = _cid) AND r.status <> 'removed'
AND r.attributed_at > now() - interval '30 days') x;
END
$$;
REVOKE ALL ON FUNCTION public.referral_note_device(uuid, text, text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_consultant_suspended(_cid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT EXISTS (
SELECT 1 FROM public.consultants c
LEFT JOIN auth.users u ON u.id = c.user_id
LEFT JOIN public.user_admin_state s ON s.user_id = c.user_id
WHERE c.id = _cid
AND ((u.banned_until IS NOT NULL AND u.banned_until > now())
OR s.deleted_at IS NOT NULL OR s.merged_into IS NOT NULL OR s.anonymised_at IS NOT NULL
OR (s.suspended_at IS NOT NULL AND (s.suspended_until IS NULL OR s.suspended_until > now()))))
$$;
REVOKE ALL ON FUNCTION public.referral_consultant_suspended(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_tier_qualifies(_referred uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT EXISTS (
SELECT 1 FROM public.consultant_referrals r JOIN public.consultants c ON c.id = r.referred_consultant_id
WHERE r.referred_consultant_id = _referred AND r.status = 'active' AND r.activation_status = 'active'
AND c.verification_status::text = 'verified' AND c.profile_submitted_at IS NOT NULL
AND NOT public.referral_consultant_suspended(c.id)
AND (NOT public.platform_flag('referral_tier_requires_paid', true)
OR (r.first_paid_at IS NOT NULL
AND r.first_paid_at <= greatest(COALESCE(r.referred_verified_at, r.attributed_at), COALESCE(r.approved_at, '-infinity'::timestamptz))
+ make_interval(days => public.referral_setting_num('referral_tier_paid_days', 90, 1, 365)::int))))
$$;
REVOKE ALL ON FUNCTION public.referral_tier_qualifies(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_verified_count(_referrer uuid)
RETURNS int
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT count(*)::int FROM public.consultant_referrals r
WHERE r.referrer_consultant_id = _referrer AND public.referral_tier_qualifies(r.referred_consultant_id)
$$;
REVOKE ALL ON FUNCTION public.referral_verified_count(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_tier_for(_count int)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
WITH t AS (SELECT (e ->> 'min')::int AS min, (e ->> 'rate')::numeric AS rate, e ->> 'name' AS name, o::int AS idx
FROM jsonb_array_elements(public.referral_tiers()) WITH ORDINALITY AS x(e, o)),
cur AS (SELECT * FROM t WHERE t.min <= greatest(COALESCE(_count, 0), 0) ORDER BY t.min DESC LIMIT 1),
nxt AS (SELECT * FROM t WHERE t.min > greatest(COALESCE(_count, 0), 0) ORDER BY t.min LIMIT 1)
SELECT jsonb_build_object('count', greatest(COALESCE(_count, 0), 0), 'index', cur.idx, 'name', cur.name, 'rate', cur.rate, 'min', cur.min,
'next_name', nxt.name, 'next_min', nxt.min, 'next_rate', nxt.rate,
'needed', CASE WHEN nxt.min IS NULL THEN NULL ELSE nxt.min - greatest(COALESCE(_count, 0), 0) END)
FROM cur LEFT JOIN nxt ON true
$$;
REVOKE ALL ON FUNCTION public.referral_tier_for(int) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_policy_ok(_cid uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF public.consultant_policy_current_version() IS NULL THEN RETURN true; END IF;
RETURN EXISTS (SELECT 1 FROM public.consultant_policy_acknowledgements a WHERE a.consultant_id = _cid)
AND NOT public.consultant_policy_blocked(_cid);
EXCEPTION WHEN undefined_function OR undefined_table THEN
RETURN true;
END
$$;
REVOKE ALL ON FUNCTION public.referral_policy_ok(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_passed_at(_cid uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT min(COALESCE(s.completed_at, s.updated_at, s.created_at))
FROM public.interview_sessions s
WHERE s.consultant_id = _cid AND s.interview_type::text = 'ai' AND s.status::text IN ('completed', 'reviewed')
AND s.overall_score IS NOT NULL AND s.overall_score >= (public.referral_settings() ->> 'pass_mark')::numeric
$$;
REVOKE ALL ON FUNCTION public.referral_passed_at(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_best_score(_cid uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT max(s.overall_score) FROM public.interview_sessions s
WHERE s.consultant_id = _cid AND s.interview_type::text = 'ai' AND s.status::text IN ('completed', 'reviewed')
$$;
REVOKE ALL ON FUNCTION public.referral_best_score(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_acked_at(_cid uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT min(a.accepted_at) FROM public.referral_acknowledgements a
WHERE a.consultant_id = _cid AND a.version = (public.referral_settings() ->> 'terms_version')::int
$$;
REVOKE ALL ON FUNCTION public.referral_acked_at(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_next_step(_referred uuid, _for uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
r record;
BEGIN
SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = _referred;
IF NOT FOUND OR r.activation_status <> 'pending' OR r.status = 'removed' THEN RETURN 'none'; END IF;
IF public.referral_passed_at(_for) IS NULL THEN RETURN 'pass_interview'; END IF;
IF public.referral_acked_at(_for) IS NULL THEN RETURN 'acknowledge'; END IF;
RETURN 'wait_other';
END
$$;
REVOKE ALL ON FUNCTION public.referral_next_step(uuid, uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_next_text(_step text, _other text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT CASE _step
WHEN 'pass_interview' THEN format('Pass the AI interview (score at least %s).', (public.referral_settings() ->> 'pass_mark'))
WHEN 'acknowledge' THEN 'Accept the referral terms on the Refer & earn page.'
WHEN 'wait_other' THEN format('Waiting for %s to pass the AI interview and accept the terms.', COALESCE(_other, 'the other consultant'))
ELSE 'Nothing to do.' END
$$;
REVOKE ALL ON FUNCTION public.referral_next_text(text, text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_chip(_referred uuid, _for uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
r record;
BEGIN
SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = _referred;
IF NOT FOUND THEN RETURN NULL; END IF;
IF r.status IN ('review', 'held') THEN RETURN 'under_review'; END IF;
IF r.activation_status = 'active' THEN RETURN 'active'; END IF;
IF r.activation_status = 'expired' THEN RETURN 'expired'; END IF;
RETURN CASE WHEN public.referral_next_step(_referred, _for) IN ('pass_interview', 'acknowledge') THEN 'waiting_you' ELSE 'waiting_them' END;
END
$$;
REVOKE ALL ON FUNCTION public.referral_chip(uuid, uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_log(_actor uuid, _action text, _referrer uuid, _referred uuid, _line uuid, _payout uuid,
_before jsonb, _after jsonb, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
INSERT INTO public.referral_events (actor, action, referrer_consultant_id, referred_consultant_id, line_id, payout_id, before, after, reason)
VALUES (_actor, _action, _referrer, _referred, _line, _payout, _before, _after, left(_reason, 500));
IF _actor IS NOT NULL THEN
BEGIN
INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
VALUES (_actor, 'referral.' || _action, 'referral', COALESCE(_line, _referred, _referrer),
jsonb_build_object('referrer', _referrer, 'referred', _referred, 'line', _line, 'payout', _payout,
'before', _before, 'after', _after, 'reason', left(_reason, 500)));
EXCEPTION WHEN OTHERS THEN
RAISE WARNING 'referral audit mirror skipped: %', SQLERRM;
END;
END IF;
END
$$;
REVOKE ALL ON FUNCTION public.referral_log(uuid, text, uuid, uuid, uuid, uuid, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_money(_v numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
SELECT round(_v, 2)
$$;
CREATE OR REPLACE FUNCTION public.referral_free_domain(_d text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
SELECT lower(COALESCE(_d, '')) IN ('gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de', 'yandex.com', 'yandex.ru', 'mail.ru', 'zoho.com', '')
$$;
CREATE OR REPLACE FUNCTION public.referral_norm_phone(_p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
SELECT CASE WHEN length(d) >= 8 THEN right(d, 9) END FROM (SELECT regexp_replace(COALESCE(_p, ''), '\D', '', 'g') AS d) x
$$;
CREATE OR REPLACE FUNCTION public.referral_flag_score(_flags text[])
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
SELECT COALESCE(sum(CASE WHEN regexp_replace(f, '^(client_|tenant_)', '') IN ('same_bank', 'same_phone', 'same_email', 'same_account') THEN 2 ELSE 1 END), 0)::int
FROM unnest(COALESCE(_flags, '{}'::text[])) f
$$;
CREATE OR REPLACE FUNCTION public.referral_user_ip_hashes(_user uuid)
RETURNS SETOF text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT d.hash FROM public.referral_devices d JOIN public.consultants c ON c.id = d.consultant_id WHERE c.user_id = _user AND d.kind = 'ip'
UNION
SELECT p.hash FROM public.referral_party_signals p WHERE p.user_id = _user AND p.kind = 'ip'
$$;
REVOKE ALL ON FUNCTION public.referral_user_ip_hashes(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_related_flags(_a uuid, _b uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_f text[] := '{}';
_ea text; _eb text; _pa text; _pb text;
BEGIN
IF _a IS NULL OR _b IS NULL THEN RETURN _f; END IF;
IF _a = _b THEN RETURN ARRAY['same_account']; END IF;
SELECT public.referral_norm_email(email) INTO _ea FROM auth.users WHERE id = _a;
SELECT public.referral_norm_email(email) INTO _eb FROM auth.users WHERE id = _b;
IF _ea IS NOT NULL AND _ea = _eb THEN _f := array_append(_f, 'same_email'); END IF;
IF _ea IS NOT NULL AND _eb IS NOT NULL AND split_part(_ea, '@', 2) = split_part(_eb, '@', 2)
AND NOT public.referral_free_domain(split_part(_ea, '@', 2)) THEN _f := array_append(_f, 'same_domain'); END IF;
SELECT public.referral_norm_phone(COALESCE(NULLIF(p.phone, ''), (SELECT cp.phone FROM public.client_profiles cp WHERE cp.user_id = _a LIMIT 1)))
INTO _pa FROM (SELECT 1) one LEFT JOIN public.profiles p ON p.user_id = _a;
SELECT public.referral_norm_phone(COALESCE(NULLIF(p.phone, ''), (SELECT cp.phone FROM public.client_profiles cp WHERE cp.user_id = _b LIMIT 1)))
INTO _pb FROM (SELECT 1) one LEFT JOIN public.profiles p ON p.user_id = _b;
IF _pa IS NOT NULL AND _pa = _pb THEN _f := array_append(_f, 'same_phone'); END IF;
IF EXISTS (SELECT 1 FROM public.referral_user_ip_hashes(_a) x JOIN public.referral_user_ip_hashes(_b) y ON x = y) THEN _f := array_append(_f, 'same_ip'); END IF;
RETURN _f;
END
$$;
REVOKE ALL ON FUNCTION public.referral_related_flags(uuid, uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_attribution_flags(_referrer uuid, _referred uuid, _dh text, _ih text)
RETURNS text[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
s jsonb := public.referral_settings();
_f text[] := '{}';
_ua uuid; _ub uuid;
BEGIN
SELECT user_id INTO _ua FROM public.consultants WHERE id = _referrer;
SELECT user_id INTO _ub FROM public.consultants WHERE id = _referred;
IF _dh IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_devices d WHERE d.consultant_id = _referrer AND d.kind = 'device' AND d.hash = _dh) THEN
_f := array_append(_f, 'same_device');
END IF;
IF _ih IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_devices d WHERE d.consultant_id = _referrer AND d.kind = 'ip' AND d.hash = _ih) THEN
_f := array_append(_f, 'same_ip');
END IF;
IF public.referral_same_bank(_referrer, _referred) THEN _f := array_append(_f, 'same_bank'); END IF;
_f := _f || ARRAY(SELECT x FROM unnest(public.referral_related_flags(_ua, _ub)) x WHERE x IN ('same_phone', 'same_domain', 'same_ip') AND NOT (x = ANY (_f)));
IF (SELECT count(*) FROM public.consultant_referrals r WHERE r.referrer_consultant_id = _referrer AND r.attributed_at > now() - interval '24 hours')
>= (s ->> 'velocity_day')::int THEN
_f := array_append(_f, 'velocity_referrer');
END IF;
IF _ih IS NOT NULL AND (SELECT count(*) FROM public.referral_attribution_signals x WHERE x.ip_hash = _ih AND x.created_at > now() - interval '24 hours')
>= (s ->> 'velocity_ip')::int THEN
_f := array_append(_f, 'velocity_ip');
END IF;
RETURN _f;
END
$$;
REVOKE ALL ON FUNCTION public.referral_attribution_flags(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_add_flags(_referred uuid, _new text[], _why text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
r record;
_all text[];
_score int;
BEGIN
SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = _referred FOR UPDATE;
IF NOT FOUND OR r.status = 'removed' THEN RETURN; END IF;
_all := ARRAY(SELECT DISTINCT x FROM unnest(r.flags || COALESCE(_new, '{}'::text[])) x WHERE x IS NOT NULL ORDER BY 1);
IF _all <@ r.flags THEN RETURN; END IF;
_score := public.referral_flag_score(_all);
UPDATE public.consultant_referrals
SET flags = _all, flag_score = _score,
status = CASE WHEN status = 'active' AND _score >= (public.referral_settings() ->> 'flag_threshold')::int THEN 'review' ELSE status END,
updated_at = now()
WHERE referred_consultant_id = _referred;
IF r.status = 'active' AND _score >= (public.referral_settings() ->> 'flag_threshold')::int THEN
UPDATE public.referral_reward_lines SET status = 'held', hold_reason = 'review', updated_at = now()
WHERE referred_consultant_id = _referred AND kind = 'reward' AND status IN ('pending', 'available');
END IF;
PERFORM public.referral_log(NULL, 'flagged', r.referrer_consultant_id, _referred, NULL, NULL,
jsonb_build_object('flags', r.flags, 'status', r.status),
jsonb_build_object('flags', _all, 'score', _score), _why);
END
$$;
REVOKE ALL ON FUNCTION public.referral_add_flags(uuid, text[], text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_code_locked(_who text[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT EXISTS (SELECT 1 FROM public.referral_code_attempts a WHERE a.who = ANY (_who) AND a.locked_until > now())
$$;
REVOKE ALL ON FUNCTION public.referral_code_locked(text[]) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_code_failed(_who text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
w text;
BEGIN
FOREACH w IN ARRAY _who LOOP
CONTINUE WHEN w IS NULL;
INSERT INTO public.referral_code_attempts AS a (who, window_start, invalid) VALUES (w, now(), 1)
ON CONFLICT (who) DO UPDATE
SET invalid = CASE WHEN a.window_start < now() - interval '1 hour' THEN 1 ELSE a.invalid + 1 END,
window_start = CASE WHEN a.window_start < now() - interval '1 hour' THEN now() ELSE a.window_start END,
locked_until = CASE WHEN a.window_start >= now() - interval '1 hour' AND a.invalid + 1 >= 10 THEN now() + interval '1 hour' ELSE a.locked_until END;
END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.referral_code_failed(text[]) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_admin_is_party(_consultants uuid[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ANY (_consultants) AND c.user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.referral_admin_is_party(uuid[]) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_wake()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF to_regnamespace('net') IS NULL THEN RETURN; END IF;
IF NOT EXISTS (SELECT 1 FROM public.referral_email_queue q WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5) THEN RETURN; END IF;
EXECUTE $q$SELECT net.http_post(url := $1, headers := jsonb_build_object('Content-Type', 'application/json'), body := '{}'::jsonb)$q$
USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/referral-run';
END
$$;
REVOKE ALL ON FUNCTION public.referral_wake() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_queue_wake_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$ BEGIN PERFORM public.referral_wake(); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS trg_referral_queue_wake ON public.referral_email_queue;
CREATE TRIGGER trg_referral_queue_wake
AFTER INSERT ON public.referral_email_queue
FOR EACH STATEMENT EXECUTE FUNCTION public.referral_queue_wake_trigger();
CREATE OR REPLACE FUNCTION public.referral_notify(_to uuid, _kind text, _other uuid, _amount numeric, _currency text, _next text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_user uuid;
_name text := public.referral_masked_name(_other);
s jsonb := public.referral_settings();
_title text;
_body text;
_step text := COALESCE(_next, 'none');
BEGIN
SELECT c.user_id INTO _user FROM public.consultants c WHERE c.id = _to;
IF _user IS NULL THEN RETURN; END IF;
IF _kind = 'signup' THEN
_title := 'Someone registered with your referral code';
_body := format('%s registered with your code. Your referral becomes active when you both pass the AI interview. Your current rate: %s %% (%s).',
_name, public.referral_tier_for(public.referral_verified_count(_to)) ->> 'rate', public.referral_tier_for(public.referral_verified_count(_to)) ->> 'name');
ELSIF _kind = 'invited' THEN
_title := 'You were invited to AI Support 360';
_body := format('You were invited by %s. The referral programme becomes active after you and your referrer pass the AI interview.', _name);
ELSIF _kind = 'passed_self' THEN
_title := 'You passed the AI interview';
_body := 'You passed the AI interview. Next for your referral: ' || public.referral_next_text(_step, _name);
ELSIF _kind = 'passed_other' THEN
_title := 'Your referral partner passed the AI interview';
_body := format('%s passed the AI interview. Next for your referral: ', _name) || public.referral_next_text(_step, _name);
ELSIF _kind = 'active' THEN
_title := 'Your referral is active';
_body := format('Your referral with %s is now active. Rewards count for work invoiced from today.', _name);
ELSIF _kind = 'reminder' THEN
_title := 'Your referral is still pending';
_body := format('Your referral with %s is still pending. Next step: ', _name) || public.referral_next_text(_step, _name);
ELSIF _kind = 'expired' THEN
_title := 'Your referral has expired';
_body := format('Your referral with %s has expired: both of you had to pass the AI interview and accept the terms within %s days. An administrator can revive it.',
_name, (s->>'activation_days'));
ELSIF _kind = 'ack_request' THEN
_title := 'Please accept the referral terms';
_body := format('Please accept the referral terms so your referral with %s can become active.', _name);
ELSIF _kind = 'verified' THEN
_title := 'Your referral is verified';
_body := format('%s is now a verified consultant. Your reward starts with their first paid ticket after your referral is active.', _name);
ELSE
_title := 'You earned your first referral reward';
_body := format('You earned %s %s from the work of %s. It becomes available when their payout is completed.',
to_char(_amount, 'FM999999990.00'), COALESCE(_currency, 'USD'), _name);
END IF;
PERFORM public.safe_insert_notification(_user, _title, _body, 'referral', '/consultant/referrals');
INSERT INTO public.referral_email_queue (user_id, kind, referred_name, amount, currency, next_step, days)
VALUES (_user, _kind, _name, _amount, _currency, _step, (s->>'activation_days')::int);
END
$$;
REVOKE ALL ON FUNCTION public.referral_notify(uuid, text, uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_email_claim(_limit int DEFAULT 100)
RETURNS TABLE (id uuid, user_id uuid, kind text, lang text, display_name text, referred_name text, amount numeric, currency text,
rate_percent numeric, months int, next_step text, days int, pass_mark numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
s jsonb := public.referral_settings();
BEGIN
IF (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
RAISE EXCEPTION 'forbidden';
END IF;
RETURN QUERY
WITH picked AS (
SELECT q.id FROM public.referral_email_queue q
WHERE q.sent_at IS NULL AND q.failed_at IS NULL AND q.attempts < 5
AND (q.claimed_at IS NULL OR q.claimed_at < now() - interval '10 minutes')
ORDER BY q.created_at
LIMIT greatest(1, least(COALESCE(_limit, 100), 200))
FOR UPDATE SKIP LOCKED
), upd AS (
UPDATE public.referral_email_queue q SET claimed_at = now(), attempts = q.attempts + 1
FROM picked WHERE q.id = picked.id
RETURNING q.id, q.user_id, q.kind, q.referred_name, q.amount, q.currency, q.next_step, q.days
)
SELECT u.id, u.user_id, u.kind,
(SELECT CASE WHEN p.preferred_language = 'ar' THEN 'ar' ELSE 'en' END FROM public.profiles p WHERE p.user_id = u.user_id),
(SELECT p.display_name FROM public.profiles p WHERE p.user_id = u.user_id),
u.referred_name, u.amount, u.currency, (s->>'rate_percent')::numeric, (s->>'months')::int, u.next_step, u.days,
(s->>'pass_mark')::numeric
FROM upd u;
END
$$;
REVOKE ALL ON FUNCTION public.referral_email_claim(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_email_claim(int) TO service_role;
CREATE OR REPLACE FUNCTION public.referral_email_done(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
RAISE EXCEPTION 'forbidden';
END IF;
UPDATE public.referral_email_queue
SET sent_at = CASE WHEN _ok THEN now() END,
failed_at = CASE WHEN NOT _ok AND attempts >= 5 THEN now() END,
claimed_at = CASE WHEN _ok THEN claimed_at END,
last_error = CASE WHEN _ok THEN NULL ELSE left(_error, 200) END
WHERE id = _id;
END
$$;
REVOKE ALL ON FUNCTION public.referral_email_done(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_email_done(uuid, boolean, text) TO service_role;