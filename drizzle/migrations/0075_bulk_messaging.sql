-- lovable-cron-fallback-reviewed: sender is woken on enqueue, runs each minute only while a campaign is sending, removed after drain
-- Feature R: admin bulk messages ("Message users" on Admin > Users and the Admin > Messages / Campaigns page).
-- PREPARED ONLY: the owner applies this file. Safe to run twice (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING).
-- Uses live objects: auth.users, profiles, user_roles, has_role, check_rate_limit, platform_settings, platform_flag,
-- consultants, consultant_completion, client_profiles, client_consultant_groups / _group_members, telegram_links, suppressed_emails,
-- notifications, pg_cron, pg_net. Optional helpers are probed (to_regclass / to_regprocedure), so this file works before or
-- after Feature P (admin groups, user_admin_state), Feature Q (notifications_paused) and Feature N (service policy):
--   * messages.send = super admins, or admins in a Feature P admin group that explicitly grants 'messages.send'.
--   * Marketing skips suppressed addresses (unsubscribed / bounced / complained) and paused users (Feature Q).
--     There is no separate marketing consent flag in the database today.
--   * Suspended (auth ban or Feature P suspension) and deleted accounts are never messaged.
-- Channels: in-app notification (+ optional popup), Telegram (linked users only), manual click-to-send WhatsApp / SMS.
-- E-mail is deliberately NOT a channel: the app's e-mail service sends only one-recipient, event-triggered messages.
-- Paid WhatsApp / SMS sending stays off (bulk_whatsapp_sms_provider = 'off') until the owner chooses a provider.

-- ================================================================ 1. settings (admin editable)
INSERT INTO public.platform_settings (key, value) VALUES
  ('bulk_messaging_enabled', 'true'::jsonb),
  ('bulk_inapp_per_minute', '100'::jsonb),
  ('bulk_telegram_per_minute', '240'::jsonb),
  ('bulk_daily_cap', '2000'::jsonb),
  ('bulk_whatsapp_sms_provider', '"off"'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.bm_setting_int(_key TEXT, _default INT, _min INT, _max INT)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT GREATEST(_min, LEAST(_max, COALESCE((
    SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN (value #>> '{}')::NUMERIC::INT
                WHEN jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ '^\d{1,7}$' THEN (value #>> '{}')::INT END
      FROM public.platform_settings WHERE key = _key), _default)))
$$;

-- ================================================================ 2. tables
CREATE TABLE IF NOT EXISTS public.message_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'sending', 'sent', 'cancelled')),
  category TEXT NOT NULL CHECK (category IN ('service', 'marketing')),
  channels TEXT[] NOT NULL CHECK (cardinality(channels) BETWEEN 1 AND 5
    AND channels <@ ARRAY['in_app', 'popup', 'telegram', 'whatsapp_manual', 'sms_manual']::TEXT[]),
  subject_en TEXT NOT NULL CHECK (char_length(btrim(subject_en)) BETWEEN 1 AND 150),
  subject_ar TEXT CHECK (subject_ar IS NULL OR char_length(subject_ar) <= 150),
  body_en TEXT NOT NULL CHECK (char_length(btrim(body_en)) BETWEEN 1 AND 5000),
  body_ar TEXT CHECK (body_ar IS NULL OR char_length(body_ar) <= 5000),
  link_url TEXT CHECK (link_url IS NULL OR link_url ~ '^(/[^/]|https://(www\.)?aisupport360\.com(/|$))'),
  audience JSONB NOT NULL,
  recipient_count INT NOT NULL CHECK (recipient_count >= 0),
  excluded_count INT NOT NULL DEFAULT 0 CHECK (excluded_count >= 0),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  time_zone TEXT NOT NULL DEFAULT 'UTC' CHECK (char_length(time_zone) <= 64),
  template_id UUID,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.message_campaigns IS 'Feature R: immutable record of every admin bulk message (only status and timing columns ever change).';
CREATE INDEX IF NOT EXISTS message_campaigns_due_idx ON public.message_campaigns (status, scheduled_at) WHERE status IN ('scheduled', 'sending');
CREATE INDEX IF NOT EXISTS message_campaigns_created_idx ON public.message_campaigns (created_at DESC);

CREATE TABLE IF NOT EXISTS public.message_campaign_recipients (
  campaign_id UUID NOT NULL REFERENCES public.message_campaigns (id),
  user_id UUID NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'telegram', 'whatsapp_manual', 'sms_manual')),
  lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'ar')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'claimed', 'sent', 'failed', 'skipped', 'cancelled', 'manual_pending', 'manual_sent')),
  reason TEXT CHECK (reason IS NULL OR char_length(reason) <= 60),
  attempts INT NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  notification_id UUID,
  rendered_subject TEXT CHECK (rendered_subject IS NULL OR char_length(rendered_subject) <= 200),
  rendered_body TEXT CHECK (rendered_body IS NULL OR char_length(rendered_body) <= 7000),
  manual_by UUID,
  PRIMARY KEY (campaign_id, user_id, channel)
);
CREATE INDEX IF NOT EXISTS message_recipients_work_idx ON public.message_campaign_recipients (channel, status, campaign_id) WHERE status IN ('queued', 'claimed');
CREATE INDEX IF NOT EXISTS message_recipients_claimed_idx ON public.message_campaign_recipients (channel, claimed_at) WHERE claimed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS message_recipients_user_idx ON public.message_campaign_recipients (user_id);

CREATE TABLE IF NOT EXISTS public.message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK (category IN ('service', 'marketing')),
  subject_en TEXT NOT NULL CHECK (char_length(subject_en) <= 150),
  subject_ar TEXT CHECK (subject_ar IS NULL OR char_length(subject_ar) <= 150),
  body_en TEXT NOT NULL CHECK (char_length(body_en) <= 5000),
  body_ar TEXT CHECK (body_ar IS NULL OR char_length(body_ar) <= 5000),
  link_url TEXT CHECK (link_url IS NULL OR link_url ~ '^(/[^/]|https://(www\.)?aisupport360\.com(/|$))'),
  created_by UUID NOT NULL,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.message_saved_audiences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  audience JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (admin_id, name)
);

CREATE TABLE IF NOT EXISTS public.message_campaign_events (
  id BIGSERIAL PRIMARY KEY,
  campaign_id UUID,
  actor UUID,
  action TEXT NOT NULL CHECK (action IN ('created', 'test_sent', 'started', 'finished', 'cancelled', 'manual_sent', 'manual_undone',
    'phones_viewed', 'phones_exported', 'settings_changed', 'template_saved', 'template_archived')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_campaign_events_campaign_idx ON public.message_campaign_events (campaign_id, created_at);

GRANT SELECT ON public.message_campaigns, public.message_campaign_recipients, public.message_templates,
  public.message_saved_audiences, public.message_campaign_events TO authenticated;
GRANT ALL ON public.message_campaigns, public.message_campaign_recipients, public.message_templates,
  public.message_saved_audiences, public.message_campaign_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.message_campaign_events_id_seq TO service_role;

ALTER TABLE public.message_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_saved_audiences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_campaign_events ENABLE ROW LEVEL SECURITY;

-- ================================================================ 3. permission
-- Super admins always; admins only through a Feature P admin group that explicitly grants messages.send.
CREATE OR REPLACE FUNCTION public.bm_can_send(_uid UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _ok BOOLEAN := false;
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  IF public.has_role(_uid, 'super_admin') THEN RETURN true; END IF;
  IF NOT public.has_role(_uid, 'admin') THEN RETURN false; END IF;
  IF to_regclass('public.admin_group_members') IS NOT NULL AND to_regclass('public.admin_permission_groups') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.admin_group_members m JOIN public.admin_permission_groups g ON g.id = m.group_id
              WHERE m.user_id = $1 AND ''messages.send'' = ANY (g.permissions))' INTO _ok USING _uid;
  END IF;
  RETURN COALESCE(_ok, false);
END $$;
REVOKE ALL ON FUNCTION public.bm_can_send(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_can_send(UUID) TO authenticated, service_role;

-- Permission + per-admin hourly rate limit. Raises 42501 / P0429.
CREATE OR REPLACE FUNCTION public.bm_guard(_bucket TEXT, _limit INT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := auth.uid();
BEGIN
  IF _me IS NULL OR NOT public.bm_can_send(_me) THEN
    RAISE EXCEPTION 'You do not have permission to send messages' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('bm:' || _bucket || ':' || _me::TEXT, _limit, 3600) THEN
    RAISE EXCEPTION 'Too many message actions in the last hour. Please try again later.' USING ERRCODE = 'P0429';
  END IF;
  RETURN _me;
END $$;
REVOKE ALL ON FUNCTION public.bm_guard(TEXT, INT) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Message senders read campaigns" ON public.message_campaigns;
CREATE POLICY "Message senders read campaigns" ON public.message_campaigns FOR SELECT TO authenticated
  USING (public.bm_can_send(auth.uid()));
DROP POLICY IF EXISTS "Message senders read recipients" ON public.message_campaign_recipients;
CREATE POLICY "Message senders read recipients" ON public.message_campaign_recipients FOR SELECT TO authenticated
  USING (public.bm_can_send(auth.uid()));
DROP POLICY IF EXISTS "Message senders read templates" ON public.message_templates;
CREATE POLICY "Message senders read templates" ON public.message_templates FOR SELECT TO authenticated
  USING (public.bm_can_send(auth.uid()));
DROP POLICY IF EXISTS "Message senders read own audiences" ON public.message_saved_audiences;
CREATE POLICY "Message senders read own audiences" ON public.message_saved_audiences FOR SELECT TO authenticated
  USING (admin_id = auth.uid() AND public.bm_can_send(auth.uid()));
DROP POLICY IF EXISTS "Message senders read events" ON public.message_campaign_events;
CREATE POLICY "Message senders read events" ON public.message_campaign_events FOR SELECT TO authenticated
  USING (public.bm_can_send(auth.uid()));
-- No insert / update / delete policies: every write goes through the functions below.

-- ================================================================ 4. immutability
CREATE OR REPLACE FUNCTION public.bm_campaign_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Campaign records cannot be deleted' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.created_by, NEW.category, NEW.channels, NEW.subject_en, NEW.subject_ar, NEW.body_en, NEW.body_ar, NEW.link_url,
      NEW.audience, NEW.recipient_count, NEW.excluded_count, NEW.scheduled_at, NEW.time_zone, NEW.template_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.created_by, OLD.category, OLD.channels, OLD.subject_en, OLD.subject_ar, OLD.body_en, OLD.body_ar, OLD.link_url,
      OLD.audience, OLD.recipient_count, OLD.excluded_count, OLD.scheduled_at, OLD.time_zone, OLD.template_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Campaign content cannot be changed after it was created' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('sent', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A finished campaign cannot change status' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bm_campaign_immutable ON public.message_campaigns;
CREATE TRIGGER trg_bm_campaign_immutable BEFORE UPDATE OR DELETE ON public.message_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.bm_campaign_immutable();

CREATE OR REPLACE FUNCTION public.bm_events_append_only()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'The message history is append-only' USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_bm_events_append_only ON public.message_campaign_events;
CREATE TRIGGER trg_bm_events_append_only BEFORE UPDATE OR DELETE ON public.message_campaign_events
  FOR EACH ROW EXECUTE FUNCTION public.bm_events_append_only();

-- ================================================================ 5. content checks (mirror: _shared/bulkMessaging.ts secretFindings)
CREATE OR REPLACE FUNCTION public.bm_has_secret(_text TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(_text, '') ~* '\m(password|passwd|pwd|passcode)\s*[:=]\s*\S{3,}'
      OR COALESCE(_text, '') ~ '(كلمة\s*(المرور|السر))\s*[:=]\s*\S{3,}'
      OR COALESCE(_text, '') ~ '-----BEGIN [A-Z ]*PRIVATE KEY-----'
      OR COALESCE(_text, '') ~ '\m(sk|rk)_(live|test)_[A-Za-z0-9]{10,}'
      OR COALESCE(_text, '') ~ '\mAKIA[0-9A-Z]{16}\M'
      OR COALESCE(_text, '') ~ '\m(gh[pousr]_[A-Za-z0-9]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})'
      OR COALESCE(_text, '') ~* '\m(api[_-]?key|secret|client[_-]?secret)\s*[:=]\s*[A-Za-z0-9_-]{12,}'
      OR COALESCE(_text, '') ~ '\meyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
$$;

-- ================================================================ 6. audience
-- Audience definitions (JSON):
--   {"kind":"users","user_ids":[...]}               selected on Admin > Users (max 5000)
--   {"kind":"emails","emails":[...]}                pasted addresses, existing accounts only (max 2000)
--   {"kind":"group","group_id":"..."}               a client consultant group (Feature O)
--   {"kind":"saved","audience_id":"..."}            a saved audience of this admin
--   {"kind":"filter","roles":[],"countries":[],"sap_areas":[],"badges":[],"verification":[],
--    "incomplete_profile":bool,"location_missing":bool,"policy_not_acknowledged":bool,"inactive_days":int}
CREATE OR REPLACE FUNCTION public.bm_audience_ids(_aud JSONB, _depth INT DEFAULT 0)
RETURNS TABLE (user_id UUID) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _kind TEXT := COALESCE(_aud ->> 'kind', '');
  _roles TEXT[]; _countries TEXT[]; _areas TEXT[]; _badges TEXT[]; _verif TEXT[];
  _inactive INT; _acked UUID[] := NULL; _policy_on BOOLEAN := false; _cur INT;
BEGIN
  IF _kind = 'users' THEN
    RETURN QUERY SELECT DISTINCT x::UUID FROM (
      SELECT jsonb_array_elements_text(COALESCE(_aud -> 'user_ids', '[]'::jsonb)) AS x LIMIT 5000) s
      WHERE x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = x::UUID);
  ELSIF _kind = 'emails' THEN
    RETURN QUERY SELECT DISTINCT u.id FROM auth.users u
      WHERE lower(u.email) IN (SELECT lower(btrim(e)) FROM (
        SELECT jsonb_array_elements_text(COALESCE(_aud -> 'emails', '[]'::jsonb)) AS e LIMIT 2000) s);
  ELSIF _kind = 'group' THEN
    RETURN QUERY SELECT DISTINCT c.user_id FROM public.client_consultant_group_members m
      JOIN public.consultants c ON c.id = m.consultant_id
      WHERE m.group_id::TEXT = (_aud ->> 'group_id') AND c.user_id IS NOT NULL;
  ELSIF _kind = 'saved' AND _depth = 0 THEN
    RETURN QUERY SELECT a.user_id FROM public.message_saved_audiences s
      CROSS JOIN LATERAL public.bm_audience_ids(s.audience, 1) a
      WHERE s.id::TEXT = (_aud ->> 'audience_id') AND s.admin_id = auth.uid() AND COALESCE(s.audience ->> 'kind', '') <> 'saved';
  ELSIF _kind = 'filter' THEN
    _roles := ARRAY(SELECT jsonb_array_elements_text(COALESCE(_aud -> 'roles', '[]'::jsonb)));
    _countries := ARRAY(SELECT lower(jsonb_array_elements_text(COALESCE(_aud -> 'countries', '[]'::jsonb))));
    _areas := ARRAY(SELECT jsonb_array_elements_text(COALESCE(_aud -> 'sap_areas', '[]'::jsonb)));
    _badges := ARRAY(SELECT lower(jsonb_array_elements_text(COALESCE(_aud -> 'badges', '[]'::jsonb))));
    _verif := ARRAY(SELECT jsonb_array_elements_text(COALESCE(_aud -> 'verification', '[]'::jsonb)));
    _inactive := CASE WHEN (_aud ->> 'inactive_days') ~ '^\d{1,4}$' THEN (_aud ->> 'inactive_days')::INT END;
    IF COALESCE((_aud ->> 'policy_not_acknowledged')::BOOLEAN, false) THEN
      IF to_regprocedure('public.consultant_policy_current_version()') IS NOT NULL
         AND to_regclass('public.consultant_policy_acknowledgements') IS NOT NULL THEN
        EXECUTE 'SELECT public.consultant_policy_current_version()' INTO _cur;
        IF _cur IS NOT NULL THEN
          _policy_on := true;
          EXECUTE 'SELECT COALESCE(array_agg(DISTINCT user_id), ''{}'') FROM public.consultant_policy_acknowledgements WHERE version = $1'
            INTO _acked USING _cur;
        END IF;
      END IF;
      IF NOT _policy_on THEN RETURN; END IF; -- no published policy yet: nobody is "not acknowledged"
    END IF;
    RETURN QUERY
      SELECT u.id FROM auth.users u
      LEFT JOIN public.consultants c ON c.user_id = u.id
      LEFT JOIN public.client_profiles cp ON cp.user_id = u.id
      LEFT JOIN public.profiles p ON p.user_id = u.id
      WHERE (cardinality(_roles) = 0 OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::TEXT = ANY (_roles)))
        AND (cardinality(_countries) = 0 OR lower(COALESCE(c.country, cp.country, '')) = ANY (_countries))
        AND (cardinality(_areas) = 0 OR COALESCE(c.sap_technologies, '{}') && _areas)
        AND (cardinality(_badges) = 0 OR lower(COALESCE(c.ai_interview_badge, '')) = ANY (_badges))
        AND (cardinality(_verif) = 0 OR c.verification_status::TEXT = ANY (_verif))
        AND (NOT COALESCE((_aud ->> 'location_missing')::BOOLEAN, false)
             OR (c.id IS NOT NULL AND (NULLIF(btrim(c.country), '') IS NULL OR NULLIF(btrim(c.city), '') IS NULL)))
        AND (NOT COALESCE((_aud ->> 'incomplete_profile')::BOOLEAN, false)
             OR (c.id IS NOT NULL AND COALESCE((public.consultant_completion(c.id) ->> 'percent')::INT, 0) < 100)
             OR (c.id IS NULL AND p.onboarding_completed IS NOT TRUE))
        AND (NOT _policy_on OR (c.id IS NOT NULL AND NOT (u.id = ANY (_acked))))
        AND (_inactive IS NULL OR COALESCE(u.last_sign_in_at, u.created_at) < now() - make_interval(days => _inactive))
      LIMIT 5000;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.bm_audience_ids(JSONB, INT) FROM PUBLIC, anon, authenticated;

-- Every candidate with name, language, reachability and the reason they are excluded (NULL = will receive).
-- Mirror: _shared/bulkMessaging.ts exclusionReason / recipientPlan.
CREATE OR REPLACE FUNCTION public.bm_resolve(_aud JSONB, _category TEXT, _exclude UUID[] DEFAULT '{}')
RETURNS TABLE (user_id UUID, display_name TEXT, role TEXT, lang TEXT, country TEXT, telegram BOOLEAN, has_phone BOOLEAN, excluded TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _ids UUID[]; _paused UUID[] := '{}'; _gone UUID[] := '{}'; _susp UUID[] := '{}';
BEGIN
  _ids := ARRAY(SELECT DISTINCT a.user_id FROM public.bm_audience_ids(_aud) a LIMIT 5000);
  IF _category = 'marketing' AND to_regprocedure('public.notifications_paused(uuid,text,text)') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(array_agg(x), ''{}'') FROM unnest($1) x WHERE public.notifications_paused(x, ''digests'', ''in_app'')'
      INTO _paused USING _ids;
  END IF;
  IF to_regclass('public.user_admin_state') IS NOT NULL THEN
    EXECUTE 'SELECT COALESCE(array_agg(user_id) FILTER (WHERE deleted_at IS NOT NULL OR merged_into IS NOT NULL), ''{}''),
                    COALESCE(array_agg(user_id) FILTER (WHERE suspended_at IS NOT NULL AND (suspended_until IS NULL OR suspended_until > now())), ''{}'')
               FROM public.user_admin_state WHERE user_id = ANY ($1)' INTO _gone, _susp USING _ids;
  END IF;
  RETURN QUERY
    SELECT u.id,
           COALESCE(NULLIF(btrim(p.display_name), ''), 'User'),
           (SELECT r.role::TEXT FROM public.user_roles r WHERE r.user_id = u.id
             ORDER BY array_position(ARRAY['super_admin', 'admin', 'consultant', 'client'], r.role::TEXT) LIMIT 1),
           CASE WHEN COALESCE(p.preferred_language, cp.preferred_language, '') ILIKE 'ar%' THEN 'ar' ELSE 'en' END,
           COALESCE(c.country, cp.country),
           EXISTS (SELECT 1 FROM public.telegram_links t WHERE t.user_id = u.id AND t.active),
           (NULLIF(btrim(COALESCE(p.phone, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(cp.phone, '')), '') IS NOT NULL),
           CASE
             WHEN u.deleted_at IS NOT NULL OR u.id = ANY (_gone) THEN 'deleted'
             WHEN (u.banned_until IS NOT NULL AND u.banned_until > now()) OR u.id = ANY (_susp) THEN 'suspended'
             WHEN u.id = ANY (COALESCE(_exclude, '{}')) THEN 'excluded_by_admin'
             WHEN _category = 'marketing' AND EXISTS (SELECT 1 FROM public.suppressed_emails s WHERE lower(s.email) = lower(u.email)) THEN 'unsubscribed'
             WHEN _category = 'marketing' AND u.id = ANY (_paused) THEN 'paused'
           END
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.user_id = u.id
      LEFT JOIN public.client_profiles cp ON cp.user_id = u.id
      LEFT JOIN public.consultants c ON c.user_id = u.id
     WHERE u.id = ANY (_ids);
END $$;
REVOKE ALL ON FUNCTION public.bm_resolve(JSONB, TEXT, UUID[]) FROM PUBLIC, anon, authenticated;

-- Preview for the compose screen: counts, exclusion reasons, reachability per channel and the first 500 people.
CREATE OR REPLACE FUNCTION public.bm_preview(_audience JSONB, _category TEXT, _exclude UUID[] DEFAULT '{}')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
REVOKE ALL ON FUNCTION public.bm_preview(JSONB, TEXT, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_preview(JSONB, TEXT, UUID[]) TO authenticated;

-- Client consultant groups (Feature O) an admin may address: name, client company and member count only.
CREATE OR REPLACE FUNCTION public.bm_client_groups()
RETURNS TABLE (id UUID, name TEXT, company TEXT, members INT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.bm_can_send(auth.uid()) THEN RAISE EXCEPTION 'You do not have permission to send messages' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT g.id, g.name, cp.company_name,
           (SELECT count(*)::INT FROM public.client_consultant_group_members m WHERE m.group_id = g.id)
      FROM public.client_consultant_groups g
      LEFT JOIN public.client_profiles cp ON cp.user_id = COALESCE(g.owner_user_id, g.created_by)
     WHERE g.archived_at IS NULL
     ORDER BY cp.company_name NULLS LAST, g.name
     LIMIT 500;
END $$;
REVOKE ALL ON FUNCTION public.bm_client_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_client_groups() TO authenticated;

-- ================================================================ 7. create / test / cancel
CREATE OR REPLACE FUNCTION public.bm_create_campaign(_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF cardinality(_channels) = 0 OR NOT (_channels <@ ARRAY['in_app', 'popup', 'telegram', 'whatsapp_manual', 'sms_manual']) THEN
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

  -- Pasted addresses are not kept in the campaign record (the recipient table has the accounts).
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
              WHEN ch.c IN ('whatsapp_manual', 'sms_manual') AND NOT r.has_phone THEN 'skipped'
              WHEN ch.c IN ('whatsapp_manual', 'sms_manual') THEN 'manual_pending'
              ELSE 'queued' END,
         CASE WHEN r.excluded IS NOT NULL THEN r.excluded
              WHEN ch.c = 'telegram' AND NOT r.telegram THEN 'not_linked'
              WHEN ch.c IN ('whatsapp_manual', 'sms_manual') AND NOT r.has_phone THEN 'no_phone' END
    FROM bm_tmp_resolved r
    CROSS JOIN (SELECT DISTINCT c FROM unnest(_channels) c WHERE c <> 'popup') ch;

  INSERT INTO public.message_campaign_events (campaign_id, actor, action, detail)
  VALUES (_id, _me, 'created', jsonb_build_object('count', _count, 'excluded', _excluded, 'channels', _channels, 'category', _category,
    'audience', _aud_stored ->> 'kind', 'subject', left(_subject_en, 150), 'scheduled_at', _when, 'time_zone', _tz));
  PERFORM public.bm_arm_worker(); -- wake the sender now (or at the scheduled minute)
  RETURN jsonb_build_object('id', _id, 'recipient_count', _count, 'excluded_count', _excluded, 'scheduled_at', _when);
END $$;
REVOKE ALL ON FUNCTION public.bm_create_campaign(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_create_campaign(JSONB) TO authenticated;

-- "Send me a test": an in-app notice to the sender only, with the text as previewed.
CREATE OR REPLACE FUNCTION public.bm_send_test(_subject TEXT, _body TEXT, _category TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := public.bm_guard('test', 30); _nid UUID;
BEGIN
  IF public.bm_has_secret(concat_ws(' ', _subject, _body)) THEN
    RAISE EXCEPTION 'The message seems to contain a password or a key. Remove it before sending.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.notifications (user_id, title, body, type, link)
  VALUES (_me, left('[Test] ' || COALESCE(NULLIF(btrim(_subject), ''), 'Message'), 200), left(COALESCE(_body, ''), 1000),
          CASE WHEN _category = 'marketing' THEN 'admin_marketing' ELSE 'admin_message' END, '/notifications')
  RETURNING id INTO _nid;
  INSERT INTO public.message_campaign_events (actor, action, detail) VALUES (_me, 'test_sent', jsonb_build_object('category', _category));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.bm_send_test(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_send_test(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.bm_cancel_campaign(_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := public.bm_guard('cancel', 60); _n INT;
BEGIN
  UPDATE public.message_campaigns SET status = 'cancelled', cancelled_at = now(), cancelled_by = _me
   WHERE id = _id AND status IN ('scheduled', 'sending');
  IF NOT FOUND THEN RAISE EXCEPTION 'This campaign is already finished' USING ERRCODE = '22023'; END IF;
  UPDATE public.message_campaign_recipients SET status = 'cancelled', reason = 'cancelled'
   WHERE campaign_id = _id AND status IN ('queued', 'claimed', 'manual_pending');
  GET DIAGNOSTICS _n = ROW_COUNT;
  INSERT INTO public.message_campaign_events (campaign_id, actor, action, detail) VALUES (_id, _me, 'cancelled', jsonb_build_object('stopped', _n));
  PERFORM public.bm_arm_worker();
  RETURN jsonb_build_object('stopped', _n);
END $$;
REVOKE ALL ON FUNCTION public.bm_cancel_campaign(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_cancel_campaign(UUID) TO authenticated;

-- ================================================================ 8. report
CREATE OR REPLACE FUNCTION public.bm_campaign_report(_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.bm_can_send(auth.uid()) THEN RAISE EXCEPTION 'You do not have permission to send messages' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'by_channel', COALESCE((SELECT jsonb_object_agg(channel, s) FROM (
       SELECT channel, jsonb_object_agg(status, n) s FROM (
         SELECT channel, status, count(*) n FROM public.message_campaign_recipients WHERE campaign_id = _id GROUP BY channel, status) a
       GROUP BY channel) b), '{}'::jsonb),
    'reasons', COALESCE((SELECT jsonb_object_agg(reason, n) FROM (
       SELECT reason, count(*) n FROM public.message_campaign_recipients WHERE campaign_id = _id AND reason IS NOT NULL GROUP BY reason) r), '{}'::jsonb),
    'read', (SELECT count(*) FROM public.message_campaign_recipients mr JOIN public.notifications n ON n.id = mr.notification_id
              WHERE mr.campaign_id = _id AND mr.channel = 'in_app' AND n.is_read),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('action', e.action, 'at', e.created_at, 'actor',
        (SELECT p.display_name FROM public.profiles p WHERE p.user_id = e.actor), 'detail', e.detail) ORDER BY e.created_at)
      FROM public.message_campaign_events e WHERE e.campaign_id = _id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.bm_campaign_report(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_campaign_report(UUID) TO authenticated;

-- ================================================================ 9. manual WhatsApp / SMS helper (admin only, audited)
-- Phone numbers leave the database only here, only to message senders, and every read is recorded (count only).
CREATE OR REPLACE FUNCTION public.bm_manual_contacts(_id UUID)
RETURNS TABLE (user_id UUID, display_name TEXT, lang TEXT, channel TEXT, status TEXT, phone TEXT, first_name TEXT, company TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := public.bm_guard('phones', 60); _n INT;
BEGIN
  SELECT count(*) INTO _n FROM public.message_campaign_recipients r
   WHERE r.campaign_id = _id AND r.channel IN ('whatsapp_manual', 'sms_manual') AND r.status IN ('manual_pending', 'manual_sent');
  INSERT INTO public.message_campaign_events (campaign_id, actor, action, detail) VALUES (_id, _me, 'phones_viewed', jsonb_build_object('count', _n));
  RETURN QUERY
    SELECT r.user_id, COALESCE(NULLIF(btrim(p.display_name), ''), 'User'), r.lang, r.channel, r.status,
           COALESCE(NULLIF(btrim(p.phone), ''), NULLIF(btrim(cp.phone), '')),
           split_part(btrim(COALESCE(p.display_name, '')), ' ', 1), cp.company_name
      FROM public.message_campaign_recipients r
      JOIN public.message_campaigns mc ON mc.id = r.campaign_id AND mc.status <> 'cancelled'
      LEFT JOIN public.profiles p ON p.user_id = r.user_id
      LEFT JOIN public.client_profiles cp ON cp.user_id = r.user_id
     WHERE r.campaign_id = _id AND r.channel IN ('whatsapp_manual', 'sms_manual') AND r.status IN ('manual_pending', 'manual_sent')
     ORDER BY 2;
END $$;
REVOKE ALL ON FUNCTION public.bm_manual_contacts(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_manual_contacts(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.bm_mark_manual(_id UUID, _user UUID, _channel TEXT, _sent BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := public.bm_guard('manual', 2000);
BEGIN
  UPDATE public.message_campaign_recipients
     SET status = CASE WHEN _sent THEN 'manual_sent' ELSE 'manual_pending' END,
         sent_at = CASE WHEN _sent THEN now() END, manual_by = CASE WHEN _sent THEN _me END
   WHERE campaign_id = _id AND user_id = _user AND channel = _channel AND channel IN ('whatsapp_manual', 'sms_manual')
     AND status IN ('manual_pending', 'manual_sent');
  IF NOT FOUND THEN RAISE EXCEPTION 'This person is not on the manual list' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.message_campaign_events (campaign_id, actor, action, detail)
  VALUES (_id, _me, CASE WHEN _sent THEN 'manual_sent' ELSE 'manual_undone' END, jsonb_build_object('channel', _channel));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.bm_mark_manual(UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_mark_manual(UUID, UUID, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.bm_log_phone_export(_id UUID, _count INT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := public.bm_guard('phones_export', 30);
BEGIN
  INSERT INTO public.message_campaign_events (campaign_id, actor, action, detail)
  VALUES (_id, _me, 'phones_exported', jsonb_build_object('count', GREATEST(0, COALESCE(_count, 0))));
END $$;
REVOKE ALL ON FUNCTION public.bm_log_phone_export(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_log_phone_export(UUID, INT) TO authenticated;

-- ================================================================ 10. templates, saved audiences, settings
CREATE OR REPLACE FUNCTION public.bm_save_template(_payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := public.bm_guard('template', 120); _id UUID := NULLIF(_payload ->> 'id', '')::UUID;
BEGIN
  IF public.bm_has_secret(concat_ws(' ', _payload ->> 'subject_en', _payload ->> 'subject_ar', _payload ->> 'body_en', _payload ->> 'body_ar')) THEN
    RAISE EXCEPTION 'The message seems to contain a password or a key. Remove it before saving.' USING ERRCODE = '22023';
  END IF;
  IF _id IS NULL THEN
    IF (SELECT count(*) FROM public.message_templates WHERE archived_at IS NULL) >= 200 THEN
      RAISE EXCEPTION 'At most 200 templates' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.message_templates (name, category, subject_en, subject_ar, body_en, body_ar, link_url, created_by)
    VALUES (btrim(_payload ->> 'name'), _payload ->> 'category', COALESCE(_payload ->> 'subject_en', ''), NULLIF(_payload ->> 'subject_ar', ''),
            COALESCE(_payload ->> 'body_en', ''), NULLIF(_payload ->> 'body_ar', ''), NULLIF(_payload ->> 'link_url', ''), _me)
    RETURNING id INTO _id;
  ELSE
    UPDATE public.message_templates SET name = btrim(_payload ->> 'name'), category = _payload ->> 'category',
      subject_en = COALESCE(_payload ->> 'subject_en', ''), subject_ar = NULLIF(_payload ->> 'subject_ar', ''),
      body_en = COALESCE(_payload ->> 'body_en', ''), body_ar = NULLIF(_payload ->> 'body_ar', ''),
      link_url = NULLIF(_payload ->> 'link_url', ''), updated_by = _me, updated_at = now()
     WHERE id = _id AND archived_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'Template not found' USING ERRCODE = '22023'; END IF;
  END IF;
  INSERT INTO public.message_campaign_events (actor, action, detail) VALUES (_me, 'template_saved', jsonb_build_object('template', _id));
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.bm_save_template(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_save_template(JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.bm_archive_template(_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := public.bm_guard('template', 120);
BEGIN
  UPDATE public.message_templates SET archived_at = now(), updated_by = _me WHERE id = _id AND archived_at IS NULL;
  INSERT INTO public.message_campaign_events (actor, action, detail) VALUES (_me, 'template_archived', jsonb_build_object('template', _id));
END $$;
REVOKE ALL ON FUNCTION public.bm_archive_template(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_archive_template(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.bm_save_audience(_name TEXT, _audience JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := public.bm_guard('audience', 120); _id UUID;
BEGIN
  IF COALESCE(_audience ->> 'kind', '') NOT IN ('filter', 'group') THEN
    RAISE EXCEPTION 'Only filters and groups can be saved' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.message_saved_audiences WHERE admin_id = _me) >= 30 THEN
    RAISE EXCEPTION 'At most 30 saved audiences' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.message_saved_audiences (admin_id, name, audience) VALUES (_me, btrim(_name), _audience)
  ON CONFLICT (admin_id, name) DO UPDATE SET audience = EXCLUDED.audience
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.bm_save_audience(TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_save_audience(TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.bm_delete_audience(_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := public.bm_guard('audience', 120);
BEGIN
  DELETE FROM public.message_saved_audiences WHERE id = _id AND admin_id = _me;
END $$;
REVOKE ALL ON FUNCTION public.bm_delete_audience(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_delete_audience(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.bm_settings()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.bm_can_send(auth.uid()) THEN RAISE EXCEPTION 'You do not have permission to send messages' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'enabled', public.platform_flag('bulk_messaging_enabled', true),
    'inapp_per_minute', public.bm_setting_int('bulk_inapp_per_minute', 100, 1, 1000),
    'telegram_per_minute', public.bm_setting_int('bulk_telegram_per_minute', 240, 1, 1200),
    'daily_cap', public.bm_setting_int('bulk_daily_cap', 2000, 1, 100000),
    'provider', COALESCE((SELECT value #>> '{}' FROM public.platform_settings WHERE key = 'bulk_whatsapp_sms_provider'), 'off'),
    'can_edit', public.has_role(auth.uid(), 'super_admin'),
    'pause_installed', to_regprocedure('public.notifications_paused(uuid,text,text)') IS NOT NULL,
    'groups_installed', to_regclass('public.admin_permission_groups') IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.bm_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_settings() TO authenticated;

-- Kill switch and limits: super admins only. Paid providers stay 'off' until the owner chooses one.
CREATE OR REPLACE FUNCTION public.bm_set_settings(_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _me UUID := auth.uid(); _k TEXT; _v JSONB;
BEGIN
  IF _me IS NULL OR NOT public.has_role(_me, 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can change message settings' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('bm:settings:' || _me::TEXT, 60, 3600) THEN
    RAISE EXCEPTION 'Too many changes in the last hour' USING ERRCODE = 'P0429';
  END IF;
  FOR _k, _v IN SELECT key, value FROM jsonb_each(COALESCE(_payload, '{}'::jsonb)) LOOP
    IF _k = 'enabled' AND jsonb_typeof(_v) = 'boolean' THEN
      INSERT INTO public.platform_settings (key, value) VALUES ('bulk_messaging_enabled', _v)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    ELSIF _k IN ('inapp_per_minute', 'telegram_per_minute', 'daily_cap') AND jsonb_typeof(_v) = 'number' THEN
      INSERT INTO public.platform_settings (key, value)
      VALUES ('bulk_' || _k, to_jsonb(GREATEST(1, LEAST(CASE _k WHEN 'inapp_per_minute' THEN 1000 WHEN 'telegram_per_minute' THEN 1200 ELSE 100000 END, (_v #>> '{}')::NUMERIC::INT))))
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    ELSIF _k = 'provider' THEN
      IF (_v #>> '{}') <> 'off' THEN
        RAISE EXCEPTION 'Paid WhatsApp / SMS sending is not set up yet' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.platform_settings (key, value) VALUES ('bulk_whatsapp_sms_provider', '"off"'::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    END IF;
  END LOOP;
  INSERT INTO public.message_campaign_events (actor, action, detail) VALUES (_me, 'settings_changed', COALESCE(_payload, '{}'::jsonb));
  PERFORM public.bm_arm_worker();
  RETURN public.bm_settings();
END $$;
REVOKE ALL ON FUNCTION public.bm_set_settings(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bm_set_settings(JSONB) TO authenticated;

-- ================================================================ 11. worker (service role only)
-- Throttled, atomic claim (FOR UPDATE SKIP LOCKED). The per-minute budgets count what was claimed in the last 60 seconds,
-- so overlapping runs cannot exceed them. Stale claims return to the queue (3 attempts, then failed).
CREATE OR REPLACE FUNCTION public.bm_claim(_max INT DEFAULT 300)
RETURNS TABLE (campaign_id UUID, user_id UUID, channel TEXT, lang TEXT, category TEXT, popup BOOLEAN,
  subject_en TEXT, subject_ar TEXT, body_en TEXT, body_ar TEXT, link_url TEXT,
  first_name TEXT, company TEXT, profile_completion INT, chat_id BIGINT, attempts INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _in INT; _tg INT; _cap INT := GREATEST(1, LEAST(COALESCE(_max, 300), 300));
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('bm_claim')) THEN RETURN; END IF;

  UPDATE public.message_campaign_recipients r
     SET status = CASE WHEN r.attempts >= 3 THEN 'failed' ELSE 'queued' END,
         reason = CASE WHEN r.attempts >= 3 THEN 'timeout' ELSE r.reason END
   WHERE r.status = 'claimed' AND r.claimed_at < now() - interval '10 minutes';

  UPDATE public.message_campaigns c SET status = 'sent', finished_at = now()
   WHERE c.status = 'sending'
     AND NOT EXISTS (SELECT 1 FROM public.message_campaign_recipients r WHERE r.campaign_id = c.id AND r.status IN ('queued', 'claimed'));

  IF NOT public.platform_flag('bulk_messaging_enabled', true) THEN -- kill switch: nothing new goes out
    PERFORM public.bm_arm_worker();
    RETURN;
  END IF;

  WITH started AS (
    UPDATE public.message_campaigns c SET status = 'sending', started_at = now()
     WHERE c.status = 'scheduled' AND c.scheduled_at <= now() RETURNING c.id)
  INSERT INTO public.message_campaign_events (campaign_id, action) SELECT id, 'started' FROM started;
  PERFORM public.bm_arm_worker(); -- keep waking every minute while sending, or stop after the queue drained

  _in := LEAST(_cap, GREATEST(0, public.bm_setting_int('bulk_inapp_per_minute', 100, 1, 1000)
    - (SELECT count(*) FROM public.message_campaign_recipients r WHERE r.channel = 'in_app' AND r.claimed_at > now() - interval '1 minute')));
  _tg := LEAST(_cap, GREATEST(0, public.bm_setting_int('bulk_telegram_per_minute', 240, 1, 1200)
    - (SELECT count(*) FROM public.message_campaign_recipients r WHERE r.channel = 'telegram' AND r.claimed_at > now() - interval '1 minute')));

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
  upd AS (
    UPDATE public.message_campaign_recipients r SET status = 'claimed', claimed_at = now(), attempts = r.attempts + 1
      FROM (SELECT * FROM pick_in UNION ALL SELECT * FROM pick_tg) p
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

-- Results from the worker: [{campaign_id, user_id, channel, ok, error, notification_id, subject, body, retry}]
CREATE OR REPLACE FUNCTION public.bm_finish(_results JSONB)
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n INT;
BEGIN
  WITH x AS (
    SELECT (e ->> 'campaign_id')::UUID cid, (e ->> 'user_id')::UUID uid, e ->> 'channel' ch, COALESCE((e ->> 'ok')::BOOLEAN, false) ok,
           left(e ->> 'error', 60) err, NULLIF(e ->> 'notification_id', '')::UUID nid, left(e ->> 'subject', 200) subj,
           left(e ->> 'body', 7000) body, COALESCE((e ->> 'retry')::BOOLEAN, false) retry
      FROM jsonb_array_elements(COALESCE(_results, '[]'::jsonb)) e LIMIT 600)
  UPDATE public.message_campaign_recipients r
     SET status = CASE WHEN x.ok THEN 'sent' WHEN x.retry AND r.attempts < 3 THEN 'queued' ELSE 'failed' END,
         reason = CASE WHEN x.ok THEN NULL ELSE COALESCE(x.err, 'failed') END,
         sent_at = CASE WHEN x.ok THEN now() END,
         notification_id = COALESCE(x.nid, r.notification_id),
         rendered_subject = CASE WHEN x.ok THEN x.subj END,
         rendered_body = CASE WHEN x.ok THEN x.body END
    FROM x
   WHERE r.campaign_id = x.cid AND r.user_id = x.uid AND r.channel = x.ch AND r.status = 'claimed';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.bm_finish(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bm_finish(JSONB) TO service_role;

-- ================================================================ 12. recipients: "Messages from AI Support 360"
-- The signed-in user's own message (full text, rendered for them) and unread pop-ups.
CREATE OR REPLACE FUNCTION public.my_broadcast_message(_notification_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('notification_id', r.notification_id, 'subject', r.rendered_subject, 'body', r.rendered_body,
                            'category', c.category, 'link_url', c.link_url, 'sent_at', r.sent_at, 'lang', r.lang)
    FROM public.message_campaign_recipients r JOIN public.message_campaigns c ON c.id = r.campaign_id
   WHERE r.notification_id = _notification_id AND r.user_id = auth.uid() AND r.channel = 'in_app' AND r.status = 'sent'
$$;
REVOKE ALL ON FUNCTION public.my_broadcast_message(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_broadcast_message(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_broadcast_popups()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('notification_id', r.notification_id, 'subject', r.rendered_subject, 'body', r.rendered_body,
                            'category', c.category, 'link_url', c.link_url, 'lang', r.lang) ORDER BY r.sent_at), '[]'::jsonb)
    FROM (SELECT * FROM public.message_campaign_recipients r
           WHERE r.user_id = auth.uid() AND r.channel = 'in_app' AND r.status = 'sent' AND r.sent_at > now() - interval '30 days'
           ORDER BY r.sent_at DESC LIMIT 3) r
    JOIN public.message_campaigns c ON c.id = r.campaign_id AND 'popup' = ANY (c.channels)
    JOIN public.notifications n ON n.id = r.notification_id AND n.user_id = auth.uid() AND n.is_read IS NOT TRUE
$$;
REVOKE ALL ON FUNCTION public.my_broadcast_popups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_broadcast_popups() TO authenticated;

-- ================================================================ 13. schedule: woken on demand, credential-free
-- The worker runs only while there is work. Creating, cancelling or re-enabling arms it; every worker run re-checks:
--   * a campaign is sending or due within a minute -> every minute (throttled, capped at 300 per run)
--   * only later campaigns -> one wake-up at the minute the next one is due (UTC, like pg_cron)
--   * nothing left, or the kill switch is off -> the schedule is removed (no idle runs)
-- The function only calls the service-only bm_claim / bm_finish and answers counts only.
CREATE OR REPLACE FUNCTION public.bm_arm_worker()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _next TIMESTAMPTZ; _expr TEXT;
BEGIN
  IF public.platform_flag('bulk_messaging_enabled', true) THEN
    IF EXISTS (SELECT 1 FROM public.message_campaigns WHERE status = 'sending')
       OR EXISTS (SELECT 1 FROM public.message_campaigns WHERE status = 'scheduled' AND scheduled_at <= now() + interval '1 minute') THEN
      _expr := '* * * * *';
    ELSE
      SELECT min(scheduled_at) INTO _next FROM public.message_campaigns WHERE status = 'scheduled';
      IF _next IS NOT NULL THEN
        _expr := to_char(_next AT TIME ZONE 'UTC', 'FMMI FMHH24 FMDD FMMM') || ' *';
      END IF;
    END IF;
  END IF;
  IF _expr IS NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bulk-messages-run';
    RETURN 'off';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bulk-messages-run' AND schedule = _expr) THEN RETURN _expr; END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'bulk-messages-run';
  PERFORM cron.schedule('bulk-messages-run', _expr, $job$
  SELECT net.http_post(
    url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/bulk-messages-run',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $job$);
  RETURN _expr;
END $$;
REVOKE ALL ON FUNCTION public.bm_arm_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bm_arm_worker() TO service_role;

SELECT public.bm_arm_worker();
