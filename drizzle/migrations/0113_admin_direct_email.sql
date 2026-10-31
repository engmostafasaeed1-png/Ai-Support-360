-- Direct admin e-mail: an administrator e-mails one person, the selected people, or everyone in the current Users
-- filter, from Admin › Users ("Send e-mail"). Extends docs/sql/admin-message-email.sql (applied as migration 0112):
-- the SAME queue (admin_message_emails), the SAME worker (admin-message-email function), the SAME modern layout
-- (_shared/adminMessageEmail.ts) and the same sender / Reply-To settings. Prepared for the owner's review. NOT APPLIED.
--
-- How it works
--   * admin_direct_email_preview (confirmation step) and admin_direct_email_send take the person ids (at most 1000),
--     the channel ('email' = e-mail only, 'both' = in-app + e-mail (default), 'in_app' = in-app only) and the message
--     (category, subject, summary, body, optional page link on our site, what to do, deadline, optional Arabic version).
--   * One message per recipient: each person gets their own in-app notice and / or their own e-mail (never CC / BCC),
--     in their language (Arabic text when the admin wrote one and the person prefers Arabic), with {first_name} filled.
--   * This is an explicit admin action, so the "more than 5 people = in-app only" rule of the trigger path does not apply:
--     sends set app.ame_direct and write their own queue rows (ame_capture skips them). Instead: a cap per send
--     (admin_direct_email_per_send_cap, default 200), the existing daily cap and per-admin / per-recipient hourly limits
--     of ame_claim (excess waits in the queue and goes out later; direct rows over the daily cap wait for the next day
--     instead of being skipped), and an "I confirm" step with the count, a list preview and the excluded people.
--   * Excluded, with the reason shown before sending and stored per person: not found, deleted / merged, yourself
--     (admins cannot e-mail themselves in bulk; "Send test to me" exists), test-tagged (unless "include tests"), and for
--     the e-mail: no address, unconfirmed address, unsubscribed, suppressed (bounce / complaint), paused quiet
--     notifications (unless "important"). With 'both', people excluded from the e-mail still get the in-app notice.
--   * Same safety rules: secrets filter (bm_has_secret), links only to pages on our own site (no outside links in the
--     text either), text is escaped by the shared layout, permission users.message + hourly action limit (um_guard),
--     switch admin_direct_email_enabled (default on), double-click safe (request_key), one audit row per send.
--   * Results: admin_direct_email_report (per person: in-app delivered / read, e-mail queued / sent / skipped with
--     reason / failed) and admin_direct_email_sends (history); the shared admin_message_history shows the rows too.
--
-- Redefines (newest bodies live HERE now; copy them into any later redefinition): ame_capture, ame_claim,
-- admin_message_history, admin_message_email_log. Everything else of docs/sql/admin-message-email.sql is unchanged.

-- ------------------------------------------------------------------ tables

-- Queue rows written by a direct send carry their own content (the e-mail-only channel has no in-app notice;
-- notification_id then holds the recipient row id, so the unique key stays one row per message).
ALTER TABLE public.admin_message_emails ADD COLUMN IF NOT EXISTS direct_send uuid;
ALTER TABLE public.admin_message_emails ADD COLUMN IF NOT EXISTS content jsonb;
CREATE INDEX IF NOT EXISTS admin_message_emails_direct_idx ON public.admin_message_emails (direct_send) WHERE direct_send IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.admin_direct_email_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid NOT NULL,
  request_key text NOT NULL CHECK (char_length(request_key) BETWEEN 8 AND 80),
  channel text NOT NULL CHECK (channel IN ('email', 'both', 'in_app')),
  category text NOT NULL,
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 120),
  content jsonb NOT NULL,
  important boolean NOT NULL DEFAULT false,
  include_tests boolean NOT NULL DEFAULT false,
  requested integer NOT NULL,
  recipients integer NOT NULL,
  excluded integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor, request_key)
);
CREATE INDEX IF NOT EXISTS admin_direct_email_sends_created_idx ON public.admin_direct_email_sends (created_at DESC);
GRANT ALL ON public.admin_direct_email_sends TO service_role;
REVOKE ALL ON public.admin_direct_email_sends FROM PUBLIC, anon, authenticated;
ALTER TABLE public.admin_direct_email_sends ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.admin_direct_email_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  send_id uuid NOT NULL REFERENCES public.admin_direct_email_sends (id) ON DELETE CASCADE,
  recipient uuid NOT NULL,
  lang text NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'ar')),
  notification_id uuid,
  mail_id uuid,
  reason text CHECK (reason IS NULL OR char_length(reason) <= 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (send_id, recipient)
);
GRANT ALL ON public.admin_direct_email_recipients TO service_role;
REVOKE ALL ON public.admin_direct_email_recipients FROM PUBLIC, anon, authenticated;
ALTER TABLE public.admin_direct_email_recipients ENABLE ROW LEVEL SECURITY;
-- No browser policies: admins read through admin_direct_email_report / admin_direct_email_sends only.

-- Send records are history: never changed afterwards.
CREATE OR REPLACE FUNCTION public.ade_immutable()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'Direct e-mail records cannot be changed' USING ERRCODE = '42501';
END
$$;
DROP TRIGGER IF EXISTS trg_ade_sends_immutable ON public.admin_direct_email_sends;
CREATE TRIGGER trg_ade_sends_immutable BEFORE UPDATE ON public.admin_direct_email_sends
  FOR EACH ROW EXECUTE FUNCTION public.ade_immutable();
DROP TRIGGER IF EXISTS trg_ade_recipients_immutable ON public.admin_direct_email_recipients;
CREATE TRIGGER trg_ade_recipients_immutable BEFORE UPDATE ON public.admin_direct_email_recipients
  FOR EACH ROW EXECUTE FUNCTION public.ade_immutable();

-- ------------------------------------------------------------------ helpers (mirrored by src/lib/adminDirectEmail.ts)

CREATE OR REPLACE FUNCTION public.ade_first_name(_uid uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT split_part(btrim(p.display_name), ' ', 1) FROM public.profiles p WHERE p.user_id = _uid LIMIT 1), '')
$$;
REVOKE ALL ON FUNCTION public.ade_first_name(uuid) FROM PUBLIC, anon, authenticated;

-- {first_name} (also {{first_name}}) becomes the person's first name; without a name the placeholder and the space
-- before it disappear ("Hi {first_name}," -> "Hi,"). {link} becomes the full page address, {ticket} is removed.
CREATE OR REPLACE FUNCTION public.ade_fill(_text text, _first text, _link text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(COALESCE(_text, ''),
    '( ?)\{\{?\s*first_name\s*\}?\}', CASE WHEN COALESCE(btrim(_first), '') = '' THEN '' ELSE '\1' || replace(btrim(_first), '\', '\\') END, 'g'),
    '\{\{?\s*link\s*\}?\}', CASE WHEN _link IS NULL THEN '' ELSE 'https://www.aisupport360.com' || replace(_link, '\', '\\') END, 'g'),
    '( ?)\{\{?\s*ticket\s*\}?\}', '', 'g'))
$$;

-- Quiet-pause group of a direct message: Reminder -> reminders, every other category -> activity. (Plain admin
-- messages count as essential and are never paused; a direct send to many people is not, so pauses apply unless
-- the admin ticks "important".)
CREATE OR REPLACE FUNCTION public.ade_pause_category(_category text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE WHEN _category = 'reminder' THEN 'reminders' ELSE 'activity' END
$$;

-- Who receives what. reason NULL = receives everything on the channel; scope 'all' = receives nothing,
-- scope 'email' = no e-mail but still the in-app notice (channel 'both').
CREATE OR REPLACE FUNCTION public.ade_targets(_ids uuid[], _channel text, _important boolean, _tests boolean, _category text, _me uuid)
 RETURNS TABLE (user_id uuid, name text, email text, lang text, reason text, scope text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH ids AS (SELECT DISTINCT x AS id FROM unnest(COALESCE(_ids, '{}'::uuid[])) x WHERE x IS NOT NULL),
  multi AS (SELECT count(*) > 1 AS m FROM ids),
  base AS (
    SELECT i.id, (u.id IS NOT NULL) AS found, NULLIF(btrim(COALESCE(u.email, '')), '') AS email, u.email_confirmed_at,
           p.display_name, CASE WHEN p.preferred_language LIKE 'ar%' THEN 'ar' ELSE 'en' END AS lang,
           (s.deleted_at IS NOT NULL OR s.merged_into IS NOT NULL) AS gone
    FROM ids i
    LEFT JOIN auth.users u ON u.id = i.id
    LEFT JOIN public.user_admin_state s ON s.user_id = i.id
    LEFT JOIN LATERAL (SELECT pp.display_name, pp.preferred_language FROM public.profiles pp WHERE pp.user_id = i.id LIMIT 1) p ON true
  ),
  r AS (
    SELECT b.*, CASE
      WHEN NOT b.found THEN 'not_found'
      WHEN b.id = _me AND (SELECT m FROM multi) THEN 'self'
      WHEN COALESCE(b.gone, false) THEN 'deleted_or_merged'
      WHEN NOT COALESCE(_tests, false) AND public.ame_is_test_user(b.id) THEN 'test_account'
      WHEN _channel = 'in_app' THEN NULL
      WHEN b.email IS NULL THEN 'no_email'
      WHEN b.email_confirmed_at IS NULL THEN 'email_not_confirmed'
      WHEN EXISTS (SELECT 1 FROM public.suppressed_emails se WHERE lower(se.email) = lower(b.email) AND se.reason ILIKE '%unsub%') THEN 'recipient_unsubscribed'
      WHEN EXISTS (SELECT 1 FROM public.suppressed_emails se WHERE lower(se.email) = lower(b.email)) THEN 'recipient_suppressed'
      WHEN NOT COALESCE(_important, false)
           AND public.notifications_paused(b.id, public.ade_pause_category(_category), 'email') THEN 'paused'
    END AS why
    FROM base b
  )
  SELECT r.id, r.display_name, r.email, r.lang, r.why,
         CASE WHEN r.why IS NULL THEN NULL
              WHEN r.why IN ('not_found', 'self', 'deleted_or_merged', 'test_account') OR _channel = 'email' THEN 'all'
              ELSE 'email' END
  FROM r
$$;
REVOKE ALL ON FUNCTION public.ade_targets(uuid[], text, boolean, boolean, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ade_ids(_p jsonb)
 RETURNS uuid[] LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $$
DECLARE _out uuid[];
BEGIN
  IF jsonb_typeof(_p -> 'ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'ade_ids' USING ERRCODE = '22023'; END IF;
  IF jsonb_array_length(_p -> 'ids') > 1000 THEN RAISE EXCEPTION 'ade_too_many_ids' USING ERRCODE = '22023'; END IF;
  BEGIN
    SELECT array_agg(DISTINCT x::uuid) INTO _out FROM jsonb_array_elements_text(_p -> 'ids') x;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'ade_ids' USING ERRCODE = '22023';
  END;
  RETURN COALESCE(_out, '{}'::uuid[]);
END
$$;

CREATE OR REPLACE FUNCTION public.ade_channel(_p jsonb)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $$
DECLARE _c text := COALESCE(NULLIF(_p ->> 'channel', ''), 'both');
BEGIN
  IF _c NOT IN ('email', 'both', 'in_app') THEN RAISE EXCEPTION 'ade_channel' USING ERRCODE = '22023'; END IF;
  RETURN _c;
END
$$;

-- E-mails this admin / the platform already used, for the "now vs later" estimate (same counting as ame_claim).
CREATE OR REPLACE FUNCTION public.ade_usage(_me uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'daily_cap', public.bm_setting_int('admin_messages_email_daily_cap', 300, 1, 5000),
    'per_admin_hour', public.bm_setting_int('admin_messages_email_per_admin_hour', 60, 1, 1000),
    'per_recipient_hour', public.bm_setting_int('admin_messages_email_per_recipient_hour', 5, 1, 50),
    'sent_today', (SELECT count(DISTINCT e.mail_key) FROM public.admin_message_emails e
                   WHERE e.status IN ('sending', 'sent') AND e.claimed_at >= date_trunc('day', now())),
    'admin_sent_hour', (SELECT count(DISTINCT e.mail_key) FROM public.admin_message_emails e
                        WHERE e.actor = _me AND e.status IN ('sending', 'sent') AND e.claimed_at > now() - interval '1 hour'),
    'waiting', (SELECT count(*) FROM public.admin_message_emails e WHERE e.status IN ('queued', 'sending')))
$$;
REVOKE ALL ON FUNCTION public.ade_usage(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ settings

CREATE OR REPLACE FUNCTION public.admin_direct_email_settings()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.platform_flag('admin_direct_email_enabled', true),
    'per_send_cap', public.bm_setting_int('admin_direct_email_per_send_cap', 200, 1, 1000),
    'email_enabled', public.platform_flag('admin_messages_email_enabled', true),
    'can_send', public.admin_can(auth.uid(), 'users.message')) || public.ade_usage(auth.uid());
END
$$;
REVOKE ALL ON FUNCTION public.admin_direct_email_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_direct_email_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_direct_email_settings(_enabled boolean, _per_send_cap integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF _enabled IS NULL OR _per_send_cap IS NULL OR _per_send_cap NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'The cap per send must be between 1 and 1000' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_settings (key, value) VALUES ('admin_direct_email_enabled', to_jsonb(_enabled))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO public.platform_settings (key, value) VALUES ('admin_direct_email_per_send_cap', to_jsonb(_per_send_cap))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  PERFORM public.um_audit(auth.uid(), 'direct_email_settings', NULL, NULL,
    jsonb_build_object('enabled', _enabled, 'per_send_cap', _per_send_cap), NULL, '{}'::jsonb);
  RETURN public.admin_direct_email_settings();
END
$$;
REVOKE ALL ON FUNCTION public.admin_set_direct_email_settings(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_direct_email_settings(boolean, integer) TO authenticated;

-- ------------------------------------------------------------------ confirmation step

-- _p: ids (uuid array), channel, important, tests, category (for the quiet-pause group).
CREATE OR REPLACE FUNCTION public.admin_direct_email_preview(_p jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := public.um_guard('users.message', 'direct_email_preview', 600);
  _ids uuid[] := public.ade_ids(_p);
  _channel text := public.ade_channel(_p);
  _cap int := public.bm_setting_int('admin_direct_email_per_send_cap', 200, 1, 1000);
  _usage jsonb := public.ade_usage(_me);
  _res jsonb;
  _email_reach int;
  _now int;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _ade_t (user_id uuid, name text, email text, lang text, reason text, scope text) ON COMMIT DROP;
  TRUNCATE _ade_t;
  INSERT INTO _ade_t SELECT * FROM public.ade_targets(_ids, _channel, COALESCE((_p ->> 'important')::boolean, false),
    COALESCE((_p ->> 'tests')::boolean, false), COALESCE(NULLIF(_p ->> 'category', ''), 'notice'), _me);
  SELECT count(*) FILTER (WHERE reason IS NULL AND _channel <> 'in_app') INTO _email_reach FROM _ade_t;
  _now := GREATEST(0, LEAST((_usage ->> 'per_admin_hour')::int - (_usage ->> 'admin_sent_hour')::int,
                            (_usage ->> 'daily_cap')::int - (_usage ->> 'sent_today')::int));
  SELECT jsonb_build_object(
    'enabled', public.platform_flag('admin_direct_email_enabled', true),
    'email_enabled', public.platform_flag('admin_messages_email_enabled', true),
    'channel', _channel,
    'cap', _cap,
    'requested', cardinality(_ids),
    'recipients', count(*) FILTER (WHERE scope IS DISTINCT FROM 'all'),
    'email_reach', _email_reach,
    'in_app_reach', CASE WHEN _channel = 'email' THEN 0 ELSE count(*) FILTER (WHERE scope IS DISTINCT FROM 'all') END,
    'arabic', count(*) FILTER (WHERE scope IS DISTINCT FROM 'all' AND lang = 'ar'),
    'english', count(*) FILTER (WHERE scope IS DISTINCT FROM 'all' AND lang = 'en'),
    'by_reason', COALESCE((SELECT jsonb_object_agg(x.reason, x.n) FROM (SELECT reason, count(*) AS n FROM _ade_t WHERE reason IS NOT NULL GROUP BY reason) x), '{}'::jsonb),
    'excluded', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.user_id, 'name', e.name, 'email', e.email, 'reason', e.reason, 'scope', e.scope) ORDER BY e.name NULLS LAST)
                          FROM (SELECT * FROM _ade_t WHERE reason IS NOT NULL ORDER BY name NULLS LAST LIMIT 300) e), '[]'::jsonb),
    'sample', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.user_id, 'name', s.name, 'email', s.email, 'lang', s.lang) ORDER BY s.name NULLS LAST)
                        FROM (SELECT * FROM _ade_t WHERE scope IS DISTINCT FROM 'all' ORDER BY name NULLS LAST LIMIT 25) s), '[]'::jsonb),
    'later', GREATEST(0, _email_reach - _now))
    || _usage
  INTO _res FROM _ade_t;
  RETURN _res;
END
$$;
REVOKE ALL ON FUNCTION public.admin_direct_email_preview(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_direct_email_preview(jsonb) TO authenticated;

-- ------------------------------------------------------------------ result + history

CREATE OR REPLACE FUNCTION public.admin_direct_email_report(_send uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _s public.admin_direct_email_sends;
BEGIN
  IF auth.uid() IS NULL OR NOT public.admin_can(auth.uid(), 'users.message') THEN
    RAISE EXCEPTION 'You do not have permission for this action' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _s FROM public.admin_direct_email_sends WHERE id = _send;
  IF NOT FOUND THEN RAISE EXCEPTION 'ade_not_found' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object(
    'send', jsonb_build_object('id', _s.id, 'created_at', _s.created_at, 'channel', _s.channel, 'category', _s.category,
      'subject', _s.subject, 'important', _s.important, 'requested', _s.requested, 'recipients', _s.recipients, 'excluded', _s.excluded,
      'actor_name', (SELECT p.display_name FROM public.profiles p WHERE p.user_id = _s.actor LIMIT 1)),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', r.recipient, 'name', p.display_name, 'email', u.email, 'lang', r.lang,
        'in_app', (r.notification_id IS NOT NULL AND n.id IS NOT NULL), 'read', COALESCE(n.is_read, false),
        'email_status', CASE WHEN _s.channel = 'in_app' THEN NULL WHEN q.id IS NOT NULL THEN q.status WHEN r.reason IS NOT NULL THEN 'skipped' END,
        'reason', COALESCE(r.reason, CASE WHEN q.status <> 'sent' THEN q.reason END),
        'send_after', q.send_after, 'finished_at', q.finished_at) ORDER BY p.display_name NULLS LAST)
      FROM public.admin_direct_email_recipients r
      LEFT JOIN public.admin_message_emails q ON q.id = r.mail_id
      LEFT JOIN public.notifications n ON n.id = r.notification_id
      LEFT JOIN auth.users u ON u.id = r.recipient
      LEFT JOIN LATERAL (SELECT pp.display_name FROM public.profiles pp WHERE pp.user_id = r.recipient LIMIT 1) p ON true
      WHERE r.send_id = _s.id), '[]'::jsonb));
END
$$;
REVOKE ALL ON FUNCTION public.admin_direct_email_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_direct_email_report(uuid) TO authenticated;

-- History of direct sends. _p: q (subject), from, to (dates), limit (<= 200).
CREATE OR REPLACE FUNCTION public.admin_direct_email_sends(_p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _q text := NULLIF(btrim(COALESCE(_p ->> 'q', '')), '');
  _from date; _to date;
BEGIN
  IF auth.uid() IS NULL OR NOT public.admin_can(auth.uid(), 'users.message') THEN
    RAISE EXCEPTION 'You do not have permission for this action' USING ERRCODE = '42501';
  END IF;
  BEGIN _from := NULLIF(_p ->> 'from', '')::date; _to := NULLIF(_p ->> 'to', '')::date; EXCEPTION WHEN OTHERS THEN _from := NULL; _to := NULL; END;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT s.id, s.created_at, s.channel, s.category, s.subject, s.important, s.requested, s.recipients, s.excluded,
             (SELECT p.display_name FROM public.profiles p WHERE p.user_id = s.actor LIMIT 1) AS actor_name,
             (SELECT count(*) FROM public.admin_message_emails q WHERE q.direct_send = s.id AND q.status = 'sent') AS sent,
             (SELECT count(*) FROM public.admin_message_emails q WHERE q.direct_send = s.id AND q.status IN ('queued', 'sending')) AS queued,
             (SELECT count(*) FROM public.admin_message_emails q WHERE q.direct_send = s.id AND q.status = 'skipped') AS skipped,
             (SELECT count(*) FROM public.admin_message_emails q WHERE q.direct_send = s.id AND q.status = 'failed') AS failed,
             (SELECT count(*) FROM public.admin_direct_email_recipients r WHERE r.send_id = s.id AND r.notification_id IS NOT NULL) AS in_app
      FROM public.admin_direct_email_sends s
      WHERE (_q IS NULL OR s.subject ILIKE '%' || _q || '%')
        AND (_from IS NULL OR s.created_at >= _from)
        AND (_to IS NULL OR s.created_at < _to + 1)
      ORDER BY s.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE((_p ->> 'limit')::int, 50), 200))) x), '[]'::jsonb);
END
$$;
REVOKE ALL ON FUNCTION public.admin_direct_email_sends(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_direct_email_sends(jsonb) TO authenticated;

-- ------------------------------------------------------------------ send

-- _p: ids, channel, request_key, category, subject, summary, body, action_label, link, deadline, subject_ar, summary_ar,
-- body_ar, action_label_ar, context {kind: none | other, label, ref, status}, important, tests, confirmed, test (only me).
CREATE OR REPLACE FUNCTION public.admin_direct_email_send(_p jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _test boolean := COALESCE((_p ->> 'test')::boolean, false);
  _me uuid;
  _channel text := public.ade_channel(_p);
  _key text := btrim(COALESCE(_p ->> 'request_key', ''));
  _cat text := COALESCE(NULLIF(_p ->> 'category', ''), 'notice');
  _subject text := btrim(COALESCE(_p ->> 'subject', ''));
  _summary text := NULLIF(btrim(COALESCE(_p ->> 'summary', '')), '');
  _body text := btrim(COALESCE(_p ->> 'body', ''));
  _action text := NULLIF(btrim(COALESCE(_p ->> 'action_label', '')), '');
  _subject_ar text := NULLIF(btrim(COALESCE(_p ->> 'subject_ar', '')), '');
  _summary_ar text := NULLIF(btrim(COALESCE(_p ->> 'summary_ar', '')), '');
  _body_ar text := NULLIF(btrim(COALESCE(_p ->> 'body_ar', '')), '');
  _action_ar text := NULLIF(btrim(COALESCE(_p ->> 'action_label_ar', '')), '');
  _link text := NULLIF(btrim(COALESCE(_p ->> 'link', '')), '');
  _important boolean := COALESCE((_p ->> 'important')::boolean, false);
  _tests boolean := COALESCE((_p ->> 'tests')::boolean, false);
  _ctx_kind text := COALESCE(NULLIF(_p #>> '{context,kind}', ''), 'none');
  _ctx jsonb;
  _deadline date;
  _ids uuid[];
  _cap int := public.bm_setting_int('admin_direct_email_per_send_cap', 200, 1, 1000);
  _existing uuid;
  _send uuid;
  _n_recipients int;
  _n_excluded int;
  _queued int := 0;
  _ar boolean;
  _first text;
  _t text; _b text; _s text; _a text;
  _meta jsonb;
  _rid uuid; _nid uuid; _mid uuid;
  _all text;
  r record;
BEGIN
  _me := public.um_guard('users.message', CASE WHEN _test THEN 'direct_email_test' ELSE 'direct_email' END, CASE WHEN _test THEN 10 ELSE 20 END);
  IF NOT public.platform_flag('admin_direct_email_enabled', true) THEN RAISE EXCEPTION 'ade_switched_off' USING ERRCODE = '55000'; END IF;
  IF _channel <> 'in_app' AND NOT public.platform_flag('admin_messages_email_enabled', true) THEN
    RAISE EXCEPTION 'ade_email_off' USING ERRCODE = '55000';
  END IF;

  -- Content rules (same as admin_message_send, plus the optional Arabic version and no outside links in the text).
  IF _cat NOT IN ('notice', 'decision', 'action', 'reminder', 'update', 'welcome') THEN RAISE EXCEPTION 'ame_category' USING ERRCODE = '22023'; END IF;
  IF char_length(_subject) NOT BETWEEN 1 AND 120 OR char_length(_body) NOT BETWEEN 1 AND 4000
     OR char_length(COALESCE(_summary, '')) > 200 OR char_length(COALESCE(_action, '')) > 120
     OR char_length(COALESCE(_subject_ar, '')) > 120 OR char_length(COALESCE(_body_ar, '')) > 4000
     OR char_length(COALESCE(_summary_ar, '')) > 200 OR char_length(COALESCE(_action_ar, '')) > 120 THEN
    RAISE EXCEPTION 'ame_lengths' USING ERRCODE = '22023';
  END IF;
  IF (_subject_ar IS NULL) <> (_body_ar IS NULL) THEN RAISE EXCEPTION 'ade_arabic_incomplete' USING ERRCODE = '22023'; END IF;
  IF _link IS NOT NULL AND (_link !~ '^/[A-Za-z0-9/_?=&.#%-]*$' OR _link LIKE '//%' OR _link LIKE '%..%' OR char_length(_link) > 200) THEN
    RAISE EXCEPTION 'ame_link' USING ERRCODE = '22023';
  END IF;
  _all := concat_ws(' ', _subject, _summary, _body, _action, _subject_ar, _summary_ar, _body_ar, _action_ar);
  -- Web addresses in the text must be our own site (mirrors hasOutsideLink in src/lib/adminDirectEmail.ts).
  IF regexp_replace(_all, '(https?://)?(www\.)?aisupport360\.com(?![A-Za-z0-9-]|\.[A-Za-z0-9])', '', 'gi') ~* '(https?://|www\.)' THEN
    RAISE EXCEPTION 'ade_outside_link' USING ERRCODE = '22023';
  END IF;
  IF public.bm_has_secret(_all) THEN RAISE EXCEPTION 'ame_secret' USING ERRCODE = '22023'; END IF;
  IF NULLIF(_p ->> 'deadline', '') IS NOT NULL THEN
    BEGIN _deadline := (_p ->> 'deadline')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'ame_deadline' USING ERRCODE = '22023'; END;
    IF _deadline < current_date OR _deadline > current_date + 365 THEN RAISE EXCEPTION 'ame_deadline' USING ERRCODE = '22023'; END IF;
  END IF;
  -- Per-person items (ticket / agreement / invoice) belong to one person; a send to several only has a free-text item.
  IF _ctx_kind NOT IN ('none', 'other') THEN RAISE EXCEPTION 'ade_context_kind' USING ERRCODE = '22023'; END IF;
  _ctx := public.ame_context(_ctx_kind, _p #>> '{context,ref}', _me, _p #>> '{context,label}', _p #>> '{context,status}');

  IF _test THEN
    -- "Send test to me": the admin's own copy on the chosen channel, in their language, "[TEST]" e-mail subject.
    SELECT CASE WHEN p.preferred_language LIKE 'ar%' THEN 'ar' ELSE 'en' END INTO _t FROM public.profiles p WHERE p.user_id = _me LIMIT 1;
    _ar := COALESCE(_t, 'en') = 'ar' AND _subject_ar IS NOT NULL;
    _first := public.ade_first_name(_me);
    _t := public.ade_fill(CASE WHEN _ar THEN _subject_ar ELSE _subject END, _first, _link);
    _b := public.ade_fill(CASE WHEN _ar THEN _body_ar ELSE _body END, _first, _link);
    _s := NULLIF(public.ade_fill(CASE WHEN _ar THEN COALESCE(_summary_ar, _summary) ELSE _summary END, _first, _link), '');
    _a := NULLIF(public.ade_fill(CASE WHEN _ar THEN COALESCE(_action_ar, _action) ELSE _action END, _first, _link), '');
    _meta := jsonb_strip_nulls(jsonb_build_object('v', 1, 'category', _cat, 'summary', _s, 'context', _ctx, 'action_label', _a,
      'deadline', to_char(_deadline, 'YYYY-MM-DD'), 'direct', true, 'test', true));
    IF _channel <> 'email' THEN
      PERFORM set_config('app.ame_direct', 'yes', true);
      _nid := public.safe_insert_notification(_me, _t, _b, 'admin_message', _link);
      PERFORM set_config('app.ame_direct', '', true);
      UPDATE public.notifications SET meta = _meta WHERE id = _nid;
    END IF;
    IF _channel <> 'in_app' THEN
      INSERT INTO public.admin_message_emails (notification_id, recipient, actor, kind, is_test, important, include_tests, content)
      VALUES (COALESCE(_nid, gen_random_uuid()), _me, _me, 'comment', true, true, true,
              jsonb_build_object('title', _t, 'body', _b, 'link', _link, 'type', 'admin_message', 'meta', _meta))
      RETURNING id INTO _mid;
      PERFORM public.ame_wake();
    END IF;
    PERFORM public.um_audit(_me, 'direct_email_test', _me, NULL, jsonb_build_object('title', _subject, 'channel', _channel), NULL, '{}'::jsonb);
    RETURN jsonb_build_object('ok', true, 'test', true, 'in_app', _nid IS NOT NULL,
      'email', (SELECT jsonb_build_object('status', e.status, 'reason', e.reason) FROM public.admin_message_emails e WHERE e.id = _mid));
  END IF;

  IF char_length(_key) NOT BETWEEN 8 AND 80 THEN RAISE EXCEPTION 'ade_request_key' USING ERRCODE = '22023'; END IF;
  -- The same request again (double click, retry): show the first result, send nothing new.
  SELECT id INTO _existing FROM public.admin_direct_email_sends WHERE actor = _me AND request_key = _key;
  IF FOUND THEN RETURN public.admin_direct_email_report(_existing) || jsonb_build_object('repeated', true); END IF;
  IF NOT COALESCE((_p ->> 'confirmed')::boolean, false) THEN RAISE EXCEPTION 'ade_confirm' USING ERRCODE = '22023'; END IF;

  _ids := public.ade_ids(_p);
  CREATE TEMP TABLE IF NOT EXISTS _ade_s (user_id uuid, name text, email text, lang text, reason text, scope text) ON COMMIT DROP;
  TRUNCATE _ade_s;
  INSERT INTO _ade_s SELECT * FROM public.ade_targets(_ids, _channel, _important, _tests, _cat, _me);
  SELECT count(*) FILTER (WHERE scope IS DISTINCT FROM 'all'), count(*) FILTER (WHERE reason IS NOT NULL)
    INTO _n_recipients, _n_excluded FROM _ade_s;
  IF _n_recipients = 0 THEN RAISE EXCEPTION 'ade_nobody' USING ERRCODE = '22023'; END IF;
  IF _n_recipients > _cap THEN RAISE EXCEPTION 'ade_over_cap' USING ERRCODE = '22023', DETAIL = _cap::text; END IF;

  INSERT INTO public.admin_direct_email_sends (actor, request_key, channel, category, subject, content, important, include_tests, requested, recipients, excluded)
  VALUES (_me, _key, _channel, _cat, _subject,
          jsonb_strip_nulls(jsonb_build_object('summary', _summary, 'body', _body, 'action_label', _action, 'link', _link,
            'deadline', to_char(_deadline, 'YYYY-MM-DD'), 'context', _ctx, 'subject_ar', _subject_ar, 'summary_ar', _summary_ar,
            'body_ar', _body_ar, 'action_label_ar', _action_ar)),
          _important, _tests, cardinality(_ids), _n_recipients, _n_excluded)
  RETURNING id INTO _send;

  -- Own queue rows below: the notifications trigger must not add its list rule ("> 5 = in-app only") to this send.
  PERFORM set_config('app.ame_direct', 'yes', true);
  FOR r IN SELECT * FROM _ade_s ORDER BY name NULLS LAST LOOP
    _rid := gen_random_uuid(); _nid := NULL; _mid := NULL;
    IF r.scope = 'all' THEN
      -- Nothing for this person. E-mail exclusions are also logged in the shared queue history (not for unknown,
      -- removed or own accounts, which have no person to show).
      IF _channel <> 'in_app' AND r.reason NOT IN ('not_found', 'self', 'deleted_or_merged') THEN
        INSERT INTO public.admin_message_emails (notification_id, recipient, actor, kind, important, include_tests, status, reason,
          finished_at, direct_send, content)
        VALUES (_rid, r.user_id, _me, 'comment', _important, _tests, 'skipped', r.reason, now(), _send,
                jsonb_build_object('title', _subject, 'body', '', 'link', _link, 'type', 'admin_message', 'meta', jsonb_build_object('v', 1, 'category', _cat, 'direct', true)))
        RETURNING id INTO _mid;
      END IF;
      INSERT INTO public.admin_direct_email_recipients (id, send_id, recipient, lang, mail_id, reason)
      VALUES (_rid, _send, r.user_id, COALESCE(r.lang, 'en'), _mid, r.reason);
      CONTINUE;
    END IF;

    _ar := r.lang = 'ar' AND _subject_ar IS NOT NULL;
    _first := public.ade_first_name(r.user_id);
    _t := public.ade_fill(CASE WHEN _ar THEN _subject_ar ELSE _subject END, _first, _link);
    _b := public.ade_fill(CASE WHEN _ar THEN _body_ar ELSE _body END, _first, _link);
    _s := NULLIF(public.ade_fill(CASE WHEN _ar THEN COALESCE(_summary_ar, _summary) ELSE _summary END, _first, _link), '');
    _a := NULLIF(public.ade_fill(CASE WHEN _ar THEN COALESCE(_action_ar, _action) ELSE _action END, _first, _link), '');
    _meta := jsonb_strip_nulls(jsonb_build_object('v', 1, 'category', _cat, 'summary', _s, 'context', _ctx, 'action_label', _a,
      'deadline', to_char(_deadline, 'YYYY-MM-DD'), 'direct', true));

    IF _channel <> 'email' THEN
      _nid := public.safe_insert_notification(r.user_id, _t, _b, 'admin_message', _link);
      UPDATE public.notifications SET meta = _meta WHERE id = _nid;
    END IF;
    IF _channel <> 'in_app' THEN
      INSERT INTO public.admin_message_emails (notification_id, recipient, actor, kind, important, include_tests, status, reason,
        finished_at, direct_send, content)
      VALUES (COALESCE(_nid, _rid), r.user_id, _me, 'comment', _important, _tests,
              CASE WHEN r.reason IS NULL THEN 'queued' ELSE 'skipped' END, r.reason, CASE WHEN r.reason IS NOT NULL THEN now() END, _send,
              jsonb_build_object('title', _t, 'body', _b, 'link', _link, 'type', 'admin_message', 'meta', _meta,
                'pause_category', CASE WHEN _important THEN 'essential' ELSE public.ade_pause_category(_cat) END))
      RETURNING id INTO _mid;
      IF r.reason IS NULL THEN _queued := _queued + 1; END IF;
    END IF;
    INSERT INTO public.admin_direct_email_recipients (id, send_id, recipient, lang, notification_id, mail_id, reason)
    VALUES (_rid, _send, r.user_id, COALESCE(r.lang, 'en'), _nid, _mid, r.reason);
  END LOOP;
  PERFORM set_config('app.ame_direct', '', true);

  IF _queued > 0 THEN PERFORM public.ame_wake(); END IF;
  PERFORM public.um_audit(_me, 'direct_email', NULL, NULL,
    jsonb_build_object('subject', _subject, 'category', _cat, 'channel', _channel, 'recipients', _n_recipients, 'excluded', _n_excluded,
      'queued_emails', _queued, 'important', _important),
    NULL, jsonb_build_object('send_id', _send, 'requested', cardinality(_ids)));
  RETURN public.admin_direct_email_report(_send) || jsonb_build_object('repeated', false);
END
$$;
REVOKE ALL ON FUNCTION public.admin_direct_email_send(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_direct_email_send(jsonb) TO authenticated;

-- ------------------------------------------------------------------ redefinitions of the shared mechanism

-- ame_capture: newest body. Unchanged from docs/sql/admin-message-email.sql except the first check: direct sends
-- (app.ame_direct) write their own queue rows.
CREATE OR REPLACE FUNCTION public.ame_capture()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _actor uuid := auth.uid();
  _hdr text := '';
BEGIN
  IF current_setting('app.ame_direct', true) = 'yes' THEN RETURN NULL; END IF;
  IF _actor IS NULL OR NEW.user_id IS NULL OR NEW.user_id = _actor THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role IN ('admin', 'super_admin')) THEN RETURN NULL; END IF;
  -- admin_message_send and decisions pass the choice in app.ame_choice; other admin screens send the x-admin-email header.
  _hdr := lower(COALESCE(NULLIF(current_setting('app.ame_choice', true), ''), ''));
  IF _hdr = '' THEN
    BEGIN
      _hdr := lower(COALESCE(current_setting('request.headers', true)::json ->> 'x-admin-email', ''));
    EXCEPTION WHEN OTHERS THEN _hdr := '';
    END;
  END IF;
  PERFORM public.ame_enqueue(NEW.id, NEW.user_id, NEW.type, NEW.delivery_status, _actor, _hdr);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin message e-mail capture skipped: %', SQLERRM;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.ame_capture() FROM PUBLIC, anon, authenticated;

-- ame_claim: newest body. Changes against docs/sql/admin-message-email.sql: rows with their own content (direct sends,
-- e-mail only) are mailed from that content (and its quiet-pause group) and are not "notification removed"; direct
-- rows over the daily cap wait
-- for the next day instead of being skipped.
CREATE OR REPLACE FUNCTION public.ame_claim(_limit integer DEFAULT 50)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _cap int := public.bm_setting_int('admin_messages_email_daily_cap', 300, 1, 5000);
  _per_rcpt int := public.bm_setting_int('admin_messages_email_per_recipient_hour', 5, 1, 50);
  _per_admin int := public.bm_setting_int('admin_messages_email_per_admin_hour', 60, 1, 1000);
  _out jsonb := '[]'::jsonb;
  _today int;
  _hour int;
  _first timestamptz;
  _ids uuid[];
  _key text;
  _email text;
  _confirmed timestamptz;
  _lang text;
  r record;
BEGIN
  UPDATE public.admin_message_emails SET status = 'queued', lease_until = NULL
  WHERE status = 'sending' AND lease_until < now();
  UPDATE public.admin_message_emails SET status = 'failed', reason = 'too_many_attempts', finished_at = now()
  WHERE status = 'queued' AND attempts >= 5;

  IF NOT public.platform_flag('admin_messages_email_enabled', true) THEN
    UPDATE public.admin_message_emails SET status = 'skipped', reason = 'switched_off', finished_at = now() WHERE status = 'queued';
    PERFORM public.ame_arm();
    RETURN _out;
  END IF;

  -- Admins over their hourly limit wait 10 minutes.
  UPDATE public.admin_message_emails q SET send_after = now() + interval '10 minutes'
  WHERE q.status = 'queued' AND q.send_after <= now()
    AND (SELECT count(DISTINCT e.mail_key) FROM public.admin_message_emails e
         WHERE e.actor = q.actor AND e.status IN ('sending', 'sent') AND e.claimed_at > now() - interval '1 hour') >= _per_admin;

  FOR r IN
    SELECT q.recipient, min(q.created_at) AS first_at FROM public.admin_message_emails q
    WHERE q.status = 'queued' AND q.send_after <= now()
    GROUP BY q.recipient ORDER BY min(q.created_at) LIMIT GREATEST(1, LEAST(_limit, 100))
  LOOP
    SELECT count(DISTINCT e.mail_key) INTO _today FROM public.admin_message_emails e
    WHERE e.status IN ('sending', 'sent') AND e.claimed_at >= date_trunc('day', now());
    IF _today >= _cap THEN
      -- Direct sends wait for tomorrow (the admin chose these people); other admin messages are skipped as before.
      UPDATE public.admin_message_emails SET send_after = date_trunc('day', now()) + interval '1 day' + interval '5 minutes'
      WHERE status = 'queued' AND send_after <= now() AND direct_send IS NOT NULL;
      UPDATE public.admin_message_emails SET status = 'skipped', reason = 'daily_cap_reached', finished_at = now()
      WHERE status = 'queued' AND send_after <= now();
      EXIT;
    END IF;

    SELECT u.email, u.email_confirmed_at INTO _email, _confirmed FROM auth.users u WHERE u.id = r.recipient;
    IF _email IS NULL OR _confirmed IS NULL THEN
      UPDATE public.admin_message_emails SET status = 'skipped', finished_at = now(),
        reason = CASE WHEN _email IS NULL THEN 'no_email' ELSE 'email_not_confirmed' END
      WHERE recipient = r.recipient AND status = 'queued' AND send_after <= now();
      CONTINUE;
    END IF;

    -- Quiet pauses are respected unless the admin ticked "important" (essential notices are never paused).
    UPDATE public.admin_message_emails q SET status = 'skipped', reason = 'paused', finished_at = now()
    WHERE q.recipient = r.recipient AND q.status = 'queued' AND q.send_after <= now() AND NOT q.important
      AND public.notifications_paused(q.recipient, COALESCE(q.content ->> 'pause_category',
            (SELECT COALESCE(n.pause_category, public.notification_category(n.type, n.title)) FROM public.notifications n WHERE n.id = q.notification_id),
            public.notification_category(COALESCE(q.content ->> 'type', 'admin_message'), q.content ->> 'title')), 'email');
    -- Deleted notifications are not mailed (rows with their own content do not depend on a notification).
    UPDATE public.admin_message_emails q SET status = 'skipped', reason = 'notification_removed', finished_at = now()
    WHERE q.recipient = r.recipient AND q.status = 'queued' AND q.send_after <= now() AND q.content IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.id = q.notification_id);

    SELECT array_agg(q.id ORDER BY q.created_at) INTO _ids FROM (
      SELECT id, created_at FROM public.admin_message_emails
      WHERE recipient = r.recipient AND status = 'queued' AND send_after <= now()
      ORDER BY created_at LIMIT 20) q;
    IF _ids IS NULL THEN CONTINUE; END IF;

    SELECT count(DISTINCT e.mail_key), min(e.claimed_at) INTO _hour, _first FROM public.admin_message_emails e
    WHERE e.recipient = r.recipient AND e.status IN ('sending', 'sent') AND e.claimed_at > now() - interval '1 hour';
    IF _hour >= _per_rcpt THEN
      -- Held: these go out together as one digest when the hour has passed.
      UPDATE public.admin_message_emails SET send_after = _first + interval '1 hour' + interval '1 minute' WHERE id = ANY (_ids);
      CONTINUE;
    END IF;

    SELECT CASE WHEN p.preferred_language LIKE 'ar%' THEN 'ar' ELSE 'en' END INTO _lang
    FROM public.profiles p WHERE p.user_id = r.recipient LIMIT 1;

    IF cardinality(_ids) <= _per_rcpt - _hour THEN
      -- One e-mail per message.
      FOR i IN 1 .. cardinality(_ids) LOOP
        _key := 'admin-message-' || _ids[i]::text;
        UPDATE public.admin_message_emails SET status = 'sending', attempts = attempts + 1, digest = false,
          mail_key = _key, claimed_at = now(), lease_until = now() + interval '10 minutes'
        WHERE id = _ids[i];
        _out := _out || jsonb_build_array(jsonb_build_object('mail_key', _key, 'recipient', r.recipient, 'email', _email,
          'lang', COALESCE(_lang, 'en'), 'digest', false,
          'important', (SELECT q.important FROM public.admin_message_emails q WHERE q.id = _ids[i]),
          'test', (SELECT q.is_test FROM public.admin_message_emails q WHERE q.id = _ids[i]),
          'items', (SELECT jsonb_agg(jsonb_build_object('id', q.id,
                      'title', COALESCE(q.content ->> 'title', n.title), 'body', COALESCE(q.content ->> 'body', n.body),
                      'link', CASE WHEN q.content IS NOT NULL THEN q.content ->> 'link' ELSE n.link END,
                      'type', COALESCE(q.content ->> 'type', n.type), 'kind', q.kind, 'meta', COALESCE(q.content -> 'meta', n.meta),
                      'created_at', COALESCE(n.created_at, q.created_at)))
                    FROM public.admin_message_emails q LEFT JOIN public.notifications n ON n.id = q.notification_id WHERE q.id = _ids[i])));
      END LOOP;
    ELSE
      -- Beyond the hourly allowance: one digest e-mail for everything waiting.
      _key := 'admin-message-digest-' || _ids[1]::text;
      UPDATE public.admin_message_emails SET status = 'sending', attempts = attempts + 1, digest = true,
        mail_key = _key, claimed_at = now(), lease_until = now() + interval '10 minutes'
      WHERE id = ANY (_ids);
      _out := _out || jsonb_build_array(jsonb_build_object('mail_key', _key, 'recipient', r.recipient, 'email', _email,
        'lang', COALESCE(_lang, 'en'), 'digest', true,
        'important', (SELECT bool_or(q.important) FROM public.admin_message_emails q WHERE q.id = ANY (_ids)),
        'test', (SELECT bool_and(q.is_test) FROM public.admin_message_emails q WHERE q.id = ANY (_ids)),
        'items', (SELECT jsonb_agg(jsonb_build_object('id', q.id,
                    'title', COALESCE(q.content ->> 'title', n.title), 'body', COALESCE(q.content ->> 'body', n.body),
                    'link', CASE WHEN q.content IS NOT NULL THEN q.content ->> 'link' ELSE n.link END,
                    'type', COALESCE(q.content ->> 'type', n.type), 'kind', q.kind, 'meta', COALESCE(q.content -> 'meta', n.meta),
                    'created_at', COALESCE(n.created_at, q.created_at)) ORDER BY q.created_at)
                  FROM public.admin_message_emails q LEFT JOIN public.notifications n ON n.id = q.notification_id WHERE q.id = ANY (_ids))));
    END IF;
  END LOOP;
  PERFORM public.ame_arm();
  RETURN _out;
END
$$;
REVOKE ALL ON FUNCTION public.ame_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ame_claim(integer) TO service_role;

-- admin_message_email_log: newest body (subject also from rows with their own content).
CREATE OR REPLACE FUNCTION public.admin_message_email_log(_user uuid DEFAULT NULL, _limit integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT q.id, q.notification_id, q.recipient, q.kind, q.important, q.digest, q.status, q.reason, q.attempts,
             q.created_at, q.finished_at, q.send_after, left(COALESCE(n.title, q.content ->> 'title'), 120) AS title,
             (q.direct_send IS NOT NULL) AS direct,
             (SELECT p.display_name FROM public.profiles p WHERE p.user_id = q.recipient LIMIT 1) AS recipient_name,
             (SELECT p.display_name FROM public.profiles p WHERE p.user_id = q.actor LIMIT 1) AS actor_name
      FROM public.admin_message_emails q LEFT JOIN public.notifications n ON n.id = q.notification_id
      WHERE _user IS NULL OR q.recipient = _user
      ORDER BY q.created_at DESC LIMIT GREATEST(1, LEAST(COALESCE(_limit, 30), 100))) x), '[]'::jsonb);
END
$$;
REVOKE ALL ON FUNCTION public.admin_message_email_log(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_message_email_log(uuid, integer) TO authenticated;

-- admin_message_history: newest body. Adds direct sends (content rows), the channel ('both', 'in_app' = e-mail
-- skipped, 'email' = e-mail only, 'none' = e-mail only and skipped), direct_send, and the filter _p.direct (true).
CREATE OR REPLACE FUNCTION public.admin_message_history(_p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _q text := NULLIF(btrim(COALESCE(_p ->> 'q', '')), '');
  _cat text := NULLIF(_p ->> 'category', '');
  _st text := NULLIF(_p ->> 'status', '');
  _direct boolean := COALESCE((_p ->> 'direct')::boolean, false);
  _from date; _to date;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  BEGIN _from := NULLIF(_p ->> 'from', '')::date; _to := NULLIF(_p ->> 'to', '')::date; EXCEPTION WHEN OTHERS THEN _from := NULL; _to := NULL; END;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT q.id, q.notification_id, q.created_at, q.recipient, q.kind, q.important, q.is_test, q.digest, q.status, q.reason,
             q.send_after, left(COALESCE(n.title, q.content ->> 'title'), 120) AS subject,
             public.ame_category(COALESCE(n.type, q.content ->> 'type'), COALESCE(n.meta, q.content -> 'meta')) AS category,
             COALESCE(n.is_read, false) AS is_read, (n.id IS NOT NULL) AS in_app,
             CASE WHEN n.id IS NULL AND q.content IS NOT NULL THEN CASE WHEN q.status = 'skipped' THEN 'none' ELSE 'email' END
                  WHEN q.status = 'skipped' THEN 'in_app' ELSE 'both' END AS channel,
             q.direct_send, n.meta #>> '{decision,outcome}' AS decision,
             rp.display_name AS recipient_name, ap.display_name AS actor_name
      FROM public.admin_message_emails q
      LEFT JOIN public.notifications n ON n.id = q.notification_id
      LEFT JOIN LATERAL (SELECT p.display_name FROM public.profiles p WHERE p.user_id = q.recipient LIMIT 1) rp ON true
      LEFT JOIN LATERAL (SELECT p.display_name FROM public.profiles p WHERE p.user_id = q.actor LIMIT 1) ap ON true
      WHERE (_q IS NULL OR COALESCE(n.title, q.content ->> 'title') ILIKE '%' || _q || '%' OR rp.display_name ILIKE '%' || _q || '%')
        AND (_cat IS NULL OR public.ame_category(COALESCE(n.type, q.content ->> 'type'), COALESCE(n.meta, q.content -> 'meta')) = _cat)
        AND (_st IS NULL OR q.status = _st)
        AND (NOT _direct OR q.direct_send IS NOT NULL)
        AND (_from IS NULL OR q.created_at >= _from)
        AND (_to IS NULL OR q.created_at < _to + 1)
      ORDER BY q.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE((_p ->> 'limit')::int, 200), 500))) x), '[]'::jsonb);
END
$$;
REVOKE ALL ON FUNCTION public.admin_message_history(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_message_history(jsonb) TO authenticated;
