/**
 * Bug H5: scheduling a meeting with external (non-portal) attendees. Shared by the schedule-meeting function,
 * the meeting-ics function, the invitation e-mail and the Schedule Meeting dialog, so validation, links and
 * messages are the same everywhere.
 */
export type Lang = 'en' | 'ar';
export const MAX_EXTERNAL_INVITEES = 10;
export const MAX_CONSULTANT_INVITEES = 10;

const LOCAL_RE = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;
const LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** Trims, drops "mailto:" and angle brackets, lower-cases the domain (the local part is kept as typed). */
export function normalizeEmail(raw: string): string {
  let s = String(raw ?? '').trim().replace(/^<|>$/g, '').trim().replace(/^mailto:/i, '').trim();
  const at = s.lastIndexOf('@');
  if (at > 0) s = s.slice(0, at) + '@' + s.slice(at + 1).toLowerCase();
  return s;
}

/**
 * A real external address: plus-addressing (name+tag@x.com), upper case, sub-domains (a@mail.dept.example.co.uk)
 * and international domains (xn--) are fine; spaces, two "@", "..", a leading/trailing dot or a domain without a
 * dot are not.
 */
export function isValidEmail(raw: string): boolean {
  const e = normalizeEmail(raw);
  if (!e || e.length > 254) return false;
  const at = e.lastIndexOf('@');
  if (at <= 0 || e.indexOf('@') !== at) return false;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (local.length > 64 || !LOCAL_RE.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some((l) => !LABEL_RE.test(l))) return false;
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,63}$/i.test(tld) || /^xn--[a-z0-9-]{2,59}$/i.test(tld);
}

const key = (e: string) => normalizeEmail(e).toLowerCase();

/** Adds pasted or typed addresses (comma, semicolon, space or new line separated) to the chip list. */
export function addInvitees(current: string[], input: string, max = MAX_EXTERNAL_INVITEES) {
  const parts = String(input ?? '').split(/[\s,;]+/).map(normalizeEmail).filter(Boolean);
  const list = [...current];
  const invalid: string[] = [], duplicates: string[] = [], overLimit: string[] = [], added: string[] = [];
  for (const p of parts) {
    if (!isValidEmail(p)) { invalid.push(p); continue; }
    if (list.some((x) => key(x) === key(p))) { duplicates.push(p); continue; }
    if (list.length >= max) { overLimit.push(p); continue; }
    list.push(p); added.push(p);
  }
  return { list, added, invalid, duplicates, overLimit };
}

/** Unique valid addresses for the server (case-insensitive), or the first problem. */
export function cleanInvitees(raw: unknown, max = MAX_EXTERNAL_INVITEES): { ok: true; emails: string[] } | { ok: false; code: 'invalid_email' | 'too_many_invitees'; detail?: string } {
  if (raw == null) return { ok: true, emails: [] };
  if (!Array.isArray(raw)) return { ok: false, code: 'invalid_email' };
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== 'string' || !isValidEmail(r)) return { ok: false, code: 'invalid_email', detail: typeof r === 'string' ? r.slice(0, 80) : undefined };
    const e = normalizeEmail(r);
    if (!out.some((x) => key(x) === key(e))) out.push(e);
  }
  if (out.length > max) return { ok: false, code: 'too_many_invitees' };
  return { ok: true, emails: out };
}

// ---------------------------------------------------------------------------------------------------- messages

export const MEETING_ERRORS = {
  not_signed_in: ['Please sign in again, then schedule the meeting.', 'يرجى تسجيل الدخول مرة أخرى ثم جدولة الاجتماع.'],
  not_allowed: ['Only the client of this request, an assigned consultant or an administrator can schedule its meetings.', 'يمكن لعميل هذا الطلب أو لمستشار معيّن عليه أو لمسؤول فقط جدولة اجتماعاته.'],
  ticket_not_found: ['This request could not be found.', 'تعذر العثور على هذا الطلب.'],
  client_not_approved: ['Your account is not approved yet. Meetings open after an administrator approves your company information.', 'لم تتم الموافقة على حسابك بعد. تتاح الاجتماعات بعد موافقة المسؤول على بيانات شركتك.'],
  consultant_not_assigned: ['A chosen consultant is not assigned to this request.', 'أحد المستشارين المختارين غير معيّن على هذا الطلب.'],
  no_participants: ['Add at least one participant (a consultant or an e-mail address).', 'أضف مشاركًا واحدًا على الأقل (مستشارًا أو بريدًا إلكترونيًا).'],
  invalid_email: ['One of the e-mail addresses is not valid. Check it and try again.', 'أحد عناوين البريد الإلكتروني غير صحيح. تحقق منه وحاول مرة أخرى.'],
  too_many_invitees: [`You can invite at most ${MAX_EXTERNAL_INVITEES} e-mail addresses to one meeting.`, `يمكنك دعوة ${MAX_EXTERNAL_INVITEES} عناوين بريد كحد أقصى لاجتماع واحد.`],
  invalid_time: ['Choose a date and time in the future.', 'اختر تاريخًا ووقتًا في المستقبل.'],
  invalid_link: ['The meeting link is not valid. Paste the full https:// link of the meeting.', 'رابط الاجتماع غير صحيح. الصق رابط الاجتماع الكامل الذي يبدأ بـ https://.'],
  invalid_input: ['Some meeting details are not valid. Check them and try again.', 'بعض تفاصيل الاجتماع غير صحيحة. تحقق منها وحاول مرة أخرى.'],
  consultant_busy: ['This consultant already has a meeting at that time. Choose another time.', 'لدى هذا المستشار اجتماع في ذلك الوقت. اختر وقتًا آخر.'],
  rate_limited: ['Too many meetings or invitations in the last hour. Please try again later.', 'عدد كبير من الاجتماعات أو الدعوات في الساعة الأخيرة. يرجى المحاولة لاحقًا.'],
  server_error: ['The meeting could not be scheduled because of a problem on our side. Please try again in a moment.', 'تعذرت جدولة الاجتماع بسبب مشكلة لدينا. يرجى المحاولة بعد قليل.'],
  network: ['The meeting could not be scheduled: no connection to the server. Check your internet and try again.', 'تعذرت جدولة الاجتماع: لا يوجد اتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.'],
} as const;
export type MeetingErrorCode = keyof typeof MEETING_ERRORS;

export function meetingErrorText(code: string | null | undefined, lang: Lang = 'en'): string {
  const c = (code && code in MEETING_ERRORS ? code : 'server_error') as MeetingErrorCode;
  return MEETING_ERRORS[c][lang === 'ar' ? 1 : 0];
}

/** Database errors -> plain codes (never the raw "row-level security" text). */
export function codeForDbError(err: { code?: string | null; message?: string | null } | null | undefined): MeetingErrorCode {
  const code = err?.code ?? '';
  const msg = (err?.message ?? '').toLowerCase();
  if (code === '23P01' || msg.includes('already booked')) return 'consultant_busy';
  if (msg.includes('not approved')) return 'client_not_approved';
  if (msg.includes('verified consultant')) return 'consultant_not_assigned';
  if (code === '42501' || msg.includes('row-level security')) return 'not_allowed';
  if (code === '54000') return 'rate_limited';
  if (msg.includes('link') || msg.includes('url')) return 'invalid_link';
  return 'server_error';
}

export type InviteStatus = 'sent' | 'suppressed' | 'disabled' | 'rate_limited' | 'failed';
export interface InviteResult { email: string; status: InviteStatus }

export const INVITE_STATUS_TEXT: Record<InviteStatus, [string, string]> = {
  sent: ['Invitation sent', 'تم إرسال الدعوة'],
  suppressed: ['Not sent: this address unsubscribed or bounced before. Share the join link directly.', 'لم تُرسل: هذا العنوان ألغى الاشتراك أو ارتد سابقًا. شارك رابط الانضمام مباشرة.'],
  disabled: ['Not sent: e-mails are switched off by the administrator.', 'لم تُرسل: الرسائل متوقفة من قبل المسؤول.'],
  rate_limited: ['Not sent yet: too many e-mails right now. Try again later or share the join link.', 'لم تُرسل بعد: رسائل كثيرة الآن. حاول لاحقًا أو شارك رابط الانضمام.'],
  failed: ['Not sent: the e-mail service had a problem. Share the join link directly or try again.', 'لم تُرسل: حدثت مشكلة في خدمة البريد. شارك رابط الانضمام مباشرة أو حاول مرة أخرى.'],
};
export const inviteStatusText = (s: InviteStatus, lang: Lang = 'en') => INVITE_STATUS_TEXT[s][lang === 'ar' ? 1 : 0];

/** "s***@example.com" for logs and audit rows. */
export function maskAddress(email: string): string {
  const e = normalizeEmail(email);
  const at = e.lastIndexOf('@');
  return at > 0 ? `${e.slice(0, 1)}***@${e.slice(at + 1)}` : '***';
}

// ---------------------------------------------------------------------------------------------------- links + calendar

/** The public join page (no account needed); it opens the meeting room in a new top-level tab. */
export function joinPageUrl(site: string, sessionId: string, meetingUrl?: string | null): string {
  const base = `${site.replace(/\/+$/, '')}/join/${sessionId}`;
  return meetingUrl ? `${base}?to=${encodeURIComponent(meetingUrl)}` : base;
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
/** Folds lines longer than 75 octets (RFC 5545). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let n = 74;
    while (new TextEncoder().encode(rest.slice(0, n)).length > 74) n--;
    out.push(rest.slice(0, n));
    rest = ' ' + rest.slice(n);
  }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(i: { uid: string; start: Date; durationMinutes: number; title: string; url: string; description?: string; now?: Date }): string {
  const end = new Date(i.start.getTime() + Math.max(1, i.durationMinutes) * 60_000);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AI Support 360//Meeting//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${i.uid}@aisupport360.com`,
    `DTSTAMP:${icsDate(i.now ?? new Date())}`,
    `DTSTART:${icsDate(i.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(i.title)}`,
    `DESCRIPTION:${icsText(i.description ?? `Join: ${i.url}`)}`,
    `URL:${i.url}`,
    `LOCATION:${icsText(i.url)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(i: { start: Date; durationMinutes: number; title: string; url: string }): string {
  const end = new Date(i.start.getTime() + Math.max(1, i.durationMinutes) * 60_000);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: i.title, dates: `${icsDate(i.start)}/${icsDate(end)}`, details: `Join: ${i.url}`, location: i.url });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

export const SESSION_TYPES = ['video', 'chat', 'screen_share'] as const;
export const MEETING_PLATFORMS = ['jitsi', 'zoom', 'google_meet', 'ms_teams'] as const;
