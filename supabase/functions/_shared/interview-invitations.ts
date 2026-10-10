// Shared helpers for the live-interview invitation e-mails and the replies (accept / decline / another time).
import type { AdminClient } from './security.ts';
import { sendTemplateEmail } from './transactional-email-templates/send-email.ts';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TOKEN_RE = /^[0-9a-f]{64}$/;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Clean, unique, lower-case addresses from an array or a comma / semicolon / space separated string. */
export function cleanEmails(value: unknown, max: number): { emails: string[]; error: string | null } {
  const raw: string[] = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === 'string'
      ? value.split(/[\s,;]+/)
      : [];
  const emails: string[] = [];
  for (const item of raw) {
    const email = item.trim().toLowerCase();
    if (!email) continue;
    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return { emails: [], error: `"${item.trim().slice(0, 60)}" is not a valid e-mail address` };
    }
    if (!emails.includes(email)) emails.push(email);
  }
  if (emails.length > max) return { emails: [], error: `You can add at most ${max} addresses` };
  return { emails, error: null };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 256 random bits as hex. Only its SHA-256 hash is stored; the raw value exists only in the e-mail link. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface InterviewRow {
  id: string;
  consultant_id: string;
  requested_by: string | null;
  status: string;
  interview_style: string;
  scheduled_at: string | null;
  duration_minutes: number | null;
  meeting_url: string | null;
}

export async function loadSession(admin: AdminClient, sessionId: string): Promise<InterviewRow | null> {
  const { data } = await admin
    .from('interview_sessions')
    .select('id, consultant_id, requested_by, status, interview_style, scheduled_at, duration_minutes, meeting_url')
    .eq('id', sessionId)
    .maybeSingle();
  return (data as InterviewRow | null) ?? null;
}

export function isFinished(status: string): boolean {
  return ['completed', 'reviewed', 'cancelled'].includes(status);
}

/** The stored link, or the free Jitsi room derived from the session id (same formula as the database trigger). */
export function meetingUrlFor(session: Pick<InterviewRow, 'id' | 'meeting_url'>): string {
  return session.meeting_url && /^https:\/\//i.test(session.meeting_url)
    ? session.meeting_url
    : `https://meet.jit.si/qurtuba-interview-${session.id.replace(/-/g, '')}`;
}

export interface Contact {
  name: string;
  email: string | null;
}

export async function personContact(admin: AdminClient, userId: string, fallbackName?: string | null): Promise<Contact> {
  const { data: authUser } = await admin.auth.admin.getUserById(userId);
  const { data: profile } = await admin.from('profiles').select('display_name').eq('user_id', userId).maybeSingle();
  const email: string | null = authUser?.user?.email ?? null;
  return { name: profile?.display_name || fallbackName || email?.split('@')[0] || 'Participant', email };
}

export interface Person extends Contact {
  user_id: string;
  role: string;
  rsvp_status: string;
  timezone: string | null;
}

export async function loadPeople(admin: AdminClient, sessionId: string): Promise<Person[]> {
  const { data } = await admin
    .from('interview_participants')
    .select('user_id, role, display_name, rsvp_status')
    .eq('session_id', sessionId)
    .order('created_at');
  const people: Person[] = [];
  for (const row of (data ?? []) as Array<{ user_id: string; role: string; display_name: string | null; rsvp_status: string }>) {
    const contact = await personContact(admin, row.user_id, row.display_name);
    const { data: consultant } = await admin.from('consultants').select('timezone').eq('user_id', row.user_id).maybeSingle();
    people.push({ ...contact, user_id: row.user_id, role: row.role, rsvp_status: row.rsvp_status, timezone: consultant?.timezone ?? null });
  }
  return people;
}

/** "Thursday 8 October 2026 at 06:00 UTC" plus the same moment in the person's own time zone when it is known. */
export function formatWhen(iso: string | null | undefined, timeZone?: string | null): { utc: string; local: string | null } | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const fmt = (tz: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(date);
  let local: string | null = null;
  if (timeZone && timeZone !== 'UTC') {
    try {
      local = `${fmt(timeZone)} (${timeZone})`;
    } catch {
      local = null;
    }
  }
  return { utc: `${fmt('UTC')} UTC`, local };
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function calendarLinks(args: {
  title: string;
  start: Date;
  durationMinutes: number;
  meetingUrl: string;
  roomUrl: string;
}): { google: string; outlook: string } {
  const end = new Date(args.start.getTime() + args.durationMinutes * 60_000);
  const details = `Video call: ${args.meetingUrl}\nInterview room and chat: ${args.roomUrl}`;
  const google = new URLSearchParams({
    action: 'TEMPLATE',
    text: args.title,
    dates: `${stamp(args.start)}/${stamp(end)}`,
    details,
    location: args.meetingUrl,
  });
  const outlook = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: args.title,
    startdt: args.start.toISOString(),
    enddt: end.toISOString(),
    body: details,
    location: args.meetingUrl,
  });
  return {
    google: `https://calendar.google.com/calendar/render?${google.toString()}`,
    outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${outlook.toString()}`,
  };
}

export async function notifyUser(admin: AdminClient, userId: string, title: string, body: string, link: string): Promise<void> {
  const { error } = await admin.rpc('safe_insert_notification', {
    _user_id: userId,
    _title: title,
    _body: body,
    _type: 'interview',
    _link: link,
  });
  if (error) console.error('notification failed', { code: error.code, message: error.message });
}

export type SendStatus = 'sent' | 'suppressed' | 'failed';

/** Sends a registered template and writes the outcome to email_send_log. Never throws. */
export async function sendLogged(
  admin: AdminClient,
  templateName: string,
  to: string,
  options: Parameters<typeof sendTemplateEmail>[2],
): Promise<SendStatus> {
  const log = async (status: string, errorMessage?: string) => {
    const { error } = await admin.from('email_send_log').insert({
      message_id: null,
      template_name: templateName,
      recipient_email: to,
      status,
      error_message: errorMessage ?? null,
    });
    if (error) console.error('send log failed', { code: error.code, message: error.message });
  };
  try {
    const result = await sendTemplateEmail(templateName, to, options);
    await log(result.sent ? 'sent' : 'suppressed');
    return result.sent ? 'sent' : 'suppressed';
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('interview e-mail failed', templateName, message);
    await log('failed', message.slice(0, 1000));
    return 'failed';
  }
}
