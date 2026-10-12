import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useTenant } from '@/contexts/TenantContext';
import { mockClientTickets } from '@/data/clientMockData';

interface ClientTicket {
  id: string; title: string; sap_module: string; urgency: string; status: string;
  created_at: string; updated_at: string | null; description: string;
  preferred_session_type: string | null; preferred_language: string | null;
  consultant_id: string | null; consultant?: string; ai_suggested_category: string | null;
  ai_suggested_priority: string | null; sla_deadline: string | null; open_for_bids: boolean;
  bid_deadline: string | null; bidding_closed_at: string | null; bidding_closed_reason: string | null;
  client_id: string; is_own: boolean;
}

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
    queryFn: async (): Promise<ClientTicket[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      let query = (supabase as any)
        .from('tickets')
        .select('id, title, sap_module, urgency, status, created_at, updated_at, description, preferred_session_type, preferred_language, consultant_id, ai_suggested_category, ai_suggested_priority, sla_deadline, open_for_bids, bid_deadline, bidding_closed_at, bidding_closed_reason, client_id')
        .order('created_at', { ascending: false });
      if (tenant?.id) {
        // the company's tickets: the user's own and, read-only, their colleagues' (row-level security decides what is visible)
        query = query.eq('tenant_id', tenant.id);
      } else {
        query = query.eq('client_id', user.id);
      }
      const { data, error } = await query;
      if (error) throw error;

      // Resolve consultant names
      const consultantIds = [...new Set((data || []).map((t: any) => t.consultant_id).filter(Boolean))];
      const consultantMap: Record<string, string> = {};
      if (consultantIds.length > 0) {
        const { data: consultants } = await supabase
          .from('consultants')
          .select('id, user_id')
          .in('id', consultantIds as string[]);
        if (consultants && consultants.length > 0) {
          const userIds = consultants.map(c => c.user_id);
          const { data: profiles } = await supabase
            .from('profile_directory')
            .select('user_id, display_name')
            .in('user_id', userIds);
          const profileMap: Record<string, string> = {};
          (profiles || []).forEach(p => { if (p.user_id) profileMap[p.user_id] = p.display_name || 'Consultant'; });
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
        bid_deadline: t.bid_deadline || null,
        bidding_closed_at: t.bidding_closed_at || null,
        bidding_closed_reason: t.bidding_closed_reason || null,
        client_id: t.client_id,
        is_own: t.client_id === user.id,
      }));
    },
    enabled: !isGuest,
    placeholderData: isGuest ? (mockClientTickets as any) : undefined,
  });
}
