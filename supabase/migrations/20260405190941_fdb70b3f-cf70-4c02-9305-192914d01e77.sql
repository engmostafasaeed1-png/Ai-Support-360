
CREATE TYPE public.guac_protocol AS ENUM ('rdp', 'ssh', 'vnc');

CREATE TABLE public.environment_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES public.remote_environments(id) ON DELETE CASCADE,
  name text NOT NULL,
  protocol guac_protocol NOT NULL DEFAULT 'rdp',
  guacamole_url text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.environment_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage all connections"
ON public.environment_connections FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients can view own env connections"
ON public.environment_connections FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.remote_environments re
  WHERE re.id = environment_connections.environment_id
  AND re.client_id = auth.uid()
));

CREATE POLICY "Consultants can view assigned env connections"
ON public.environment_connections FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.remote_environments re
  JOIN public.consultants c ON c.id = re.consultant_id
  WHERE re.id = environment_connections.environment_id
  AND c.user_id = auth.uid()
));

CREATE INDEX idx_env_connections_env_id ON public.environment_connections(environment_id);
