/**
 * Direct admin e-mail (Admin › Users › "Send e-mail") — screen-side mirror of docs/sql/admin-direct-email.sql
 * (ade_fill, ade_targets, the outside-link rule and the result statuses). The database decides; this file labels the
 * confirmation and result screens, builds the request and is covered by src/test/adminDirectEmail.test.ts.
 */
import type { MessageCategory } from '../../supabase/functions/_shared/adminMessageEmail';
import { csvCell } from './adminMessageEmail';

export const SITE_URL = 'https://www.aisupport360.com';
export const DIRECT_CHANNELS = ['both', 'email', 'in_app'] as const;
export type DirectChannel = (typeof DIRECT_CHANNELS)[number];
/** "In-app + e-mail" is the default. */
export const DEFAULT_DIRECT_CHANNEL: DirectChannel = 'both';
export const DEFAULT_PER_SEND_CAP = 200;
export const MAX_IDS = 1000;

export const channelHasEmail = (c: DirectChannel) => c !== 'in_app';
export const channelHasInApp = (c: DirectChannel) => c !== 'email';

/** Reasons a person is left out, in the order the database checks them (ade_targets). */
export const EXCLUDE_REASONS = [
  'not_found', 'self', 'deleted_or_merged', 'test_account',
  'no_email', 'email_not_confirmed', 'recipient_unsubscribed', 'recipient_suppressed', 'paused',
] as const;
export type ExcludeReason = (typeof EXCLUDE_REASONS)[number];
/** These leave a person out completely; the e-mail reasons only drop the e-mail when the channel is "In-app + e-mail". */
export const EXCLUDES_ALL: readonly ExcludeReason[] = ['not_found', 'self', 'deleted_or_merged', 'test_account'];

export const REASON_TEXT: Record<string, string> = {
  not_found: 'No account', self: 'Your own account (use "Send test to me")', deleted_or_merged: 'Deleted or merged account',
  test_account: 'Tagged "test"', no_email: 'No e-mail address', email_not_confirmed: 'E-mail not confirmed',
  recipient_unsubscribed: 'Unsubscribed', recipient_suppressed: 'Address blocked (bounced or complaint)',
  paused: 'Paused quiet notifications (tick "Important" to reach them)', daily_cap_reached: 'Daily e-mail limit reached',
  switched_off: 'Admin e-mails are switched off', too_many_attempts: 'Could not be delivered after 5 tries',
  email_notifications_off: 'E-mail notifications are off for this person', send_failed: 'Sending failed',
};

/** Quiet-pause group of a direct message (ade_pause_category): Reminder -> reminders, everything else -> activity. */
export const pauseCategoryFor = (c: MessageCategory) => (c === 'reminder' ? 'reminders' : 'activity');

/** Mirror of ade_fill: {first_name} (or the placeholder and the space before it), {link} -> full address, {ticket} removed. */
export function personalise(text: string, firstName: string | null | undefined, link?: string | null): string {
  const first = String(firstName ?? '').trim();
  return String(text ?? '')
    .replace(/( ?)\{\{?\s*first_name\s*\}?\}/g, (_m, sp: string) => (first ? sp + first : ''))
    .replace(/\{\{?\s*link\s*\}?\}/g, link ? SITE_URL + link : '')
    .replace(/( ?)\{\{?\s*ticket\s*\}?\}/g, '')
    .trim();
}

/** Mirror of the database rule: any web address in the text must be our own site (look-alike domains count as outside). */
export function hasOutsideLink(text: string): boolean {
  const cleaned = String(text ?? '').replace(/(https?:\/\/)?(www\.)?aisupport360\.com(?![A-Za-z0-9-]|\.[A-Za-z0-9])/gi, '');
  return /(https?:\/\/|www\.)/i.test(cleaned);
}

/** Arabic text is optional, but subject and message go together. */
export const arabicIncomplete = (subjectAr: string, bodyAr: string) => !!subjectAr.trim() !== !!bodyAr.trim();

export interface DirectContent {
  category: MessageCategory; subject: string; summary: string; body: string; link: string; action_label: string; deadline: string | null;
  subject_ar: string; summary_ar: string; body_ar: string; action_label_ar: string;
  context: { kind: 'none' | 'other'; label?: string; ref?: string; status?: string } | null;
}
export interface DirectOptions { channel: DirectChannel; important: boolean; includeTests: boolean }

/** Body of admin_direct_email_send / _preview. Text is sent with {first_name}: the database fills it per person. */
export function directPayload(content: DirectContent, opts: DirectOptions, ids: string[], extra: { requestKey?: string; confirmed?: boolean; test?: boolean } = {}) {
  return {
    ...content, ids, channel: opts.channel, important: opts.important, tests: opts.includeTests,
    request_key: extra.requestKey ?? '', confirmed: !!extra.confirmed, test: !!extra.test,
  };
}

export interface DirectPreview {
  enabled: boolean; email_enabled: boolean; channel: DirectChannel; cap: number; requested: number; recipients: number;
  email_reach: number; in_app_reach: number; arabic: number; english: number; by_reason: Record<string, number>;
  excluded: Array<{ id: string; name: string | null; email: string | null; reason: ExcludeReason; scope: 'all' | 'email' }>;
  sample: Array<{ id: string; name: string | null; email: string | null; lang: 'en' | 'ar' }>;
  later: number; daily_cap: number; per_admin_hour: number; per_recipient_hour: number; sent_today: number; admin_sent_hour: number; waiting: number;
}

export type DirectBlocker = 'not_installed' | 'switched_off' | 'email_off' | 'nobody' | 'over_cap' | 'confirm' | null;
/** Why "Send" is dimmed on the confirmation step (the database checks the same again). */
export function directBlocker(p: DirectPreview | null | undefined, v: { installed: boolean; confirmed: boolean }): DirectBlocker {
  if (!v.installed) return 'not_installed';
  if (!p) return null;
  if (!p.enabled) return 'switched_off';
  if (channelHasEmail(p.channel) && !p.email_enabled) return 'email_off';
  if (p.recipients <= 0) return 'nobody';
  if (p.recipients > p.cap) return 'over_cap';
  if (!v.confirmed) return 'confirm';
  return null;
}

export interface DirectReportRow {
  user_id: string; name: string | null; email: string | null; lang: 'en' | 'ar'; in_app: boolean; read: boolean;
  email_status: 'queued' | 'sending' | 'sent' | 'skipped' | 'failed' | null; reason: string | null; send_after: string | null; finished_at: string | null;
}
export interface DirectSendInfo {
  id: string; created_at: string; channel: DirectChannel; category: MessageCategory; subject: string; important: boolean;
  requested: number; recipients: number; excluded: number; actor_name: string | null;
}
export interface DirectReport { send: DirectSendInfo; rows: DirectReportRow[]; repeated?: boolean }

export type RowStatus = 'sent' | 'queued' | 'later' | 'skipped' | 'failed' | 'in_app';
/** One status per person for the result table: the e-mail decides; in-app only sends show "In-app". */
export function rowStatus(r: DirectReportRow, channel: DirectChannel, now = Date.now()): RowStatus {
  if (!channelHasEmail(channel)) return r.in_app ? 'in_app' : 'skipped';
  switch (r.email_status) {
    case 'sent': return 'sent';
    case 'failed': return 'failed';
    case 'queued': case 'sending': return r.send_after && new Date(r.send_after).getTime() > now + 60_000 ? 'later' : 'queued';
    default: return 'skipped';
  }
}
export function reportCounts(rows: DirectReportRow[], channel: DirectChannel, now = Date.now()): Record<RowStatus, number> {
  const out: Record<RowStatus, number> = { sent: 0, queued: 0, later: 0, skipped: 0, failed: 0, in_app: 0 };
  for (const r of rows) out[rowStatus(r, channel, now)]++;
  return out;
}
export const reportPending = (rows: DirectReportRow[]) => rows.some((r) => r.email_status === 'queued' || r.email_status === 'sending');

export function reportCsv(rows: DirectReportRow[], channel: DirectChannel, label: (reason: string) => string = (r) => REASON_TEXT[r] ?? r): string {
  const head = ['Person', 'E-mail', 'Language', 'In-app', 'Read in app', 'Status', 'Reason', 'Sends after (UTC)', 'Finished (UTC)'];
  const ts = (s: string | null) => (s ? s.replace('T', ' ').slice(0, 16) : '');
  const lines = rows.map((r) => [
    r.name ?? '', r.email ?? '', r.lang, r.in_app ? 'yes' : 'no', r.read ? 'yes' : 'no', rowStatus(r, channel),
    r.reason ? label(r.reason) : '', r.email_status === 'queued' ? ts(r.send_after) : '', ts(r.finished_at),
  ].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...lines].join('\r\n');
}

export const newRequestKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`);
