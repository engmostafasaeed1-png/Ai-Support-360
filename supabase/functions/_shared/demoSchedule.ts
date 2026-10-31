/**
 * Demo bookings (docs/sql/demo-schedule-alerts.sql): the ONE place for the "Demo booked: schedule needed" alert, the
 * reminders and the requester's meeting e-mails, plus the time-zone, business-hour, countdown, reply and calendar
 * helpers shared by the e-mails, the admin Demo requests page and the requester's confirmation page.
 * Pure TypeScript (Intl only). Content is only what the demo form collected; links are only pages on our own site plus
 * a mailto reply to the requester. The business-hour maths mirrors sla_add_business_minutes (tested).
 */
import { MESSAGE_COPY, type MessageCategory } from './adminMessageEmail.ts';

export type Lang = 'en' | 'ar';

// ------------------------------------------------------------------ settings (platform_settings 'demo_schedule_alerts')

export interface DemoCalendar { mode: 'business' | '24x7'; tz: string; days: number[]; start: string; end: string; holidays: string[] }
export interface DemoAlertSettings {
  enabled: boolean;
  /** Confirm a slot within this many business hours (the website promises one). */
  respond_business_hours: number;
  admin_timezone: string;
  admin_language: Lang;
  /** Reminders after the deadline: one at the deadline, then at most this many more, one per day. */
  daily_reminders_max: number;
  default_duration_min: number;
  calendar: DemoCalendar;
}

export const DEMO_ALERT_DEFAULTS: DemoAlertSettings = {
  enabled: true,
  respond_business_hours: 1,
  admin_timezone: 'Asia/Riyadh',
  admin_language: 'en',
  daily_reminders_max: 2,
  default_duration_min: 30,
  // Our published support hours: Sun–Thu, 8 AM – 6 PM (AST).
  calendar: { mode: 'business', tz: 'Asia/Riyadh', days: [0, 1, 2, 3, 4], start: '08:00', end: '18:00', holidays: [] },
};

export function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}
const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Stored settings merged over the defaults and clamped (bad values fall back to the default). */
export function readDemoSettings(v: unknown): DemoAlertSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const c = (o.calendar && typeof o.calendar === 'object' ? o.calendar : {}) as Record<string, unknown>;
  const d = DEMO_ALERT_DEFAULTS;
  const days = Array.isArray(c.days) ? [...new Set(c.days.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))] : d.calendar.days;
  return {
    enabled: o.enabled === undefined ? d.enabled : o.enabled === true,
    respond_business_hours: num(o.respond_business_hours, 0.25, 72, d.respond_business_hours),
    admin_timezone: validTz(o.admin_timezone) ? o.admin_timezone : d.admin_timezone,
    admin_language: o.admin_language === 'ar' ? 'ar' : 'en',
    daily_reminders_max: Math.round(num(o.daily_reminders_max, 0, 2, d.daily_reminders_max)),
    default_duration_min: Math.round(num(o.default_duration_min, 15, 240, d.default_duration_min)),
    calendar: {
      mode: c.mode === '24x7' ? '24x7' : 'business',
      tz: validTz(c.tz) ? c.tz : d.calendar.tz,
      days: days.length ? days.sort() : d.calendar.days,
      start: typeof c.start === 'string' && HM.test(c.start) ? c.start : d.calendar.start,
      end: typeof c.end === 'string' && HM.test(c.end) ? c.end : d.calendar.end,
      holidays: Array.isArray(c.holidays) ? c.holidays.filter((x): x is string => typeof x === 'string' && YMD.test(x)).slice(0, 100) : [],
    },
  };
}

// ------------------------------------------------------------------ time zones

function partsIn(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTz(tz) ? tz : 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0');
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour') % 24, mi: g('minute'), s: g('second') };
}
/** Minutes the zone is ahead of UTC at that instant. */
export function tzOffsetMin(d: Date, tz: string): number {
  const p = partsIn(d, tz);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}
/** The local date (YYYY-MM-DD) in the zone. */
export function localDate(d: Date, tz: string): string {
  const p = partsIn(d, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
/** A wall-clock date + time in a zone as an instant (daylight saving handled); null when it cannot be read. */
export function zonedToUtc(date: string | null | undefined, time: string | null | undefined, tz: string | null | undefined): Date | null {
  if (!date || !YMD.test(date)) return null;
  const m = HM.exec(String(time ?? '').trim().slice(0, 5));
  if (!m) return null;
  const zone = validTz(tz) ? tz : 'UTC';
  const [y, mo, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2]));
  let t = guess - tzOffsetMin(new Date(guess), zone) * 60000;
  const second = guess - tzOffsetMin(new Date(t), zone) * 60000;
  if (second !== t) t = second;
  return new Date(t);
}

const LOCALE: Record<Lang, string> = { en: 'en-GB', ar: 'ar-EG' };
/** "Tue, 3 Nov 2026, 10:00 (Europe/London)". */
export function formatInZone(d: Date | null, tz: string, lang: Lang = 'en', withZone = true): string {
  if (!d || Number.isNaN(d.getTime())) return '';
  const zone = validTz(tz) ? tz : 'UTC';
  const s = d.toLocaleString(LOCALE[lang], { timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return withZone ? `${s} (${zone})` : s;
}

// ------------------------------------------------------------------ business hours (mirror of sla_add_business_minutes)

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 12)).toISOString().slice(0, 10);
}
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();

/** Adds counted minutes on the calendar (working days, start–end local time, holidays skipped). */
export function addBusinessMinutes(from: Date, minutes: number, cal: DemoCalendar): Date {
  if (!(minutes > 0)) return from;
  if (cal.mode !== 'business') return new Date(from.getTime() + minutes * 60000);
  const tz = validTz(cal.tz) ? cal.tz : 'UTC';
  let left = minutes;
  let day = localDate(from, tz);
  for (let i = 0; i < 400; i++) {
    if (cal.days.includes(weekday(day)) && !cal.holidays.includes(day)) {
      const ws = zonedToUtc(day, cal.start, tz)!;
      const we = zonedToUtc(day, cal.end, tz)!;
      const s = Math.max(from.getTime(), ws.getTime());
      if (we.getTime() > s) {
        const avail = (we.getTime() - s) / 60000;
        if (left <= avail) return new Date(s + left * 60000);
        left -= avail;
      }
    }
    day = nextDay(day);
  }
  return new Date(from.getTime() + minutes * 60000);
}
export const respondByFor = (createdAt: Date, s: DemoAlertSettings) => addBusinessMinutes(createdAt, Math.round(s.respond_business_hours * 60), s.calendar);

// ------------------------------------------------------------------ wording

export function durationText(min: number, lang: Lang = 'en'): string {
  const v = Math.max(0, Math.round(min));
  const u = lang === 'ar' ? { d: 'ي', h: 'س', m: 'د' } : { d: 'd', h: 'h', m: 'min' };
  const d = Math.floor(v / 1440), h = Math.floor((v % 1440) / 60), m = v % 60;
  const out = [d ? `${d} ${u.d}` : '', h ? `${h} ${u.h}` : '', !d && (m || (!h && !d)) ? `${m} ${u.m}` : ''].filter(Boolean);
  return out.join(' ');
}
/** "45 min left" / "Overdue by 1 h 20 min" (minutes rounded up while time is left). */
export function dueWording(due: Date, now: Date, lang: Lang = 'en'): { overdue: boolean; text: string } {
  const diff = (due.getTime() - now.getTime()) / 60000;
  if (diff > 0) {
    const t = durationText(Math.ceil(diff), lang);
    return { overdue: false, text: lang === 'ar' ? `متبقٍ ${t}` : `${t} left` };
  }
  const t = durationText(Math.floor(-diff), lang);
  return { overdue: true, text: lang === 'ar' ? `متأخر منذ ${t}` : `Overdue by ${t}` };
}
const hoursWord = (h: number, lang: Lang) => {
  const v = Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  if (lang === 'ar') return h === 1 ? 'ساعة عمل واحدة' : `${v} ساعات عمل`;
  return `${v} business hour${h === 1 ? '' : 's'}`;
};

export const DEMO_TYPE_LABELS: Record<Lang, Record<string, string>> = {
  en: { live: 'Live platform walkthrough', 'ai-triage': 'AI triage demo', 'pricing-roi': 'Pricing & ROI call', 'module-deep-dive': 'Custom module deep-dive' },
  ar: { live: 'جولة مباشرة في المنصة', 'ai-triage': 'عرض الفرز بالذكاء الاصطناعي', 'pricing-roi': 'مكالمة الأسعار والعائد', 'module-deep-dive': 'تعمّق في وحدة مخصصة' },
};
export const PREFERENCE_LABELS: Record<Lang, Record<string, string>> = {
  en: { asap: 'As soon as possible', 'this-week': 'This week', 'next-week': 'Next week', flexible: 'Flexible' },
  ar: { asap: 'في أقرب وقت ممكن', 'this-week': 'هذا الأسبوع', 'next-week': 'الأسبوع القادم', flexible: 'مرن' },
};
export const FORMAT_LABELS: Record<Lang, Record<string, string>> = {
  en: { video: 'Video call', phone: 'Phone call', 'in-person': 'In person' },
  ar: { video: 'مكالمة فيديو', phone: 'مكالمة هاتفية', 'in-person': 'حضوريًا' },
};
const label = (map: Record<Lang, Record<string, string>>, lang: Lang, v: string | null | undefined) => (v ? map[lang][v] ?? v : '');

// ------------------------------------------------------------------ the request

export interface DemoRequestRow {
  id: string; request_token?: string | null; demo_type: string; scheduling_preference?: string | null;
  scheduled_date?: string | null; scheduled_slot?: string | null; timezone?: string | null; meeting_format?: string | null;
  full_name: string; email: string; company?: string | null; notes?: string | null; source?: string | null; created_at: string;
  status?: string | null; status_note?: string | null; proposed_slots?: unknown; reschedule_reason?: string | null;
  requester_role?: string | null; phone?: string | null; sap_area?: string | null; language?: string | null;
  respond_by?: string | null; meeting_at?: string | null; meeting_duration_min?: number | null; meeting_link?: string | null;
  meeting_version?: number | null; cancel_reason?: string | null;
}

export interface DemoSlotView { kind: 'requested' | 'proposed'; date: string; time: string; asEntered: string; start: string | null; admin: string; requester: string; past: boolean }

/** Preferred times exactly as entered (date, time, requester zone), with the instant in both zones. */
export function demoSlots(row: DemoRequestRow, adminTz: string, lang: Lang = 'en', now: Date = new Date()): DemoSlotView[] {
  const tz = validTz(row.timezone) ? row.timezone : 'UTC';
  const raw: { kind: DemoSlotView['kind']; date?: unknown; time?: unknown }[] = [];
  if (row.scheduled_date && row.scheduled_slot) raw.push({ kind: 'requested', date: row.scheduled_date, time: row.scheduled_slot });
  if (Array.isArray(row.proposed_slots)) for (const s of row.proposed_slots.slice(0, 5)) {
    if (s && typeof s === 'object') raw.push({ kind: 'proposed', date: (s as Record<string, unknown>).date, time: (s as Record<string, unknown>).time });
  }
  const out: DemoSlotView[] = [];
  for (const r of raw) {
    const date = typeof r.date === 'string' ? r.date.slice(0, 10) : '';
    const time = typeof r.time === 'string' ? r.time.slice(0, 20) : '';
    if (!date || !time) continue;
    const start = zonedToUtc(date, time, tz);
    out.push({
      kind: r.kind, date, time, asEntered: `${date} ${time} (${row.timezone || 'UTC'})`, start: start ? start.toISOString() : null,
      admin: start ? formatInZone(start, adminTz, lang) : '', requester: start ? formatInZone(start, tz, lang) : '',
      past: !!start && start.getTime() <= now.getTime(),
    });
  }
  return out;
}

export const firstName = (name: string | null | undefined) => String(name ?? '').trim().split(/\s+/)[0]?.slice(0, 40) ?? '';
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

/** mailto: reply to the requester with a prefilled subject (only a valid address, everything else encoded). */
export function replyMailto(row: Pick<DemoRequestRow, 'email' | 'full_name' | 'language'>): string | null {
  const to = String(row.email ?? '').trim();
  if (!EMAIL_RE.test(to) || to.length > 254) return null;
  const ar = row.language === 'ar';
  const name = firstName(row.full_name);
  const subject = ar ? 'عرضك التوضيحي لـ AI Support 360: اختيار الموعد' : 'Your AI Support 360 demo: choosing a time';
  const body = ar
    ? `مرحبًا ${name}،\n\nشكرًا لحجز عرض توضيحي لـ AI Support 360.\n`
    : `Hello ${name},\n\nThank you for booking an AI Support 360 demo.\n`;
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** A meeting link the team entered: https only, no user name/password, max 500 characters. */
export function safeMeetingLink(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim() || v.length > 500) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch { return null; }
}

/** Our own site only (fallback to the public address). */
export function siteBase(site: string | null | undefined): string {
  const s = String(site ?? '').replace(/\/+$/, '');
  return /^https:\/\/(www\.)?aisupport360\.com$/.test(s) ? s : 'https://www.aisupport360.com';
}
export const adminDemoUrl = (site: string, id: string, action?: 'schedule' | 'propose') =>
  `${siteBase(site)}/admin/demo-requests?request=${encodeURIComponent(id)}${action ? `&action=${action}` : ''}`;
export const requesterDemoUrl = (site: string, token: string | null | undefined, extra = '') =>
  /^[a-f0-9]{32}$/.test(String(token ?? '')) ? `${siteBase(site)}/demo/confirmation/${token}${extra}` : `${siteBase(site)}/`;

// ------------------------------------------------------------------ calendar file (.ics)

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line: string): string {
  const out: string[] = [];
  let s = line;
  while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; }
  out.push(s);
  return out.join('\r\n');
}
export interface IcsEvent { uid: string; start: Date; durationMin: number; title: string; description?: string; url?: string; status: 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED'; sequence?: number; now?: Date }
export function buildIcs(ev: IcsEvent): string {
  const end = new Date(ev.start.getTime() + Math.max(5, ev.durationMin) * 60000);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AI Support 360//Demo//EN', 'CALSCALE:GREGORIAN',
    `METHOD:${ev.status === 'CANCELLED' ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${icsText(ev.uid)}@aisupport360.com`,
    `DTSTAMP:${icsDate(ev.now ?? new Date())}`,
    `DTSTART:${icsDate(ev.start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(ev.title)}`,
    ev.description ? `DESCRIPTION:${icsText(ev.description)}` : '',
    ev.url ? `URL:${icsText(ev.url)}` : '',
    `STATUS:${ev.status}`,
    `SEQUENCE:${Math.max(0, Math.floor(ev.sequence ?? 0))}`,
    'TRANSP:OPAQUE',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

// ------------------------------------------------------------------ e-mail view (rendered by _shared/demoScheduleEmail.ts)

export type DemoBadgeTone = 'approved' | 'changes' | 'rejected' | 'review';
export interface DemoEmailView {
  lang: Lang; subject: string; preheader: string; category: MessageCategory; badge?: { text: string; tone: DemoBadgeTone } | null;
  title: string; summary: string; paragraphs: string[];
  rows: { label: string; value: string }[];
  quote?: { label: string; text: string } | null;
  slots?: { heading: string; items: { main: string; sub?: string; note?: string }[]; empty?: string } | null;
  todo?: { heading: string; lines: string[]; strong?: string; overdue?: boolean } | null;
  primary: { label: string; href: string };
  secondary: { label: string; href: string }[];
  sentLine: string;
  footer: { helpLine: string; help: string; why: string; prefs?: string; prefsUrl?: string; replyNote?: string };
  test?: boolean;
}

export const DEMO_COPY = {
  en: {
    alertTitle: 'Demo booked: schedule needed',
    reminderTitle: (n: number) => `Reminder${n > 1 ? ` ${n}` : ''}: demo still not scheduled`,
    contactTitle: 'New message from the website',
    alertSubject: (name: string, company: string) => `Demo booked: schedule needed — ${name}${company ? ` (${company})` : ''}`,
    reminderSubject: (name: string) => `Reminder: schedule the demo for ${name}`,
    contactSubject: (name: string) => `New website message from ${name}`,
    summary: (name: string, company: string, type: string) => `${name}${company ? ` (${company})` : ''} booked a "${type}" demo.`,
    reminderSummary: (name: string) => `${name}'s demo has no confirmed time yet and the response deadline has passed.`,
    rows: {
      name: 'Name', company: 'Company', role: 'Role', email: 'E-mail', phone: 'Phone / WhatsApp', tz: 'Time zone', language: 'Language',
      sap: 'SAP area / module', type: 'Demo', format: 'Meeting format', source: 'Source page', requested: 'Request time', when: 'Date and time', duration: 'Duration', link: 'Meeting link',
    },
    langNames: { en: 'English', ar: 'Arabic' } as Record<string, string>,
    countryNote: 'Country is not asked on the form; the time zone shows where they are.',
    wantToSee: 'What they want to see',
    slotsHeading: 'Preferred time',
    slotMain: (admin: string) => admin,
    slotSub: (req: string, entered: string) => `Requester's time: ${req} · as entered: ${entered}`,
    proposed: 'proposed later',
    passed: 'already passed',
    noPreference: (pref: string) => `No preference: no date or time was picked${pref ? ` (they chose "${pref}")` : ''}. Suggest a time.`,
    todoHeading: 'What you need to do',
    todoLine: (h: string) => `Confirm a time slot within ${h}: that is what the website promises.`,
    respondBy: (when: string, countdown: string) => `Respond by ${when} · ${countdown}`,
    duplicate: 'Possible duplicate: the same e-mail booked another demo in the last 24 hours.',
    open: 'Open request and schedule',
    propose: 'Propose time',
    reply: 'Reply to requester',
    openContact: 'Open the requests page',
    sent: (at: string) => `Sent automatically by AI Support 360${at ? ` · ${at}` : ''}`,
    adminWhy: 'You receive this because you are an AI Support 360 administrator (demo bookings).',
    adminPrefs: 'Demo alert settings',
    helpLine: 'Questions? Write to',
    // requester
    hello: (n: string) => (n ? `Hello ${n},` : 'Hello,'),
    receivedTitle: 'We received your demo request',
    receivedSummary: (h: string) => `Our team will confirm a time with you within ${h}.`,
    receivedBody: 'Thank you for booking a demo of AI Support 360. You can follow your request, and propose another time, on your request page.',
    confirmedTitle: 'Your demo is confirmed',
    rescheduledTitle: 'Your demo has a new time',
    cancelledTitle: 'Your demo was cancelled',
    confirmedSummary: (when: string) => `See you on ${when}.`,
    cancelledSummary: 'The demo you booked will not take place at the agreed time.',
    badgeConfirmed: 'Confirmed', badgeRescheduled: 'New time', badgeCancelled: 'Cancelled', badgeReceived: 'Received',
    teamNote: 'Note from our team',
    reason: 'Reason',
    linkOnPage: 'On your request page (button below)',
    linkLater: 'We will add it to your request page before the demo',
    todoMeeting: ['Add the demo to your calendar.', 'At the time above, open your request page and join from there.'],
    todoCancelled: ['If you still want a demo, book a new one or reply to this e-mail and we will find a time.'],
    viewMeeting: 'View meeting and join',
    viewRequest: 'View your request',
    addCalendar: 'Add to calendar',
    otherTime: 'Need another time?',
    bookNew: 'Book a new demo',
    requesterWhy: 'You receive this because you booked a demo on www.aisupport360.com.',
    replyNote: 'You can also reply to this e-mail.',
    preferred: 'Your preferred time',
    minutes: (n: number) => `${n} minutes`,
  },
  ar: {
    alertTitle: 'تم حجز عرض توضيحي: يلزم تحديد موعد',
    reminderTitle: (n: number) => `تذكير${n > 1 ? ` ${n}` : ''}: لم يُحدَّد موعد العرض بعد`,
    contactTitle: 'رسالة جديدة من الموقع',
    alertSubject: (name: string, company: string) => `تم حجز عرض توضيحي: يلزم تحديد موعد — ${name}${company ? ` (${company})` : ''}`,
    reminderSubject: (name: string) => `تذكير: حدِّد موعد العرض التوضيحي لـ ${name}`,
    contactSubject: (name: string) => `رسالة جديدة من الموقع من ${name}`,
    summary: (name: string, company: string, type: string) => `حجز ${name}${company ? ` (${company})` : ''} عرضًا توضيحيًا: "${type}".`,
    reminderSummary: (name: string) => `لا يوجد موعد مؤكد بعد للعرض التوضيحي الخاص بـ ${name}، وقد انتهت مهلة الرد.`,
    rows: {
      name: 'الاسم', company: 'الشركة', role: 'المسمى الوظيفي', email: 'البريد الإلكتروني', phone: 'الهاتف / واتساب', tz: 'المنطقة الزمنية', language: 'اللغة',
      sap: 'مجال / وحدة SAP', type: 'العرض', format: 'طريقة الاجتماع', source: 'صفحة المصدر', requested: 'وقت الطلب', when: 'التاريخ والوقت', duration: 'المدة', link: 'رابط الاجتماع',
    },
    langNames: { en: 'الإنجليزية', ar: 'العربية' } as Record<string, string>,
    countryNote: 'لا يسأل النموذج عن الدولة؛ المنطقة الزمنية توضح مكان مقدم الطلب.',
    wantToSee: 'ما يريد رؤيته',
    slotsHeading: 'الوقت المفضل',
    slotMain: (admin: string) => admin,
    slotSub: (req: string, entered: string) => `بتوقيت مقدم الطلب: ${req} · كما أُدخل: ${entered}`,
    proposed: 'مقترح لاحقًا',
    passed: 'مضى وقته',
    noPreference: (pref: string) => `لا يوجد تفضيل: لم يُختر تاريخ أو وقت${pref ? ` (اختار "${pref}")` : ''}. اقترح موعدًا.`,
    todoHeading: 'المطلوب منك',
    todoLine: (h: string) => `أكِّد موعدًا خلال ${h}: هذا ما يعد به الموقع.`,
    respondBy: (when: string, countdown: string) => `الرد قبل ${when} · ${countdown}`,
    duplicate: 'احتمال تكرار: حجز البريد نفسه عرضًا آخر خلال آخر 24 ساعة.',
    open: 'فتح الطلب وتحديد الموعد',
    propose: 'اقتراح موعد',
    reply: 'الرد على مقدم الطلب',
    openContact: 'فتح صفحة الطلبات',
    sent: (at: string) => `أُرسلت تلقائيًا من AI Support 360${at ? ` · ${at}` : ''}`,
    adminWhy: 'تصلك هذه الرسالة لأنك مسؤول في AI Support 360 (حجوزات العروض التوضيحية).',
    adminPrefs: 'إعدادات تنبيهات العروض',
    helpLine: 'لديك سؤال؟ راسلنا على',
    hello: (n: string) => (n ? `مرحبًا ${n}،` : 'مرحبًا،'),
    receivedTitle: 'وصلنا طلب العرض التوضيحي',
    receivedSummary: (h: string) => `سيؤكد فريقنا معك موعدًا خلال ${h}.`,
    receivedBody: 'شكرًا لحجز عرض توضيحي لـ AI Support 360. يمكنك متابعة طلبك واقتراح موعد آخر من صفحة طلبك.',
    confirmedTitle: 'تم تأكيد العرض التوضيحي',
    rescheduledTitle: 'موعد جديد للعرض التوضيحي',
    cancelledTitle: 'تم إلغاء العرض التوضيحي',
    confirmedSummary: (when: string) => `نراك في ${when}.`,
    cancelledSummary: 'لن يُعقد العرض التوضيحي الذي حجزته في الموعد المتفق عليه.',
    badgeConfirmed: 'مؤكد', badgeRescheduled: 'موعد جديد', badgeCancelled: 'ملغى', badgeReceived: 'تم الاستلام',
    teamNote: 'ملاحظة من فريقنا',
    reason: 'السبب',
    linkOnPage: 'في صفحة طلبك (الزر أدناه)',
    linkLater: 'سنضيفه إلى صفحة طلبك قبل العرض',
    todoMeeting: ['أضف العرض إلى تقويمك.', 'في الموعد أعلاه، افتح صفحة طلبك وانضم من هناك.'],
    todoCancelled: ['إذا كنت لا تزال تريد عرضًا توضيحيًا، احجز عرضًا جديدًا أو ردّ على هذا البريد وسنجد موعدًا.'],
    viewMeeting: 'عرض الاجتماع والانضمام',
    viewRequest: 'عرض طلبك',
    addCalendar: 'إضافة إلى التقويم',
    otherTime: 'تحتاج موعدًا آخر؟',
    bookNew: 'احجز عرضًا جديدًا',
    requesterWhy: 'تصلك هذه الرسالة لأنك حجزت عرضًا توضيحيًا على www.aisupport360.com.',
    replyNote: 'يمكنك أيضًا الرد على هذا البريد.',
    preferred: 'الوقت المفضل لديك',
    minutes: (n: number) => `${n} دقيقة`,
  },
};

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max) : '');
const oneLine = (v: unknown, max: number) => clean(v, max).replace(/\s+/g, ' ');

export interface AlertOptions {
  site: string; settings: DemoAlertSettings; now: Date; kind: 'alert' | 'reminder'; reminderNo?: number;
  /** Bell text from the database (dsa_bell_text) so the e-mail summary and the bell say the same. */
  bellText?: string | null; duplicate?: boolean; helpEmail?: string;
}

/** The admin e-mail: new booking ("Demo booked: schedule needed"), a reminder, or a website message (contact form). */
export function buildDemoAlertView(row: DemoRequestRow, o: AlertOptions): DemoEmailView {
  const lang = o.settings.admin_language;
  const c = DEMO_COPY[lang];
  const site = siteBase(o.site);
  const adminTz = o.settings.admin_timezone;
  const name = oneLine(row.full_name, 120) || '—';
  const company = oneLine(row.company, 200);
  const contact = row.source === 'contact-form';
  const type = label(DEMO_TYPE_LABELS, lang, row.demo_type);
  const created = new Date(row.created_at);
  const reqTz = validTz(row.timezone) ? row.timezone : null;
  const mailto = replyMailto(row);
  const help = /^[a-z0-9._+-]+@aisupport360\.com$/i.test(o.helpEmail ?? '') ? o.helpEmail! : 'info@aisupport360.com';
  const rows: DemoEmailView['rows'] = [
    { label: c.rows.name, value: name },
    { label: c.rows.company, value: company },
    { label: c.rows.role, value: oneLine(row.requester_role, 80) },
    { label: c.rows.email, value: oneLine(row.email, 254) },
    { label: c.rows.phone, value: oneLine(row.phone, 30) },
    { label: c.rows.tz, value: oneLine(row.timezone, 64) },
    { label: c.rows.language, value: row.language ? c.langNames[row.language] ?? '' : '' },
    { label: c.rows.sap, value: oneLine(row.sap_area, 120) },
    { label: c.rows.type, value: contact ? '' : type },
    { label: c.rows.format, value: label(FORMAT_LABELS, lang, row.meeting_format) },
    { label: c.rows.source, value: oneLine(row.source, 60) },
    { label: c.rows.requested, value: [formatInZone(created, adminTz, lang), reqTz && reqTz !== adminTz ? formatInZone(created, reqTz, lang) : ''].filter(Boolean).join(' · ') },
  ].filter((r) => r.value);
  const footer = { helpLine: c.helpLine, help, why: c.adminWhy, prefs: c.adminPrefs, prefsUrl: `${site}/admin/demo-requests` };
  const sentLine = c.sent(formatInZone(o.now, adminTz, lang));
  const quote = clean(row.notes, 1500) ? { label: c.wantToSee, text: clean(row.notes, 1500) } : null;

  if (contact) {
    return {
      lang, subject: c.contactSubject(name), preheader: c.contactSubject(name), category: 'notice', title: c.contactTitle,
      summary: `${name}${company ? ` (${company})` : ''}`, paragraphs: [], rows, quote, slots: null, todo: null,
      primary: { label: c.openContact, href: adminDemoUrl(site, row.id) },
      secondary: mailto ? [{ label: c.reply, href: mailto }] : [], sentLine, footer,
    };
  }

  const slots = demoSlots(row, adminTz, lang, o.now);
  const due = row.respond_by ? new Date(row.respond_by) : respondByFor(created, o.settings);
  const countdown = dueWording(due, o.now, lang);
  const reminder = o.kind === 'reminder';
  const summary = reminder ? c.reminderSummary(name) : oneLine(o.bellText, 400) || c.summary(name, company, type);
  const title = reminder ? c.reminderTitle(Math.max(1, o.reminderNo ?? 1)) : c.alertTitle;
  return {
    lang,
    subject: reminder ? c.reminderSubject(name) : c.alertSubject(name, company),
    preheader: `${summary} ${c.respondBy(formatInZone(due, adminTz, lang), countdown.text)}`.slice(0, 200),
    category: reminder ? 'reminder' : 'action',
    badge: o.duplicate ? { text: c.duplicate.split(':')[0], tone: 'changes' } : null,
    title, summary,
    paragraphs: o.duplicate ? [c.duplicate] : [],
    todo: {
      heading: c.todoHeading,
      lines: [c.todoLine(hoursWord(o.settings.respond_business_hours, lang))],
      strong: c.respondBy(formatInZone(due, adminTz, lang), countdown.text),
      overdue: countdown.overdue,
    },
    rows,
    slots: {
      heading: c.slotsHeading,
      items: slots.map((s) => ({
        main: c.slotMain(s.admin || s.asEntered),
        sub: c.slotSub(s.requester || s.asEntered, s.asEntered),
        note: [s.kind === 'proposed' ? c.proposed : '', s.past ? c.passed : ''].filter(Boolean).join(' · ') || undefined,
      })),
      empty: slots.length ? undefined : c.noPreference(label(PREFERENCE_LABELS, lang, row.scheduling_preference)),
    },
    quote,
    primary: { label: c.open, href: adminDemoUrl(site, row.id, 'schedule') },
    secondary: [{ label: c.propose, href: adminDemoUrl(site, row.id, 'propose') }, ...(mailto ? [{ label: c.reply, href: mailto }] : [])],
    sentLine, footer,
  };
}

export type DemoUpdateKind = 'received' | 'confirmed' | 'rescheduled' | 'cancelled';
export interface UpdateOptions { site: string; now: Date; settings?: DemoAlertSettings; note?: string | null; helpEmail?: string }

/** Start of the agreed meeting: the scheduled instant, else the (legacy) confirmed date + slot in the requester's zone. */
export function meetingStart(row: DemoRequestRow): Date | null {
  if (row.meeting_at) { const d = new Date(row.meeting_at); if (!Number.isNaN(d.getTime())) return d; }
  return zonedToUtc(row.scheduled_date, row.scheduled_slot, row.timezone);
}

/** The requester's e-mail in their language and time zone: received, confirmed, rescheduled or cancelled. */
export function buildDemoUpdateView(row: DemoRequestRow, kind: DemoUpdateKind, o: UpdateOptions): DemoEmailView {
  const lang: Lang = row.language === 'ar' ? 'ar' : 'en';
  const c = DEMO_COPY[lang];
  const site = siteBase(o.site);
  const tz = validTz(row.timezone) ? row.timezone : 'UTC';
  const settings = o.settings ?? DEMO_ALERT_DEFAULTS;
  const help = /^[a-z0-9._+-]+@aisupport360\.com$/i.test(o.helpEmail ?? '') ? o.helpEmail! : 'info@aisupport360.com';
  const page = requesterDemoUrl(site, row.request_token);
  const footer = { helpLine: c.helpLine, help, why: c.requesterWhy, replyNote: c.replyNote };
  const sentLine = c.sent(formatInZone(o.now, tz, lang));
  const type = label(DEMO_TYPE_LABELS, lang, row.demo_type);
  const format = label(FORMAT_LABELS, lang, row.meeting_format);
  const note = clean(o.note, 500);
  const hello = c.hello(firstName(row.full_name));

  if (kind === 'received') {
    const slot = demoSlots({ ...row, proposed_slots: null }, tz, lang, o.now)[0];
    const pref = slot ? slot.requester || slot.asEntered : label(PREFERENCE_LABELS, lang, row.scheduling_preference);
    return {
      lang, subject: `${c.receivedTitle} — AI Support 360`, preheader: c.receivedSummary(hoursWord(settings.respond_business_hours, lang)),
      category: 'notice', badge: { text: c.badgeReceived, tone: 'review' }, title: c.receivedTitle,
      summary: c.receivedSummary(hoursWord(settings.respond_business_hours, lang)),
      paragraphs: [hello, c.receivedBody],
      rows: [{ label: c.rows.type, value: type }, { label: c.preferred, value: pref }, { label: c.rows.format, value: format }].filter((r) => r.value),
      quote: null, slots: null, todo: null,
      primary: { label: c.viewRequest, href: page }, secondary: [], sentLine, footer,
    };
  }

  const start = meetingStart(row);
  const when = formatInZone(start, tz, lang);
  const dur = Math.max(15, Math.min(240, Number(row.meeting_duration_min) || settings.default_duration_min));
  if (kind === 'cancelled') {
    const reason = clean(row.cancel_reason, 500) || note;
    return {
      lang, subject: `${c.cancelledTitle} — AI Support 360`, preheader: c.cancelledSummary, category: 'update',
      badge: { text: c.badgeCancelled, tone: 'rejected' }, title: c.cancelledTitle, summary: c.cancelledSummary,
      paragraphs: [hello],
      rows: [{ label: c.rows.type, value: type }, { label: c.rows.when, value: when }].filter((r) => r.value),
      quote: reason ? { label: c.reason, text: reason } : null, slots: null,
      todo: { heading: c.todoHeading, lines: c.todoCancelled },
      primary: { label: c.bookNew, href: `${site}/` }, secondary: [{ label: c.viewRequest, href: page }], sentLine, footer,
    };
  }
  const re = kind === 'rescheduled';
  return {
    lang, subject: `${re ? c.rescheduledTitle : c.confirmedTitle}: ${when} — AI Support 360`, preheader: c.confirmedSummary(when),
    category: 'update', badge: { text: re ? c.badgeRescheduled : c.badgeConfirmed, tone: re ? 'changes' : 'approved' },
    title: re ? c.rescheduledTitle : c.confirmedTitle, summary: c.confirmedSummary(when),
    paragraphs: [hello],
    rows: [
      { label: c.rows.when, value: when },
      { label: c.rows.duration, value: c.minutes(dur) },
      { label: c.rows.type, value: type },
      { label: c.rows.format, value: format },
      { label: c.rows.link, value: safeMeetingLink(row.meeting_link) ? c.linkOnPage : c.linkLater },
    ].filter((r) => r.value),
    quote: note ? { label: c.teamNote, text: note } : null, slots: null,
    todo: { heading: c.todoHeading, lines: c.todoMeeting },
    primary: { label: c.viewMeeting, href: page },
    secondary: [{ label: c.addCalendar, href: requesterDemoUrl(site, row.request_token, '?calendar=1') }, { label: c.otherTime, href: requesterDemoUrl(site, row.request_token, '#reschedule') }],
    sentLine, footer,
  };
}

/** Every link an e-mail view carries (tests: own site or the mailto reply only). */
export const viewLinks = (v: DemoEmailView) => [v.primary.href, ...v.secondary.map((s) => s.href), ...(v.footer.prefsUrl ? [v.footer.prefsUrl] : [])];

export { MESSAGE_COPY };
