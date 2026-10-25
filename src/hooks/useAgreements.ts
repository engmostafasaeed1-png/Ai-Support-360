import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenant } from '@/contexts/TenantContext';
import * as api from '@/lib/agreements/api';

/** The viewer's agreements (client: own company; consultant: lead, team, applications) + feature switch. */
export function useAgreementsMine() {
  const { tenant, loading } = useTenant();
  return useQuery({ queryKey: ['sa-mine', tenant?.id ?? null], queryFn: () => api.fetchMine(tenant?.id ?? null), enabled: !loading, staleTime: 30_000, retry: false });
}

export function useAgreement(id: string | undefined) {
  return useQuery({ queryKey: ['sa-detail', id], queryFn: () => api.fetchAgreement(id as string), enabled: !!id, retry: false, staleTime: 15_000 });
}

export function useOpportunities(enabled: boolean) {
  return useQuery({ queryKey: ['sa-opportunities'], queryFn: api.fetchOpportunities, enabled, retry: false, staleTime: 30_000 });
}

export function useUsableAgreements(enabled: boolean) {
  const { tenant, loading } = useTenant();
  return useQuery({
    queryKey: ['sa-usable', tenant?.id ?? null], enabled: enabled && !loading, retry: false, staleTime: 60_000,
    queryFn: async () => { try { return await api.fetchUsable(tenant?.id ?? null); } catch { return []; } },
  });
}

/** "Agreement: <name>" tags for ticket lists and headers; empty (and silent) until the SQL is applied. */
export function useAgreementTags(ticketIds: string[]) {
  const key = useMemo(() => [...ticketIds].sort().slice(0, 200), [ticketIds]);
  const q = useQuery({
    queryKey: ['sa-tags', key], enabled: key.length > 0, retry: false, staleTime: 60_000,
    queryFn: async () => { try { return await api.fetchTicketTags(key); } catch { return []; } },
  });
  return useMemo(() => new Map((q.data ?? []).map((r) => [r.ticket_id, r])), [q.data]);
}

export function useAdminAgreements(status: string | null) {
  return useQuery({ queryKey: ['sa-admin', status], queryFn: () => api.adminList(status), retry: false, staleTime: 15_000 });
}

export function useRefreshAgreements() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['sa-mine'] });
    qc.invalidateQueries({ queryKey: ['sa-detail'] });
    qc.invalidateQueries({ queryKey: ['sa-opportunities'] });
    qc.invalidateQueries({ queryKey: ['sa-admin'] });
    qc.invalidateQueries({ queryKey: ['sa-usable'] });
  };
}
