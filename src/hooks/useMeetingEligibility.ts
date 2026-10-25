import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { scheduleBlock, type ScheduleBlock, type ScheduleRole } from '@/lib/meetingSchedule';

/** The number of active assignments of a ticket (the client and company members can read them). */
export function useActiveAssignmentCount(ticketId: string | undefined) {
  return useQuery({
    queryKey: ['ticket-active-assignment-count', ticketId],
    queryFn: async () => {
      const { count } = await supabase.from('ticket_assignments').select('id', { count: 'exact', head: true }).eq('ticket_id', ticketId!).eq('status', 'active');
      return count ?? 0;
    },
    enabled: !!ticketId,
  });
}

interface Args {
  ticketId: string | undefined;
  role: ScheduleRole;
  consultantId: string | null | undefined;
  status?: string | null;
  isOwner?: boolean;
  isAssigned?: boolean;
}

/** Why "Schedule meeting" is disabled for this ticket, from the same rule the server applies. */
export function useMeetingBlock({ ticketId, role, consultantId, status, isOwner, isAssigned }: Args): ScheduleBlock | null {
  const { data: active = 0, isLoading } = useActiveAssignmentCount(ticketId);
  return scheduleBlock({ role, hasConsultant: !!consultantId, activeAssignments: active, status, isOwner, isAssigned, loading: isLoading && !consultantId });
}
