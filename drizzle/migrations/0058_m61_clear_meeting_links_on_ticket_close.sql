CREATE OR REPLACE FUNCTION public.clear_meeting_links_on_ticket_close()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF NEW.status::text IN ('resolved', 'closed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.sessions SET meeting_url = NULL WHERE ticket_id = NEW.id AND meeting_url IS NOT NULL;
  END IF;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS trg_clear_meeting_links_on_ticket_close ON public.tickets;
CREATE TRIGGER trg_clear_meeting_links_on_ticket_close
  AFTER UPDATE OF status ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.clear_meeting_links_on_ticket_close();

REVOKE ALL ON FUNCTION public.clear_meeting_links_on_ticket_close() FROM PUBLIC, anon, authenticated;

UPDATE public.sessions s SET meeting_url = NULL
  FROM public.tickets t
 WHERE t.id = s.ticket_id AND t.status::text IN ('resolved', 'closed') AND s.meeting_url IS NOT NULL;