import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNCTION_NAME = 'anydesk-api';

async function callAnyDesk(action: string, params?: Record<string, string>, body?: Record<string, unknown>) {
  const method = body ? 'POST' : 'GET';
  const queryParams = new URLSearchParams({ action, ...params });

  const { data, error } = await supabase.functions.invoke(`${FUNCTION_NAME}?${queryParams.toString()}`, {
    method: method as any,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (error) throw error;
  return data;
}

export function useAnyDeskClients(online?: boolean) {
  return useQuery({
    queryKey: ['anydesk-clients', online],
    queryFn: () => callAnyDesk('clients', online ? { online: 'true' } : {}),
    refetchInterval: 30000, // refresh every 30s
  });
}

export function useAnyDeskClientDetail(clientId: string | null) {
  return useQuery({
    queryKey: ['anydesk-client', clientId],
    queryFn: () => callAnyDesk('client-detail', { clientId: clientId! }),
    enabled: !!clientId,
  });
}

export function useAnyDeskSessions(clientId?: string) {
  return useQuery({
    queryKey: ['anydesk-sessions', clientId],
    queryFn: () => callAnyDesk('sessions', clientId ? { clientId } : {}),
  });
}

export function useAnyDeskLicense() {
  return useQuery({
    queryKey: ['anydesk-license'],
    queryFn: () => callAnyDesk('license'),
  });
}

export function useAnyDeskConnectionLink() {
  return useMutation({
    mutationFn: (clientId: string) => callAnyDesk('connection-link', { clientId }),
  });
}

export function useAnyDeskSetAlias() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, alias }: { clientId: string; alias: string }) =>
      callAnyDesk('set-alias', undefined, { clientId, alias }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anydesk-clients'] });
    },
  });
}
