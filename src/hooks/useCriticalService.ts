import { useSessionReady } from '@/hooks/useSessionReady';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { readTerms, type CriticalAlert, type CriticalTerms, type CriticalView } from '@/lib/criticalService';
import { fetchAdminCriticalRequests } from '@/lib/criticalAdmin';

// The critical-service functions are newer than the generated database types, so they are called through an untyped client.
const db = supabase as any;

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

const reason = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/** The current time, refreshed every `intervalMs` milliseconds (0 = do not tick). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs <= 0) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** The terms of the critical service: the standard window and surcharge, the limits and the switch of the administrator. */
export function useCriticalTerms() {
  const signedIn = useSessionReady().signedIn;
  return useQuery({
    enabled: signedIn,
    queryKey: ['critical-terms'],
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<CriticalTerms> => readTerms(await rpc<unknown>('critical_service_terms')),
  });
}

/** The state of the critical request of one ticket. A ticket that is not a critical request answers { critical_response: false }. */
export function useCriticalView(ticketId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['critical-view', ticketId],
    enabled: enabled && !!ticketId,
    staleTime: 5_000,
    // refreshed every 15 seconds, except for an ordinary ticket and for a ticket the person may not see
    refetchInterval: (query) => (query.state.status === 'error' || query.state.data?.critical_response === false ? false : 15_000),
    retry: false,
    queryFn: () => rpc<CriticalView>('critical_ticket_view', { _ticket_id: ticketId }),
  });
}

/** Consultant: the critical requests this consultant was alerted about in the last 24 hours (a push through realtime, a poll as the safety net). */
export function useCriticalMyAlerts(options: { realtime?: boolean } = {}) {
  const { realtime = true } = options;
  const { isGuest } = useGuestMode();
  const qc = useQueryClient();
  const signedIn2 = useSessionReady().signedIn;
  const query = useQuery({
    queryKey: ['critical-my-alerts'],
    enabled: signedIn2 && (!isGuest),
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
    queryFn: async (): Promise<CriticalAlert[]> => (await rpc<CriticalAlert[] | null>('critical_my_alerts')) ?? [],
  });
  useEffect(() => {
    if (isGuest || !realtime) return;
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getUser().then(({ data }) => {
      const userId = data.user?.id;
      if (cancelled || !userId) return;
      channel = supabase
        .channel('critical-alerts-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'critical_alerts', filter: `user_id=eq.${userId}` }, () => {
          qc.invalidateQueries({ queryKey: ['critical-my-alerts'] });
        })
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [isGuest, realtime, qc]);
  return query;
}

/** Consultant: "Not for me" - the alarm of this ticket stops (until the client raises the surcharge). */
export function useDismissCriticalAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticketId: string) => rpc<void>('critical_dismiss_alert', { _ticket_id: ticketId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['critical-my-alerts'] }),
    onError: (e) => toast.error(reason(e, 'The alert could not be dismissed')),
  });
}

/** Asks the server to e-mail the consultants who were alerted (best effort: the alarm and the notice come from the database anyway). */
export async function notifyCriticalByEmail(ticketId: string): Promise<void> {
  try {
    await supabase.functions.invoke('critical-request-alert', { body: { ticket_id: ticketId } });
  } catch {
    // the in-app alarm does not depend on the e-mail
  }
}

/** Client: more time and/or a higher surcharge while no consultant is assigned. The consultants are alarmed again. */
export function useExtendCritical() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ticketId: string; extraMinutes: number; newPercent: number | null }) =>
      rpc<CriticalView>('critical_extend', { _ticket_id: v.ticketId, _extra_minutes: v.extraMinutes, _new_percent: v.newPercent }),
    onSuccess: (view, v) => {
      qc.setQueryData(['critical-view', v.ticketId], view);
      qc.invalidateQueries({ queryKey: ['critical-view', v.ticketId] });
      qc.invalidateQueries({ queryKey: ['ticket-detail'] });
      void notifyCriticalByEmail(v.ticketId);
    },
    onError: (e) => toast.error(reason(e, 'The request could not be changed')),
  });
}

/** Admin: the latest critical requests and every open one, with how many consultants were alerted and how many replied (refreshed every 15 seconds). */
export function useAdminCriticalRequests(limit = 12) {
  return useQuery({
    queryKey: ['admin-critical-requests', limit],
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
    queryFn: () => fetchAdminCriticalRequests(db, limit),
  });
}

/** Admin: the switch and the numbers of the service. */
export function useSaveCriticalService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: CriticalTerms) =>
      rpc<unknown>('admin_set_critical_service', {
        _enabled: v.enabled,
        _minutes: v.minutes,
        _percent: v.surcharge_percent,
        _max_minutes: v.max_minutes,
        _max_percent: v.max_surcharge_percent,
      }),
    onSuccess: () => {
      toast.success('Saved');
      qc.invalidateQueries({ queryKey: ['critical-terms'] });
    },
    onError: (e) => toast.error(reason(e, 'The settings could not be saved')),
  });
}
