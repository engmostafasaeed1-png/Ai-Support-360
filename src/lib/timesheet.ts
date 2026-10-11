// Helpers of the timesheet of a ticket: statuses, durations, amounts, the summary and the rate of a consultant.
// Pure functions without database access. The amounts of an entry are calculated by the database (hours x approved rate, 0 when not billable);
// the functions here only add them up and write them down.

import { priceBreakdown, type FeePercents, type PriceBreakdown, type PricingTerms } from '@/lib/pricing';

export interface WorkLogRow {
  id: string;
  ticket_id: string;
  consultant_id: string;
  work_date: string;
  hours: number;
  description: string | null;
  category: string;
  billable: boolean;
  hourly_rate: number | null;
  total_cost: number | null;
  submission_id: string | null;
  created_at?: string;
  consultant_name?: string;
}

export interface SubmissionRow {
  id: string;
  ticket_id: string;
  submitted_by: string;
  status: string;
  total_hours: number | null;
  billable_hours: number | null;
  total_cost: number | null;
  cost_currency: string | null;
  hourly_rate: number | null;
  vat_percent: number | null;
  vat_amount: number | null;
  grand_total: number | null;
  service_fee_percent?: number | null;
  service_fee_amount?: number | null;
  processing_fee_percent?: number | null;
  processing_fee_amount?: number | null;
  submitted_at: string | null;
  submit_count: number | null;
  signed_at: string | null;
  signed_by_name: string | null;
  created_at: string;
}

export interface RateRow {
  id: string;
  ticket_id: string;
  consultant_id: string;
  hourly_rate: number;
  currency: string;
  status: string;
  source: string;
  decided_at: string | null;
  decision_note: string | null;
  /** the hourly rate that the consultant proposed, before the critical reply surcharge was added (only when a surcharge applies) */
  base_rate?: number | null;
  /** the critical reply surcharge in percent that was added to base_rate */
  surcharge_percent?: number | null;
  created_at: string;
}

export interface CommentRow {
  id: string;
  submission_id: string;
  author_id: string;
  author_role: string;
  kind: string;
  body: string;
  created_at: string;
}

export interface InvoiceRow {
  id: string;
  timesheet_id: string | null;
  invoice_number: string | null;
  status: string | null;
  amount: number | null;
  currency: string | null;
  due_date: string | null;
  paid_at: string | null;
}

export type Tone = 'amber' | 'orange' | 'green' | 'muted';

export const STATUS_INFO: Record<string, { label: string; tone: Tone; hint: string }> = {
  draft: { label: 'Draft', tone: 'muted', hint: 'This timesheet was never sent to the client.' },
  submitted: { label: 'Waiting for approval', tone: 'amber', hint: 'The client has to approve this timesheet.' },
  changes_requested: { label: 'Changes requested', tone: 'orange', hint: 'The client asked for changes. Correct the entries and submit the timesheet again.' },
  signed: { label: 'Approved', tone: 'green', hint: 'The client approved this timesheet.' },
};

export function statusInfo(status: string | null | undefined) {
  return STATUS_INFO[status ?? ''] ?? STATUS_INFO.draft;
}

/** A number from the database (numbers can arrive as text); anything else is 0. */
export function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** 1234.5 -> "1,234.50 USD" */
export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
  const value = round2(num(amount));
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || 'USD'}`;
}

/** 3.5 -> "3.5 h", 2 -> "2 h" */
export function formatHours(hours: number | null | undefined): string {
  const value = Math.round(num(hours) * 100) / 100;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} h`;
}

/** 2.25 -> "2 h 15 min", 0.5 -> "30 min", 3 -> "3 h" */
export function formatDuration(hours: number | null | undefined): string {
  const total = Math.round(num(hours) * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0 && m === 0) return '0 min';
  if (m === 0) return `${h} h`;
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
}

export const MINUTE_STEPS = [0, 15, 30, 45];

/** 2.25 -> { hours: 2, minutes: 15 } */
export function splitDuration(hours: number): { hours: number; minutes: number } {
  const total = Math.round(num(hours) * 60);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** 2 h 15 min -> 2.25 */
export function toHours(hours: number, minutes: number): number {
  return round2(num(hours) + num(minutes) / 60);
}

/** The message to show when the duration of an entry is not acceptable, else null (the database allows 0 to 24 hours per entry; the form asks for at least 15 minutes). */
export function durationError(hours: number, minutes: number): string | null {
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || minutes < 0) return 'Enter the time that you worked.';
  const total = hours + minutes / 60;
  if (total < 0.25) return 'The duration must be at least 15 minutes.';
  if (total > 24) return 'The duration can not be more than 24 hours.';
  return null;
}

/** What the client pays for one entry: nothing when it is not billable, unknown (null) while no rate is approved. */
export function entryAmount(log: Pick<WorkLogRow, 'billable' | 'hours' | 'hourly_rate' | 'total_cost'>): number | null {
  if (!log.billable) return 0;
  if (log.total_cost != null) return round2(num(log.total_cost));
  if (log.hourly_rate == null) return null;
  return round2(num(log.hours) * num(log.hourly_rate));
}

export interface Summary {
  entries: number;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  /** billable hours that wait for an approved rate (not in the amounts yet) */
  pendingRateHours: number;
  subtotal: number;
  /** the platform service fee, the payment processing fee and both together (0 until the percentages are known) */
  serviceFee: number;
  processingFee: number;
  fees: number;
  vat: number;
  total: number;
}

export function summarise(logs: WorkLogRow[], vatPercent: number, feePercents?: FeePercents): Summary {
  let totalHours = 0;
  let billableHours = 0;
  let pendingRateHours = 0;
  let subtotal = 0;
  for (const log of logs) {
    const hours = num(log.hours);
    totalHours += hours;
    if (!log.billable) continue;
    billableHours += hours;
    const amount = entryAmount(log);
    if (amount == null) pendingRateHours += hours;
    else subtotal += amount;
  }
  subtotal = round2(subtotal);
  // the same calculation as the database: the fee, the service fee and the processing fee, then the VAT on the sum (without the fee percentages only the VAT is added)
  const price = priceBreakdown(subtotal, {
    serviceFeePercent: num(feePercents?.serviceFeePercent),
    processingFeePercent: num(feePercents?.processingFeePercent),
    vatPercent: feePercents?.vatPercent ?? num(vatPercent),
  });
  const vat = price.vat;
  return {
    entries: logs.length,
    totalHours: round2(totalHours),
    billableHours: round2(billableHours),
    nonBillableHours: round2(totalHours - billableHours),
    pendingRateHours: round2(pendingRateHours),
    subtotal,
    vat,
    serviceFee: price.serviceFee,
    processingFee: price.processingFee,
    fees: price.fees,
    total: price.total,
  };
}

/** The price of a timesheet: the numbers saved with the approval, else the calculation of today (an estimate). A timesheet approved before the fees existed shows only its VAT. */
export function submissionPrice(sub: SubmissionRow, terms: PricingTerms | null, vatFallback: number): PriceBreakdown {
  const fee = round2(num(sub.total_cost));
  if (sub.status === 'signed' && sub.grand_total != null) {
    const serviceFee = round2(num(sub.service_fee_amount));
    const processingFee = round2(num(sub.processing_fee_amount));
    return {
      base: fee,
      serviceFeePercent: num(sub.service_fee_percent),
      serviceFee,
      processingFeePercent: num(sub.processing_fee_percent),
      processingFee,
      fees: round2(serviceFee + processingFee),
      subtotal: round2(fee + serviceFee + processingFee),
      vatPercent: num(sub.vat_percent),
      vat: round2(num(sub.vat_amount)),
      total: round2(num(sub.grand_total)),
    };
  }
  return priceBreakdown(fee, {
    serviceFeePercent: terms?.serviceFeePercent ?? 0,
    processingFeePercent: terms?.processingFeePercent ?? 0,
    vatPercent: terms?.vatPercent ?? num(vatFallback),
  });
}

/** How much of the approved plan is used: null when there is no plan. */
export function planUsage(plannedHours: number | null | undefined, usedHours: number): { percent: number; over: boolean; overBy: number } | null {
  const planned = num(plannedHours);
  if (planned <= 0) return null;
  const used = num(usedHours);
  return { percent: Math.round((used / planned) * 100), over: used > planned + 0.001, overBy: round2(Math.max(0, used - planned)) };
}

/** The entries that are not in any timesheet yet, and the entries of every timesheet. */
export function splitBySubmission(logs: WorkLogRow[]): { notSubmitted: WorkLogRow[]; bySubmission: Record<string, WorkLogRow[]> } {
  const notSubmitted: WorkLogRow[] = [];
  const bySubmission: Record<string, WorkLogRow[]> = {};
  for (const log of logs) {
    if (!log.submission_id) {
      notSubmitted.push(log);
    } else {
      (bySubmission[log.submission_id] ||= []).push(log);
    }
  }
  return { notSubmitted, bySubmission };
}

/** The status of the timesheet that an entry belongs to; "open" when it is in none. */
export function entryStatus(log: Pick<WorkLogRow, 'submission_id'>, submissions: SubmissionRow[]): string {
  if (!log.submission_id) return 'open';
  return submissions.find(s => s.id === log.submission_id)?.status ?? 'open';
}

/** An entry of a timesheet that waits for the client or is approved can not be changed any more. */
export function isLocked(log: Pick<WorkLogRow, 'submission_id'>, submissions: SubmissionRow[]): boolean {
  const status = entryStatus(log, submissions);
  return status === 'submitted' || status === 'signed';
}

export interface RateState {
  approved: RateRow | null;
  proposed: RateRow | null;
  /** the newest rate of the consultant when the client declined it (and nothing is waiting) */
  declined: RateRow | null;
}

export function rateStateFor(rates: RateRow[], consultantId: string | null | undefined): RateState {
  const mine = rates
    .filter(r => r.consultant_id === consultantId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const approved = mine.find(r => r.status === 'approved') ?? null;
  const proposed = mine.find(r => r.status === 'proposed') ?? null;
  const declined = !proposed && mine[0]?.status === 'rejected' ? mine[0] : null;
  return { approved, proposed, declined };
}

/** "50.00 USD per hour" */
export function rateText(rate: Pick<RateRow, 'hourly_rate' | 'currency'> | null | undefined): string {
  if (!rate) return 'not set';
  return `${formatMoney(rate.hourly_rate, rate.currency)} per hour`;
}

/** Why a timesheet can not be submitted now (the same rules as the database), or null when it can. `entries` are the entries that would go into it. */
export function submitBlockReason(entries: WorkLogRow[], waiting: boolean): string | null {
  if (waiting) return 'A timesheet is already waiting for the answer of the client.';
  if (entries.length === 0) return 'There is no new work to submit. Add an entry first.';
  if (entries.some(e => (e.description ?? '').trim().length < 3)) return 'Every entry needs a description.';
  if (entries.some(e => e.billable && e.hourly_rate == null)) return 'Your hourly rate for this ticket has not been approved yet.';
  return null;
}

/** The entries of a consultant that go into the next submission: the ones in no timesheet and the ones of a timesheet that the client sent back. */
export function entriesToSubmit(logs: WorkLogRow[], submissions: SubmissionRow[], consultantId: string | null): WorkLogRow[] {
  if (!consultantId) return [];
  return logs.filter(l => l.consultant_id === consultantId && (!l.submission_id || entryStatus(l, submissions) === 'changes_requested'));
}

export function commentLabel(kind: string): string {
  switch (kind) {
    case 'change_request': return 'asked for changes';
    case 'approval': return 'approved';
    case 'resubmitted': return 'submitted it again';
    default: return 'wrote';
  }
}

export function invoiceInfo(invoice: Pick<InvoiceRow, 'status'>): { label: string; tone: Tone } {
  switch (invoice.status) {
    case 'completed': return { label: 'Paid', tone: 'green' };
    case 'pending': return { label: 'Waiting for payment', tone: 'amber' };
    case 'failed': return { label: 'Payment failed', tone: 'orange' };
    default: return { label: invoice.status ? invoice.status.replace(/_/g, ' ') : 'Invoice', tone: 'muted' };
  }
}

export const CATEGORIES = [
  { value: 'analysis', label: 'Analysis' },
  { value: 'development', label: 'Development' },
  { value: 'testing', label: 'Testing' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'support', label: 'Support' },
  { value: 'other', label: 'Other' },
];

export function categoryLabel(value: string): string {
  return CATEGORIES.find(c => c.value === value)?.label ?? value;
}
