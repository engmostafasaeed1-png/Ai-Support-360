ALTER TABLE public.interview_sessions
  ADD COLUMN IF NOT EXISTS interview_style text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

CREATE OR REPLACE FUNCTION public.validate_interview_style()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.interview_style NOT IN ('standard','discussion','scenario','panel','live') THEN
    RAISE EXCEPTION 'Invalid interview_style';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_validate_interview_style BEFORE INSERT OR UPDATE ON public.interview_sessions
FOR EACH ROW EXECUTE FUNCTION public.validate_interview_style();

CREATE TABLE public.interview_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'interviewer' CHECK (role IN ('interviewer','candidate')),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interview_participants TO authenticated;
GRANT ALL ON public.interview_participants TO service_role;
ALTER TABLE public.interview_participants ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.interview_role(_session_id uuid, _user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.interview_participants WHERE session_id = _session_id AND user_id = _user_id LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.interview_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.interview_role(uuid, uuid) TO authenticated, service_role;

CREATE POLICY "Participants view participant list" ON public.interview_participants FOR SELECT TO authenticated
USING (public.interview_role(session_id, auth.uid()) IS NOT NULL OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Admins manage participants" ON public.interview_participants FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE public.interview_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.interview_sessions(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL,
  sender_name text,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  is_private boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_interview_messages_session ON public.interview_messages(session_id, created_at);
GRANT SELECT, INSERT ON public.interview_messages TO authenticated;
GRANT ALL ON public.interview_messages TO service_role;
ALTER TABLE public.interview_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants read messages" ON public.interview_messages FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
  OR public.interview_role(session_id, auth.uid()) = 'interviewer'
  OR (public.interview_role(session_id, auth.uid()) = 'candidate' AND is_private = false)
);
CREATE POLICY "Participants post messages" ON public.interview_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid() AND (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
    OR public.interview_role(session_id, auth.uid()) = 'interviewer'
    OR (public.interview_role(session_id, auth.uid()) = 'candidate' AND is_private = false)
  )
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.interview_messages;