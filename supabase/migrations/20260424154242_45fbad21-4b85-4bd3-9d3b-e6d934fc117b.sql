-- Append-only event log for meeting join attempts and fallback reasons.
CREATE TABLE IF NOT EXISTS public.meeting_join_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  session_id uuid NULL,
  provider text NOT NULL DEFAULT 'unknown',
  event text NOT NULL,
  reason text NULL,
  url_host text NULL,
  user_agent text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meeting_join_events_created_at_idx
  ON public.meeting_join_events (created_at DESC);
CREATE INDEX IF NOT EXISTS meeting_join_events_user_idx
  ON public.meeting_join_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS meeting_join_events_reason_idx
  ON public.meeting_join_events (reason, created_at DESC);
CREATE INDEX IF NOT EXISTS meeting_join_events_session_idx
  ON public.meeting_join_events (session_id, created_at DESC);

ALTER TABLE public.meeting_join_events ENABLE ROW LEVEL SECURITY;

-- Insert: any authenticated user can log their own events.
CREATE POLICY "Users can insert their own meeting join events"
  ON public.meeting_join_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Select: users see their own events; admins see all.
CREATE POLICY "Users can view their own meeting join events"
  ON public.meeting_join_events
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all meeting join events"
  ON public.meeting_join_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
