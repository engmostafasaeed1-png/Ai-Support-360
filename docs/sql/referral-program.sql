-- Feature Z: consultant referral programme ("Refer & earn").
-- Prepared for the owner to apply; NOT applied by the app. Safe to run more than once.
--
-- Owner rules (all numbers are admin-editable settings):
--   * reward = referral_rate_percent (0.5 %) of the REFERRED consultant's fee (approved hourly rate x approved hours,
--     i.e. the payout's gross_amount), paid by the platform out of its portal fee. The referred consultant's payout and
--     the client's price are never reduced. Never on VAT, portal (service) fee, payment fee or the referrer's own work.
--   * window = referral_months (12) counted from the referred consultant's FIRST PAID ticket (first payout row, which is
--     created when the client's payment is confirmed).
--   * a reward line is created at the same trigger point as the consultant payout (payouts insert), only while the
--     referred consultant is verified and the referrer is verified, not suspended and has signed the Service Policy.
--     It is "pending" until that payout is completed, then "available". Refunds add a negative line, disputes hold it.
--   * ACTIVATION: a pair (referrer + referred) is "pending" until BOTH passed the AI interview (completed AI session with
--     overall_score >= referral_min_interview_score, default 50) and BOTH accepted the current referral terms (versioned,
--     append-only acknowledgements). Only payouts created after the activation moment earn. Pending pairs expire after
--     referral_activation_days (90) from sign-up; only an administrator can revive them. Fraud holds still apply.
--   * available rewards >= referral_min_payout ($25) per currency are grouped nightly into a normal payouts row
--     (reference 'referral:<id>', labelled "Referral reward"), paid with the normal payout run and bank details.
--
-- Uses live objects: consultants, profiles, auth.users, payouts, payments, consultant_payout_details, user_admin_state,
--   consultant_policy_acknowledgements, consultant_policy_blocked, consultant_policy_current_version, team_consultant_name
--   (masked public name, Feature X), safe_insert_notification, check_rate_limit, platform_flag, has_role, audit_logs,
--   pgcrypto (extensions), pg_net, pg_cron. Replaces the old member programme's process_referral_signup and
--   grant_referral_rewards with the same bodies plus one skip, so consultant-to-consultant referrals are never paid twice.

-- 0. Settings ------------------------------------------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, value) VALUES
  ('referral_enabled', 'true'::jsonb),
  -- Tiered rate by the referrer's number of VERIFIED referred consultants (admin-editable, max 5 tiers, rates ascending).
  ('referral_tiers', '[{"min": 0, "rate": 0.5, "name": "Tier 1"}, {"min": 11, "rate": 0.6, "name": "Tier 2"}, {"min": 21, "rate": 0.7, "name": "Tier 3"}, {"min": 31, "rate": 0.8, "name": "Tier 4"}, {"min": 41, "rate": 1.0, "name": "Tier 5"}]'::jsonb),
  ('referral_max_rate', '2'::jsonb),
  ('referral_months', '12'::jsonb),
  ('referral_min_payout', '25'::jsonb),
  ('referral_max_reward_per_referred', 'null'::jsonb),
  -- Caps are monthly and per currency. Exceeding one does not cut the reward silently: the line is held for review.
  ('referral_monthly_cap_per_referrer', '1000'::jsonb),
  ('referral_monthly_cap_per_referred', '250'::jsonb),
  -- Fraud / wash-work controls (section 13).
  ('referral_hold_days', '14'::jsonb),
  ('referral_min_invoice', '20'::jsonb),
  ('referral_review_flag_threshold', '2'::jsonb),
  ('referral_velocity_per_day', '5'::jsonb),
  ('referral_velocity_per_ip', '3'::jsonb),
  ('referral_tier_requires_paid', 'true'::jsonb),
  ('referral_tier_paid_days', '90'::jsonb),
  ('referral_adjust_four_eyes_amount', '100'::jsonb),
  ('payout_details_change_hold_days', '7'::jsonb),
  ('referral_signal_retention_days', '365'::jsonb),
  ('referral_claim_days', '7'::jsonb),
  ('referral_terms_version', '1'::jsonb),
  ('referral_min_interview_score', '50'::jsonb),
  ('referral_activation_days', '90'::jsonb)
ON CONFLICT (key) DO NOTHING;
-- Launch moment (first apply) and the window in which EXISTING consultants may still enter "Who invited you?".
INSERT INTO public.platform_settings (key, value) VALUES ('referral_launch_at', to_jsonb(now())) ON CONFLICT (key) DO NOTHING;
INSERT INTO public.platform_settings (key, value) VALUES ('referral_claim_until', to_jsonb(now() + interval '14 days')) ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.referral_setting_ts(_key text)
 RETURNS timestamptz
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v text;
BEGIN
  SELECT value #>> '{}' INTO v FROM public.platform_settings WHERE key = _key;
  RETURN v::timestamptz;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.referral_setting_ts(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.referral_setting_num(_key text, _def numeric, _lo numeric, _hi numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT CASE WHEN (value #>> '{}') ~ '^\d{1,7}(\.\d{1,4})?$' AND (value #>> '{}')::numeric BETWEEN _lo AND _hi
                THEN (value #>> '{}')::numeric END
      FROM public.platform_settings WHERE key = _key), _def)
$$;
REVOKE ALL ON FUNCTION public.referral_setting_num(text, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;

-- Optional caps: NULL (no cap) unless a positive number is stored.
CREATE OR REPLACE FUNCTION public.referral_setting_cap(_key text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT CASE WHEN (value #>> '{}') ~ '^\d{1,7}(\.\d{1,2})?$' AND (value #>> '{}')::numeric > 0 THEN (value #>> '{}')::numeric END
    FROM public.platform_settings WHERE key = _key
$$;
REVOKE ALL ON FUNCTION public.referral_setting_cap(text) FROM PUBLIC, anon, authenticated;

-- Validated tiers (falls back to the defaults if the stored value is not valid). Mirrored by src/lib/referrals.ts.
CREATE OR REPLACE FUNCTION public.referral_tiers_valid(_t jsonb, _max numeric)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $$
DECLARE
  i int;
  e jsonb;
  _prev_min int := -1;
  _prev_rate numeric := 0;
BEGIN
  IF jsonb_typeof(_t) IS DISTINCT FROM 'array' OR jsonb_array_length(_t) < 1 OR jsonb_array_length(_t) > 5 THEN RETURN 'Use 1 to 5 tiers'; END IF;
  FOR i IN 0 .. jsonb_array_length(_t) - 1 LOOP
    e := _t -> i;
    IF jsonb_typeof(e -> 'min') <> 'number' OR jsonb_typeof(e -> 'rate') <> 'number' THEN RETURN 'Each tier needs a number of referrals and a rate'; END IF;
    IF (e ->> 'min')::numeric <> trunc((e ->> 'min')::numeric) OR (e ->> 'min')::int < 0 THEN RETURN 'Referral counts must be whole numbers'; END IF;
    IF i = 0 AND (e ->> 'min')::int <> 0 THEN RETURN 'The first tier must start at 0 referrals'; END IF;
    IF (e ->> 'min')::int <= _prev_min THEN RETURN 'Referral counts must go up from tier to tier'; END IF;
    IF (e ->> 'rate')::numeric <= _prev_rate THEN RETURN 'Rates must go up from tier to tier'; END IF;
    IF (e ->> 'rate')::numeric > _max THEN RETURN format('Rates can not be above the maximum of %s %%', _max); END IF;
    IF length(COALESCE(e ->> 'name', '')) > 30 THEN RETURN 'Tier names have at most 30 characters'; END IF;
    _prev_min := (e ->> 'min')::int; _prev_rate := (e ->> 'rate')::numeric;
  END LOOP;
  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.referral_tiers()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
  _max numeric := public.referral_setting_num('referral_max_rate', 2, 0.01, 10);
  d jsonb := '[{"min": 0, "rate": 0.5, "name": "Tier 1"}, {"min": 11, "rate": 0.6, "name": "Tier 2"}, {"min": 21, "rate": 0.7, "name": "Tier 3"}, {"min": 31, "rate": 0.8, "name": "Tier 4"}, {"min": 41, "rate": 1.0, "name": "Tier 5"}]';
BEGIN
  SELECT value INTO v FROM public.platform_settings WHERE key = 'referral_tiers';
  IF v IS NULL OR public.referral_tiers_valid(v, _max) IS NOT NULL THEN v := d; END IF;
  RETURN (SELECT jsonb_agg(jsonb_build_object('min', (e ->> 'min')::int, 'rate', (e ->> 'rate')::numeric,
                                              'name', COALESCE(NULLIF(e ->> 'name', ''), 'Tier ' || o)) ORDER BY o)
            FROM jsonb_array_elements(v) WITH ORDINALITY AS x(e, o));
END
$$;
REVOKE ALL ON FUNCTION public.referral_tiers() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.referral_settings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'enabled', public.platform_flag('referral_enabled', true),
    -- Base (first tier) rate; the rate of a reward line is the referrer's tier when the line is created.
    'rate_percent', (public.referral_tiers() -> 0 ->> 'rate')::numeric,
    'tiers', public.referral_tiers(),
    'max_rate', public.referral_setting_num('referral_max_rate', 2, 0.01, 10),
    'months', public.referral_setting_num('referral_months', 12, 1, 60)::int,
    'min_payout', public.referral_setting_num('referral_min_payout', 25, 0, 100000),
    'max_per_referred', public.referral_setting_cap('referral_max_reward_per_referred'),
    'monthly_cap', public.referral_setting_cap('referral_monthly_cap_per_referrer'),
    'monthly_cap_referred', public.referral_setting_cap('referral_monthly_cap_per_referred'),
    'hold_days', public.referral_setting_num('referral_hold_days', 14, 0, 90)::int,
    'min_invoice', public.referral_setting_num('referral_min_invoice', 20, 0, 100000),
    'flag_threshold', public.referral_setting_num('referral_review_flag_threshold', 2, 1, 10)::int,
    'velocity_day', public.referral_setting_num('referral_velocity_per_day', 5, 1, 1000)::int,
    'velocity_ip', public.referral_setting_num('referral_velocity_per_ip', 3, 1, 1000)::int,
    'tier_requires_paid', public.platform_flag('referral_tier_requires_paid', true),
    'tier_paid_days', public.referral_setting_num('referral_tier_paid_days', 90, 1, 365)::int,
    'four_eyes_amount', public.referral_setting_num('referral_adjust_four_eyes_amount', 100, 0, 100000),
    'payout_change_hold_days', public.referral_setting_num('payout_details_change_hold_days', 7, 0, 60)::int,
    'retention_days', public.referral_setting_num('referral_signal_retention_days', 365, 30, 1095)::int,
    'claim_days', public.referral_setting_num('referral_claim_days', 7, 0, 30)::int,
    'launch_at', public.referral_setting_ts('referral_launch_at'),
    'claim_until', public.referral_setting_ts('referral_claim_until'),
    'terms_version', public.referral_setting_num('referral_terms_version', 1, 1, 1000)::int,
    'pass_mark', public.referral_setting_num('referral_min_interview_score', 50, 0, 100),
    'activation_days', public.referral_setting_num('referral_activation_days', 90, 1, 365)::int)
$$;
REVOKE ALL ON FUNCTION public.referral_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_settings() TO service_role;

-- Public numbers for the landing page, sign-up and banners (no personal data).
CREATE OR REPLACE FUNCTION public.referral_public_settings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object('enabled', s->'enabled', 'rate_percent', s->'rate_percent', 'months', s->'months',
                            'min_payout', s->'min_payout', 'terms_version', s->'terms_version', 'pass_mark', s->'pass_mark',
                            'activation_days', s->'activation_days', 'tiers', s->'tiers', 'hold_days', s->'hold_days',
                            'min_invoice', s->'min_invoice')
    FROM (SELECT public.referral_settings() AS s) x
$$;
REVOKE ALL ON FUNCTION public.referral_public_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_public_settings() TO anon, authenticated, service_role;

-- 1. Private salt + hashing (device / IP signals are stored only as salted hashes) ----------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_private (
  k text PRIMARY KEY,
  v text NOT NULL
);
REVOKE ALL ON public.referral_private FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_private TO service_role;
ALTER TABLE public.referral_private ENABLE ROW LEVEL SECURITY;
INSERT INTO public.referral_private (k, v) VALUES ('salt', encode(extensions.gen_random_bytes(24), 'hex')) ON CONFLICT (k) DO NOTHING;

CREATE OR REPLACE FUNCTION public.referral_hash(_v text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT CASE WHEN NULLIF(btrim(COALESCE(_v, '')), '') IS NULL THEN NULL
              ELSE encode(extensions.digest((SELECT v FROM public.referral_private WHERE k = 'salt') || ':' || lower(btrim(_v)), 'sha256'), 'hex') END
$$;
REVOKE ALL ON FUNCTION public.referral_hash(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.referral_request_ip()
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $$
DECLARE
  h json;
BEGIN
  BEGIN
    h := NULLIF(current_setting('request.headers', true), '')::json;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  IF h IS NULL THEN RETURN NULL; END IF;
  RETURN NULLIF(btrim(split_part(COALESCE(h ->> 'cf-connecting-ip', h ->> 'x-forwarded-for', h ->> 'x-real-ip', ''), ',', 1)), '');
END
$$;

-- 2. Tables -----------------------------------------------------------------------------------------------------------------
-- One code per consultant. Editable once (previous_code keeps old links working). Case-insensitive.
CREATE TABLE IF NOT EXISTS public.consultant_referral_codes (
  consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  code text NOT NULL,
  previous_code text,
  edits_used int NOT NULL DEFAULT 0,
  disabled_at timestamptz,
  disabled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- At least 7 letters/digits; generated codes carry 7 random characters from a 31-character safe alphabet (no 0/O/1/I/L).
  CONSTRAINT consultant_referral_code_format CHECK (code ~ '^[A-Z0-9]{2,12}(-[A-Z0-9]{1,12}){0,3}$' AND length(code) BETWEEN 7 AND 32
                                                     AND length(replace(code, '-', '')) >= 7)
);
CREATE UNIQUE INDEX IF NOT EXISTS consultant_referral_codes_code_uq ON public.consultant_referral_codes (upper(code));
CREATE UNIQUE INDEX IF NOT EXISTS consultant_referral_codes_prev_uq ON public.consultant_referral_codes (upper(previous_code)) WHERE previous_code IS NOT NULL;
GRANT SELECT ON public.consultant_referral_codes TO authenticated;
GRANT ALL ON public.consultant_referral_codes TO service_role;
ALTER TABLE public.consultant_referral_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own referral code or admin" ON public.consultant_referral_codes;
CREATE POLICY "Own referral code or admin" ON public.consultant_referral_codes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Attribution: one referrer per consultant, locked at sign-up. Only definer functions write it (no write grants).
CREATE TABLE IF NOT EXISTS public.consultant_referrals (
  referred_consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  referrer_consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  code text NOT NULL,
  source text NOT NULL CHECK (source IN ('signup', 'claim', 'admin')),
  attributed_at timestamptz NOT NULL DEFAULT now(),
  first_paid_at timestamptz,
  window_ends_at timestamptz,
  -- 'review' = under review: created so when the fraud signals score >= referral_review_flag_threshold; earns nothing until an
  -- administrator approves. Device/IP hashes live in the service-only referral_attribution_signals table, never here.
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'review', 'held', 'removed')),
  flags text[] NOT NULL DEFAULT '{}',
  flag_score int NOT NULL DEFAULT 0,
  referred_verified_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  verified_notified_at timestamptz,
  first_reward_notified_at timestamptz,
  -- Activation (both passed the AI interview + both accepted the terms). Written only by referral_check_activation.
  activation_status text NOT NULL DEFAULT 'pending' CHECK (activation_status IN ('pending', 'active', 'expired')),
  activated_at timestamptz,
  activation_expires_at timestamptz,
  expired_at timestamptz,
  referrer_passed_notified_at timestamptz,
  referred_passed_notified_at timestamptz,
  reminder_14_at timestamptz,
  reminder_45_at timestamptz,
  admin_resend_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultant_referrals_not_self CHECK (referred_consultant_id <> referrer_consultant_id)
);
CREATE INDEX IF NOT EXISTS consultant_referrals_referrer_idx ON public.consultant_referrals (referrer_consultant_id, attributed_at DESC);
GRANT SELECT ON public.consultant_referrals TO authenticated;
GRANT ALL ON public.consultant_referrals TO service_role;
ALTER TABLE public.consultant_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read referral attributions" ON public.consultant_referrals;
CREATE POLICY "Admins read referral attributions" ON public.consultant_referrals
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Link clicks per code and day (no personal data; one click per visitor and code per 12 hours).
CREATE TABLE IF NOT EXISTS public.referral_clicks (
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  day date NOT NULL,
  clicks int NOT NULL DEFAULT 0,
  PRIMARY KEY (consultant_id, day)
);
GRANT SELECT ON public.referral_clicks TO authenticated;
GRANT ALL ON public.referral_clicks TO service_role;
ALTER TABLE public.referral_clicks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read referral clicks" ON public.referral_clicks;
CREATE POLICY "Admins read referral clicks" ON public.referral_clicks
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Salted device / IP hashes seen for a consultant (fraud signals only; kept 180 days).
CREATE TABLE IF NOT EXISTS public.referral_devices (
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('device', 'ip')),
  hash text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consultant_id, kind, hash)
);
CREATE INDEX IF NOT EXISTS referral_devices_hash_idx ON public.referral_devices (kind, hash);
REVOKE ALL ON public.referral_devices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_devices TO service_role;
ALTER TABLE public.referral_devices ENABLE ROW LEVEL SECURITY;

-- Money lines. One reward per payout (unique_key), reversals and admin adjustments are their own lines.
CREATE TABLE IF NOT EXISTS public.referral_reward_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unique_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('reward', 'reversal', 'adjustment')),
  referrer_consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  referred_consultant_id uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
  -- RESTRICT: a payout that produced a reward (money audit trail) can not be deleted.
  source_payout_id uuid REFERENCES public.payouts(id) ON DELETE RESTRICT,
  payment_id uuid,
  reverses_line_id uuid REFERENCES public.referral_reward_lines(id) ON DELETE SET NULL,
  fee_amount numeric(14,2),
  rate_percent numeric(6,3),
  tier_name text,
  tier_count int,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL CHECK (status IN ('pending', 'available', 'held', 'in_payout', 'paid', 'reversed')),
  hold_reason text CHECK (hold_reason IS NULL OR hold_reason IN ('review', 'admin', 'dispute', 'related_party', 'cap')),
  flags text[] NOT NULL DEFAULT '{}',
  -- Reward lines are created when the referred consultant's payout is released; they become available only after the
  -- hold period (referral_hold_days) that covers refunds and chargebacks.
  released_at timestamptz,
  matures_at timestamptz,
  referral_payout_id uuid REFERENCES public.payouts(id) ON DELETE SET NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_line_currency CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT referral_line_money CHECK (amount = round(amount, 2) AND (fee_amount IS NULL OR fee_amount >= 0)
                                        AND (rate_percent IS NULL OR (rate_percent > 0 AND rate_percent <= 10))),
  CONSTRAINT referral_line_sign CHECK (
       (kind = 'reward' AND amount >= 0 AND reverses_line_id IS NULL AND source_payout_id IS NOT NULL AND rate_percent IS NOT NULL)
    OR (kind = 'reversal' AND amount <= 0 AND reverses_line_id IS NOT NULL)
    OR (kind = 'adjustment' AND amount <> 0 AND reverses_line_id IS NULL AND created_by IS NOT NULL))
);
-- Idempotency: one reward per released payout, one reversal per reward.
CREATE UNIQUE INDEX IF NOT EXISTS referral_reward_lines_one_reward_uq ON public.referral_reward_lines (source_payout_id) WHERE kind = 'reward';
CREATE UNIQUE INDEX IF NOT EXISTS referral_reward_lines_one_reversal_uq ON public.referral_reward_lines (reverses_line_id) WHERE reverses_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS referral_reward_lines_matures_idx ON public.referral_reward_lines (matures_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS referral_reward_lines_referrer_idx ON public.referral_reward_lines (referrer_consultant_id, status, currency);
CREATE INDEX IF NOT EXISTS referral_reward_lines_referred_idx ON public.referral_reward_lines (referred_consultant_id);
CREATE INDEX IF NOT EXISTS referral_reward_lines_payout_idx ON public.referral_reward_lines (source_payout_id);
CREATE INDEX IF NOT EXISTS referral_reward_lines_payment_idx ON public.referral_reward_lines (payment_id);
CREATE INDEX IF NOT EXISTS referral_reward_lines_rpayout_idx ON public.referral_reward_lines (referral_payout_id);
GRANT SELECT ON public.referral_reward_lines TO authenticated;
GRANT ALL ON public.referral_reward_lines TO service_role;
ALTER TABLE public.referral_reward_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read referral reward lines" ON public.referral_reward_lines;
CREATE POLICY "Admins read referral reward lines" ON public.referral_reward_lines
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Versioned referral terms (like the Consultant Service Policy) and append-only acknowledgements by both sides.
CREATE TABLE IF NOT EXISTS public.referral_terms_versions (
  version int PRIMARY KEY,
  body_en text NOT NULL,
  body_ar text NOT NULL,
  is_draft boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referral_terms_versions TO anon, authenticated;
GRANT ALL ON public.referral_terms_versions TO service_role;
ALTER TABLE public.referral_terms_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Referral terms are public" ON public.referral_terms_versions;
CREATE POLICY "Referral terms are public" ON public.referral_terms_versions FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.referral_terms_versions (version, body_en, body_ar) VALUES (1,
'DRAFT for legal review. (1) The referral becomes active only when BOTH consultants have passed the AI interview with at least the pass mark and BOTH have accepted these terms; the interview must be taken honestly, without outside help. (2) The referrer earns the published rate of the referred consultant''s fee for the published number of months from the referred consultant''s first paid ticket, only on work invoiced after activation. (3) AI Support 360 pays the reward from its own fee; it is never deducted from the referred consultant or added to the client''s price. (4) A reward is created only after the client''s payment has cleared and the referred consultant''s payout was released, and it stays pending for a review period (currently 14 days) to cover refunds and chargebacks. (5) AI Support 360 may review, hold, reverse, cancel or forfeit rewards, and may remove the referral, in case of fraud or suspected fraud, including self-referral, related accounts, shared devices, networks or bank accounts, work for a related client, fake or duplicate accounts, or a dishonest interview; refunded or charged-back payments reverse the related reward, and a reversed reward that was already paid is deducted from later rewards. Rewards above the published monthly limits are held for review. (6) Rewards are a referral incentive, not wages or salary, and may be taxable; you are responsible for declaring them. (7) AI Support 360 may change or end the programme for future rewards with notice.',
'مسودة للمراجعة القانونية. (1) تصبح الإحالة نشطة فقط عندما يجتاز المستشاران كلاهما المقابلة الذكية بدرجة النجاح على الأقل ويوافق كلاهما على هذه الشروط، ويجب إجراء المقابلة بأمانة ودون مساعدة خارجية. (2) يحصل المُحيل على النسبة المعلنة من أتعاب المستشار المُحال للمدة المعلنة من أول تذكرة مدفوعة له، وفقط عن الأعمال المفوترة بعد التفعيل. (3) تدفع AI Support 360 المكافأة من رسومها الخاصة، ولا تُخصم أبدًا من المستشار المُحال ولا تُضاف إلى سعر العميل. (4) تُنشأ المكافأة فقط بعد تحصيل دفعة العميل وصرف دفعة المستشار المُحال، وتبقى قيد الانتظار لفترة مراجعة (حاليًا 14 يومًا) لتغطية الاسترداد والاعتراض على الدفع. (5) يحق لـ AI Support 360 مراجعة المكافآت أو تعليقها أو عكسها أو إلغاؤها أو إسقاطها، وإزالة الإحالة، في حالات الاحتيال أو الاشتباه فيه، بما في ذلك إحالة النفس أو الحسابات المرتبطة أو مشاركة الأجهزة أو الشبكات أو الحسابات البنكية أو العمل لعميل مرتبط أو الحسابات الوهمية أو المكررة أو المقابلة غير الأمينة؛ ويؤدي استرداد الدفعة أو الاعتراض عليها إلى عكس المكافأة المرتبطة، وتُخصم المكافأة المعكوسة المدفوعة من المكافآت اللاحقة. وتُعلَّق المكافآت التي تتجاوز الحدود الشهرية المعلنة للمراجعة. (6) المكافآت حافز إحالة وليست أجرًا أو راتبًا، وقد تخضع للضريبة، وأنت مسؤول عن الإقرار بها. (7) يجوز لـ AI Support 360 تغيير البرنامج أو إنهاؤه بالنسبة للمكافآت المستقبلية مع إشعار مسبق.')
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.referral_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  version int NOT NULL,
  role text NOT NULL CHECK (role IN ('referrer', 'referred', 'both')),
  source text NOT NULL DEFAULT 'page' CHECK (source IN ('page', 'share', 'signup', 'popup')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  language text NOT NULL DEFAULT 'en',
  user_agent text,
  ip_hash text
);
CREATE INDEX IF NOT EXISTS referral_acknowledgements_consultant_idx ON public.referral_acknowledgements (consultant_id, version, accepted_at DESC);
-- Column grant: the browser never receives ip_hash or user_agent.
REVOKE ALL ON public.referral_acknowledgements FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, consultant_id, user_id, version, role, source, accepted_at, language) ON public.referral_acknowledgements TO authenticated;
GRANT ALL ON public.referral_acknowledgements TO service_role;
ALTER TABLE public.referral_acknowledgements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own referral acknowledgements or admin" ON public.referral_acknowledgements;
CREATE POLICY "Own referral acknowledgements or admin" ON public.referral_acknowledgements
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- Append-only, for everyone (also definer functions and administrators). Only exception: the retention job may blank the
-- network hash and user agent of old rows (everything else unchanged).
CREATE OR REPLACE FUNCTION public.referral_ack_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.ip_hash IS NULL AND NEW.user_agent IS NULL
     AND (NEW.id, NEW.consultant_id, NEW.user_id, NEW.version, NEW.role, NEW.source, NEW.accepted_at, NEW.language)
         IS NOT DISTINCT FROM (OLD.id, OLD.consultant_id, OLD.user_id, OLD.version, OLD.role, OLD.source, OLD.accepted_at, OLD.language) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Referral acknowledgements can not be changed or deleted' USING ERRCODE = '42501';
END
$$;
DROP TRIGGER IF EXISTS trg_referral_ack_append_only ON public.referral_acknowledgements;
CREATE TRIGGER trg_referral_ack_append_only
  BEFORE UPDATE OR DELETE ON public.referral_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION public.referral_ack_append_only();

-- Audit trail of every change (also mirrored into audit_logs for administrator actions).
CREATE TABLE IF NOT EXISTS public.referral_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid,
  action text NOT NULL,
  referrer_consultant_id uuid,
  referred_consultant_id uuid,
  line_id uuid,
  payout_id uuid,
  before jsonb,
  after jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_events_created_idx ON public.referral_events (created_at DESC);
GRANT SELECT ON public.referral_events TO authenticated;
GRANT ALL ON public.referral_events TO service_role;
ALTER TABLE public.referral_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read referral events" ON public.referral_events;
CREATE POLICY "Admins read referral events" ON public.referral_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- E-mails to referrers go out through the referral-run function (managed sender, one recipient per mail).
CREATE TABLE IF NOT EXISTS public.referral_email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('signup', 'invited', 'passed_self', 'passed_other', 'active', 'reminder', 'expired', 'verified', 'first_reward', 'ack_request',
                                      'payout_details_changed')),
  referred_name text,
  next_step text,
  days int,
  amount numeric(14,2),
  currency text,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text
);
REVOKE ALL ON public.referral_email_queue FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_email_queue TO service_role;
ALTER TABLE public.referral_email_queue ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS referral_email_queue_pending_idx ON public.referral_email_queue (created_at) WHERE sent_at IS NULL AND failed_at IS NULL;

-- Service-only fraud signals (salted hashes only, deleted after referral_signal_retention_days). Never granted to the browser.
CREATE TABLE IF NOT EXISTS public.referral_attribution_signals (
  referred_consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  device_hash text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_attribution_signals_ip_idx ON public.referral_attribution_signals (ip_hash, created_at);
REVOKE ALL ON public.referral_attribution_signals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_attribution_signals TO service_role;
ALTER TABLE public.referral_attribution_signals ENABLE ROW LEVEL SECURITY;

-- Network hashes of paying clients (seen when they report or confirm a payment) for the related-party check.
CREATE TABLE IF NOT EXISTS public.referral_party_signals (
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('ip')),
  hash text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, hash)
);
CREATE INDEX IF NOT EXISTS referral_party_signals_hash_idx ON public.referral_party_signals (kind, hash);
REVOKE ALL ON public.referral_party_signals FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_party_signals TO service_role;
ALTER TABLE public.referral_party_signals ENABLE ROW LEVEL SECURITY;

-- Code-check brute force: invalid attempts per network hash / account; 10 invalid in an hour lock the checker for an hour.
CREATE TABLE IF NOT EXISTS public.referral_code_attempts (
  who text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  invalid int NOT NULL DEFAULT 0,
  locked_until timestamptz
);
REVOKE ALL ON public.referral_code_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_code_attempts TO service_role;
ALTER TABLE public.referral_code_attempts ENABLE ROW LEVEL SECURITY;

-- Four-eyes: manual adjustments above referral_adjust_four_eyes_amount wait for a second super administrator.
CREATE TABLE IF NOT EXISTS public.referral_adjust_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount <> 0 AND abs(amount) <= 100000 AND amount = round(amount, 2)),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reason text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  line_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  CONSTRAINT referral_adjust_two_people CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
REVOKE ALL ON public.referral_adjust_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_adjust_requests TO service_role;
ALTER TABLE public.referral_adjust_requests ENABLE ROW LEVEL SECURITY;

-- 3. Small helpers ----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.referral_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
$$;
REVOKE ALL ON FUNCTION public.referral_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_is_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.referral_my_consultant()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT c.id FROM public.consultants c WHERE c.user_id = auth.uid() LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.referral_my_consultant() FROM PUBLIC, anon, authenticated;

-- Masked public name (Feature X "chosen format"), never the full name.
CREATE OR REPLACE FUNCTION public.referral_masked_name(_cid uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF _cid IS NULL THEN RETURN NULL; END IF;
  RETURN COALESCE(NULLIF(public.team_consultant_name(_cid), ''), 'Consultant');
EXCEPTION WHEN OTHERS THEN
  RETURN 'Consultant';
END
$$;
REVOKE ALL ON FUNCTION public.referral_masked_name(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.referral_norm_code(_code text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $$
  SELECT NULLIF(upper(left(regexp_replace(COALESCE(_code, ''), '\s', '', 'g'), 40)), '')
$$;

-- Same person check: lower-case, "+tag" removed, Gmail dots removed.
CREATE OR REPLACE FUNCTION public.referral_norm_email(_email text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $$
  SELECT CASE WHEN position('@' IN COALESCE(_email, '')) = 0 THEN NULL ELSE
    (CASE WHEN lower(split_part(_email, '@', 2)) IN ('gmail.com', 'googlemail.com')
          THEN replace(split_part(split_part(lower(_email), '@', 1), '+', 1), '.', '')
          ELSE split_part(split_part(lower(_email), '@', 1), '+', 1) END)
    || '@' || CASE WHEN lower(split_part(_email, '@', 2)) = 'googlemail.com' THEN 'gmail.com' ELSE lower(split_part(_email, '@', 2)) END
  END
$$;

-- Mirrored by src/lib/referrals.ts (referralCodeProblem).
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

-- e.g. SAP-MOSTAFA-7K2M9QX (letters of the first name, Latin only; otherwise SAP-7K2M9QX): always 7 random characters
-- from the 31-character safe alphabet (31^7 = 27.5 billion), so codes can not be guessed from a name.
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

-- Code owner (new codes, the previous code after an edit, and the old 8-character member codes of consultants).
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
  -- First sign-ins (30 days after attribution): the same device or network as the other side adds a signal.
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

-- Tier count (anti tier-gaming): referred consultants who are VERIFIED by an administrator, passed the profile gate
-- (profile_submitted_at), are in an active, not-under-review referral and are not suspended, merged or anonymised; with
-- referral_tier_requires_paid (default on) they also need a PAID ticket within referral_tier_paid_days (90) of their
-- verification or of an administrator's approval of the referral. Mirrored by tierQualifies() in src/lib/referrals.ts.
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

-- Tier for a count: {index, name, rate, min, next_name, next_min, next_rate, needed}. Mirrored by tierFor().
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

-- Signed policy = an acknowledgement exists and the consultant is not blocked for a missing one.
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

-- Passed = a completed AI interview with overall_score >= referral_min_interview_score (read from interview data only).
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

-- Accepted the CURRENT terms version.
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

-- Next step for one side of a pair: pass_interview | acknowledge | wait_other | none.
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

-- Chip from one side: active | expired | under_review | waiting_you | waiting_them.
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

-- 3b. Fraud and related-party signals ------------------------------------------------------------------------------------------
-- Money is rounded in ONE place: 2 decimals, half away from zero (= half-up for rewards).
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

-- Phone: digits only, last 9 digits (country prefix and leading zero ignored); NULL when shorter than 8 digits.
CREATE OR REPLACE FUNCTION public.referral_norm_phone(_p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $$
  SELECT CASE WHEN length(d) >= 8 THEN right(d, 9) END FROM (SELECT regexp_replace(COALESCE(_p, ''), '\D', '', 'g') AS d) x
$$;

-- Weighted score: near-identity signals (same bank account, phone, e-mail, account) count 2, others 1.
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

-- Shared signals between two accounts (users): same_account, same_email (normalised), same_domain (company domain, not
-- free mail), same_phone, same_ip (any shared salted network hash). Nothing is returned to the browser.
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

-- Signals at attribution (A1): same device / network hash as the referrer, same bank account (compared in the payout
-- table, never copied), same phone / company domain, and velocity (too many sign-ups per referrer or per network hash a day).
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

-- Add signals to a referral (later sign-ins, bank details added). Score >= threshold puts the referral (back) under review
-- and holds its unpaid rewards until an administrator clears it.
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

-- Code-check lock-out (A4). Keys are salted network hashes or "u:<account>"; answers stay generic.
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

-- An administrator may not act on a referral account they are part of (own line, own referral, own adjustment).
CREATE OR REPLACE FUNCTION public.referral_admin_is_party(_consultants uuid[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = ANY (_consultants) AND c.user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.referral_admin_is_party(uuid[]) FROM PUBLIC, anon, authenticated;

-- 4. Notifications (in-app now, e-mail through the queue) ---------------------------------------------------------------------
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

-- One notice to one consultant (_to) about the other side (_other, masked name): in-app (also shown as a pop-up at the
-- next sign-in) + one e-mail through the queue. Callers make sure each event is sent once.
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

-- 5. Attribution ------------------------------------------------------------------------------------------------------------
-- Result: ok | none | off | already | invalid | self | loop. Self-referral (same account / normalised e-mail) and loops of
-- any length (A-B-A, A-B-C-A) are refused; the other signals are flagged and a score >= referral_review_flag_threshold
-- creates the referral under review (status 'review'): it earns nothing until an administrator approves it.
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

-- New consultant rows: code + attribution from the sign-up metadata (e-mail sign-up). Never blocks a sign-up.
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
    -- Only the code is read (any referrer id, status or amount in the metadata is ignored). A code captured by the link
    -- more than 30 days before sign-up is ignored; the first valid code wins and is never overwritten (one row per consultant).
    IF NULLIF(_meta ->> 'referral_code', '') IS NOT NULL
       AND NOT COALESCE((_meta ->> 'referral_captured_at') ~ '^\d{4}-\d{2}-\d{2}T?' AND (_meta ->> 'referral_captured_at')::timestamptz < now() - interval '30 days', false) THEN
      PERFORM public.referral_attribute(NEW.id, _meta ->> 'referral_code', 'signup', _meta ->> 'referral_device', public.referral_request_ip());
      -- Acknowledgement ticked in the registration referral step (current version only).
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

-- Referrer is told once when the referred consultant becomes verified.
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

-- 5b. Activation: both passed the AI interview + both accepted the current terms, before the activation period ends ---------
-- The only writer of activation_status (the browser has no write access). Each notice is sent once (timestamps).
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
    -- "You passed" goes once per consultant, however many referrals they have.
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

-- Re-check every pending pair of a consultant (as referrer or referred).
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

-- Reminders after 14 and 45 days (each once, to both sides with their own next step) and expiry. Called nightly.
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

-- 6. Rewards ----------------------------------------------------------------------------------------------------------------
-- NULL = may earn; otherwise the reason. Mirrored by src/lib/referrals.ts (rewardBlockReason).
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

-- A payouts row for the referred consultant (= the client has paid) starts the 12-month window. No reward yet.
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
  -- The window starts with the first paid ticket, even if that payout itself earns nothing.
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
  -- A referral problem must never stop a consultant payout.
  RAISE WARNING 'referral window skipped for payout %: %', NEW.id, SQLERRM;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_referral_on_payout_insert ON public.payouts;
CREATE TRIGGER trg_referral_on_payout_insert
  AFTER INSERT ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.referral_on_payout_insert();

-- The ONLY writer of reward lines (A5). Called when the referred consultant's payout is RELEASED (completed) by the
-- payouts trigger, and again by the nightly catch-up job; idempotent (unique key + unique index on the payout) and
-- serialised by row locks on the payout and the referral. Nothing comes from the browser: fee, rate, tier, referrer and
-- status are all read here. The line is 'pending' until matures_at (release + referral_hold_days), then the nightly job
-- makes it 'available' if the client payment is still cleared.
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
  -- The client payment must have CLEARED (completed; not pending, refunded or disputed).
  IF _why IS NULL THEN
    SELECT * INTO pay FROM public.payments WHERE id = po.payment_id;
    IF NOT FOUND THEN _why := 'no_invoice';
    ELSIF pay.status::text <> 'completed' THEN _why := 'payment_not_cleared';
    END IF;
  END IF;
  _fee := public.referral_money(COALESCE(po.gross_amount, po.amount, 0));
  IF _why IS NULL AND _fee <= 0 THEN _why := 'no_fee'; END IF;
  IF _why IS NULL AND _fee < (s ->> 'min_invoice')::numeric THEN _why := 'below_min_invoice'; END IF;
  -- Bank details may have been added after sign-up: re-check the same-account signal.
  IF _why IS NULL AND NOT ('same_bank' = ANY (r.flags)) AND public.referral_same_bank(r.referrer_consultant_id, r.referred_consultant_id) THEN
    PERFORM public.referral_add_flags(r.referred_consultant_id, ARRAY['same_bank'], 'Same bank account found at payout');
    SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = po.consultant_id;
  END IF;
  IF _why IS NOT NULL THEN
    PERFORM public.referral_log(NULL, 'reward_skipped', r.referrer_consultant_id, r.referred_consultant_id, NULL, po.id, NULL, NULL, _why);
    RETURN NULL;
  END IF;
  -- Rate = the referrer's tier at this moment (not retroactive).
  _tier := public.referral_tier_for(public.referral_verified_count(r.referrer_consultant_id));
  _rate := (_tier ->> 'rate')::numeric;
  _amt := public.referral_money(_fee * _rate / 100);
  IF _amt <= 0 THEN
    PERFORM public.referral_log(NULL, 'reward_skipped', r.referrer_consultant_id, r.referred_consultant_id, NULL, po.id, NULL, NULL, 'no_fee');
    RETURN NULL;
  END IF;
  -- Related parties (wash work): the paying client shares an account, e-mail, company domain, phone or network with the
  -- referrer or the referred consultant, or one of them is a member of the paying company.
  SELECT user_id INTO _ur FROM public.consultants WHERE id = r.referrer_consultant_id;
  SELECT user_id INTO _ud FROM public.consultants WHERE id = r.referred_consultant_id;
  _flags := ARRAY(SELECT 'client_' || x FROM unnest(public.referral_related_flags(pay.client_id, _ur) || public.referral_related_flags(pay.client_id, _ud)) x GROUP BY x);
  IF pay.tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.tenant_id = pay.tenant_id AND tm.user_id IN (_ur, _ud)) THEN
    _flags := array_append(_flags, 'tenant_member');
  END IF;
  -- Monthly caps (per referrer and per referred consultant, per currency) and the optional lifetime cap: exceeding one
  -- never cuts the reward silently; the full line is held for an administrator.
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

-- Hold period over -> 'available', only while the client payment is still cleared and the payout still completed.
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

-- Status of a reward line once a hold is lifted: available only after its hold period.
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

-- Payout released -> reward line; referral payouts completed -> lines paid.
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
      -- A failed referral payout gives the lines back (available again for the next run).
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

-- Reversal: not yet paid -> both lines "reversed" (net zero, both visible); already in a payout or paid -> a negative
-- available line that is deducted from the next referral payout.
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

-- Refund / chargeback -> reverse; dispute -> hold; dispute settled back to paid -> release.
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
    -- Settled: back to pending (or available if the hold period is already over).
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

-- The paying client's network hash (when they report or confirm a payment themselves) for the related-party check.
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
REVOKE ALL ON FUNCTION public.referral_note_payer() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_referral_note_payer ON public.payments;
CREATE TRIGGER trg_referral_note_payer
  AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.referral_note_payer();

-- Payout details changed (A5): the consultant is told in the app and by e-mail, and referral payouts wait
-- payout_details_change_hold_days (7) before they are released. The bank values themselves are never copied.
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

-- 7. Referral payouts (normal payout run, existing bank details, 15-business-day due date from the payouts trigger) ------------
CREATE OR REPLACE FUNCTION public.referral_referrer_payable(_cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  -- Only to the referrer's OWN payout details, verified by an administrator, and not changed in the cool-down period.
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
  -- One bundling run at a time (job and administrator button can not create two payouts for the same lines).
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

-- Weekly digest line for administrators (Monday morning job).
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
  -- Catch-up: released payouts of the last 90 days without a reward line (idempotent, same function as the trigger).
  PERFORM public.referral_create_reward(po.id)
     FROM public.payouts po JOIN public.consultant_referrals r ON r.referred_consultant_id = po.consultant_id
    WHERE po.status::text = 'completed' AND COALESCE(po.reference, '') NOT LIKE 'referral:%' AND po.updated_at > now() - interval '90 days'
      AND NOT EXISTS (SELECT 1 FROM public.referral_reward_lines l WHERE l.source_payout_id = po.id AND l.kind = 'reward');
  _m := public.referral_mature_lines(now());
  _n := public.referral_bundle_payouts(NULL);
  UPDATE public.referral_adjust_requests SET status = 'expired' WHERE status = 'pending' AND expires_at <= now();
  -- Retention of the hashed signals (referral_signal_retention_days, default 12 months).
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

-- 8. Public and consultant RPCs ----------------------------------------------------------------------------------------------
-- Live check on the sign-up form: only valid/invalid and the masked owner name. Rate limited (anti-enumeration).
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
  -- Rate limit per network hash AND per account; repeated invalid codes lock the checker (same generic message).
  IF EXISTS (SELECT 1 FROM unnest(_who) w WHERE NOT public.check_rate_limit('refval:' || w, 30, 600)) OR public.referral_code_locked(_who) THEN
    RAISE EXCEPTION 'Too many code checks. Please wait a few minutes and try again.' USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE((public.referral_settings() ->> 'enabled')::boolean, false) THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  IF public.referral_norm_code(_code) IS NOT NULL AND length(replace(public.referral_norm_code(_code), '-', '')) >= 7 THEN
    _referrer := public.referral_find_code(_code);
  END IF;
  -- Invalid, unknown and switched-off codes give the very same answer.
  IF _referrer IS NULL THEN
    PERFORM public.referral_code_failed(_who);
    RETURN jsonb_build_object('valid', false);
  END IF;
  RETURN jsonb_build_object('valid', true, 'name', public.referral_masked_name(_referrer));
END
$$;
REVOKE ALL ON FUNCTION public.referral_validate_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_validate_code(text) TO anon, authenticated;

-- Link click counter (one per visitor and code per 12 hours; nothing personal stored).
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

-- Late attribution (Google sign-in or a code typed after sign-up): within referral_claim_days of the account and
-- before the first paid ticket. Locked afterwards.
-- May this consultant still add "Who invited you?" themselves? New accounts: within referral_claim_days of sign-up.
-- Consultants registered before the launch: until referral_claim_until (launch + 14 days). Never after a paid ticket.
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
                                   'activation_days', s->'activation_days', 'tiers', s->'tiers'),
    'tier', public.referral_tier_for(public.referral_verified_count(_cid)),
    -- Referrer activation checklist: interview passed -> terms acknowledged -> active (sharing unlocked).
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
      'payout_details', EXISTS (SELECT 1 FROM public.consultant_payout_details d WHERE d.consultant_id = _cid)));
END
$$;
REVOKE ALL ON FUNCTION public.my_referral_overview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_overview(text) TO authenticated;

-- Referred consultants: masked name, status, activation step and dates only.
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

-- The referred consultant's own invitation: who invited them (masked), activation timeline and next step.
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

-- Append-only acknowledgement of the current terms version (time, language, user agent, hashed IP).
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

-- The consultant may change the code once (the old code keeps working for links already shared).
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

-- 9. Administrator RPCs (admin / super admin, rate limited, audited) -----------------------------------------------------------
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

-- By referred consultant (full names for administrators), with fraud flags and signals.
DROP FUNCTION IF EXISTS public.admin_referral_referrals(text, text, int, int);
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

-- Actions: approve_line, hold_line, reverse_line, adjust (target = referrer), approve_referral, hold_referral,
-- remove_referral, change_referrer (target = referred), disable_code, enable_code (target = referrer), run_payouts.
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
      -- Approval lifts the hold only; the hold period (refunds / chargebacks) still applies.
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
    -- Four-eyes: above the threshold a second super administrator must approve (admin_referral_decide_adjustment).
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

  -- Resend the pending reminders / acknowledgement requests (once per pair per 24 hours), or revive an expired pair.
  -- Existing consultants have no referrer; only an administrator can set one (reason required, audited).
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

-- Audited CSV source for the accountant ('lines') or the attribution list ('referrals').
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

-- 10. Old member programme: same bodies, but consultant-to-consultant referrals belong to this programme only. ----------------
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

  -- Feature Z: a consultant who joins with a consultant's code is handled by the consultant referral programme.
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
  -- Feature Z: referred consultants earn their referrer a percentage instead of the member credit (never both).
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

-- 10b. Referral calculations (Refer & earn > Referral calculations) -----------------------------------------------------------
-- Every number is computed on read from referral_reward_lines + payouts + payments + approved timesheets, so it is always
-- current after a payment, release or reversal. Consultants read only their own data; administrators can read any
-- consultant (read-only). Referred consultants are identified by an opaque key and the masked public name only.
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

-- Opaque keys for the browser (salted, so no consultant, ticket or payment id can be derived or enumerated).
CREATE OR REPLACE FUNCTION public.referral_ref_key(_referrer uuid, _referred uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT left(public.referral_hash('ref:' || _referrer::text || ':' || _referred::text), 16)
$$;
REVOKE ALL ON FUNCTION public.referral_ref_key(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- "Engagement #A12F": the same engagement (ticket) shows the same reference to one referrer; nothing about the client or ticket.
CREATE OR REPLACE FUNCTION public.referral_engagement_ref(_referrer uuid, _engagement uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT CASE WHEN _engagement IS NULL THEN NULL ELSE 'Engagement #' || upper(left(public.referral_hash('eng:' || _referrer::text || ':' || _engagement::text), 4)) END
$$;
REVOKE ALL ON FUNCTION public.referral_engagement_ref(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Internal: one row per reward/reversal line of a referrer (no access check; callers check). Privacy (A7): only the fee
-- base and hours of the invoice line and an anonymous engagement reference - never the client, ticket title, ticket id,
-- e-mail or the referred consultant's hourly rate.
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

-- Internal: summary strip for one referrer.
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

-- Per referred consultant (and currency): man-days, fee base, reward, reversed, net, state amounts.
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

-- Monthly series (Riyadh months): net earned by line date and paid by payment date.
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

-- Honest forecast: only timesheets already APPROVED by the client (status 'signed'), after activation, inside the window,
-- whose client invoice is not paid yet. Expected, not guaranteed (the client still has to pay).
CREATE OR REPLACE FUNCTION public.referral_calc_forecast(_consultant uuid DEFAULT NULL)
 RETURNS TABLE (currency text, timesheets int, approved_hours numeric, expected_fee numeric, expected_reward numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _cid uuid := public.referral_calc_target(_consultant);
  -- Expected at today's tier (the real rate is the tier when the client pays).
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

-- Monthly statements saved in the consultant's account (generated on the 1st for the previous month).
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

-- Reconciliation (administrators): formula per line, reversals mirror their reward, referral payouts equal their lines,
-- paid lines equal completed referral payouts, one reward per payout. _only_problems lists flagged rows only.
-- Internal reconciliation (no access check; callers check): lines = balances = referral payouts.
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

-- Rate-change audit trail: who changed the tiers / maximum rate and when, old and new values.
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

-- 11. Codes for every existing consultant (existing consultants have no referrer: attribution starts with new sign-ups).
-- Every consultant except rejected / suspended gets exactly one code (idempotent, collision-safe through
-- referral_ensure_code; touches no other column). Others still get one lazily when they open Refer & earn.
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

-- 11b. Announcement to existing consultants: IN-APP only (bell entry + pop-up), sent by an administrator, once per
-- consultant. Not e-mailed: a programme announcement to every consultant is bulk promotional mail, which app e-mails
-- must not carry. Excludes rejected/suspended/deleted accounts and anyone who paused in-app notices.
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

-- Who would receive it now: 'eligible' (not yet sent) or the reason they are left out.
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

-- _test = true: only to the administrator's own account (no log). Otherwise up to _limit (max 200) per call,
-- 10 calls per hour per administrator, once per consultant (primary key), audited.
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

-- 13. Security: daily reconciliation alert, anomaly dashboard, four-eyes adjustments, table privileges ---------------------------
-- Daily (nightly job): all reconciliation checks over every referrer; any problem -> security notification to super admins.
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

-- Anomaly dashboard (administrators): top earners, fast risers, shared network / bank clusters (shown as numbered
-- clusters of names - hashes never leave the database), reversal ratio and rewards against invoice totals.
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

-- Four-eyes requests (list for administrators).
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

-- Second person (super administrator, not the requester, not the consultant) approves or rejects.
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

-- Table privileges (A5): the browser never writes any referral table. Reads are own-row (codes, acknowledgements) or
-- administrator-only through RLS; everything else goes through the SECURITY DEFINER functions above.
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
-- Plain helper functions are not for the browser either.
REVOKE ALL ON FUNCTION public.referral_norm_code(text), public.referral_norm_email(text), public.referral_code_blocked_word(text),
                       public.referral_random(int), public.referral_name_part(text), public.referral_tiers_valid(jsonb, numeric),
                       public.referral_money(numeric), public.referral_free_domain(text), public.referral_norm_phone(text),
                       public.referral_flag_score(text[]), public.referral_request_ip(), public.referral_ack_append_only()
  FROM PUBLIC, anon, authenticated;

-- 12. Jobs (plain database calls, credential-free like the other sweeps) --------------------------------------------------------
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('referral-nightly', 'referral-weekly-digest', 'referral-monthly-statements');
SELECT cron.schedule('referral-nightly', '23 2 * * *', 'SELECT public.referral_nightly()');
SELECT cron.schedule('referral-weekly-digest', '37 4 * * 1', 'SELECT public.referral_weekly_digest()');
SELECT cron.schedule('referral-monthly-statements', '19 3 1 * *', 'SELECT public.referral_generate_statements(NULL)');

-- Dry run BEFORE applying (read-only, works on the current database):
--   SELECT count(*) AS consultants,
--          count(*) FILTER (WHERE verification_status::text NOT IN ('rejected', 'suspended')) AS will_get_a_code,
--          count(*) FILTER (WHERE verification_status::text IN ('rejected', 'suspended')) AS excluded
--     FROM public.consultants;
-- Checks after applying:
--   SELECT public.referral_backfill_preview();                         -- will_create = 0
--   SELECT public.referral_public_settings();
--   SELECT count(*) FROM public.consultant_referral_codes;          -- one per consultant
--   SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'referral-%';

-- 14. Default deny (A5): any referral function not on the browser list loses EXECUTE for PUBLIC, anon and authenticated
-- (trigger functions included). Browser RPCs: the three public checks, the consultant my_* / referral_* RPCs below and the
-- admin_referral_* RPCs, which check the role themselves. Checked by T25 in docs/sql/referral.test.sql.
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
