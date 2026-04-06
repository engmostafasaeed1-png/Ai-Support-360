import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useTenant } from '@/contexts/TenantContext';
import { mockClientTickets } from '@/data/clientMockData';

export function useClientTickets() {
  const { isGuest } = useGuestMode();
  const { tenant } = useTenant();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isGuest) return;
    const channel = supabase
      .channel('client-tickets-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        queryClient.invalidateQueries({ queryKey: ['client-tickets', tenant?.id] });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [isGuest, queryClient, tenant?.id]);

  return useQuery({
    queryKey: ['client-tickets', tenant?.id],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      let query = supabase
        .from('tickets')
        .select('id, title, sap_module, urgency, status, created_at, consultant_id')
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });
      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        sap_module: t.sap_module,
        urgency: t.urgency || 'medium',
        status: t.status || 'new',
        created_at: t.created_at,
        consultant: undefined,
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? (mockClientTickets as any) : undefined,
  });
}