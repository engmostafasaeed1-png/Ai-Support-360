-- Admin messages by e-mail: every notification an ADMINISTRATOR creates for another person is also e-mailed to
-- that person, once, through one shared mechanism. Prepared for the owner's review. NOT APPLIED.
--
-- How it works
--   * One AFTER INSERT trigger on public.notifications (ame_capture) records a row in admin_message_emails when the
--     signed-in caller (auth.uid()) is an admin / super admin and the recipient is someone else. Scheduled jobs,
--     database sweeps and workers run without a signed-in user, so system / cron notices never enter this path.
--   * Kinds: 'comment' (direct messages, ticket and BRD comments) may be unticked by the admin for a minor comment;
--     every other kind is a 'decision' / notice and is always e-mailed (locked on). The admin's choice travels with
--     the request in the x-admin-email header ("off", "important", "tests"); unticking is stored as a skipped row
--     with the admin's id and reason 'admin_unticked_email' (the log).
--   * No double mail: notice types that already send their own e-mail (NDA, referral, SLA, agreements, ticket
--     tracking, feedback replies, meetings, interviews, assignment requests) and recipients who are administrators
--     (admin-notification-email) are recorded as skipped 'already_emailed'. Feature R bulk messages are sent by the
--     worker (no signed-in user) and never e-mailed; one admin action that notifies more than 5 people is a list and
--     stays in-app ('list_send_in_app_only'). One e-mail per recipient per action ('one_email_per_action').
--   * The admin-message-email function (job-token checked, woken by pg_net only while rows wait, plus a one-off
--     cron armed only while rate-limited rows are held) claims rows with ame_claim (service only) and reports with
--     ame_finish. Limits: switch admin_messages_email_enabled (default on), daily cap (default 300 e-mails), 5 per
--     recipient per hour (the rest wait and go out together as one digest), 60 per admin per hour (held 10 minutes).
--   * Skipped with a logged reason: test-tagged accounts (unless "tests"), no / unconfirmed address, paused
--     notifications (unless the admin ticked "important"; essential notices are never paused), suppressed
--     addresses (bounce / complaint / unsubscribe, reported by the e-mail service).
--   * Content is only the stored notification title and text the person already sees in-app; links are only
--     relative pages on our own site. Browsers never write these rows; admins read them through two RPCs.

-- ------------------------------------------------------------------ table

CREATE TABLE IF NOT EXISTS public.admin_message_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE,
  recipient uuid NOT NULL,
  actor uuid NOT NULL,
  tx bigint NOT NULL DEFAULT txid_current(),
  kind text NOT NULL CHECK (kind IN ('comment', 'decision')),
  important boolean NOT NULL DEFAULT false,
  include_tests boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'skipped', 'failed')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 200),
  digest boolean NOT NULL DEFAULT false,
  mail_key text,
  attempts integer NOT NULL DEFAULT 0,
  send_after timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS admin_message_emails_due_idx ON public.admin_message_emails (send_after) WHERE status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS admin_message_emails_recipient_idx ON public.admin_message_emails (recipient, claimed_at DESC);
CREATE INDEX IF NOT EXISTS admin_message_emails_actor_idx ON public.admin_message_emails (actor, claimed_at DESC);
CREATE INDEX IF NOT EXISTS admin_message_emails_tx_idx ON public.admin_message_emails (tx, actor);
ALTER TABLE public.admin_message_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_message_emails FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_message_emails TO service_role;
-- No browser policies: admins read through admin_message_email_log / admin_message_email_settings only.

-- ------------------------------------------------------------------ rules (mirrored by src/lib/adminMessageEmail.ts)

CREATE OR REPLACE FUNCTION public.ame_kind(_type text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE WHEN COALESCE(btrim(_type), '') IN ('admin_message', 'ticket', 'brd') THEN 'comment' ELSE 'decision' END
$$;

-- Reason a notice type never uses this path (it already has its own e-mail, is a list send or an admin alert).
CREATE OR REPLACE FUNCTION public.ame_type_skip(_type text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN COALESCE(btrim(_type), '') = 'admin_marketing' THEN 'list_send_in_app_only'
    WHEN COALESCE(btrim(_type), '') IN ('nda', 'referral', 'referral_intro', 'sla', 'agreement', 'ticket_tracking',
      'brd_approval', 'feedback', 'feedback_reply', 'feedback_fixed', 'session', 'interview', 'match_request',
      'critical_request', 'payout_approved') THEN 'already_emailed'
    WHEN COALESCE(btrim(_type), '') IN ('admin', 'admin_digest', 'feedback_digest', 'security', 'error', 'demo_request')
      OR COALESCE(btrim(_type), '') LIKE 'admin\_reminder\_%' THEN 'admin_alert'
  END
$$;

CREATE OR REPLACE FUNCTION public.ame_is_test_user(_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_admin_state s, unnest(COALESCE(s.tags, '{}'::text[])) tg
                 WHERE s.user_id = _uid AND lower(btrim(tg)) IN ('test', 'test data', 'test-data', 'testdata'))
$$;
REVOKE ALL ON FUNCTION public.ame_is_test_user(uuid) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ wake-ups

CREATE OR REPLACE FUNCTION public.ame_wake()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF to_regnamespace('net') IS NULL OR to_regprocedure('public.job_invoke_headers()') IS NULL THEN RETURN; END IF;
  IF current_setting('app.ame_woken', true) = 'yes' THEN RETURN; END IF;
  PERFORM set_config('app.ame_woken', 'yes', true);
  EXECUTE $q$SELECT net.http_post(url := $1, headers := public.job_invoke_headers(), body := '{}'::jsonb)$q$
    USING 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/admin-message-email';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin message e-mail wake-up skipped: %', SQLERRM;
END
$$;
REVOKE ALL ON FUNCTION public.ame_wake() FROM PUBLIC, anon, authenticated;

-- One-off cron at the earliest held row (rate-limited rows); removed when nothing waits, so idle days cost nothing.
CREATE OR REPLACE FUNCTION public.ame_arm()
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _next timestamptz; _expr text;
BEGIN
  IF to_regnamespace('cron') IS NULL THEN RETURN 'no_cron'; END IF;
  SELECT min(send_after) INTO _next FROM public.admin_message_emails WHERE status = 'queued' AND send_after > now();
  IF _next IS NULL THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'admin-message-email-held';
    RETURN 'off';
  END IF;
  _expr := to_char(_next AT TIME ZONE 'UTC', 'FMMI FMHH24 FMDD FMMM') || ' *';
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'admin-message-email-held' AND schedule = _expr AND command ILIKE '%job_invoke_headers%') THEN
    RETURN _expr;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'admin-message-email-held';
  PERFORM cron.schedule('admin-message-email-held', _expr, $job$
  SELECT net.http_post(
    url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/admin-message-email',
    headers := public.job_invoke_headers(),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  $job$);
  RETURN _expr;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin message e-mail timer skipped: %', SQLERRM;
  RETURN 'error';
END
$$;
REVOKE ALL ON FUNCTION public.ame_arm() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------ capture (never blocks the notification)

CREATE OR REPLACE FUNCTION public.ame_capture()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _actor uuid := auth.uid();
  _hdr text := '';
  _opts text[];
  _kind text;
  _status text := 'queued';
  _reason text;
  _important boolean;
  _tests boolean;
  _off boolean;
  _tx bigint := txid_current();
  _n integer;
BEGIN
  IF _actor IS NULL OR NEW.user_id IS NULL OR NEW.user_id = _actor THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role IN ('admin', 'super_admin')) THEN RETURN NULL; END IF;
  BEGIN
    _hdr := lower(COALESCE(current_setting('request.headers', true)::json ->> 'x-admin-email', ''));
  EXCEPTION WHEN OTHERS THEN _hdr := '';
  END;
  _opts := regexp_split_to_array(left(_hdr, 60), '\s*,\s*');
  _important := 'important' = ANY (_opts);
  _tests := 'tests' = ANY (_opts);
  _off := 'off' = ANY (_opts);
  _kind := public.ame_kind(NEW.type);

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role IN ('admin', 'super_admin')) THEN
    _reason := 'already_emailed';
  ELSE
    _reason := public.ame_type_skip(NEW.type);
  END IF;
  IF _reason IS NULL AND NEW.delivery_status = 'failed' THEN _reason := 'in_app_not_delivered'; END IF;
  -- Decisions and notices are locked on: "off" only counts for comments.
  IF _reason IS NULL AND _off AND _kind = 'comment' THEN _reason := 'admin_unticked_email'; END IF;
  IF _reason IS NULL AND NOT _tests AND public.ame_is_test_user(NEW.user_id) THEN _reason := 'test_account'; END IF;
  IF _reason IS NULL AND EXISTS (SELECT 1 FROM public.admin_message_emails e
                                 WHERE e.tx = _tx AND e.actor = _actor AND e.recipient = NEW.user_id AND e.status = 'queued') THEN
    _reason := 'one_email_per_action';
  END IF;
  IF _reason IS NOT NULL THEN _status := 'skipped'; END IF;

  INSERT INTO public.admin_message_emails (notification_id, recipient, actor, tx, kind, important, include_tests, status, reason, finished_at)
  VALUES (NEW.id, NEW.user_id, _actor, _tx, _kind, _important, _tests, _status, _reason, CASE WHEN _status = 'skipped' THEN now() END)
  ON CONFLICT (notification_id) DO NOTHING;

  -- One action that notifies more than 5 people is a list send: in-app only (app e-mails are one-recipient).
  SELECT count(DISTINCT recipient) INTO _n FROM public.admin_message_emails WHERE tx = _tx AND actor = _actor;
  IF _n > 5 THEN
    UPDATE public.admin_message_emails SET status = 'skipped', reason = 'list_send_in_app_only', finished_at = now()
    WHERE tx = _tx AND actor = _actor AND status = 'queued';
  ELSIF _status = 'queued' THEN
    PERFORM public.ame_wake();
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin message e-mail capture skipped: %', SQLERRM;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.ame_capture() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_admin_message_email ON public.notifications;
CREATE TRIGGER trg_zz_admin_message_email AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.ame_capture();

-- ------------------------------------------------------------------ worker RPCs (service role only)

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
    FROM public.notifications n
    WHERE q.recipient = r.recipient AND q.status = 'queued' AND q.send_after <= now() AND NOT q.important
      AND n.id = q.notification_id
      AND public.notifications_paused(q.recipient, COALESCE(n.pause_category, public.notification_category(n.type, n.title)), 'email');
    -- Deleted notifications are not mailed.
    UPDATE public.admin_message_emails q SET status = 'skipped', reason = 'notification_removed', finished_at = now()
    WHERE q.recipient = r.recipient AND q.status = 'queued' AND q.send_after <= now()
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
          'items', (SELECT jsonb_agg(jsonb_build_object('id', q.id, 'title', n.title, 'body', n.body, 'link', n.link, 'type', n.type, 'kind', q.kind))
                    FROM public.admin_message_emails q JOIN public.notifications n ON n.id = q.notification_id WHERE q.id = _ids[i])));
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
        'items', (SELECT jsonb_agg(jsonb_build_object('id', q.id, 'title', n.title, 'body', n.body, 'link', n.link, 'type', n.type, 'kind', q.kind) ORDER BY q.created_at)
                  FROM public.admin_message_emails q JOIN public.notifications n ON n.id = q.notification_id WHERE q.id = ANY (_ids))));
    END IF;
  END LOOP;
  PERFORM public.ame_arm();
  RETURN _out;
END
$$;
REVOKE ALL ON FUNCTION public.ame_claim(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ame_claim(integer) TO service_role;

-- _status: 'sent' | 'skipped' (e.g. suppressed address) | 'failed' (retried up to 5 attempts with back-off).
CREATE OR REPLACE FUNCTION public.ame_finish(_mail_key text, _status text, _reason text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF _status = 'sent' THEN
    UPDATE public.admin_message_emails SET status = 'sent', reason = NULL, finished_at = now(), lease_until = NULL
    WHERE mail_key = _mail_key AND status = 'sending';
  ELSIF _status = 'skipped' THEN
    UPDATE public.admin_message_emails SET status = 'skipped', reason = left(COALESCE(_reason, 'skipped'), 200),
      finished_at = now(), lease_until = NULL
    WHERE mail_key = _mail_key AND status = 'sending';
  ELSE
    UPDATE public.admin_message_emails SET
      status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
      reason = left(COALESCE(_reason, 'send_failed'), 200),
      finished_at = CASE WHEN attempts >= 5 THEN now() END,
      send_after = now() + make_interval(mins => 5 * attempts), lease_until = NULL
    WHERE mail_key = _mail_key AND status = 'sending';
  END IF;
  PERFORM public.ame_arm();
END
$$;
REVOKE ALL ON FUNCTION public.ame_finish(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ame_finish(text, text, text) TO service_role;

-- ------------------------------------------------------------------ admin reads and settings

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
             q.created_at, q.finished_at, q.send_after, left(n.title, 120) AS title,
             (SELECT p.display_name FROM public.profiles p WHERE p.user_id = q.recipient LIMIT 1) AS recipient_name,
             (SELECT p.display_name FROM public.profiles p WHERE p.user_id = q.actor LIMIT 1) AS actor_name
      FROM public.admin_message_emails q LEFT JOIN public.notifications n ON n.id = q.notification_id
      WHERE _user IS NULL OR q.recipient = _user
      ORDER BY q.created_at DESC LIMIT GREATEST(1, LEAST(COALESCE(_limit, 30), 100))) x), '[]'::jsonb);
END
$$;
REVOKE ALL ON FUNCTION public.admin_message_email_log(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_message_email_log(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_message_email_settings()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'enabled', public.platform_flag('admin_messages_email_enabled', true),
    'daily_cap', public.bm_setting_int('admin_messages_email_daily_cap', 300, 1, 5000),
    'per_recipient_hour', public.bm_setting_int('admin_messages_email_per_recipient_hour', 5, 1, 50),
    'per_admin_hour', public.bm_setting_int('admin_messages_email_per_admin_hour', 60, 1, 1000),
    'sent_today', (SELECT count(DISTINCT mail_key) FROM public.admin_message_emails WHERE status = 'sent' AND claimed_at >= date_trunc('day', now())),
    'waiting', (SELECT count(*) FROM public.admin_message_emails WHERE status IN ('queued', 'sending')),
    'skipped_today', (SELECT count(*) FROM public.admin_message_emails WHERE status = 'skipped' AND created_at >= date_trunc('day', now())),
    'failed_today', (SELECT count(*) FROM public.admin_message_emails WHERE status = 'failed' AND created_at >= date_trunc('day', now())));
END
$$;
REVOKE ALL ON FUNCTION public.admin_message_email_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_message_email_settings() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_message_email_settings(_enabled boolean, _daily_cap integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF _enabled IS NULL OR _daily_cap IS NULL OR _daily_cap NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION 'The daily cap must be between 1 and 5000' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.platform_settings (key, value) VALUES ('admin_messages_email_enabled', to_jsonb(_enabled))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO public.platform_settings (key, value) VALUES ('admin_messages_email_daily_cap', to_jsonb(_daily_cap))
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
  RETURN public.admin_message_email_settings();
END
$$;
REVOKE ALL ON FUNCTION public.admin_set_message_email_settings(boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_message_email_settings(boolean, integer) TO authenticated;
