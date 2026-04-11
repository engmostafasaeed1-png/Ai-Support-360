import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockClientSessions } from '@/data/clientMockData';

export function useClientSessions() {
  const { isGuest } = useGuestMode();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isGuest) return;
    const channel = supabase
      .channel('client-sessions-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => {
        queryClient.invalidateQueries({ queryKey: ['client-sessions'] });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [isGuest, queryClient]);

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

      // Resolve consultant names
      const consultantIds = [...new Set((data || []).map(s => s.consultant_id).filter(Boolean))];
      let consultantMap: Record<string, string> = {};
      if (consultantIds.length > 0) {
        const { data: consultants } = await supabase
          .from('consultants')
          .select('id, user_id')
          .in('id', consultantIds as string[]);
        if (consultants && consultants.length > 0) {
          const userIds = consultants.map(c => c.user_id);
          const { data: profiles } = await supabase
            .from('profiles')
            .select('user_id, display_name')
            .in('user_id', userIds);
          const profileMap: Record<string, string> = {};
          (profiles || []).forEach(p => { profileMap[p.user_id] = p.display_name || 'Consultant'; });
          consultants.forEach(c => { consultantMap[c.id] = profileMap[c.user_id] || 'Consultant'; });
        }
      }

      return (data || []).map((s: any) => ({
        id: s.id,
        ticket_title: '',
        consultant: s.consultant_id ? (consultantMap[s.consultant_id] || 'Consultant') : 'Unassigned',
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
