import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface EnvironmentCredential {
  id: string;
  environment_id: string;
  credential_label: string;
  hostname: string | null;
  port: number;
  domain: string | null;
  username: string;
  password_encrypted: string;
  entered_by: string;
  created_at: string;
  updated_at: string;
}

export function useEnvironmentCredentials(environmentId?: string) {
  return useQuery({
    queryKey: ['environment-credentials', environmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('environment_credentials')
        .select('*')
        .eq('environment_id', environmentId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as EnvironmentCredential[];
    },
    enabled: !!environmentId,
  });
}

export function useCreateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cred: Omit<EnvironmentCredential, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('environment_credentials')
        .insert(cred as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['environment-credentials', vars.environment_id] });
      toast.success('Credentials saved securely');
    },
    onError: (err: any) => toast.error('Failed to save credentials', { description: err.message }),
  });
}

export function useUpdateCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, environment_id, ...updates }: Partial<EnvironmentCredential> & { id: string; environment_id: string }) => {
      const { error } = await supabase
        .from('environment_credentials')
        .update(updates as any)
        .eq('id', id);
      if (error) throw error;
      return environment_id;
    },
    onSuccess: (envId) => {
      qc.invalidateQueries({ queryKey: ['environment-credentials', envId] });
      toast.success('Credentials updated');
    },
    onError: (err: any) => toast.error('Failed to update', { description: err.message }),
  });
}

export function useDeleteCredential() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, environmentId }: { id: string; environmentId: string }) => {
      const { error } = await supabase
        .from('environment_credentials')
        .delete()
        .eq('id', id);
      if (error) throw error;
      return environmentId;
    },
    onSuccess: (envId) => {
      qc.invalidateQueries({ queryKey: ['environment-credentials', envId] });
      toast.success('Credentials removed');
    },
    onError: (err: any) => toast.error('Failed to delete', { description: err.message }),
  });
}
