import { useSessionReady } from '@/hooks/useSessionReady';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

async function myConsultant(): Promise<{ id: string; currency: string | null } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await db.from('consultants').select('id, currency').eq('user_id', user.id).maybeSingle();
  return data ?? null;
}

/** The signed-in consultant (id, currency) and his SAP skills. */
export function useMyConsultant() {
  const signedIn = useSessionReady().signedIn;
  return useQuery({
    enabled: signedIn,
    queryKey: ['my-consultant-bidding'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const c = await myConsultant();
      if (!c) return null;
      const { data: skills } = await db.from('consultant_skills').select('sap_module').eq('consultant_id', c.id);
      return { ...c, skills: ((skills || []) as any[]).map(s => s.sap_module).filter(Boolean) as string[] };
    },
  });
}

/** One RPC call for a list (at most 100 ids). */
export function useTicketBidCounts(ticketIds: string[]) {
  const ids = [...new Set(ticketIds.filter(Boolean))].sort().slice(0, 100);
  const signedIn2 = useSessionReady().signedIn;
  return useQuery({
    queryKey: ['ticket-bid-counts', ids],
    enabled: signedIn2 && (ids.length > 0),
    queryFn: async () => {
      const { data, error } = await db.rpc('ticket_bid_counts', { _ticket_ids: ids });
      if (error) throw error;
      const map = new Map<string, number>();
      for (const r of (data || []) as any[]) map.set(r.ticket_id, Number(r.bids));
      return map;
    },
  });
}

export interface MyBidRow {
  id: string;
  ticket_id: string;
  consultant_id: string;
  version: number | null;
  status: string;
  created_at: string;
  updated_at: string | null;
  proposed_rate: number;
  estimated_hours: number;
  timeline_days: number;
  cover_letter: string | null;
  client_notes: string | null;
  rejection_reason: string | null;
  shortlisted: boolean;
  withdrawn_at: string | null;
  ticket: { id: string; title: string; sap_module: string | null; open_for_bids: boolean | null; bid_deadline: string | null; bidding_closed_at: string | null; status: string | null } | null;
}

/** Every bid row of the signed-in consultant with the request it belongs to. */
export function useMyBids() {
  const signedIn3 = useSessionReady().signedIn;
  return useQuery({
    enabled: signedIn3,
    queryKey: ['my-bids'],
    queryFn: async (): Promise<MyBidRow[]> => {
      const c = await myConsultant();
      if (!c) return [];
      const { data, error } = await db.from('proposals')
        .select('id, ticket_id, consultant_id, version, status, created_at, updated_at, proposed_rate, estimated_hours, timeline_days, cover_letter, client_notes, rejection_reason, shortlisted, withdrawn_at')
        .eq('consultant_id', c.id).order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []) as any[];
      const ids = [...new Set(rows.map(r => r.ticket_id))];
      const tickets = ids.length
        ? ((await db.from('tickets').select('id, title, sap_module, open_for_bids, bid_deadline, bidding_closed_at, status').in('id', ids)).data || []) as any[]
        : [];
      const tm = new Map(tickets.map(t => [t.id, t]));
      return rows.map(r => ({ ...r, ticket: tm.get(r.ticket_id) ?? null }));
    },
  });
}

function invalidateBidding(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ['my-bids', 'consultant-proposals', 'proposal-versions', 'open-tickets-for-bidding', 'ticket-bid-counts', 'my-counters']) {
    void qc.invalidateQueries({ queryKey: [key] });
  }
}

export function useWithdrawBid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from('proposals').update({ status: 'withdrawn' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateBidding(qc),
  });
}

export interface CounterRow {
  id: string;
  proposal_id: string;
  ticket_id: string;
  proposed_rate: number;
  estimated_hours: number;
  timeline_days: number | null;
  message: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  created_at: string;
  responded_at: string | null;
  new_proposal_id: string | null;
}

/** The consultant's own counter-offers, read once for all his bids. */
export function useMyCounters() {
  const signedIn4 = useSessionReady().signedIn;
  return useQuery({
    enabled: signedIn4,
    queryKey: ['my-counters'],
    queryFn: async (): Promise<CounterRow[]> => {
      const c = await myConsultant();
      if (!c) return [];
      const { data, error } = await db.from('proposal_counters')
        .select('id, proposal_id, ticket_id, proposed_rate, estimated_hours, timeline_days, message, status, created_at, responded_at, new_proposal_id')
        .eq('consultant_id', c.id);
      if (error) throw error;
      return (data || []) as CounterRow[];
    },
  });
}

export function useRespondToCounter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ counterId, accept }: { counterId: string; accept: boolean }) => {
      const { data, error } = await db.rpc('respond_to_counter', { _counter_id: counterId, _accept: accept });
      if (error) throw error;
      return data as string | null;
    },
    onSuccess: () => invalidateBidding(qc),
  });
}

export interface QuestionRow {
  id: string;
  ticket_id: string;
  question: string;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
}

/** Answered questions of a request (no names) and the consultant's own unanswered ones. */
export function useTicketQuestions(ticketId: string | undefined) {
  const signedIn5 = useSessionReady().signedIn;
  return useQuery({
    queryKey: ['ticket-questions', ticketId],
    enabled: signedIn5 && (!!ticketId),
    queryFn: async () => {
      const c = await myConsultant();
      const [{ data: answered, error }, own] = await Promise.all([
        db.from('ticket_questions_public').select('id, ticket_id, question, answer, created_at, answered_at').eq('ticket_id', ticketId).order('created_at', { ascending: true }),
        c ? db.from('ticket_questions').select('id, ticket_id, question, answer, answered_at, created_at').eq('ticket_id', ticketId).eq('consultant_id', c.id).order('created_at', { ascending: true }) : Promise.resolve({ data: [] }),
      ]);
      if (error) throw error;
      return {
        answered: (answered || []) as QuestionRow[],
        waiting: ((own?.data || []) as QuestionRow[]).filter(q => !q.answer),
      };
    },
  });
}

export function useAskQuestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ticketId, question }: { ticketId: string; question: string }) => {
      const { data, error } = await db.rpc('ask_ticket_question', { _ticket_id: ticketId, _question: question.trim() });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_d, v) => { void qc.invalidateQueries({ queryKey: ['ticket-questions', v.ticketId] }); },
  });
}
