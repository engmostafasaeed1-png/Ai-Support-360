import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const FUNCTION_NAME = 'anydesk-api';

type AnyDeskStatus = {
  configured: boolean;
  missing?: string[];
};

export type AnyDeskClient = {
  cid?: string | number;
  id?: string | number;
  alias?: string;
  online?: boolean;
  status?: string;
  os?: string;
};

export type AnyDeskSession = {
  sid?: string;
  source?: { alias?: string; cid?: string | number };
  destination?: { alias?: string; cid?: string | number };
  start?: string;
  duration?: number;
};

export type AnyDeskLicense = {
  name?: string;
  expires?: string;
  max_clients?: number;
  max_sessions?: number;
  namespaces?: string[] | string;
};

type AnyDeskClientsResponse = {
  clients: AnyDeskClient[];
};

type AnyDeskSessionsResponse = {
  sessions: AnyDeskSession[];
};

type AnyDeskConnectionLinkResponse = {
  uri: string;
  clientId: string;
  instructions: string;
};

function normalizeClientsResponse(payload: unknown): AnyDeskClientsResponse {
  if (Array.isArray(payload)) {
    return { clients: payload as AnyDeskClient[] };
  }

  if (payload && typeof payload === 'object' && Array.isArray((payload as { clients?: unknown }).clients)) {
    return { clients: (payload as { clients: AnyDeskClient[] }).clients };
  }

  return { clients: [] };
}

function normalizeSessionsResponse(payload: unknown): AnyDeskSessionsResponse {
  if (Array.isArray(payload)) {
    return { sessions: payload as AnyDeskSession[] };
  }

  if (payload && typeof payload === 'object' && Array.isArray((payload as { sessions?: unknown }).sessions)) {
    return { sessions: (payload as { sessions: AnyDeskSession[] }).sessions };
  }

  return { sessions: [] };
}

function normalizeLicenseResponse(payload: unknown): AnyDeskLicense {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return payload as AnyDeskLicense;
  }

  return {};
}

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
  return useQuery<AnyDeskClientsResponse>({
    queryKey: ['anydesk-clients', online],
    queryFn: async () => normalizeClientsResponse(await callAnyDesk('clients', online ? { online: 'true' } : {})),
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
  return useQuery<AnyDeskSessionsResponse>({
    queryKey: ['anydesk-sessions', clientId],
    queryFn: async () => normalizeSessionsResponse(await callAnyDesk('sessions', clientId ? { clientId } : {})),
    enabled,
  });
}

export function useAnyDeskLicense(enabled = true) {
  return useQuery<AnyDeskLicense>({
    queryKey: ['anydesk-license'],
    queryFn: async () => normalizeLicenseResponse(await callAnyDesk('license')),
    enabled,
  });
}

export function useAnyDeskConnectionLink() {
  return useMutation({
    mutationFn: (clientId: string) => callAnyDesk<AnyDeskConnectionLinkResponse>('connection-link', { clientId }),
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
