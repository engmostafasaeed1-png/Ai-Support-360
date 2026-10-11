-- M51: a session that is completed in the 15 minutes before its planned start no longer ends before it started (ended_at is never earlier than started_at).

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
         ended_at = GREATEST(COALESCE(started_at, scheduled_at), LEAST(now(), scheduled_at + make_interval(mins => GREATEST(COALESCE(NULLIF(duration_minutes, 0), 60), 1))))
   WHERE id = _s.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_session(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_session(uuid) TO authenticated;

-- sessions that were closed before their start (ended_at earlier than started_at)
UPDATE public.sessions
   SET ended_at = started_at
 WHERE ended_at IS NOT NULL
   AND started_at IS NOT NULL
   AND ended_at < started_at;