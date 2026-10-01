CREATE OR REPLACE FUNCTION public.notify_admin_requested_interview()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  _label := CASE NEW.interview_type::text WHEN 'ai' THEN 'an AI' WHEN 'physical' THEN 'an in-person' WHEN 'online' THEN 'an online' ELSE 'a ' || NEW.interview_type::text END;

  -- Proposed time slots are stored by the re-interview dialog in skill_results.proposed_slots
  IF jsonb_typeof(NEW.skill_results -> 'proposed_slots') = 'array' THEN
    SELECT string_agg(left(concat_ws(' ', s ->> 'date', concat_ws('-', s ->> 'start_time', s ->> 'end_time')), 40), ', ')
      INTO _slots
    FROM (SELECT s FROM jsonb_array_elements(NEW.skill_results -> 'proposed_slots') AS s LIMIT 5) q;
  END IF;

  PERFORM public.safe_insert_notification(
    _consultant_user,
    'Re-Interview Requested',
    'You have been requested for ' || _label || ' re-interview.' || CASE WHEN _slots IS NOT NULL THEN ' Proposed times: ' || _slots || '.' ELSE '' END,
    'interview',
    '/consultant/interviews'
  );

  IF NEW.interview_type::text IN ('physical', 'online') THEN
    FOR _admin IN SELECT DISTINCT user_id FROM public.user_roles WHERE role IN ('admin', 'super_admin') LOOP
      PERFORM public.safe_insert_notification(
        _admin,
        'Interview scheduling request',
        upper(left(_label, 1)) || substr(_label, 2) || ' re-interview was requested with proposed time slots. Open the approvals page to follow up.',
        'interview',
        '/admin/approvals'
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_admin_requested_interview() FROM PUBLIC, anon, authenticated;