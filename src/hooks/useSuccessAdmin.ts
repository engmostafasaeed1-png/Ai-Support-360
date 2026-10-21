import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { parseSuccessSettings, type SuccessSettings } from '@/lib/successLevel';

type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = (fn: string, args?: Record<string, unknown>): Promise<RpcResult> =>
  (supabase as unknown as { rpc: (f: string, a?: Record<string, unknown>) => Promise<RpcResult> }).rpc(fn, args);
async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type EngagementOutcome = 'solved' | 'not_solved' | 'open' | 'awaiting_confirmation'
  | 'excluded_never_started' | 'excluded_voided' | 'excluded_merged' | 'excluded_test';

export interface SuccessEngagement {
  ticket_id: string; title: string | null; outcome: EngagementOutcome; reason: string | null; ended_at: string | null;
  confirmed?: boolean; disputable?: boolean; override?: { kind: string; reason: string; at: string } | null;
}
export interface SuccessStatsRow {
  requests_total: number; solved: number; not_solved: number; requests_12m: number; solved_12m: number; not_solved_12m: number;
  open_count: number; awaiting_confirmation: number; excluded?: Record<string, number>; level: string; computed_at: string;
}
export interface SuccessDispute {
  id: string; consultant_id: string; ticket_id: string; reason: string; status: 'pending' | 'voided' | 'solved' | 'rejected';
  created_at: string; reviewed_at: string | null; admin_note: string | null; name?: string | null; ticket_title?: string | null;
}
export interface SuccessBreakdownData {
  settings: SuccessSettings; public: boolean; stats: SuccessStatsRow | null; engagements: SuccessEngagement[]; disputes: SuccessDispute[];
}

/** Admin only (audited RPCs in docs/sql/success-stats.sql); errors until that file is applied. */
export function useAdminSuccessBreakdown(consultantId: string) {
  return useQuery({
    queryKey: ['admin-success', consultantId],
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const d = await call<Record<string, unknown>>('admin_success_breakdown', { _cid: consultantId });
      return { ...d, settings: parseSuccessSettings(d.settings) } as unknown as SuccessBreakdownData;
    },
  });
}

export function useAdminSuccessDisputes() {
  return useQuery({ queryKey: ['admin-success-disputes'], retry: false, queryFn: () => call<SuccessDispute[]>('admin_success_disputes') });
}

export function useMySuccess(enabled = true) {
  return useQuery({
    queryKey: ['my-success'], enabled, retry: false,
    queryFn: async () => {
      const d = await call<Record<string, unknown>>('my_success');
      return { ...d, settings: parseSuccessSettings(d.settings) } as unknown as Omit<SuccessBreakdownData, 'public'>;
    },
  });
}

export const setSuccessOverride = (cid: string, ticketId: string, action: 'void' | 'clear', reason: string) =>
  call<void>('admin_set_success_override', { _cid: cid, _ticket_id: ticketId, _action: action, _reason: reason });
export const reviewSuccessDispute = (id: string, decision: 'void' | 'solved' | 'reject', note: string) =>
  call<void>('admin_review_success_dispute', { _dispute_id: id, _decision: decision, _note: note });
export const recomputeSuccess = () => call<number>('admin_recompute_success');
export const disputeSuccess = (ticketId: string, reason: string) => call<string>('consultant_dispute_success', { _ticket_id: ticketId, _reason: reason });
export const setTicketOutcome = (ticketId: string, outcome: 'unresolved' | 'cancelled' | null, reason?: string) =>
  call<void>('client_set_ticket_outcome', { _ticket_id: ticketId, _outcome: outcome, _reason: reason ?? null });

export const OUTCOME_LABEL: Record<EngagementOutcome, [string, string]> = {
  solved: ['Solved', 'تم الحل'],
  not_solved: ['Not solved', 'لم يُحل'],
  open: ['In progress (not counted yet)', 'قيد التنفيذ (لا يُحتسب بعد)'],
  awaiting_confirmation: ['Waiting for client confirmation (not counted yet)', 'بانتظار تأكيد العميل (لا يُحتسب بعد)'],
  excluded_never_started: ['Not counted: never started', 'لا يُحتسب: لم يبدأ العمل'],
  excluded_voided: ['Not counted: voided by an administrator', 'لا يُحتسب: ألغاه مسؤول'],
  excluded_merged: ['Not counted: merged duplicate', 'لا يُحتسب: طلب مكرر تم دمجه'],
  excluded_test: ['Not counted: test data', 'لا يُحتسب: بيانات تجريبية'],
};

export const REASON_LABEL: Record<string, [string, string]> = {
  member_removed: ['Removed after work started', 'أُزيل بعد بدء العمل'],
  member_replaced: ['Replaced after work started', 'استُبدل بعد بدء العمل'],
  member_withdrawn: ['Withdrew after work started', 'انسحب بعد بدء العمل'],
  member_expired: ['Expired after work started', 'انتهت المدة بعد بدء العمل'],
  client_unresolved: ['Client marked it as not solved', 'أشار العميل إلى أنه لم يُحل'],
  client_cancelled: ['Cancelled after work started', 'أُلغي بعد بدء العمل'],
  admin_reviewed: ['Counted as solved after review', 'احتُسب محلولًا بعد المراجعة'],
};
