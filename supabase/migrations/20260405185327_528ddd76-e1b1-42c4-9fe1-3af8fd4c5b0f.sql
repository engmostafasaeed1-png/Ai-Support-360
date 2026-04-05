
CREATE OR REPLACE FUNCTION public.notify_ticket_resolved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'resolved' AND (OLD.status IS DISTINCT FROM 'resolved') THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      NEW.client_id,
      'Ticket Resolved',
      'Your ticket "' || NEW.title || '" has been resolved.',
      'ticket',
      '/client/tickets'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_ticket_resolved_notify
AFTER UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_resolved();
