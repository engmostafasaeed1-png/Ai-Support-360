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
--     relative pages on our own site. Browsers never write these rows; admins read them through RPCs.
--   * Organised messages: notifications.meta (jsonb, nullable) carries the admin message details (category, summary,
--     related item, what to do, deadline) written only by admin_message_send; the e-mail, the in-app card and the
--     compose preview share one layout (_shared/adminMessageEmail.ts). "Send test to me" e-mails only the admin.
--   * Review decisions (approve / request changes / request info / reject / unverify / suspend / reactivate, for
--     consultant profiles, client accounts, certificates, LinkedIn, Credly, verification documents and success stories)
--     all go through ame_decision_notice: one in-app notice + one e-mail per decision (status badge, the admin's
--     comment, next steps; default text when there is no comment), locked on and sent even during quiet pauses.

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
  is_test boolean NOT NULL DEFAULT false,
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
ALTER TABLE public.admin_message_emails ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
-- Message details shown in the in-app card and e-mail (written only by admin_message_send; older notices have none).
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS meta jsonb;
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

-- One queue row for one notification from admin _actor (the trigger below, and decisions sent by server functions).
-- _hdr: the admin's choice ("off", "important", "tests"). Applies every skip rule in one place.
CREATE OR REPLACE FUNCTION public.ame_enqueue(_nid uuid, _to uuid, _type text, _delivery text, _actor uuid, _hdr text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _opts text[] := regexp_split_to_array(left(lower(COALESCE(_hdr, '')), 60), '\s*,\s*');
  _kind text := public.ame_kind(_type);
  _status text := 'queued';
  _reason text;
  _important boolean;
  _tests boolean;
  _tx bigint := txid_current();
  _n integer;
BEGIN
  _important := 'important' = ANY (_opts);
  _tests := 'tests' = ANY (_opts);
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _to AND role IN ('admin', 'super_admin')) THEN
    _reason := 'already_emailed';
  ELSE
    _reason := public.ame_type_skip(_type);
  END IF;
  IF _reason IS NULL AND _delivery = 'failed' THEN _reason := 'in_app_not_delivered'; END IF;
  -- Decisions and notices are locked on: "off" only counts for comments.
  IF _reason IS NULL AND 'off' = ANY (_opts) AND _kind = 'comment' THEN _reason := 'admin_unticked_email'; END IF;
  IF _reason IS NULL AND NOT _tests AND public.ame_is_test_user(_to) THEN _reason := 'test_account'; END IF;
  -- No address on the profile: recorded at once so the admin sees "no e-mail" in the history right away.
  IF _reason IS NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _to AND NULLIF(btrim(COALESCE(u.email, '')), '') IS NOT NULL) THEN
    _reason := 'no_email';
  END IF;
  IF _reason IS NULL AND EXISTS (SELECT 1 FROM public.admin_message_emails e
                                 WHERE e.tx = _tx AND e.actor = _actor AND e.recipient = _to AND e.status = 'queued') THEN
    _reason := 'one_email_per_action';
  END IF;
  IF _reason IS NOT NULL THEN _status := 'skipped'; END IF;

  INSERT INTO public.admin_message_emails (notification_id, recipient, actor, tx, kind, important, include_tests, status, reason, finished_at)
  VALUES (_nid, _to, _actor, _tx, _kind, _important, _tests, _status, _reason, CASE WHEN _status = 'skipped' THEN now() END)
  ON CONFLICT (notification_id) DO NOTHING;

  -- One action that notifies more than 5 people is a list send: in-app only (app e-mails are one-recipient).
  SELECT count(DISTINCT recipient) INTO _n FROM public.admin_message_emails WHERE tx = _tx AND actor = _actor;
  IF _n > 5 THEN
    UPDATE public.admin_message_emails SET status = 'skipped', reason = 'list_send_in_app_only', finished_at = now()
    WHERE tx = _tx AND actor = _actor AND status = 'queued';
  ELSIF _status = 'queued' THEN
    PERFORM public.ame_wake();
  END IF;
END
$$;
REVOKE ALL ON FUNCTION public.ame_enqueue(uuid, uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ame_capture()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _actor uuid := auth.uid();
  _hdr text := '';
BEGIN
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
          'test', (SELECT q.is_test FROM public.admin_message_emails q WHERE q.id = _ids[i]),
          'items', (SELECT jsonb_agg(jsonb_build_object('id', q.id, 'title', n.title, 'body', n.body, 'link', n.link, 'type', n.type, 'kind', q.kind, 'meta', n.meta, 'created_at', n.created_at))
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
        'test', (SELECT bool_and(q.is_test) FROM public.admin_message_emails q WHERE q.id = ANY (_ids)),
        'items', (SELECT jsonb_agg(jsonb_build_object('id', q.id, 'title', n.title, 'body', n.body, 'link', n.link, 'type', n.type, 'kind', q.kind, 'meta', n.meta, 'created_at', n.created_at) ORDER BY q.created_at)
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

-- ------------------------------------------------------------------ organised admin messages (compose, card, history)

-- Category of a notice (mirrors categoryForType in _shared/adminMessageEmail.ts).
CREATE OR REPLACE FUNCTION public.ame_category(_type text, _meta jsonb)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _meta ->> 'category' IN ('notice', 'decision', 'action', 'reminder', 'update', 'welcome') THEN _meta ->> 'category'
    WHEN btrim(COALESCE(_type, '')) IN ('approval', 'success', 'payment', 'invoice', 'rate', 'responsiveness') THEN 'decision'
    WHEN btrim(COALESCE(_type, '')) IN ('match_request', 'critical_request') THEN 'action'
    WHEN btrim(COALESCE(_type, '')) = 'reminder' OR btrim(COALESCE(_type, '')) LIKE '%\_reminder' OR btrim(COALESCE(_type, '')) LIKE 'admin\_reminder\_%' THEN 'reminder'
    WHEN btrim(COALESCE(_type, '')) IN ('welcome', 'account_welcome') THEN 'welcome'
    WHEN btrim(COALESCE(_type, '')) IN ('ticket', 'brd', 'session', 'sla', 'agreement', 'ticket_tracking') THEN 'update'
    ELSE 'notice'
  END
$$;

-- The related item shown in the "context card". Ticket / agreement / invoice must belong to the recipient (as client
-- or consultant), so a message can never show someone else's item; "other" is the admin's own short text.
CREATE OR REPLACE FUNCTION public.ame_context(_kind text, _ref text, _to uuid, _label text DEFAULT NULL, _status text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _r record; _id uuid; _ref2 text := left(btrim(COALESCE(_ref, '')), 80);
BEGIN
  IF COALESCE(_kind, 'none') IN ('', 'none') THEN RETURN NULL; END IF;
  BEGIN _id := _ref2::uuid; EXCEPTION WHEN OTHERS THEN _id := NULL; END;
  IF _kind = 'ticket' THEN
    SELECT t.id, t.title, t.status::text AS status, t.client_id, t.consultant_id INTO _r FROM public.tickets t WHERE t.id = _id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ame_context_not_found' USING ERRCODE = '22023'; END IF;
    IF NOT (_r.client_id = _to OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _r.consultant_id AND c.user_id = _to)) THEN
      RAISE EXCEPTION 'ame_context_not_for_recipient' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('kind', 'ticket', 'label', left(_r.title, 120), 'ref', '#' || upper(left(_r.id::text, 8)), 'status', replace(_r.status, '_', ' '));
  ELSIF _kind = 'agreement' THEN
    SELECT a.id, a.name, a.reference, a.status::text AS status, a.client_id, a.consultant_id INTO _r FROM public.sa_agreements a
    WHERE a.id = _id OR (_id IS NULL AND a.reference = _ref2) LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'ame_context_not_found' USING ERRCODE = '22023'; END IF;
    IF NOT (_r.client_id = _to OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _r.consultant_id AND c.user_id = _to)) THEN
      RAISE EXCEPTION 'ame_context_not_for_recipient' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('kind', 'agreement', 'label', left(_r.name, 120), 'ref', _r.reference, 'status', replace(_r.status, '_', ' '));
  ELSIF _kind = 'invoice' THEN
    SELECT p.id, p.invoice_number, p.status::text AS status, p.client_id, p.consultant_id INTO _r FROM public.payments p
    WHERE p.id = _id OR (_id IS NULL AND p.invoice_number = _ref2) LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'ame_context_not_found' USING ERRCODE = '22023'; END IF;
    IF NOT (_r.client_id = _to OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = _r.consultant_id AND c.user_id = _to)) THEN
      RAISE EXCEPTION 'ame_context_not_for_recipient' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('kind', 'invoice', 'label', COALESCE(_r.invoice_number, '#' || upper(left(_r.id::text, 8))),
      'ref', _r.invoice_number, 'status', replace(_r.status, '_', ' '));
  ELSIF _kind = 'other' THEN
    IF char_length(btrim(COALESCE(_label, ''))) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'ame_context_label' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_build_object('kind', 'other', 'label', btrim(_label), 'ref', NULLIF(left(_ref2, 40), ''),
      'status', NULLIF(left(btrim(COALESCE(_status, '')), 40), ''));
  END IF;
  RAISE EXCEPTION 'ame_context_kind' USING ERRCODE = '22023';
END
$$;
REVOKE ALL ON FUNCTION public.ame_context(text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Compose preview: what the context card will show for this recipient.
CREATE OR REPLACE FUNCTION public.admin_message_context(_to uuid, _kind text, _ref text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  RETURN public.ame_context(_kind, _ref, _to);
END
$$;
REVOKE ALL ON FUNCTION public.admin_message_context(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_message_context(uuid, text, text) TO authenticated;

-- One admin message to one person (the compose box). _p: category, subject, summary, body, link, action_label,
-- deadline (YYYY-MM-DD), context {kind, ref, label, status}, email, important, tests, test (send only to me).
CREATE OR REPLACE FUNCTION public.admin_message_send(_to uuid, _p jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _me uuid;
  _test boolean := COALESCE((_p ->> 'test')::boolean, false);
  _cat text := COALESCE(_p ->> 'category', 'notice');
  _subject text := btrim(COALESCE(_p ->> 'subject', ''));
  _summary text := NULLIF(btrim(COALESCE(_p ->> 'summary', '')), '');
  _body text := btrim(COALESCE(_p ->> 'body', ''));
  _link text := NULLIF(btrim(COALESCE(_p ->> 'link', '')), '');
  _action text := NULLIF(btrim(COALESCE(_p ->> 'action_label', '')), '');
  _deadline date;
  _ctx jsonb;
  _meta jsonb;
  _id uuid;
  _choice text[] := ARRAY[]::text[];
BEGIN
  _me := public.um_guard('users.message', CASE WHEN _test THEN 'message_test' ELSE 'message' END, CASE WHEN _test THEN 6 ELSE 60 END);
  IF _test THEN _to := _me; END IF;
  IF _to IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = _to) THEN RAISE EXCEPTION 'ame_unknown_recipient' USING ERRCODE = '22023'; END IF;
  IF _cat NOT IN ('notice', 'decision', 'action', 'reminder', 'update', 'welcome') THEN RAISE EXCEPTION 'ame_category' USING ERRCODE = '22023'; END IF;
  IF char_length(_subject) NOT BETWEEN 1 AND 120 OR char_length(_body) NOT BETWEEN 1 AND 4000
     OR char_length(COALESCE(_summary, '')) > 200 OR char_length(COALESCE(_action, '')) > 120 THEN
    RAISE EXCEPTION 'ame_lengths' USING ERRCODE = '22023';
  END IF;
  IF _link IS NOT NULL AND (_link !~ '^/[A-Za-z0-9/_?=&.#%-]*$' OR _link LIKE '//%' OR _link LIKE '%..%' OR char_length(_link) > 200) THEN
    RAISE EXCEPTION 'ame_link' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(_p ->> 'deadline', '') IS NOT NULL THEN
    BEGIN _deadline := (_p ->> 'deadline')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'ame_deadline' USING ERRCODE = '22023'; END;
    IF _deadline < current_date OR _deadline > current_date + 365 THEN RAISE EXCEPTION 'ame_deadline' USING ERRCODE = '22023'; END IF;
  END IF;
  IF public.bm_has_secret(concat_ws(' ', _subject, _summary, _body, _action)) THEN RAISE EXCEPTION 'ame_secret' USING ERRCODE = '22023'; END IF;
  _ctx := public.ame_context(_p #>> '{context,kind}', _p #>> '{context,ref}', _to, _p #>> '{context,label}', _p #>> '{context,status}');
  _meta := jsonb_strip_nulls(jsonb_build_object('v', 1, 'category', _cat, 'summary', _summary, 'context', _ctx,
    'action_label', _action, 'deadline', to_char(_deadline, 'YYYY-MM-DD'), 'test', CASE WHEN _test THEN true END));

  -- Only minor categories (Update, Welcome) may skip the e-mail; notices, decisions, requests and reminders are locked on.
  IF COALESCE((_p ->> 'email')::boolean, true) = false AND _cat IN ('update', 'welcome') THEN _choice := array_append(_choice, 'off'); END IF;
  IF COALESCE((_p ->> 'important')::boolean, false) THEN _choice := array_append(_choice, 'important'); END IF;
  IF COALESCE((_p ->> 'tests')::boolean, false) THEN _choice := array_append(_choice, 'tests'); END IF;
  PERFORM set_config('app.ame_choice', array_to_string(_choice, ','), true);
  _id := public.safe_insert_notification(_to, _subject, _body, 'admin_message', _link);
  PERFORM set_config('app.ame_choice', '', true);
  UPDATE public.notifications SET meta = _meta WHERE id = _id;

  IF _test THEN
    -- The admin's own copy (the trigger skips notes to oneself): one test e-mail, "[TEST]" subject.
    INSERT INTO public.admin_message_emails (notification_id, recipient, actor, kind, is_test, important, include_tests)
    VALUES (_id, _me, _me, 'comment', true, true, true) ON CONFLICT (notification_id) DO NOTHING;
    PERFORM public.ame_wake();
  END IF;
  PERFORM public.um_audit(_me, CASE WHEN _test THEN 'notify_test' ELSE 'notify' END, _to, NULL,
    jsonb_build_object('title', _subject, 'category', _cat), NULL, jsonb_build_object('notification_id', _id));
  RETURN jsonb_build_object('ok', true, 'id', _id,
    'email', (SELECT jsonb_build_object('status', e.status, 'reason', e.reason) FROM public.admin_message_emails e WHERE e.notification_id = _id));
END
$$;
REVOKE ALL ON FUNCTION public.admin_message_send(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_message_send(uuid, jsonb) TO authenticated;

-- Admin message history: one row per admin-authored notice. _p: q (subject / recipient), category, status,
-- from, to (dates), limit (<= 500).
CREATE OR REPLACE FUNCTION public.admin_message_history(_p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _q text := NULLIF(btrim(COALESCE(_p ->> 'q', '')), '');
  _cat text := NULLIF(_p ->> 'category', '');
  _st text := NULLIF(_p ->> 'status', '');
  _from date; _to date;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  BEGIN _from := NULLIF(_p ->> 'from', '')::date; _to := NULLIF(_p ->> 'to', '')::date; EXCEPTION WHEN OTHERS THEN _from := NULL; _to := NULL; END;
  RETURN COALESCE((
    SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (
      SELECT q.id, q.notification_id, q.created_at, q.recipient, q.kind, q.important, q.is_test, q.digest, q.status, q.reason,
             q.send_after, left(n.title, 120) AS subject, public.ame_category(n.type, n.meta) AS category,
             COALESCE(n.is_read, false) AS is_read, (n.id IS NOT NULL) AS in_app, n.meta #>> '{decision,outcome}' AS decision,
             rp.display_name AS recipient_name, ap.display_name AS actor_name
      FROM public.admin_message_emails q
      LEFT JOIN public.notifications n ON n.id = q.notification_id
      LEFT JOIN LATERAL (SELECT p.display_name FROM public.profiles p WHERE p.user_id = q.recipient LIMIT 1) rp ON true
      LEFT JOIN LATERAL (SELECT p.display_name FROM public.profiles p WHERE p.user_id = q.actor LIMIT 1) ap ON true
      WHERE (_q IS NULL OR n.title ILIKE '%' || _q || '%' OR rp.display_name ILIKE '%' || _q || '%')
        AND (_cat IS NULL OR public.ame_category(n.type, n.meta) = _cat)
        AND (_st IS NULL OR q.status = _st)
        AND (_from IS NULL OR q.created_at >= _from)
        AND (_to IS NULL OR q.created_at < _to + 1)
      ORDER BY q.created_at DESC
      LIMIT GREATEST(1, LEAST(COALESCE((_p ->> 'limit')::int, 200), 500))) x), '[]'::jsonb);
END
$$;
REVOKE ALL ON FUNCTION public.admin_message_history(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_message_history(jsonb) TO authenticated;

-- ------------------------------------------------------------------ account and profile review decisions
-- Every approve / request changes / request info / reject / unverify / suspend / reactivate decision an admin makes on
-- a person's account or profile goes through ame_decision_notice: ONE in-app notice (type 'approval') with the decision
-- in notifications.meta, e-mailed once by the shared worker above (decisions are locked on and marked important, so they
-- reach people who paused quiet notifications; test-tagged, suppressed and address-less accounts are logged skips).
-- The e-mail and in-app card render the decision in the reader's language (mirrored by DECISION_* in
-- _shared/adminMessageEmail.ts); the stored title / text below is the English copy.

CREATE OR REPLACE FUNCTION public.ame_decision_text(_subject text, _outcome text, _has_comment boolean, OUT title text, OUT body text)
 LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public'
AS $$
DECLARE n text := CASE _subject WHEN 'consultant_profile' THEN 'consultant profile' WHEN 'client_account' THEN 'company account'
  WHEN 'certificate' THEN 'certificate' WHEN 'linkedin' THEN 'LinkedIn profile' WHEN 'credly' THEN 'Credly badges'
  WHEN 'document' THEN 'document' WHEN 'success_story' THEN 'success story' ELSE 'account' END;
BEGIN
  title := CASE _outcome
    WHEN 'approved' THEN 'Your ' || n || ' is approved' WHEN 'reapproved' THEN 'Your ' || n || ' is approved again'
    WHEN 'changes' THEN 'Your ' || n || ' needs changes' WHEN 'info' THEN 'We need more information about your ' || n
    WHEN 'rejected' THEN 'Your ' || n || ' was not approved' WHEN 'unverified' THEN 'Your ' || n || ' is no longer verified'
    WHEN 'suspended' THEN 'Your ' || n || ' is suspended' WHEN 'reactivated' THEN 'Your ' || n || ' is active again'
    ELSE 'Your ' || n || ' is under review' END;
  body := CASE _outcome
    WHEN 'approved' THEN 'Welcome! An administrator reviewed and approved your ' || n || '.'
    WHEN 'reapproved' THEN 'Good news: after a new review, your ' || n || ' is approved again.'
    WHEN 'changes' THEN 'An administrator asked you to update your ' || n || ' before it can be approved.'
    WHEN 'info' THEN 'An administrator needs more information before deciding on your ' || n || '.'
    WHEN 'rejected' THEN CASE WHEN _has_comment THEN 'An administrator reviewed your ' || n || ' and could not approve it. The reason is below.'
      ELSE 'An administrator reviewed your ' || n || ' and could not approve it, because it does not meet our current requirements yet.' END
      || ' To appeal, write to info@aisupport360.com or use Help in the portal.'
    WHEN 'unverified' THEN 'After a review, the verified mark on your ' || n || ' was removed.'
    WHEN 'suspended' THEN 'An administrator suspended your ' || n || '.' || CASE WHEN _has_comment THEN ' The reason is below.' ELSE '' END
      || ' To appeal, write to info@aisupport360.com.'
    WHEN 'reactivated' THEN 'Your ' || n || ' is active again. Welcome back.'
    ELSE 'An administrator is reviewing your ' || n || '. We will tell you when a decision is made.' END;
END
$$;

-- Internal (no browser access). _ref identifies the reviewed item (dedupe key), _label names it in the related-item box.
-- _actor is only used by server functions that run without a signed-in admin (suspend / reactivate).
CREATE OR REPLACE FUNCTION public.ame_decision_notice(_to uuid, _subject text, _outcome text, _comment text, _link text,
  _ref text DEFAULT NULL, _label text DEFAULT NULL, _actor uuid DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _c text := NULLIF(left(btrim(COALESCE(_comment, '')), 2000), '');
  _key text;
  _id uuid;
  _t record;
  _prev text := COALESCE(current_setting('app.ame_choice', true), '');
BEGIN
  IF _to IS NULL THEN RETURN NULL; END IF;
  IF _subject NOT IN ('consultant_profile', 'client_account', 'certificate', 'linkedin', 'credly', 'document', 'success_story', 'account')
     OR _outcome NOT IN ('approved', 'reapproved', 'changes', 'info', 'rejected', 'unverified', 'suspended', 'reactivated', 'review') THEN
    RAISE EXCEPTION 'ame_decision_kind' USING ERRCODE = '22023';
  END IF;
  IF _link IS NULL OR _link !~ '^/[A-Za-z0-9/_?=&.#%-]*$' OR _link LIKE '//%' OR _link LIKE '%..%' OR char_length(_link) > 200 THEN
    _link := '/notifications';
  END IF;
  -- One e-mail per decision: the same decision with the same comment within 2 minutes (double click, two triggers in
  -- one action) returns the first notice instead of a second one.
  _key := _subject || ':' || COALESCE(NULLIF(left(btrim(COALESCE(_ref, '')), 80), ''), _to::text) || ':' || _outcome || ':' || left(md5(COALESCE(_c, '')), 12);
  SELECT n.id INTO _id FROM public.notifications n
  WHERE n.user_id = _to AND n.meta #>> '{decision,key}' = _key AND n.created_at > now() - interval '2 minutes'
  ORDER BY n.created_at DESC LIMIT 1;
  IF _id IS NOT NULL THEN RETURN _id; END IF;

  SELECT * INTO _t FROM public.ame_decision_text(_subject, _outcome, _c IS NOT NULL);
  PERFORM set_config('app.ame_choice', 'important', true);
  _id := public.safe_insert_notification(_to, _t.title,
    left(_t.body || COALESCE(E'\n\nComment from the administrator:\n' || _c, ''), 2400), 'approval', _link);
  PERFORM set_config('app.ame_choice', _prev, true);
  IF _id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.notifications SET meta = jsonb_strip_nulls(jsonb_build_object('v', 1, 'category', 'decision',
    'context', CASE WHEN NULLIF(btrim(COALESCE(_label, '')), '') IS NOT NULL THEN jsonb_build_object('kind', 'other', 'label', left(btrim(_label), 120)) END,
    'decision', jsonb_strip_nulls(jsonb_build_object('subject', _subject, 'outcome', _outcome, 'comment', _c, 'key', _key))))
  WHERE id = _id;
  -- Server functions have no signed-in admin, so the trigger did not queue it: queue it for the named admin.
  IF auth.uid() IS NULL AND _actor IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role IN ('admin', 'super_admin')) THEN
    PERFORM public.ame_enqueue(_id, _to, 'approval', 'delivered', _actor, 'important');
  END IF;
  RETURN _id;
END
$$;
REVOKE ALL ON FUNCTION public.ame_decision_notice(uuid, text, text, text, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ame_is_admin(_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role IN ('admin', 'super_admin')) $$;
REVOKE ALL ON FUNCTION public.ame_is_admin(uuid) FROM PUBLIC, anon, authenticated;

-- Path 1-3: consultant approval, verification / unverification, request info (on hold), rejection, re-approval,
-- suspension / reactivation of the consultant profile. Replaces the plain notice; the admin's comment comes from
-- app.verification_reason (set by admin_review_consultant; the audit trigger stores the same text).
CREATE OR REPLACE FUNCTION public.notify_consultant_verification_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _old text := OLD.verification_status::text;
  _new text := NEW.verification_status::text;
  _o text;
BEGIN
  IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN RETURN NEW; END IF;
  _o := CASE
    WHEN _new = 'verified' AND _old = 'suspended' THEN 'reactivated'
    WHEN _new = 'verified' AND _old = 'rejected' THEN 'reapproved'
    WHEN _new = 'verified' THEN 'approved'
    WHEN _new = 'rejected' THEN 'rejected'
    WHEN _new = 'on_hold' THEN 'info'
    WHEN _new = 'suspended' THEN 'suspended'
    WHEN _old = 'verified' AND _new IN ('pending', 'under_review') THEN 'unverified'
    WHEN _new = 'under_review' THEN 'review'
  END;
  IF _o IS NULL THEN RETURN NEW; END IF;
  PERFORM public.ame_decision_notice(NEW.user_id, 'consultant_profile', _o,
    NULLIF(current_setting('app.verification_reason', true), ''), '/consultant/verification', NEW.id::text);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'verification notice skipped: %', SQLERRM;
  RETURN NEW;
END
$$;

-- The consultant decision with its comment in ONE request (so the notice and e-mail carry the comment).
CREATE OR REPLACE FUNCTION public.admin_review_consultant(_cid uuid, _status text, _comment text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _c text := NULLIF(btrim(COALESCE(_comment, '')), '');
  _uid uuid;
  _cur text;
BEGIN
  IF NOT public.ame_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF _status IS NULL OR _status NOT IN ('pending', 'under_review', 'on_hold', 'verified', 'rejected', 'suspended') THEN
    RAISE EXCEPTION 'Unknown decision' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(_c, '')) > 1000 THEN RAISE EXCEPTION 'The comment is too long (1000 characters at most)' USING ERRCODE = '22023'; END IF;
  IF NOT public.check_rate_limit('admin_review_consultant:' || auth.uid()::text, 120, 3600) THEN
    RAISE EXCEPTION 'Too many decisions in the last hour. Please try again later.' USING ERRCODE = '54000';
  END IF;
  SELECT user_id, verification_status::text INTO _uid, _cur FROM public.consultants WHERE id = _cid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultant not found' USING ERRCODE = 'P0002'; END IF;
  IF _uid = auth.uid() THEN RAISE EXCEPTION 'You cannot review your own profile' USING ERRCODE = '42501'; END IF;
  IF _cur = _status THEN RAISE EXCEPTION 'This consultant already has this status' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('app.verification_reason', COALESCE(_c, ''), true);
  UPDATE public.consultants SET verification_status = _status::public.verification_status WHERE id = _cid;
  PERFORM set_config('app.verification_reason', '', true);
  RETURN jsonb_build_object('ok', true, 'email', (
    SELECT jsonb_build_object('status', e.status, 'reason', e.reason) FROM public.admin_message_emails e
    JOIN public.notifications n ON n.id = e.notification_id
    WHERE e.recipient = _uid AND n.type = 'approval' ORDER BY e.created_at DESC LIMIT 1));
END
$$;
REVOKE ALL ON FUNCTION public.admin_review_consultant(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_consultant(uuid, text, text) TO authenticated;

-- Path 4: client approval / request changes / rejection / re-approval (same rules as before, decision notice at the end).
CREATE OR REPLACE FUNCTION public.admin_review_client(p_user_id uuid, p_decision text, p_comment text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _admin uuid := auth.uid();
  _r public.client_profiles%ROWTYPE;
  _comment text := NULLIF(btrim(COALESCE(p_comment, '')), '');
  _new text;
  _event text;
BEGIN
  IF _admin IS NULL OR NOT (public.has_role(_admin, 'admin'::app_role) OR public.has_role(_admin, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('approve', 'request_changes', 'reject') THEN
    RAISE EXCEPTION 'Unknown decision' USING ERRCODE = '22023';
  END IF;
  IF _comment IS NOT NULL AND char_length(_comment) > 2000 THEN
    RAISE EXCEPTION 'The comment is too long (2000 characters at most)' USING ERRCODE = '22023';
  END IF;
  IF p_decision <> 'approve' AND (_comment IS NULL OR char_length(_comment) < 3) THEN
    RAISE EXCEPTION 'Write a comment so the client knows what to do' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL OR p_user_id = _admin THEN
    RAISE EXCEPTION 'You cannot review your own account' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _r FROM public.client_profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_decision = 'approve' THEN
    _new := 'approved'; _event := 'approved';
  ELSIF p_decision = 'request_changes' THEN
    _new := 'changes_requested'; _event := 'changes_requested';
  ELSE
    _new := 'rejected'; _event := 'rejected';
  END IF;

  IF _r.approval_status = 'draft' AND p_decision <> 'approve' THEN
    RAISE EXCEPTION 'This client has not sent their information yet' USING ERRCODE = '22023';
  END IF;
  IF _r.approval_status = _new AND _new <> 'changes_requested' THEN
    RAISE EXCEPTION 'This client is already %', replace(_new, '_', ' ') USING ERRCODE = '22023';
  END IF;

  UPDATE public.client_profiles
     SET approval_status = _new, approval_reviewed_at = now(), approval_reviewed_by = _admin, approval_comment = _comment
   WHERE user_id = p_user_id;
  INSERT INTO public.client_approval_events (client_user_id, event_type, note, actor_id)
  VALUES (p_user_id, _event, _comment, _admin);
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (_admin, 'client_approval.' || _event, 'client_profile', p_user_id,
          jsonb_build_object('from', _r.approval_status, 'to', _new, 'comment', left(COALESCE(_comment, ''), 500)));

  PERFORM public.ame_decision_notice(p_user_id, 'client_account',
    CASE WHEN _new = 'approved' AND _r.approval_status = 'rejected' THEN 'reapproved' WHEN _new = 'approved' THEN 'approved'
         WHEN _new = 'changes_requested' THEN 'changes' ELSE 'rejected' END,
    _comment, CASE WHEN _new = 'approved' THEN '/client' ELSE '/client/company' END, p_user_id::text);
END;
$$;

-- Path 5: certificate verified / verification removed (admin screens update certifications.verified).
CREATE OR REPLACE FUNCTION public.ame_on_certificate_review()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.ame_is_admin(auth.uid()) OR NEW.verified IS NOT DISTINCT FROM OLD.verified THEN RETURN NULL; END IF;
  IF NOT (NEW.verified IS TRUE OR OLD.verified IS TRUE) THEN RETURN NULL; END IF;
  PERFORM public.ame_decision_notice((SELECT c.user_id FROM public.consultants c WHERE c.id = NEW.consultant_id), 'certificate',
    CASE WHEN NEW.verified IS TRUE THEN 'approved' ELSE 'unverified' END,
    NULLIF(current_setting('app.ame_decision_comment', true), ''), '/consultant/profile', NEW.id::text, NEW.name);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'certificate decision notice skipped: %', SQLERRM;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.ame_on_certificate_review() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ame_certificate_review ON public.certifications;
CREATE TRIGGER trg_ame_certificate_review AFTER UPDATE OF verified ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION public.ame_on_certificate_review();

-- Path 6: LinkedIn / Credly checked or check removed (admin screens set linkedin_checked_at / credly_checked_at).
CREATE OR REPLACE FUNCTION public.ame_on_link_review()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _c text := NULLIF(current_setting('app.ame_decision_comment', true), '');
BEGIN
  IF NOT public.ame_is_admin(auth.uid()) THEN RETURN NULL; END IF;
  IF (OLD.linkedin_checked_at IS NULL) <> (NEW.linkedin_checked_at IS NULL) THEN
    PERFORM public.ame_decision_notice(NEW.user_id, 'linkedin', CASE WHEN NEW.linkedin_checked_at IS NOT NULL THEN 'approved' ELSE 'unverified' END,
      _c, '/consultant/profile', NEW.id::text);
  END IF;
  IF (OLD.credly_checked_at IS NULL) <> (NEW.credly_checked_at IS NULL) THEN
    PERFORM public.ame_decision_notice(NEW.user_id, 'credly', CASE WHEN NEW.credly_checked_at IS NOT NULL THEN 'approved' ELSE 'unverified' END,
      _c, '/consultant/profile', NEW.id::text);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'link decision notice skipped: %', SQLERRM;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.ame_on_link_review() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ame_link_review ON public.consultants;
CREATE TRIGGER trg_ame_link_review AFTER UPDATE OF linkedin_checked_at, credly_checked_at ON public.consultants
  FOR EACH ROW EXECUTE FUNCTION public.ame_on_link_review();

-- Path 7: verification document / item accepted by an admin ("approve with items" follow-ups).
CREATE OR REPLACE FUNCTION public.ame_on_item_review()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.ame_is_admin(auth.uid()) OR NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status <> 'verified' THEN RETURN NULL; END IF;
  PERFORM public.ame_decision_notice((SELECT c.user_id FROM public.consultants c WHERE c.id = NEW.consultant_id), 'document', 'approved',
    NULLIF(current_setting('app.ame_decision_comment', true), ''), '/consultant/verification', NEW.id::text, NEW.label);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'document decision notice skipped: %', SQLERRM;
  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION public.ame_on_item_review() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ame_item_review ON public.consultant_verification_items;
CREATE TRIGGER trg_ame_item_review AFTER UPDATE OF status ON public.consultant_verification_items
  FOR EACH ROW EXECUTE FUNCTION public.ame_on_item_review();

-- Path 8: success stories verified / hidden (needs changes) / rejected / restored (same rules as before + notice).
CREATE OR REPLACE FUNCTION public.admin_achievement_review(_id uuid, _action text, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _a public.consultant_achievements; _new text;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'permission_missing' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _a FROM public.consultant_achievements WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  _new := CASE _action WHEN 'verify' THEN 'verified' WHEN 'hide' THEN 'hidden' WHEN 'reject' THEN 'rejected' WHEN 'restore' THEN 'self_declared' END;
  IF _new IS NULL THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023'; END IF;
  IF _action IN ('hide', 'reject') AND char_length(btrim(COALESCE(_reason, ''))) < 5 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023'; END IF;
  IF _action = 'verify' AND _a.evidence_path IS NULL AND _a.reference_url IS NULL THEN RAISE EXCEPTION 'achievement_no_evidence' USING ERRCODE = '22023'; END IF;
  UPDATE public.consultant_achievements SET status = _new, review_reason = NULLIF(left(btrim(COALESCE(_reason, '')), 500), ''),
    reviewed_by = auth.uid(), reviewed_at = now() WHERE id = _id;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'achievement_' || _action, 'consultant_achievement', _id,
          jsonb_build_object('consultant_id', _a.consultant_id, 'from', _a.status, 'to', _new, 'reason', left(COALESCE(_reason, ''), 500)));
  PERFORM public.ame_decision_notice((SELECT c.user_id FROM public.consultants c WHERE c.id = _a.consultant_id), 'success_story',
    CASE _action WHEN 'verify' THEN 'approved' WHEN 'hide' THEN 'changes' WHEN 'reject' THEN 'rejected' ELSE 'reapproved' END,
    _reason, '/consultant/profile', _id::text, _a.title);
END $$;

-- Path 9: account suspension / reactivation (the admin-manage-user server function, no signed-in admin session).
CREATE OR REPLACE FUNCTION public.ame_decision_service(_actor uuid, _to uuid, _outcome text, _comment text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF _outcome NOT IN ('suspended', 'reactivated') THEN RAISE EXCEPTION 'ame_decision_kind' USING ERRCODE = '22023'; END IF;
  IF NOT public.ame_is_admin(_actor) THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  RETURN public.ame_decision_notice(_to, 'account', _outcome, _comment, CASE WHEN _outcome = 'reactivated' THEN '/login' ELSE '/' END,
    _to::text || ':' || txid_current()::text, NULL, _actor);
END
$$;
REVOKE ALL ON FUNCTION public.ame_decision_service(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ame_decision_service(uuid, uuid, text, text) TO service_role;

-- The line next to every decision comment box: which address the decision goes to, or why it will not be e-mailed.
CREATE OR REPLACE FUNCTION public.admin_decision_recipient(_user uuid DEFAULT NULL, _consultant uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := _user; _email text; _confirmed timestamptz;
BEGIN
  IF NOT public.ame_is_admin(auth.uid()) THEN RAISE EXCEPTION 'Administrators only' USING ERRCODE = '42501'; END IF;
  IF _uid IS NULL THEN SELECT c.user_id INTO _uid FROM public.consultants c WHERE c.id = _consultant; END IF;
  IF _uid IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT NULLIF(btrim(COALESCE(u.email, '')), ''), u.email_confirmed_at INTO _email, _confirmed FROM auth.users u WHERE u.id = _uid;
  RETURN jsonb_build_object('found', true, 'user_id', _uid, 'email', _email, 'confirmed', _confirmed IS NOT NULL,
    'test', public.ame_is_test_user(_uid),
    'suppressed', _email IS NOT NULL AND EXISTS (SELECT 1 FROM public.suppressed_emails s WHERE lower(s.email) = lower(_email)),
    'lang', (SELECT CASE WHEN p.preferred_language LIKE 'ar%' THEN 'ar' ELSE 'en' END FROM public.profiles p WHERE p.user_id = _uid LIMIT 1),
    'enabled', public.platform_flag('admin_messages_email_enabled', true));
END
$$;
REVOKE ALL ON FUNCTION public.admin_decision_recipient(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_decision_recipient(uuid, uuid) TO authenticated;
