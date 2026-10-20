import { useSessionReady } from '@/hooks/useSessionReady';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { mockMatchRequests } from '@/data/matchRequestMockData';

export function useConsultantMatchRequests() {
  const { isGuest } = useGuestMode();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isGuest) return;
    const channel = supabase
      .channel('match-requests-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_match_requests' }, () => {
        queryClient.invalidateQueries({ queryKey: ['consultant-match-requests'] });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [isGuest, queryClient]);

  const signedIn = useSessionReady().signedIn;
  return useQuery({
    queryKey: ['consultant-match-requests'],
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
        .from('ticket_match_requests')
        .select('*')
        .eq('consultant_id', consultant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Enrich with ticket details
      const ticketIds = (data || []).map(r => r.ticket_id);
      const { data: tickets } = await supabase
        .from('tickets')
        .select('id, title, sap_module, urgency, status')
        .in('id', ticketIds.length ? ticketIds : ['none']);

      const ticketMap = new Map((tickets || []).map(t => [t.id, t]));

      return (data || []).map((r: any) => {
        const ticket = ticketMap.get(r.ticket_id);
        return {
          ...r,
          ticket_title: ticket?.title || 'Unknown',
          sap_module: ticket?.sap_module || '',
          urgency: ticket?.urgency || 'medium',
          ticket_status: ticket?.status || 'new',
        };
      });
    },
    enabled: signedIn && (!isGuest),
    placeholderData: isGuest ? mockMatchRequests : undefined,
  });
}

export function useRespondToMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, status }: { requestId: string; status: 'accepted' | 'rejected' }) => {
      const { error } = await supabase
        .from('ticket_match_requests')
        .update({ status: status as any, responded_at: new Date().toISOString() })
        .eq('id', requestId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultant-match-requests'] });
    },
  });
}

export function useAdminSendMatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, consultantId, message }: { ticketId: string; consultantId: string; message?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { error } = await supabase
        .from('ticket_match_requests')
        .insert({ ticket_id: ticketId, consultant_id: consultantId, sent_by: user.id, message } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-match-requests'] });
    },
  });
}

export function useClientMatchAcceptors(ticketId: string) {
  const { isGuest } = useGuestMode();
  const signedIn2 = useSessionReady().signedIn;
  return useQuery({
    queryKey: ['client-match-acceptors', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ticket_match_requests')
        .select('id, consultant_id, status, responded_at')
        .eq('ticket_id', ticketId)
        .eq('status', 'accepted' as any);
      if (error) throw error;

      const consultantIds = (data || []).map(r => r.consultant_id);
      if (!consultantIds.length) return [];

      const { data: consultants } = await supabase
        .from('consultants')
        .select(`id, user_id, hourly_rate, currency, rating, total_reviews, ai_skills_score,
          consultant_skills (sap_module, proficiency_level)`)
        .in('id', consultantIds);

      const { data: people } = await supabase
        .from('profile_directory')
        .select('user_id, display_name, avatar_url')
        .in('user_id', (consultants || []).map((c: any) => c.user_id));
      const personMap = new Map((people || []).map((p: any) => [p.user_id, p]));

      const cMap = new Map((consultants || []).map((c: any) => [c.id, { ...c, profiles: personMap.get(c.user_id) }]));

      return (data || []).map((r: any) => {
        const c = cMap.get(r.consultant_id) as any;
        return {
          request_id: r.id,
          consultant_id: r.consultant_id,
          responded_at: r.responded_at,
          name: c?.profiles?.display_name || 'Unknown',
          avatar_url: c?.profiles?.avatar_url,
          hourly_rate: c?.hourly_rate || 0,
          currency: c?.currency || 'USD',
          rating: c?.rating || 0,
          total_reviews: c?.total_reviews || 0,
          ai_score: c?.ai_skills_score || 0,
          modules: (c?.consultant_skills || []).map((s: any) => s.sap_module),
        };
      });
    },
    enabled: signedIn2 && (!!ticketId && !isGuest),
  });
}
