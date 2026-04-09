
-- Secure credentials table for environment server access
CREATE TABLE public.environment_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  environment_id uuid NOT NULL REFERENCES public.remote_environments(id) ON DELETE CASCADE,
  credential_label text NOT NULL DEFAULT 'Default',
  hostname text,
  port integer DEFAULT 3389,
  domain text,
  username text NOT NULL,
  password_encrypted text NOT NULL,
  entered_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.environment_credentials ENABLE ROW LEVEL SECURITY;

-- Clients can manage credentials for their own environments
CREATE POLICY "Clients can manage own env credentials"
ON public.environment_credentials
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.remote_environments re
    WHERE re.id = environment_credentials.environment_id
    AND re.client_id = auth.uid()
  )
)
WITH CHECK (
  auth.uid() = entered_by
  AND EXISTS (
    SELECT 1 FROM public.remote_environments re
    WHERE re.id = environment_credentials.environment_id
    AND re.client_id = auth.uid()
  )
);

-- Consultants can only view credentials for assigned environments
CREATE POLICY "Consultants can view assigned env credentials"
ON public.environment_credentials
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.remote_environments re
    JOIN public.consultants c ON c.id = re.consultant_id
    WHERE re.id = environment_credentials.environment_id
    AND c.user_id = auth.uid()
  )
);

-- Admins full access
CREATE POLICY "Admins can manage all credentials"
ON public.environment_credentials
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger for updated_at
CREATE TRIGGER update_environment_credentials_updated_at
BEFORE UPDATE ON public.environment_credentials
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
