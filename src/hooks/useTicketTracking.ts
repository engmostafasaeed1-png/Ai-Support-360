import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getListFacts, getTimeline, getTracking, setWorkingStatus, type TrackingState } from '@/lib/tracking/api';
import { deriveStage, normalizeSettings, type TrackingSettings, type TrackingSummary } from '@/lib/ticketTracking';

/** Tracking of one ticket for the signed-in person. `visible` is false while the feature is off or not installed. */
export function useTicketTracking(ticketId: string | undefined) {
  const q = useQuery({
    queryKey: ['ticket-tracking', ticketId],
    queryFn: async () => {
      const r = await getTracking(ticketId!);
      if (r.error) return { enabled: false, role: null, notReady: r.notReady } as TrackingState & { notReady?: boolean };
      return (r.data ?? { enabled: false, role: null }) as TrackingState & { notReady?: boolean };
    },
    enabled: !!ticketId,
    staleTime: 30_000,
    retry: false,
  });
  const state = q.data;
  const settings: TrackingSettings = useMemo(() => normalizeSettings(state?.settings), [state?.settings]);
  const derived = useMemo(() => (state?.facts ? deriveStage(state.facts) : null), [state?.facts]);
  const visible = !!state?.facts && !!state.role;
  return { ...q, state, settings, derived, visible };
}

export function useTrackingTimeline(ticketId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['ticket-tracking-timeline', ticketId],
    queryFn: async () => {
      const r = await getTimeline(ticketId!);
      return r.data ?? [];
    },
    enabled: !!ticketId && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export function useSetWorkingStatus(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { status: string; note: string; expectedDate: string | null; responsible: string | null; version: number | null }) => {
      const r = await setWorkingStatus({ ticketId, ...a });
      if (r.error) {
        const e = new Error(r.error.message) as Error & { code?: string };
        e.code = r.error.code;
        throw e;
      }
      return r.data;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['ticket-tracking', ticketId] });
      void qc.invalidateQueries({ queryKey: ['ticket-tracking-timeline', ticketId] });
      void qc.invalidateQueries({ queryKey: ['ticket-tracking-list'] });
    },
  });
}

/** Facts for the tickets of a list; an empty map while the feature is off (then no chips or filters appear). */
export function useTrackingSummaries(ids: string[]) {
  const key = useMemo(() => [...ids].sort().join(','), [ids]);
  return useQuery({
    queryKey: ['ticket-tracking-list', key],
    queryFn: async () => {
      const map = new Map<string, TrackingSummary>();
      if (!ids.length) return map;
      const r = await getListFacts(ids);
      for (const row of r.data ?? []) map.set(row.ticket_id, { ticket_id: row.ticket_id, role: row.role, facts: row.facts });
      return map;
    },
    enabled: ids.length > 0,
    staleTime: 30_000,
    retry: false,
  });
}

/** The working status list and rules (labels, colours, matrix); shared by lists and the admin screens. */
export function useTrackingSettings() {
  return useQuery({
    queryKey: ['ticket-tracking-settings'],
    queryFn: async () => {
      const { getTrackingSettings } = await import('@/lib/tracking/api');
      const r = await getTrackingSettings();
      return { settings: normalizeSettings(r.data), notReady: r.notReady || !!r.error };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}
