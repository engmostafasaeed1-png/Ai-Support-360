import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface VMwareSnapshot {
  id: string;
  environment_id: string;
  name: string;
  description: string | null;
  size_gb: number | null;
  status: string;
  created_by: string;
  created_at: string;
}

export interface VMwareVMAction {
  id: string;
  environment_id: string;
  action: string;
  status: string;
  initiated_by: string;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
}

export function useVMwareSnapshots(environmentId?: string) {
  return useQuery({
    queryKey: ['vmware-snapshots', environmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vmware_snapshots')
        .select('*')
        .eq('environment_id', environmentId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as VMwareSnapshot[];
    },
    enabled: !!environmentId,
  });
}

export function useVMwareActions(environmentId?: string) {
  return useQuery({
    queryKey: ['vmware-actions', environmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vmware_vm_actions')
        .select('*')
        .eq('environment_id', environmentId!)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data || []) as VMwareVMAction[];
    },
    enabled: !!environmentId,
  });
}

export function useCreateSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { environment_id: string; name: string; description?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('vmware_snapshots')
        .insert({
          environment_id: params.environment_id,
          name: params.name,
          description: params.description || null,
          status: 'creating',
          created_by: user.id,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['vmware-snapshots', vars.environment_id] });
      toast.success('Snapshot creation initiated');
    },
    onError: (err: any) => toast.error('Failed to create snapshot', { description: err.message }),
  });
}

export function useDeleteSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { id: string; environment_id: string }) => {
      const { error } = await supabase
        .from('vmware_snapshots')
        .delete()
        .eq('id', params.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['vmware-snapshots', vars.environment_id] });
      toast.success('Snapshot deleted');
    },
    onError: (err: any) => toast.error('Failed to delete snapshot', { description: err.message }),
  });
}

export function useVMAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { environment_id: string; action: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase
        .from('vmware_vm_actions')
        .insert({
          environment_id: params.environment_id,
          action: params.action,
          status: 'completed',
          initiated_by: user.id,
          completed_at: new Date().toISOString(),
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['vmware-actions', vars.environment_id] });
      toast.success(`VM ${vars.action} completed`);
    },
    onError: (err: any) => toast.error('VM action failed', { description: err.message }),
  });
}
