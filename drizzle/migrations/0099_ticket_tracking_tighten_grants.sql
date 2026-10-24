-- Tighten table privileges (the project's default privileges give new tables full rights to anon/authenticated;
-- RLS already blocks writes, this removes the rights themselves). The browser only reads through the tt_* RPCs.
REVOKE ALL ON public.ticket_working_status, public.ticket_working_status_events, public.ticket_tracking_email_queue FROM anon, authenticated;
GRANT SELECT ON public.ticket_working_status, public.ticket_working_status_events TO authenticated;