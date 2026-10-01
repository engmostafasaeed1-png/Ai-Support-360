-- Client-cycle hardening M10 (follow-up to M8, finding F11): meeting invitations can not be abused to push a client's text or link to strangers.
-- A consultant who already works with the client (ticket, assignment, match request, bid, interview, project, session) gets the full notice
-- with the ticket title and the meeting link; any other verified consultant only learns that a client invited them (no title, no link).
-- At most 20 calls per hour per client.
CREATE OR REPLACE FUNCTION public.invite_to_meeting(_session_id uuid, _consultant_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _s record;
  _title text;
  _c record;
  _n integer := 0;
  _when text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _consultant_ids IS NULL OR cardinality(_consultant_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(_consultant_ids) > 20 THEN
    RAISE EXCEPTION 'Too many invitees' USING ERRCODE = '22023';
  END IF;
  SELECT s.id, s.client_id, s.consultant_id, s.ticket_id, s.scheduled_at, s.session_type, s.meeting_url INTO _s
  FROM public.sessions s WHERE s.id = _session_id;
  IF NOT FOUND OR _s.client_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Meeting not found' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('meeting-invite:' || auth.uid()::text, 20, 3600) THEN
    RAISE EXCEPTION 'Too many invitations in the last hour; please try again later' USING ERRCODE = '54000';
  END IF;
  SELECT t.title INTO _title FROM public.tickets t WHERE t.id = _s.ticket_id;
  _when := CASE WHEN _s.scheduled_at IS NOT NULL
                THEN to_char(_s.scheduled_at AT TIME ZONE 'UTC', 'Mon DD, YYYY "at" HH24:MI "UTC"')
                ELSE 'a time to be agreed' END;
  FOR _c IN
    SELECT c.user_id, public.consultant_related_to_client(c.id, auth.uid(), true) AS related
    FROM public.consultants c
    WHERE c.id = ANY (_consultant_ids) AND c.verification_status = 'verified' AND c.id IS DISTINCT FROM _s.consultant_id
  LOOP
    IF _c.related THEN
      PERFORM public.safe_insert_notification(_c.user_id, 'Meeting Invitation',
        'You are invited to a ' || COALESCE(_s.session_type::text, 'meeting') || ' meeting for "' || COALESCE(_title, 'a ticket') || '" on ' || _when
          || CASE WHEN _s.meeting_url IS NOT NULL THEN '. Join: ' || _s.meeting_url ELSE '.' END,
        'session', '/consultant/cases');
    ELSE
      PERFORM public.safe_insert_notification(_c.user_id, 'Meeting Invitation',
        'A client invited you to a ' || COALESCE(_s.session_type::text, 'meeting') || ' meeting on ' || _when || '. Open your requests to follow up.',
        'session', '/consultant/requests');
    END IF;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END;
$function$;
REVOKE ALL ON FUNCTION public.invite_to_meeting(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_meeting(uuid, uuid[]) TO authenticated;