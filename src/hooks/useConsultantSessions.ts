import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockSessions } from '@/data/consultantMockData';

export function useConsultantSessions() {
  const { isGuest } = useGuestMode();

  return useQuery({
    queryKey: ['consultant-sessions'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: consultant } = await supabase
        .from('consultants')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!consultant) return [];

      const { data, error } = await supabase
        .from('sessions')
        .select(`
          id, session_type, status, scheduled_at, duration_minutes, ticket_id,
          profiles:client_id (display_name)
        `)
        .eq('consultant_id', consultant.id)
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      return (data || []).map((s: any) => ({
        id: s.id,
        ticket_id: s.ticket_id || '',
        client: s.profiles?.display_name || 'Unknown Client',
        session_type: s.session_type || 'chat',
        status: s.status || 'scheduled',
        scheduled_at: s.scheduled_at,
        duration_minutes: s.duration_minutes || 30,
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockSessions : undefined,
  });
}
