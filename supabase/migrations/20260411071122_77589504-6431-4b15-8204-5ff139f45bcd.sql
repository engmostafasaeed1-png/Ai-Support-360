
ALTER TABLE public.vmware_settings
  ADD COLUMN IF NOT EXISTS cloud_vendor text NOT NULL DEFAULT 'vmware',
  ADD COLUMN IF NOT EXISTS hypervisor_type text NOT NULL DEFAULT 'esxi',
  ADD COLUMN IF NOT EXISTS cloud_region text,
  ADD COLUMN IF NOT EXISTS cloud_account_id text,
  ADD COLUMN IF NOT EXISTS cloud_project_id text,
  ADD COLUMN IF NOT EXISTS cloud_api_key_encrypted text,
  ADD COLUMN IF NOT EXISTS cloud_api_endpoint text,
  ADD COLUMN IF NOT EXISTS instance_type text,
  ADD COLUMN IF NOT EXISTS availability_zone text,
  ADD COLUMN IF NOT EXISTS security_group text,
  ADD COLUMN IF NOT EXISTS subnet_id text,
  ADD COLUMN IF NOT EXISTS storage_type text DEFAULT 'ssd';
