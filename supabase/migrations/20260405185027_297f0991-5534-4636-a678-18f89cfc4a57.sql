
CREATE OR REPLACE FUNCTION public.notify_ticket_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _consultant_user_id uuid;
BEGIN
  IF NEW.consultant_id IS NOT NULL AND (OLD.consultant_id IS DISTINCT FROM NEW.consultant_id) THEN
    -- Notify the client
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      NEW.client_id,
      'Consultant Assigned',
      'A consultant has been matched to your ticket "' || NEW.title || '".',
      'ticket',
      '/client/tickets'
    );

    -- Look up consultant user_id
    SELECT user_id INTO _consultant_user_id
    FROM public.consultants
    WHERE id = NEW.consultant_id;

    IF _consultant_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, body, type, link)
      VALUES (
        _consultant_user_id,
        'New Ticket Assignment',
        'You have been assigned to ticket "' || NEW.title || '" (' || NEW.sap_module || ').',
        'ticket',
        '/consultant/cases'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_ticket_consultant_assigned
AFTER UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_assigned();
