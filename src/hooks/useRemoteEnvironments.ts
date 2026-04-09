import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface RemoteEnvironment {
  id: string;
  name: string;
  guacamole_url: string;
  client_id: string;
  consultant_id: string | null;
  status: 'active' | 'inactive' | 'maintenance';
  os_type: string | null;
  notes: string | null;
  platform_type: string;
  vmware_host: string | null;
  vm_name: string | null;
  created_at: string;
  updated_at: string;
}

export function useRemoteEnvironments() {
  return useQuery({
    queryKey: ['remote-environments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('remote_environments')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as RemoteEnvironment[];
    },
  });
}

export function useCreateEnvironment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (env: Omit<RemoteEnvironment, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('remote_environments')
        .insert(env as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['remote-environments'] });
      toast.success('Environment created');
    },
    onError: (err: any) => toast.error('Failed to create environment', { description: err.message }),
  });
}

export function useUpdateEnvironment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<RemoteEnvironment> & { id: string }) => {
      const { error } = await supabase
        .from('remote_environments')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['remote-environments'] });
      toast.success('Environment updated');
    },
    onError: (err: any) => toast.error('Failed to update', { description: err.message }),
  });
}

export function useDeleteEnvironment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('remote_environments')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['remote-environments'] });
      toast.success('Environment deleted');
    },
    onError: (err: any) => toast.error('Failed to delete', { description: err.message }),
  });
}
