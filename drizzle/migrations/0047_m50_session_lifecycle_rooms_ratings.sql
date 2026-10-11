-- M50: the life of a consultation session, one video room per session, honest ratings, the rate of an administrator's work entry.

-- 1) one room per session --------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_session_meeting_url()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.meeting_url ~ '^https://meet\.jit\.si/(qurtuba|aisupportnow)-[0-9a-f]+$' THEN
    NEW.meeting_url := 'https://meet.jit.si/ai-support-360-' || replace(NEW.id::text, '-', '');
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.normalize_session_meeting_url() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_normalize_session_meeting_url
  BEFORE INSERT OR UPDATE OF meeting_url ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.normalize_session_meeting_url();

UPDATE public.sessions
   SET meeting_url = 'https://meet.jit.si/ai-support-360-' || replace(id::text, '-', '')
 WHERE meeting_url ~ '^https://meet\.jit\.si/(qurtuba|aisupportnow)-[0-9a-f]+$';

-- 2) the life of a session ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_session(_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _s record;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT s.id, s.status::text AS status, s.client_id, s.scheduled_at, s.duration_minutes, c.user_id AS consultant_user
    INTO _s
    FROM public.sessions s
    LEFT JOIN public.consultants c ON c.id = s.consultant_id
   WHERE s.id = _session_id
   FOR UPDATE OF s;
  IF NOT FOUND OR (_s.client_id <> _uid AND _s.consultant_user IS DISTINCT FROM _uid) THEN
    RAISE EXCEPTION 'Session not found' USING ERRCODE = '42501';
  END IF;
  IF _s.status NOT IN ('scheduled', 'in_progress') THEN
    RAISE EXCEPTION 'This session is already %', _s.status USING ERRCODE = '42501';
  END IF;
  IF _s.scheduled_at IS NULL OR _s.scheduled_at > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'A session can be marked as completed only after it has started' USING ERRCODE = '42501';
  END IF;
  UPDATE public.sessions
     SET status = 'completed',
         started_at = COALESCE(started_at, scheduled_at),
         ended_at = LEAST(now(), scheduled_at + make_interval(mins => GREATEST(COALESCE(NULLIF(duration_minutes, 0), 60), 1)))
   WHERE id = _s.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_session(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_session_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;
  IF OLD.status::text = 'scheduled' AND NEW.status::text = 'cancelled' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'The status of a session changes only with Cancel session or Mark as completed' USING ERRCODE = '42501';
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_session_status_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_session_status_change
  BEFORE UPDATE OF status ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_session_status_change();

-- 3) no booking with yourself, no rating of yourself ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_no_self_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.consultant_id IS NOT NULL AND public.is_untrusted_writer()
     AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = NEW.consultant_id AND c.user_id = NEW.client_id) THEN
    RAISE EXCEPTION 'You can not book a session with yourself' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_no_self_session() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_no_self_session
  BEFORE INSERT ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_self_session();

CREATE OR REPLACE FUNCTION public.guard_no_self_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_untrusted_writer()
     AND EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = NEW.consultant_id AND c.user_id = NEW.client_id) THEN
    RAISE EXCEPTION 'You can not rate yourself' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.guard_no_self_rating() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_no_self_rating
  BEFORE INSERT ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.guard_no_self_rating();

-- 4) the rate of a work entry (same function as before; the approved rate is now filled in for everybody) -------
CREATE OR REPLACE FUNCTION public.validate_work_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _rate numeric;
  _locked boolean;
BEGIN
  IF NEW.hours IS NULL OR NEW.hours <= 0 OR NEW.hours > 24 THEN
    RAISE EXCEPTION 'Hours must be greater than 0 and at most 24 per entry' USING ERRCODE = '22023';
  END IF;
  IF NEW.work_date IS NOT NULL AND (NEW.work_date > current_date + 1 OR NEW.work_date < current_date - 365) THEN
    RAISE EXCEPTION 'The work date must be within the last year and not in the future' USING ERRCODE = '22023';
  END IF;
  IF NEW.hourly_rate IS NOT NULL AND (NEW.hourly_rate < 0 OR NEW.hourly_rate > 100000) THEN
    RAISE EXCEPTION 'Invalid hourly rate' USING ERRCODE = '22023';
  END IF;
  IF NEW.description IS NOT NULL AND char_length(NEW.description) > 5000 THEN
    RAISE EXCEPTION 'The description is too long' USING ERRCODE = '22023';
  END IF;

  -- a new entry without a rate gets the rate the client approved for this ticket (administrators included)
  IF TG_OP = 'INSERT' AND NEW.hourly_rate IS NULL THEN
    SELECT r.hourly_rate INTO _rate
      FROM public.ticket_rates r
     WHERE r.ticket_id = NEW.ticket_id AND r.consultant_id = NEW.consultant_id AND r.status = 'approved';
    NEW.hourly_rate := _rate;
  END IF;

  IF NOT public.is_untrusted_writer() THEN
    RETURN NEW;
  END IF;

  IF char_length(btrim(COALESCE(NEW.description, ''))) < 3 THEN
    RAISE EXCEPTION 'Describe what was done (at least 3 characters)' USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.submission_id := NULL;
    SELECT r.hourly_rate INTO _rate
      FROM public.ticket_rates r
     WHERE r.ticket_id = NEW.ticket_id AND r.consultant_id = NEW.consultant_id AND r.status = 'approved';
    NEW.hourly_rate := _rate;
  ELSE
    IF OLD.submission_id IS NOT NULL THEN
      SELECT s.status IN ('submitted', 'signed') INTO _locked FROM public.ticket_timesheet_submissions s WHERE s.id = OLD.submission_id;
      IF COALESCE(_locked, false) THEN
        RAISE EXCEPTION 'This entry is part of a timesheet that was sent to the client and can not be changed' USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.ticket_id IS DISTINCT FROM OLD.ticket_id OR NEW.consultant_id IS DISTINCT FROM OLD.consultant_id THEN
      RAISE EXCEPTION 'An entry can not be moved to another ticket or consultant' USING ERRCODE = '42501';
    END IF;
    NEW.submission_id := OLD.submission_id;
    NEW.hourly_rate := OLD.hourly_rate;
  END IF;
  RETURN NEW;
END;
$function$;

-- old entries that are not in a timesheet yet and have no rate, although a rate was approved
UPDATE public.ticket_work_logs w
   SET hourly_rate = r.hourly_rate
  FROM public.ticket_rates r
 WHERE w.hourly_rate IS NULL
   AND w.submission_id IS NULL
   AND r.ticket_id = w.ticket_id
   AND r.consultant_id = w.consultant_id
   AND r.status = 'approved';