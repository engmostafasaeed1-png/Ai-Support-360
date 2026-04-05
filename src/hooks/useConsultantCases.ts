import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockCases } from '@/data/consultantMockData';

export function useConsultantCases() {
  const { isGuest } = useGuestMode();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isGuest) return;
    const channel = supabase
      .channel('consultant-cases-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        queryClient.invalidateQueries({ queryKey: ['consultant-cases'] });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [isGuest, queryClient]);

  return useQuery({
    queryKey: ['consultant-cases'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      // Get consultant record first
      const { data: consultant } = await supabase
        .from('consultants')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!consultant) return [];

      const { data, error } = await supabase
        .from('tickets')
        .select(`
          id, title, sap_module, urgency, status, created_at, sla_deadline, resolved_at,
          profiles:client_id (display_name)
        `)
        .eq('consultant_id', consultant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        client: t.profiles?.display_name || 'Unknown Client',
        sap_module: t.sap_module,
        urgency: t.urgency || 'medium',
        status: t.status || 'new',
        created_at: t.created_at,
        sla_deadline: t.sla_deadline || '',
        resolved_at: t.resolved_at || undefined,
      })) as typeof mockCases;
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockCases : undefined,
  });
}
