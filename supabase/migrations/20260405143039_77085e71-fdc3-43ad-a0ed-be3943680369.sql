
-- Create platform enum
CREATE TYPE public.integration_platform AS ENUM ('zendesk', 'freshdesk', 'jira', 'servicenow');
CREATE TYPE public.integration_status AS ENUM ('active', 'inactive', 'error');
CREATE TYPE public.sync_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE public.sync_status AS ENUM ('success', 'failed', 'pending', 'skipped');

-- Create integrations table
CREATE TABLE public.integrations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL,
  platform public.integration_platform NOT NULL,
  platform_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  webhook_secret TEXT DEFAULT NULL,
  external_project_id TEXT DEFAULT NULL,
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  status public.integration_status NOT NULL DEFAULT 'active',
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(client_id, platform)
);

-- Create sync log table
CREATE TABLE public.integration_sync_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  integration_id UUID NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  direction public.sync_direction NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'ticket',
  local_ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  external_ticket_id TEXT DEFAULT NULL,
  action TEXT NOT NULL,
  status public.sync_status NOT NULL DEFAULT 'pending',
  error_message TEXT DEFAULT NULL,
  payload JSONB DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_sync_log ENABLE ROW LEVEL SECURITY;

-- RLS for integrations
CREATE POLICY "Clients can view own integrations"
  ON public.integrations FOR SELECT
  USING (auth.uid() = client_id);

CREATE POLICY "Clients can create own integrations"
  ON public.integrations FOR INSERT
  WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Clients can update own integrations"
  ON public.integrations FOR UPDATE
  USING (auth.uid() = client_id);

CREATE POLICY "Clients can delete own integrations"
  ON public.integrations FOR DELETE
  USING (auth.uid() = client_id);

CREATE POLICY "Admins can manage all integrations"
  ON public.integrations FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS for sync log
CREATE POLICY "Clients can view own sync logs"
  ON public.integration_sync_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM integrations i WHERE i.id = integration_sync_log.integration_id AND i.client_id = auth.uid()
  ));

CREATE POLICY "Admins can manage all sync logs"
  ON public.integration_sync_log FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Service role can insert sync logs (from edge functions)
CREATE POLICY "Service can insert sync logs"
  ON public.integration_sync_log FOR INSERT
  WITH CHECK (true);

-- Triggers
CREATE TRIGGER update_integrations_updated_at
  BEFORE UPDATE ON public.integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for performance
CREATE INDEX idx_sync_log_integration ON public.integration_sync_log(integration_id);
CREATE INDEX idx_sync_log_local_ticket ON public.integration_sync_log(local_ticket_id);
CREATE INDEX idx_integrations_client ON public.integrations(client_id);
