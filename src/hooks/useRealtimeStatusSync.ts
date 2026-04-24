import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Subscribes to realtime status changes on `tickets` and `sessions` and
 * invalidates the React Query caches that power dashboards and lists across
 * client / consultant / admin roles. Mounted once globally in App.
 *
 * Optimised to only invalidate when a status (or related lifecycle column)
 * actually changes, so we don't thrash the network on noisy updates.
 */
export function useRealtimeStatusSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidateTicketCaches = (ticketId?: string | null) => {
      // Lists & dashboards
      queryClient.invalidateQueries({ queryKey: ['client-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['consultant-cases'] });
      queryClient.invalidateQueries({ queryKey: ['admin-tickets-kanban'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      queryClient.invalidateQueries({ queryKey: ['client-stats'] });
      queryClient.invalidateQueries({ queryKey: ['consultant-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['client-dashboard'] });
      // Detail
      if (ticketId) {
        queryClient.invalidateQueries({ queryKey: ['ticket-detail', ticketId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['ticket-detail'] });
      }
    };

    const invalidateSessionCaches = (sessionId?: string | null) => {
      queryClient.invalidateQueries({ queryKey: ['client-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['consultant-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['consultant-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['client-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
      if (sessionId) {
        queryClient.invalidateQueries({ queryKey: ['session-detail', sessionId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['session-detail'] });
      }
    };

    const channel = supabase
      .channel(`realtime-status-sync-${Date.now()}`)
      // Tickets — any insert/update/delete affects lists; status changes also
      // affect kanban columns and dashboard counters.
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tickets' },
        (payload) => invalidateTicketCaches((payload.new as any)?.id)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tickets' },
        (payload) => {
          const oldRow = payload.old as any;
          const newRow = payload.new as any;
          // Only refresh dashboards when a meaningful field changed; always
          // refresh the specific ticket detail so the open page stays live.
          const statusChanged = oldRow?.status !== newRow?.status;
          const assignmentChanged = oldRow?.consultant_id !== newRow?.consultant_id;
          const urgencyChanged = oldRow?.urgency !== newRow?.urgency;
          if (statusChanged || assignmentChanged || urgencyChanged) {
            invalidateTicketCaches(newRow?.id);
          } else if (newRow?.id) {
            queryClient.invalidateQueries({ queryKey: ['ticket-detail', newRow.id] });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'tickets' },
        () => invalidateTicketCaches()
      )
      // Sessions — scheduled / in_progress / completed / cancelled transitions
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sessions' },
        (payload) => invalidateSessionCaches((payload.new as any)?.id)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions' },
        (payload) => {
          const oldRow = payload.old as any;
          const newRow = payload.new as any;
          const statusChanged = oldRow?.status !== newRow?.status;
          const startedChanged = oldRow?.started_at !== newRow?.started_at;
          const endedChanged = oldRow?.ended_at !== newRow?.ended_at;
          const scheduledChanged = oldRow?.scheduled_at !== newRow?.scheduled_at;
          if (statusChanged || startedChanged || endedChanged || scheduledChanged) {
            invalidateSessionCaches(newRow?.id);
          } else if (newRow?.id) {
            queryClient.invalidateQueries({ queryKey: ['session-detail', newRow.id] });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'sessions' },
        () => invalidateSessionCaches()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
