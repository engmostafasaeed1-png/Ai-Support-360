import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface EnvironmentConnection {
  id: string;
  environment_id: string;
  name: string;
  protocol: 'rdp' | 'ssh' | 'vnc';
  guacamole_url: string;
  is_default: boolean;
  created_at: string;
}

export function useEnvironmentConnections(environmentId?: string) {
  return useQuery({
    queryKey: ['environment-connections', environmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('environment_connections')
        .select('*')
        .eq('environment_id', environmentId!)
        .order('is_default', { ascending: false });
      if (error) throw error;
      return (data || []) as EnvironmentConnection[];
    },
    enabled: !!environmentId,
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conn: Omit<EnvironmentConnection, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('environment_connections')
        .insert(conn as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['environment-connections', vars.environment_id] });
      toast.success('Connection added');
    },
    onError: (err: any) => toast.error('Failed to add connection', { description: err.message }),
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, environmentId }: { id: string; environmentId: string }) => {
      const { error } = await supabase
        .from('environment_connections')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return environmentId;
    },
    onSuccess: (environmentId) => {
      qc.invalidateQueries({ queryKey: ['environment-connections', environmentId] });
      toast.success('Connection removed');
    },
    onError: (err: any) => toast.error('Failed to delete', { description: err.message }),
  });
}
