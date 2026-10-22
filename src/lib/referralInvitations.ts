import {
  CHANNEL_REASON_TEXT, emptyChannelReport, normaliseChannels, SEND_CHANNELS, type ChannelMap, type ChannelReport, type SendChannel,
} from '@/lib/sendChannels';

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
  /** "Send via" choice; e-mail is sent along so the server records why it was skipped. */
  channels?: readonly SendChannel[]; confirmed?: boolean; key: string; filters?: Record<string, string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function invitePayload(i: InvitePayloadInput): Record<string, unknown> {
  return {
    mode: i.mode,
    ...(i.mode === 'selected' ? { user_ids: [...new Set((i.ids ?? []).filter((x) => UUID.test(x)))].slice(0, 1000) } : {}),
    include_tests: !!i.includeTests,
    resend: !!i.resend,
    ...(i.resend ? { reason: (i.reason ?? '').trim().slice(0, RESEND_REASON_MAX) } : {}),
    channels: normaliseChannels(i.channels ?? ['in_app']),
    confirmed: !!i.confirmed,
    idempotency_key: i.key,
    filters: i.filters ?? {},
  };
}

export interface InviteReportRow {
  user_id: string; name: string; lang: string; outcome: 'sent' | 'failed' | 'skipped' | 'sending'; reason: string | null;
  telegram: string | null; sent_at: string | null; resend: boolean;
  /** Per channel (after docs/sql/notice-channels.sql): status sent / failed / sending / skipped and the reason. */
  channels?: Partial<Record<SendChannel, { status: string; reason?: string | null }>>;
}

/** Spreadsheet-safe cell: quoted, and a leading = + - @ is neutralised so a name can never run as a formula. */
export function csvCell(v: unknown): string {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Admin CSV of one send: no e-mail addresses, passwords or tokens - name, language, outcome, reason, time. */
export function inviteReportCsv(rows: InviteReportRow[], reasonText: (r: string) => string = defaultReasonText): string {
  const head = ['user_id', 'name', 'language', 'outcome', 'reason', ...SEND_CHANNELS.map((c) => `channel_${c}`), 'sent_at', 'resend'];
  const lines = rows.map((r) => {
    const ch = rowChannels(r);
    const cells = SEND_CHANNELS.map((c) => (ch[c] ? `${ch[c]!.status}${ch[c]!.reason ? ` (${reasonText(ch[c]!.reason!)})` : ''}` : ''));
    return [r.user_id, r.name, r.lang, r.outcome, r.reason ? reasonText(r.reason) : '', ...cells, r.sent_at ?? '', r.resend ? 'yes' : 'no'].map(csvCell).join(',');
  });
  return [head.join(','), ...lines].join('\n');
}

const defaultReasonText = (r: string) => INVITE_REASON_TEXT[r as InviteSkipReason] ?? CHANNEL_REASON_TEXT[r as keyof typeof CHANNEL_REASON_TEXT] ?? r;

/** Per-channel status of one report row; rows written before the channel update fall back to in-app + Telegram. */
export function rowChannels(r: InviteReportRow): Partial<Record<SendChannel, { status: string; reason?: string | null }>> {
  if (r.channels && Object.keys(r.channels).length) return r.channels;
  const out: Partial<Record<SendChannel, { status: string; reason?: string | null }>> = {};
  if (r.outcome !== 'skipped') out.in_app = { status: r.outcome, reason: r.outcome === 'failed' ? r.reason : null };
  if (r.telegram) out.telegram = { status: r.telegram === 'skipped' ? 'skipped' : r.telegram, reason: r.telegram === 'skipped' ? 'telegram_not_connected' : null };
  return out;
}

// ---------------------------------------------------------------- channels: preview and report (old and new database)
export interface InvitePreviewChannels {
  eligible: number; telegram_linked?: number; push_enabled?: number;
  by_channel?: Partial<Record<SendChannel, { available: boolean; reason?: string | null; eligible?: number; skipped?: Record<string, number> }>>;
}

/** Channel availability and reach for the selector. Before the channel update only in-app and Telegram exist. */
export function inviteChannelInfo(p: InvitePreviewChannels | null | undefined): ChannelMap {
  if (!p) return {};
  if (p.by_channel) {
    const out: ChannelMap = {};
    for (const c of SEND_CHANNELS) {
      const b = p.by_channel[c];
      out[c] = b ? { available: !!b.available, reason: b.reason ?? null, eligible: Number(b.eligible ?? 0), skipped: b.skipped ?? {} }
        : { available: false, reason: 'needs_update' };
    }
    return out;
  }
  return {
    in_app: { available: true, eligible: p.eligible },
    email: { available: false, reason: 'email_not_allowed' },
    push: { available: false, reason: 'needs_update' },
    telegram: { available: (p.telegram_linked ?? 0) > 0, reason: (p.telegram_linked ?? 0) > 0 ? null : 'telegram_not_connected', eligible: p.telegram_linked ?? 0 },
  };
}

/** People who get at least one of the chosen channels (the number on the Send button). */
export function inviteReach(p: InvitePreviewChannels | null | undefined, selection: readonly SendChannel[], perPerson?: Record<string, number>): number {
  if (!p) return 0;
  if (perPerson) {
    const key = normaliseChannels(selection).join(',');
    if (typeof perPerson[key] === 'number') return perPerson[key];
  }
  if (!p.by_channel) return selection.includes('in_app') ? p.eligible : Math.min(p.eligible, p.telegram_linked ?? 0);
  return Math.max(0, ...selection.map((c) => Number(p.by_channel?.[c]?.available ? p.by_channel?.[c]?.eligible ?? 0 : 0)));
}

export interface InviteRunChannels {
  mode?: string; sent?: number; failed?: number; sending?: number; telegram_sent?: number; channels?: string[];
  by_channel?: Partial<Record<SendChannel, Partial<ChannelReport>>>;
}

/** Sent / skipped (reason) / failed per channel for the result report. */
export function inviteChannelReport(r: InviteRunChannels | null | undefined): Partial<Record<SendChannel, ChannelReport>> {
  if (!r) return {};
  const out: Partial<Record<SendChannel, ChannelReport>> = {};
  if (r.by_channel) {
    for (const c of SEND_CHANNELS) {
      const b = r.by_channel[c];
      if (b) out[c] = { ...emptyChannelReport(), ...b, skipped: b.skipped ?? {} };
    }
    return out;
  }
  out.in_app = { ...emptyChannelReport(), sent: Number(r.sent ?? 0), failed: Number(r.failed ?? 0), sending: Number(r.sending ?? 0) };
  if ((r.channels ?? []).includes('telegram')) out.telegram = { ...emptyChannelReport(), sent: Number(r.telegram_sent ?? 0) };
  return out;
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
