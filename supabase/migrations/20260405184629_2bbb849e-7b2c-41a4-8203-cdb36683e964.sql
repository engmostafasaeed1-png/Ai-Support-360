
CREATE OR REPLACE FUNCTION public.notify_admins_new_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _admin RECORD;
BEGIN
  FOR _admin IN
    SELECT user_id FROM public.user_roles WHERE role = 'admin'
  LOOP
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      _admin.user_id,
      'New Ticket Submitted',
      'A new ticket "' || NEW.title || '" (' || NEW.sap_module || ') has been submitted.',
      'ticket',
      '/admin/tickets'
    );
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_ticket_created_notify_admins
AFTER INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_admins_new_ticket();
