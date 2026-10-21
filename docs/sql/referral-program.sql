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
  ('referral_rate_percent', '0.5'::jsonb),
  ('referral_months', '12'::jsonb),
  ('referral_min_payout', '25'::jsonb),
  ('referral_max_reward_per_referred', 'null'::jsonb),
  ('referral_monthly_cap_per_referrer', 'null'::jsonb),
  ('referral_claim_days', '7'::jsonb),
  ('referral_terms_version', '1'::jsonb)
ON CONFLICT (key) DO NOTHING;

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

CREATE OR REPLACE FUNCTION public.referral_settings()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'enabled', public.platform_flag('referral_enabled', true),
    'rate_percent', public.referral_setting_num('referral_rate_percent', 0.5, 0, 10),
    'months', public.referral_setting_num('referral_months', 12, 1, 60)::int,
    'min_payout', public.referral_setting_num('referral_min_payout', 25, 0, 100000),
    'max_per_referred', public.referral_setting_cap('referral_max_reward_per_referred'),
    'monthly_cap', public.referral_setting_cap('referral_monthly_cap_per_referrer'),
    'claim_days', public.referral_setting_num('referral_claim_days', 7, 0, 30)::int,
    'terms_version', public.referral_setting_num('referral_terms_version', 1, 1, 1000)::int)
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
                            'min_payout', s->'min_payout', 'terms_version', s->'terms_version')
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
  CONSTRAINT consultant_referral_code_format CHECK (code ~ '^[A-Z0-9]{2,12}(-[A-Z0-9]{1,12}){0,3}$' AND length(code) BETWEEN 4 AND 24)
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
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'review', 'held', 'removed')),
  flags text[] NOT NULL DEFAULT '{}',
  device_hash text,
  ip_hash text,
  approved_at timestamptz,
  approved_by uuid,
  verified_notified_at timestamptz,
  first_reward_notified_at timestamptz,
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
  source_payout_id uuid REFERENCES public.payouts(id) ON DELETE SET NULL,
  payment_id uuid,
  reverses_line_id uuid REFERENCES public.referral_reward_lines(id) ON DELETE SET NULL,
  fee_amount numeric(14,2),
  rate_percent numeric(6,3),
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL CHECK (status IN ('pending', 'available', 'held', 'in_payout', 'paid', 'reversed')),
  hold_reason text CHECK (hold_reason IS NULL OR hold_reason IN ('review', 'admin', 'dispute')),
  referral_payout_id uuid REFERENCES public.payouts(id) ON DELETE SET NULL,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
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

-- Programme terms acknowledgement (required the first time the Refer & earn page opens).
CREATE TABLE IF NOT EXISTS public.referral_terms_acks (
  consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
  version int NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.referral_terms_acks TO authenticated;
GRANT ALL ON public.referral_terms_acks TO service_role;
ALTER TABLE public.referral_terms_acks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own referral terms or admin" ON public.referral_terms_acks;
CREATE POLICY "Own referral terms or admin" ON public.referral_terms_acks
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = consultant_id AND c.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

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
  kind text NOT NULL CHECK (kind IN ('signup', 'verified', 'first_reward')),
  referred_name text,
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

-- e.g. SAP-MOSTAFA-7K2 (letters of the first name, Latin only; otherwise SAP-7K2M9Q).
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
    _c := 'SAP-' || COALESCE(_part || '-', '') || public.referral_random(CASE WHEN _part IS NULL THEN 6 ELSE 3 END + CASE WHEN _try > 5 THEN 2 ELSE 0 END);
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
            OR s.deleted_at IS NOT NULL
            OR (s.suspended_at IS NOT NULL AND (s.suspended_until IS NULL OR s.suspended_until > now()))))
$$;
REVOKE ALL ON FUNCTION public.referral_consultant_suspended(uuid) FROM PUBLIC, anon, authenticated;

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

CREATE OR REPLACE FUNCTION public.referral_notify(_referrer uuid, _kind text, _referred uuid, _amount numeric, _currency text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _user uuid;
  _name text := public.referral_masked_name(_referred);
  s jsonb := public.referral_settings();
  _title text;
  _body text;
BEGIN
  SELECT c.user_id INTO _user FROM public.consultants c WHERE c.id = _referrer;
  IF _user IS NULL THEN RETURN; END IF;
  IF _kind = 'signup' THEN
    _title := 'Someone signed up with your referral code';
    _body := format('%s signed up with your code. You earn %s %% of their fees for %s months after their first paid ticket, paid by AI Support 360.',
                    _name, (s->>'rate_percent'), (s->>'months'));
  ELSIF _kind = 'verified' THEN
    _title := 'Your referral is verified';
    _body := format('%s is now a verified consultant. Your reward starts with their first paid ticket.', _name);
  ELSE
    _title := 'You earned your first referral reward';
    _body := format('You earned %s %s from the work of %s. It becomes available when their payout is completed.',
                    to_char(_amount, 'FM999999990.00'), COALESCE(_currency, 'USD'), _name);
  END IF;
  PERFORM public.safe_insert_notification(_user, _title, _body, 'referral', '/consultant/referrals');
  INSERT INTO public.referral_email_queue (user_id, kind, referred_name, amount, currency)
  VALUES (_user, _kind, _name, _amount, _currency);
END
$$;
REVOKE ALL ON FUNCTION public.referral_notify(uuid, text, uuid, numeric, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.referral_email_claim(_limit int DEFAULT 100)
 RETURNS TABLE (id uuid, user_id uuid, kind text, lang text, display_name text, referred_name text, amount numeric, currency text,
                rate_percent numeric, months int)
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
    RETURNING q.id, q.user_id, q.kind, q.referred_name, q.amount, q.currency
  )
  SELECT u.id, u.user_id, u.kind,
         (SELECT CASE WHEN p.preferred_language = 'ar' THEN 'ar' ELSE 'en' END FROM public.profiles p WHERE p.user_id = u.user_id),
         (SELECT p.display_name FROM public.profiles p WHERE p.user_id = u.user_id),
         u.referred_name, u.amount, u.currency, (s->>'rate_percent')::numeric, (s->>'months')::int
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
-- Result: ok | none | off | already | invalid | self | loop. Self-referral and loops are refused; same device, same IP
-- and same bank account are flagged ("review": rewards held until an administrator approves).
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
  IF _dh IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_devices d WHERE d.consultant_id = _referrer AND d.kind = 'device' AND d.hash = _dh) THEN
    _flags := array_append(_flags, 'same_device');
  END IF;
  IF _ih IS NOT NULL AND EXISTS (SELECT 1 FROM public.referral_devices d WHERE d.consultant_id = _referrer AND d.kind = 'ip' AND d.hash = _ih) THEN
    _flags := array_append(_flags, 'same_ip');
  END IF;
  IF public.referral_same_bank(_referrer, _referred) THEN _flags := array_append(_flags, 'same_bank'); END IF;
  INSERT INTO public.consultant_referrals (referred_consultant_id, referrer_consultant_id, code, source, flags, device_hash, ip_hash, status)
  VALUES (_referred, _referrer, _c, CASE WHEN _source IN ('signup', 'claim', 'admin') THEN _source ELSE 'signup' END, _flags, _dh, _ih,
          CASE WHEN cardinality(_flags) > 0 THEN 'review' ELSE 'active' END)
  ON CONFLICT (referred_consultant_id) DO NOTHING;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n = 0 THEN RETURN 'already'; END IF;
  PERFORM public.referral_note_device(_referred, _device, _ip);
  PERFORM public.referral_log(NULL, 'attributed', _referrer, _referred, NULL, NULL, NULL,
                              jsonb_build_object('code', _c, 'source', _source, 'flags', _flags), NULL);
  PERFORM public.referral_notify(_referrer, 'signup', _referred, NULL, NULL);
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
    IF NULLIF(_meta ->> 'referral_code', '') IS NOT NULL THEN
      PERFORM public.referral_attribute(NEW.id, _meta ->> 'referral_code', 'signup', _meta ->> 'referral_device', NULL);
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

-- 6. Rewards ----------------------------------------------------------------------------------------------------------------
-- NULL = may earn; otherwise the reason. Mirrored by src/lib/referrals.ts (rewardBlockReason).
CREATE OR REPLACE FUNCTION public.referral_reward_block_reason(_referrer uuid, _referred uuid, _status text, _window_ends timestamptz, _at timestamptz)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT COALESCE((public.referral_settings() ->> 'enabled')::boolean, false) THEN RETURN 'programme_off'; END IF;
  IF _status = 'removed' THEN RETURN 'removed'; END IF;
  IF _referrer = _referred THEN RETURN 'own_work'; END IF;
  IF _window_ends IS NULL OR _at >= _window_ends THEN RETURN 'outside_window'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _referred AND c.verification_status::text = 'verified') THEN RETURN 'referred_not_verified'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _referrer AND c.verification_status::text = 'verified') THEN RETURN 'referrer_not_verified'; END IF;
  IF public.referral_consultant_suspended(_referrer) THEN RETURN 'referrer_suspended'; END IF;
  IF NOT public.referral_policy_ok(_referrer) THEN RETURN 'referrer_policy'; END IF;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.referral_reward_block_reason(uuid, uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- Same trigger point as the consultant payout: a payouts row for the referred consultant (= the client has paid).
CREATE OR REPLACE FUNCTION public.referral_on_payout_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  r record;
  s jsonb := public.referral_settings();
  _why text;
  _fee numeric;
  _rate numeric := (s->>'rate_percent')::numeric;
  _amt numeric;
  _cap numeric;
  _used numeric;
  _cur text := upper(COALESCE(NEW.currency, 'USD'));
  _status text;
  _hold text;
  _line uuid;
  _flags text[];
BEGIN
  IF COALESCE(NEW.reference, '') LIKE 'referral:%' THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = NEW.consultant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- The window starts with the first paid ticket, even if that payout itself earns nothing.
  IF r.first_paid_at IS NULL THEN
    UPDATE public.consultant_referrals
       SET first_paid_at = NEW.created_at, window_ends_at = NEW.created_at + make_interval(months => (s->>'months')::int), updated_at = now()
     WHERE referred_consultant_id = NEW.consultant_id;
    PERFORM public.referral_log(NULL, 'first_paid', r.referrer_consultant_id, NEW.consultant_id, NULL, NEW.id, NULL,
                                jsonb_build_object('window_ends_at', NEW.created_at + make_interval(months => (s->>'months')::int)), NULL);
  END IF;
  -- Bank details may have been added after sign-up: re-check the same-account signal.
  IF NOT ('same_bank' = ANY (r.flags)) AND public.referral_same_bank(r.referrer_consultant_id, r.referred_consultant_id) THEN
    UPDATE public.consultant_referrals
       SET flags = array_append(flags, 'same_bank'),
           status = CASE WHEN status = 'active' AND approved_at IS NULL THEN 'review' ELSE status END, updated_at = now()
     WHERE referred_consultant_id = NEW.consultant_id;
  END IF;
  SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = NEW.consultant_id;
  _why := public.referral_reward_block_reason(r.referrer_consultant_id, r.referred_consultant_id, r.status, r.window_ends_at, NEW.created_at);
  _fee := round(COALESCE(NEW.gross_amount, NEW.amount, 0), 2);
  IF _why IS NULL AND _fee <= 0 THEN _why := 'no_fee'; END IF;
  _amt := round(_fee * _rate / 100, 2);
  IF _why IS NULL AND _amt <= 0 THEN _why := 'no_fee'; END IF;
  IF _why IS NULL THEN
    _cap := (s->>'max_per_referred')::numeric;
    IF _cap IS NOT NULL THEN
      SELECT COALESCE(sum(amount), 0) INTO _used FROM public.referral_reward_lines
       WHERE referred_consultant_id = r.referred_consultant_id AND currency = _cur AND kind IN ('reward', 'reversal') AND status <> 'reversed';
      _amt := least(_amt, greatest(_cap - _used, 0));
    END IF;
    _cap := (s->>'monthly_cap')::numeric;
    IF _cap IS NOT NULL THEN
      SELECT COALESCE(sum(amount), 0) INTO _used FROM public.referral_reward_lines
       WHERE referrer_consultant_id = r.referrer_consultant_id AND currency = _cur AND kind IN ('reward', 'reversal') AND status <> 'reversed'
         AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'Asia/Riyadh');
      _amt := least(_amt, greatest(_cap - _used, 0));
    END IF;
    IF _amt <= 0 THEN _why := 'cap_reached'; END IF;
  END IF;
  IF _why IS NOT NULL THEN
    PERFORM public.referral_log(NULL, 'reward_skipped', r.referrer_consultant_id, r.referred_consultant_id, NULL, NEW.id, NULL, NULL, _why);
    RETURN NULL;
  END IF;
  IF r.status IN ('review', 'held') THEN
    _status := 'held'; _hold := CASE WHEN r.status = 'review' THEN 'review' ELSE 'admin' END;
  ELSIF NEW.status::text = 'completed' THEN
    _status := 'available';
  ELSE
    _status := 'pending';
  END IF;
  INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, referred_consultant_id, source_payout_id, payment_id,
                                            fee_amount, rate_percent, amount, currency, status, hold_reason, available_at)
  VALUES ('reward:payout:' || NEW.id::text, 'reward', r.referrer_consultant_id, r.referred_consultant_id, NEW.id, NEW.payment_id,
          _fee, _rate, _amt, _cur, _status, _hold, CASE WHEN _status = 'available' THEN now() END)
  ON CONFLICT (unique_key) DO NOTHING
  RETURNING id INTO _line;
  IF _line IS NULL THEN RETURN NULL; END IF;
  PERFORM public.referral_log(NULL, 'reward_created', r.referrer_consultant_id, r.referred_consultant_id, _line, NEW.id, NULL,
                              jsonb_build_object('fee', _fee, 'rate', _rate, 'amount', _amt, 'currency', _cur, 'status', _status), NULL);
  IF r.first_reward_notified_at IS NULL THEN
    UPDATE public.consultant_referrals SET first_reward_notified_at = now(), updated_at = now() WHERE referred_consultant_id = r.referred_consultant_id;
    PERFORM public.referral_notify(r.referrer_consultant_id, 'first_reward', r.referred_consultant_id, _amt, _cur);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- A referral problem must never stop a consultant payout.
  RAISE WARNING 'referral reward skipped for payout %: %', NEW.id, SQLERRM;
  RETURN NULL;
END
$$;
DROP TRIGGER IF EXISTS trg_referral_on_payout_insert ON public.payouts;
CREATE TRIGGER trg_referral_on_payout_insert
  AFTER INSERT ON public.payouts
  FOR EACH ROW EXECUTE FUNCTION public.referral_on_payout_insert();

-- Pending -> available when the underlying payout is completed; referral payouts completed -> lines paid.
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
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.status::text = 'completed' THEN
    UPDATE public.referral_reward_lines SET status = 'available', available_at = now(), updated_at = now()
     WHERE source_payout_id = NEW.id AND status = 'pending';
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
                                            reverses_line_id, fee_amount, rate_percent, amount, currency, status, note, created_by, available_at)
  VALUES ('reversal:' || l.id::text, 'reversal', l.referrer_consultant_id, l.referred_consultant_id, l.source_payout_id, l.payment_id,
          l.id, l.fee_amount, l.rate_percent, -l.amount, l.currency, _st, left(COALESCE(_reason, 'Reversed'), 300), _actor,
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
    UPDATE public.referral_reward_lines x
       SET status = CASE WHEN (SELECT p.status::text FROM public.payouts p WHERE p.id = x.source_payout_id) = 'completed' THEN 'available' ELSE 'pending' END,
           hold_reason = NULL, updated_at = now()
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

-- 7. Referral payouts (normal payout run, existing bank details, 15-business-day due date from the payouts trigger) ------------
CREATE OR REPLACE FUNCTION public.referral_referrer_payable(_cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _cid AND c.verification_status::text = 'verified')
     AND NOT public.referral_consultant_suspended(_cid)
     AND EXISTS (SELECT 1 FROM public.consultant_payout_details d WHERE d.consultant_id = _cid)
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
    VALUES (g.cid, round(_total, 2), g.currency, 'pending', 'referral:' || gen_random_uuid()::text, round(_total, 2), 0, 0, 'Referral reward')
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
BEGIN
  _n := public.referral_bundle_payouts(NULL);
  DELETE FROM public.referral_devices WHERE last_seen_at < now() - interval '180 days';
  PERFORM public.referral_wake();
  RETURN jsonb_build_object('referral_payouts', _n);
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
  _who text := COALESCE(public.referral_hash(public.referral_request_ip()), 'u:' || COALESCE(auth.uid()::text, 'anon'));
  _referrer uuid;
BEGIN
  IF NOT public.check_rate_limit('refval:' || _who, 30, 600) THEN
    RAISE EXCEPTION 'Too many code checks. Please wait a few minutes and try again.' USING ERRCODE = 'P0001';
  END IF;
  IF public.referral_norm_code(_code) IS NULL OR length(public.referral_norm_code(_code)) < 4 THEN
    RETURN jsonb_build_object('valid', false);
  END IF;
  IF NOT COALESCE((public.referral_settings() ->> 'enabled')::boolean, false) THEN
    RETURN jsonb_build_object('valid', false, 'off', true);
  END IF;
  _referrer := public.referral_find_code(_code);
  IF _referrer IS NULL THEN RETURN jsonb_build_object('valid', false); END IF;
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
  IF NOT public.check_rate_limit('refclaim:' || auth.uid()::text, 10, 3600) THEN
    RAISE EXCEPTION 'Too many attempts. Please try again later.' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.consultant_referrals WHERE referred_consultant_id = _cid) THEN
    RETURN jsonb_build_object('result', 'already');
  END IF;
  SELECT u.created_at INTO _created FROM auth.users u WHERE u.id = auth.uid();
  IF _created IS NULL OR _created < now() - make_interval(days => (public.referral_settings() ->> 'claim_days')::int)
     OR EXISTS (SELECT 1 FROM public.payouts p WHERE p.consultant_id = _cid) THEN
    RETURN jsonb_build_object('result', 'too_late');
  END IF;
  _res := public.referral_attribute(_cid, _code, 'claim', _device, public.referral_request_ip());
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
                                   'min_payout', s->'min_payout', 'terms_version', s->'terms_version'),
    'code', _code,
    'previous_code', x.previous_code,
    'edits_left', greatest(0, 1 - COALESCE(x.edits_used, 0)),
    'disabled', x.disabled_at IS NOT NULL,
    'terms_accepted_version', (SELECT a.version FROM public.referral_terms_acks a WHERE a.consultant_id = _cid),
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
    'eligibility', jsonb_build_object(
      'verified', EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _cid AND c.verification_status::text = 'verified'),
      'policy', public.referral_policy_ok(_cid),
      'suspended', public.referral_consultant_suspended(_cid),
      'payout_details', EXISTS (SELECT 1 FROM public.consultant_payout_details d WHERE d.consultant_id = _cid)));
END
$$;
REVOKE ALL ON FUNCTION public.my_referral_overview(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_overview(text) TO authenticated;

-- Referred consultants: masked name, status and dates only.
CREATE OR REPLACE FUNCTION public.my_referrals()
 RETURNS TABLE (referred_name text, status text, attributed_at timestamptz, verified boolean, first_paid_at timestamptz,
                window_ends_at timestamptz, earned jsonb)
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
                      GROUP BY l.currency) e), '{}'::jsonb)
    FROM public.consultant_referrals r
    JOIN public.consultants c ON c.id = r.referred_consultant_id
   WHERE r.referrer_consultant_id = _cid AND r.status <> 'removed'
   ORDER BY r.attributed_at DESC
   LIMIT 500;
END
$$;
REVOKE ALL ON FUNCTION public.my_referrals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referrals() TO authenticated;

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

CREATE OR REPLACE FUNCTION public.referral_accept_terms(_version int)
 RETURNS void
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _cid uuid := public.referral_my_consultant();
  _v int := (public.referral_settings() ->> 'terms_version')::int;
BEGIN
  IF _cid IS NULL THEN RAISE EXCEPTION 'Only consultants can accept the referral terms' USING ERRCODE = '42501'; END IF;
  IF _version IS DISTINCT FROM _v THEN RAISE EXCEPTION 'The terms changed. Please reload the page.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.referral_terms_acks (consultant_id, version) VALUES (_cid, _v)
  ON CONFLICT (consultant_id) DO UPDATE SET version = EXCLUDED.version, accepted_at = now();
  PERFORM public.referral_log(auth.uid(), 'terms_accepted', _cid, NULL, NULL, NULL, NULL, jsonb_build_object('version', _v), NULL);
END
$$;
REVOKE ALL ON FUNCTION public.referral_accept_terms(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.referral_accept_terms(int) TO authenticated;

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
  IF _c IS NULL OR _c !~ '^[A-Z0-9]{2,12}(-[A-Z0-9]{1,12}){0,3}$' OR length(_c) NOT BETWEEN 4 AND 24 THEN
    RAISE EXCEPTION 'Use 4 to 24 letters and numbers, groups separated by a dash (for example SAP-MOSTAFA-7K2).' USING ERRCODE = '22023';
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
CREATE OR REPLACE FUNCTION public.admin_referral_referrals(_search text DEFAULT NULL, _filter text DEFAULT 'all', _limit int DEFAULT 200, _offset int DEFAULT 0)
 RETURNS TABLE (referred_id uuid, referred_name text, referred_public text, referrer_id uuid, referrer_name text, code text, source text,
                attributed_at timestamptz, status text, flags text[], signals text[], verified boolean, first_paid_at timestamptz,
                window_ends_at timestamptz, earned jsonb, approved_at timestamptz)
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
    SELECT r.*, pd.display_name AS dname, pr.display_name AS rname, c.verification_status::text = 'verified' AS is_verified,
           lower(split_part(ud.email, '@', 2)) AS dom
      FROM public.consultant_referrals r
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
           CASE WHEN b.dom IS NOT NULL AND b.dom NOT IN ('gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com', 'proton.me', 'protonmail.com')
                 AND (SELECT count(*) FROM base y WHERE y.referrer_consultant_id = b.referrer_consultant_id AND y.dom = b.dom) >= 3 THEN 'many_from_same_email_domain' END
         ], NULL),
         b.is_verified, b.first_paid_at, b.window_ends_at,
         COALESCE((SELECT jsonb_object_agg(e.currency, e.total) FROM (
                     SELECT l.currency, sum(l.amount) total FROM public.referral_reward_lines l
                      WHERE l.referred_consultant_id = b.referred_consultant_id AND l.status <> 'reversed' GROUP BY l.currency) e), '{}'::jsonb),
         b.approved_at
    FROM base b
   WHERE (_q IS NULL OR lower(COALESCE(b.dname, '')) LIKE '%' || _q || '%' OR lower(COALESCE(b.rname, '')) LIKE '%' || _q || '%' OR lower(b.code) LIKE '%' || _q || '%')
     AND (COALESCE(_filter, 'all') = 'all'
          OR (_filter = 'flagged' AND (cardinality(b.flags) > 0 OR b.status = 'review'))
          OR (_filter = 'held' AND b.status IN ('held', 'review'))
          OR (_filter = 'paying' AND b.first_paid_at IS NOT NULL)
          OR (_filter = 'removed' AND b.status = 'removed'))
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

CREATE OR REPLACE FUNCTION public.admin_referral_lines(_status text DEFAULT NULL, _limit int DEFAULT 300, _offset int DEFAULT 0)
 RETURNS TABLE (id uuid, created_at timestamptz, kind text, status text, hold_reason text, amount numeric, currency text, fee_amount numeric,
                rate_percent numeric, referrer_id uuid, referrer_name text, referred_id uuid, referred_name text, source_payout_id uuid,
                payment_id uuid, referral_payout_id uuid, note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.referral_is_admin() THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT l.id, l.created_at, l.kind, l.status, l.hold_reason, l.amount, l.currency, l.fee_amount, l.rate_percent,
         l.referrer_consultant_id, pr.display_name, l.referred_consultant_id, pd.display_name, l.source_payout_id, l.payment_id,
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
    IF _action = 'approve_line' THEN
      IF l.status <> 'held' THEN RAISE EXCEPTION 'Only held lines can be approved' USING ERRCODE = '22023'; END IF;
      UPDATE public.referral_reward_lines x
         SET status = CASE WHEN x.kind <> 'reward' OR (SELECT p.status::text FROM public.payouts p WHERE p.id = x.source_payout_id) = 'completed' THEN 'available' ELSE 'pending' END,
             hold_reason = NULL, available_at = COALESCE(available_at, now()), updated_at = now()
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
    IF _amount IS NULL OR _amount = 0 OR abs(_amount) > 100000 THEN RAISE EXCEPTION 'Enter an amount other than 0 (up to 100000)' USING ERRCODE = '22023'; END IF;
    IF _cur !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Currency must be a 3-letter code' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.referral_reward_lines (unique_key, kind, referrer_consultant_id, amount, currency, status, note, created_by, available_at)
    VALUES ('adjust:' || gen_random_uuid()::text, 'adjustment', _id, round(_amount, 2), _cur, 'available', _why, _actor, now())
    RETURNING id INTO _new;
    PERFORM public.referral_log(_actor, 'adjust', _id, NULL, _new, NULL, NULL, jsonb_build_object('amount', round(_amount, 2), 'currency', _cur), _why);
    RETURN jsonb_build_object('line', _new);
  END IF;

  IF _action IN ('approve_referral', 'hold_referral', 'remove_referral', 'change_referrer') THEN
    SELECT * INTO r FROM public.consultant_referrals WHERE referred_consultant_id = _id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Referral not found' USING ERRCODE = '42704'; END IF;
    IF _action = 'approve_referral' THEN
      UPDATE public.consultant_referrals SET status = 'active', approved_at = now(), approved_by = _actor, updated_at = now() WHERE referred_consultant_id = _id;
      UPDATE public.referral_reward_lines x
         SET status = CASE WHEN x.kind <> 'reward' OR (SELECT p.status::text FROM public.payouts p WHERE p.id = x.source_payout_id) = 'completed' THEN 'available' ELSE 'pending' END,
             hold_reason = NULL, updated_at = now()
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
    PERFORM public.referral_ensure_code(_id);
    UPDATE public.consultant_referral_codes
       SET disabled_at = CASE WHEN _action = 'disable_code' THEN now() END,
           disabled_reason = CASE WHEN _action = 'disable_code' THEN _why END, updated_at = now()
     WHERE consultant_id = _id;
    GET DIAGNOSTICS _n = ROW_COUNT;
    IF _n = 0 THEN RAISE EXCEPTION 'Consultant not found' USING ERRCODE = '42704'; END IF;
    PERFORM public.referral_log(_actor, _action, _id, NULL, NULL, NULL, NULL, NULL, _why);
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
  IF length(_why) < 5 THEN RAISE EXCEPTION 'Write a short reason (at least 5 characters).' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(_settings) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Settings must be an object' USING ERRCODE = '22023'; END IF;
  FOR _k, _v IN SELECT key, value FROM jsonb_each(_settings) LOOP
    IF _k = 'enabled' THEN
      IF jsonb_typeof(_v) <> 'boolean' THEN RAISE EXCEPTION 'enabled must be true or false' USING ERRCODE = '22023'; END IF;
      INSERT INTO public.platform_settings (key, value) VALUES ('referral_enabled', _v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    ELSIF _k IN ('rate_percent', 'months', 'min_payout', 'claim_days') THEN
      IF jsonb_typeof(_v) <> 'number'
         OR (_k = 'rate_percent' AND ((_v #>> '{}')::numeric < 0 OR (_v #>> '{}')::numeric > 10))
         OR (_k = 'months' AND ((_v #>> '{}')::numeric < 1 OR (_v #>> '{}')::numeric > 60 OR (_v #>> '{}')::numeric <> trunc((_v #>> '{}')::numeric)))
         OR (_k = 'min_payout' AND ((_v #>> '{}')::numeric < 0 OR (_v #>> '{}')::numeric > 100000))
         OR (_k = 'claim_days' AND ((_v #>> '{}')::numeric < 0 OR (_v #>> '{}')::numeric > 30 OR (_v #>> '{}')::numeric <> trunc((_v #>> '{}')::numeric))) THEN
        RAISE EXCEPTION 'Value out of range for %', _k USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.platform_settings (key, value) VALUES ('referral_' || _k, _v) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    ELSIF _k IN ('max_per_referred', 'monthly_cap') THEN
      IF NOT (jsonb_typeof(_v) = 'null' OR (jsonb_typeof(_v) = 'number' AND (_v #>> '{}')::numeric > 0 AND (_v #>> '{}')::numeric <= 10000000)) THEN
        RAISE EXCEPTION 'Use an empty value (no cap) or a positive amount for %', _k USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.platform_settings (key, value)
      VALUES (CASE WHEN _k = 'max_per_referred' THEN 'referral_max_reward_per_referred' ELSE 'referral_monthly_cap_per_referrer' END, _v)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
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

-- 11. Codes for every existing consultant (existing consultants have no referrer: attribution starts with new sign-ups).
SELECT public.referral_ensure_code(c.id) FROM public.consultants c;

-- 12. Jobs (plain database calls, credential-free like the other sweeps) --------------------------------------------------------
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('referral-nightly', 'referral-weekly-digest');
SELECT cron.schedule('referral-nightly', '23 2 * * *', 'SELECT public.referral_nightly()');
SELECT cron.schedule('referral-weekly-digest', '37 4 * * 1', 'SELECT public.referral_weekly_digest()');

-- Checks after applying:
--   SELECT public.referral_public_settings();
--   SELECT count(*) FROM public.consultant_referral_codes;          -- one per consultant
--   SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'referral-%';
