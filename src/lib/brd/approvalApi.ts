// BRD approval reads and writes go only through the database functions in docs/sql/ticket-brd-approval.sql.
import { supabase } from '@/integrations/supabase/client';
import { safeRpc, isMissingRpc, type RpcError } from '@/lib/safeRpc';
import type { ApprovalListRow, ApprovalView, Decision } from '@/lib/brdApproval';

export type ApprovalResult<T> = { data: T | null; error: RpcError | null; notReady?: boolean };

const call = async <T,>(fn: string, args: Record<string, unknown>): Promise<ApprovalResult<T>> => {
  const r = await safeRpc<T>(fn, args);
  return { ...r, notReady: isMissingRpc(r.error) };
};

export const getBrdApproval = (ticketId: string) => call<ApprovalView>('brd_approval_get', { _ticket: ticketId });
export const listBrdApprovals = (ticketIds: string[]) => call<ApprovalListRow[]>('brd_approval_list', { _tickets: ticketIds.slice(0, 300) });
export const submitBrdForApproval = (ticketId: string, version: number, noChange = false, note: string | null = null) =>
  call<{ request_id: string; version: number; unchanged: boolean; notified: number; waiting_access: number; carried?: boolean }>(
    'brd_submit_for_approval', { _ticket: ticketId, _version: version, _no_change: noChange, _note: note });
export const withdrawBrdApproval = (ticketId: string, reason: string | null) => call<boolean>('brd_withdraw_approval', { _ticket: ticketId, _reason: reason });
export const decideBrdApproval = (ticketId: string, version: number, decision: Decision, note: string, confirmRead: boolean) =>
  call<{ unchanged: boolean; state: string; version: number; approved?: number; required?: number }>(
    'brd_decide_approval', { _ticket: ticketId, _version: version, _decision: decision, _note: note, _confirm_read: confirmRead });
export const adminWaiveBrdApproval = (ticketId: string, waive: boolean, reason: string) =>
  call<boolean>('admin_brd_waive_approval', { _ticket: ticketId, _waive: waive, _reason: reason });
export const adminBrdApprovalOverview = () => call<Record<string, number>>('admin_brd_approval_overview', {});

/** Admin only: one sample of an approval e-mail to the signed-in admin's own address (server checks the role). */
export async function sendBrdApprovalTestEmail(kind: string, lang: 'en' | 'ar'): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('brd-approval-run', { body: { action: 'test', kind, lang } });
    if (error) return { ok: false, error: error.message };
    return { ok: !!(data as { ok?: boolean })?.ok, error: (data as { error?: string })?.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'failed' };
  }
}
