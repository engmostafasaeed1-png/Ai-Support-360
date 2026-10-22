-- Notice pop-ups + "Send via" channels (Refer & earn invitation, bulk messages).
-- PREPARED ONLY - NOT APPLIED. The owner reviews and applies this file. Safe to run twice (IF NOT EXISTS / CREATE OR
-- REPLACE / ON CONFLICT DO NOTHING). Needs the live Feature R (bulk-messaging.sql), Feature Z invitation
-- (referral-invitations.sql) and Web Push (drizzle 0056) objects; Feature Q pauses are probed with to_regprocedure.
--
-- Part 1 - test notifications are marked (notifications.is_test) so they can be cleaned up and are never counted.
--          The invitation test text uses the admin's first name or none ("Hello," - never "Hello ,") and is no longer
--          cut at 500 characters (that cut left the stray ";").
-- Part 2 - Web Push becomes a Feature R channel ('push'): only people with an active push subscription, throttled per
--          minute like the other channels, delivered by the existing bulk-messages-run worker.
-- Part 3 - Refer & earn invitation channels: in-app, push, Telegram (+ e-mail, which is recorded as skipped with the reason
--          email_not_allowed: an invitation to many people is promotional mail, which the app e-mail service must not
--          carry). Dedupe per user + invitation version + CHANNEL (referral_invitation_deliveries); a resend stays an
--          explicit option with a reason, at most once per resend window per channel. Per-channel counts in the preview,
--          per-channel results in the report, channels in the audit entry. Kill switch and "Send to me only" unchanged.

-- ================================================================ 1. test notifications
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.notifications.is_test IS 'Admin test send ([TEST] prefix): excluded from every count, removable with admin_cleanup_test_notifications.';
UPDATE public.notifications SET is_test = true WHERE is_test = false AND title LIKE '[TEST]%';
CREATE INDEX IF NOT EXISTS notifications_is_test_idx ON public.notifications (created_at) WHERE is_test;

-- Super admins remove test notifications (all, or older than N days). Audited; returns the number removed.
CREATE OR REPLACE FUNCTION public.admin_cleanup_test_notifications(_older_than_days int DEFAULT 0)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := auth.uid(); _n int;
BEGIN
  IF _me IS NULL OR NOT public.has_role(_me, 'super_admin') THEN RAISE EXCEPTION 'Only super admins can remove test notifications' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.notifications
   WHERE is_test AND created_at < now() - make_interval(days => GREATEST(0, LEAST(COALESCE(_older_than_days, 0), 3650)));
  GET DIAGNOSTICS _n = ROW_COUNT;
  INSERT INTO public.audit_logs (user_id, action, entity_type, metadata)
  VALUES (_me, 'test_notifications_removed', 'notifications', jsonb_build_object('removed', _n, 'older_than_days', COALESCE(_older_than_days, 0)));
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.admin_cleanup_test_notifications(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_test_notifications(int) TO authenticated;

-- ================================================================ 2. Web Push as a Feature R channel
ALTER TABLE public.message_campaigns DROP CONSTRAINT IF EXISTS message_campaigns_channels_check;
ALTER TABLE public.message_campaigns ADD CONSTRAINT message_campaigns_channels_check CHECK (
  cardinality(channels) >= 1 AND cardinality(channels) <= 6
  AND channels <@ ARRAY['in_app', 'popup', 'push', 'telegram', 'whatsapp_manual', 'sms_manual']::text[]);
ALTER TABLE public.message_campaign_recipients DROP CONSTRAINT IF EXISTS message_campaign_recipients_channel_check;
ALTER TABLE public.message_campaign_recipients ADD CONSTRAINT message_campaign_recipients_channel_check CHECK (
  channel = ANY (ARRAY['in_app', 'push', 'telegram', 'whatsapp_manual', 'sms_manual']::text[]));

INSERT INTO public.platform_settings (key, value) VALUES ('bulk_push_per_minute', '60'::jsonb) ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bm_push_enabled(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.push_subscriptions s WHERE s.user_id = _uid AND s.active)
$$;
REVOKE ALL ON FUNCTION public.bm_push_enabled(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.bm_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.bm_can_send(auth.uid()) THEN RAISE EXCEPTION 'You do not have permission to send messages' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'enabled', public.platform_flag('bulk_messaging_enabled', true),
    'inapp_per_minute', public.bm_setting_int('bulk_inapp_per_minute', 100, 1, 1000),
    'telegram_per_minute', public.bm_setting_int('bulk_telegram_per_minute', 240, 1, 1200),
    'push_per_minute', public.bm_setting_int('bulk_push_per_minute', 60, 1, 600),
    'push_channel', true,
    'push_ready', EXISTS (SELECT 1 FROM public.push_vapid_keys),
    'daily_cap', public.bm_setting_int('bulk_daily_cap', 2000, 1, 100000),
    'provider', COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key = 'bulk_whatsapp_sms_provider'), 'off'),
    'can_edit', public.has_role(auth.uid(), 'super_admin'),
    'pause_installed', to_regprocedure('public.notifications_paused(uuid,text,text)') IS NOT NULL,
    'groups_installed', to_regclass('public.admin_permission_groups') IS NOT NULL);
END $$;

CREATE OR REPLACE FUNCTION public.bm_preview(_audience jsonb, _category text, _exclude uuid[] DEFAULT '{}'::uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r JSONB; _unknown INT := 0;
BEGIN
  PERFORM public.bm_guard('preview', 600);
  IF _category NOT IN ('service', 'marketing') THEN RAISE EXCEPTION 'Choose service or marketing' USING ERRCODE = '22023'; END IF;
  IF _audience ->> 'kind' = 'emails' THEN
    SELECT count(*) INTO _unknown FROM (SELECT DISTINCT lower(btrim(e)) AS e FROM (
      SELECT jsonb_array_elements_text(COALESCE(_audience -> 'emails', '[]'::jsonb)) AS e LIMIT 2000) s) d
     WHERE d.e <> '' AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = d.e);
  END IF;
  WITH r AS (SELECT * FROM public.bm_resolve(_audience, _category, _exclude))
  SELECT jsonb_build_object(
    'candidates', (SELECT count(*) FROM r),
    'eligible', (SELECT count(*) FROM r WHERE excluded IS NULL),
    'unknown_emails', _unknown,
    'excluded', COALESCE((SELECT jsonb_object_agg(excluded, n) FROM (SELECT excluded, count(*) n FROM r WHERE excluded IS NOT NULL GROUP BY excluded) x), '{}'::jsonb),
    'telegram_linked', (SELECT count(*) FROM r WHERE excluded IS NULL AND telegram),
    'push_enabled', (SELECT count(*) FROM r WHERE excluded IS NULL AND public.bm_push_enabled(r.user_id)),
    'with_phone', (SELECT count(*) FROM r WHERE excluded IS NULL AND has_phone),
    'arabic', (SELECT count(*) FROM r WHERE excluded IS NULL AND lang = 'ar'),
    'recipients', COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', user_id, 'name', display_name, 'role', role, 'lang', lang,
        'country', country, 'telegram', telegram, 'has_phone', has_phone, 'excluded', excluded) ORDER BY excluded NULLS FIRST, display_name)
      FROM (SELECT * FROM r ORDER BY excluded NULLS FIRST, display_name LIMIT 500) l), '[]'::jsonb),
    'sent_today', (SELECT count(DISTINCT (mr.campaign_id, mr.user_id)) FROM public.message_campaign_recipients mr
                     JOIN public.message_campaigns mc ON mc.id = mr.campaign_id
                    WHERE mc.created_at >= date_trunc('day', now()) AND mc.status <> 'cancelled' AND mr.status <> 'skipped'),
    'daily_cap', public.bm_setting_int('bulk_daily_cap', 2000, 1, 100000)
  ) INTO _r;
  RETURN _r;
END $$;

CREATE OR REPLACE FUNCTION public.bm_create_campaign(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me UUID := public.bm_guard('create', 10);
  _category TEXT := _payload ->> 'category';
  _channels TEXT[] := ARRAY(SELECT DISTINCT jsonb_array_elements_text(COALESCE(_payload -> 'channels', '[]'::jsonb)));
  _subject_en TEXT := btrim(COALESCE(_payload ->> 'subject_en', ''));
  _subject_ar TEXT := NULLIF(btrim(COALESCE(_payload ->> 'subject_ar', '')), '');
  _body_en TEXT := btrim(COALESCE(_payload ->> 'body_en', ''));
  _body_ar TEXT := NULLIF(btrim(COALESCE(_payload ->> 'body_ar', '')), '');
  _link TEXT := NULLIF(btrim(COALESCE(_payload ->> 'link_url', '')), '');
  _aud JSONB := _payload -> 'audience';
  _exclude UUID[] := ARRAY(SELECT x::UUID FROM jsonb_array_elements_text(COALESCE(_payload -> 'exclude', '[]'::jsonb)) x
                            WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  _when TIMESTAMPTZ := COALESCE(NULLIF(_payload ->> 'scheduled_at', '')::TIMESTAMPTZ, now());
  _tz TEXT := COALESCE(NULLIF(_payload ->> 'time_zone', ''), 'UTC');
  _id UUID := gen_random_uuid();
  _count INT; _excluded INT; _today INT; _cap INT := public.bm_setting_int('bulk_daily_cap', 2000, 1, 100000);
  _aud_stored JSONB;
BEGIN
  IF NOT public.platform_flag('bulk_messaging_enabled', true) THEN
    RAISE EXCEPTION 'Bulk messages are switched off in the settings' USING ERRCODE = 'P0001';
  END IF;
  IF _category NOT IN ('service', 'marketing') THEN RAISE EXCEPTION 'Choose service or marketing' USING ERRCODE = '22023'; END IF;
  IF COALESCE((_payload ->> 'category_confirmed')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Confirm the message category' USING ERRCODE = '22023';
  END IF;
  IF 'email' = ANY (_channels) THEN
    RAISE EXCEPTION 'E-mail is not a bulk channel: messages to many people need a separate newsletter service' USING ERRCODE = '22023';
  END IF;
  IF cardinality(_channels) = 0 OR NOT (_channels <@ ARRAY['in_app', 'popup', 'push', 'telegram', 'whatsapp_manual', 'sms_manual']) THEN
    RAISE EXCEPTION 'Choose at least one channel' USING ERRCODE = '22023';
  END IF;
  IF 'popup' = ANY (_channels) AND NOT ('in_app' = ANY (_channels)) THEN _channels := array_append(_channels, 'in_app'); END IF;
  IF _subject_en = '' OR _body_en = '' THEN RAISE EXCEPTION 'Write a subject and a message' USING ERRCODE = '22023'; END IF;
  IF public.bm_has_secret(concat_ws(' ', _subject_en, _subject_ar, _body_en, _body_ar)) THEN
    RAISE EXCEPTION 'The message seems to contain a password or a key. Remove it before sending.' USING ERRCODE = '22023';
  END IF;
  BEGIN PERFORM now() AT TIME ZONE _tz; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Unknown time zone' USING ERRCODE = '22023'; END;
  IF _when < now() - interval '5 minutes' OR _when > now() + interval '90 days' THEN
    RAISE EXCEPTION 'Choose a time within the next 90 days' USING ERRCODE = '22023';
  END IF;
  IF _aud IS NULL OR COALESCE(_aud ->> 'kind', '') NOT IN ('users', 'emails', 'group', 'saved', 'filter') THEN
    RAISE EXCEPTION 'Choose who receives the message' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS bm_tmp_resolved (user_id UUID, display_name TEXT, role TEXT, lang TEXT, country TEXT,
    telegram BOOLEAN, has_phone BOOLEAN, excluded TEXT) ON COMMIT DROP;
  TRUNCATE bm_tmp_resolved;
  INSERT INTO bm_tmp_resolved SELECT * FROM public.bm_resolve(_aud, _category, _exclude);
  SELECT count(*) FILTER (WHERE excluded IS NULL), count(*) FILTER (WHERE excluded IS NOT NULL) INTO _count, _excluded FROM bm_tmp_resolved;
  IF _count = 0 THEN RAISE EXCEPTION 'Nobody in this audience can receive the message' USING ERRCODE = '22023'; END IF;
  IF _count > 50 AND COALESCE(_payload ->> 'confirm_count', '') <> _count::TEXT THEN
    RAISE EXCEPTION 'Type the number of recipients (%) to confirm', _count USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT (mr.campaign_id, mr.user_id)) INTO _today FROM public.message_campaign_recipients mr
    JOIN public.message_campaigns mc ON mc.id = mr.campaign_id
   WHERE mc.created_at >= date_trunc('day', now()) AND mc.status <> 'cancelled' AND mr.status <> 'skipped';
  IF _today + _count > _cap THEN
    RAISE EXCEPTION 'Daily limit reached: % of % recipients already used today', _today, _cap USING ERRCODE = 'P0429';
  END IF;

  _aud_stored := CASE WHEN _aud ->> 'kind' = 'emails'
    THEN jsonb_build_object('kind', 'emails', 'pasted', jsonb_array_length(COALESCE(_aud -> 'emails', '[]'::jsonb)))
    ELSE _aud END;
  IF cardinality(_exclude) > 0 THEN _aud_stored := _aud_stored || jsonb_build_object('excluded_by_admin', cardinality(_exclude)); END IF;

  INSERT INTO public.message_campaigns (id, created_by, status, category, channels, subject_en, subject_ar, body_en, body_ar, link_url,
    audience, recipient_count, excluded_count, scheduled_at, time_zone, template_id)
  VALUES (_id, _me, 'scheduled', _category, _channels, _subject_en, _subject_ar, _body_en, _body_ar, _link,
    _aud_stored, _count, _excluded, _when, _tz, NULLIF(_payload ->> 'template_id', '')::UUID);

  INSERT INTO public.message_campaign_recipients (campaign_id, user_id, channel, lang, status, reason)
  SELECT _id, r.user_id, ch.c, r.lang,
         CASE WHEN r.excluded IS NOT NULL THEN 'skipped'
              WHEN ch.c = 'telegram' AND NOT r.telegram THEN 'skipped'
              WHEN ch.c = 'push' AND NOT public.bm_push_enabled(r.user_id) THEN 'skipped'
              WHEN ch.c IN ('whatsapp_manual', 'sms_manual') AND NOT r.has_phone THEN 'skipped'
              WHEN ch.c IN ('whatsapp_manual', 'sms_manual') THEN 'manual_pending'
              ELSE 'queued' END,
         CASE WHEN r.excluded IS NOT NULL THEN r.excluded
              WHEN ch.c = 'telegram' AND NOT r.telegram THEN 'not_linked'
              WHEN ch.c = 'push' AND NOT public.bm_push_enabled(r.user_id) THEN 'push_not_enabled'
              WHEN ch.c IN ('whatsapp_manual', 'sms_manual') AND NOT r.has_phone THEN 'no_phone' END
    FROM bm_tmp_resolved r
    CROSS JOIN (SELECT DISTINCT c FROM unnest(_channels) c WHERE c <> 'popup') ch;

  INSERT INTO public.message_campaign_events (campaign_id, actor, action, detail)
  VALUES (_id, _me, 'created', jsonb_build_object('count', _count, 'excluded', _excluded, 'channels', _channels, 'category', _category,
    'audience', _aud_stored ->> 'kind', 'subject', left(_subject_en, 150), 'scheduled_at', _when, 'time_zone', _tz));
  PERFORM public.bm_arm_worker();
  RETURN jsonb_build_object('id', _id, 'recipient_count', _count, 'excluded_count', _excluded, 'scheduled_at', _when);
END $$;

-- The worker claim with a per-minute push budget (bulk_push_per_minute, default 60).
CREATE OR REPLACE FUNCTION public.bm_claim(_max INT DEFAULT 300)
RETURNS TABLE (campaign_id UUID, user_id UUID, channel TEXT, lang TEXT, category TEXT, popup BOOLEAN,
  subject_en TEXT, subject_ar TEXT, body_en TEXT, body_ar TEXT, link_url TEXT,
  first_name TEXT, company TEXT, profile_completion INT, chat_id BIGINT, attempts INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _in INT; _tg INT; _pu INT; _cap INT := GREATEST(1, LEAST(COALESCE(_max, 300), 300));
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('bm_claim')) THEN RETURN; END IF;

  UPDATE public.message_campaign_recipients r
     SET status = CASE WHEN r.attempts >= 3 THEN 'failed' ELSE 'queued' END,
         reason = CASE WHEN r.attempts >= 3 THEN 'timeout' ELSE r.reason END
   WHERE r.status = 'claimed' AND r.claimed_at < now() - interval '10 minutes';

  UPDATE public.message_campaigns c SET status = 'sent', finished_at = now()
   WHERE c.status = 'sending'
     AND NOT EXISTS (SELECT 1 FROM public.message_campaign_recipients r WHERE r.campaign_id = c.id AND r.status IN ('queued', 'claimed'));

  IF NOT public.platform_flag('bulk_messaging_enabled', true) THEN
    PERFORM public.bm_arm_worker();
    RETURN;
  END IF;

  WITH started AS (
    UPDATE public.message_campaigns c SET status = 'sending', started_at = now()
     WHERE c.status = 'scheduled' AND c.scheduled_at <= now() RETURNING c.id)
  INSERT INTO public.message_campaign_events (campaign_id, action) SELECT id, 'started' FROM started;
  PERFORM public.bm_arm_worker();

  _in := LEAST(_cap, GREATEST(0, public.bm_setting_int('bulk_inapp_per_minute', 100, 1, 1000)
    - (SELECT count(*) FROM public.message_campaign_recipients r WHERE r.channel = 'in_app' AND r.claimed_at > now() - interval '1 minute')));
  _tg := LEAST(_cap, GREATEST(0, public.bm_setting_int('bulk_telegram_per_minute', 240, 1, 1200)
    - (SELECT count(*) FROM public.message_campaign_recipients r WHERE r.channel = 'telegram' AND r.claimed_at > now() - interval '1 minute')));
  _pu := LEAST(_cap, GREATEST(0, public.bm_setting_int('bulk_push_per_minute', 60, 1, 600)
    - (SELECT count(*) FROM public.message_campaign_recipients r WHERE r.channel = 'push' AND r.claimed_at > now() - interval '1 minute')));

  RETURN QUERY
  WITH pick_in AS (
    SELECT r.campaign_id, r.user_id, r.channel FROM public.message_campaign_recipients r
      JOIN public.message_campaigns c ON c.id = r.campaign_id AND c.status = 'sending'
     WHERE r.status = 'queued' AND r.channel = 'in_app'
     ORDER BY c.scheduled_at, r.user_id LIMIT _in FOR UPDATE OF r SKIP LOCKED),
  pick_tg AS (
    SELECT r.campaign_id, r.user_id, r.channel FROM public.message_campaign_recipients r
      JOIN public.message_campaigns c ON c.id = r.campaign_id AND c.status = 'sending'
     WHERE r.status = 'queued' AND r.channel = 'telegram'
     ORDER BY c.scheduled_at, r.user_id LIMIT _tg FOR UPDATE OF r SKIP LOCKED),
  pick_pu AS (
    SELECT r.campaign_id, r.user_id, r.channel FROM public.message_campaign_recipients r
      JOIN public.message_campaigns c ON c.id = r.campaign_id AND c.status = 'sending'
     WHERE r.status = 'queued' AND r.channel = 'push'
     ORDER BY c.scheduled_at, r.user_id LIMIT _pu FOR UPDATE OF r SKIP LOCKED),
  upd AS (
    UPDATE public.message_campaign_recipients r SET status = 'claimed', claimed_at = now(), attempts = r.attempts + 1
      FROM (SELECT * FROM pick_in UNION ALL SELECT * FROM pick_tg UNION ALL SELECT * FROM pick_pu) p
     WHERE r.campaign_id = p.campaign_id AND r.user_id = p.user_id AND r.channel = p.channel
     RETURNING r.campaign_id, r.user_id, r.channel, r.lang, r.attempts)
  SELECT u.campaign_id, u.user_id, u.channel, u.lang, c.category, 'popup' = ANY (c.channels),
         c.subject_en, c.subject_ar, c.body_en, c.body_ar, c.link_url,
         split_part(btrim(COALESCE(p.display_name, '')), ' ', 1), cp.company_name,
         CASE WHEN co.id IS NOT NULL THEN (public.consultant_completion(co.id) ->> 'percent')::INT END,
         CASE WHEN u.channel = 'telegram' THEN (SELECT t.chat_id FROM public.telegram_links t WHERE t.user_id = u.user_id AND t.active LIMIT 1) END,
         u.attempts
    FROM upd u
    JOIN public.message_campaigns c ON c.id = u.campaign_id
    LEFT JOIN public.profiles p ON p.user_id = u.user_id
    LEFT JOIN public.client_profiles cp ON cp.user_id = u.user_id
    LEFT JOIN public.consultants co ON co.user_id = u.user_id;
END $$;
REVOKE ALL ON FUNCTION public.bm_claim(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bm_claim(INT) TO service_role;

-- ================================================================ 3. Refer & earn invitation channels
ALTER TABLE public.referral_invitation_runs DROP CONSTRAINT IF EXISTS referral_invitation_runs_channels_check;
ALTER TABLE public.referral_invitation_runs ADD CONSTRAINT referral_invitation_runs_channels_check
  CHECK (channels <@ ARRAY['in_app', 'email', 'push', 'telegram']::text[]);

-- One row per run, person and channel (append-only). Dedupe is per user + version + channel.
CREATE TABLE IF NOT EXISTS public.referral_invitation_deliveries (
  run_id uuid NOT NULL REFERENCES public.referral_invitation_runs (id),
  user_id uuid NOT NULL,
  version int NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'push', 'telegram')),
  outcome text NOT NULL CHECK (outcome IN ('queued', 'skipped', 'test')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 40),
  is_resend boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, user_id, channel)
);
COMMENT ON TABLE public.referral_invitation_deliveries IS 'Refer & earn invitation per person and channel; written only by admin_referral_invite_send.';
CREATE UNIQUE INDEX IF NOT EXISTS referral_invitation_delivery_first_once ON public.referral_invitation_deliveries (user_id, version, channel)
  WHERE outcome = 'queued' AND NOT is_resend;
CREATE INDEX IF NOT EXISTS referral_invitation_deliveries_user_idx ON public.referral_invitation_deliveries (user_id, channel, created_at DESC);
GRANT SELECT ON public.referral_invitation_deliveries TO authenticated;
GRANT ALL ON public.referral_invitation_deliveries TO service_role;
ALTER TABLE public.referral_invitation_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read referral invitation deliveries" ON public.referral_invitation_deliveries;
CREATE POLICY "Admins read referral invitation deliveries" ON public.referral_invitation_deliveries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
DROP TRIGGER IF EXISTS trg_ri_deliveries_append_only ON public.referral_invitation_deliveries;
CREATE TRIGGER trg_ri_deliveries_append_only BEFORE UPDATE OR DELETE ON public.referral_invitation_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.ri_append_only();

-- Earlier sends become per-channel history (so nobody gets the same channel twice), then the per-person rule goes:
-- someone invited in-app may now get Telegram or push for the same version, never the same channel twice.
INSERT INTO public.referral_invitation_deliveries (run_id, user_id, version, channel, outcome, reason, is_resend, created_at)
SELECT x.run_id, x.user_id, x.version, m.channel,
       CASE WHEN m.status = 'skipped' THEN 'skipped' ELSE 'queued' END,
       CASE WHEN m.status = 'skipped' THEN left(m.reason, 40) END, x.is_resend, x.created_at
  FROM public.referral_invitation_recipients x
  JOIN public.referral_invitation_runs r ON r.id = x.run_id
  JOIN public.message_campaign_recipients m ON m.campaign_id = r.campaign_id AND m.user_id = x.user_id AND m.channel IN ('in_app', 'push', 'telegram')
 WHERE x.outcome = 'queued'
ON CONFLICT DO NOTHING;
INSERT INTO public.referral_invitation_deliveries (run_id, user_id, version, channel, outcome, created_at)
SELECT x.run_id, x.user_id, x.version, 'in_app', 'test', x.created_at FROM public.referral_invitation_recipients x WHERE x.outcome = 'test'
ON CONFLICT DO NOTHING;
DROP INDEX IF EXISTS public.referral_invitation_first_once;
COMMENT ON TABLE public.referral_invitation_recipients IS 'Refer & earn invitation: one row per person and send (overall outcome); per-channel dedupe lives in referral_invitation_deliveries.';

-- The invitation text: short paragraphs and bullets, greeting with the first name or none.
CREATE OR REPLACE FUNCTION public.ri_message()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _lo numeric; _hi numeric; _months int := public.referral_setting_num('referral_months', 12, 1, 60)::int;
  _range text;
BEGIN
  SELECT min((t ->> 'rate')::numeric), max((t ->> 'rate')::numeric) INTO _lo, _hi FROM jsonb_array_elements(public.referral_tiers()) t;
  _lo := COALESCE(_lo, 0.5); _hi := COALESCE(_hi, _lo);
  _range := CASE WHEN _lo = _hi THEN public.ri_rate_text(_lo) || ' %' ELSE public.ri_rate_text(_lo) || ' %–' || public.ri_rate_text(_hi) || ' %' END;
  RETURN jsonb_build_object(
    'subject_en', 'Invitation: Refer & earn on AI Support 360',
    'subject_ar', 'دعوة: برنامج أحِل واربح على AI Support 360',
    'body_en', format(E'Hello {{first_name}},\n\nYou are invited to Refer & earn on AI Support 360.\n\n- Share your personal referral code with SAP consultants you know.\n- When a consultant you referred completes approved, paid work, you receive %s of their approved consultant fee for %s months from their first paid ticket.\n- AI Support 360 pays the reward. Nothing is deducted from your colleague.\n\nHow it starts: you and your colleague both pass the AI interview and accept the referral terms. The Refer & earn page shows your next step.\n\nRewards depend on approved, paid work. There is no guaranteed income.\n\nProgramme terms: https://www.aisupport360.com/referral-terms\nOpen Refer & earn: {{link}}', _range, _months),
    'body_ar', format(E'مرحبًا {{first_name}}،\n\nأنت مدعو إلى برنامج أحِل واربح على AI Support 360.\n\n- شارك رمز الإحالة الخاص بك مع مستشاري SAP الذين تعرفهم.\n- عندما يُنجز مستشار أحلته أعمالًا معتمدة ومدفوعة، تحصل على %s من أتعابه المعتمدة لمدة %s شهرًا من أول تذكرة مدفوعة له.\n- تدفع AI Support 360 المكافأة، ولا يُخصم شيء من زميلك.\n\nكيف تبدأ: تجتاز أنت وزميلك المقابلة الذكية وتوافقان على شروط الإحالة. تعرض صفحة أحِل واربح خطوتك التالية.\n\nتعتمد المكافآت على أعمال معتمدة ومدفوعة. لا يوجد دخل مضمون.\n\nشروط البرنامج: https://www.aisupport360.com/referral-terms\nافتح أحِل واربح: {{link}}', _range, _months),
    'link_url', '/consultant/referrals?tab=programme&from=invite');
END $$;
REVOKE ALL ON FUNCTION public.ri_message() FROM PUBLIC, anon, authenticated;

-- "Hello ," -> "Hello,"  /  "مرحبًا ،" -> "مرحبًا،" (empty first name).
CREATE OR REPLACE FUNCTION public.ri_fill_text(_text text, _first text, _link text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(replace(replace(COALESCE(_text, ''), '{{first_name}}', btrim(COALESCE(_first, ''))), '{{link}}', COALESCE(_link, '')),
                        '[ \t]+([,،])', '\1', 'g')
$$;

-- Every candidate x channel with the reason it is skipped (NULL = goes out). Person reasons come from ri_candidates
-- (same order as before); pause applies to the app channels; dedupe and the resend window are per channel.
CREATE OR REPLACE FUNCTION public.ri_channel_plan(_mode text, _ids uuid[], _include_tests boolean, _resend boolean, _channels text[])
RETURNS TABLE (user_id uuid, display_name text, lang text, person_reason text, channel text, reason text, is_resend boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _v int := public.bm_setting_int('referral_invitation_version', 1, 1, 1000);
  _days int := public.bm_setting_int('referral_invitation_resend_days', 14, 1, 365);
BEGIN
  RETURN QUERY
  WITH c AS (SELECT * FROM public.ri_candidates(_mode, _ids, _include_tests, _resend)),
  ch AS (SELECT DISTINCT x AS channel FROM unnest(COALESCE(_channels, '{}')) x WHERE x IN ('in_app', 'email', 'push', 'telegram')),
  d AS (SELECT dl.user_id, dl.channel, bool_or(dl.version = _v AND dl.outcome = 'queued') AS this_version,
               max(dl.created_at) FILTER (WHERE dl.outcome = 'queued') AS last_at
          FROM public.referral_invitation_deliveries dl WHERE dl.user_id IN (SELECT c.user_id FROM c) GROUP BY dl.user_id, dl.channel)
  SELECT c.user_id, c.display_name, c.lang,
         CASE WHEN c.reason IN ('paused', 'unsubscribed', 'already_invited', 'resend_too_soon') THEN NULL ELSE c.reason END,
         ch.channel,
         CASE
           WHEN c.reason IS NOT NULL AND c.reason NOT IN ('paused', 'unsubscribed', 'already_invited', 'resend_too_soon') THEN c.reason
           WHEN ch.channel = 'email' THEN 'email_not_allowed'
           WHEN c.reason = 'paused' THEN 'paused'
           WHEN ch.channel = 'push' AND NOT public.bm_push_enabled(c.user_id) THEN 'push_not_enabled'
           WHEN ch.channel = 'telegram' AND NOT c.telegram THEN 'telegram_not_connected'
           WHEN NOT COALESCE(_resend, false) AND COALESCE(d.this_version, false) THEN 'already_invited'
           WHEN COALESCE(_resend, false) AND d.last_at > now() - make_interval(days => _days) THEN 'resend_too_soon'
         END,
         COALESCE(d.this_version, false)
    FROM c CROSS JOIN ch
    LEFT JOIN d ON d.user_id = c.user_id AND d.channel = ch.channel;
END $$;
REVOKE ALL ON FUNCTION public.ri_channel_plan(text, uuid[], boolean, boolean, text[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ri_parse_channels(_payload jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY(SELECT c FROM unnest(ARRAY['in_app', 'email', 'push', 'telegram']) c
                WHERE COALESCE(_payload -> 'channels', '["in_app"]'::jsonb) ? c)
$$;

CREATE OR REPLACE FUNCTION public.admin_referral_invite_preview(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _mode text := COALESCE(_payload ->> 'mode', 'selected');
  _sel text[] := public.ri_parse_channels(_payload);
  _r jsonb;
BEGIN
  IF NOT public.ri_is_admin(_me) THEN RAISE EXCEPTION 'Only administrators can send the Refer & earn invitation' USING ERRCODE = '42501'; END IF;
  IF NOT public.check_rate_limit('ri:preview:' || _me::text, 300, 3600) THEN
    RAISE EXCEPTION 'Too many previews in the last hour. Please try again later.' USING ERRCODE = 'P0429';
  END IF;
  IF _mode NOT IN ('selected', 'all_eligible') THEN RAISE EXCEPTION 'Choose selected people or all eligible consultants' USING ERRCODE = '22023'; END IF;
  CREATE TEMP TABLE IF NOT EXISTS ri_tmp_plan (user_id uuid, display_name text, lang text, person_reason text, channel text, reason text, is_resend boolean) ON COMMIT DROP;
  TRUNCATE ri_tmp_plan;
  INSERT INTO ri_tmp_plan SELECT * FROM public.ri_channel_plan(_mode, public.ri_parse_ids(_payload),
    COALESCE((_payload ->> 'include_tests')::boolean, false), COALESCE((_payload ->> 'resend')::boolean, false),
    ARRAY['in_app', 'email', 'push', 'telegram']);
  WITH persons AS (
    SELECT p.user_id, min(p.display_name) AS display_name, min(p.lang) AS lang, min(p.person_reason) AS person_reason,
           bool_or(p.reason IS NULL AND p.channel = ANY (_sel)) AS gets, bool_or(p.reason IS NULL AND p.channel = ANY (_sel) AND p.is_resend) AS resend,
           (array_agg(p.reason ORDER BY array_position(_sel, p.channel)) FILTER (WHERE p.reason IS NOT NULL AND p.channel = ANY (_sel)))[1] AS first_reason
      FROM ri_tmp_plan p GROUP BY p.user_id)
  SELECT jsonb_build_object(
    'enabled', public.platform_flag('referral_invitations_enabled', false),
    'bulk_enabled', public.platform_flag('bulk_messaging_enabled', true),
    'version', public.bm_setting_int('referral_invitation_version', 1, 1, 1000),
    'max_recipients', public.bm_setting_int('referral_invitation_max_recipients', 500, 1, 5000),
    'resend_days', public.bm_setting_int('referral_invitation_resend_days', 14, 1, 365),
    'channel_support', 2,
    'channels', to_jsonb(_sel),
    'candidates', (SELECT count(*) FROM persons),
    'eligible', (SELECT count(*) FROM persons WHERE gets),
    'skipped', COALESCE((SELECT jsonb_object_agg(r, n) FROM (
        SELECT COALESCE(person_reason, first_reason, 'no_channel') r, count(*) n FROM persons WHERE NOT gets GROUP BY 1) x), '{}'::jsonb),
    'sample', COALESCE((SELECT jsonb_agg(display_name) FROM (SELECT display_name FROM persons WHERE gets ORDER BY display_name LIMIT 5) s), '[]'::jsonb),
    'arabic', (SELECT count(*) FROM persons WHERE gets AND lang = 'ar'),
    'english', (SELECT count(*) FROM persons WHERE gets AND lang <> 'ar'),
    'telegram_linked', (SELECT count(*) FROM ri_tmp_plan WHERE channel = 'telegram' AND reason IS NULL),
    'push_enabled', (SELECT count(*) FROM ri_tmp_plan WHERE channel = 'push' AND reason IS NULL),
    'resends', (SELECT count(*) FROM persons WHERE resend),
    'by_channel', (SELECT jsonb_object_agg(c.c, jsonb_build_object(
        'available', c.c <> 'email',
        'reason', CASE WHEN c.c = 'email' THEN 'email_not_allowed' END,
        'eligible', (SELECT count(*) FROM ri_tmp_plan p WHERE p.channel = c.c AND p.reason IS NULL),
        'skipped', COALESCE((SELECT jsonb_object_agg(q.reason, q.n) FROM (SELECT p.reason, count(*) n FROM ri_tmp_plan p
                              WHERE p.channel = c.c AND p.person_reason IS NULL AND p.reason IS NOT NULL AND p.reason <> 'email_not_allowed' GROUP BY p.reason) q), '{}'::jsonb)))
        FROM unnest(ARRAY['in_app', 'email', 'push', 'telegram']) c(c)),
    -- People reached by every channel combination ("in_app,push" = in-app or push), for the Send button and the counts.
    'reach', (SELECT jsonb_object_agg(array_to_string(s.combo, ','), (SELECT count(DISTINCT p.user_id) FROM ri_tmp_plan p WHERE p.reason IS NULL AND p.channel = ANY (s.combo)))
                FROM (SELECT ARRAY(SELECT u.c FROM unnest(ARRAY['in_app', 'email', 'push', 'telegram']) WITH ORDINALITY u(c, i)
                                    WHERE (g.m >> (u.i::int - 1)) & 1 = 1 ORDER BY u.i) AS combo
                        FROM generate_series(1, 15) g(m)) s),
    'announced_before', CASE WHEN to_regclass('public.referral_announcements') IS NULL THEN 0 ELSE
      (SELECT count(*) FROM persons t JOIN public.referral_announcements a ON a.user_id = t.user_id WHERE t.gets) END,
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

-- Summary of one run, overall and per channel.
CREATE OR REPLACE FUNCTION public.ri_run_summary(_run uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (SELECT * FROM public.referral_invitation_runs WHERE id = _run),
  dl AS (
    SELECT d.user_id, d.channel, d.outcome, d.reason, m.status AS m_status, m.reason AS m_reason
      FROM public.referral_invitation_deliveries d JOIN r ON r.id = d.run_id
      LEFT JOIN public.message_campaign_recipients m ON m.campaign_id = r.campaign_id AND m.user_id = d.user_id AND m.channel = d.channel),
  pp AS (
    SELECT user_id, bool_or(outcome = 'test' OR m_status = 'sent') AS sent, bool_or(outcome = 'queued' AND m_status IN ('queued', 'claimed')) AS sending,
           bool_or(m_status = 'failed') AS failed
      FROM dl GROUP BY user_id)
  SELECT jsonb_build_object(
    'id', r.id, 'mode', r.mode, 'version', r.version, 'created_at', r.created_at, 'resend', r.resend, 'channels', r.channels,
    'include_tests', r.include_tests, 'filters', r.filters, 'campaign_id', r.campaign_id,
    'admin_name', (SELECT p.display_name FROM public.profiles p WHERE p.user_id = r.admin_id),
    'requested', r.requested, 'queued', r.queued, 'skipped', r.skipped,
    'skipped_by_reason', COALESCE((SELECT jsonb_object_agg(reason, n) FROM (SELECT x.reason, count(*) n FROM public.referral_invitation_recipients x
                                    WHERE x.run_id = r.id AND x.outcome = 'skipped' GROUP BY x.reason) q), '{}'::jsonb),
    'sent', (SELECT count(*) FROM pp WHERE sent),
    'failed', (SELECT count(*) FROM pp WHERE failed AND NOT sent AND NOT sending),
    'sending', (SELECT count(*) FROM pp WHERE sending AND NOT sent),
    'telegram_sent', (SELECT count(*) FROM dl WHERE channel = 'telegram' AND m_status = 'sent'),
    'by_channel', COALESCE((SELECT jsonb_object_agg(c.c, jsonb_build_object(
        'sent', (SELECT count(*) FROM dl WHERE dl.channel = c.c AND (dl.outcome = 'test' OR dl.m_status = 'sent')),
        'failed', (SELECT count(*) FROM dl WHERE dl.channel = c.c AND dl.m_status = 'failed'),
        'sending', (SELECT count(*) FROM dl WHERE dl.channel = c.c AND dl.outcome = 'queued' AND dl.m_status IN ('queued', 'claimed')),
        'skipped', COALESCE((SELECT jsonb_object_agg(q.why, q.n) FROM (SELECT COALESCE(dl.reason, dl.m_reason, 'skipped') AS why, count(*) n FROM dl
                              WHERE dl.channel = c.c AND (dl.outcome = 'skipped' OR dl.m_status = 'skipped') GROUP BY 1) q), '{}'::jsonb)))
        FROM unnest(r.channels) c(c)), '{}'::jsonb),
    'campaign_status', (SELECT c.status FROM public.message_campaigns c WHERE c.id = r.campaign_id))
  FROM r
$$;
REVOKE ALL ON FUNCTION public.ri_run_summary(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_referral_invite_report(_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ri_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only administrators can read invitation reports' USING ERRCODE = '42501'; END IF;
  RETURN public.ri_run_summary(_run_id) || jsonb_build_object('rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', q.user_id, 'name', q.name, 'lang', q.lang,
      'outcome', CASE WHEN q.outcome = 'skipped' THEN 'skipped' WHEN q.outcome = 'test' THEN 'sent'
                      WHEN q.ch ? 'sent' THEN 'sent' WHEN q.ch ? 'sending' THEN 'sending' ELSE 'failed' END,
      'reason', CASE WHEN q.outcome = 'skipped' THEN q.reason END,
      'telegram', q.channels -> 'telegram' ->> 'status', 'sent_at', q.sent_at, 'resend', q.is_resend, 'channels', q.channels) ORDER BY q.outcome, q.name)
      FROM (
        SELECT x.user_id, x.outcome, x.reason, x.is_resend,
               COALESCE(NULLIF(btrim(p.display_name), ''), 'User') AS name,
               CASE WHEN p.preferred_language ILIKE 'ar%' THEN 'ar' ELSE 'en' END AS lang,
               (SELECT max(m.sent_at) FROM public.message_campaign_recipients m WHERE m.campaign_id = r.campaign_id AND m.user_id = x.user_id) AS sent_at,
               COALESCE((SELECT jsonb_object_agg(d.channel, jsonb_build_object(
                   'status', CASE WHEN d.outcome = 'skipped' OR m.status = 'skipped' THEN 'skipped' WHEN d.outcome = 'test' OR m.status = 'sent' THEN 'sent'
                                  WHEN m.status = 'failed' THEN 'failed' ELSE 'sending' END,
                   'reason', COALESCE(d.reason, CASE WHEN m.status IN ('failed', 'skipped') THEN left(m.reason, 40) END)))
                  FROM public.referral_invitation_deliveries d
                  LEFT JOIN public.message_campaign_recipients m ON m.campaign_id = r.campaign_id AND m.user_id = d.user_id AND m.channel = d.channel
                 WHERE d.run_id = x.run_id AND d.user_id = x.user_id), '{}'::jsonb) AS channels,
               (SELECT COALESCE(jsonb_agg(DISTINCT CASE WHEN d.outcome = 'test' OR m.status = 'sent' THEN 'sent'
                                                         WHEN d.outcome = 'queued' AND m.status IN ('queued', 'claimed') THEN 'sending' ELSE 'other' END), '[]'::jsonb)
                  FROM public.referral_invitation_deliveries d
                  LEFT JOIN public.message_campaign_recipients m ON m.campaign_id = r.campaign_id AND m.user_id = d.user_id AND m.channel = d.channel
                 WHERE d.run_id = x.run_id AND d.user_id = x.user_id) AS ch
          FROM public.referral_invitation_recipients x
          JOIN public.referral_invitation_runs r ON r.id = x.run_id
          LEFT JOIN public.profiles p ON p.user_id = x.user_id
         WHERE x.run_id = _run_id) q), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_report(uuid) TO authenticated;

-- "Invited on <date> (v1) · In-app, Telegram" for the rows on screen. Return type changes, so drop first.
DROP FUNCTION IF EXISTS public.admin_referral_invite_status(uuid[]);
CREATE FUNCTION public.admin_referral_invite_status(_user_ids uuid[])
RETURNS TABLE (user_id uuid, version int, invited_at timestamptz, resends int, channels text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ri_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Only administrators can read invitation status' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT d.user_id, max(d.version), max(d.created_at),
           count(*) FILTER (WHERE d.is_resend)::int,
           array_agg(DISTINCT d.channel ORDER BY d.channel)
      FROM public.referral_invitation_deliveries d
     WHERE d.user_id = ANY (COALESCE(_user_ids[1:200], '{}')) AND d.outcome = 'queued'
       AND d.version = (SELECT max(d2.version) FROM public.referral_invitation_deliveries d2 WHERE d2.user_id = d.user_id AND d2.outcome = 'queued')
     GROUP BY d.user_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_status(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_status(uuid[]) TO authenticated;

-- Send (idempotent, capped, audited). Payload as before plus channels: ['in_app','email','push','telegram'].
CREATE OR REPLACE FUNCTION public.admin_referral_invite_send(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _mode text := COALESCE(_payload ->> 'mode', 'selected');
  _key uuid;
  _tests boolean := COALESCE((_payload ->> 'include_tests')::boolean, false);
  _resend boolean := COALESCE((_payload ->> 'resend')::boolean, false);
  _reason text := NULLIF(btrim(COALESCE(_payload ->> 'reason', '')), '');
  _sel text[] := public.ri_parse_channels(_payload);
  _app text[];
  _filters jsonb := public.ri_clean_filters(_payload -> 'filters');
  _v int := public.bm_setting_int('referral_invitation_version', 1, 1, 1000);
  _max int := public.bm_setting_int('referral_invitation_max_recipients', 500, 1, 5000);
  _cap int := public.bm_setting_int('bulk_daily_cap', 2000, 1, 100000);
  _run uuid := gen_random_uuid(); _camp uuid := gen_random_uuid();
  _n int; _sk int; _total int; _today int; _old uuid; _m jsonb; _lang text; _first text; _per jsonb;
BEGIN
  IF NOT public.ri_is_admin(_me) THEN RAISE EXCEPTION 'Only administrators can send the Refer & earn invitation' USING ERRCODE = '42501'; END IF;
  IF COALESCE(_payload ->> 'idempotency_key', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Missing request id - reload the page and try again' USING ERRCODE = '22023';
  END IF;
  _key := (_payload ->> 'idempotency_key')::uuid;
  PERFORM pg_advisory_xact_lock(hashtext('referral_invite_send'));
  SELECT id INTO _old FROM public.referral_invitation_runs WHERE admin_id = _me AND idempotency_key = _key;
  IF _old IS NOT NULL THEN RETURN public.ri_run_summary(_old) || jsonb_build_object('repeated', true); END IF;
  IF NOT public.check_rate_limit('ri:send:' || _me::text, 10, 3600) THEN
    RAISE EXCEPTION 'Too many invitation sends in the last hour. Please try again later.' USING ERRCODE = 'P0429';
  END IF;
  IF cardinality(_sel) = 0 THEN RAISE EXCEPTION 'Choose at least one channel' USING ERRCODE = '22023'; END IF;
  _app := ARRAY(SELECT c FROM unnest(_sel) c WHERE c <> 'email');
  _m := public.ri_message();

  -- Test: the caller only (in-app here; push / Telegram tests go through the referral-invite-test function).
  IF _mode = 'test' THEN
    IF NOT ('in_app' = ANY (_sel)) THEN
      RAISE EXCEPTION 'This test sends the in-app notification; push and Telegram tests are sent separately' USING ERRCODE = '22023';
    END IF;
    SELECT CASE WHEN p.preferred_language ILIKE 'ar%' THEN 'ar' ELSE 'en' END, split_part(btrim(COALESCE(p.display_name, '')), ' ', 1)
      INTO _lang, _first FROM public.profiles p WHERE p.user_id = _me;
    PERFORM public.safe_insert_notification(_me,
      '[TEST] ' || CASE WHEN _lang = 'ar' THEN _m ->> 'subject_ar' ELSE _m ->> 'subject_en' END,
      left(public.ri_fill_text(CASE WHEN _lang = 'ar' THEN _m ->> 'body_ar' ELSE _m ->> 'body_en' END, _first,
           'https://www.aisupport360.com/consultant/referrals'), 1500),
      'referral', _m ->> 'link_url');
    UPDATE public.notifications SET is_test = true WHERE user_id = _me AND is_test = false AND title LIKE '[TEST]%' AND created_at > now() - interval '1 minute';
    INSERT INTO public.referral_invitation_runs (id, admin_id, idempotency_key, version, mode, channels, filters, requested, queued, skipped)
    VALUES (_run, _me, _key, _v, 'test', ARRAY['in_app'], '{}'::jsonb, 1, 1, 0);
    INSERT INTO public.referral_invitation_recipients (run_id, user_id, version, outcome) VALUES (_run, _me, _v, 'test');
    INSERT INTO public.referral_invitation_deliveries (run_id, user_id, version, channel, outcome) VALUES (_run, _me, _v, 'in_app', 'test');
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (_me, 'referral_invitation_test', 'referral_invitation_run', _run, jsonb_build_object('version', _v, 'channels', ARRAY['in_app'], 'test', true));
    RETURN public.ri_run_summary(_run);
  END IF;

  IF NOT public.platform_flag('referral_invitations_enabled', false) THEN
    RAISE EXCEPTION 'Refer & earn invitations are switched off in the settings' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.platform_flag('bulk_messaging_enabled', true) THEN
    RAISE EXCEPTION 'Bulk messages are switched off in the settings' USING ERRCODE = 'P0001';
  END IF;
  IF _mode NOT IN ('selected', 'all_eligible') THEN RAISE EXCEPTION 'Choose selected people or all eligible consultants' USING ERRCODE = '22023'; END IF;
  IF cardinality(_app) = 0 THEN
    RAISE EXCEPTION 'E-mail cannot carry the Refer & earn invitation (promotional mail to many people). Choose in-app, push or Telegram.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE((_payload ->> 'confirmed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Tick "I confirm" before sending' USING ERRCODE = '22023';
  END IF;
  IF _mode = 'selected' AND cardinality(public.ri_parse_ids(_payload)) = 0 THEN
    RAISE EXCEPTION 'Select at least one person' USING ERRCODE = '22023';
  END IF;
  IF _resend AND (_reason IS NULL OR char_length(_reason) < 10 OR char_length(_reason) > 300) THEN
    RAISE EXCEPTION 'A resend needs a reason (10 to 300 characters)' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS ri_tmp_plan (user_id uuid, display_name text, lang text, person_reason text, channel text, reason text, is_resend boolean) ON COMMIT DROP;
  TRUNCATE ri_tmp_plan;
  INSERT INTO ri_tmp_plan SELECT * FROM public.ri_channel_plan(_mode, public.ri_parse_ids(_payload), _tests, _resend, _sel);
  CREATE TEMP TABLE IF NOT EXISTS ri_tmp_person (user_id uuid, lang text, person_reason text, gets boolean, resend boolean, first_reason text) ON COMMIT DROP;
  TRUNCATE ri_tmp_person;
  INSERT INTO ri_tmp_person
  SELECT p.user_id, min(p.lang), min(p.person_reason), bool_or(p.reason IS NULL), bool_or(p.reason IS NULL AND p.is_resend),
         (array_agg(p.reason ORDER BY array_position(_sel, p.channel)) FILTER (WHERE p.reason IS NOT NULL))[1]
    FROM ri_tmp_plan p GROUP BY p.user_id;
  SELECT count(*) FILTER (WHERE gets), count(*) FILTER (WHERE NOT gets), count(*) INTO _n, _sk, _total FROM ri_tmp_person;
  IF _n = 0 THEN RAISE EXCEPTION 'Nobody in this selection can receive the invitation on the chosen channels' USING ERRCODE = '22023'; END IF;
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
  VALUES (_camp, _me, 'scheduled', 'marketing', _app, _m ->> 'subject_en', _m ->> 'subject_ar', _m ->> 'body_en', _m ->> 'body_ar', _m ->> 'link_url',
    jsonb_build_object('kind', 'users', 'source', 'referral_invitation', 'run_id', _run, 'mode', _mode, 'version', _v), _n, _sk, now(), 'UTC');
  INSERT INTO public.message_campaign_recipients (campaign_id, user_id, channel, lang, status, reason)
  SELECT _camp, p.user_id, p.channel, pr.lang, CASE WHEN p.reason IS NULL THEN 'queued' ELSE 'skipped' END, left(p.reason, 60)
    FROM ri_tmp_plan p JOIN ri_tmp_person pr ON pr.user_id = p.user_id
   WHERE pr.gets AND p.channel = ANY (_app);
  INSERT INTO public.message_campaign_events (campaign_id, actor, action, detail)
  VALUES (_camp, _me, 'created', jsonb_build_object('source', 'referral_invitation', 'run_id', _run, 'version', _v, 'count', _n, 'excluded', _sk,
    'channels', _sel, 'category', 'marketing', 'mode', _mode));

  INSERT INTO public.referral_invitation_runs (id, admin_id, idempotency_key, version, mode, resend, resend_reason, include_tests, channels,
    filters, campaign_id, requested, queued, skipped)
  VALUES (_run, _me, _key, _v, _mode, _resend, CASE WHEN _resend THEN left(_reason, 300) END, _tests, _sel, _filters, _camp, _total, _n, _sk);
  INSERT INTO public.referral_invitation_recipients (run_id, user_id, version, outcome, reason, is_resend)
  SELECT _run, pr.user_id, _v, CASE WHEN pr.gets THEN 'queued' ELSE 'skipped' END,
         CASE WHEN pr.gets THEN NULL ELSE left(COALESCE(pr.person_reason, pr.first_reason, 'no_channel'), 40) END, pr.gets AND pr.resend
    FROM ri_tmp_person pr;
  INSERT INTO public.referral_invitation_deliveries (run_id, user_id, version, channel, outcome, reason, is_resend)
  SELECT _run, p.user_id, _v, p.channel, CASE WHEN p.reason IS NULL THEN 'queued' ELSE 'skipped' END, left(p.reason, 40), p.reason IS NULL AND p.is_resend
    FROM ri_tmp_plan p WHERE p.person_reason IS NULL;

  SELECT jsonb_object_agg(c, (SELECT count(*) FROM ri_tmp_plan p WHERE p.channel = c AND p.reason IS NULL)) INTO _per FROM unnest(_sel) c;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (_me, 'referral_invitation_sent', 'referral_invitation_run', _run, jsonb_build_object(
    'version', _v, 'template', 'referral_invitation_v' || _v, 'mode', _mode, 'queued', _n, 'skipped', _sk, 'requested', _total,
    'channels', _sel, 'queued_by_channel', _per, 'resend', _resend, 'reason', CASE WHEN _resend THEN left(_reason, 300) END,
    'include_tests', _tests, 'filters', _filters, 'campaign_id', _camp));
  PERFORM public.bm_arm_worker();
  RETURN public.ri_run_summary(_run);
END $$;
REVOKE ALL ON FUNCTION public.admin_referral_invite_send(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_invite_send(jsonb) TO authenticated;
