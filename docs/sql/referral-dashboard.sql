-- Admin › Referrals › Dashboard: one read-only, administrators-only summary of the referral programme.
-- Invitations sent (launch announcement + Refer & earn invitations), rewards issued, referral payout dates and a monthly
-- forecast. Every amount is a database aggregate; nothing is written. Months follow Asia/Riyadh like the overview.
-- Forecast is honest: (1) "maturing" = reward lines already earned whose hold ends in that month (can still be reversed),
-- (2) "trend" = average of the last 3 full months of new rewards, shown separately and labelled as an estimate,
-- (3) "approved work" = client-approved, not yet paid timesheets at each referrer's current tier, with no month (the client
-- decides when to pay). Referral payouts are ordinary payouts rows with reference 'referral:%'.
CREATE OR REPLACE FUNCTION public.admin_referral_dashboard(_months int DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _n int := GREATEST(1, LEAST(COALESCE(_months, 6), 12));
  _tz text := 'Asia/Riyadh';
  _this date := date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh')::date;
  _inv jsonb := '{}'::jsonb;
BEGIN
  IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;

  -- Refer & earn invitations (referral-invitations.sql) - optional, zero until that file is applied.
  IF to_regclass('public.referral_invitation_runs') IS NOT NULL THEN
    EXECUTE $q$
      SELECT jsonb_build_object(
        'runs', count(*) FILTER (WHERE r.mode <> 'test'),
        'tests', count(*) FILTER (WHERE r.mode = 'test'),
        'queued', COALESCE(sum(r.queued) FILTER (WHERE r.mode <> 'test'), 0),
        'skipped', COALESCE(sum(r.skipped) FILTER (WHERE r.mode <> 'test'), 0),
        'sent', (SELECT count(*) FROM public.message_campaign_recipients m JOIN public.referral_invitation_runs x ON x.campaign_id = m.campaign_id
                  WHERE m.channel = 'in_app' AND m.status = 'sent'),
        'failed', (SELECT count(*) FROM public.message_campaign_recipients m JOIN public.referral_invitation_runs x ON x.campaign_id = m.campaign_id
                    WHERE m.channel = 'in_app' AND m.status = 'failed'),
        'last_at', max(r.created_at) FILTER (WHERE r.mode <> 'test'),
        'by_month', COALESCE((SELECT jsonb_agg(jsonb_build_object('month', mo, 'count', c) ORDER BY mo)
                                FROM (SELECT to_char(date_trunc('month', m.sent_at AT TIME ZONE 'Asia/Riyadh'), 'YYYY-MM') mo, count(*) c
                                        FROM public.message_campaign_recipients m JOIN public.referral_invitation_runs x ON x.campaign_id = m.campaign_id
                                       WHERE m.channel = 'in_app' AND m.status = 'sent' AND m.sent_at > now() - interval '12 months' GROUP BY 1) q), '[]'::jsonb))
        FROM public.referral_invitation_runs r $q$ INTO _inv;
  END IF;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'months', _n,
    'settings', jsonb_build_object('min_payout', public.referral_setting_num('referral_min_payout', 25, 0, 100000),
                                   'hold_days', public.referral_setting_num('referral_hold_days', 14, 0, 90)::int),

    'invitations', jsonb_build_object(
      'announcement', jsonb_build_object(
        'sent', (SELECT count(*) FROM public.referral_announcements),
        'first_at', (SELECT min(sent_at) FROM public.referral_announcements),
        'last_at', (SELECT max(sent_at) FROM public.referral_announcements)),
      'invitation', _inv,
      'by_month', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'count', c) ORDER BY m)
          FROM (SELECT date_trunc('month', a.sent_at AT TIME ZONE _tz)::date m, count(*) c
                  FROM public.referral_announcements a WHERE a.sent_at >= (_this - interval '11 months') GROUP BY 1) q), '[]'::jsonb)),

    'rewards', jsonb_build_object(
      'totals', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'lines', lines, 'issued', issued, 'reversed', reversed,
                 'pending', pending, 'held', held, 'available', available, 'in_payout', in_payout, 'paid', paid, 'referrers', referrers) ORDER BY currency)
          FROM (SELECT l.currency,
                       count(*) FILTER (WHERE l.kind = 'reward') lines,
                       COALESCE(sum(l.amount) FILTER (WHERE l.kind IN ('reward', 'adjustment')), 0) issued,
                       COALESCE(-sum(l.amount) FILTER (WHERE l.kind = 'reversal'), 0) reversed,
                       COALESCE(sum(l.amount) FILTER (WHERE l.status = 'pending' AND l.kind <> 'reversal'), 0) pending,
                       COALESCE(sum(l.amount) FILTER (WHERE l.status = 'held' AND l.kind <> 'reversal'), 0) held,
                       COALESCE(sum(l.amount) FILTER (WHERE l.status = 'available'), 0) available,
                       COALESCE(sum(l.amount) FILTER (WHERE l.status = 'in_payout'), 0) in_payout,
                       COALESCE(sum(l.amount) FILTER (WHERE l.status = 'paid'), 0) paid,
                       count(DISTINCT l.referrer_consultant_id) referrers
                  FROM public.referral_reward_lines l GROUP BY l.currency) t), '[]'::jsonb),
      'by_month', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'currency', currency, 'earned', earned, 'paid', paid, 'reversed', reversed) ORDER BY m, currency)
          FROM (SELECT m, currency, sum(earned) earned, sum(paid) paid, sum(reversed) reversed FROM (
                  SELECT date_trunc('month', l.created_at AT TIME ZONE _tz)::date m, l.currency,
                         CASE WHEN l.kind IN ('reward', 'adjustment') THEN l.amount ELSE 0 END earned, 0::numeric paid,
                         CASE WHEN l.kind = 'reversal' THEN -l.amount ELSE 0 END reversed
                    FROM public.referral_reward_lines l WHERE l.created_at >= (_this - interval '11 months')
                  UNION ALL
                  SELECT date_trunc('month', l.paid_at AT TIME ZONE _tz)::date, l.currency, 0, l.amount, 0
                    FROM public.referral_reward_lines l WHERE l.status = 'paid' AND l.paid_at >= (_this - interval '11 months')) u
                 GROUP BY m, currency) q), '[]'::jsonb)),

    'payouts', jsonb_build_object(
      'upcoming', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', p.id, 'referrer', COALESCE(pr.display_name, 'Consultant'), 'amount', p.amount, 'currency', p.currency,
                 'status', p.status::text, 'due_by', p.due_by, 'created_at', p.created_at) ORDER BY p.due_by NULLS LAST, p.created_at)
          FROM (SELECT * FROM public.payouts WHERE reference LIKE 'referral:%' AND status::text IN ('pending', 'processing')
                 ORDER BY due_by NULLS LAST, created_at LIMIT 50) p
          LEFT JOIN public.consultants c ON c.id = p.consultant_id
          LEFT JOIN public.profiles pr ON pr.user_id = c.user_id), '[]'::jsonb),
      'recent', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('id', p.id, 'referrer', COALESCE(pr.display_name, 'Consultant'), 'amount', p.amount, 'currency', p.currency,
                 'status', p.status::text, 'due_by', p.due_by, 'paid_at', p.paid_at) ORDER BY p.paid_at DESC NULLS LAST)
          FROM (SELECT * FROM public.payouts WHERE reference LIKE 'referral:%' AND status::text IN ('completed', 'failed')
                 ORDER BY paid_at DESC NULLS LAST, updated_at DESC LIMIT 10) p
          LEFT JOIN public.consultants c ON c.id = p.consultant_id
          LEFT JOIN public.profiles pr ON pr.user_id = c.user_id), '[]'::jsonb),
      'next_due', (SELECT min(due_by) FROM public.payouts WHERE reference LIKE 'referral:%' AND status::text IN ('pending', 'processing')),
      'overdue', (SELECT count(*) FROM public.payouts WHERE reference LIKE 'referral:%' AND status::text IN ('pending', 'processing')
                   AND due_by < (now() AT TIME ZONE _tz)::date),
      -- Available lines not yet grouped into a payout, per referrer and currency: ready vs. below the minimum payout.
      'waiting', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'referrers', referrers, 'ready', ready, 'ready_amount', ready_amount,
                 'below_minimum', below, 'below_amount', below_amount) ORDER BY currency)
          FROM (SELECT currency, count(*) referrers,
                       count(*) FILTER (WHERE amt >= public.referral_setting_num('referral_min_payout', 25, 0, 100000)) ready,
                       COALESCE(sum(amt) FILTER (WHERE amt >= public.referral_setting_num('referral_min_payout', 25, 0, 100000)), 0) ready_amount,
                       count(*) FILTER (WHERE amt < public.referral_setting_num('referral_min_payout', 25, 0, 100000)) below,
                       COALESCE(sum(amt) FILTER (WHERE amt < public.referral_setting_num('referral_min_payout', 25, 0, 100000)), 0) below_amount
                  FROM (SELECT l.referrer_consultant_id, l.currency, sum(l.amount) amt FROM public.referral_reward_lines l
                         WHERE l.status = 'available' AND l.referral_payout_id IS NULL GROUP BY 1, 2) a GROUP BY currency) w), '[]'::jsonb)),

    'forecast', jsonb_build_object(
      'months', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('month', to_char(g.m, 'YYYY-MM'), 'currency', cur.currency,
                 'maturing', COALESCE((SELECT sum(l.amount) FROM public.referral_reward_lines l
                                        WHERE l.status = 'pending' AND l.kind <> 'reversal' AND l.currency = cur.currency
                                          -- hold already over but not yet released counts in the current month
                                          AND date_trunc('month', GREATEST(COALESCE(l.matures_at, l.created_at + make_interval(days => public.referral_setting_num('referral_hold_days', 14, 0, 90)::int)), now()) AT TIME ZONE _tz)::date = g.m::date), 0),
                 'trend', cur.trend) ORDER BY g.m, cur.currency)
          FROM generate_series(_this, _this + make_interval(months => _n - 1), interval '1 month') AS g(m)
          CROSS JOIN (SELECT c.currency, COALESCE(round((SELECT COALESCE(sum(l.amount), 0) FROM public.referral_reward_lines l
                                                WHERE l.currency = c.currency AND l.kind IN ('reward', 'adjustment')
                                                  AND l.created_at >= ((_this - interval '3 months')::timestamp AT TIME ZONE _tz)
                                                  AND l.created_at < (_this::timestamp AT TIME ZONE _tz)) / 3, 2), 0) trend
                        FROM (SELECT DISTINCT currency FROM public.referral_reward_lines
                              UNION SELECT 'USD' WHERE NOT EXISTS (SELECT 1 FROM public.referral_reward_lines)) c) cur), '[]'::jsonb),
      'approved_work', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('currency', currency, 'timesheets', n, 'expected_fee', fee, 'expected_reward', reward) ORDER BY currency)
          FROM (SELECT COALESCE(ts.cost_currency, 'USD') currency, count(*)::int n, round(sum(ts.billable_hours * ts.hourly_rate), 2) fee,
                       sum(round(round(ts.billable_hours * ts.hourly_rate, 2)
                           * (public.referral_tier_for(public.referral_verified_count(r.referrer_consultant_id)) ->> 'rate')::numeric / 100, 2)) reward
                  FROM public.consultant_referrals r
                  JOIN public.consultants c ON c.id = r.referred_consultant_id
                  JOIN public.ticket_timesheet_submissions ts ON ts.submitted_by = c.user_id
                 WHERE r.status = 'active' AND r.activation_status = 'active'
                   AND ts.status = 'signed' AND ts.billable_hours > 0 AND ts.hourly_rate > 0
                   AND COALESCE(ts.signed_at, ts.updated_at) >= r.activated_at
                   AND (r.window_ends_at IS NULL OR r.window_ends_at > now())
                   AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.timesheet_id = ts.id AND p.status::text IN ('completed', 'refunded'))
                 GROUP BY 1) f), '[]'::jsonb))
  );
END
$$;
REVOKE ALL ON FUNCTION public.admin_referral_dashboard(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_dashboard(int) TO authenticated;
