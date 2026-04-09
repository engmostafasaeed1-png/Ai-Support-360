
-- Add platform_type column to remote_environments for VMware/Hyper-V tracking
ALTER TABLE public.remote_environments 
ADD COLUMN platform_type text NOT NULL DEFAULT 'vmware';

-- Add vmware_host for vCenter/ESXi connection info
ALTER TABLE public.remote_environments 
ADD COLUMN vmware_host text;

-- Add vm_name to identify the specific VM
ALTER TABLE public.remote_environments 
ADD COLUMN vm_name text;
