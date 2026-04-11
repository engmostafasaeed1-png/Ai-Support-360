import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type SharedRemoteConfig = {
  id: string;
  client_id: string;
  consultant_id: string;
  tool_type: string;
  config: Record<string, unknown>;
  status: string;
  message: string | null;
  shared_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export function useClientSharedConfigs() {
  return useQuery({
    queryKey: ['shared-remote-configs-client'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('shared_remote_configs')
        .select('*')
        .eq('client_id', user.id)
        .order('shared_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SharedRemoteConfig[];
    },
  });
}

export function useConsultantSharedConfigs() {
  return useQuery({
    queryKey: ['shared-remote-configs-consultant'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: consultant } = await supabase
        .from('consultants')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!consultant) return [];
      const { data, error } = await supabase
        .from('shared_remote_configs')
        .select('*')
        .eq('consultant_id', consultant.id)
        .neq('status', 'revoked')
        .order('shared_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SharedRemoteConfig[];
    },
  });
}

export function useShareRemoteConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      consultant_id: string;
      tool_type: string;
      config: Record<string, unknown>;
      message?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase.from('shared_remote_configs').insert({
        client_id: user.id,
        consultant_id: payload.consultant_id,
        tool_type: payload.tool_type,
        config: payload.config as any,
        message: payload.message || null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Remote config shared with consultant');
      queryClient.invalidateQueries({ queryKey: ['shared-remote-configs-client'] });
    },
    onError: () => toast.error('Failed to share config'),
  });
}

export function useResendRemoteConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (configId: string) => {
      // Re-insert a copy of existing config
      const { data: existing, error: fetchError } = await supabase
        .from('shared_remote_configs')
        .select('*')
        .eq('id', configId)
        .single();
      if (fetchError || !existing) throw new Error('Config not found');
      const { error } = await supabase.from('shared_remote_configs').insert({
        client_id: existing.client_id,
        consultant_id: existing.consultant_id,
        tool_type: existing.tool_type,
        config: existing.config,
        message: existing.message,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Config resent to consultant');
      queryClient.invalidateQueries({ queryKey: ['shared-remote-configs-client'] });
    },
    onError: () => toast.error('Failed to resend config'),
  });
}

export function useRevokeRemoteConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (configId: string) => {
      const { error } = await supabase
        .from('shared_remote_configs')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', configId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Access revoked');
      queryClient.invalidateQueries({ queryKey: ['shared-remote-configs-client'] });
    },
    onError: () => toast.error('Failed to revoke access'),
  });
}

export function useAcceptRemoteConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (configId: string) => {
      const { error } = await supabase
        .from('shared_remote_configs')
        .update({ status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', configId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Remote config accepted');
      queryClient.invalidateQueries({ queryKey: ['shared-remote-configs-consultant'] });
    },
    onError: () => toast.error('Failed to accept config'),
  });
}

export function useAvailableConsultants() {
  return useQuery({
    queryKey: ['available-consultants-for-share'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      // Get consultants assigned to the client's tickets
      const { data: tickets } = await supabase
        .from('tickets')
        .select('consultant_id')
        .eq('client_id', user.id)
        .not('consultant_id', 'is', null);
      const consultantIds = [...new Set((tickets ?? []).map(t => t.consultant_id).filter(Boolean))];
      if (!consultantIds.length) return [];
      const { data } = await supabase
        .from('consultants')
        .select('id, user_id, profiles:user_id (display_name, avatar_url)')
        .in('id', consultantIds as string[]);
      return (data ?? []).map((c: any) => ({
        id: c.id,
        user_id: c.user_id,
        display_name: c.profiles?.display_name || 'Unnamed',
        avatar_url: c.profiles?.avatar_url || null,
      }));
    },
  });
}