CREATE OR REPLACE FUNCTION public.referral_backfill_codes()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
x record;
_n int := 0;
BEGIN
FOR x IN SELECT c.id FROM public.consultants c
WHERE c.verification_status::text NOT IN ('rejected', 'suspended')
AND NOT EXISTS (SELECT 1 FROM public.consultant_referral_codes k WHERE k.consultant_id = c.id)
ORDER BY c.created_at LOOP
PERFORM public.referral_ensure_code(x.id);
_n := _n + 1;
END LOOP;
RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.referral_backfill_codes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_backfill_codes() TO service_role;
SELECT public.referral_backfill_preview() AS backfill_before;
SELECT public.referral_backfill_codes() AS codes_created;
CREATE TABLE IF NOT EXISTS public.referral_announcements (
consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
user_id uuid NOT NULL,
sent_at timestamptz NOT NULL DEFAULT now(),
sent_by uuid,
channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app'))
);
GRANT SELECT ON public.referral_announcements TO authenticated;
GRANT ALL ON public.referral_announcements TO service_role;
ALTER TABLE public.referral_announcements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read referral announcements" ON public.referral_announcements;
CREATE POLICY "Admins read referral announcements" ON public.referral_announcements
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE OR REPLACE FUNCTION public.referral_announcement_status(_cid uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
c record;
BEGIN
SELECT * INTO c FROM public.consultants WHERE id = _cid;
IF NOT FOUND THEN RETURN 'missing'; END IF;
IF EXISTS (SELECT 1 FROM public.referral_announcements a WHERE a.consultant_id = _cid) THEN RETURN 'already_sent'; END IF;
IF c.verification_status::text IN ('rejected', 'suspended') THEN RETURN 'rejected_or_suspended'; END IF;
IF public.referral_consultant_suspended(_cid) THEN RETURN 'account_suspended'; END IF;
IF to_regprocedure('public.notifications_paused(uuid,text,text)') IS NOT NULL THEN
BEGIN
IF public.notifications_paused(c.user_id, 'activity', 'in_app') THEN RETURN 'paused'; END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END;
END IF;
RETURN 'eligible';
END
$$;
REVOKE ALL ON FUNCTION public.referral_announcement_status(uuid) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_announcement_text()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
SELECT jsonb_build_object(
'title', 'Introducing Refer & earn',
'body', format('Bring colleagues, earn together: you earn %s %% to %s %% (rising with the number of verified consultants you referred) of the fee of every consultant you refer, for %s months from their first paid ticket - paid by AI Support 360, never deducted from them. It starts after you both pass the AI interview. Open Refer & earn to see your code.',
s -> 'tiers' -> 0 ->> 'rate', s -> 'tiers' -> (jsonb_array_length(s -> 'tiers') - 1) ->> 'rate', s ->> 'months'))
FROM (SELECT public.referral_settings() AS s) x
$$;
REVOKE ALL ON FUNCTION public.referral_announcement_text() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_announcement_preview(_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN (
WITH st AS (SELECT c.id, p.display_name, public.referral_announcement_status(c.id) AS status
FROM public.consultants c LEFT JOIN public.profiles p ON p.user_id = c.user_id)
SELECT jsonb_build_object(
'message', public.referral_announcement_text(),
'counts', (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM st GROUP BY status) q),
'recipients', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', display_name)) FROM (
SELECT display_name FROM st WHERE status = 'eligible' ORDER BY display_name LIMIT greatest(1, least(COALESCE(_limit, 50), 500))) r), '[]'::jsonb)));
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_announcement_preview(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_announcement_preview(int) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_announcement_send(_test boolean DEFAULT true, _limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
m jsonb := public.referral_announcement_text();
x record;
_n int := 0;
_left int;
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
IF NOT public.check_rate_limit('refannounce:' || auth.uid()::text, 10, 3600) THEN
RAISE EXCEPTION 'Too many sends in a short time. Please wait a little.' USING ERRCODE = 'P0001';
END IF;
IF COALESCE(_test, true) THEN
PERFORM public.safe_insert_notification(auth.uid(), '[TEST] ' || (m ->> 'title'), m ->> 'body', 'referral_intro', '/consultant/referrals');
PERFORM public.referral_log(auth.uid(), 'announcement_test', NULL, NULL, NULL, NULL, NULL, NULL, 'Test to own account');
RETURN jsonb_build_object('test', true, 'sent', 1);
END IF;
FOR x IN SELECT c.id, c.user_id FROM public.consultants c
WHERE public.referral_announcement_status(c.id) = 'eligible'
ORDER BY c.created_at
LIMIT greatest(1, least(COALESCE(_limit, 200), 200)) LOOP
INSERT INTO public.referral_announcements (consultant_id, user_id, sent_by) VALUES (x.id, x.user_id, auth.uid())
ON CONFLICT (consultant_id) DO NOTHING;
IF FOUND THEN
PERFORM public.safe_insert_notification(x.user_id, m ->> 'title', m ->> 'body', 'referral_intro', '/consultant/referrals');
_n := _n + 1;
END IF;
END LOOP;
SELECT count(*) INTO _left FROM public.consultants c WHERE public.referral_announcement_status(c.id) = 'eligible';
PERFORM public.referral_log(auth.uid(), 'announcement_sent', NULL, NULL, NULL, NULL, NULL, jsonb_build_object('sent', _n, 'remaining', _left), 'In-app announcement');
RETURN jsonb_build_object('test', false, 'sent', _n, 'remaining', _left);
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_announcement_send(boolean, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_announcement_send(boolean, int) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_announcement_log(_limit int DEFAULT 500)
RETURNS TABLE (name text, sent_at timestamptz, sent_by_name text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN QUERY
SELECT p.display_name, a.sent_at, pb.display_name
FROM public.referral_announcements a
LEFT JOIN public.profiles p ON p.user_id = a.user_id
LEFT JOIN public.profiles pb ON pb.user_id = a.sent_by
ORDER BY a.sent_at DESC
LIMIT greatest(1, least(COALESCE(_limit, 500), 2000));
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_announcement_log(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_announcement_log(int) TO authenticated;
CREATE OR REPLACE FUNCTION public.referral_daily_reconcile()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_bad int;
_list text;
BEGIN
SELECT count(*), string_agg(DISTINCT check_name, ', ') INTO _bad, _list FROM public.referral_reconcile_rows(NULL, true);
IF _bad > 0 THEN
PERFORM public.referral_log(NULL, 'reconcile_failed', NULL, NULL, NULL, NULL, NULL, jsonb_build_object('problems', _bad, 'checks', _list), NULL);
INSERT INTO public.notifications (user_id, title, body, type, link)
SELECT DISTINCT ur.user_id, 'Referral reconciliation failed',
format('%s referral reconciliation problem(s): %s. Open Referrals, Reconciliation now; referral payouts should wait until it is clear.', _bad, _list),
'security', '/admin/referrals'
FROM public.user_roles ur WHERE ur.role = 'super_admin';
END IF;
RETURN _bad;
END
$$;
REVOKE ALL ON FUNCTION public.referral_daily_reconcile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_daily_reconcile() TO service_role;
CREATE OR REPLACE FUNCTION public.admin_referral_anomalies()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_max numeric := (public.referral_settings() ->> 'max_rate')::numeric;
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN jsonb_build_object(
'top_earners', COALESCE((SELECT jsonb_agg(t ORDER BY t.amount DESC) FROM (
SELECT l.referrer_consultant_id AS consultant_id, p.display_name AS name, l.currency, sum(l.amount) AS amount, count(*) AS lines
FROM public.referral_reward_lines l JOIN public.consultants c ON c.id = l.referrer_consultant_id LEFT JOIN public.profiles p ON p.user_id = c.user_id
WHERE l.created_at > now() - interval '30 days' AND l.status <> 'reversed'
GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 10) t), '[]'::jsonb),
'fast_risers', COALESCE((SELECT jsonb_agg(t ORDER BY t.new_7d DESC) FROM (
SELECT r.referrer_consultant_id AS consultant_id, p.display_name AS name,
count(*) FILTER (WHERE r.attributed_at > now() - interval '7 days') AS new_7d,
count(*) FILTER (WHERE r.attributed_at > now() - interval '30 days') AS new_30d,
public.referral_verified_count(r.referrer_consultant_id) AS tier_count
FROM public.consultant_referrals r JOIN public.consultants c ON c.id = r.referrer_consultant_id LEFT JOIN public.profiles p ON p.user_id = c.user_id
WHERE r.status <> 'removed'
GROUP BY 1, 2 HAVING count(*) FILTER (WHERE r.attributed_at > now() - interval '7 days') >= 3
ORDER BY 3 DESC LIMIT 20) t), '[]'::jsonb),
'network_clusters', COALESCE((SELECT jsonb_agg(jsonb_build_object('cluster', n, 'members', m, 'size', k) ORDER BY k DESC) FROM (
SELECT row_number() OVER (ORDER BY count(*) DESC) AS n, count(*) AS k,
jsonb_agg(jsonb_build_object('consultant_id', d.consultant_id, 'name', p.display_name)) AS m
FROM public.referral_devices d JOIN public.consultants c ON c.id = d.consultant_id LEFT JOIN public.profiles p ON p.user_id = c.user_id
WHERE d.kind = 'ip' AND EXISTS (SELECT 1 FROM public.consultant_referrals r WHERE d.consultant_id IN (r.referrer_consultant_id, r.referred_consultant_id))
GROUP BY d.hash HAVING count(*) >= 2 LIMIT 50) x), '[]'::jsonb),
'bank_clusters', COALESCE((SELECT jsonb_agg(jsonb_build_object('cluster', n, 'members', m, 'size', k) ORDER BY k DESC) FROM (
SELECT row_number() OVER (ORDER BY count(*) DESC) AS n, count(*) AS k,
jsonb_agg(jsonb_build_object('consultant_id', b.consultant_id, 'name', p.display_name)) AS m
FROM (SELECT d.consultant_id,
public.referral_hash('bank:' || COALESCE(NULLIF(upper(regexp_replace(COALESCE(d.iban, ''), '\s', '', 'g')), ''),
NULLIF(regexp_replace(COALESCE(d.account_number, ''), '[\s-]', '', 'g'), ''))) AS h
FROM public.consultant_payout_details d
WHERE EXISTS (SELECT 1 FROM public.consultant_referrals r WHERE d.consultant_id IN (r.referrer_consultant_id, r.referred_consultant_id))) b
JOIN public.consultants c ON c.id = b.consultant_id LEFT JOIN public.profiles p ON p.user_id = c.user_id
WHERE b.h IS NOT NULL
GROUP BY b.h HAVING count(*) >= 2 LIMIT 50) x), '[]'::jsonb),
'reversal_ratio', COALESCE((SELECT jsonb_agg(t ORDER BY t.ratio DESC) FROM (
SELECT l.referrer_consultant_id AS consultant_id, p.display_name AS name,
count(*) FILTER (WHERE l.kind = 'reward') AS rewards,
count(*) FILTER (WHERE l.kind = 'reversal') AS reversals,
round(count(*) FILTER (WHERE l.kind = 'reversal')::numeric / greatest(count(*) FILTER (WHERE l.kind = 'reward'), 1), 2) AS ratio
FROM public.referral_reward_lines l JOIN public.consultants c ON c.id = l.referrer_consultant_id LEFT JOIN public.profiles p ON p.user_id = c.user_id
GROUP BY 1, 2
HAVING count(*) FILTER (WHERE l.kind = 'reversal') > 0
AND count(*) FILTER (WHERE l.kind = 'reversal')::numeric / greatest(count(*) FILTER (WHERE l.kind = 'reward'), 1) >= 0.2
LIMIT 50) t), '[]'::jsonb),
'rewards_vs_invoices', COALESCE((SELECT jsonb_agg(t ORDER BY t.currency) FROM (
SELECT l.currency, sum(l.amount) FILTER (WHERE l.kind = 'reward') AS rewards, sum(l.fee_amount) FILTER (WHERE l.kind = 'reward') AS fees,
round(100 * sum(l.amount) FILTER (WHERE l.kind = 'reward') / NULLIF(sum(l.fee_amount) FILTER (WHERE l.kind = 'reward'), 0), 3) AS percent,
_max AS max_percent
FROM public.referral_reward_lines l GROUP BY l.currency) t), '[]'::jsonb),
'over_max_rate', (SELECT count(*) FROM public.referral_reward_lines l WHERE l.kind = 'reward' AND l.fee_amount > 0 AND l.amount > public.referral_money(l.fee_amount * _max / 100)),
'held_related_party', (SELECT count(*) FROM public.referral_reward_lines l WHERE l.status = 'held' AND l.hold_reason = 'related_party'),
'held_cap', (SELECT count(*) FROM public.referral_reward_lines l WHERE l.status = 'held' AND l.hold_reason = 'cap'),
'under_review', (SELECT count(*) FROM public.consultant_referrals WHERE status = 'review'),
'reconcile_problems', (SELECT count(*) FROM public.referral_reconcile_rows(NULL, true)));
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_anomalies() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_anomalies() TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_adjust_requests(_status text DEFAULT 'pending')
RETURNS TABLE (id uuid, consultant_id uuid, consultant_name text, amount numeric, currency text, reason text, requested_by_name text,
requested_by_me boolean, status text, decided_by_name text, decided_at timestamptz, decision_note text, created_at timestamptz,
expires_at timestamptz, can_decide boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
RETURN QUERY
SELECT q.id, q.consultant_id, pc.display_name, q.amount, q.currency, q.reason, pr.display_name, q.requested_by = auth.uid(), q.status,
pd.display_name, q.decided_at, q.decision_note, q.created_at, q.expires_at,
q.status = 'pending' AND q.expires_at > now() AND q.requested_by <> auth.uid() AND public.has_role(auth.uid(), 'super_admin')
AND NOT public.referral_admin_is_party(ARRAY[q.consultant_id])
FROM public.referral_adjust_requests q
JOIN public.consultants c ON c.id = q.consultant_id
LEFT JOIN public.profiles pc ON pc.user_id = c.user_id
LEFT JOIN public.profiles pr ON pr.user_id = q.requested_by
LEFT JOIN public.profiles pd ON pd.user_id = q.decided_by
WHERE COALESCE(_status, 'all') = 'all' OR q.status = _status
ORDER BY q.created_at DESC
LIMIT 200;
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_adjust_requests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_adjust_requests(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.admin_referral_decide_adjustment(_request uuid, _approve boolean, _note text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
q record;
_line uuid;
_why text := left(btrim(COALESCE(_note, '')), 500);
BEGIN
IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'super_admin') THEN
RAISE EXCEPTION 'Only a super administrator can approve adjustments' USING ERRCODE = '42501';
END IF;
IF NOT public.check_rate_limit('refdecide:' || auth.uid()::text, 60, 600) THEN
RAISE EXCEPTION 'Too many changes in a short time. Please wait a few minutes.' USING ERRCODE = 'P0001';
END IF;
IF length(_why) < 5 THEN RAISE EXCEPTION 'Write a short reason (at least 5 characters).' USING ERRCODE = '22023'; END IF;
SELECT * INTO q FROM public.referral_adjust_requests WHERE id = _request FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Request not found' USING ERRCODE = '42704'; END IF;
IF q.status <> 'pending' OR q.expires_at <= now() THEN RAISE EXCEPTION 'This request is no longer open' USING ERRCODE = '22023'; END IF;
IF q.requested_by = auth.uid() THEN RAISE EXCEPTION 'A second administrator must decide (four-eyes rule)' USING ERRCODE = '42501'; END IF;
IF public.referral_admin_is_party(ARRAY[q.consultant_id]) THEN
RAISE EXCEPTION 'You can not approve an adjustment of your own referral account' USING ERRCODE = '42501';
END IF;
IF _approve THEN
INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, amount, currency, status, note, created_by, available_at)
VALUES ('adjust:request:' || q.id::text, 'adjustment', q.consultant_id, q.amount, q.currency, 'available', q.reason, q.requested_by, now())
ON CONFLICT (unique_key) DO NOTHING
RETURNING id INTO _line;
END IF;
UPDATE public.referral_adjust_requests
SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, decided_by = auth.uid(), decided_at = now(), decision_note = _why, line_id = _line
WHERE id = q.id;
PERFORM public.referral_log(auth.uid(), CASE WHEN _approve THEN 'adjust_approved' ELSE 'adjust_rejected' END, q.consultant_id, NULL, _line, NULL,
jsonb_build_object('request', q.id, 'status', 'pending', 'requested_by', q.requested_by),
jsonb_build_object('status', CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, 'amount', q.amount, 'currency', q.currency), _why);
RETURN jsonb_build_object('ok', true, 'line', _line);
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_decide_adjustment(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_decide_adjustment(uuid, boolean, text) TO authenticated;
DO $$
DECLARE
t text;
BEGIN
FOREACH t IN ARRAY ARRAY['consultant_referral_codes', 'consultant_referrals', 'referral_clicks', 'referral_devices', 'referral_reward_lines',
'referral_terms_versions', 'referral_acknowledgements', 'referral_events', 'referral_email_queue', 'referral_private',
'referral_attribution_signals', 'referral_party_signals', 'referral_code_attempts', 'referral_adjust_requests',
'referral_statements', 'referral_announcements'] LOOP
IF to_regclass('public.' || t) IS NOT NULL THEN
EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM PUBLIC, anon, authenticated', t);
END IF;
END LOOP;
END
$$;
REVOKE ALL ON FUNCTION public.referral_norm_code(text), public.referral_norm_email(text), public.referral_code_blocked_word(text),
public.referral_random(int), public.referral_name_part(text), public.referral_tiers_valid(jsonb, numeric),
public.referral_money(numeric), public.referral_free_domain(text), public.referral_norm_phone(text),
public.referral_flag_score(text[]), public.referral_request_ip(), public.referral_ack_append_only()
FROM PUBLIC, anon, authenticated;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('referral-nightly', 'referral-weekly-digest', 'referral-monthly-statements');
SELECT cron.schedule('referral-nightly', '23 2 * * *', 'SELECT public.referral_nightly()');
SELECT cron.schedule('referral-weekly-digest', '37 4 * * 1', 'SELECT public.referral_weekly_digest()');
SELECT cron.schedule('referral-monthly-statements', '19 3 1 * *', 'SELECT public.referral_generate_statements(NULL)');
DO $$
DECLARE
f record;
BEGIN
FOR f IN
SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname ~ '^(referral_|my_referral|admin_referral_)'
AND p.proname NOT LIKE 'admin_referral_%' AND p.proname NOT LIKE 'my_referral%'
AND p.proname NOT IN ('referral_validate_code', 'referral_track_click', 'referral_public_settings', 'referral_claim', 'referral_accept_terms',
'referral_update_code', 'referral_is_admin', 'referral_calc_summary', 'referral_calc_referrals', 'referral_calc_lines',
'referral_calc_monthly', 'referral_calc_forecast', 'referral_calc_statements')
LOOP
EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
END LOOP;
FOR f IN
SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND (p.proname LIKE 'admin_referral_%' OR p.proname LIKE 'my_referral%')
LOOP
EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
END LOOP;
END
$$;
CREATE OR REPLACE FUNCTION public.referral_public_hold_reason(_reason text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
SELECT CASE WHEN _reason IS NULL THEN NULL
WHEN _reason = 'dispute' THEN 'dispute'
WHEN _reason = 'cap' THEN 'cap'
ELSE 'review' END
$$;
REVOKE ALL ON FUNCTION public.referral_public_hold_reason(text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.referral_payout_ref(_payout uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
SELECT CASE WHEN _payout IS NULL THEN NULL ELSE 'RP-' || upper(left(replace(_payout::text, '-', ''), 8)) END
$$;
REVOKE ALL ON FUNCTION public.referral_payout_ref(uuid) FROM PUBLIC, anon, authenticated;
DROP FUNCTION IF EXISTS public.my_referral_reward_lines(int);
CREATE OR REPLACE FUNCTION public.my_referral_reward_lines(_limit int DEFAULT 2000)
RETURNS TABLE (line_ref text, created_at timestamptz, ref_key text, referred_name text, kind text, status text, hold_reason text,
engagement_ref text, approved_hours numeric, man_days numeric, fee_amount numeric, rate_percent numeric, tier_name text,
amount numeric, currency text, released_at timestamptz, matures_at timestamptz, available_at timestamptz,
paid_at timestamptz, payout_ref text, note text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
BEGIN
IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants can open the referral programme' USING ERRCODE = '42501'; END IF;
RETURN QUERY
SELECT 'L-' || upper(left(public.referral_hash('line:' || l.id::text), 6)),
l.created_at,
CASE WHEN l.referred_consultant_id IS NULL THEN NULL ELSE public.referral_ref_key(l.referrer_consultant_id, l.referred_consultant_id) END,
public.referral_masked_name(l.referred_consultant_id),
l.kind, l.status,
CASE WHEN l.status = 'held' THEN public.referral_public_hold_reason(l.hold_reason) END,
public.referral_engagement_ref(l.referrer_consultant_id, COALESCE(p.ticket_id, p.id)),
ts.billable_hours,
CASE WHEN ts.billable_hours IS NULL THEN NULL ELSE round(ts.billable_hours / 8, 2) END,
l.fee_amount, l.rate_percent, l.tier_name, l.amount, l.currency,
l.released_at, l.matures_at, l.available_at, l.paid_at,
public.referral_payout_ref(l.referral_payout_id),
CASE WHEN l.kind = 'reward' THEN NULL ELSE l.note END
FROM public.referral_reward_lines l
LEFT JOIN public.payouts po ON po.id = l.source_payout_id
LEFT JOIN public.payments p ON p.id = COALESCE(l.payment_id, po.payment_id)
LEFT JOIN public.ticket_timesheet_submissions ts ON ts.id = p.timesheet_id AND l.kind = 'reward'
WHERE l.referrer_consultant_id = _cid
ORDER BY l.created_at DESC
LIMIT greatest(1, least(COALESCE(_limit, 2000), 5000));
END
$$;
REVOKE ALL ON FUNCTION public.my_referral_reward_lines(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_reward_lines(int) TO authenticated;
DROP FUNCTION IF EXISTS public.my_referral_payouts();
CREATE OR REPLACE FUNCTION public.my_referral_payouts()
RETURNS TABLE (payout_ref text, bank_reference text, created_at timestamptz, amount numeric, currency text, status text,
due_by date, paid_at timestamptz, lines int)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
BEGIN
IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants can open the referral programme' USING ERRCODE = '42501'; END IF;
RETURN QUERY
SELECT public.referral_payout_ref(po.id), NULLIF(btrim(po.bank_reference), ''), po.created_at, po.amount, po.currency,
po.status::text, po.due_by, CASE WHEN po.status::text = 'completed' THEN po.paid_at END,
(SELECT count(*)::int FROM public.referral_reward_lines l WHERE l.referral_payout_id = po.id AND l.referrer_consultant_id = _cid)
FROM public.payouts po
WHERE po.consultant_id = _cid AND COALESCE(po.reference, '') LIKE 'referral:%'
ORDER BY po.created_at DESC
LIMIT 200;
END
$$;
REVOKE ALL ON FUNCTION public.my_referral_payouts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_payouts() TO authenticated;
CREATE OR REPLACE FUNCTION public.my_referral_tracking()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
s jsonb := public.referral_settings();
_cur int := (s ->> 'terms_version')::int;
_acc record;
BEGIN
IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants can open the referral programme' USING ERRCODE = '42501'; END IF;
SELECT a.version, a.accepted_at INTO _acc FROM public.referral_acknowledgements a
WHERE a.consultant_id = _cid ORDER BY a.version DESC, a.accepted_at ASC LIMIT 1;
RETURN jsonb_build_object(
'terms', jsonb_build_object(
'current_version', _cur,
'published_at', (SELECT v.published_at FROM public.referral_terms_versions v WHERE v.version = _cur),
'is_draft', COALESCE((SELECT v.is_draft FROM public.referral_terms_versions v WHERE v.version = _cur), true),
'accepted_version', _acc.version,
'accepted_at', _acc.accepted_at,
'accepted_current_at', public.referral_acked_at(_cid)),
'rejected', COALESCE((
SELECT jsonb_agg(jsonb_build_object(
'referred_name', public.referral_masked_name(r.referred_consultant_id),
'attributed_at', r.attributed_at,
'decided_at', r.updated_at,
'reason', CASE WHEN c.verification_status::text IN ('rejected', 'suspended') OR public.referral_consultant_suspended(r.referred_consultant_id)
THEN 'account_closed'
WHEN r.flag_score > 0 OR cardinality(r.flags) > 0 THEN 'review_failed'
ELSE 'rules' END)
ORDER BY r.updated_at DESC)
FROM public.consultant_referrals r
JOIN public.consultants c ON c.id = r.referred_consultant_id
WHERE r.referrer_consultant_id = _cid AND r.status = 'removed'), '[]'::jsonb),
'generated_at', now());
END
$$;
REVOKE ALL ON FUNCTION public.my_referral_tracking() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_tracking() TO authenticated;
CREATE OR REPLACE FUNCTION public.my_referral_nav_state()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
_cid uuid := public.referral_my_consultant();
BEGIN
IF _cid IS NULL THEN RETURN NULL; END IF;
RETURN jsonb_build_object(
'enabled', COALESCE((public.referral_settings() ->> 'enabled')::boolean, false),
'latest_line_at', (SELECT max(l.created_at) FROM public.referral_reward_lines l WHERE l.referrer_consultant_id = _cid),
'pending_referrals', (SELECT count(*)::int FROM public.consultant_referrals r
WHERE r.referrer_consultant_id = _cid AND r.status <> 'removed' AND r.activation_status = 'pending'));
END
$$;
REVOKE ALL ON FUNCTION public.my_referral_nav_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_nav_state() TO authenticated;