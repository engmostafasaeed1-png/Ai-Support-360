import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/lib/sla/api';

/** Admin switch + severities + bounds (null-safe: before the SQL is applied `ready` is false and the feature is off). */
export function useSlaSettings() {
  return useQuery({ queryKey: ['sla-settings'], queryFn: api.fetchPublicSettings, staleTime: 5 * 60_000, retry: false });
}

/** True only when the database part exists and the owner switched it on. */
export function useSlaEnabled() {
  const q = useSlaSettings();
  return !!q.data?.ready && !!q.data?.enabled;
}

export function useTicketSla(ticketId: string | null | undefined) {
  const on = useSlaEnabled();
  return useQuery({
    queryKey: ['sla-ticket', ticketId],
    queryFn: () => api.fetchTicketSla(ticketId as string),
    enabled: !!ticketId && on,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
}

export function useSlaListStates(ids: string[]) {
  const on = useSlaEnabled();
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: ['sla-list', key],
    queryFn: () => api.fetchListStates(ids),
    enabled: on && ids.length > 0,
    staleTime: 60_000,
    retry: false,
  });
}

export function useSlaTicketAction<A>(ticketId: string, fn: (a: A) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sla-ticket', ticketId] });
      void qc.invalidateQueries({ queryKey: ['sla-list'] });
    },
  });
}

export function useMyPolicies(tenant: string | null, enabled = true) {
  return useQuery({ queryKey: ['sla-policies', tenant], queryFn: () => api.fetchMyPolicies(tenant), enabled, retry: false });
}

export function usePolicy(id: string | null) {
  return useQuery({ queryKey: ['sla-policy', id], queryFn: () => api.fetchPolicy(id as string), enabled: !!id, retry: false });
}

export function useInvalidatePolicies() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['sla-policies'] });
    void qc.invalidateQueries({ queryKey: ['sla-policy'] });
    void qc.invalidateQueries({ queryKey: ['sla-admin-policies'] });
  };
}

export function useSlaReport(kind: 'client' | 'consultant' | 'admin', days: number, tenant: string | null = null) {
  const on = useSlaEnabled();
  return useQuery({
    queryKey: ['sla-report', kind, days, tenant],
    queryFn: () => (kind === 'client' ? api.fetchClientReport(tenant, days) : kind === 'consultant' ? api.fetchConsultantReport(days) : api.fetchAdminReport(days)),
    enabled: on || kind === 'admin',
    staleTime: 60_000,
    retry: false,
  });
}
