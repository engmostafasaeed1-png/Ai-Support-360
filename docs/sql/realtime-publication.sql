-- Feature S: trim the realtime publication to the tables the app still listens to.
-- PREPARED ONLY - not applied. Run once; safe to re-run (each table is dropped only if it is still published).
--
-- Still published (live, filtered subscriptions in the app):
--   tickets               (own tickets: client_id / consultant_id; administrators: whole table on admin pages)
--   notifications         (bell: user_id)
--   messages              (session chat: session_id)
--   interview_messages    (live interview: session_id)
--   critical_alerts       (critical alarm: user_id)
--   ticket_match_requests (assignment popup / requests page: consultant_id)
--
-- Removed below: no client subscribes to them any more (or never did).
--   consultants, platform_settings, satisfaction_surveys, sessions, ticket_interviews, assignment_info_requests

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consultants', 'platform_settings', 'satisfaction_surveys', 'sessions', 'ticket_interviews', 'assignment_info_requests'] LOOP
    IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- The same, as plain statements (use these instead of the block above if you prefer; each fails if the table is not published):
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.consultants;
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.platform_settings;
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.satisfaction_surveys;
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.sessions;
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.ticket_interviews;
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.assignment_info_requests;

-- Check afterwards:
-- SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;
