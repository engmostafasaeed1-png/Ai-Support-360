/**
 * Who can open "Schedule meeting", why a button is disabled, and the conflict check of a meeting time.
 * Pure rules shared by the schedule-meeting function (server decision), the Schedule meeting dialog and every
 * entry point (ticket header, Sessions & chat tab, Sessions / Video sessions / Messages pages, consultant
 * Messages / Calendar / case page), so a button is never silently dead and screen and server agree.
 */
export type Lang = 'en' | 'ar';
export type ScheduleRole = 'client' | 'consultant' | 'admin';

/** Why a person can not schedule a meeting for a request (null = they can). */
export type ScheduleBlock = 'no_consultant' | 'not_owner' | 'not_assigned' | 'closed' | 'loading';

export interface ScheduleContext {
  role: ScheduleRole;
  /** tickets.consultant_id is set */
  hasConsultant: boolean;
  /** active rows in ticket_assignments */
  activeAssignments: number;
  /** client: the signed-in user is tickets.client_id (a colleague of the same company is not) */
  isOwner?: boolean;
  /** consultant: the signed-in consultant is the ticket's consultant or has an active assignment */
  isAssigned?: boolean;
  status?: string | null;
  loading?: boolean;
}

const CLOSED = ['closed', 'cancelled'];

export function scheduleBlock(c: ScheduleContext): ScheduleBlock | null {
  if (c.loading) return 'loading';
  if (CLOSED.includes(String(c.status ?? '').toLowerCase())) return 'closed';
  if (c.role === 'client' && c.isOwner === false) return 'not_owner';
  if (c.role === 'consultant' && c.isAssigned === false) return 'not_assigned';
  if (!c.hasConsultant && c.activeAssignments <= 0) return 'no_consultant';
  return null;
}

export const SCHEDULE_BLOCK_TEXT: Record<ScheduleBlock, [string, string]> = {
  no_consultant: [
    'Meetings can be scheduled once a consultant is assigned to this request. Send the request to a consultant or accept a bid first.',
    'يمكن جدولة الاجتماعات بعد تعيين مستشار على هذا الطلب. أرسل الطلب إلى مستشار أو اقبل عرضًا أولًا.',
  ],
  not_owner: [
    'Only the person who opened this request can schedule its meetings. Ask them to invite you.',
    'يمكن لمن فتح هذا الطلب فقط جدولة اجتماعاته. اطلب منه دعوتك.',
  ],
  not_assigned: [
    'Only a consultant assigned to this request can schedule its meetings.',
    'يمكن للمستشار المعيّن على هذا الطلب فقط جدولة اجتماعاته.',
  ],
  closed: [
    'This request is closed, so no new meetings can be scheduled.',
    'هذا الطلب مغلق، لذا لا يمكن جدولة اجتماعات جديدة.',
  ],
  loading: ['Checking who is assigned to this request…', 'جارٍ التحقق من المعيّنين على هذا الطلب…'],
};
export const scheduleBlockText = (b: ScheduleBlock, lang: Lang = 'en') => SCHEDULE_BLOCK_TEXT[b][lang === 'ar' ? 1 : 0];

// ---------------------------------------------------------------------------------------------------- conflicts

export interface BusyInterval {
  consultant_id: string;
  start: string;
  end: string;
  kind: 'session' | 'unavailable';
}

/** Overlap of [start, start+duration) with any busy interval of the chosen consultants (touching ends do not overlap). */
export function findConflicts(busy: BusyInterval[], consultantIds: string[], start: Date, durationMinutes: number): BusyInterval[] {
  const from = start.getTime();
  const to = from + Math.max(1, durationMinutes) * 60_000;
  const chosen = new Set(consultantIds);
  return busy.filter((b) => {
    if (!chosen.has(b.consultant_id)) return false;
    const s = new Date(b.start).getTime();
    const e = new Date(b.end).getTime();
    return Number.isFinite(s) && Number.isFinite(e) && s < to && e > from;
  });
}

// ---------------------------------------------------------------------------------------------------- dialog checks

export type FormProblem = 'date' | 'past' | 'participants' | 'link' | 'conflict' | 'external_disabled';

export interface FormState {
  date?: Date | null;
  /** start of the meeting (date + time) */
  startsAt?: Date | null;
  participants: number;
  externalCount?: number;
  externalAllowed?: boolean;
  needsLink?: boolean;
  linkOk?: boolean;
  conflicts?: number;
  now?: Date;
}

/** Every reason the Schedule button is disabled, in the order the person fills the form. */
export function formProblems(f: FormState): FormProblem[] {
  const out: FormProblem[] = [];
  const now = (f.now ?? new Date()).getTime();
  if (!f.date) out.push('date');
  else if (f.startsAt && f.startsAt.getTime() < now - 60_000) out.push('past');
  if (f.participants <= 0) out.push('participants');
  if ((f.externalCount ?? 0) > 0 && f.externalAllowed === false) out.push('external_disabled');
  if (f.needsLink && !f.linkOk) out.push('link');
  if ((f.conflicts ?? 0) > 0) out.push('conflict');
  return out;
}

export const FORM_PROBLEM_TEXT: Record<FormProblem, [string, string]> = {
  date: ['Pick a date.', 'اختر تاريخًا.'],
  past: ['This time has already passed. Pick a later time.', 'هذا الوقت قد مضى. اختر وقتًا لاحقًا.'],
  participants: ['Choose at least one participant.', 'اختر مشاركًا واحدًا على الأقل.'],
  link: ['Paste the meeting link (https://…).', 'الصق رابط الاجتماع (https://…).'],
  conflict: ['A chosen consultant is busy or unavailable at that time. Pick another time.', 'أحد المستشارين المختارين مشغول أو غير متاح في ذلك الوقت. اختر وقتًا آخر.'],
  external_disabled: ['Inviting external e-mail addresses is switched off by the administrator. Remove them to continue.', 'دعوة عناوين بريد خارجية متوقفة من قبل المسؤول. احذفها للمتابعة.'],
};
export const formProblemText = (p: FormProblem, lang: Lang = 'en') => FORM_PROBLEM_TEXT[p][lang === 'ar' ? 1 : 0];

// ---------------------------------------------------------------------------------------------------- time zone

/** "Asia/Riyadh (GMT+3)" for the person's own time zone. */
export function timeZoneLabel(at: Date = new Date(), tz?: string): string {
  let zone = tz;
  try { zone = zone || Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* old browser */ }
  if (!zone) return 'UTC';
  let offset = '';
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    offset = part?.value ?? '';
  } catch { /* shortOffset not supported */ }
  return offset ? `${zone} (${offset})` : zone;
}

/** Admin switch for inviting external e-mail addresses (platform_settings 'meeting_external_invites'): missing = on. */
export function externalInvitesAllowed(value: unknown): boolean {
  return !(value === false || value === 'false' || value === 0 || value === '0');
}
