
-- Table for shared remote desktop configurations
CREATE TABLE public.shared_remote_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL,
  consultant_id UUID NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  tool_type TEXT NOT NULL CHECK (tool_type IN ('anydesk', 'teamviewer', 'rustdesk', 'rdp', 'guacamole')),
  config JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  message TEXT,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.shared_remote_configs ENABLE ROW LEVEL SECURITY;

-- Clients can view configs they shared
CREATE POLICY "Clients can view their shared configs"
ON public.shared_remote_configs
FOR SELECT
TO authenticated
USING (auth.uid() = client_id);

-- Clients can create shared configs
CREATE POLICY "Clients can share configs"
ON public.shared_remote_configs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = client_id);

-- Clients can update (revoke) their shared configs
CREATE POLICY "Clients can update their shared configs"
ON public.shared_remote_configs
FOR UPDATE
TO authenticated
USING (auth.uid() = client_id);

-- Consultants can view configs shared with them
CREATE POLICY "Consultants can view shared configs"
ON public.shared_remote_configs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.id = shared_remote_configs.consultant_id
    AND c.user_id = auth.uid()
  )
);

-- Consultants can update (accept) configs shared with them
CREATE POLICY "Consultants can accept shared configs"
ON public.shared_remote_configs
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.consultants c
    WHERE c.id = shared_remote_configs.consultant_id
    AND c.user_id = auth.uid()
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_shared_remote_configs_updated_at
BEFORE UPDATE ON public.shared_remote_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Notify consultant when a config is shared
CREATE OR REPLACE FUNCTION public.notify_shared_remote_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _consultant_user_id uuid;
  _client_name text;
BEGIN
  SELECT user_id INTO _consultant_user_id FROM public.consultants WHERE id = NEW.consultant_id;
  SELECT display_name INTO _client_name FROM public.profiles WHERE user_id = NEW.client_id;

  IF _consultant_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, type, link)
    VALUES (
      _consultant_user_id,
      'Remote Access Shared',
      'Client "' || COALESCE(_client_name, 'A client') || '" shared ' || NEW.tool_type || ' remote access credentials with you.',
      'remote_access',
      '/consultant/remote-access'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_shared_remote_config
AFTER INSERT ON public.shared_remote_configs
FOR EACH ROW
EXECUTE FUNCTION public.notify_shared_remote_config();
