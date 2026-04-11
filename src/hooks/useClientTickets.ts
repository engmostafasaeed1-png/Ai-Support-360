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
        .select('id, title, sap_module, urgency, status, created_at, updated_at, description, preferred_session_type, preferred_language, consultant_id, ai_suggested_category, ai_suggested_priority, sla_deadline, open_for_bids')
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });
      if (tenant?.id) {
        query = query.eq('tenant_id', tenant.id);
      }
      const { data, error } = await query;
      if (error) throw error;

      // Resolve consultant names
      const consultantIds = [...new Set((data || []).map(t => t.consultant_id).filter(Boolean))];
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

      return (data || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        sap_module: t.sap_module,
        urgency: t.urgency || 'medium',
        status: t.status || 'new',
        created_at: t.created_at,
        updated_at: t.updated_at,
        description: t.description || '',
        preferred_session_type: t.preferred_session_type || null,
        preferred_language: t.preferred_language || null,
        consultant_id: t.consultant_id || null,
        consultant: t.consultant_id ? (consultantMap[t.consultant_id] || 'Assigned') : undefined,
        ai_suggested_category: t.ai_suggested_category || null,
        ai_suggested_priority: t.ai_suggested_priority || null,
        sla_deadline: t.sla_deadline || null,
        open_for_bids: t.open_for_bids || false,
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? (mockClientTickets as any) : undefined,
  });
}
