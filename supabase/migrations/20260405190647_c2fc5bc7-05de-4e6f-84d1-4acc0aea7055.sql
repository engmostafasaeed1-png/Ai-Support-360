
CREATE TABLE public.environment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES public.remote_environments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  connected_at timestamp with time zone NOT NULL DEFAULT now(),
  disconnected_at timestamp with time zone,
  duration_minutes integer
);

ALTER TABLE public.environment_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all environment sessions"
ON public.environment_sessions FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own environment sessions"
ON public.environment_sessions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own environment sessions"
ON public.environment_sessions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own environment sessions"
ON public.environment_sessions FOR UPDATE
USING (auth.uid() = user_id);

CREATE INDEX idx_env_sessions_env_id ON public.environment_sessions(environment_id);
CREATE INDEX idx_env_sessions_user_id ON public.environment_sessions(user_id);
