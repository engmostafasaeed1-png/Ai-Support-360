import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useTenant } from '@/contexts/TenantContext';
import { mockClientSessions } from '@/data/clientMockData';

export function useClientSessions() {
  const { isGuest } = useGuestMode();
  const { tenant, loading: tenantLoading } = useTenant();
  const queryClient = useQueryClient();


  return useQuery({
    queryKey: ['client-sessions', tenant?.id ?? null],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      let query = supabase
        .from('sessions')
        .select('id, session_type, status, scheduled_at, duration_minutes, ticket_id, consultant_id')
        .eq('client_id', user.id)
        .order('scheduled_at', { ascending: true });
      // the sessions of the active company; a session that belongs to no company shows in every company
      if (tenant?.id) query = query.or(`tenant_id.eq.${tenant.id},tenant_id.is.null`);
      const { data, error } = await query;
      if (error) throw error;

      // Resolve consultant names
      const consultantIds = [...new Set((data || []).map(s => s.consultant_id).filter(Boolean))];
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

      // Resolve the ticket titles
      const ticketIds = [...new Set((data || []).map((s: any) => s.ticket_id).filter(Boolean))];
      const ticketTitles: Record<string, string> = {};
      if (ticketIds.length > 0) {
        const { data: tix } = await supabase.from('tickets').select('id, title').in('id', ticketIds as string[]);
        (tix || []).forEach((tk: any) => { ticketTitles[tk.id] = tk.title; });
      }

      return (data || []).map((s: any) => ({
        id: s.id,
        ticket_title: s.ticket_id ? (ticketTitles[s.ticket_id] || '') : '',
        consultant: s.consultant_id ? (consultantMap[s.consultant_id] || 'Consultant') : 'Unassigned',
        session_type: s.session_type || 'chat',
        status: s.status || 'scheduled',
        scheduled_at: s.scheduled_at,
        duration_minutes: s.duration_minutes || 30,
      }));
    },
    enabled: !isGuest && !tenantLoading,
    placeholderData: isGuest ? mockClientSessions : undefined,
  });
}
