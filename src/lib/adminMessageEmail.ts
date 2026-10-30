/**
 * Admin messages by e-mail — screen-side mirror of docs/sql/admin-message-email.sql (ame_kind, ame_type_skip and the
 * claim limits). The database decides; this file only labels send boxes, builds the admin's choice header and is
 * covered by src/test/adminMessageEmail.test.tsx so screen and server agree.
 */
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
