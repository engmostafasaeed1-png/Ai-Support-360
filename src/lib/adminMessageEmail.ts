/**
 * Admin messages by e-mail — screen-side mirror of docs/sql/admin-message-email.sql (ame_kind, ame_type_skip and the
 * claim limits). The database decides; this file only labels send boxes, builds the admin's choice header and is
 * covered by src/test/adminMessageEmail.test.tsx so screen and server agree.
 */
import type { DecisionOutcome as Outcome, MessageCategory } from '../../supabase/functions/_shared/adminMessageEmail';

export type EmailKind = 'comment' | 'decision';
export type DeliveryStatus = 'queued' | 'sending' | 'sent' | 'skipped' | 'failed';

/** Header the database trigger reads for the admin's choice on this one request. */
export const ADMIN_EMAIL_HEADER = 'x-admin-email';
export const PER_RECIPIENT_PER_HOUR = 5;
export const MAX_RECIPIENTS_PER_ACTION = 5;

const COMMENT_TYPES = new Set(['admin_message', 'ticket', 'brd']);
const ALREADY_EMAILED = new Set(['nda', 'referral', 'referral_intro', 'sla', 'agreement', 'ticket_tracking', 'brd_approval',
  'feedback', 'feedback_reply', 'feedback_fixed', 'session', 'interview', 'match_request', 'critical_request', 'payout_approved']);

export const emailKindOf = (type: string | null | undefined): EmailKind => (COMMENT_TYPES.has(String(type ?? '').trim()) ? 'comment' : 'decision');
export const canUntickEmail = (type: string | null | undefined) => emailKindOf(type) === 'comment';
export const typeAlreadyEmailed = (type: string | null | undefined) => ALREADY_EMAILED.has(String(type ?? '').trim());

/** "off" only for comments (decisions are locked on), plus "important" (override quiet pauses) and "tests". */
export function adminEmailHeader(v: { type: string; email?: boolean; important?: boolean; includeTests?: boolean }): string {
  const parts: string[] = [];
  if (v.email === false && canUntickEmail(v.type)) parts.push('off');
  else {
    if (v.important) parts.push('important');
    if (v.includeTests) parts.push('tests');
  }
  return parts.join(',');
}

/** Mirror of ame_claim for one recipient: waiting messages vs e-mails already sent in the last hour. */
export function planRecipientMail(waiting: number, sentThisHour: number, perHour = PER_RECIPIENT_PER_HOUR):
  { kind: 'single' | 'digest' | 'held'; mails: number } {
  if (waiting <= 0 || sentThisHour >= perHour) return { kind: 'held', mails: 0 };
  return waiting <= perHour - sentThisHour ? { kind: 'single', mails: waiting } : { kind: 'digest', mails: 1 };
}

/** Skip / failure reasons stored by the database, for labels. */
export const DELIVERY_REASONS = [
  'already_emailed', 'admin_alert', 'list_send_in_app_only', 'one_email_per_action', 'admin_unticked_email', 'test_account',
  'in_app_not_delivered', 'no_email', 'email_not_confirmed', 'paused', 'notification_removed', 'daily_cap_reached',
  'switched_off', 'recipient_suppressed', 'email_notifications_off', 'too_many_attempts',
] as const;

// ------------------------------------------------------------------ compose box and history (mirrors admin_message_send)


/** Only minor categories may skip the e-mail; the database ignores "no e-mail" for the others. */
export const UNTICKABLE_CATEGORIES: readonly MessageCategory[] = ['update', 'welcome'];
export const canUntickCategory = (c: MessageCategory) => UNTICKABLE_CATEGORIES.includes(c);

export const LIMITS = { subject: 120, subjectTip: 70, summary: 200, summaryTip: 140, body: 4000, bodyTip: 1200, action: 120 } as const;
export const TEMPLATE_VARS = ['first_name', 'ticket', 'link'] as const;

/** Fills {first_name}, {ticket}, {link} (also {{first_name}}); unknown variables stay visible so the admin notices. */
export function fillTemplateVars(text: string, vars: Partial<Record<(typeof TEMPLATE_VARS)[number], string>>): string {
  return text.replace(/\{\{?\s*(first_name|ticket|link)\s*\}?\}/g, (m, k: keyof typeof vars) => (vars[k] ? String(vars[k]) : m));
}
export const firstNameOf = (name: string | null | undefined) => String(name ?? '').trim().split(/\s+/)[0] ?? '';

export interface HistoryRow {
  id: string; notification_id: string; created_at: string; recipient: string; recipient_name: string | null; actor_name: string | null;
  category: MessageCategory; subject: string | null; status: DeliveryStatus; reason: string | null; is_read: boolean; in_app: boolean;
  important: boolean; is_test: boolean; digest: boolean; send_after: string; decision?: string | null;
  /** From docs/sql/admin-direct-email.sql: 'both' | 'in_app' (e-mail skipped) | 'email' (e-mail only) | 'none'; direct sends. */
  channel?: 'both' | 'in_app' | 'email' | 'none'; direct_send?: string | null;
}

/** Spreadsheet-safe cell (= + - @ would run as formulas). */
export function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
}
export function historyCsv(rows: HistoryRow[]): string {
  const head = ['Date (UTC)', 'Recipient', 'Category', 'Subject', 'Channels', 'E-mail status', 'Reason', 'Read in app', 'Sent by'];
  const lines = rows.map((r) => [
    r.created_at.replace('T', ' ').slice(0, 16), r.recipient_name ?? r.recipient, r.category, r.subject ?? '',
    ({ both: 'in-app + e-mail', in_app: 'in-app', email: 'e-mail only', none: 'not delivered' } as const)[r.channel ?? (r.status === 'skipped' ? 'in_app' : 'both')], r.status, r.reason ?? '', r.is_read ? 'yes' : 'no', r.actor_name ?? '',
  ].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...lines].join('\r\n');
}

// ------------------------------------------------------------------ review decisions (mirrors ame_decision_notice)

export type { DecisionOutcome, DecisionSubject } from '../../supabase/functions/_shared/adminMessageEmail';

/** What admin_decision_recipient returns (null before docs/sql/admin-message-email.sql is applied). */
export interface DecisionRecipient { found?: boolean; email?: string | null; confirmed?: boolean; test?: boolean; suppressed?: boolean; lang?: 'en' | 'ar' | null; enabled?: boolean }
export type DecisionNoticeState =
  | { kind: 'send'; email: string } | { kind: 'unknown'; email?: undefined }
  | { kind: 'no_email' | 'not_confirmed' | 'test' | 'suppressed' | 'off'; email?: string };

/** The line beside a decision comment box, in the same order as the database skips (ame_enqueue / ame_claim). */
export function decisionNoticeState(r: DecisionRecipient | null | undefined): DecisionNoticeState {
  if (!r || r.found === false) return { kind: 'unknown' };
  const email = r.email?.trim() || '';
  if (r.test) return { kind: 'test', email };
  if (!email) return { kind: 'no_email' };
  if (r.enabled === false) return { kind: 'off', email };
  if (!r.confirmed) return { kind: 'not_confirmed', email };
  if (r.suppressed) return { kind: 'suppressed', email };
  return { kind: 'send', email };
}

/** Consultant status change → decision (mirrors notify_consultant_verification_change). null = no notice. */
export function consultantOutcome(from: string | null | undefined, to: string): Outcome | null {
  if (to === 'verified') return from === 'suspended' ? 'reactivated' : from === 'rejected' ? 'reapproved' : 'approved';
  if (to === 'rejected') return 'rejected';
  if (to === 'on_hold') return 'info';
  if (to === 'suspended') return 'suspended';
  if (from === 'verified' && (to === 'pending' || to === 'under_review')) return 'unverified';
  if (to === 'under_review') return 'review';
  return null;
}
