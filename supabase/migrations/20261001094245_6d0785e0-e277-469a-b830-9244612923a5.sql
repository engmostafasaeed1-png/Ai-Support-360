-- 1) Restore the original function used by the ticket_interviews trigger (verbatim from migration 20260410171900)
CREATE OR REPLACE FUNCTION public.notify_interview_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _consultant_user_id uuid;
  _ticket_title text;
BEGIN
  SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
  SELECT title INTO _ticket_title FROM public.tickets WHERE id = NEW.ticket_id;

  IF _consultant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      _consultant_user_id,
      'Interview Requested',
      'Client has requested a pre-work interview for ticket "' || COALESCE(_ticket_title, 'Untitled') || '".',
      'interview',
      '/consultant/cases/' || NEW.ticket_id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- 2) The admin-requested re-interview notifications live in their own function and trigger
DROP TRIGGER IF EXISTS trg_notify_interview_requested ON public.interview_sessions;

CREATE OR REPLACE FUNCTION public.notify_admin_requested_interview()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _consultant_user uuid;
  _label text;
  _slots text;
  _admin uuid;
BEGIN
  -- Only interviews that an administrator requests for a consultant; live sessions are announced by the participants trigger.
  IF NEW.requested_by IS NULL OR NEW.interview_style = 'live' THEN
    RETURN NEW;
  END IF;
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO _consultant_user FROM public.consultants WHERE id = NEW.consultant_id;
  IF _consultant_user IS NULL OR _consultant_user = auth.uid() THEN
    RETURN NEW;
  END IF;

  _label := CASE NEW.interview_type::text WHEN 'ai' THEN 'AI' WHEN 'physical' THEN 'in-person' WHEN 'online' THEN 'online' ELSE NEW.interview_type::text END;

  -- Proposed time slots are stored by the re-interview dialog in skill_results.proposed_slots
  IF jsonb_typeof(NEW.skill_results -> 'proposed_slots') = 'array' THEN
    SELECT string_agg(left(concat_ws(' ', s ->> 'date', concat_ws('-', s ->> 'start_time', s ->> 'end_time')), 40), ', ')
      INTO _slots
    FROM (SELECT s FROM jsonb_array_elements(NEW.skill_results -> 'proposed_slots') AS s LIMIT 5) q;
  END IF;

  PERFORM public.safe_insert_notification(
    _consultant_user,
    'Re-Interview Requested',
    'You have been requested for a ' || _label || ' re-interview.' || CASE WHEN _slots IS NOT NULL THEN ' Proposed times: ' || _slots || '.' ELSE '' END,
    'interview',
    '/consultant/interviews'
  );

  IF NEW.interview_type::text IN ('physical', 'online') THEN
    FOR _admin IN SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('admin', 'super_admin') LOOP
      PERFORM public.safe_insert_notification(
        _admin,
        'Interview scheduling request',
        'A ' || _label || ' re-interview was requested with proposed time slots. Open the approvals page to follow up.',
        'interview',
        '/admin/approvals'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_admin_requested_interview() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_admin_requested_interview ON public.interview_sessions;
CREATE TRIGGER trg_notify_admin_requested_interview
AFTER INSERT ON public.interview_sessions
FOR EACH ROW
EXECUTE FUNCTION public.notify_admin_requested_interview();