import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNCTION_NAME = 'anydesk-api';

type AnyDeskStatus = {
  configured: boolean;
  missing?: string[];
};

async function getFunctionErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'context' in error) {
    const response = (error as { context?: unknown }).context;

    if (response instanceof Response) {
      try {
        const payload = await response.clone().json();
        if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
          return payload.error;
        }
      } catch {
        try {
          const text = await response.clone().text();
          if (text) return text;
        } catch {
          // ignore parsing fallback errors
        }
      }

      return `AnyDesk request failed with status ${response.status}`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Unexpected AnyDesk error';
}

async function callAnyDesk<T = unknown>(action: string, params?: Record<string, string>, body?: Record<string, unknown>) {
  const method = body ? 'POST' : 'GET';
  const queryParams = new URLSearchParams({ action, ...params });

  const { data, error } = await supabase.functions.invoke(`${FUNCTION_NAME}?${queryParams.toString()}`, {
    method: method as any,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (error) {
    throw new Error(await getFunctionErrorMessage(error));
  }

  return data as T;
}

export function useAnyDeskStatus() {
  return useQuery({
    queryKey: ['anydesk-status'],
    queryFn: () => callAnyDesk<AnyDeskStatus>('status'),
    staleTime: 1000 * 60,
  });
}

export function useAnyDeskClients(online?: boolean, enabled = true) {
  return useQuery({
    queryKey: ['anydesk-clients', online],
    queryFn: () => callAnyDesk('clients', online ? { online: 'true' } : {}),
    enabled,
    refetchInterval: enabled ? 30000 : false,
  });
}

export function useAnyDeskClientDetail(clientId: string | null) {
  return useQuery({
    queryKey: ['anydesk-client', clientId],
    queryFn: () => callAnyDesk('client-detail', { clientId: clientId! }),
    enabled: !!clientId,
  });
}

export function useAnyDeskSessions(clientId?: string, enabled = true) {
  return useQuery({
    queryKey: ['anydesk-sessions', clientId],
    queryFn: () => callAnyDesk('sessions', clientId ? { clientId } : {}),
    enabled,
  });
}

export function useAnyDeskLicense(enabled = true) {
  return useQuery({
    queryKey: ['anydesk-license'],
    queryFn: () => callAnyDesk('license'),
    enabled,
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
