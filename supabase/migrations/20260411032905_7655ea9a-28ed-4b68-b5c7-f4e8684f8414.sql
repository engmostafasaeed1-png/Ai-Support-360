
-- Add more detail columns to remote_environments
ALTER TABLE public.remote_environments
ADD COLUMN IF NOT EXISTS ip_address text,
ADD COLUMN IF NOT EXISTS cpu_cores integer,
ADD COLUMN IF NOT EXISTS ram_gb integer,
ADD COLUMN IF NOT EXISTS disk_gb integer,
ADD COLUMN IF NOT EXISTS sap_sid text,
ADD COLUMN IF NOT EXISTS sap_client_number text,
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS access_type text DEFAULT 'rdp',
ADD COLUMN IF NOT EXISTS region text,
ADD COLUMN IF NOT EXISTS environment_type text DEFAULT 'production';

-- Create junction table for multi-consultant assignment
CREATE TABLE IF NOT EXISTS public.environment_consultants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES public.remote_environments(id) ON DELETE CASCADE,
  consultant_id uuid NOT NULL REFERENCES public.consultants(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid,
  UNIQUE (environment_id, consultant_id)
);

ALTER TABLE public.environment_consultants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view environment consultants"
ON public.environment_consultants FOR SELECT
TO authenticated USING (true);

CREATE POLICY "Admins can manage environment consultants"
ON public.environment_consultants FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
