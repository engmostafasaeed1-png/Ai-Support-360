-- Add delivery tracking columns to notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'delivered',
  ADD COLUMN IF NOT EXISTS delivery_error TEXT,
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_delivery_status_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_delivery_status_check
  CHECK (delivery_status IN ('pending','delivered','failed'));

CREATE INDEX IF NOT EXISTS idx_notifications_delivery_status
  ON public.notifications(user_id, delivery_status);

-- Safe insert helper: never raises, records 'failed' row on error.
-- Returns the inserted notification id (or NULL if even the failure log failed).
CREATE OR REPLACE FUNCTION public.safe_insert_notification(
  _user_id UUID,
  _title TEXT,
  _body TEXT,
  _type TEXT,
  _link TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _id UUID;
BEGIN
  BEGIN
    INSERT INTO public.notifications (user_id, title, body, type, link, delivery_status, last_attempt_at)
    VALUES (_user_id, _title, _body, _type, _link, 'delivered', now())
    RETURNING id INTO _id;
    RETURN _id;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.notifications (user_id, title, body, type, link, delivery_status, delivery_error, last_attempt_at)
      VALUES (_user_id, _title, _body, _type, _link, 'failed', SQLERRM, now())
      RETURNING id INTO _id;
      RETURN _id;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'safe_insert_notification: failed to log failure for user %: %', _user_id, SQLERRM;
      RETURN NULL;
    END;
  END;
END;
$$;

-- Retry a failed notification (re-attempt the insert, then mark/delete original)
CREATE OR REPLACE FUNCTION public.retry_failed_notification(_id UUID)
RETURNS public.notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _row public.notifications;
  _result public.notifications;
BEGIN
  SELECT * INTO _row FROM public.notifications WHERE id = _id;

  IF _row IS NULL THEN
    RAISE EXCEPTION 'Notification % not found', _id;
  END IF;

  IF _row.user_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized to retry this notification';
  END IF;

  IF _row.delivery_status <> 'failed' THEN
    RETURN _row; -- nothing to do
  END IF;

  BEGIN
    UPDATE public.notifications
    SET delivery_status = 'delivered',
        delivery_error = NULL,
        retry_count = retry_count + 1,
        last_attempt_at = now(),
        is_read = false
    WHERE id = _id
    RETURNING * INTO _result;
    RETURN _result;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.notifications
    SET retry_count = retry_count + 1,
        last_attempt_at = now(),
        delivery_error = SQLERRM
    WHERE id = _id
    RETURNING * INTO _result;
    RETURN _result;
  END;
END;
$$;

-- Replace notify_session_lifecycle to use safe_insert_notification
CREATE OR REPLACE FUNCTION public.notify_session_lifecycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user_id uuid;
  _client_name text;
  _consultant_name text;
  _when text;
  _is_confirmed boolean := false;
  _is_started boolean := false;
BEGIN
  IF NEW.consultant_id IS NOT NULL THEN
    SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    SELECT display_name INTO _client_name FROM public.profiles WHERE user_id = NEW.client_id;
  END IF;
  IF _consultant_user_id IS NOT NULL THEN
    SELECT display_name INTO _consultant_name FROM public.profiles WHERE user_id = _consultant_user_id;
  END IF;

  IF NEW.scheduled_at IS NOT NULL THEN
    _when := to_char(NEW.scheduled_at AT TIME ZONE 'UTC', 'Mon DD, YYYY "at" HH24:MI" UTC"');
  ELSE
    _when := 'soon';
  END IF;

  IF TG_OP = 'INSERT' THEN
    _is_confirmed := COALESCE(NEW.status, 'scheduled') = 'scheduled';
    _is_started := NEW.status = 'in_progress';
  ELSIF TG_OP = 'UPDATE' THEN
    _is_confirmed := NEW.status = 'scheduled' AND OLD.status IS DISTINCT FROM 'scheduled';
    _is_started := NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress';
  END IF;

  IF _is_confirmed THEN
    IF NEW.client_id IS NOT NULL THEN
      PERFORM public.safe_insert_notification(
        NEW.client_id, 'Session Confirmed',
        'Your ' || COALESCE(NEW.session_type::text, 'session') || ' with ' || COALESCE(_consultant_name, 'your consultant') || ' is confirmed for ' || _when || '.',
        'session', '/client/sessions/' || NEW.id
      );
    END IF;
    IF _consultant_user_id IS NOT NULL THEN
      PERFORM public.safe_insert_notification(
        _consultant_user_id, 'Session Confirmed',
        'Your ' || COALESCE(NEW.session_type::text, 'session') || ' with ' || COALESCE(_client_name, 'a client') || ' is confirmed for ' || _when || '.',
        'session', '/consultant/sessions/' || NEW.id
      );
    END IF;
  END IF;

  IF _is_started THEN
    IF NEW.client_id IS NOT NULL THEN
      PERFORM public.safe_insert_notification(
        NEW.client_id, 'Session Starting Now',
        'Your ' || COALESCE(NEW.session_type::text, 'session') || ' with ' || COALESCE(_consultant_name, 'your consultant') || ' has started. Join now.',
        'session', '/client/sessions/' || NEW.id
      );
    END IF;
    IF _consultant_user_id IS NOT NULL THEN
      PERFORM public.safe_insert_notification(
        _consultant_user_id, 'Session Starting Now',
        'Your ' || COALESCE(NEW.session_type::text, 'session') || ' with ' || COALESCE(_client_name, 'a client') || ' has started.',
        'session', '/consultant/sessions/' || NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;