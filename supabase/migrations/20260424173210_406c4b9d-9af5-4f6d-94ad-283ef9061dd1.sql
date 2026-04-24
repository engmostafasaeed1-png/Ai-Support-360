CREATE OR REPLACE FUNCTION public.notify_session_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _consultant_user_id uuid;
  _client_name text;
  _consultant_name text;
  _when text;
  _is_confirmed boolean := false;
  _is_started boolean := false;
  _link text;
BEGIN
  -- Resolve consultant's auth user_id (consultants.id -> consultants.user_id)
  IF NEW.consultant_id IS NOT NULL THEN
    SELECT user_id INTO _consultant_user_id
    FROM public.consultants
    WHERE id = NEW.consultant_id;
  END IF;

  -- Display names for nicer copy
  IF NEW.client_id IS NOT NULL THEN
    SELECT display_name INTO _client_name
    FROM public.profiles WHERE user_id = NEW.client_id;
  END IF;
  IF _consultant_user_id IS NOT NULL THEN
    SELECT display_name INTO _consultant_name
    FROM public.profiles WHERE user_id = _consultant_user_id;
  END IF;

  -- Pretty schedule string (UTC) for the notification body
  IF NEW.scheduled_at IS NOT NULL THEN
    _when := to_char(NEW.scheduled_at AT TIME ZONE 'UTC', 'Mon DD, YYYY "at" HH24:MI" UTC"');
  ELSE
    _when := 'soon';
  END IF;

  -- Decide which lifecycle event we just witnessed
  IF TG_OP = 'INSERT' THEN
    _is_confirmed := COALESCE(NEW.status, 'scheduled') = 'scheduled';
    _is_started := NEW.status = 'in_progress';
  ELSIF TG_OP = 'UPDATE' THEN
    _is_confirmed := NEW.status = 'scheduled' AND OLD.status IS DISTINCT FROM 'scheduled';
    _is_started := NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress';
  END IF;

  -- Notify on confirmation
  IF _is_confirmed THEN
    IF NEW.client_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, body, type, link)
      VALUES (
        NEW.client_id,
        'Session Confirmed',
        'Your ' || COALESCE(NEW.session_type::text, 'session') ||
          ' with ' || COALESCE(_consultant_name, 'your consultant') ||
          ' is confirmed for ' || _when || '.',
        'session',
        '/client/sessions/' || NEW.id
      );
    END IF;

    IF _consultant_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, body, type, link)
      VALUES (
        _consultant_user_id,
        'Session Confirmed',
        'Your ' || COALESCE(NEW.session_type::text, 'session') ||
          ' with ' || COALESCE(_client_name, 'a client') ||
          ' is confirmed for ' || _when || '.',
        'session',
        '/consultant/sessions/' || NEW.id
      );
    END IF;
  END IF;

  -- Notify on start
  IF _is_started THEN
    IF NEW.client_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, body, type, link)
      VALUES (
        NEW.client_id,
        'Session Starting Now',
        'Your ' || COALESCE(NEW.session_type::text, 'session') ||
          ' with ' || COALESCE(_consultant_name, 'your consultant') ||
          ' has started. Join now.',
        'session',
        '/client/sessions/' || NEW.id
      );
    END IF;

    IF _consultant_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, body, type, link)
      VALUES (
        _consultant_user_id,
        'Session Starting Now',
        'Your ' || COALESCE(NEW.session_type::text, 'session') ||
          ' with ' || COALESCE(_client_name, 'a client') ||
          ' has started.',
        'session',
        '/consultant/sessions/' || NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_session_lifecycle_ins ON public.sessions;
DROP TRIGGER IF EXISTS trg_notify_session_lifecycle_upd ON public.sessions;

CREATE TRIGGER trg_notify_session_lifecycle_ins
AFTER INSERT ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.notify_session_lifecycle();

CREATE TRIGGER trg_notify_session_lifecycle_upd
AFTER UPDATE OF status ON public.sessions
FOR EACH ROW
EXECUTE FUNCTION public.notify_session_lifecycle();

-- Ensure realtime is enabled (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;