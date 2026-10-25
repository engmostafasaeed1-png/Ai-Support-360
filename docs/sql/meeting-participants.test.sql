-- Adversarial tests for meeting-participants.sql. ONE rolled-back transaction: run on a scratch copy (nothing kept).
-- Each check raises on failure. MP01-MP08.
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000ab001', 'client@acme.test'), ('00000000-0000-0000-0000-0000000ab002', 'lead@cons.test'),
  ('00000000-0000-0000-0000-0000000ab003', 'team@cons.test'), ('00000000-0000-0000-0000-0000000ab004', 'colleague@acme.test'),
  ('00000000-0000-0000-0000-0000000ab005', 'stranger@other.test'), ('00000000-0000-0000-0000-0000000ab006', 'admin@platform.test')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES ('00000000-0000-0000-0000-0000000ab006', 'admin') ON CONFLICT DO NOTHING;
SET LOCAL session_replication_role = replica;  -- plain fixtures (guards and notices are not under test here)
INSERT INTO public.consultants (id, user_id, verification_status) VALUES
  ('00000000-0000-0000-0000-0000000ac002', '00000000-0000-0000-0000-0000000ab002', 'verified'),
  ('00000000-0000-0000-0000-0000000ac003', '00000000-0000-0000-0000-0000000ab003', 'verified');
INSERT INTO public.tickets (id, client_id, title, description, sap_module, consultant_id) VALUES
  ('00000000-0000-0000-0000-0000000ad001', '00000000-0000-0000-0000-0000000ab001', 'FI issue', 'x', 'FI', '00000000-0000-0000-0000-0000000ac002');
INSERT INTO public.sessions (id, ticket_id, client_id, consultant_id, session_type, status, scheduled_at, duration_minutes, meeting_url) VALUES
  ('00000000-0000-0000-0000-0000000ae001', '00000000-0000-0000-0000-0000000ad001', '00000000-0000-0000-0000-0000000ab001',
   '00000000-0000-0000-0000-0000000ac002', 'video', 'scheduled', now() + interval '2 days', 60, 'https://meet.jit.si/ai-support-360-test');
SET LOCAL session_replication_role = origin;
-- the schedule-meeting function writes participants with the service role
INSERT INTO public.session_participants (session_id, user_id, role) VALUES
  ('00000000-0000-0000-0000-0000000ae001', '00000000-0000-0000-0000-0000000ab003', 'consultant'),
  ('00000000-0000-0000-0000-0000000ae001', '00000000-0000-0000-0000-0000000ab004', 'colleague');

CREATE OR REPLACE FUNCTION pg_temp.as_user(_u uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
  SELECT set_config('request.jwt.claim.sub', COALESCE(_u::text, ''), true);
$$;
CREATE OR REPLACE FUNCTION pg_temp.err(_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN ''; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(_cond boolean, _name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FAILED %', _name; END IF; END $$;

-- MP01 an invited team consultant sees the session (and its link)
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000ab003'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.sessions WHERE id = '00000000-0000-0000-0000-0000000ae001') = 1, 'MP01 team consultant reads session');
-- MP02 ... but can not edit it
UPDATE public.sessions SET notes = 'hijack' WHERE id = '00000000-0000-0000-0000-0000000ae001';
RESET ROLE;
SELECT pg_temp.ok((SELECT notes FROM public.sessions WHERE id = '00000000-0000-0000-0000-0000000ae001') IS DISTINCT FROM 'hijack', 'MP02 participant can not edit');

-- MP03 an invited colleague sees the session
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000ab004'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.sessions WHERE id = '00000000-0000-0000-0000-0000000ae001') = 1, 'MP03 colleague reads session');
-- MP04 a participant sees only his own participant row
SELECT pg_temp.ok((SELECT count(*) FROM public.session_participants) = 1, 'MP04 colleague sees own row only');
-- MP05 browsers can not add participants
SELECT pg_temp.ok(pg_temp.err($q$INSERT INTO public.session_participants (session_id, user_id, role) VALUES ('00000000-0000-0000-0000-0000000ae001', '00000000-0000-0000-0000-0000000ab005', 'colleague')$q$) <> '', 'MP05 browser insert refused');
RESET ROLE;

-- MP06 a stranger sees neither the session nor the list
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000ab005'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.sessions WHERE id = '00000000-0000-0000-0000-0000000ae001') = 0, 'MP06 stranger no session');
SELECT pg_temp.ok((SELECT count(*) FROM public.session_participants) = 0, 'MP06 stranger no list');
RESET ROLE;

-- MP07 the client (a party) sees the whole list
SELECT pg_temp.as_user('00000000-0000-0000-0000-0000000ab001'); SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.session_participants WHERE session_id = '00000000-0000-0000-0000-0000000ae001') = 2, 'MP07 client sees list');
RESET ROLE;

-- MP08 external invitations stay on by default
SELECT pg_temp.ok((SELECT value FROM public.platform_settings WHERE key = 'meeting_external_invites') = 'true'::jsonb, 'MP08 external default on');

DO $$ BEGIN RAISE NOTICE 'meeting-participants: all 8 checks passed'; END $$;
ROLLBACK;
