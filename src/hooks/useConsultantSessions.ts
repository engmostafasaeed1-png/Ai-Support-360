import { useSessionReady } from '@/hooks/useSessionReady';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockSessions } from '@/data/consultantMockData';

export function useConsultantSessions() {
  const { isGuest } = useGuestMode();
  const queryClient = useQueryClient();


  const signedIn = useSessionReady().signedIn;
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
        .select('id, session_type, status, scheduled_at, duration_minutes, ticket_id, consultant_id')
        .eq('consultant_id', consultant.id)
        .order('scheduled_at', { ascending: true });
      if (error) throw error;
      return (data || []).map((s: any) => ({
        id: s.id,
        ticket_id: s.ticket_id || '',
        client: 'Client',
        session_type: s.session_type || 'chat',
        status: s.status || 'scheduled',
        scheduled_at: s.scheduled_at,
        duration_minutes: s.duration_minutes || 30,
      }));
    },
    enabled: signedIn && (!isGuest),
    placeholderData: isGuest ? mockSessions : undefined,
  });
}
