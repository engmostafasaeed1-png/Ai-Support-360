import { useQuery } from '@tanstack/react-query';
import { useTenant } from '@/contexts/TenantContext';
import { archTimeline, getArch, getArchSettings, listArchDocs, listLandscape } from '@/lib/architecture/api';

/**
 * Feature state for the Solution Architecture page:
 *   notReady  the database update (docs/sql/solution-architecture.sql) is not applied: the page keeps its examples;
 *   enabled   the owner switched it on (admin setting, default off): New Document works.
 */
export function useArchSettings() {
  return useQuery({
    queryKey: ['arch-settings'],
    queryFn: async () => {
      const r = await getArchSettings();
      return { ready: !r.notReady && !r.error, enabled: !!r.data?.enabled, aiEnabled: !!r.data?.ai_enabled };
    },
    staleTime: 60_000,
  });
}

export function useArchList(enabled: boolean, includeArchived = false) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ['arch-list', tenant?.id ?? null, includeArchived],
    enabled,
    queryFn: async () => {
      const r = await listArchDocs(tenant?.id ?? null, includeArchived);
      if (r.error) throw new Error(r.error.message);
      return r.data ?? [];
    },
  });
}

export function useArchDoc(docId: string | undefined) {
  return useQuery({
    queryKey: ['arch-doc', docId],
    enabled: !!docId,
    queryFn: async () => {
      const r = await getArch(docId!);
      if (r.error) return { notReady: !!r.notReady, error: r.error.message, state: null };
      return { notReady: false, error: null, state: r.data };
    },
  });
}

export function useLandscape(enabled: boolean) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ['arch-landscape', tenant?.id ?? null],
    enabled,
    queryFn: async () => {
      const r = await listLandscape(tenant?.id ?? null);
      if (r.error) throw new Error(r.error.message);
      return r.data ?? [];
    },
  });
}

export function useArchTimeline(enabled: boolean) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ['arch-timeline', tenant?.id ?? null],
    enabled,
    queryFn: async () => {
      const r = await archTimeline(tenant?.id ?? null);
      if (r.error) throw new Error(r.error.message);
      return r.data ?? [];
    },
  });
}
