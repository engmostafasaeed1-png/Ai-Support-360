import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isMissingRpc, safeRpc } from '@/lib/safeRpc';
import type { InviteReportRow, InviteStatus } from '@/lib/referralInvitations';

/** Refer & earn invitation RPCs (docs/sql/referral-invitations.sql). Until that file is applied every call reports not installed. */
export class InviteNotInstalled extends Error { constructor() { super('not_installed'); } }

export async function inviteRpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await safeRpc<T>(fn, args);
  if (error) {
    if (isMissingRpc(error)) throw new InviteNotInstalled();
    throw new Error(error.message || 'Request failed');
  }
  return data as T;
}

export interface InvitePreview {
  enabled: boolean; bulk_enabled: boolean; version: number; max_recipients: number; resend_days: number;
  candidates: number; eligible: number; skipped: Record<string, number>; sample: string[]; arabic: number; english: number;
  telegram_linked: number; resends: number; announced_before: number; sent_today: number; daily_cap: number;
  message: { subject_en: string; subject_ar: string; body_en: string; body_ar: string; link_url: string };
}

export interface InviteRun {
  id: string; mode: string; version: number; created_at: string; resend: boolean; channels: string[]; admin_name: string | null;
  requested: number; queued: number; skipped: number; skipped_by_reason: Record<string, number>; sent: number; failed: number;
  sending: number; telegram_sent: number; campaign_status: string | null; repeated?: boolean; rows?: InviteReportRow[];
}

export interface InviteSettings {
  enabled: boolean; version: number; max_recipients: number; resend_days: number; example_fee: number; example_currency: string;
  terms_draft: boolean; can_edit: boolean;
}

export function useInvitePreview(payload: Record<string, unknown> | null) {
  return useQuery({
    queryKey: ['rinv', 'preview', payload],
    enabled: !!payload,
    retry: false,
    queryFn: () => inviteRpc<InvitePreview>('admin_referral_invite_preview', { _payload: payload }),
  });
}

export function useInviteReport(runId: string | null, live: boolean) {
  return useQuery({
    queryKey: ['rinv', 'report', runId],
    enabled: !!runId,
    retry: false,
    refetchInterval: live ? 3000 : false,
    queryFn: () => inviteRpc<InviteRun>('admin_referral_invite_report', { _run_id: runId }),
  });
}

export function useInviteRuns(enabled = true) {
  return useQuery({
    queryKey: ['rinv', 'runs'],
    enabled,
    retry: false,
    queryFn: () => inviteRpc<InviteRun[]>('admin_referral_invite_runs', { _limit: 20 }),
  });
}

/** "Invited on <date> (v1)" for the rows on screen; empty (no badges) when the update is not applied or the call fails. */
export function useInviteStatus(ids: string[]) {
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: ['rinv', 'status', key],
    enabled: ids.length > 0,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await safeRpc<InviteStatus[]>('admin_referral_invite_status', { _user_ids: ids.slice(0, 200) });
      return error ? [] : (data ?? []);
    },
  });
}

export function useInviteSettings() {
  return useQuery({
    queryKey: ['rinv', 'settings'],
    retry: false,
    queryFn: () => inviteRpc<InviteSettings>('admin_referral_invite_settings'),
  });
}

export function useInvalidateInvites() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['rinv'] });
}
