import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { encryptCredential } from '@/lib/credentialsCrypto';

export interface VMwareSettings {
  id: string;
  environment_id: string;
  cloud_vendor: string;
  hypervisor_type: string;
  vcenter_url: string | null;
  vcenter_username: string | null;
  /** Base64 AES-GCM ciphertext. Decrypt via decryptCredential(). */
  vcenter_password_ciphertext: string | null;
  datacenter: string | null;
  cluster: string | null;
  resource_pool: string | null;
  datastore: string | null;
  cloud_region: string | null;
  cloud_account_id: string | null;
  cloud_project_id: string | null;
  /** Base64 AES-GCM ciphertext. Decrypt via decryptCredential(). */
  cloud_api_key_ciphertext: string | null;
  cloud_api_endpoint: string | null;
  instance_type: string | null;
  availability_zone: string | null;
  security_group: string | null;
  subnet_id: string | null;
  storage_type: string | null;
  default_os_template: string;
  default_cpu: number;
  default_ram_gb: number;
  default_disk_gb: number;
  network_vlan: string | null;
  firewall_rules: any[];
  allowed_ports: string[];
  vpn_gateway: string | null;
  vpn_type: string;
  snapshot_enabled: boolean;
  auto_shutdown_hours: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// The legacy *_encrypted columns are REVOKEd from authenticated/anon, so we
// must list every other column explicitly.
const SELECT_COLS = [
  'id','environment_id','cloud_vendor','hypervisor_type','vcenter_url','vcenter_username',
  'vcenter_password_ciphertext','datacenter','cluster','resource_pool','datastore',
  'cloud_region','cloud_account_id','cloud_project_id','cloud_api_key_ciphertext',
  'cloud_api_endpoint','instance_type','availability_zone','security_group','subnet_id',
  'storage_type','default_os_template','default_cpu','default_ram_gb','default_disk_gb',
  'network_vlan','firewall_rules','allowed_ports','vpn_gateway','vpn_type',
  'snapshot_enabled','auto_shutdown_hours','notes','created_at','updated_at',
].join(', ');

export function useVMwareSettings(environmentId?: string) {
  return useQuery({
    queryKey: ['vmware-settings', environmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vmware_settings')
        .select(SELECT_COLS)
        .eq('environment_id', environmentId!)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as VMwareSettings | null;
    },
    enabled: !!environmentId,
  });
}

export function useAllVMwareSettings() {
  return useQuery({
    queryKey: ['vmware-settings-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vmware_settings')
        .select(SELECT_COLS)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as VMwareSettings[];
    },
  });
}

/**
 * Save VMware settings. Pass `vcenter_password` and/or `cloud_api_key` as
 * plaintext — they will be encrypted client-side via the credentials-encrypt
 * edge function before being persisted to the *_ciphertext columns.
 */
export interface SaveVMwareInput extends Partial<Omit<VMwareSettings, 'vcenter_password_ciphertext' | 'cloud_api_key_ciphertext'>> {
  environment_id: string;
  vcenter_password?: string | null;
  cloud_api_key?: string | null;
}

export function useSaveVMwareSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: SaveVMwareInput) => {
      const { vcenter_password, cloud_api_key, ...rest } = settings;
      const patch: Record<string, unknown> = { ...rest };
      if (vcenter_password) {
        patch.vcenter_password_ciphertext = await encryptCredential(vcenter_password);
      }
      if (cloud_api_key) {
        patch.cloud_api_key_ciphertext = await encryptCredential(cloud_api_key);
      }
      const { data, error } = await supabase
        .from('vmware_settings')
        .upsert(patch as any, { onConflict: 'environment_id' })
        .select(SELECT_COLS)
        .single();
      if (error) throw error;
      return data as unknown as VMwareSettings;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['vmware-settings', data.environment_id] });
      qc.invalidateQueries({ queryKey: ['vmware-settings-all'] });
      toast.success('VMware settings saved');
    },
    onError: (err: any) => toast.error('Failed to save settings', { description: err.message }),
  });
}

export function useDeleteVMwareSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('vmware_settings')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vmware-settings-all'] });
      toast.success('VMware settings removed');
    },
    onError: (err: any) => toast.error('Failed to delete', { description: err.message }),
  });
}
