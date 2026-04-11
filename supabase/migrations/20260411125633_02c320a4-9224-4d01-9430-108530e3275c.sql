
-- Create security definer function excluding sensitive columns
CREATE OR REPLACE FUNCTION public.get_vmware_settings_safe(p_environment_id uuid)
RETURNS TABLE(
  id uuid,
  environment_id uuid,
  hypervisor_type text,
  cloud_vendor text,
  vcenter_url text,
  vcenter_username text,
  datacenter text,
  cluster text,
  datastore text,
  resource_pool text,
  network_vlan text,
  default_cpu integer,
  default_ram_gb integer,
  default_disk_gb integer,
  default_os_template text,
  snapshot_enabled boolean,
  auto_shutdown_hours integer,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT 
    vs.id, vs.environment_id, vs.hypervisor_type, vs.cloud_vendor,
    vs.vcenter_url, vs.vcenter_username,
    vs.datacenter, vs.cluster, vs.datastore, vs.resource_pool,
    vs.network_vlan, vs.default_cpu, vs.default_ram_gb,
    vs.default_disk_gb, vs.default_os_template, vs.snapshot_enabled,
    vs.auto_shutdown_hours, vs.notes, vs.created_at, vs.updated_at
  FROM public.vmware_settings vs
  JOIN public.remote_environments re ON re.id = vs.environment_id
  WHERE vs.environment_id = p_environment_id
  AND re.client_id = auth.uid()
$$;
