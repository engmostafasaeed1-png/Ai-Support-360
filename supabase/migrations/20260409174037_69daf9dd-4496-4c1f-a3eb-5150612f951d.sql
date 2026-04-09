
CREATE TABLE public.vmware_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  environment_id uuid NOT NULL REFERENCES public.remote_environments(id) ON DELETE CASCADE,
  -- vCenter Connection
  vcenter_url text,
  vcenter_username text,
  vcenter_password_encrypted text,
  datacenter text,
  cluster text,
  resource_pool text,
  datastore text,
  -- VM Defaults
  default_os_template text DEFAULT 'Windows Server 2022',
  default_cpu integer DEFAULT 4,
  default_ram_gb integer DEFAULT 16,
  default_disk_gb integer DEFAULT 100,
  -- Network & Security
  network_vlan text,
  firewall_rules jsonb DEFAULT '[]'::jsonb,
  allowed_ports text[] DEFAULT '{3389,22,443}'::text[],
  vpn_gateway text,
  vpn_type text DEFAULT 'ipsec',
  -- Additional
  snapshot_enabled boolean DEFAULT true,
  auto_shutdown_hours integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(environment_id)
);

ALTER TABLE public.vmware_settings ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "Admins can manage all vmware settings"
ON public.vmware_settings FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Clients can manage settings for their own environments
CREATE POLICY "Clients can manage own vmware settings"
ON public.vmware_settings FOR ALL
TO authenticated
USING (EXISTS (
  SELECT 1 FROM remote_environments re
  WHERE re.id = vmware_settings.environment_id AND re.client_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM remote_environments re
  WHERE re.id = vmware_settings.environment_id AND re.client_id = auth.uid()
));

-- Consultants can view settings for assigned environments
CREATE POLICY "Consultants can view assigned vmware settings"
ON public.vmware_settings FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM remote_environments re
  JOIN consultants c ON c.id = re.consultant_id
  WHERE re.id = vmware_settings.environment_id AND c.user_id = auth.uid()
));

-- Timestamp trigger
CREATE TRIGGER update_vmware_settings_updated_at
BEFORE UPDATE ON public.vmware_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
