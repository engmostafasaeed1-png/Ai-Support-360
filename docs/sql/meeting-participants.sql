-- Meeting participants (Schedule meeting fix, Oct 25). PREPARED, NOT APPLIED - the owner reviews it first.
--
-- Today a session row has one client and one (primary) consultant, and only they (and administrators) can read it. When a
-- meeting also invites other assigned consultants or colleagues of the company, those people get the join page link in
-- their notice and e-mail, but they do not see the meeting in their portal. This file adds a participant list that the
-- schedule-meeting function fills (service role only), and lets those participants read the session row.
--
-- - session_participants: one row per extra invited portal member (role consultant | colleague), written only by the
--   schedule-meeting function; append-only for browsers (no insert/update/delete grants).
-- - Read: the participant himself, the session's client and primary consultant, administrators.
-- - sessions: invited participants may READ the row (meeting link included: they are participants). They can not edit it
--   (update stays with the client and the primary consultant), so reschedule/cancel rules do not change.
-- - Helper functions are SECURITY DEFINER with a fixed search_path, so the two policies never recurse into each other.
-- - platform_settings 'meeting_external_invites' = true (today's behaviour), editable in Admin > Settings > General.
-- Re-runnable: every object is created only when missing or replaced in place.

CREATE TABLE IF NOT EXISTS public.session_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('consultant', 'colleague')),
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS session_participants_user_idx ON public.session_participants (user_id);
ALTER TABLE public.session_participants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.session_participants FROM anon, authenticated;
GRANT SELECT ON public.session_participants TO authenticated;
GRANT ALL ON public.session_participants TO service_role;

-- Is _user invited to _session as an extra participant?
CREATE OR REPLACE FUNCTION public.is_session_participant(_session uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _session IS NOT NULL AND _user IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.session_participants p WHERE p.session_id = _session AND p.user_id = _user)
$$;
REVOKE ALL ON FUNCTION public.is_session_participant(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_session_participant(uuid, uuid) TO authenticated, service_role;

-- Is _user the client or the primary consultant of _session?
CREATE OR REPLACE FUNCTION public.is_session_party(_session uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _session IS NOT NULL AND _user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sessions s
     WHERE s.id = _session
       AND (s.client_id = _user OR EXISTS (SELECT 1 FROM public.consultants c WHERE c.id = s.consultant_id AND c.user_id = _user))
  )
$$;
REVOKE ALL ON FUNCTION public.is_session_party(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_session_party(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Participants see the participant list" ON public.session_participants;
CREATE POLICY "Participants see the participant list" ON public.session_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_session_party(session_id, auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  );

DROP POLICY IF EXISTS "Invited participants can view sessions" ON public.sessions;
CREATE POLICY "Invited participants can view sessions" ON public.sessions
  FOR SELECT TO authenticated
  USING (public.is_session_participant(id, auth.uid()));

INSERT INTO public.platform_settings (key, value) VALUES ('meeting_external_invites', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
