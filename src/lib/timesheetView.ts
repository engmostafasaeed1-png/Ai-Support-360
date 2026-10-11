// View helpers of the timesheet screens: the entries in groups, the parts of a day, and the five steps of the progress bar.
// Pure functions without database access. The amounts come from `src/lib/timesheet.ts` (the database calculates them).

import { format } from 'date-fns';
import {
  entryAmount,
  formatHours,
  invoiceInfo,
  num,
  rateText,
  round2,
  type InvoiceRow,
  type RateRow,
  type SubmissionRow,
  type Tone,
  type WorkLogRow,
} from '@/lib/timesheet';

/* ------------------------------------------------------------------ the entries in groups */

export interface EntryGroup {
  /** "open" for the entries that are in no timesheet, else the id of the timesheet */
  key: string;
  /** "open" or the status of the timesheet */
  status: string;
  submission: SubmissionRow | null;
  /** the newest day first */
  entries: WorkLogRow[];
  hours: number;
  billableHours: number;
  /** the amount of the entries whose rate is known (without fees and VAT) */
  amount: number;
}

const newestDayFirst = (a: WorkLogRow, b: WorkLogRow) =>
  b.work_date.localeCompare(a.work_date) || (b.created_at ?? '').localeCompare(a.created_at ?? '');

function makeGroup(key: string, status: string, submission: SubmissionRow | null, entries: WorkLogRow[]): EntryGroup {
  const sorted = [...entries].sort(newestDayFirst);
  let hours = 0;
  let billableHours = 0;
  let amount = 0;
  for (const entry of sorted) {
    hours += num(entry.hours);
    if (entry.billable) billableHours += num(entry.hours);
    amount += entryAmount(entry) ?? 0;
  }
  return { key, status, submission, entries: sorted, hours: round2(hours), billableHours: round2(billableHours), amount: round2(amount) };
}

/**
 * The entries in groups: first the ones that are in no timesheet, then one group per timesheet (the newest timesheet first).
 * An entry of a timesheet that is not known (not loaded) counts as "not in a timesheet". A group without entries is left out.
 */
export function groupEntries(logs: WorkLogRow[], submissions: SubmissionRow[]): EntryGroup[] {
  const known = new Map(submissions.map(s => [s.id, s]));
  const open: WorkLogRow[] = [];
  const bySubmission = new Map<string, WorkLogRow[]>();
  for (const log of logs) {
    if (log.submission_id && known.has(log.submission_id)) {
      const list = bySubmission.get(log.submission_id) ?? [];
      list.push(log);
      bySubmission.set(log.submission_id, list);
    } else {
      open.push(log);
    }
  }
  const groups: EntryGroup[] = [];
  if (open.length > 0) groups.push(makeGroup('open', 'open', null, open));
  const newestFirst = [...submissions].sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const submission of newestFirst) {
    const list = bySubmission.get(submission.id);
    if (list && list.length > 0) groups.push(makeGroup(submission.id, submission.status, submission, list));
  }
  return groups;
}

/* ------------------------------------------------------------------ a day */

export interface DayParts {
  day: string;
  month: string;
  weekday: string;
  year: string;
}

/** "2026-01-01" -> { day: "1", month: "Jan", weekday: "Thu", year: "2026" }. The day is read as a day of the calendar, without a time zone shift. */
export function dayParts(workDate: string | null | undefined): DayParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(workDate ?? '');
  if (!match) return { day: '-', month: '', weekday: '', year: '' };
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const part = (options: Intl.DateTimeFormatOptions) => date.toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
  return { day: String(Number(match[3])), month: part({ month: 'short' }), weekday: part({ weekday: 'short' }), year: match[1] };
}

/* ------------------------------------------------------------------ the five steps */

export type StepState = 'done' | 'current' | 'todo' | 'attention';

export interface ProgressStep {
  key: 'rate' | 'hours' | 'submitted' | 'approved' | 'paid';
  label: string;
  state: StepState;
  detail: string;
}

const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MMM d, yyyy');
};

const newest = <T extends { created_at: string }>(list: T[]): T[] => [...list].sort((a, b) => b.created_at.localeCompare(a.created_at));

/**
 * Where the timesheet of a ticket stands, in five steps: the hourly rate is approved, hours are logged, the timesheet is submitted,
 * the client approved it, the invoice is paid. The steps follow the newest timesheet that was sent.
 */
export function timesheetProgress(input: { rates: RateRow[]; logs: WorkLogRow[]; submissions: SubmissionRow[]; invoices: InvoiceRow[] }): ProgressStep[] {
  const { rates, logs, submissions, invoices } = input;

  // 1. the hourly rate
  const approved = newest(rates.filter(r => r.status === 'approved'));
  const proposed = rates.find(r => r.status === 'proposed') ?? null;
  const declined = rates.find(r => r.status === 'rejected') ?? null;
  const approvedConsultants = new Set(approved.map(r => r.consultant_id)).size;
  let rate: ProgressStep;
  if (approved.length > 0) {
    rate = { key: 'rate', label: 'Rate', state: 'done', detail: approvedConsultants > 1 ? `${approvedConsultants} rates approved` : rateText(approved[0]) };
  } else if (proposed) {
    rate = { key: 'rate', label: 'Rate', state: 'current', detail: 'Waiting for the client' };
  } else if (declined) {
    rate = { key: 'rate', label: 'Rate', state: 'attention', detail: 'Declined, a new rate is needed' };
  } else {
    rate = { key: 'rate', label: 'Rate', state: 'current', detail: 'No rate proposed yet' };
  }

  // 2. the hours
  const totalHours = logs.reduce((sum, l) => sum + num(l.hours), 0);
  const hours: ProgressStep =
    logs.length > 0
      ? { key: 'hours', label: 'Hours', state: 'done', detail: `${formatHours(totalHours)} logged` }
      : { key: 'hours', label: 'Hours', state: rate.state === 'done' ? 'current' : 'todo', detail: 'No hours logged yet' };

  // 3. submitted
  const sent = newest(submissions.filter(s => s.status !== 'draft'));
  const knownIds = new Set(submissions.map(s => s.id));
  const openEntries = logs.filter(l => !l.submission_id || !knownIds.has(l.submission_id));
  let submitted: ProgressStep;
  if (sent.length > 0) {
    submitted = { key: 'submitted', label: 'Submitted', state: 'done', detail: shortDate(sent[0].submitted_at ?? sent[0].created_at) || 'Submitted' };
  } else if (openEntries.length > 0 && rate.state === 'done') {
    submitted = { key: 'submitted', label: 'Submitted', state: 'current', detail: 'Ready to submit' };
  } else {
    submitted = { key: 'submitted', label: 'Submitted', state: 'todo', detail: 'Not submitted yet' };
  }

  // 4. approved (the newest timesheet that was sent)
  const cycle = sent[0] ?? null;
  let approvedStep: ProgressStep;
  if (!cycle) {
    approvedStep = { key: 'approved', label: 'Approved', state: 'todo', detail: 'After the client answers' };
  } else if (cycle.status === 'signed') {
    approvedStep = { key: 'approved', label: 'Approved', state: 'done', detail: shortDate(cycle.signed_at) || 'Approved' };
  } else if (cycle.status === 'changes_requested') {
    approvedStep = { key: 'approved', label: 'Approved', state: 'attention', detail: 'Changes requested' };
  } else {
    approvedStep = { key: 'approved', label: 'Approved', state: 'current', detail: 'Waiting for the client' };
  }

  // 5. paid
  let paid: ProgressStep;
  if (!cycle || cycle.status !== 'signed') {
    paid = { key: 'paid', label: 'Paid', state: 'todo', detail: 'After the approval' };
  } else {
    const invoice = invoices.find(i => i.timesheet_id === cycle.id) ?? null;
    if (invoice) {
      const state: StepState = invoice.status === 'completed' ? 'done' : invoice.status === 'failed' ? 'attention' : 'current';
      paid = { key: 'paid', label: 'Paid', state, detail: invoiceInfo(invoice).label };
    } else if (num(cycle.total_cost) <= 0) {
      paid = { key: 'paid', label: 'Paid', state: 'done', detail: 'Nothing to pay' };
    } else {
      paid = { key: 'paid', label: 'Paid', state: 'todo', detail: 'No invoice yet' };
    }
  }

  return [rate, hours, submitted, approvedStep, paid];
}

/** One short label for the whole progress: what needs attention, what is next, or that everything is done. */
export function progressChip(steps: ProgressStep[]): { label: string; tone: Tone } {
  const attention = steps.find(s => s.state === 'attention');
  if (attention) return { label: attention.detail, tone: 'orange' };
  const current = steps.find(s => s.state === 'current');
  if (current) return { label: current.detail, tone: 'amber' };
  if (steps.length > 0 && steps.every(s => s.state === 'done')) return { label: 'Completed', tone: 'green' };
  return { label: 'Not started', tone: 'muted' };
}

/** The colours of the label of a kind of work. */
export const CATEGORY_COLORS: Record<string, string> = {
  analysis: 'bg-violet-100 text-violet-700',
  development: 'bg-blue-100 text-blue-700',
  testing: 'bg-cyan-100 text-cyan-700',
  meeting: 'bg-amber-100 text-amber-700',
  documentation: 'bg-emerald-100 text-emerald-700',
  support: 'bg-pink-100 text-pink-700',
  other: 'bg-muted text-muted-foreground',
};

/** The colour of the dot of a status in the bar and the list of the summary. */
export const STATUS_DOT: Record<string, string> = {
  open: 'bg-slate-400',
  draft: 'bg-slate-300',
  submitted: 'bg-amber-500',
  changes_requested: 'bg-orange-500',
  signed: 'bg-green-500',
};
