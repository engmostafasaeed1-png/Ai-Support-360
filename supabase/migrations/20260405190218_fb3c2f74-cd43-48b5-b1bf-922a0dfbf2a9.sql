
-- Create status enum for remote environments
CREATE TYPE public.environment_status AS ENUM ('active', 'inactive', 'maintenance');

-- Create remote_environments table
CREATE TABLE public.remote_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  guacamole_url text NOT NULL,
  client_id uuid NOT NULL,
  consultant_id uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
  status environment_status NOT NULL DEFAULT 'active',
  os_type text DEFAULT 'Windows Server 2022',
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.remote_environments ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "Admins can manage all environments"
ON public.remote_environments FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Clients can view their own environments
CREATE POLICY "Clients can view own environments"
ON public.remote_environments FOR SELECT
USING (auth.uid() = client_id);

-- Consultants can view environments assigned to them
CREATE POLICY "Consultants can view assigned environments"
ON public.remote_environments FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.consultants
  WHERE consultants.id = remote_environments.consultant_id
  AND consultants.user_id = auth.uid()
));

-- Auto-update updated_at
CREATE TRIGGER update_remote_environments_updated_at
BEFORE UPDATE ON public.remote_environments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
