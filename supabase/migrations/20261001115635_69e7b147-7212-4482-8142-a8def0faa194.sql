ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS meeting_url text,
  ADD COLUMN IF NOT EXISTS duration_minutes integer NOT NULL DEFAULT 60;

ALTER TABLE public.interview_sessions
  ADD CONSTRAINT interview_sessions_meeting_url_check
    CHECK (meeting_url IS NULL OR (meeting_url ~ '^https://[^[:space:]]+$' AND length(meeting_url) <= 500)),
  ADD CONSTRAINT interview_sessions_duration_minutes_check
    CHECK (duration_minutes BETWEEN 15 AND 240);

CREATE OR REPLACE FUNCTION public.set_live_interview_meeting_url()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only admins choose the link or the length of an interview; everybody else gets the defaults and cannot change them.
  IF public.is_untrusted_writer() THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.meeting_url := OLD.meeting_url;
      NEW.duration_minutes := OLD.duration_minutes;
      RETURN NEW;
    END IF;
    NEW.meeting_url := NULL;
    NEW.duration_minutes := 60;
  END IF;
  IF NEW.interview_style = 'live' AND NEW.meeting_url IS NULL THEN
    NEW.meeting_url := 'https://meet.jit.si/qurtuba-interview-' || replace(NEW.id::text, '-', '');
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_live_interview_meeting_url() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_set_live_interview_meeting_url ON public.interview_sessions;
CREATE TRIGGER trg_set_live_interview_meeting_url
  BEFORE INSERT OR UPDATE ON public.interview_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_live_interview_meeting_url();