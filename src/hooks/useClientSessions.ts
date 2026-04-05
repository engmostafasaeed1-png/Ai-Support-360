import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockClientSessions } from '@/data/clientMockData';

export function useClientSessions() {
  const { isGuest } = useGuestMode();

  return useQuery({
    queryKey: ['client-sessions'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('sessions')
        .select('id, session_type, status, scheduled_at, duration_minutes, ticket_id, consultant_id')
        .eq('client_id', user.id)
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      return (data || []).map((s: any) => ({
        id: s.id,
        ticket_title: '',
        consultant: 'Unassigned',
        session_type: s.session_type || 'chat',
        status: s.status || 'scheduled',
        scheduled_at: s.scheduled_at,
        duration_minutes: s.duration_minutes || 30,
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockClientSessions : undefined,
  });
}
