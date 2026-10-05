import { describe, it, expect } from 'vitest';
import {
  statusInfo, num, round2, formatMoney, formatHours, formatDuration, splitDuration, toHours, durationError,
  entryAmount, summarise, planUsage, splitBySubmission, entryStatus, isLocked, rateStateFor, rateText,
  submitBlockReason, entriesToSubmit, commentLabel, invoiceInfo, categoryLabel,
  type WorkLogRow, type SubmissionRow, type RateRow,
} from './timesheet';

const log = (over: Partial<WorkLogRow> = {}): WorkLogRow => ({
  id: 'l1', ticket_id: 't', consultant_id: 'c1', work_date: '2026-10-01', hours: 1, description: 'Analysis of the error',
  category: 'analysis', billable: true, hourly_rate: 50, total_cost: 50, submission_id: null, ...over,
});
const sub = (over: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: 's1', ticket_id: 't', submitted_by: 'u1', status: 'submitted', total_hours: 1, billable_hours: 1, total_cost: 50, cost_currency: 'USD',
  hourly_rate: 50, vat_percent: null, vat_amount: null, grand_total: null, submitted_at: null, submit_count: 1, signed_at: null, signed_by_name: null,
  created_at: '2026-10-01T10:00:00Z', ...over,
});
const rate = (over: Partial<RateRow> = {}): RateRow => ({
  id: 'r1', ticket_id: 't', consultant_id: 'c1', hourly_rate: 50, currency: 'USD', status: 'approved', source: 'consultant',
  decided_at: null, decision_note: null, created_at: '2026-10-01T10:00:00Z', ...over,
});

describe('statuses', () => {
  it('names the four statuses for people', () => {
    expect(statusInfo('submitted').label).toBe('Waiting for approval');
    expect(statusInfo('changes_requested').label).toBe('Changes requested');
    expect(statusInfo('signed').label).toBe('Approved');
    expect(statusInfo('draft').label).toBe('Draft');
  });
  it('treats an unknown or empty status as a draft', () => {
    expect(statusInfo('whatever').label).toBe('Draft');
    expect(statusInfo(null).label).toBe('Draft');
  });
});

describe('numbers and texts', () => {
  it('reads numbers that arrive as text and ignores everything else', () => {
    expect(num('12.5')).toBe(12.5);
    expect(num(7)).toBe(7);
    expect(num(null)).toBe(0);
    expect(num('abc')).toBe(0);
    expect(num(undefined)).toBe(0);
  });
  it('rounds to cents', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.499)).toBe(2.5);
  });
  it('writes money with two decimals and the currency', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('1,234.50 USD');
    expect(formatMoney(null, 'EUR')).toBe('0.00 EUR');
    expect(formatMoney(5)).toBe('5.00 USD');
  });
  it('writes hours', () => {
    expect(formatHours(3.5)).toBe('3.5 h');
    expect(formatHours(2)).toBe('2 h');
    expect(formatHours(1.256)).toBe('1.26 h');
    expect(formatHours(null)).toBe('0 h');
  });
  it('writes a duration in hours and minutes', () => {
    expect(formatDuration(2.25)).toBe('2 h 15 min');
    expect(formatDuration(0.5)).toBe('30 min');
    expect(formatDuration(3)).toBe('3 h');
    expect(formatDuration(1.75)).toBe('1 h 45 min');
    expect(formatDuration(0)).toBe('0 min');
  });
});

describe('durations', () => {
  it('splits and joins hours and minutes', () => {
    expect(splitDuration(2.25)).toEqual({ hours: 2, minutes: 15 });
    expect(splitDuration(0.25)).toEqual({ hours: 0, minutes: 15 });
    expect(toHours(2, 15)).toBe(2.25);
    expect(toHours(0, 45)).toBe(0.75);
  });
  it('accepts 15 minutes up to 24 hours', () => {
    expect(durationError(0, 15)).toBeNull();
    expect(durationError(24, 0)).toBeNull();
    expect(durationError(8, 30)).toBeNull();
  });
  it('refuses nothing, too little, too much and nonsense', () => {
    expect(durationError(0, 0)).toMatch(/at least 15 minutes/);
    expect(durationError(24, 15)).toMatch(/more than 24 hours/);
    expect(durationError(-1, 0)).toMatch(/Enter the time/);
    expect(durationError(Number.NaN, 0)).toMatch(/Enter the time/);
  });
});

describe('amounts and the summary', () => {
  it('an entry that is not billable costs nothing', () => {
    expect(entryAmount(log({ billable: false, total_cost: 0 }))).toBe(0);
    expect(entryAmount(log({ billable: false, hourly_rate: null, total_cost: null }))).toBe(0);
  });
  it('uses the amount of the database, else hours x rate, and is unknown without a rate', () => {
    expect(entryAmount(log({ hours: 1.5, total_cost: 75 }))).toBe(75);
    expect(entryAmount(log({ hours: 2, hourly_rate: 50, total_cost: null }))).toBe(100);
    expect(entryAmount(log({ hourly_rate: null, total_cost: null }))).toBeNull();
  });
  it('adds up hours and billable money, leaves out hours that wait for a rate, and adds the VAT', () => {
    const logs = [
      log({ id: 'a', hours: 2, hourly_rate: 50, total_cost: 100 }),
      log({ id: 'b', hours: 1, billable: false, total_cost: 0 }),
      log({ id: 'c', hours: 1.5, hourly_rate: 50, total_cost: 75 }),
      log({ id: 'd', hours: 1, hourly_rate: null, total_cost: null }),
    ];
    expect(summarise(logs, 14)).toEqual({
      entries: 4, totalHours: 5.5, billableHours: 4.5, nonBillableHours: 1, pendingRateHours: 1, subtotal: 175, vat: 24.5, total: 199.5,
    });
  });
  it('is all zero for no entries', () => {
    expect(summarise([], 14)).toEqual({ entries: 0, totalHours: 0, billableHours: 0, nonBillableHours: 0, pendingRateHours: 0, subtotal: 0, vat: 0, total: 0 });
  });
  it('rounds the VAT to cents', () => {
    expect(summarise([log({ hours: 1, hourly_rate: 33.33, total_cost: 33.33 })], 14).vat).toBe(4.67);
  });
});

describe('the plan', () => {
  it('has no usage without a plan', () => {
    expect(planUsage(0, 5)).toBeNull();
    expect(planUsage(null, 5)).toBeNull();
  });
  it('shows how much of the plan is used and when it is over', () => {
    expect(planUsage(10, 7.5)).toEqual({ percent: 75, over: false, overBy: 0 });
    expect(planUsage(10, 12)).toEqual({ percent: 120, over: true, overBy: 2 });
    expect(planUsage(10, 10)).toEqual({ percent: 100, over: false, overBy: 0 });
  });
});

describe('entries and timesheets', () => {
  const submissions = [sub({ id: 's1', status: 'submitted' }), sub({ id: 's2', status: 'signed' }), sub({ id: 's3', status: 'changes_requested' })];
  it('splits the entries by timesheet', () => {
    const logs = [log({ id: 'a' }), log({ id: 'b', submission_id: 's1' }), log({ id: 'c', submission_id: 's1' }), log({ id: 'd', submission_id: 's2' })];
    const { notSubmitted, bySubmission } = splitBySubmission(logs);
    expect(notSubmitted.map(l => l.id)).toEqual(['a']);
    expect(bySubmission.s1.map(l => l.id)).toEqual(['b', 'c']);
    expect(bySubmission.s2.map(l => l.id)).toEqual(['d']);
  });
  it('knows the status of the timesheet of an entry', () => {
    expect(entryStatus(log(), submissions)).toBe('open');
    expect(entryStatus(log({ submission_id: 's2' }), submissions)).toBe('signed');
    expect(entryStatus(log({ submission_id: 'unknown' }), submissions)).toBe('open');
  });
  it('locks the entries of a waiting or approved timesheet only', () => {
    expect(isLocked(log(), submissions)).toBe(false);
    expect(isLocked(log({ submission_id: 's1' }), submissions)).toBe(true);
    expect(isLocked(log({ submission_id: 's2' }), submissions)).toBe(true);
    expect(isLocked(log({ submission_id: 's3' }), submissions)).toBe(false);
  });
  it('takes into the next submission the open entries and those of a timesheet that was sent back', () => {
    const logs = [
      log({ id: 'a' }),
      log({ id: 'b', submission_id: 's3' }),
      log({ id: 'c', submission_id: 's1' }),
      log({ id: 'd', submission_id: 's2' }),
      log({ id: 'e', consultant_id: 'c2' }),
    ];
    expect(entriesToSubmit(logs, submissions, 'c1').map(l => l.id)).toEqual(['a', 'b']);
    expect(entriesToSubmit(logs, submissions, null)).toEqual([]);
  });
});

describe('the rate of a consultant', () => {
  it('finds the approved rate and the proposal that waits', () => {
    const rates = [
      rate({ id: 'old', status: 'replaced', created_at: '2026-10-01T09:00:00Z' }),
      rate({ id: 'ok', status: 'approved', created_at: '2026-10-01T10:00:00Z' }),
      rate({ id: 'new', status: 'proposed', hourly_rate: 60, created_at: '2026-10-02T10:00:00Z' }),
      rate({ id: 'other', consultant_id: 'c2', status: 'approved' }),
    ];
    const state = rateStateFor(rates, 'c1');
    expect(state.approved?.id).toBe('ok');
    expect(state.proposed?.id).toBe('new');
    expect(state.declined).toBeNull();
  });
  it('shows a declined rate only when nothing waits and it is the newest', () => {
    const declined = rate({ id: 'no', status: 'rejected', decision_note: 'Too high', created_at: '2026-10-03T10:00:00Z' });
    expect(rateStateFor([rate({ id: 'ok' }), declined], 'c1').declined?.id).toBe('no');
    expect(rateStateFor([declined, rate({ id: 'p', status: 'proposed', created_at: '2026-10-04T10:00:00Z' })], 'c1').declined).toBeNull();
    expect(rateStateFor([], 'c1')).toEqual({ approved: null, proposed: null, declined: null });
  });
  it('writes a rate', () => {
    expect(rateText(rate())).toBe('50.00 USD per hour');
    expect(rateText(null)).toBe('not set');
  });
});

describe('when a timesheet can be submitted', () => {
  it('is fine with described entries that have a rate', () => {
    expect(submitBlockReason([log()], false)).toBeNull();
  });
  it('is fine for hours that are not billable even without a rate', () => {
    expect(submitBlockReason([log({ billable: false, hourly_rate: null, total_cost: 0 })], false)).toBeNull();
  });
  it('waits while a timesheet waits for the client', () => {
    expect(submitBlockReason([log()], true)).toMatch(/already waiting/);
  });
  it('needs at least one entry', () => {
    expect(submitBlockReason([], false)).toMatch(/Add an entry/);
  });
  it('needs a description on every entry', () => {
    expect(submitBlockReason([log({ description: ' ab ' })], false)).toMatch(/description/);
    expect(submitBlockReason([log({ description: null })], false)).toMatch(/description/);
  });
  it('needs an approved rate for billable hours', () => {
    expect(submitBlockReason([log({ hourly_rate: null, total_cost: null })], false)).toMatch(/not been approved/);
  });
});

describe('labels', () => {
  it('names the kinds of comments', () => {
    expect(commentLabel('change_request')).toBe('asked for changes');
    expect(commentLabel('approval')).toBe('approved');
    expect(commentLabel('resubmitted')).toBe('submitted it again');
    expect(commentLabel('comment')).toBe('wrote');
  });
  it('names the state of an invoice', () => {
    expect(invoiceInfo({ status: 'completed' })).toEqual({ label: 'Paid', tone: 'green' });
    expect(invoiceInfo({ status: 'pending' })).toEqual({ label: 'Waiting for payment', tone: 'amber' });
    expect(invoiceInfo({ status: 'refunded' }).label).toBe('refunded');
    expect(invoiceInfo({ status: null }).label).toBe('Invoice');
  });
  it('names the categories', () => {
    expect(categoryLabel('analysis')).toBe('Analysis');
    expect(categoryLabel('something')).toBe('something');
  });
});
