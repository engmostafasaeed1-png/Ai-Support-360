import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface VMwareSettings {
  id: string;
  environment_id: string;
  vcenter_url: string | null;
  vcenter_username: string | null;
  vcenter_password_encrypted: string | null;
  datacenter: string | null;
  cluster: string | null;
  resource_pool: string | null;
  datastore: string | null;
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

export function useVMwareSettings(environmentId?: string) {
  return useQuery({
    queryKey: ['vmware-settings', environmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vmware_settings')
        .select('*')
        .eq('environment_id', environmentId!)
        .maybeSingle();
      if (error) throw error;
      return data as VMwareSettings | null;
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
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as VMwareSettings[];
    },
  });
}

export function useSaveVMwareSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<VMwareSettings> & { environment_id: string }) => {
      // upsert on environment_id
      const { data, error } = await supabase
        .from('vmware_settings')
        .upsert(settings as any, { onConflict: 'environment_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
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
