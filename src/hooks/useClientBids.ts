import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { latestBids } from '@/lib/bidding';
import { counterArgs, counterProblem, deadlineFromOption, declinePayload, type CounterInput, type DeadlineOption } from '@/lib/clientBidding';
import { interviewDoneFrom, profileCompleteness } from '@/lib/profileCompleteness';
import { fetchInterviewWeight } from '@/lib/interviewWeight';

const db = supabase as any;
export function useBiddingClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  return now;
}
export function useTicketBids(ticketId: string | undefined, enabled = true) {
  const { isGuest } = useGuestMode();
  const qc = useQueryClient();
  const subscriptionId = useId();
  useEffect(() => {
    if (!ticketId || !enabled || isGuest) return;
    const channel = db.channel(`client-bids-${ticketId}-${subscriptionId}`);
    for (const table of ['proposals', 'proposal_counters', 'ticket_questions']) channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `ticket_id=eq.${ticketId}` }, () => {
      void qc.invalidateQueries({ queryKey: ['client-bids', ticketId] });
      void qc.invalidateQueries({ queryKey: ['client-bid-questions', ticketId] });
      void qc.invalidateQueries({ queryKey: ['client-bid-summary'] });
    });
    channel.subscribe();
    return () => { void db.removeChannel(channel); };
  }, [ticketId, enabled, isGuest, qc, subscriptionId]);
  return useQuery({
    queryKey: ['client-bids', ticketId], enabled: !!ticketId && enabled && !isGuest, refetchInterval: 30_000,
    queryFn: async () => {
      const { data: rows, error } = await db.from('proposals').select('id, ticket_id, consultant_id, version, status, proposed_rate, estimated_hours, timeline_days, cover_letter, client_notes, rejection_reason, shortlisted, withdrawn_at, created_at').eq('ticket_id', ticketId).order('created_at', { ascending: false });
      if (error) throw error;
      if (!rows?.length) return { bids: [], pending: [], counters: [] };
      const ids = [...new Set(rows.map((r: any) => r.consultant_id))];
      const [consultants, attachments, counters] = await Promise.all([
        db.from('consultants').select('id, user_id, rating, total_reviews, verification_status, credibility_credits, ai_interview_badge, industries, customer_segments, vertical_solutions, localization_countries, localization_solutions, project_types, deployment_experience, project_scale, work_modes, working_week, sap_roles, seniority_level, total_sap_years, sap_technologies, language_levels').in('id', ids),
        db.from('proposal_attachments').select('id, proposal_id, file_name, file_url').in('proposal_id', rows.map((r: any) => r.id)),
        db.from('proposal_counters').select('id, proposal_id, ticket_id, consultant_id, proposed_rate, estimated_hours, timeline_days, message, status, created_at, responded_at, new_proposal_id').eq('ticket_id', ticketId),
      ]);
      for (const result of [consultants, attachments, counters]) if (result.error) throw result.error;
      const people = consultants.data?.length ? await db.from('profile_directory').select('user_id, display_name, avatar_url').in('user_id', consultants.data.map((c: any) => c.user_id)) : { data: [] };
      if (people.error) throw people.error;
      const interviewWeight = await fetchInterviewWeight();
      const enriched = rows.map((p: any) => {
        const c = consultants.data?.find((c: any) => c.id === p.consultant_id);
        const person = people.data?.find((person: any) => person.user_id === c?.user_id);
        // Completion without the payout item: payout status is never shown to clients.
        const completion = c ? profileCompleteness({ ...c, skills_count: undefined, interview_done: interviewDoneFrom(c) }, { includePayout: false, interviewWeight }).percent : 0;
        return { ...p, consultant_name: person?.display_name || 'Unknown', consultant_avatar: person?.avatar_url, consultant_rating: c?.rating || 0, consultant_reviews: c?.total_reviews || 0, verification_status: c?.verification_status, credibility_credits: c?.credibility_credits, ai_interview_badge: c?.ai_interview_badge, completion_percent: completion, attachments: attachments.data?.filter((a: any) => a.proposal_id === p.id) || [] };
      });
      const bids = latestBids<any>(enriched).filter(r => r.bid.rejection_reason !== 'superseded');
      return { bids, pending: bids.filter(r => r.bid.status === 'pending'), counters: counters.data || [] };
    },
  });
}
export function useClientBidSummary(ticketIds: string[]) {
  const ids = [...new Set(ticketIds)].sort();
  return useQuery({ queryKey: ['client-bid-summary', ids], enabled: ids.length > 0, refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await db.from('proposals').select('id, ticket_id, consultant_id, version, status, rejection_reason, created_at').in('ticket_id', ids).eq('status', 'pending');
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const { bid } of latestBids<any>(data || [])) if (bid.rejection_reason !== 'superseded') counts.set(bid.ticket_id, (counts.get(bid.ticket_id) || 0) + 1);
      return counts;
    },
  });
}
function useBidMutation<T>(write: (value: T) => Promise<any>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: write, onSuccess: () => {
    for (const key of ['client-bids', 'client-bid-questions', 'client-bid-summary', 'ticket-proposals', 'ticket-detail', 'client-tickets', 'consultant-cases', 'critical-view']) void qc.invalidateQueries({ queryKey: [key] });
  } });
}
async function update(table: string, id: string, values: object) {
  const { error } = await db.from(table).update(values).eq('id', id); if (error) throw error;
}
async function rpc(name: string, args: object) {
  const { data, error } = await db.rpc(name, args); if (error) throw error; return data;
}
export function useSetDeadline() { return useBidMutation(({ ticketId, option, reopen = false }: { ticketId: string; option: DeadlineOption; reopen?: boolean }) => update('tickets', ticketId, { bid_deadline: deadlineFromOption(option), ...(reopen ? { open_for_bids: true } : {}) })); }
export function useCloseBidding() { return useBidMutation((id: string) => update('tickets', id, { open_for_bids: false })); }
export function useShortlist() { return useBidMutation(({ id, shortlisted }: { id: string; shortlisted: boolean }) => update('proposals', id, { shortlisted })); }
export function useDeclineBid() { return useBidMutation(({ id, reason, text }: { id: string; reason: string; text: string }) => { const { id: proposalId, ...values } = declinePayload(id, reason, text); return update('proposals', proposalId, values); }); }
export function useCounterOffer() { return useBidMutation((value: CounterInput) => { const problem = counterProblem(value); if (problem) throw new Error(problem); return rpc('counter_offer', counterArgs(value)); }); }
export function useCancelCounter() { return useBidMutation((id: string) => rpc('cancel_counter', { _counter_id: id })); }
export function useTicketQuestions(ticketId: string | undefined, enabled = true) {
  return useQuery({ queryKey: ['client-bid-questions', ticketId], enabled: !!ticketId && enabled, refetchInterval: 30_000,
    queryFn: async () => { const { data, error } = await db.from('ticket_questions').select('id, ticket_id, question, answer, answered_at, hidden, created_at').eq('ticket_id', ticketId).order('created_at', { ascending: true }); if (error) throw error; return (data || []) as ClientQuestion[]; },
  });
}
export interface ClientQuestion { id: string; ticket_id: string; question: string; answer: string | null; answered_at: string | null; hidden: boolean; created_at: string }
export function useAnswerQuestion() { return useBidMutation(({ id, answer }: { id: string; answer: string }) => rpc('answer_ticket_question', { _question_id: id, _answer: answer.trim() })); }
export function useHideQuestion() { return useBidMutation(({ id, hidden }: { id: string; hidden: boolean }) => rpc('hide_ticket_question', { _question_id: id, _hidden: hidden })); }