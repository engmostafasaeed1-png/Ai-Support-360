-- Feature Q: pause / snooze notifications (3 days, 1 week, 1 month) for every user.
-- PREPARED ONLY: the owner applies this file. Safe to run twice (IF NOT EXISTS / CREATE OR REPLACE / ON CONFLICT DO NOTHING).
-- Uses live objects: notifications, platform_settings, platform_flag, has_role, check_rate_limit, consultants,
-- consultant_unavailable_periods (Feature M), ticket_match_requests, pg_cron; assignment_user_lang is probed with to_regprocedure.
--
-- One server-side gate: public.notifications_paused(user, category, channel).
--   * notifications BEFORE INSERT trigger: stores the category; paused users get the row silently (no popup / sound),
--     or held until the pause ends when they chose to hold in-app notices too.
--   * e-mail: every sending edge function goes through sendTemplateEmail -> notification_email_check -> notifications_paused.
--   * assignment and profile reminder claims: their e-mails pass the same gate; their in-app notices pass the trigger.
-- Never paused (category 'essential'): security / sign-in, payments, invoices, payouts, legal, NDA, rate and engagement
-- confirmations, policy notices, account notices, Critical alarms and the first notice of each assignment request.

-- --------------------------------------------------------------- settings (admin editable)
INSERT INTO public.platform_settings (key, value) VALUES
  ('notification_pause_enabled', 'true'::jsonb),
  ('notification_pause_max_days', '30'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- --------------------------------------------------------------- notifications: category, silent, held
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS pause_category TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS silent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS held_until TIMESTAMPTZ;
COMMENT ON COLUMN public.notifications.silent IS 'Feature Q: stored while the user paused in-app alerts; shown in the bell without popup or sound.';
COMMENT ON COLUMN public.notifications.held_until IS 'Feature Q: hidden from the bell until this time (user chose to hold in-app notices).';
CREATE INDEX IF NOT EXISTS notifications_held_idx ON public.notifications (user_id, held_until) WHERE held_until IS NOT NULL;

-- --------------------------------------------------------------- tables
CREATE TABLE IF NOT EXISTS public.user_notification_pauses (
  user_id UUID PRIMARY KEY,
  paused_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_until TIMESTAMPTZ NOT NULL,
  duration TEXT NOT NULL CHECK (duration IN ('3d', '1w', '1m')),
  email BOOLEAN NOT NULL DEFAULT true,
  in_app BOOLEAN NOT NULL DEFAULT true,
  categories TEXT[] NOT NULL DEFAULT ARRAY['reminders', 'digests', 'activity'],
  hold_in_app BOOLEAN NOT NULL DEFAULT false,
  mark_unavailable BOOLEAN NOT NULL DEFAULT false,
  unavailable_period_id UUID,
  source TEXT NOT NULL DEFAULT 'settings' CHECK (source IN ('settings', 'bell', 'email')),
  back_notice_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_notification_pauses_channel CHECK (email OR in_app),
  CONSTRAINT user_notification_pauses_categories CHECK (
    cardinality(categories) > 0 AND categories <@ ARRAY['reminders', 'digests', 'activity']::TEXT[])
);
CREATE INDEX IF NOT EXISTS user_notification_pauses_until_idx ON public.user_notification_pauses (paused_until) WHERE back_notice_at IS NULL;

GRANT SELECT ON public.user_notification_pauses TO authenticated;
GRANT ALL ON public.user_notification_pauses TO service_role;
ALTER TABLE public.user_notification_pauses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own notification pause" ON public.user_notification_pauses;
CREATE POLICY "Users read own notification pause" ON public.user_notification_pauses
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Writes only through the SECURITY DEFINER functions below.

-- Audit of pause / resume / expiry (user initiated; no addresses, no content).
CREATE TABLE IF NOT EXISTS public.notification_pause_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('pause', 'resume', 'expire', 'unsubscribe', 'unavailable')),
  duration TEXT,
  paused_until TIMESTAMPTZ,
  source TEXT NOT NULL CHECK (source IN ('settings', 'bell', 'email', 'system')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_pause_events_user_idx ON public.notification_pause_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_pause_events_created_idx ON public.notification_pause_events (created_at DESC);

GRANT SELECT ON public.notification_pause_events TO authenticated;
GRANT ALL ON public.notification_pause_events TO service_role;
ALTER TABLE public.notification_pause_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own pause events" ON public.notification_pause_events;
CREATE POLICY "Users read own pause events" ON public.notification_pause_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Admins read pause events" ON public.notification_pause_events;
CREATE POLICY "Admins read pause events" ON public.notification_pause_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- One row per used e-mail link (nonce): makes every link click idempotent. Service role only.
CREATE TABLE IF NOT EXISTS public.notification_pause_link_uses (
  nonce TEXT PRIMARY KEY CHECK (nonce ~ '^[0-9a-f]{16}$'),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  paused_until TIMESTAMPTZ,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT ALL ON public.notification_pause_link_uses TO service_role;
ALTER TABLE public.notification_pause_link_uses ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------- helpers
CREATE OR REPLACE FUNCTION public.notification_pause_max_days()
RETURNS INT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _v JSONB; _n INT;
BEGIN
  SELECT value INTO _v FROM public.platform_settings WHERE key = 'notification_pause_max_days';
  BEGIN _n := round((_v #>> '{}')::NUMERIC)::INT; EXCEPTION WHEN OTHERS THEN _n := NULL; END;
  IF _n IS NULL OR _n <= 0 THEN RETURN 30; END IF;
  RETURN LEAST(90, GREATEST(1, _n));
END $$;

CREATE OR REPLACE FUNCTION public.notification_pause_days(_duration TEXT)
RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _duration WHEN '3d' THEN 3 WHEN '1w' THEN 7 WHEN '1m' THEN 30 END
$$;

-- Mirror: supabase/functions/_shared/notificationPause.ts notificationCategory (checked by tests on both sides).
CREATE OR REPLACE FUNCTION public.notification_category(_type TEXT, _title TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN COALESCE(btrim(_type), '') IN ('critical_request', 'payment', 'invoice', 'payout', 'nda', 'rate', 'engagement',
      'security_alert', 'security', 'approval', 'system', 'admin_message', 'policy', 'policy_reminder', 'admin_reminder_policy',
      'consultant_policy', 'account', 'responsiveness', 'notifications_resumed') THEN 'essential'
    WHEN COALESCE(btrim(_type), '') LIKE 'admin\_reminder\_%' OR btrim(_type) IN ('profile_reminder', 'reminder') THEN 'reminders'
    WHEN btrim(COALESCE(_title, '')) ~* '^(reminder|تذكير)' THEN 'reminders'
    WHEN btrim(_type) IN ('digest', 'admin') THEN 'digests'
    WHEN btrim(_type) = 'match_request' THEN
      CASE WHEN btrim(COALESCE(_title, '')) ~* '^(no reply|request closed|لا يوجد رد|انتهى وقت)' THEN 'activity' ELSE 'essential' END
    WHEN COALESCE(btrim(_type), '') = '' AND btrim(COALESCE(_title, '')) IN ('Complete your profile', 'أكمل ملفك الشخصي') THEN 'reminders'
    ELSE 'activity'
  END
$$;

-- THE gate. Essential notices are never paused; push / Telegram follow the in-app choice.
CREATE OR REPLACE FUNCTION public.notifications_paused(_user_id UUID, _category TEXT, _channel TEXT DEFAULT 'email')
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _user_id IS NULL OR COALESCE(_category, 'essential') NOT IN ('reminders', 'digests', 'activity') THEN false
    WHEN NOT public.platform_flag('notification_pause_enabled', true) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.user_notification_pauses p
       WHERE p.user_id = _user_id AND p.paused_until > now() AND _category = ANY (p.categories)
         AND CASE WHEN COALESCE(_channel, 'email') = 'email' THEN p.email ELSE p.in_app END)
  END
$$;

-- Used by sendTemplateEmail: is this e-mail held, and may it carry the signed pause footer?
CREATE OR REPLACE FUNCTION public.notification_email_check(_user_id UUID, _category TEXT)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'paused', public.notifications_paused(_user_id, _category, 'email'),
    'links', public.platform_flag('notification_pause_enabled', true) AND COALESCE(_category, 'essential') IN ('reminders', 'digests', 'activity'))
$$;

-- --------------------------------------------------------------- notifications insert trigger
CREATE OR REPLACE FUNCTION public.notifications_apply_pause()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _hold BOOLEAN; _until TIMESTAMPTZ; _rid TEXT;
BEGIN
  BEGIN
    NEW.pause_category := COALESCE(NEW.pause_category, public.notification_category(NEW.type, NEW.title));
    -- Reminders of a Critical assignment request stay essential (Critical alarms are never paused).
    IF NEW.pause_category = 'reminders' AND NEW.type = 'match_request' THEN
      _rid := substring(COALESCE(NEW.link, '') FROM 'request=([0-9a-fA-F-]{36})');
      IF _rid IS NOT NULL AND EXISTS (SELECT 1 FROM public.ticket_match_requests q WHERE q.id = _rid::UUID AND q.is_critical IS TRUE) THEN
        NEW.pause_category := 'essential';
      END IF;
    END IF;
    IF public.notifications_paused(NEW.user_id, NEW.pause_category, 'in_app') THEN
      SELECT p.hold_in_app, p.paused_until INTO _hold, _until FROM public.user_notification_pauses p WHERE p.user_id = NEW.user_id;
      NEW.silent := true;
      IF _hold THEN NEW.held_until := _until; END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RETURN NEW; -- a pause lookup must never block a notification
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_zz_notification_pause ON public.notifications;
CREATE TRIGGER trg_zz_notification_pause BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_apply_pause();

-- --------------------------------------------------------------- state
CREATE OR REPLACE FUNCTION public.notification_pause_state(_user_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'enabled', public.platform_flag('notification_pause_enabled', true),
    'max_days', public.notification_pause_max_days(),
    'is_consultant', EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = _user_id),
    'pause', (SELECT jsonb_build_object('paused_from', p.paused_from, 'paused_until', p.paused_until, 'duration', p.duration,
                'email', p.email, 'in_app', p.in_app, 'categories', to_jsonb(p.categories), 'hold_in_app', p.hold_in_app,
                'mark_unavailable', p.mark_unavailable, 'source', p.source)
                FROM public.user_notification_pauses p WHERE p.user_id = _user_id AND p.paused_until > now()))
$$;

-- Internal: start (or replace) a pause. Consultants may also be marked unavailable for the same period (Feature M
-- excludes requests that arrive while unavailable); otherwise requests keep counting normally.
CREATE OR REPLACE FUNCTION public.notification_pause_apply(
  _user_id UUID, _duration TEXT, _email BOOLEAN, _in_app BOOLEAN, _categories TEXT[], _hold_in_app BOOLEAN,
  _mark_unavailable BOOLEAN, _source TEXT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _days INT; _until TIMESTAMPTZ; _old public.user_notification_pauses; _cid UUID; _pid UUID;
BEGIN
  _days := public.notification_pause_days(_duration);
  IF _days IS NULL THEN RAISE EXCEPTION 'Choose 3 days, 1 week or 1 month.' USING ERRCODE = '22023'; END IF;
  _until := now() + make_interval(days => LEAST(_days, public.notification_pause_max_days()));
  SELECT * INTO _old FROM public.user_notification_pauses WHERE user_id = _user_id FOR UPDATE;
  IF FOUND AND _old.unavailable_period_id IS NOT NULL THEN
    UPDATE public.consultant_unavailable_periods SET ends_at = LEAST(ends_at, now()), updated_at = now()
     WHERE id = _old.unavailable_period_id AND ends_at > now();
  END IF;
  IF _mark_unavailable THEN
    SELECT c.id INTO _cid FROM public.consultants c WHERE c.user_id = _user_id LIMIT 1;
    IF _cid IS NOT NULL THEN
      INSERT INTO public.consultant_unavailable_periods (consultant_id, starts_at, ends_at, reason)
      VALUES (_cid, now(), _until, 'Notifications paused') RETURNING id INTO _pid;
    END IF;
  END IF;
  INSERT INTO public.user_notification_pauses AS p (user_id, paused_from, paused_until, duration, email, in_app, categories,
    hold_in_app, mark_unavailable, unavailable_period_id, source, back_notice_at, updated_at)
  VALUES (_user_id, now(), _until, _duration, _email, _in_app, _categories, _hold_in_app, _pid IS NOT NULL, _pid, _source, NULL, now())
  ON CONFLICT (user_id) DO UPDATE SET paused_from = now(), paused_until = EXCLUDED.paused_until, duration = EXCLUDED.duration,
    email = EXCLUDED.email, in_app = EXCLUDED.in_app, categories = EXCLUDED.categories, hold_in_app = EXCLUDED.hold_in_app,
    mark_unavailable = EXCLUDED.mark_unavailable, unavailable_period_id = EXCLUDED.unavailable_period_id,
    source = EXCLUDED.source, back_notice_at = NULL, updated_at = now();
  -- Notices held by an earlier pause become visible again; the new pause holds only what arrives from now on.
  UPDATE public.notifications SET held_until = NULL WHERE user_id = _user_id AND held_until IS NOT NULL;
  INSERT INTO public.notification_pause_events (user_id, action, duration, paused_until, source)
  VALUES (_user_id, 'pause', _duration, _until, _source);
  RETURN _until;
END $$;

-- Internal: end a pause now (resume) or at its end (expire). Only expiry sends "Your notifications are back".
CREATE OR REPLACE FUNCTION public.notification_pause_end(_user_id UUID, _action TEXT, _source TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p public.user_notification_pauses; _ar BOOLEAN := false;
BEGIN
  SELECT * INTO _p FROM public.user_notification_pauses WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND OR _p.back_notice_at IS NOT NULL OR (_action = 'resume' AND _p.paused_until <= now())
     OR (_action = 'expire' AND _p.paused_until > now()) THEN
    RETURN false;
  END IF;
  IF _p.unavailable_period_id IS NOT NULL THEN
    UPDATE public.consultant_unavailable_periods SET ends_at = LEAST(ends_at, now()), updated_at = now()
     WHERE id = _p.unavailable_period_id AND ends_at > now();
  END IF;
  UPDATE public.user_notification_pauses
     SET paused_until = LEAST(paused_until, now()), back_notice_at = now(), unavailable_period_id = NULL, updated_at = now()
   WHERE user_id = _user_id;
  UPDATE public.notifications SET held_until = NULL WHERE user_id = _user_id AND held_until IS NOT NULL;
  INSERT INTO public.notification_pause_events (user_id, action, duration, paused_until, source)
  VALUES (_user_id, _action, _p.duration, LEAST(_p.paused_until, now()), _source);
  IF _action = 'expire' THEN
    IF to_regprocedure('public.assignment_user_lang(uuid)') IS NOT NULL THEN
      BEGIN EXECUTE 'SELECT public.assignment_user_lang($1) = ''ar''' INTO _ar USING _user_id; EXCEPTION WHEN OTHERS THEN _ar := false; END;
    END IF;
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (_user_id,
      CASE WHEN _ar THEN 'عادت إشعاراتك' ELSE 'Your notifications are back' END,
      CASE WHEN _ar THEN 'انتهى الإيقاف المؤقت. ستصلك الرسائل والتنبيهات كالمعتاد. يمكنك الإيقاف مرة أخرى من الإعدادات.'
           ELSE 'Your pause has ended. E-mails and alerts arrive as usual again. You can pause again in your settings.' END,
      'notifications_resumed', NULL);
  END IF;
  RETURN true;
END $$;

-- --------------------------------------------------------------- signed-in user API
CREATE OR REPLACE FUNCTION public.my_notification_pause()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Please sign in.' USING ERRCODE = '42501'; END IF;
  RETURN public.notification_pause_state(auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.pause_my_notifications(
  _duration TEXT, _email BOOLEAN DEFAULT true, _in_app BOOLEAN DEFAULT true,
  _categories TEXT[] DEFAULT ARRAY['reminders', 'digests', 'activity'], _hold_in_app BOOLEAN DEFAULT false,
  _mark_unavailable BOOLEAN DEFAULT false, _source TEXT DEFAULT 'settings')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid(); _cats TEXT[];
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Please sign in.' USING ERRCODE = '42501'; END IF;
  IF NOT public.platform_flag('notification_pause_enabled', true) THEN
    RAISE EXCEPTION 'Pausing notifications is switched off by the administrators.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('npause:' || _uid::TEXT, 20, 3600) THEN
    RAISE EXCEPTION 'Too many changes. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  IF public.notification_pause_days(_duration) IS NULL THEN
    RAISE EXCEPTION 'Choose 3 days, 1 week or 1 month.' USING ERRCODE = '22023';
  END IF;
  IF public.notification_pause_days(_duration) > public.notification_pause_max_days() THEN
    RAISE EXCEPTION 'This pause is longer than the platform allows.' USING ERRCODE = '22023';
  END IF;
  IF NOT (COALESCE(_email, false) OR COALESCE(_in_app, false)) THEN
    RAISE EXCEPTION 'Choose e-mails, in-app alerts or both.' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT c ORDER BY c) INTO _cats FROM unnest(COALESCE(_categories, '{}'::TEXT[])) c
   WHERE c IN ('reminders', 'digests', 'activity');
  IF _cats IS NULL OR cardinality(_cats) <> (SELECT count(DISTINCT c) FROM unnest(_categories) c) THEN
    RAISE EXCEPTION 'Choose at least one kind of notification.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(_source, 'settings') NOT IN ('settings', 'bell') THEN
    RAISE EXCEPTION 'Unknown source.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.notification_pause_apply(_uid, _duration, COALESCE(_email, false), COALESCE(_in_app, false), _cats,
    COALESCE(_hold_in_app, false), COALESCE(_mark_unavailable, false), COALESCE(_source, 'settings'));
  RETURN public.notification_pause_state(_uid);
END $$;

CREATE OR REPLACE FUNCTION public.resume_my_notifications(_source TEXT DEFAULT 'settings')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Please sign in.' USING ERRCODE = '42501'; END IF;
  IF NOT public.check_rate_limit('npause:' || _uid::TEXT, 20, 3600) THEN
    RAISE EXCEPTION 'Too many changes. Please try again in an hour.' USING ERRCODE = '54000';
  END IF;
  PERFORM public.notification_pause_end(_uid, 'resume', CASE WHEN _source = 'bell' THEN 'bell' ELSE 'settings' END);
  RETURN public.notification_pause_state(_uid);
END $$;

-- --------------------------------------------------------------- signed e-mail links (service role only)
-- Called by the notification-pause edge function after HMAC, expiry and rate checks. Idempotent per link nonce.
CREATE OR REPLACE FUNCTION public.notification_pause_link_action(_user_id UUID, _nonce TEXT, _action TEXT, _duration TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _used public.notification_pause_link_uses; _p public.user_notification_pauses; _until TIMESTAMPTZ;
        _cons BOOLEAN; _cid UUID; _pid UUID;
BEGIN
  IF _user_id IS NULL OR _nonce IS NULL OR _nonce !~ '^[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'invalid link' USING ERRCODE = '22023';
  END IF;
  _cons := EXISTS (SELECT 1 FROM public.consultants c WHERE c.user_id = _user_id);

  IF _action = 'unsubscribe' THEN
    INSERT INTO public.notification_pause_link_uses (nonce, user_id, action) VALUES (_nonce, _user_id, 'unsubscribe')
    ON CONFLICT (nonce) DO NOTHING;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'unsubscribed_before'); END IF;
    INSERT INTO public.notification_pause_events (user_id, action, source) VALUES (_user_id, 'unsubscribe', 'email');
    RETURN jsonb_build_object('state', 'unsubscribed');
  END IF;

  IF _action = 'resume' THEN
    PERFORM public.notification_pause_end(_user_id, 'resume', 'email');
    RETURN jsonb_build_object('state', 'resumed', 'can_mark_unavailable', false);
  END IF;

  IF _action IN ('status', 'unavailable', 'pause') AND NOT public.platform_flag('notification_pause_enabled', true) THEN
    RETURN jsonb_build_object('state', 'disabled');
  END IF;

  IF _action = 'pause' THEN
    IF public.notification_pause_days(_duration) IS NULL THEN RAISE EXCEPTION 'invalid link' USING ERRCODE = '22023'; END IF;
    SELECT * INTO _used FROM public.notification_pause_link_uses WHERE nonce = _nonce;
    IF FOUND THEN
      IF _used.user_id <> _user_id THEN RAISE EXCEPTION 'invalid link' USING ERRCODE = '22023'; END IF;
    ELSE
      SELECT * INTO _p FROM public.user_notification_pauses WHERE user_id = _user_id AND paused_until > now();
      IF FOUND THEN
        -- Keep the person's own choices (channels, categories, availability), only change the length.
        _until := public.notification_pause_apply(_user_id, _duration, _p.email, _p.in_app, _p.categories, _p.hold_in_app,
          _p.mark_unavailable, 'email');
      ELSE
        _until := public.notification_pause_apply(_user_id, _duration, true, true, ARRAY['reminders', 'digests', 'activity'],
          false, false, 'email');
      END IF;
      INSERT INTO public.notification_pause_link_uses (nonce, user_id, action, paused_until) VALUES (_nonce, _user_id, 'pause', _until)
      ON CONFLICT (nonce) DO NOTHING;
    END IF;
  ELSIF _action = 'unavailable' THEN
    SELECT * INTO _p FROM public.user_notification_pauses WHERE user_id = _user_id AND paused_until > now() FOR UPDATE;
    IF FOUND AND _cons AND _p.unavailable_period_id IS NULL THEN
      SELECT c.id INTO _cid FROM public.consultants c WHERE c.user_id = _user_id LIMIT 1;
      INSERT INTO public.consultant_unavailable_periods (consultant_id, starts_at, ends_at, reason)
      VALUES (_cid, now(), _p.paused_until, 'Notifications paused') RETURNING id INTO _pid;
      UPDATE public.user_notification_pauses SET mark_unavailable = true, unavailable_period_id = _pid, updated_at = now()
       WHERE user_id = _user_id;
      INSERT INTO public.notification_pause_events (user_id, action, duration, paused_until, source)
      VALUES (_user_id, 'unavailable', _p.duration, _p.paused_until, 'email');
    END IF;
  ELSIF _action <> 'status' THEN
    RAISE EXCEPTION 'invalid action' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _p FROM public.user_notification_pauses WHERE user_id = _user_id AND paused_until > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_paused', 'can_mark_unavailable', false); END IF;
  RETURN jsonb_build_object('state', 'paused', 'until', _p.paused_until, 'duration', _p.duration,
    'can_mark_unavailable', _cons, 'unavailable', _p.unavailable_period_id IS NOT NULL);
END $$;

-- --------------------------------------------------------------- expiry sweep (every 15 minutes, SQL only)
CREATE OR REPLACE FUNCTION public.notification_pause_sweep()
RETURNS INT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r RECORD; _n INT := 0;
BEGIN
  FOR _r IN SELECT user_id FROM public.user_notification_pauses
             WHERE back_notice_at IS NULL AND paused_until <= now() ORDER BY paused_until LIMIT 500
  LOOP
    IF public.notification_pause_end(_r.user_id, 'expire', 'system') THEN _n := _n + 1; END IF;
  END LOOP;
  RETURN _n;
END $$;

-- --------------------------------------------------------------- admin (read-only count; settings via platform_settings)
CREATE OR REPLACE FUNCTION public.admin_notification_pause_overview()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'paused_now', (SELECT count(*) FROM public.user_notification_pauses WHERE paused_until > now()),
    'paused_email', (SELECT count(*) FROM public.user_notification_pauses WHERE paused_until > now() AND email),
    'paused_in_app', (SELECT count(*) FROM public.user_notification_pauses WHERE paused_until > now() AND in_app),
    'marked_unavailable', (SELECT count(*) FROM public.user_notification_pauses WHERE paused_until > now() AND unavailable_period_id IS NOT NULL),
    'enabled', public.platform_flag('notification_pause_enabled', true),
    'max_days', public.notification_pause_max_days());
END $$;

-- --------------------------------------------------------------- permissions
REVOKE ALL ON FUNCTION public.notification_pause_max_days() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.notifications_paused(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_email_check(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notifications_apply_pause() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_pause_state(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_pause_apply(UUID, TEXT, BOOLEAN, BOOLEAN, TEXT[], BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_pause_end(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_pause_link_action(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notification_pause_sweep() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.my_notification_pause() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pause_my_notifications(TEXT, BOOLEAN, BOOLEAN, TEXT[], BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_my_notifications(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_notification_pause_overview() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.notification_pause_max_days() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notifications_paused(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_email_check(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_pause_state(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_pause_apply(UUID, TEXT, BOOLEAN, BOOLEAN, TEXT[], BOOLEAN, BOOLEAN, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_pause_end(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_pause_link_action(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.notification_pause_sweep() TO service_role;
GRANT EXECUTE ON FUNCTION public.my_notification_pause() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_my_notifications(TEXT, BOOLEAN, BOOLEAN, TEXT[], BOOLEAN, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resume_my_notifications(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_notification_pause_overview() TO authenticated;

-- --------------------------------------------------------------- schedule: expiry notice every 15 minutes (96 runs a day, SQL only)
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notification-pause-sweep';
  PERFORM cron.schedule('notification-pause-sweep', '*/15 * * * *', 'SELECT public.notification_pause_sweep()');
END $$;
