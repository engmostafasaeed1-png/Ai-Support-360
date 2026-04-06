import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';

export function useConsultantProposals() {
  const { isGuest } = useGuestMode();
  return useQuery({
    queryKey: ['consultant-proposals'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: consultant } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      if (!consultant) return [];

      const { data, error } = await supabase
        .from('proposals')
        .select('*')
        .eq('consultant_id', consultant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const ticketIds = (data || []).map(r => r.ticket_id);
      const { data: tickets } = await supabase
        .from('tickets')
        .select('id, title, sap_module, urgency, status')
        .in('id', ticketIds.length ? ticketIds : ['none']);
      const ticketMap = new Map((tickets || []).map(t => [t.id, t]));

      return (data || []).map((p: any) => {
        const ticket = ticketMap.get(p.ticket_id);
        return { ...p, ticket_title: ticket?.title || 'Unknown', sap_module: ticket?.sap_module || '', urgency: ticket?.urgency || 'medium' };
      });
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockProposals : undefined,
  });
}

export function useTicketProposals(ticketId: string) {
  const { isGuest } = useGuestMode();
  return useQuery({
    queryKey: ['ticket-proposals', ticketId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('proposals')
        .select('*')
        .eq('ticket_id', ticketId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const consultantIds = (data || []).map(r => r.consultant_id);
      if (!consultantIds.length) return [];

      const { data: consultants } = await supabase
        .from('consultants')
        .select(`id, hourly_rate, rating, total_reviews, profiles:user_id (display_name, avatar_url)`)
        .in('id', consultantIds);
      const cMap = new Map((consultants || []).map((c: any) => [c.id, c]));

      return (data || []).map((p: any) => {
        const c = cMap.get(p.consultant_id) as any;
        return {
          ...p,
          consultant_name: c?.profiles?.display_name || 'Unknown',
          consultant_avatar: c?.profiles?.avatar_url,
          consultant_rating: c?.rating || 0,
          consultant_reviews: c?.total_reviews || 0,
        };
      });
    },
    enabled: !!ticketId && !isGuest,
  });
}

export function useSubmitProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { ticket_id: string; cover_letter: string; proposed_rate: number; estimated_hours: number; timeline_days: number }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: consultant } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      if (!consultant) throw new Error('Consultant profile not found');

      const { error } = await supabase.from('proposals').insert({
        ...payload,
        consultant_id: consultant.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultant-proposals'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-proposals'] });
    },
  });
}

export function useRespondToProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ proposalId, status, client_notes }: { proposalId: string; status: 'accepted' | 'rejected'; client_notes?: string }) => {
      const { error } = await supabase
        .from('proposals')
        .update({ status: status as any, client_notes } as any)
        .eq('id', proposalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-proposals'] });
    },
  });
}

const mockProposals = [
  { id: '1', ticket_id: 't1', consultant_id: 'c1', cover_letter: 'I have 10+ years of SAP FI experience...', proposed_rate: 150, estimated_hours: 20, timeline_days: 14, status: 'pending', created_at: '2026-04-01', ticket_title: 'GL Account Reconciliation Issue', sap_module: 'FI', urgency: 'high' },
  { id: '2', ticket_id: 't2', consultant_id: 'c1', cover_letter: 'Expert in S/4HANA migrations...', proposed_rate: 175, estimated_hours: 40, timeline_days: 30, status: 'accepted', created_at: '2026-03-25', ticket_title: 'S/4HANA Migration Support', sap_module: 'S/4HANA', urgency: 'critical' },
  { id: '3', ticket_id: 't3', consultant_id: 'c1', cover_letter: 'SD pricing procedure specialist...', proposed_rate: 130, estimated_hours: 10, timeline_days: 7, status: 'rejected', created_at: '2026-03-20', ticket_title: 'SD Pricing Configuration', sap_module: 'SD', urgency: 'medium' },
];
