import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { safeFileName } from '@/lib/storagePath';

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
      const proposalIds = (data || []).map(r => r.id);

      const [{ data: tickets }, { data: attachments }] = await Promise.all([
        supabase.from('tickets').select('id, title, sap_module, urgency, status').in('id', ticketIds.length ? ticketIds : ['none']),
        supabase.from('proposal_attachments').select('id, proposal_id, file_name').in('proposal_id', proposalIds.length ? proposalIds : ['none']),
      ]);

      const ticketMap = new Map((tickets || []).map(t => [t.id, t]));
      const attachMap = new Map<string, number>();
      (attachments || []).forEach((a: any) => {
        attachMap.set(a.proposal_id, (attachMap.get(a.proposal_id) || 0) + 1);
      });

      return (data || []).map((p: any) => {
        const ticket = ticketMap.get(p.ticket_id);
        return {
          ...p,
          ticket_title: ticket?.title || 'Unknown',
          sap_module: ticket?.sap_module || '',
          urgency: ticket?.urgency || 'medium',
          attachment_count: attachMap.get(p.id) || 0,
        };
      });
    },
    enabled: !isGuest,
    placeholderData: isGuest ? mockProposals : undefined,
  });
}

export function useProposalVersions(ticketId: string) {
  return useQuery({
    queryKey: ['proposal-versions', ticketId],
    enabled: !!ticketId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data: consultant } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      if (!consultant) return [];

      const { data, error } = await supabase
        .from('proposals')
        .select('id, version, status, created_at, proposed_rate, estimated_hours')
        .eq('ticket_id', ticketId)
        .eq('consultant_id', consultant.id)
        .order('version', { ascending: false });
      if (error) throw error;
      return data || [];
    },
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
      const proposalIds = (data || []).map(r => r.id);
      if (!consultantIds.length) return [];

      const [{ data: consultants }, { data: attachments }] = await Promise.all([
        supabase.from('consultants').select('id, user_id, hourly_rate, rating, total_reviews').in('id', consultantIds),
        supabase.from('proposal_attachments').select('*').in('proposal_id', proposalIds.length ? proposalIds : ['none']),
      ]);

      const { data: people } = await supabase
        .from('profile_directory')
        .select('user_id, display_name, avatar_url')
        .in('user_id', (consultants || []).map((c: any) => c.user_id));
      const personMap = new Map((people || []).map((p: any) => [p.user_id, p]));
      const cMap = new Map((consultants || []).map((c: any) => [c.id, { ...c, profiles: personMap.get(c.user_id) }]));
      const attachByProposal = new Map<string, any[]>();
      (attachments || []).forEach((a: any) => {
        if (!attachByProposal.has(a.proposal_id)) attachByProposal.set(a.proposal_id, []);
        attachByProposal.get(a.proposal_id)!.push(a);
      });

      return (data || []).map((p: any) => {
        const c = cMap.get(p.consultant_id) as any;
        return {
          ...p,
          consultant_name: c?.profiles?.display_name || 'Unknown',
          consultant_avatar: c?.profiles?.avatar_url,
          consultant_rating: c?.rating || 0,
          consultant_reviews: c?.total_reviews || 0,
          attachments: attachByProposal.get(p.id) || [],
        };
      });
    },
    enabled: !!ticketId && !isGuest,
  });
}

export function useSubmitProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      ticket_id: string;
      cover_letter: string;
      proposed_rate: number;
      estimated_hours: number;
      timeline_days: number;
      files?: File[];
      parent_proposal_id?: string;
      version?: number;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: consultant } = await supabase.from('consultants').select('id').eq('user_id', user.id).maybeSingle();
      if (!consultant) throw new Error('Consultant profile not found');

      const { files, ...rest } = payload;

      const { data: proposal, error } = await supabase.from('proposals').insert({
        ...rest,
        consultant_id: consultant.id,
      } as any).select('id').single();
      if (error) throw error;

      // Upload attachments
      if (files && files.length > 0 && proposal) {
        for (const file of files) {
          const storagePath = `proposals/${proposal.id}/${Date.now()}_${safeFileName(file.name)}`;
          const { error: uploadErr } = await supabase.storage.from('proposal-documents').upload(storagePath, file);
          if (uploadErr) throw uploadErr;

          const { error: insertErr } = await supabase.from('proposal_attachments').insert({
            proposal_id: proposal.id,
            uploaded_by: user.id,
            file_name: file.name,
            file_url: storagePath,
            file_size: file.size,
            mime_type: file.type || null,
          } as any);
          if (insertErr) throw insertErr;
        }
      }

      // The client is notified by a database trigger when a proposal arrives.
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['consultant-proposals'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-proposals'] });
      queryClient.invalidateQueries({ queryKey: ['proposal-versions'] });
      queryClient.invalidateQueries({ queryKey: ['critical-my-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['critical-view'] });
    },
  });
}

export function useRespondToProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ proposalId, status, client_notes }: { proposalId: string; status: 'accepted' | 'rejected'; client_notes?: string }) => {
      if (status === 'accepted') {
        // one server step: accept this bid, assign the consultant and reject the other pending bids
        const { error: acceptError } = await supabase.rpc('accept_proposal', { _proposal_id: proposalId, _client_notes: client_notes ?? undefined });
        if (acceptError) throw acceptError;
        return;
      }
      // Rejecting is a plain status update (acceptance is handled by accept_proposal above)
      const { error } = await supabase
        .from('proposals')
        .update({ status: status as any, client_notes } as any)
        .eq('id', proposalId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-proposals'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-detail'] });
      queryClient.invalidateQueries({ queryKey: ['client-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['consultant-cases'] });
      queryClient.invalidateQueries({ queryKey: ['critical-view'] });
    },
  });
}

const mockProposals = [
  { id: '1', ticket_id: 't1', consultant_id: 'c1', cover_letter: 'I have 10+ years of SAP FI experience...', proposed_rate: 150, estimated_hours: 20, timeline_days: 14, status: 'pending', created_at: '2026-04-01', ticket_title: 'GL Account Reconciliation Issue', sap_module: 'FI', urgency: 'high', version: 1, attachment_count: 0 },
  { id: '2', ticket_id: 't2', consultant_id: 'c1', cover_letter: 'Expert in S/4HANA migrations...', proposed_rate: 175, estimated_hours: 40, timeline_days: 30, status: 'accepted', created_at: '2026-03-25', ticket_title: 'S/4HANA Migration Support', sap_module: 'S/4HANA', urgency: 'critical', version: 2, attachment_count: 1 },
  { id: '3', ticket_id: 't3', consultant_id: 'c1', cover_letter: 'SD pricing procedure specialist...', proposed_rate: 130, estimated_hours: 10, timeline_days: 7, status: 'rejected', created_at: '2026-03-20', ticket_title: 'SD Pricing Configuration', sap_module: 'SD', urgency: 'medium', version: 1, attachment_count: 0 },
];
