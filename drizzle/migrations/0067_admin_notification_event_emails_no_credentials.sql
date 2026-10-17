ALTER TABLE public.notifications ADD COLUMN emailed_at timestamptz;
UPDATE public.notifications SET emailed_at = now(), delivery_error = 'historical: email not sent';
CREATE INDEX notifications_unemailed_created_idx ON public.notifications (created_at) WHERE emailed_at IS NULL;

CREATE OR REPLACE FUNCTION public.admin_notification_email_rate(_user_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$ SELECT public.check_rate_limit('admin-mail:' || _user_id::text, 30, 3600) $$;
REVOKE ALL ON FUNCTION public.admin_notification_email_rate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_notification_email_rate(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_admin_notification_email(_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n public.notifications;
BEGIN
  SELECT * INTO n FROM public.notifications WHERE id = _id FOR UPDATE;
  IF NOT FOUND OR n.emailed_at IS NOT NULL OR COALESCE(n.retry_count, 0) >= 5
     OR NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = n.user_id AND role IN ('admin','super_admin'))
     OR (n.delivery_error = 'email sending' AND n.last_attempt_at > now() - interval '10 minutes') THEN
    RETURN NULL;
  END IF;
  IF NOT public.platform_flag('email_notifications', true)
     OR NOT public.platform_flag('admin_alerts', true)
     OR NOT public.platform_flag('admin_email_alerts', true) THEN
    UPDATE public.notifications SET emailed_at = now(), delivery_error = 'notifications disabled' WHERE id = _id;
    RETURN NULL;
  END IF;
  IF NOT public.admin_notification_email_rate(n.user_id) THEN
    UPDATE public.notifications SET emailed_at = now(), delivery_error = 'rate limited' WHERE id = _id;
    RETURN NULL;
  END IF;
  UPDATE public.notifications SET retry_count = COALESCE(retry_count, 0) + 1,
    last_attempt_at = now(), delivery_error = 'email sending' WHERE id = _id RETURNING * INTO n;
  RETURN jsonb_build_object('id', n.id, 'user_id', n.user_id, 'title', n.title,
    'body', n.body, 'link', n.link, 'attempt', n.retry_count);
END $$;
REVOKE ALL ON FUNCTION public.claim_admin_notification_email(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin_notification_email(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_admin_notification_email(_id uuid, _attempt integer, _handled boolean, _error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.notifications SET
    emailed_at = CASE WHEN _handled THEN now() ELSE NULL END,
    delivery_error = left(_error, 500)
  WHERE id = _id AND emailed_at IS NULL AND retry_count = _attempt AND delivery_error = 'email sending';
END $$;
REVOKE ALL ON FUNCTION public.finish_admin_notification_email(uuid, integer, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_admin_notification_email(uuid, integer, boolean, text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_notification_email_count()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN (SELECT count(*) FROM public.notifications n
    WHERE n.emailed_at > now() - interval '24 hours' AND n.delivery_error IS NULL
      AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = n.user_id AND role IN ('admin','super_admin')));
END $$;
REVOKE ALL ON FUNCTION public.admin_notification_email_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_notification_email_count() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trigger_admin_notification_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.user_id AND role IN ('admin','super_admin')) THEN
    RETURN NEW;
  END IF;
  BEGIN
    IF NOT public.platform_flag('email_notifications', true)
       OR NOT public.platform_flag('admin_alerts', true)
       OR NOT public.platform_flag('admin_email_alerts', true) THEN
      UPDATE public.notifications SET emailed_at = now(), delivery_error = 'notifications disabled' WHERE id = NEW.id;
    ELSE
      PERFORM net.http_post(
        url := 'https://ozzgsfsnlejfuexikwrm.supabase.co/functions/v1/admin-notification-email',
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body := jsonb_build_object('notification_id', NEW.id), timeout_milliseconds := 1000);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      UPDATE public.notifications SET delivery_error = 'email event enqueue failed' WHERE id = NEW.id;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.trigger_admin_notification_email() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER notifications_admin_email_event AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.trigger_admin_notification_email();