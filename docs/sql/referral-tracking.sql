-- Feature Z "Refer & earn" page upgrade: read-only tracking RPCs for the signed-in consultant (own data only).
-- PREPARED, NOT APPLIED. Apply AFTER docs/sql/referral-program.sql. Checks: docs/sql/referral-tracking.test.sql.
--
-- Same rules as the rest of Feature Z (docs/referral-security.md):
--   * every function is SECURITY DEFINER with a fixed search_path; EXECUTE is revoked from PUBLIC/anon, internal helpers
--     also from authenticated;
--   * the consultant is always taken from auth.uid() (referral_my_consultant) - no argument can name another consultant;
--   * no ids, hashes, client identity, ticket title or the referred consultant's hourly rate are returned: only the
--     masked name (Feature X public format), an anonymous "Engagement #XXXX", approved hours and the fee of the line;
--   * hold reasons are reduced to three public words (review / dispute / cap) so fraud signals are never revealed;
--   * rejected referrals get one plain reason category, never the administrator's note or the fraud flags.
-- Nothing here writes data.

-- Internal: public word for a hold reason (related_party and admin holds read as "review").
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

-- Internal: short, stable payout reference "RP-1A2B3C4D" (first 8 hex digits of the consultant's OWN payout row, so
-- support can find it; it can not be used to reach anything else).
CREATE OR REPLACE FUNCTION public.referral_payout_ref(_payout uuid)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $$
  SELECT CASE WHEN _payout IS NULL THEN NULL ELSE 'RP-' || upper(left(replace(_payout::text, '-', ''), 8)) END
$$;
REVOKE ALL ON FUNCTION public.referral_payout_ref(uuid) FROM PUBLIC, anon, authenticated;

-- Every reward / reversal / adjustment line of the signed-in referrer with its calculation breakdown.
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

-- Referral payouts of the signed-in consultant (normal payouts rows with reference 'referral:%').
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

-- Terms status (accepted version and date, current version, draft flag) and rejected referrals with a plain reason.
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

-- Menu dot: the newest reward line and the number of referrals still waiting for activation. NULL for non-consultants
-- (the menu calls it on every page, so it never raises).
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
