
-- Add client_id to ticket_sla_policies
ALTER TABLE public.ticket_sla_policies
ADD COLUMN client_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for faster lookups
CREATE INDEX idx_sla_policies_client_id ON public.ticket_sla_policies(client_id);

-- Drop existing policies to recreate with client support
DROP POLICY IF EXISTS "Admins can manage SLA policies" ON public.ticket_sla_policies;
DROP POLICY IF EXISTS "Authenticated can view active policies" ON public.ticket_sla_policies;

-- Admins can do everything
CREATE POLICY "Admins can manage all SLA policies"
ON public.ticket_sla_policies FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Clients can manage their own SLA policies
CREATE POLICY "Clients can manage own SLA policies"
ON public.ticket_sla_policies FOR ALL
USING (auth.uid() = client_id)
WITH CHECK (auth.uid() = client_id);

-- Everyone authenticated can view active system-wide policies (client_id IS NULL)
CREATE POLICY "Authenticated can view system SLA policies"
ON public.ticket_sla_policies FOR SELECT
TO authenticated
USING (is_active = true AND client_id IS NULL);

-- Authenticated users can view active client-specific policies for tickets they're involved in
CREATE POLICY "Authenticated can view relevant client SLA policies"
ON public.ticket_sla_policies FOR SELECT
TO authenticated
USING (is_active = true AND client_id IS NOT NULL);
