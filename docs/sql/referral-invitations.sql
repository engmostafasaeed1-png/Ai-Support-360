-- Refer & earn invitation (Admin > Users "Send Refer & earn invitation") + new referral event notices.
-- PREPARED ONLY: the owner reviews and applies this file; the owner approves the first real send. Safe to run twice
-- (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING). Needs the live Feature Z (referral-program.sql,
-- referral-tracking.sql), Feature R (bulk-messaging.sql) and Feature P (user-management.sql) objects; Feature Q pauses and
-- Feature N policy are probed (to_regprocedure / to_regclass).
--
-- Part A - invitation
--   * Delivery reuses Feature R: one message_campaigns row (category 'marketing', in-app + optional Telegram), recipients queued
--     for the existing throttled bulk-messages-run worker (kill switch, per-minute budgets, daily cap, immutable records).
--     The worker stores the in-app notice as type 'referral' linking to /consultant/referrals?tab=programme&from=invite.
--   * E-MAIL IS NOT A CHANNEL: an invitation to many consultants is promotional bulk mail; app e-mails are one-recipient and
--     event-triggered only.
--   * Eligibility is decided here (server-side), never only in the browser. Mirror for screens/tests: src/lib/referralInvitations.ts.
--   * Dedupe: one first invitation per user and invitation version (unique index); "resend" is a separate explicit option with a
--     reason, at most one per referral_invitation_resend_days (default 14). Same request id twice = same result (idempotent).
--   * Kill switch referral_invitations_enabled defaults to OFF. "Send to me only" (test) always works and reaches only the caller.
--   * Admin or super admin only (checked in every function); per-admin rate limits; every send is written to audit_logs.
-- Part B - referral event notices (in-app + e-mail through the existing referral_email_queue / referral-run function):
--   reward recorded (after the first), held, available, paid, reversed and referral not accepted. One notice per line and event.

-- ================================================================ A1. settings
INSERT INTO public.platform_settings (key, value) VALUES
  ('referral_invitations_enabled', 'false'::jsonb),
  ('referral_invitation_version', '1'::jsonb),
  ('referral_invitation_max_recipients', '500'::jsonb),
  ('referral_invitation_resend_days', '14'::jsonb),
  ('referral_email_example_fee', '1000'::jsonb),
  ('referral_email_example_currency', '"USD"'::jsonb),
  ('referral_terms_draft', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ================================================================ A2. tables
CREATE TABLE IF NOT EXISTS public.referral_invitation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 1000),
  mode text NOT NULL CHECK (mode IN ('selected', 'all_eligible', 'test')),
  resend boolean NOT NULL DEFAULT false,
  resend_reason text CHECK (resend_reason IS NULL OR char_length(resend_reason) <= 300),
  include_tests boolean NOT NULL DEFAULT false,
  channels text[] NOT NULL DEFAULT ARRAY['in_app']::text[] CHECK (channels <@ ARRAY['in_app', 'telegram']::text[]),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  campaign_id uuid REFERENCES public.message_campaigns (id),
  requested int NOT NULL DEFAULT 0 CHECK (requested >= 0),
  queued int NOT NULL DEFAULT 0 CHECK (queued >= 0),
  skipped int NOT NULL DEFAULT 0 CHECK (skipped >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_id, idempotency_key)
);
COMMENT ON TABLE public.referral_invitation_runs IS 'Refer & earn invitation: one row per admin send (or test); written only by admin_referral_invite_send.';
CREATE INDEX IF NOT EXISTS referral_invitation_runs_created_idx ON public.referral_invitation_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS referral_invitation_runs_campaign_idx ON public.referral_invitation_runs (campaign_id) WHERE campaign_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.referral_invitation_recipients (
  run_id uuid NOT NULL REFERENCES public.referral_invitation_runs (id),
  user_id uuid NOT NULL,
  version int NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('queued', 'skipped', 'test')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 40),
  is_resend boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, user_id)
);
-- Dedupe: at most one first invitation per person and version (a resend is a separate, explicit row).
CREATE UNIQUE INDEX IF NOT EXISTS referral_invitation_first_once ON public.referral_invitation_recipients (user_id, version)
  WHERE outcome = 'queued' AND NOT is_resend;
CREATE INDEX IF NOT EXISTS referral_invitation_recipients_user_idx ON public.referral_invitation_recipients (user_id, created_at DESC);

GRANT SELECT ON public.referral_invitation_runs, public.referral_invitation_recipients TO authenticated;
GRANT ALL ON public.referral_invitation_runs, public.referral_invitation_recipients TO service_role;
ALTER TABLE public.referral_invitation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_invitation_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read referral invitation runs" ON public.referral_invitation_runs;
CREATE POLICY "Admins read referral invitation runs" ON public.referral_invitation_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
DROP POLICY IF EXISTS "Admins read referral invitation recipients" ON public.referral_invitation_recipients;
CREATE POLICY "Admins read referral invitation recipients" ON public.referral_invitation_recipients FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
-- No insert / update / delete policies: every write goes through the functions below.

CREATE OR REPLACE FUNCTION public.ri_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Invitation records cannot be changed or deleted' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_ri_runs_append_only ON public.referral_invitation_runs;
CREATE TRIGGER trg_ri_runs_append_only BEFORE UPDATE OR DELETE ON public.referral_invitation_runs
  FOR EACH ROW EXECUTE FUNCTION public.ri_append_only();
DROP TRIGGER IF EXISTS trg_ri_recipients_append_only ON public.referral_invitation_recipients;
CREATE TRIGGER trg_ri_recipients_append_only BEFORE UPDATE OR DELETE ON public.referral_invitation_recipients
  FOR EACH ROW EXECUTE FUNCTION public.ri_append_only();

-- ================================================================ A3. helpers
CREATE OR REPLACE FUNCTION public.ri_is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (public.has_role(_uid, 'admin') OR public.has_role(_uid, 'super_admin'))
$$;
REVOKE ALL ON FUNCTION public.ri_is_admin(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ri_rate_text(_n numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT rtrim(rtrim(to_char(_n, 'FM990.99'), '0'), '.')
$$;

-- The fixed invitation text (EN / AR), numbers from the live settings. Feature R adds its standard footer (pause / privacy).
CREATE OR REPLACE FUNCTION public.ri_message()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lo numeric; _hi numeric; _months int := public.referral_setting_num('referral_months', 12, 1, 60)::int;
  _range text; _range_ar text;
BEGIN
  SELECT min((t ->> 'rate')::numeric), max((t ->> 'rate')::numeric) INTO _lo, _hi FROM jsonb_array_elements(public.referral_tiers()) t;
  _lo := COALESCE(_lo, 0.5); _hi := COALESCE(_hi, _lo);
  _range := CASE WHEN _lo = _hi THEN public.ri_rate_text(_lo) || ' %' ELSE public.ri_rate_text(_lo) || ' %–' || public.ri_rate_text(_hi) || ' %' END;
  _range_ar := _range;
  RETURN jsonb_build_object(
    'subject_en', 'Invitation: Refer & earn on AI Support 360',
    'subject_ar', 'دعوة: برنامج أحِل واربح على AI Support 360',
    'body_en', format(E'Hello {{first_name}},\n\nYou are invited to Refer & earn. Share your personal referral code with SAP consultants you know. When a consultant you referred completes approved, paid work, you receive %s of their approved consultant fee for %s months from their first paid ticket - paid by AI Support 360, never deducted from them.\n\nHow it starts: you and your colleague both pass the AI interview and accept the referral terms. The Refer & earn page shows your next step.\n\nRewards depend on approved, paid work; there is no guaranteed income. Programme terms: https://www.aisupport360.com/referral-terms\n\nOpen Refer & earn: {{link}}', _range, _months),
    'body_ar', format(E'مرحبًا {{first_name}}،\n\nأنت مدعو إلى برنامج أحِل واربح. شارك رمز الإحالة الخاص بك مع مستشاري SAP الذين تعرفهم. عندما يُنجز مستشار أحلته أعمالًا معتمدة ومدفوعة، تحصل على %s من أتعابه المعتمدة لمدة %s شهرًا من أول تذكرة مدفوعة له - تدفعها AI Support 360 ولا تُخصم منه أبدًا.\n\nكيف تبدأ: تجتاز أنت وزميلك المقابلة الذكية وتوافقان على شروط الإحالة. تعرض صفحة أحِل واربح خطوتك التالية.\n\nتعتمد المكافآت على أعمال معتمدة ومدفوعة؛ لا يوجد دخل مضمون. شروط البرنامج: https://www.aisupport360.com/referral-terms\n\nافتح أحِل واربح: {{link}}', _range_ar, _months),
    'link_url', '/consultant/referrals?tab=programme&from=invite');
END $$;
REVOKE ALL ON FUNCTION public.ri_message() FROM PUBLIC, anon, authenticated;

-- ================================================================ A4. eligibility (one place, server-side)
-- Every candidate with the reason they are skipped (NULL = will receive). Reasons, in this order:
--   not_found, deleted, suspended, not_consultant, not_verified, email_unconfirmed, policy_blocked, test_account, paused,
--   unsubscribed, already_invited (this version, no resend), resend_too_soon (resend within the resend window).
CREATE OR REPLACE FUNCTION public.ri_candidates(_mode text, _ids uuid[], _include_tests boolean, _resend boolean)
RETURNS TABLE (user_id uuid, display_name text, lang text, telegram boolean, reason text, is_resend boolean, last_invited_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _v int := public.bm_setting_int('referral_invitation_version', 1, 1, 1000);
  _days int := public.bm_setting_int('referral_invitation_resend_days', 14, 1, 365);
  _pool uuid[]; _blocked uuid[] := '{}'; _tests uuid[] := '{}';
BEGIN
  IF _mode = 'all_eligible' THEN
    _pool := ARRAY(SELECT DISTINCT r.user_id FROM public.user_roles r WHERE r.role = 'consultant' LIMIT 5000);
  ELSE
    _pool := ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(_ids, '{}'::uuid[])) x WHERE x IS NOT NULL LIMIT 1000);
  END IF;
  IF to_regprocedure('public.consultant_policy_blocked(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(array_agg(c.user_id), ''{}'') FROM public.consultants c WHERE c.user_id = ANY ($1) AND public.consultant_policy_blocked(c.id)'
      INTO _blocked USING _pool;
  END IF;
  IF to_regclass('public.user_admin_state') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(array_agg(s.user_id), ''{}'') FROM public.user_admin_state s
              WHERE s.user_id = ANY ($1) AND EXISTS (SELECT 1 FROM unnest(COALESCE(s.tags, ''{}'')) t WHERE lower(btrim(t)) = ''test'')'
      INTO _tests USING _pool;
  END IF;
  RETURN QUERY
  WITH b AS (SELECT * FROM public.bm_resolve(jsonb_build_object('kind', 'users', 'user_ids', to_jsonb(_pool)), 'marketing', '{}'::uuid[])),
  inv AS (
    SELECT r.user_id, bool_or(r.version = _v AND r.outcome = 'queued') AS this_version, max(r.created_at) FILTER (WHERE r.outcome = 'queued') AS last_at
      FROM public.referral_invitation_recipients r WHERE r.user_id = ANY (_pool) GROUP BY r.user_id)
  SELECT p.id,
         COALESCE(b.display_name, 'User'),
         COALESCE(b.lang, 'en'),
         COALESCE(b.telegram, false),
         CASE
           WHEN b.user_id IS NULL THEN 'not_found'
           WHEN b.excluded = 'deleted' THEN 'deleted'
           WHEN b.excluded = 'suspended' THEN 'suspended'
           WHEN NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = p.id AND ur.role = 'consultant') OR c.id IS NULL THEN 'not_consultant'
           WHEN c.verification_status::text <> 'verified' THEN 'not_verified'
           WHEN au.email_confirmed_at IS NULL THEN 'email_unconfirmed'
           WHEN p.id = ANY (_blocked) THEN 'policy_blocked'
           WHEN NOT COALESCE(_include_tests, false) AND p.id = ANY (_tests) THEN 'test_account'
           WHEN b.excluded = 'paused' THEN 'paused'
           WHEN b.excluded = 'unsubscribed' THEN 'unsubscribed'
           WHEN NOT COALESCE(_resend, false) AND COALESCE(inv.this_version, false) THEN 'already_invited'
           WHEN COALESCE(_resend, false) AND inv.last_at > now() - make_interval(days => _days) THEN 'resend_too_soon'
         END,
         COALESCE(inv.this_version, false),
         inv.last_at
    FROM unnest(_pool) AS p(id)
    LEFT JOIN b ON b.user_id = p.id
    LEFT JOIN auth.users au ON au.id = p.id
    LEFT JOIN public.consultants c ON c.user_id = p.id
    LEFT JOIN inv ON inv.user_id = p.id;
END $$;
REVOKE ALL ON FUNCTION public.ri_candidates(text, uuid[], boolean, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ri_parse_ids(_payload jsonb)
RETURNS uuid[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}') FROM (
    SELECT jsonb_array_elements_text(COALESCE(_payload -> 'user_ids', '[]'::jsonb)) AS x LIMIT 1000) s
   WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

-- Admin-supplied filter description (the Users console URL filters), kept only for the audit trail: at most 20 simple keys,
-- plain values cut to 120 characters, nested objects dropped.
CREATE OR REPLACE FUNCTION public.ri_clean_filters(_f jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_object_agg(k, left(v #>> '{}', 120)), '{}'::jsonb)
    FROM (SELECT k, v FROM jsonb_each(CASE WHEN jsonb_typeof(_f) = 'object' THEN _f ELSE '{}'::jsonb END) e(k, v)
           WHERE k ~ '^[a-z_]{1,30}$' AND jsonb_typeof(v) IN ('string', 'number', 'boolean') ORDER BY k LIMIT 20) x
$$;

-- ================================================================ A5. preview (confirmation dialog)
CREATE OR REPLACE FUNCTION public.admin_referral_invite_preview(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _mode text := COALESCE(_payload ->> 'mode', 'selected');
  _r jsonb;
BEGIN
  IF NOT public.ri_is_admin(_me) THEN RAISE EXCEPTION 'Only administrators can send the Refer & earn invitation' USING ERRCODE = '42501'; END IF;
  IF NOT public.check_rate_limit('ri:preview:' || _me::text, 300, 3600) THEN
    RAISE EXCEPTION 'Too many previews in the last hour. Please try again later.' USING ERRCODE = 'P0429';
  END IF;
  IF _mode NOT IN ('selected', 'all_eligible') THEN RAISE EXCEPTION 'Choose selected people or all eligible consultants' USING ERRCODE = '22023'; END IF;
  CREATE TEMP TABLE IF NOT EXISTS ri_tmp (user_id uuid, display_name text, lang text, telegram boolean, reason text, is_resend boolean, last_invited_at timestamptz) ON COMMIT DROP;
  TRUNCATE ri_tmp;
  INSERT INTO ri_tmp SELECT * FROM public.ri_candidates(_mode, public.ri_parse_ids(_payload),
    COALESCE((_payload ->> 'include_tests')::boolean, false), COALESCE((_payload ->> 'resend')::boolean, false));
  SELECT jsonb_build_object(
    'enabled', public.platform_flag('referral_invitations_enabled', false),
    'bulk_enabled', public.platform_flag('bulk_messaging_enabled', true),
    'version', public.bm_setting_int('referral_invitation_version', 1, 1, 1000),
    'max_recipients', public.bm_setting_int('referral_invitation_max_recipients', 500, 1, 5000),
    'resend_days', public.bm_setting_int('referral_invitation_resend_days', 14, 1, 365),
    'candidates', (SELECT count(*) FROM ri_tmp),
    'eligible', (SELECT count(*) FROM ri_tmp WHERE reason IS NULL),
    'skipped', COALESCE((SELECT jsonb_object_agg(reason, n) FROM (SELECT reason, count(*) n FROM ri_tmp WHERE reason IS NOT NULL GROUP BY reason) x), '{}'::jsonb),
    'sample', COALESCE((SELECT jsonb_agg(display_name) FROM (SELECT display_name FROM ri_tmp WHERE reason IS NULL ORDER BY display_name LIMIT 5) s), '[]'::jsonb),
    'arabic', (SELECT count(*) FROM ri_tmp WHERE reason IS NULL AND lang = 'ar'),
    'english', (SELECT count(*) FROM ri_tmp WHERE reason IS NULL AND lang <> 'ar'),
    'telegram_linked', (SELECT count(*) FROM ri_tmp WHERE reason IS NULL AND telegram),
    'resends', (SELECT count(*) FROM ri_tmp WHERE reason IS NULL AND is_resend),
    'announced_before', CASE WHEN to_regclass('public.referral_announcements') IS NULL THEN 0 ELSE
      (SELECT count(*) FROM ri_tmp t JOIN public.referral_announcements a ON a.user_id = t.user_id WHERE t.reason IS NULL) END,
    'sent_today', (SELECT count(DISTINCT (mr.campaign_id, mr.user_id)) FROM public.message_campaign_recipients mr
                     JOIN public.message_campaigns mc ON mc.id = mr.campaign_id
                    WHERE mc.created_at >= date_trunc('day', now()) AND mc.status <> 'cancelled' AND mr.status <> 'skipped'),
    'daily_cap', public.bm_setting_int('bulk_daily_cap', 2000, 1, 100000),
    'message', public.ri_message()
  ) INTO _r;
  RETURN _r;
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_preview(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_preview(jsonb) TO authenticated;

-- ================================================================ A6. run summary / report / list / row status
CREATE OR REPLACE FUNCTION public.ri_run_summary(_run uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'mode', r.mode, 'version', r.version, 'created_at', r.created_at, 'resend', r.resend, 'channels', r.channels,
    'include_tests', r.include_tests, 'filters', r.filters, 'campaign_id', r.campaign_id,
    'admin_name', (SELECT p.display_name FROM public.profiles p WHERE p.user_id = r.admin_id),
    'requested', r.requested, 'queued', r.queued, 'skipped', r.skipped,
    'skipped_by_reason', COALESCE((SELECT jsonb_object_agg(reason, n) FROM (SELECT x.reason, count(*) n FROM public.referral_invitation_recipients x
                                    WHERE x.run_id = r.id AND x.outcome = 'skipped' GROUP BY x.reason) q), '{}'::jsonb),
    'sent', (SELECT count(*) FROM public.message_campaign_recipients m WHERE m.campaign_id = r.campaign_id AND m.channel = 'in_app' AND m.status = 'sent')
            + CASE WHEN r.mode = 'test' THEN 1 ELSE 0 END,
    'failed', (SELECT count(*) FROM public.message_campaign_recipients m WHERE m.campaign_id = r.campaign_id AND m.channel = 'in_app' AND m.status = 'failed'),
    'sending', (SELECT count(*) FROM public.message_campaign_recipients m WHERE m.campaign_id = r.campaign_id AND m.channel = 'in_app' AND m.status IN ('queued', 'claimed')),
    'telegram_sent', (SELECT count(*) FROM public.message_campaign_recipients m WHERE m.campaign_id = r.campaign_id AND m.channel = 'telegram' AND m.status = 'sent'),
    'campaign_status', (SELECT c.status FROM public.message_campaigns c WHERE c.id = r.campaign_id))
  FROM public.referral_invitation_runs r WHERE r.id = _run
$$;
REVOKE ALL ON FUNCTION public.ri_run_summary(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_referral_invite_report(_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ri_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only administrators can read invitation reports' USING ERRCODE = '42501'; END IF;
  RETURN public.ri_run_summary(_run_id) || jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', x.user_id,
      'name', COALESCE(NULLIF(btrim(p.display_name), ''), 'User'),
      'lang', COALESCE(mi.lang, CASE WHEN p.preferred_language ILIKE 'ar%' THEN 'ar' ELSE 'en' END),
      'outcome', CASE WHEN x.outcome = 'skipped' THEN 'skipped' WHEN x.outcome = 'test' THEN 'sent'
                      WHEN mi.status = 'sent' THEN 'sent' WHEN mi.status = 'failed' THEN 'failed' ELSE 'sending' END,
      'reason', CASE WHEN x.outcome = 'skipped' THEN x.reason WHEN mi.status = 'failed' THEN left(mi.reason, 40) END,
      'telegram', mt.status, 'sent_at', mi.sent_at, 'resend', x.is_resend) ORDER BY x.outcome, p.display_name)
      FROM public.referral_invitation_recipients x
      JOIN public.referral_invitation_runs r ON r.id = x.run_id
      LEFT JOIN public.profiles p ON p.user_id = x.user_id
      LEFT JOIN public.message_campaign_recipients mi ON mi.campaign_id = r.campaign_id AND mi.user_id = x.user_id AND mi.channel = 'in_app'
      LEFT JOIN public.message_campaign_recipients mt ON mt.campaign_id = r.campaign_id AND mt.user_id = x.user_id AND mt.channel = 'telegram'
     WHERE x.run_id = _run_id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_referral_invite_runs(_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ri_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only administrators can read invitation runs' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(public.ri_run_summary(r.id) ORDER BY r.created_at DESC)
                     FROM (SELECT id, created_at FROM public.referral_invitation_runs ORDER BY created_at DESC LIMIT GREATEST(1, LEAST(COALESCE(_limit, 20), 100))) r), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_runs(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_runs(int) TO authenticated;

-- "Invited on <date> (v1)" for the rows on screen (no opened / clicked: there is no e-mail and no tracking).
CREATE OR REPLACE FUNCTION public.admin_referral_invite_status(_user_ids uuid[])
RETURNS TABLE (user_id uuid, version int, invited_at timestamptz, resends int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ri_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only administrators can read invitation status' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT DISTINCT ON (x.user_id) x.user_id, x.version, COALESCE(mi.sent_at, x.created_at),
           (SELECT count(*)::int FROM public.referral_invitation_recipients y WHERE y.user_id = x.user_id AND y.outcome = 'queued' AND y.is_resend)
      FROM public.referral_invitation_recipients x
      JOIN public.referral_invitation_runs r ON r.id = x.run_id
      LEFT JOIN public.message_campaign_recipients mi ON mi.campaign_id = r.campaign_id AND mi.user_id = x.user_id AND mi.channel = 'in_app'
     WHERE x.user_id = ANY (COALESCE(_user_ids[1:200], '{}')) AND x.outcome = 'queued'
     ORDER BY x.user_id, x.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_status(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_status(uuid[]) TO authenticated;

-- ================================================================ A7. send (idempotent, capped, audited)
-- Payload: {mode: 'selected'|'all_eligible'|'test', user_ids: [...], include_tests, resend, reason, channels: ['in_app','telegram'],
--           confirmed: true, idempotency_key: uuid, filters: {...}}
CREATE OR REPLACE FUNCTION public.admin_referral_invite_send(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _mode text := COALESCE(_payload ->> 'mode', 'selected');
  _key uuid;
  _tests boolean := COALESCE((_payload ->> 'include_tests')::boolean, false);
  _resend boolean := COALESCE((_payload ->> 'resend')::boolean, false);
  _reason text := NULLIF(btrim(COALESCE(_payload ->> 'reason', '')), '');
  _channels text[] := ARRAY['in_app']::text[];
  _filters jsonb := public.ri_clean_filters(_payload -> 'filters');
  _v int := public.bm_setting_int('referral_invitation_version', 1, 1, 1000);
  _max int := public.bm_setting_int('referral_invitation_max_recipients', 500, 1, 5000);
  _cap int := public.bm_setting_int('bulk_daily_cap', 2000, 1, 100000);
  _run uuid := gen_random_uuid(); _camp uuid := gen_random_uuid();
  _n int; _sk int; _total int; _today int; _old uuid; _m jsonb; _lang text;
BEGIN
  IF NOT public.ri_is_admin(_me) THEN RAISE EXCEPTION 'Only administrators can send the Refer & earn invitation' USING ERRCODE = '42501'; END IF;
  IF COALESCE(_payload ->> 'idempotency_key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Missing request id - reload the page and try again' USING ERRCODE = '22023';
  END IF;
  _key := (_payload ->> 'idempotency_key')::uuid;
  -- One send at a time (dedupe and caps are checked under this lock); the same request id returns the first result.
  PERFORM pg_advisory_xact_lock(hashtext('referral_invite_send'));
  SELECT id INTO _old FROM public.referral_invitation_runs WHERE admin_id = _me AND idempotency_key = _key;
  IF _old IS NOT NULL THEN RETURN public.ri_run_summary(_old) || jsonb_build_object('repeated', true); END IF;
  IF NOT public.check_rate_limit('ri:send:' || _me::text, 10, 3600) THEN
    RAISE EXCEPTION 'Too many invitation sends in the last hour. Please try again later.' USING ERRCODE = 'P0429';
  END IF;
  _m := public.ri_message();

  -- Test: the caller only, always allowed (also while the switch is off). Writes no campaign and touches nobody else.
  IF _mode = 'test' THEN
    SELECT CASE WHEN p.preferred_language ILIKE 'ar%' THEN 'ar' ELSE 'en' END INTO _lang FROM public.profiles p WHERE p.user_id = _me;
    PERFORM public.safe_insert_notification(_me,
      '[TEST] ' || CASE WHEN _lang = 'ar' THEN _m ->> 'subject_ar' ELSE _m ->> 'subject_en' END,
      left(replace(replace(CASE WHEN _lang = 'ar' THEN _m ->> 'body_ar' ELSE _m ->> 'body_en' END, '{{first_name}}', ''), '{{link}}', 'https://www.aisupport360.com/consultant/referrals'), 500),
      'referral', _m ->> 'link_url');
    INSERT INTO public.referral_invitation_runs (id, admin_id, idempotency_key, version, mode, channels, filters, requested, queued, skipped)
    VALUES (_run, _me, _key, _v, 'test', ARRAY['in_app'], '{}'::jsonb, 1, 1, 0);
    INSERT INTO public.referral_invitation_recipients (run_id, user_id, version, outcome) VALUES (_run, _me, _v, 'test');
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (_me, 'referral_invitation_test', 'referral_invitation_run', _run, jsonb_build_object('version', _v));
    RETURN public.ri_run_summary(_run);
  END IF;

  IF NOT public.platform_flag('referral_invitations_enabled', false) THEN
    RAISE EXCEPTION 'Refer & earn invitations are switched off in the settings' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.platform_flag('bulk_messaging_enabled', true) THEN
    RAISE EXCEPTION 'Bulk messages are switched off in the settings' USING ERRCODE = 'P0001';
  END IF;
  IF _mode NOT IN ('selected', 'all_eligible') THEN RAISE EXCEPTION 'Choose selected people or all eligible consultants' USING ERRCODE = '22023'; END IF;
  IF COALESCE((_payload ->> 'confirmed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Tick "I confirm" before sending' USING ERRCODE = '22023';
  END IF;
  IF _mode = 'selected' AND cardinality(public.ri_parse_ids(_payload)) = 0 THEN
    RAISE EXCEPTION 'Select at least one person' USING ERRCODE = '22023';
  END IF;
  IF _resend AND (_reason IS NULL OR char_length(_reason) < 10 OR char_length(_reason) > 300) THEN
    RAISE EXCEPTION 'A resend needs a reason (10 to 300 characters)' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_payload -> 'channels', '[]'::jsonb) ? 'telegram' THEN _channels := ARRAY['in_app', 'telegram']; END IF;

  CREATE TEMP TABLE IF NOT EXISTS ri_tmp (user_id uuid, display_name text, lang text, telegram boolean, reason text, is_resend boolean, last_invited_at timestamptz) ON COMMIT DROP;
  TRUNCATE ri_tmp;
  INSERT INTO ri_tmp SELECT * FROM public.ri_candidates(_mode, public.ri_parse_ids(_payload), _tests, _resend);
  SELECT count(*) FILTER (WHERE reason IS NULL), count(*) FILTER (WHERE reason IS NOT NULL), count(*) INTO _n, _sk, _total FROM ri_tmp;
  IF _n = 0 THEN RAISE EXCEPTION 'Nobody in this selection can receive the invitation' USING ERRCODE = '22023'; END IF;
  IF _n > _max THEN
    RAISE EXCEPTION 'Too many recipients (%): at most % per request. Narrow the selection.', _n, _max USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT (mr.campaign_id, mr.user_id)) INTO _today FROM public.message_campaign_recipients mr
    JOIN public.message_campaigns mc ON mc.id = mr.campaign_id
   WHERE mc.created_at >= date_trunc('day', now()) AND mc.status <> 'cancelled' AND mr.status <> 'skipped';
  IF _today + _n > _cap THEN
    RAISE EXCEPTION 'Daily message limit reached: % of % recipients already used today', _today, _cap USING ERRCODE = 'P0429';
  END IF;

  INSERT INTO public.message_campaigns (id, created_by, status, category, channels, subject_en, subject_ar, body_en, body_ar, link_url,
    audience, recipient_count, excluded_count, scheduled_at, time_zone)
  VALUES (_camp, _me, 'scheduled', 'marketing', _channels, _m ->> 'subject_en', _m ->> 'subject_ar', _m ->> 'body_en', _m ->> 'body_ar', _m ->> 'link_url',
    jsonb_build_object('kind', 'users', 'source', 'referral_invitation', 'run_id', _run, 'mode', _mode, 'version', _v), _n, _sk, now(), 'UTC');
  INSERT INTO public.message_campaign_recipients (campaign_id, user_id, channel, lang, status, reason)
  SELECT _camp, t.user_id, ch.c, t.lang,
         CASE WHEN ch.c = 'telegram' AND NOT t.telegram THEN 'skipped' ELSE 'queued' END,
         CASE WHEN ch.c = 'telegram' AND NOT t.telegram THEN 'not_linked' END
    FROM ri_tmp t CROSS JOIN unnest(_channels) AS ch(c)
   WHERE t.reason IS NULL;
  INSERT INTO public.message_campaign_events (campaign_id, actor, action, detail)
  VALUES (_camp, _me, 'created', jsonb_build_object('source', 'referral_invitation', 'run_id', _run, 'version', _v, 'count', _n, 'excluded', _sk,
    'channels', _channels, 'category', 'marketing', 'mode', _mode));

  INSERT INTO public.referral_invitation_runs (id, admin_id, idempotency_key, version, mode, resend, resend_reason, include_tests, channels,
    filters, campaign_id, requested, queued, skipped)
  VALUES (_run, _me, _key, _v, _mode, _resend, CASE WHEN _resend THEN left(_reason, 300) END, _tests, _channels, _filters, _camp, _total, _n, _sk);
  INSERT INTO public.referral_invitation_recipients (run_id, user_id, version, outcome, reason, is_resend)
  SELECT _run, t.user_id, _v, CASE WHEN t.reason IS NULL THEN 'queued' ELSE 'skipped' END, t.reason, t.reason IS NULL AND t.is_resend
    FROM ri_tmp t;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (_me, 'referral_invitation_sent', 'referral_invitation_run', _run, jsonb_build_object(
    'version', _v, 'template', 'referral_invitation_v' || _v, 'mode', _mode, 'queued', _n, 'skipped', _sk, 'requested', _total,
    'channels', _channels, 'resend', _resend, 'reason', CASE WHEN _resend THEN left(_reason, 300) END, 'include_tests', _tests,
    'filters', _filters, 'campaign_id', _camp));
  PERFORM public.bm_arm_worker(); -- the Feature R worker delivers (throttled) and removes its schedule after the queue drained
  RETURN public.ri_run_summary(_run);
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_send(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_send(jsonb) TO authenticated;

-- ================================================================ A8. settings (super admin, audited)
CREATE OR REPLACE FUNCTION public.admin_referral_invite_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ri_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only administrators can read these settings' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'enabled', public.platform_flag('referral_invitations_enabled', false),
    'version', public.bm_setting_int('referral_invitation_version', 1, 1, 1000),
    'max_recipients', public.bm_setting_int('referral_invitation_max_recipients', 500, 1, 5000),
    'resend_days', public.bm_setting_int('referral_invitation_resend_days', 14, 1, 365),
    'example_fee', public.bm_setting_int('referral_email_example_fee', 1000, 1, 1000000),
    'example_currency', COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key = 'referral_email_example_currency'), 'USD'),
    'terms_draft', public.platform_flag('referral_terms_draft', true),
    'can_edit', public.has_role(auth.uid(), 'super_admin'));
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_referral_invite_set_settings(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _before jsonb;
BEGIN
  IF _me IS NULL OR NOT public.has_role(_me, 'super_admin') THEN RAISE EXCEPTION 'Only super admins can change these settings' USING ERRCODE = '42501'; END IF;
  _before := public.admin_referral_invite_settings();
  IF _payload ? 'enabled' THEN
    INSERT INTO public.platform_settings (key, value) VALUES ('referral_invitations_enabled', to_jsonb(COALESCE((_payload ->> 'enabled')::boolean, false)))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  IF _payload ? 'max_recipients' THEN
    IF COALESCE(_payload ->> 'max_recipients', '') !~ '^\d{1,4}$' OR (_payload ->> 'max_recipients')::int NOT BETWEEN 1 AND 5000 THEN
      RAISE EXCEPTION 'Maximum recipients must be between 1 and 5000' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.platform_settings (key, value) VALUES ('referral_invitation_max_recipients', to_jsonb((_payload ->> 'max_recipients')::int))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  IF _payload ? 'version' THEN
    IF COALESCE(_payload ->> 'version', '') !~ '^\d{1,4}$' OR (_payload ->> 'version')::int < public.bm_setting_int('referral_invitation_version', 1, 1, 1000)
       OR (_payload ->> 'version')::int > 1000 THEN
      RAISE EXCEPTION 'The invitation version can only go up (1 to 1000)' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.platform_settings (key, value) VALUES ('referral_invitation_version', to_jsonb((_payload ->> 'version')::int))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  IF _payload ? 'example_fee' THEN
    IF COALESCE(_payload ->> 'example_fee', '') !~ '^\d{1,7}$' OR (_payload ->> 'example_fee')::int NOT BETWEEN 1 AND 1000000 THEN
      RAISE EXCEPTION 'The example fee must be a whole number between 1 and 1,000,000' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.platform_settings (key, value) VALUES ('referral_email_example_fee', to_jsonb((_payload ->> 'example_fee')::int))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  IF _payload ? 'example_currency' THEN
    IF COALESCE(_payload ->> 'example_currency', '') NOT IN ('USD', 'EUR') THEN RAISE EXCEPTION 'Example currency must be USD or EUR' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.platform_settings (key, value) VALUES ('referral_email_example_currency', to_jsonb(_payload ->> 'example_currency'))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  IF _payload ? 'terms_draft' THEN
    INSERT INTO public.platform_settings (key, value) VALUES ('referral_terms_draft', to_jsonb(COALESCE((_payload ->> 'terms_draft')::boolean, true)))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, metadata)
  VALUES (_me, 'referral_invitation_settings', 'platform_settings', jsonb_build_object('before', _before, 'after', public.admin_referral_invite_settings()));
  RETURN public.admin_referral_invite_settings();
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_set_settings(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_set_settings(jsonb) TO authenticated;

-- ================================================================ B1. new referral event notices
ALTER TABLE public.referral_email_queue DROP CONSTRAINT IF EXISTS referral_email_queue_kind_check;
ALTER TABLE public.referral_email_queue ADD CONSTRAINT referral_email_queue_kind_check CHECK (kind IN (
  'signup', 'invited', 'passed_self', 'passed_other', 'active', 'reminder', 'expired', 'verified', 'first_reward', 'ack_request',
  'payout_details_changed', 'reward_earned', 'reward_held', 'reward_available', 'reward_paid', 'reward_reversed', 'referral_rejected'));

-- One notice per reward line (or referral) and event, whatever retries or catch-up jobs do.
CREATE TABLE IF NOT EXISTS public.referral_event_notices (
  ref_id uuid NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ref_id, kind)
);
REVOKE ALL ON public.referral_event_notices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.referral_event_notices TO service_role;
ALTER TABLE public.referral_event_notices ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.referral_notify_event(_ref uuid, _to uuid, _kind text, _other uuid, _amount numeric, _currency text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid; _name text := public.referral_masked_name(_other); _title text; _body text; _link text; _amt text;
  _cur text := COALESCE(_currency, 'USD');
BEGIN
  INSERT INTO public.referral_event_notices (ref_id, kind) VALUES (_ref, _kind) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT c.user_id INTO _user FROM public.consultants c WHERE c.id = _to;
  IF _user IS NULL THEN RETURN; END IF;
  _amt := CASE WHEN _amount IS NULL THEN NULL ELSE to_char(abs(_amount), 'FM999999990.00') || ' ' || _cur END;
  _link := CASE WHEN _kind = 'referral_rejected' THEN '/consultant/referrals?tab=referrals' ELSE '/consultant/referrals?tab=earnings' END;
  CASE _kind
    WHEN 'reward_earned' THEN _title := 'New referral reward recorded';
      _body := format('A reward of %s was recorded from the work of %s. It becomes available after the hold period.', _amt, _name);
    WHEN 'reward_held' THEN _title := 'A referral reward is on hold';
      _body := format('A reward of %s from the work of %s is on hold while we check it.', _amt, _name);
    WHEN 'reward_available' THEN _title := 'Your referral reward is available';
      _body := format('A reward of %s is now available and will be paid with the next payout run.', _amt);
    WHEN 'reward_paid' THEN _title := 'Your referral reward was paid';
      _body := format('A referral reward of %s was paid to your verified bank details.', _amt);
    WHEN 'reward_reversed' THEN _title := 'A referral reward was reversed';
      _body := format('A reward of %s from the work of %s was reversed (refund or dispute), at the original rate.', _amt, _name);
    WHEN 'referral_rejected' THEN _title := 'A referral was not accepted';
      _body := format('Your referral with %s was not accepted after review and will not earn rewards.', _name);
    ELSE RETURN;
  END CASE;
  PERFORM public.safe_insert_notification(_user, _title, _body, 'referral', _link);
  INSERT INTO public.referral_email_queue (user_id, kind, referred_name, amount, currency)
  VALUES (_user, _kind, _name, CASE WHEN _amount IS NULL THEN NULL ELSE abs(_amount) END, _cur);
END $$;
REVOKE ALL ON FUNCTION public.referral_notify_event(uuid, uuid, text, uuid, numeric, text) FROM PUBLIC, anon, authenticated;

-- Notices must never block a money write: any problem is only a warning.
CREATE OR REPLACE FUNCTION public.referral_lines_notice_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _first timestamptz;
BEGIN
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.kind = 'reversal' THEN
        PERFORM public.referral_notify_event(NEW.id, NEW.referrer_consultant_id, 'reward_reversed', NEW.referred_consultant_id, NEW.amount, NEW.currency);
      ELSIF NEW.kind = 'reward' THEN
        SELECT r.first_reward_notified_at INTO _first FROM public.consultant_referrals r WHERE r.referred_consultant_id = NEW.referred_consultant_id;
        IF NEW.status = 'held' THEN
          PERFORM public.referral_notify_event(NEW.id, NEW.referrer_consultant_id, 'reward_held', NEW.referred_consultant_id, NEW.amount, NEW.currency);
        ELSIF _first IS NOT NULL THEN -- the very first reward keeps its own 'first_reward' notice
          PERFORM public.referral_notify_event(NEW.id, NEW.referrer_consultant_id, 'reward_earned', NEW.referred_consultant_id, NEW.amount, NEW.currency);
        END IF;
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.kind = 'reward' THEN
      IF NEW.status = 'available' THEN
        PERFORM public.referral_notify_event(NEW.id, NEW.referrer_consultant_id, 'reward_available', NEW.referred_consultant_id, NEW.amount, NEW.currency);
      ELSIF NEW.status = 'paid' THEN
        PERFORM public.referral_notify_event(NEW.id, NEW.referrer_consultant_id, 'reward_paid', NEW.referred_consultant_id, NEW.amount, NEW.currency);
      ELSIF NEW.status = 'held' THEN
        PERFORM public.referral_notify_event(NEW.id, NEW.referrer_consultant_id, 'reward_held', NEW.referred_consultant_id, NEW.amount, NEW.currency);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral notice skipped: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.referral_lines_notice_trigger() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_referral_lines_notice ON public.referral_reward_lines;
CREATE TRIGGER trg_referral_lines_notice AFTER INSERT OR UPDATE OF status ON public.referral_reward_lines
  FOR EACH ROW EXECUTE FUNCTION public.referral_lines_notice_trigger();

CREATE OR REPLACE FUNCTION public.referral_removed_notice_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF NEW.status = 'removed' AND OLD.status IS DISTINCT FROM 'removed' THEN
      PERFORM public.referral_notify_event(NEW.referred_consultant_id, NEW.referrer_consultant_id, 'referral_rejected', NEW.referred_consultant_id, NULL, NULL);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'referral notice skipped: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.referral_removed_notice_trigger() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_referral_removed_notice ON public.consultant_referrals;
CREATE TRIGGER trg_referral_removed_notice AFTER UPDATE OF status ON public.consultant_referrals
  FOR EACH ROW EXECUTE FUNCTION public.referral_removed_notice_trigger();
