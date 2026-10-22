/**
 * Refer & earn invitation (Admin > Users). The database (docs/sql/referral-invitations.sql) decides who receives it;
 * this file mirrors the rules for the confirmation dialog, the report and the tests only - it never decides on its own.
 */
export const INVITE_SKIP_REASONS = [
  'not_found', 'deleted', 'suspended', 'not_consultant', 'not_verified', 'email_unconfirmed', 'policy_blocked', 'test_account',
  'paused', 'unsubscribed', 'already_invited', 'resend_too_soon',
] as const;
export type InviteSkipReason = typeof INVITE_SKIP_REASONS[number];

export const INVITE_REASON_TEXT: Record<InviteSkipReason, string> = {
  not_found: 'account not found',
  deleted: 'deleted or merged account',
  suspended: 'suspended account',
  not_consultant: 'not a consultant',
  not_verified: 'consultant not verified',
  email_unconfirmed: 'e-mail not confirmed',
  policy_blocked: 'blocked by the service policy',
  test_account: 'tagged "test"',
  paused: 'notifications paused',
  unsubscribed: 'unsubscribed from messages',
  already_invited: 'already invited (this version)',
  resend_too_soon: 'invited in the last 14 days',
};

export const INVITE_DEFAULTS = { maxRecipients: 500, resendDays: 14, version: 1 } as const;
export const RESEND_REASON_MIN = 10;
export const RESEND_REASON_MAX = 300;

export interface InviteCandidate {
  exists: boolean; deleted?: boolean; suspended?: boolean; consultant: boolean; verified: boolean; emailConfirmed: boolean;
  policyBlocked?: boolean; tags?: string[]; paused?: boolean; unsubscribed?: boolean;
  invitedThisVersion?: boolean; lastInvitedAt?: string | null;
}
export interface InviteOptions { includeTests?: boolean; resend?: boolean; resendDays?: number; now?: Date }

/** Mirror of ri_candidates: the first reason that applies, or null (will receive). Same order as the database. */
export function inviteSkipReason(c: InviteCandidate, o: InviteOptions = {}): InviteSkipReason | null {
  if (!c.exists) return 'not_found';
  if (c.deleted) return 'deleted';
  if (c.suspended) return 'suspended';
  if (!c.consultant) return 'not_consultant';
  if (!c.verified) return 'not_verified';
  if (!c.emailConfirmed) return 'email_unconfirmed';
  if (c.policyBlocked) return 'policy_blocked';
  if (!o.includeTests && (c.tags ?? []).some((t) => t.trim().toLowerCase() === 'test')) return 'test_account';
  if (c.paused) return 'paused';
  if (c.unsubscribed) return 'unsubscribed';
  if (!o.resend && c.invitedThisVersion) return 'already_invited';
  if (o.resend && c.lastInvitedAt) {
    const days = o.resendDays ?? INVITE_DEFAULTS.resendDays;
    const since = ((o.now ?? new Date()).getTime() - new Date(c.lastInvitedAt).getTime()) / 86_400_000;
    if (since < days) return 'resend_too_soon';
  }
  return null;
}

export function resendReasonOk(reason: string): boolean {
  const n = reason.trim().length;
  return n >= RESEND_REASON_MIN && n <= RESEND_REASON_MAX;
}

export interface InviteFormState {
  installed: boolean; enabled: boolean; eligible: number; maxRecipients: number; confirmed: boolean; resend: boolean; reason: string; busy: boolean;
}

/** Why the real Send button is locked (null = may send). Never sends on the first click: "I confirm" is always required. */
export function inviteBlocker(s: InviteFormState): 'not_installed' | 'switched_off' | 'nobody' | 'too_many' | 'reason' | 'confirm' | 'busy' | null {
  if (!s.installed) return 'not_installed';
  if (!s.enabled) return 'switched_off';
  if (s.eligible <= 0) return 'nobody';
  if (s.eligible > s.maxRecipients) return 'too_many';
  if (s.resend && !resendReasonOk(s.reason)) return 'reason';
  if (!s.confirmed) return 'confirm';
  if (s.busy) return 'busy';
  return null;
}

export interface InvitePayloadInput {
  mode: 'selected' | 'all_eligible' | 'test'; ids?: string[]; includeTests?: boolean; resend?: boolean; reason?: string;
  telegram?: boolean; confirmed?: boolean; key: string; filters?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function invitePayload(i: InvitePayloadInput): Record<string, unknown> {
  return {
    mode: i.mode,
    ...(i.mode === 'selected' ? { user_ids: [...new Set((i.ids ?? []).filter((x) => UUID.test(x)))].slice(0, 1000) } : {}),
    include_tests: !!i.includeTests,
    resend: !!i.resend,
    ...(i.resend ? { reason: (i.reason ?? '').trim().slice(0, RESEND_REASON_MAX) } : {}),
    channels: i.telegram ? ['in_app', 'telegram'] : ['in_app'],
    confirmed: !!i.confirmed,
    idempotency_key: i.key,
    filters: i.filters ?? {},
  };
}

export interface InviteReportRow {
  user_id: string; name: string; lang: string; outcome: 'sent' | 'failed' | 'skipped' | 'sending'; reason: string | null;
  telegram: string | null; sent_at: string | null; resend: boolean;
}

/** Spreadsheet-safe cell: quoted, and a leading = + - @ is neutralised so a name can never run as a formula. */
export function csvCell(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Admin CSV of one send: no e-mail addresses, passwords or tokens - name, language, outcome, reason, time. */
export function inviteReportCsv(rows: InviteReportRow[], reasonText: (r: string) => string = (r) => INVITE_REASON_TEXT[r as InviteSkipReason] ?? r): string {
  const head = ['user_id', 'name', 'language', 'outcome', 'reason', 'telegram', 'sent_at', 'resend'];
  const lines = rows.map((r) => [r.user_id, r.name, r.lang, r.outcome, r.reason ? reasonText(r.reason) : '', r.telegram ?? '', r.sent_at ?? '', r.resend ? 'yes' : 'no'].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n');
}

export interface InviteStatus { user_id: string; version: number; invited_at: string; resends: number }

export function inviteStatusMap(rows: InviteStatus[] | null | undefined): Map<string, InviteStatus> {
  return new Map((rows ?? []).map((r) => [r.user_id, r]));
}

/** Progress of a running send: 0-100, done when nothing is waiting any more. */
export function inviteProgress(r: { queued?: number; sent?: number; failed?: number; sending?: number } | null | undefined) {
  const queued = Number(r?.queued ?? 0), sent = Number(r?.sent ?? 0), failed = Number(r?.failed ?? 0), sending = Number(r?.sending ?? 0);
  const total = Math.max(queued, sent + failed + sending);
  return { total, done: sending === 0 && total > 0 ? true : total === 0, percent: total ? Math.round(((sent + failed) / total) * 100) : 100, sent, failed, sending };
}

/** The Users console URL filters as a short audit description (string values only). */
export function filterSummary(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    if (['page', 'page_size', 'sort', 'dir', 'tab', 'user'].includes(k) || !/^[a-z_]{1,30}$/.test(k) || !v) continue;
    out[k] = v.slice(0, 120);
  }
  return out;
}
