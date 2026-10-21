/**
 * Feature Y: weekly availability (required profile item), urgent reminders and the "On hold" status.
 * The database (docs/sql/availability-hold.sql) is the only authority: it decides what is missing, the grace deadline,
 * the reminder cadence, hold merging and automatic resume. This module mirrors those rules for the screens, the
 * e-mails and the tests, so the editor, banners, cards and SQL say the same thing.
 */
import { contactDetailsInText } from './assignmentInfo.ts';

export type Lang = 'en' | 'ar';
const pick = (lang: Lang | undefined, en: string, ar: string) => (lang === 'ar' ? ar : en);
/** Left-to-right isolate: keeps "09:00-17:00" and "2026-11-15" in order inside Arabic text (no reversed numbers). */
export const ltr = (text: string) => `\u2066${text}\u2069`;

// ---------------------------------------------------------------------------------------------------- weekly slots

/** One recurring interval: weekday 0 = Sunday … 6 = Saturday, times "HH:MM" (24 h) in the consultant's time zone. */
export interface WeeklyInterval { day: number; start: string; end: string }

export const DAY_SHORT: Record<Lang, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ar: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};
export const DAY_LONG: Record<Lang, string[]> = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ar: DAY_SHORT.ar,
};

export const AVAILABILITY_PRESETS = {
  sun_thu: { days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00', label: ['Sun-Thu 9-17', 'الأحد-الخميس \u20669-17\u2069'] },
  mon_fri: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', label: ['Mon-Fri 9-17', 'الاثنين-الجمعة \u20669-17\u2069'] },
} as const;
export type PresetKey = keyof typeof AVAILABILITY_PRESETS;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (t: string) => TIME.test(t);
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function presetIntervals(key: PresetKey): WeeklyInterval[] {
  const p = AVAILABILITY_PRESETS[key];
  return p.days.map((day) => ({ day, start: p.start, end: p.end }));
}

export function sortIntervals(list: WeeklyInterval[]): WeeklyInterval[] {
  return [...list].sort((a, b) => a.day - b.day || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
}

export type IntervalProblem = 'invalid_time' | 'end_before_start' | 'overlap';
export interface WeeklyProblem { index: number; day: number; code: IntervalProblem }

/** Save rule: every time valid, end after start, no two intervals of the same day overlapping. */
export function validateWeekly(list: WeeklyInterval[]): WeeklyProblem[] {
  const out: WeeklyProblem[] = [];
  list.forEach((s, index) => {
    if (!(s.day >= 0 && s.day <= 6) || !isTime(s.start) || !isTime(s.end)) out.push({ index, day: s.day, code: 'invalid_time' });
    else if (minutes(s.end) <= minutes(s.start)) out.push({ index, day: s.day, code: 'end_before_start' });
  });
  list.forEach((a, i) => {
    if (out.some((p) => p.index === i)) return;
    const clash = list.some((b, j) => j !== i && b.day === a.day && isTime(b.start) && isTime(b.end) && minutes(b.end) > minutes(b.start)
      && minutes(a.start) < minutes(b.end) && minutes(a.end) > minutes(b.start));
    if (clash) out.push({ index: i, day: a.day, code: 'overlap' });
  });
  return out;
}

export const PROBLEM_TEXT: Record<IntervalProblem, [string, string]> = {
  invalid_time: ['Enter a valid time.', 'أدخل وقتًا صحيحًا.'],
  end_before_start: ['The end time must be after the start time.', 'يجب أن يكون وقت الانتهاء بعد وقت البدء.'],
  overlap: ['Two times on the same day overlap.', 'يوجد وقتان متداخلان في اليوم نفسه.'],
};

/** "Copy to all working days": the times of `fromDay` replace the times of every other chosen day. */
export function copyToDays(list: WeeklyInterval[], fromDay: number, days: number[]): WeeklyInterval[] {
  const source = list.filter((s) => s.day === fromDay);
  const targets = new Set(days.filter((d) => d !== fromDay));
  return sortIntervals([...list.filter((s) => !targets.has(s.day)), ...[...targets].flatMap((day) => source.map((s) => ({ ...s, day })))]);
}

export function weeklyMinutes(list: WeeklyInterval[]): number {
  return list.reduce((n, s) => n + (isTime(s.start) && isTime(s.end) ? Math.max(0, minutes(s.end) - minutes(s.start)) : 0), 0);
}
export const weeklyHoursText = (list: WeeklyInterval[]) => {
  const h = Math.round((weeklyMinutes(list) / 60) * 2) / 2;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};

const TZ_AR: Record<string, string> = {
  Riyadh: 'الرياض', Dubai: 'دبي', Cairo: 'القاهرة', Karachi: 'كراتشي', London: 'لندن', Berlin: 'برلين', Kolkata: 'كولكاتا',
  Istanbul: 'إسطنبول', Singapore: 'سنغافورة', Tokyo: 'طوكيو', Sydney: 'سيدني', 'New York': 'نيويورك', Chicago: 'شيكاغو',
  'Los Angeles': 'لوس أنجلوس', 'Kuala Lumpur': 'كوالالمبور', Manila: 'مانيلا', Kuwait: 'الكويت', Qatar: 'قطر', Bahrain: 'البحرين',
  Muscat: 'مسقط', Amman: 'عمّان', Baghdad: 'بغداد', Beirut: 'بيروت',
};
/** "Asia/Riyadh" -> "Riyadh" (Arabic: "الرياض"). */
export function tzCity(tz: string | null | undefined, lang: Lang = 'en'): string {
  const city = String(tz || 'Asia/Riyadh').split('/').pop()!.replace(/_/g, ' ');
  return lang === 'ar' ? TZ_AR[city] ?? city : city;
}

interface DayGroup { days: number[]; times: string }
const timesOf = (list: WeeklyInterval[], day: number) => sortIntervals(list.filter((s) => s.day === day)).map((s) => `${s.start}-${s.end}`).join(', ');

/** Consecutive weekdays (Sunday first) with the same times form one group: Sun-Thu 09:00-17:00. */
export function dayGroups(list: WeeklyInterval[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (let d = 0; d <= 6; d++) {
    const times = timesOf(list, d);
    if (!times) continue;
    const last = groups[groups.length - 1];
    if (last && last.times === times && last.days[last.days.length - 1] === d - 1) last.days.push(d);
    else groups.push({ days: [d], times });
  }
  return groups;
}
const daysLabel = (days: number[], lang: Lang) => {
  const n = DAY_SHORT[lang];
  return days.length === 1 ? n[days[0]] : `${n[days[0]]}-${n[days[days.length - 1]]}`;
};

/** Live summary: "Sun-Thu, 09:00-17:00 Riyadh time, 40 h/week" (several groups joined with " · "). */
export function summarizeWeekly(list: WeeklyInterval[], tz: string | null | undefined, lang: Lang = 'en'): string {
  const groups = dayGroups(list);
  if (!groups.length) return pick(lang, 'No weekly availability yet', 'لا يوجد توفر أسبوعي بعد');
  const city = tzCity(tz, lang);
  const hours = weeklyHoursText(list);
  if (groups.length === 1) {
    const g = groups[0];
    return lang === 'ar'
      ? `${daysLabel(g.days, 'ar')}، ${ltr(g.times)} بتوقيت ${city}، ${hours} ساعة/أسبوع`
      : `${daysLabel(g.days, 'en')}, ${g.times} ${city} time, ${hours} h/week`;
  }
  const parts = groups.map((g) => `${daysLabel(g.days, lang)} ${lang === 'ar' ? ltr(g.times) : g.times}`).join(' · ');
  return lang === 'ar' ? `${parts}، بتوقيت ${city}، ${hours} ساعة/أسبوع` : `${parts}, ${city} time, ${hours} h/week`;
}

const shortTime = (t: string) => (t.endsWith(':00') ? t.slice(0, 2) : t);
/** Card line: "Available Sun-Thu 09-17" (at most two groups, then "…"); null without weekly availability. */
export function shortAvailability(list: WeeklyInterval[], lang: Lang = 'en'): string | null {
  const groups = dayGroups(list);
  if (!groups.length) return null;
  const text = groups.slice(0, 2).map((g) => {
    const day = sortIntervals(list.filter((s) => s.day === g.days[0]));
    const times = day.map((s) => `${shortTime(s.start)}-${shortTime(s.end)}`).join(', ');
    return `${daysLabel(g.days, lang)} ${lang === 'ar' ? ltr(times) : times}`;
  }).join(', ') + (groups.length > 2 ? ' …' : '');
  return lang === 'ar' ? `متاح ${text}` : `Available ${text}`;
}

/** Slots as stored (availability_slots) -> recurring intervals only (one-date slots do not count as weekly availability). */
export function weeklyFromSlots(slots: Array<{ day_of_week: number | null; start_time: string; end_time: string; specific_date?: string | null }>): WeeklyInterval[] {
  return sortIntervals(slots.filter((s) => s.day_of_week != null && !s.specific_date)
    .map((s) => ({ day: Number(s.day_of_week), start: s.start_time.slice(0, 5), end: s.end_time.slice(0, 5) })));
}
export const hasWeeklyAvailability = (list: WeeklyInterval[]) => list.some((s) => isTime(s.start) && isTime(s.end) && minutes(s.end) > minutes(s.start));

/** The profile's "Working week" choice that matches the chosen days, if any. */
export function workingWeekFor(list: WeeklyInterval[]): string | null {
  const days = [...new Set(list.map((s) => s.day))].sort().join(',');
  if (days === '0,1,2,3,4') return 'Sunday to Thursday';
  if (days === '1,2,3,4,5') return 'Monday to Friday';
  if (days === '0,1,2,3,4,5') return 'Flexible (both)';
  return null;
}

// ---------------------------------------------------------------------------------------------------- grace + reminders

export const AVAILABILITY_GRACE_DEFAULT = 7;
export const AVAILABILITY_GRACE_MAX = 90;
/** Every 2 days (44 h, so the 09:00 local window always qualifies), at most 8 times, then weekly (164 h). */
export const AVAILABILITY_REMINDER = { everyHours: 44, max: 8, weeklyHours: 164 } as const;
const H = 3_600_000;
const D = 86_400_000;

export type GraceState = { state: 'ok' } | { state: 'grace'; deadline: number | null; daysLeft: number | null } | { state: 'blocked'; deadline: number };

/** Same rule as availability_grace_deadline_at: later of (grace start, sign-up) + grace days. */
export function availabilityGrace(i: { missing: boolean; required: boolean; graceStartedAt: string | null | undefined; signedUpAt?: string | null; graceDays?: number | null; now: number }): GraceState {
  if (!i.missing || !i.required) return { state: 'ok' };
  const start = i.graceStartedAt ? Date.parse(i.graceStartedAt) : NaN;
  if (!Number.isFinite(start)) return { state: 'grace', deadline: null, daysLeft: null };
  const signed = i.signedUpAt ? Date.parse(i.signedUpAt) : NaN;
  const from = Number.isFinite(signed) ? Math.max(start, signed) : start;
  const days = Math.max(0, Math.min(AVAILABILITY_GRACE_MAX, Math.round(i.graceDays ?? AVAILABILITY_GRACE_DEFAULT)));
  const deadline = from + days * D;
  if (i.now >= deadline) return { state: 'blocked', deadline };
  return { state: 'grace', deadline, daysLeft: Math.ceil((deadline - i.now) / D) };
}

export type ReminderDecision = 'stop' | 'first' | 'wait' | 'due';
/**
 * Mirror of availability_reminder_due: stop when filled, not required or on hold; the first (urgent, essential) notice once;
 * then the highlighted "Urgent" block in the daily profile mail every 2 days for 8 times, then weekly.
 * `lastTouchAt` is the latest of the first notice, reminders and administrator reminders.
 */
export function availabilityReminderDue(i: { required: boolean; missing: boolean; onHold: boolean; firstAt: string | null; reminders: number; lastTouchAt: string | null; now: number }): ReminderDecision {
  if (!i.required || !i.missing || i.onHold) return 'stop';
  if (!i.firstAt) return 'first';
  const last = Date.parse(i.lastTouchAt ?? i.firstAt);
  const gap = (i.reminders < AVAILABILITY_REMINDER.max ? AVAILABILITY_REMINDER.everyHours : AVAILABILITY_REMINDER.weeklyHours) * H;
  return i.now - last >= gap ? 'due' : 'wait';
}

// ---------------------------------------------------------------------------------------------------- hold

export const HOLD_MAX_DAYS_DEFAULT = 90;
export const HOLD_MAX_DAYS_LIMIT = 365;
export const HOLD_MAX_AHEAD_DAYS = 180;
export const HOLD_REASON_MAX = 500;
/** A start a few minutes in the past (the dialog opened a while ago) still counts as "now". */
export const HOLD_PAST_TOLERANCE_MS = 5 * 60_000;

export type HoldProblem = 'end_required' | 'start_invalid' | 'start_in_past' | 'too_far_ahead' | 'end_before_start' | 'end_in_past' | 'too_long' | 'reason_too_long' | 'reason_contact';

export function validateHold(i: { startsAt: string | null | undefined; endsAt: string | null | undefined; now: number; maxDays?: number; reason?: string | null; isNew?: boolean }): HoldProblem[] {
  const out: HoldProblem[] = [];
  const start = i.startsAt ? Date.parse(i.startsAt) : i.now;
  const end = i.endsAt ? Date.parse(i.endsAt) : NaN;
  const max = Math.max(1, Math.min(HOLD_MAX_DAYS_LIMIT, Math.round(i.maxDays ?? HOLD_MAX_DAYS_DEFAULT)));
  if (!Number.isFinite(start)) out.push('start_invalid');
  if (!i.endsAt || !Number.isFinite(end)) out.push('end_required');
  if (Number.isFinite(start) && i.isNew !== false) {
    if (start < i.now - HOLD_PAST_TOLERANCE_MS) out.push('start_in_past');
    if (start > i.now + HOLD_MAX_AHEAD_DAYS * D) out.push('too_far_ahead');
  }
  if (Number.isFinite(start) && Number.isFinite(end)) {
    if (end <= start) out.push('end_before_start');
    else if (end - start > max * D) out.push('too_long');
    if (end <= i.now) out.push('end_in_past');
  }
  const reason = (i.reason ?? '').trim();
  if (reason.length > HOLD_REASON_MAX) out.push('reason_too_long');
  if (reason && contactDetailsInText(reason)) out.push('reason_contact');
  return out;
}

export function holdProblemText(p: HoldProblem, lang: Lang = 'en', maxDays = HOLD_MAX_DAYS_DEFAULT): string {
  const T: Record<HoldProblem, [string, string]> = {
    end_required: ['Choose when the hold ends.', 'اختر موعد انتهاء التوقف المؤقت.'],
    start_invalid: ['Choose a valid start.', 'اختر بداية صحيحة.'],
    start_in_past: ['The start cannot be in the past.', 'لا يمكن أن تكون البداية في الماضي.'],
    too_far_ahead: [`A hold can start at most ${HOLD_MAX_AHEAD_DAYS} days ahead.`, `يمكن أن يبدأ التوقف المؤقت خلال ${HOLD_MAX_AHEAD_DAYS} يومًا كحد أقصى.`],
    end_before_start: ['The end must be after the start.', 'يجب أن تكون النهاية بعد البداية.'],
    end_in_past: ['The end must be in the future.', 'يجب أن تكون النهاية في المستقبل.'],
    too_long: [`A hold can last at most ${maxDays} days.`, `يمكن أن يستمر التوقف المؤقت ${maxDays} يومًا كحد أقصى.`],
    reason_too_long: [`Keep the reason under ${HOLD_REASON_MAX} characters.`, `اجعل السبب أقل من ${HOLD_REASON_MAX} حرف.`],
    reason_contact: ['Please remove contact details (e-mail, phone, links) from the reason.', 'يرجى إزالة بيانات التواصل (البريد أو الهاتف أو الروابط) من السبب.'],
  };
  return T[p][lang === 'ar' ? 1 : 0];
}

export type HoldStatus = 'scheduled' | 'active' | 'ended' | 'cancelled';
export interface HoldRow { id: string; starts_at: string; ends_at: string; status: HoldStatus }

/** Time-based state (the database sweep catches up within 15 minutes; screens never wait for it). */
export function holdState(h: Pick<HoldRow, 'starts_at' | 'ends_at' | 'status'>, now: number): HoldStatus {
  if (h.status === 'cancelled' || h.status === 'ended') return h.status;
  if (Date.parse(h.ends_at) <= now) return 'ended';
  return Date.parse(h.starts_at) > now ? 'scheduled' : 'active';
}

/** Mirror of hold_merge: a new range absorbs every scheduled/active hold it overlaps or touches. */
export function mergeHolds(existing: HoldRow[], next: { starts_at: string; ends_at: string }): { starts_at: string; ends_at: string; merged: string[] } {
  let s = Date.parse(next.starts_at);
  let e = Date.parse(next.ends_at);
  const merged: string[] = [];
  let changed = true;
  const open = existing.filter((h) => h.status === 'scheduled' || h.status === 'active');
  while (changed) {
    changed = false;
    for (const h of open) {
      if (merged.includes(h.id)) continue;
      const hs = Date.parse(h.starts_at), he = Date.parse(h.ends_at);
      if (hs <= e && he >= s) { s = Math.min(s, hs); e = Math.max(e, he); merged.push(h.id); changed = true; }
    }
  }
  return { starts_at: new Date(s).toISOString(), ends_at: new Date(e).toISOString(), merged };
}

const TZ = 'Asia/Riyadh';
/** "1 Nov 2026" (Arabic: "2026-11-01"), Riyadh time - the same text as the database notices (to_char FMDD Mon YYYY). */
export function holdDate(iso: string, lang: Lang = 'en'): string {
  const d = new Date(iso);
  if (lang === 'ar') {
    return ltr(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d));
  }
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(d).replace('Sept', 'Sep');
}

/** Directory / map / cards: "On hold until 15 Nov 2026". */
export const holdLabel = (endsAt: string, lang: Lang = 'en') => pick(lang, `On hold until ${holdDate(endsAt, 'en')}`, `متوقف مؤقتًا حتى ${holdDate(endsAt, 'ar')}`);

/** The short notice for the client of each active ticket (same text as hold_client_notice_text). */
export function clientHoldNotice(startsAt: string, endsAt: string, lang: Lang = 'en'): string {
  return lang === 'ar'
    ? `مستشارك متوقف مؤقتًا من ${holdDate(startsAt, 'ar')} إلى ${holdDate(endsAt, 'ar')}، ويستمر العمل الحالي كما هو متفق عليه.`
    : `Your consultant is on hold from ${holdDate(startsAt, 'en')} to ${holdDate(endsAt, 'en')}, current work continues as agreed.`;
}

export type HoldDirectoryMode = 'label' | 'hide';
export const parseHoldDirectoryMode = (v: unknown): HoldDirectoryMode => (v === 'hide' ? 'hide' : 'label');

/** Directory decision for a consultant on hold: hidden (mode "hide"), or shown with the label and not selectable. */
export function holdDirectoryView(endsAt: string | null | undefined, mode: HoldDirectoryMode, lang: Lang = 'en'): { hidden: boolean; label: string | null; selectable: boolean } {
  if (!endsAt) return { hidden: false, label: null, selectable: true };
  if (mode === 'hide') return { hidden: true, label: null, selectable: false };
  return { hidden: false, label: holdLabel(endsAt, lang), selectable: false };
}
