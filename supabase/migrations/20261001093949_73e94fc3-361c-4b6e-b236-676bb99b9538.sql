-- 1) The consultant is told when an administrator changes their verification status
CREATE OR REPLACE FUNCTION public.notify_consultant_verification_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _title text;
  _body text;
BEGIN
  IF NEW.verification_status IS NOT DISTINCT FROM OLD.verification_status THEN
    RETURN NEW;
  END IF;

  CASE NEW.verification_status::text
    WHEN 'verified' THEN
      _title := 'Your profile has been approved';
      _body := 'Congratulations! Your consultant profile is verified and clients can now find and book you.';
    WHEN 'rejected' THEN
      _title := 'Your application was not approved';
      _body := 'An administrator reviewed your application and did not approve it. Open the Verification page or contact support for details.';
    WHEN 'under_review' THEN
      _title := 'Your application is under review';
      _body := 'An administrator is reviewing your profile. You will be notified when a decision is made.';
    WHEN 'on_hold' THEN
      _title := 'Your application is on hold';
      _body := 'An administrator put your application on hold. Open the Verification page or contact support for details.';
    WHEN 'suspended' THEN
      _title := 'Your profile has been suspended';
      _body := 'Your consultant profile was suspended. Please contact support for details.';
    ELSE
      RETURN NEW;
  END CASE;

  PERFORM public.safe_insert_notification(NEW.user_id, _title, _body, 'approval', '/consultant/verification');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_consultant_verification_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_consultant_verification_change
AFTER UPDATE OF verification_status ON public.consultants
FOR EACH ROW
WHEN (OLD.verification_status IS DISTINCT FROM NEW.verification_status)
EXECUTE FUNCTION public.notify_consultant_verification_change();

-- 2) Live interview: the candidate (and any interviewer added by someone else) is told
CREATE OR REPLACE FUNCTION public.notify_live_interview_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _style text;
  _scheduled timestamptz;
  _requested_by uuid;
  _when text;
BEGIN
  SELECT interview_style, scheduled_at, requested_by
    INTO _style, _scheduled, _requested_by
  FROM public.interview_sessions WHERE id = NEW.session_id;

  IF _style IS DISTINCT FROM 'live' THEN
    RETURN NEW;
  END IF;

  _when := CASE WHEN _scheduled IS NOT NULL
                THEN to_char(_scheduled AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
                ELSE NULL END;

  IF NEW.role = 'candidate' THEN
    PERFORM public.safe_insert_notification(
      NEW.user_id,
      'Live interview scheduled',
      CASE WHEN _when IS NOT NULL THEN 'Your live interview is on ' || _when || '.' ELSE 'A live interview is ready for you to join.' END,
      'interview',
      '/interview/live/' || NEW.session_id::text
    );
  ELSIF NEW.role = 'interviewer' AND NEW.user_id IS DISTINCT FROM _requested_by THEN
    PERFORM public.safe_insert_notification(
      NEW.user_id,
      'You were added to a live interview',
      CASE WHEN _when IS NOT NULL THEN 'You are an interviewer in a live interview on ' || _when || '.' ELSE 'You are an interviewer in a live interview that is ready to start.' END,
      'interview',
      '/interview/live/' || NEW.session_id::text
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.notify_live_interview_participant() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_live_interview_participant
AFTER INSERT ON public.interview_participants
FOR EACH ROW
EXECUTE FUNCTION public.notify_live_interview_participant();

-- 3) Re-interview requested by an administrator: the consultant (and, for in-person/online, every admin) is told
CREATE OR REPLACE FUNCTION public.notify_interview_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _consultant_user uuid;
  _label text;
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

  PERFORM public.safe_insert_notification(
    _consultant_user,
    'Re-Interview Requested',
    'You have been requested for a ' || _label || ' re-interview.',
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
REVOKE EXECUTE ON FUNCTION public.notify_interview_requested() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_interview_requested
AFTER INSERT ON public.interview_sessions
FOR EACH ROW
EXECUTE FUNCTION public.notify_interview_requested();

-- 4) Hygiene: this trigger function should not be callable by signed-in or anonymous users
REVOKE EXECUTE ON FUNCTION public.validate_interview_style() FROM PUBLIC, anon, authenticated;