import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { consultantIdFor, subscribeWhileVisible } from '@/lib/realtimeVisibility';

/**
 * One app-wide channel for the signed-in person's OWN tickets (as client: client_id, as consultant: consultant_id).
 * Never subscribes for visitors, never to the whole table, and only while the tab is visible.
 * Administrator pages that need every ticket keep their own channel (useAdminData).
 * Sessions are no longer pushed live: their lists refresh when opened (lifecycle changes are rare).
 */
export function useRealtimeStatusSync() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => { if (alive) setUserId(data.session?.user.id ?? null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setUserId(s?.user.id ?? null));
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!userId) return;
    const invalidateTicketCaches = (ticketId?: string | null) => {
      for (const key of ['client-tickets', 'consultant-cases', 'pm-tickets', 'admin-tickets-kanban', 'admin-stats', 'client-stats', 'consultant-dashboard', 'client-dashboard']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      queryClient.invalidateQueries({ queryKey: ticketId ? ['ticket-detail', ticketId] : ['ticket-detail'] });
    };
    const onChange = (payload: { eventType: string; old: unknown; new: unknown }) => {
      const oldRow = payload.old as Record<string, unknown> | null;
      const newRow = payload.new as Record<string, unknown> | null;
      if (payload.eventType === 'UPDATE') {
        // Only refresh dashboards when a meaningful field changed; always refresh the open ticket.
        const meaningful = oldRow?.status !== newRow?.status || oldRow?.consultant_id !== newRow?.consultant_id || oldRow?.urgency !== newRow?.urgency;
        if (meaningful) invalidateTicketCaches(newRow?.id as string);
        else if (newRow?.id) queryClient.invalidateQueries({ queryKey: ['ticket-detail', newRow.id] });
        return;
      }
      invalidateTicketCaches((newRow?.id ?? oldRow?.id) as string | undefined);
    };

    let cleanup: (() => void) | null = null;
    let cancelled = false;
    consultantIdFor(userId).then((consultantId) => {
      if (cancelled) return;
      cleanup = subscribeWhileVisible(() => {
        const channel = supabase
          .channel(`my-tickets-${userId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `client_id=eq.${userId}` }, onChange);
        if (consultantId) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'tickets', filter: `consultant_id=eq.${consultantId}` }, onChange);
        return channel;
      }, () => invalidateTicketCaches());
    }).catch(() => { /* live refresh is optional */ });
    return () => { cancelled = true; cleanup?.(); };
  }, [userId, queryClient]);
}
