-- Refer & earn e-mails: monthly statement e-mail (to the consultant), weekly Refer & earn summary e-mail (to each
-- administrator) and reward-level progress in the e-mails.
-- PREPARED ONLY - NOT APPLIED. The owner reviews and applies this file; nothing is e-mailed to real users before the
-- owner approves. Safe to run twice (IF NOT EXISTS / CREATE OR REPLACE). Needs the live Feature Z objects
-- (referral-program.sql, referral-invitations.sql).
--
-- * Both new e-mails go through the existing referral_email_queue + referral-run function (one e-mail per person,
--   idempotent per queue row, Feature Q "activity" pause respected, the shared layout in _shared/referralEmail.ts).
-- * The statement e-mail is queued only when the month has reward lines; it carries masked names (Feature X) and the
--   anonymous engagement reference only - never a ticket title, client or hourly rate.
-- * The weekly summary keeps its in-app line and additionally e-mails each administrator once per week.
-- * referral_email_payload adds the reward-level progress (referral_tier_for of the verified count) to money e-mails.

-- ================================================================ 1. queue: payload column and the two new kinds
ALTER TABLE public.referral_email_queue ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.referral_email_queue.payload IS 'Extra e-mail data (statement / digest lines, period, totals); masked names and anonymous references only.';
ALTER TABLE public.referral_email_queue DROP CONSTRAINT IF EXISTS referral_email_queue_kind_check;
ALTER TABLE public.referral_email_queue ADD CONSTRAINT referral_email_queue_kind_check CHECK (kind IN (
  'signup', 'invited', 'passed_self', 'passed_other', 'active', 'reminder', 'expired', 'verified', 'first_reward', 'ack_request',
  'payout_details_changed', 'reward_earned', 'reward_held', 'reward_available', 'reward_paid', 'reward_reversed', 'referral_rejected',
  'monthly_statement', 'weekly_digest_admin'));
CREATE UNIQUE INDEX IF NOT EXISTS referral_email_queue_period_once ON public.referral_email_queue (user_id, kind, (payload ->> 'period_key'))
  WHERE kind IN ('monthly_statement', 'weekly_digest_admin');

-- ================================================================ 2. payload for the sender (service role only)
CREATE OR REPLACE FUNCTION public.referral_email_payload(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r jsonb;
BEGIN
  IF (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT (q.payload - 'period_key')
         || CASE WHEN c.id IS NOT NULL AND q.kind IN ('first_reward', 'reward_earned', 'reward_held', 'reward_available', 'reward_paid',
                                                     'reward_reversed', 'active', 'verified', 'monthly_statement')
                 THEN jsonb_build_object('tier', public.referral_tier_for(public.referral_verified_count(c.id))) ELSE '{}'::jsonb END
    INTO _r
    FROM public.referral_email_queue q
    LEFT JOIN public.consultants c ON c.user_id = q.user_id
   WHERE q.id = _id;
  RETURN COALESCE(_r, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.referral_email_payload(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_email_payload(uuid) TO service_role;

-- E-mail lines from statement / reward rows: masked name, anonymous reference, fee, reward, status (max 50).
CREATE OR REPLACE FUNCTION public.referral_email_lines(_lines jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('who', e ->> 'referred_name', 'ref', e ->> 'engagement_ref', 'fee', (e ->> 'fee_amount')::numeric,
                                               'reward', (e ->> 'amount')::numeric, 'status', e ->> 'status', 'kind', e ->> 'kind',
                                               'currency', e ->> 'currency')), '[]'::jsonb)
    FROM (SELECT e FROM jsonb_array_elements(COALESCE(_lines, '[]'::jsonb)) e LIMIT 50) x
$$;

CREATE OR REPLACE FUNCTION public.referral_email_totals(_lines jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('currency', c, 'earned', earned, 'held', held, 'available', avail, 'paid', paid, 'reversed', rev) ORDER BY c), '[]'::jsonb)
    FROM (SELECT e ->> 'currency' c,
                 COALESCE(sum(abs((e ->> 'amount')::numeric)) FILTER (WHERE e ->> 'status' = 'pending' AND e ->> 'kind' <> 'reversal'), 0) earned,
                 COALESCE(sum(abs((e ->> 'amount')::numeric)) FILTER (WHERE e ->> 'status' = 'held' AND e ->> 'kind' <> 'reversal'), 0) held,
                 COALESCE(sum(abs((e ->> 'amount')::numeric)) FILTER (WHERE e ->> 'status' IN ('available', 'in_payout') AND e ->> 'kind' <> 'reversal'), 0) avail,
                 COALESCE(sum(abs((e ->> 'amount')::numeric)) FILTER (WHERE e ->> 'status' = 'paid' AND e ->> 'kind' <> 'reversal'), 0) paid,
                 COALESCE(sum(abs((e ->> 'amount')::numeric)) FILTER (WHERE e ->> 'status' = 'reversed' OR e ->> 'kind' = 'reversal'), 0) rev
            FROM jsonb_array_elements(COALESCE(_lines, '[]'::jsonb)) e
           WHERE e ->> 'currency' ~ '^[A-Z]{3}$' GROUP BY 1) t
$$;

-- ================================================================ 3. monthly statements: also queue the statement e-mail
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
  _queued int := 0;
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
      -- The statement e-mail: only for a month with reward lines (no empty statements in the inbox).
      IF _user IS NOT NULL AND jsonb_array_length(_lines) > 0 THEN
        INSERT INTO public.referral_email_queue (user_id, kind, payload)
        VALUES (_user, 'monthly_statement', jsonb_build_object(
          'period_key', to_char(_m, 'YYYY-MM'), 'period', to_char(_m, 'FMMonth YYYY'),
          'lines', public.referral_email_lines(_lines), 'totals', public.referral_email_totals(_lines)))
        ON CONFLICT DO NOTHING;
        _queued := _queued + 1;
      END IF;
      _id := NULL;
    END IF;
  END LOOP;
  IF _queued > 0 THEN PERFORM public.referral_wake(); END IF;
  RETURN _n;
END
$$;
REVOKE ALL ON FUNCTION public.referral_generate_statements(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_generate_statements(date) TO service_role;

-- ================================================================ 4. weekly summary: in-app line + one e-mail per administrator
CREATE OR REPLACE FUNCTION public.referral_weekly_digest()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _signups int; _verified int; _review int; _money text; _lines jsonb; _key text := to_char(now() AT TIME ZONE 'Asia/Riyadh', 'IYYY-"W"IW');
  _period text := to_char((now() - interval '7 days') AT TIME ZONE 'Asia/Riyadh', 'FMDD Mon') || ' – ' || to_char(now() AT TIME ZONE 'Asia/Riyadh', 'FMDD Mon YYYY');
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

  -- Lines of the week across the programme: masked name of the referred consultant and an anonymous reference only.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('referred_name', public.referral_masked_name(l.referred_consultant_id),
                                               'engagement_ref', 'R-' || upper(left(md5(l.id::text), 4)), 'fee_amount', l.fee_amount,
                                               'amount', l.amount, 'status', l.status, 'kind', l.kind, 'currency', l.currency) ORDER BY l.created_at DESC), '[]'::jsonb)
    INTO _lines
    FROM (SELECT * FROM public.referral_reward_lines WHERE created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 200) l;
  INSERT INTO public.referral_email_queue (user_id, kind, payload)
  SELECT DISTINCT ur.user_id, 'weekly_digest_admin', jsonb_build_object(
           'period_key', _key, 'period', _period,
           'stats', jsonb_build_object('signups', _signups, 'verified', _verified, 'review', _review),
           'lines', public.referral_email_lines(_lines), 'totals', public.referral_email_totals(_lines))
    FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')
  ON CONFLICT DO NOTHING;
  PERFORM public.referral_wake();
END
$$;
REVOKE ALL ON FUNCTION public.referral_weekly_digest() FROM PUBLIC, anon, authenticated;
