import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockClientTickets } from '@/data/clientMockData';

export function useClientTickets() {
  const { isGuest } = useGuestMode();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isGuest) return;
    const channel = supabase
      .channel('client-tickets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        queryClient.invalidateQueries({ queryKey: ['client-tickets'] });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [isGuest, queryClient]);

  return useQuery({
    queryKey: ['client-tickets'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from('tickets')
        .select(`
          id, title, sap_module, urgency, status, created_at,
          consultants:consultant_id (
            id,
            profiles:user_id (display_name)
          )
        `)
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        sap_module: t.sap_module,
        urgency: t.urgency || 'medium',
        status: t.status || 'new',
        created_at: t.created_at,
        consultant: t.consultants?.profiles?.display_name || undefined,
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? (mockClientTickets as any) : undefined,
  });
}