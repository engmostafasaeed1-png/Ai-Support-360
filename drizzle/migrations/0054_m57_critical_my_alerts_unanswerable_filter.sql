-- M57: the consultant alarm list drops a critical request that nobody can answer any more
-- (a consultant is assigned, or the ticket is resolved / closed). Same function as in M56, two extra conditions.
CREATE OR REPLACE FUNCTION public.critical_my_alerts()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  _uid uuid := auth.uid();
  _res jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ticket_id', t.id,
           'title', left(COALESCE(t.title, ''), 160),
           'areas', COALESCE(t.sap_modules, '{}'::text[]),
           'due_at', t.critical_due_at,
           'minutes', t.critical_minutes,
           'surcharge_percent', t.critical_surcharge_percent,
           'status', t.critical_status,
           'extensions', t.critical_extensions,
           'alerted_at', a.alerted_at,
           'last_alerted_at', a.last_alerted_at,
           'dismissed_at', a.dismissed_at,
           'replied_at', r.replied_at
         ) ORDER BY t.critical_due_at DESC), '[]'::jsonb)
    INTO _res
    FROM public.critical_alerts a
    JOIN public.tickets t ON t.id = a.ticket_id AND t.critical_response
                         AND t.consultant_id IS NULL AND t.status::text NOT IN ('resolved', 'closed', 'cancelled')
    LEFT JOIN public.critical_replies r ON r.ticket_id = a.ticket_id AND r.consultant_id = a.consultant_id
   WHERE a.user_id = _uid AND a.alerted_at > now() - interval '24 hours';
  RETURN _res;
END
$function$;