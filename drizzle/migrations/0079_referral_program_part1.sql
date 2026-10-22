INSERT INTO public.platform_settings (key, value) VALUES
('referral_enabled', 'true'::jsonb),
('referral_tiers', '[{"min": 0, "rate": 0.5, "name": "Tier 1"}, {"min": 11, "rate": 0.6, "name": "Tier 2"}, {"min": 21, "rate": 0.7, "name": "Tier 3"}, {"min": 31, "rate": 0.8, "name": "Tier 4"}, {"min": 41, "rate": 1.0, "name": "Tier 5"}]'::jsonb),
('referral_max_rate', '2'::jsonb),
('referral_months', '12'::jsonb),
('referral_min_payout', '25'::jsonb),
('referral_max_reward_per_referred', 'null'::jsonb),
('referral_monthly_cap_per_referrer', '1000'::jsonb),
('referral_monthly_cap_per_referred', '250'::jsonb),
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
'rules_texts', COALESCE((SELECT CASE WHEN jsonb_typeof(value) = 'object' THEN value END FROM public.platform_settings WHERE key = 'referral_rules_texts'), '{}'::jsonb),
'claim_days', public.referral_setting_num('referral_claim_days', 7, 0, 30)::int,
'launch_at', public.referral_setting_ts('referral_launch_at'),
'claim_until', public.referral_setting_ts('referral_claim_until'),
'terms_version', public.referral_setting_num('referral_terms_version', 1, 1, 1000)::int,
'pass_mark', public.referral_setting_num('referral_min_interview_score', 50, 0, 100),
'activation_days', public.referral_setting_num('referral_activation_days', 90, 1, 365)::int)
$$;
REVOKE ALL ON FUNCTION public.referral_settings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.referral_settings() TO service_role;
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
CREATE TABLE IF NOT EXISTS public.consultant_referral_codes (
consultant_id uuid PRIMARY KEY REFERENCES public.consultants(id) ON DELETE CASCADE,
code text NOT NULL,
previous_code text,
edits_used int NOT NULL DEFAULT 0,
disabled_at timestamptz,
disabled_reason text,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
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
flag_score int NOT NULL DEFAULT 0,
referred_verified_at timestamptz,
approved_at timestamptz,
approved_by uuid,
verified_notified_at timestamptz,
first_reward_notified_at timestamptz,
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
CREATE TABLE IF NOT EXISTS public.referral_reward_lines (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
unique_key text NOT NULL UNIQUE,
kind text NOT NULL CHECK (kind IN ('reward', 'reversal', 'adjustment')),
referrer_consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
referred_consultant_id uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
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
REVOKE ALL ON public.referral_acknowledgements FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, consultant_id, user_id, version, role, source, accepted_at, language) ON public.referral_acknowledgements TO authenticated;
GRANT ALL ON public.referral_acknowledgements TO service_role;
ALTER TABLE public.referral_acknowledgements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Own referral acknowledgements or admin" ON public.referral_acknowledgements;
CREATE POLICY "Own referral acknowledgements or admin" ON public.referral_acknowledgements
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
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
CREATE TABLE IF NOT EXISTS public.referral_code_attempts (
who text PRIMARY KEY,
window_start timestamptz NOT NULL DEFAULT now(),
invalid int NOT NULL DEFAULT 0,
locked_until timestamptz
);
REVOKE ALL ON public.referral_code_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_code_attempts TO service_role;
ALTER TABLE public.referral_code_attempts ENABLE ROW LEVEL SECURITY;
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