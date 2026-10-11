-- M49: the ticket notices open the ticket itself, and a video session has ONE room.
--
-- 1) "Ticket Resolved", "Consultant Assigned", "Consultant Accepted Match" (client) and "New Ticket Assignment" (consultant)
--    opened the LIST page (/client/tickets, /consultant/cases). They now open the ticket:
--    /client/tickets/<ticket id> and /consultant/cases/<ticket id>, like the "Ticket Status Update" notice already does.
--    The three functions are the same as before (company, text, trigger); only the link changes.
-- 2) Video sessions made before the room name was unified store another Jitsi room (qurtuba-<8 characters>,
--    aisupportnow-<32 characters>) than the one the page /join/<session id> opens (ai-support-360-<id without dashes>).

CREATE OR REPLACE FUNCTION public.notify_ticket_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'resolved' AND (OLD.status IS DISTINCT FROM 'resolved') THEN
    INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
    VALUES (
      NEW.client_id,
      'Ticket Resolved',
      'Your ticket "' || NEW.title || '" has been resolved.',
      'ticket',
      '/client/tickets/' || NEW.id,
      NEW.tenant_id
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_ticket_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _consultant_user_id uuid;
BEGIN
  IF NEW.consultant_id IS NOT NULL AND (OLD.consultant_id IS DISTINCT FROM NEW.consultant_id) THEN
    -- Notify the client
    INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
    VALUES (
      NEW.client_id,
      'Consultant Assigned',
      'A consultant has been matched to your ticket "' || NEW.title || '".',
      'ticket',
      '/client/tickets/' || NEW.id,
      NEW.tenant_id
    );
    -- Look up consultant user_id
    SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
    IF _consultant_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
      VALUES (
        _consultant_user_id,
        'New Ticket Assignment',
        'You have been assigned to ticket "' || NEW.title || '" (' || NEW.sap_module || ').',
        'ticket',
        '/consultant/cases/' || NEW.id,
        NEW.tenant_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_match_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client_id uuid;
  _ticket_title text;
  _tenant uuid;
  _consultant_name text;
BEGIN
  IF NEW.status = 'accepted' AND OLD.status = 'pending' THEN
    SELECT t.client_id, t.title, t.tenant_id INTO _client_id, _ticket_title, _tenant FROM public.tickets t WHERE t.id = NEW.ticket_id;
    SELECT p.display_name INTO _consultant_name FROM public.consultants c JOIN public.profiles p ON p.user_id = c.user_id WHERE c.id = NEW.consultant_id;
    INSERT INTO public.notifications (user_id, title, body, type, link, tenant_id)
    VALUES (
      _client_id,
      'Consultant Accepted Match',
      'Consultant "' || COALESCE(_consultant_name, 'A consultant') || '" accepted the match for "' || COALESCE(_ticket_title, 'your ticket') || '". You can now choose them.',
      'match_request',
      '/client/tickets/' || NEW.ticket_id,
      _tenant
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Old notices (written before this change) opened the list. When exactly ONE ticket of that person has the title the notice names, the notice now opens that ticket (a title that is shared by two tickets stays on the list).
UPDATE public.notifications n
   SET link = '/client/tickets/' || x.ticket_id
  FROM (
    SELECT c.id, min(t.id::text) AS ticket_id, count(*) AS cnt
      FROM (
        SELECT n2.id, n2.user_id,
               CASE n2.title
                 WHEN 'Ticket Resolved' THEN (regexp_match(n2.body, '^Your ticket "(.*)" has been resolved\.$'))[1]
                 WHEN 'Consultant Assigned' THEN (regexp_match(n2.body, '^A consultant has been matched to your ticket "(.*)"\.$'))[1]
                 WHEN 'Consultant Accepted Match' THEN (regexp_match(n2.body, ' accepted the match for "(.*)"\. You can now choose them\.$'))[1]
               END AS ticket_title
          FROM public.notifications n2
         WHERE n2.link = '/client/tickets'
           AND n2.title IN ('Ticket Resolved', 'Consultant Assigned', 'Consultant Accepted Match')
      ) c
      JOIN public.tickets t ON t.client_id = c.user_id AND t.title = c.ticket_title
     WHERE c.ticket_title IS NOT NULL
     GROUP BY c.id
  ) x
 WHERE n.id = x.id AND x.cnt = 1;

-- The same for the consultant's "New Ticket Assignment" (the ticket must be assigned to that consultant).
UPDATE public.notifications n
   SET link = '/consultant/cases/' || x.ticket_id
  FROM (
    SELECT c.id, min(t.id::text) AS ticket_id, count(*) AS cnt
      FROM (
        SELECT n2.id, n2.user_id,
               (regexp_match(n2.body, '^You have been assigned to ticket "(.*)" \(.*\)\.$'))[1] AS ticket_title
          FROM public.notifications n2
         WHERE n2.link = '/consultant/cases'
           AND n2.title = 'New Ticket Assignment'
      ) c
      JOIN public.consultants cs ON cs.user_id = c.user_id
      JOIN public.tickets t ON t.consultant_id = cs.id AND t.title = c.ticket_title
     WHERE c.ticket_title IS NOT NULL
     GROUP BY c.id
  ) x
 WHERE n.id = x.id AND x.cnt = 1;

-- Video sessions made before the room name was unified: the stored link points to another room than the page /join/<id> opens.
UPDATE public.sessions
   SET meeting_url = 'https://meet.jit.si/ai-support-360-' || replace(id::text, '-', '')
 WHERE meeting_url ~ '^https://meet\.jit\.si/(qurtuba|aisupportnow)-[0-9a-f]+$';