import { describe, expect, it } from 'vitest';
import { dayParts, groupEntries, progressChip, timesheetProgress, type ProgressStep } from './timesheetView';
import type { InvoiceRow, RateRow, SubmissionRow, WorkLogRow } from './timesheet';

const log = (over: Partial<WorkLogRow> = {}): WorkLogRow => ({
  id: 'l1', ticket_id: 't1', consultant_id: 'c1', work_date: '2026-10-09', hours: 1, description: 'Analysis', category: 'support', billable: true,
  hourly_rate: 300, total_cost: 300, submission_id: null, created_at: '2026-10-09T08:00:00Z', ...over,
});
const sub = (over: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: 's1', ticket_id: 't1', submitted_by: 'u1', status: 'submitted', total_hours: 1, billable_hours: 1, total_cost: 300, cost_currency: 'USD', hourly_rate: 300,
  vat_percent: null, vat_amount: null, grand_total: null, submitted_at: '2026-10-09T10:00:00Z', submit_count: 1, signed_at: null, signed_by_name: null,
  created_at: '2026-10-09T10:00:00Z', ...over,
});
const rate = (over: Partial<RateRow> = {}): RateRow => ({
  id: 'r1', ticket_id: 't1', consultant_id: 'c1', hourly_rate: 300, currency: 'USD', status: 'approved', source: 'consultant',
  decided_at: '2026-10-09T09:00:00Z', decision_note: null, created_at: '2026-10-09T08:30:00Z', ...over,
});
const invoice = (over: Partial<InvoiceRow> = {}): InvoiceRow => ({
  id: 'p1', timesheet_id: 's1', invoice_number: 'INV-1', status: 'pending', amount: 396.75, currency: 'USD', due_date: null, paid_at: null, ...over,
});
const states = (steps: ProgressStep[]) => steps.map(s => s.state);

describe('groupEntries', () => {
  it('puts the entries that are in no timesheet first, then one group per timesheet, the newest timesheet first', () => {
    const logs = [log({ id: 'a', submission_id: 's1' }), log({ id: 'b' }), log({ id: 'c', submission_id: 's2' })];
    const subs = [sub({ id: 's1', created_at: '2026-10-01T10:00:00Z' }), sub({ id: 's2', status: 'signed', created_at: '2026-10-05T10:00:00Z' })];
    const groups = groupEntries(logs, subs);
    expect(groups.map(g => g.key)).toEqual(['open', 's2', 's1']);
    expect(groups.map(g => g.status)).toEqual(['open', 'signed', 'submitted']);
    expect(groups[1].submission?.id).toBe('s2');
    expect(groups[0].submission).toBeNull();
  });

  it('adds up the hours, the billable hours and the amounts of a group', () => {
    const logs = [log({ id: 'a', hours: 1 }), log({ id: 'b', hours: 0.5, billable: false, hourly_rate: null, total_cost: 0 })];
    const [group] = groupEntries(logs, []);
    expect(group.hours).toBe(1.5);
    expect(group.billableHours).toBe(1);
    expect(group.amount).toBe(300);
  });

  it('counts an entry that waits for a rate as no amount', () => {
    const [group] = groupEntries([log({ hourly_rate: null, total_cost: null })], []);
    expect(group.hours).toBe(1);
    expect(group.amount).toBe(0);
  });

  it('puts the newest day first inside a group', () => {
    const logs = [log({ id: 'a', work_date: '2026-10-07' }), log({ id: 'b', work_date: '2026-10-09' }), log({ id: 'c', work_date: '2026-10-08' })];
    expect(groupEntries(logs, [])[0].entries.map(e => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('treats an entry of a timesheet that is not known as not submitted', () => {
    const groups = groupEntries([log({ id: 'a', submission_id: 'gone' })], []);
    expect(groups.map(g => g.key)).toEqual(['open']);
    expect(groups[0].entries).toHaveLength(1);
  });

  it('leaves a timesheet without entries out and returns nothing for nothing', () => {
    expect(groupEntries([], [sub()])).toEqual([]);
    expect(groupEntries([], [])).toEqual([]);
  });
});

describe('dayParts', () => {
  it('reads the day, the month, the weekday and the year of a calendar day', () => {
    expect(dayParts('2026-01-01')).toEqual({ day: '1', month: 'Jan', weekday: 'Thu', year: '2026' });
    expect(dayParts('2024-02-29')).toEqual({ day: '29', month: 'Feb', weekday: 'Thu', year: '2024' });
  });

  it('reads only the date of a time stamp', () => {
    expect(dayParts('2026-10-09T23:30:00Z').day).toBe('9');
  });

  it('gives a dash for a value that is not a day', () => {
    expect(dayParts('x').day).toBe('-');
    expect(dayParts('').day).toBe('-');
    expect(dayParts(null).day).toBe('-');
  });
});

describe('timesheetProgress', () => {
  it('starts with the rate when nothing exists', () => {
    const steps = timesheetProgress({ rates: [], logs: [], submissions: [], invoices: [] });
    expect(steps.map(s => s.key)).toEqual(['rate', 'hours', 'submitted', 'approved', 'paid']);
    expect(states(steps)).toEqual(['current', 'todo', 'todo', 'todo', 'todo']);
    expect(steps[0].detail).toBe('No rate proposed yet');
  });

  it('waits for the client when a rate was proposed', () => {
    const steps = timesheetProgress({ rates: [rate({ status: 'proposed' })], logs: [], submissions: [], invoices: [] });
    expect(states(steps)[0]).toBe('current');
    expect(steps[0].detail).toBe('Waiting for the client');
  });

  it('asks for a new rate when the client declined it', () => {
    const steps = timesheetProgress({ rates: [rate({ status: 'rejected' })], logs: [], submissions: [], invoices: [] });
    expect(states(steps)).toEqual(['attention', 'todo', 'todo', 'todo', 'todo']);
  });

  it('moves to the hours when the rate is approved', () => {
    const steps = timesheetProgress({ rates: [rate()], logs: [], submissions: [], invoices: [] });
    expect(states(steps)).toEqual(['done', 'current', 'todo', 'todo', 'todo']);
    expect(steps[0].detail).toBe('300.00 USD per hour');
  });

  it('says that two consultants have an approved rate', () => {
    const steps = timesheetProgress({ rates: [rate(), rate({ id: 'r2', consultant_id: 'c2' })], logs: [], submissions: [], invoices: [] });
    expect(steps[0].detail).toBe('2 rates approved');
  });

  it('is ready to submit when hours are logged and the rate is approved', () => {
    const steps = timesheetProgress({ rates: [rate()], logs: [log()], submissions: [], invoices: [] });
    expect(states(steps)).toEqual(['done', 'done', 'current', 'todo', 'todo']);
    expect(steps[1].detail).toBe('1 h logged');
    expect(steps[2].detail).toBe('Ready to submit');
  });

  it('lets the hours be logged before the rate is approved', () => {
    const steps = timesheetProgress({ rates: [], logs: [log({ hourly_rate: null, total_cost: null })], submissions: [], invoices: [] });
    expect(states(steps)).toEqual(['current', 'done', 'todo', 'todo', 'todo']);
  });

  it('ignores a draft timesheet', () => {
    const steps = timesheetProgress({ rates: [rate()], logs: [log()], submissions: [sub({ status: 'draft' })], invoices: [] });
    expect(states(steps)).toEqual(['done', 'done', 'current', 'todo', 'todo']);
  });

  it('waits for the client when the timesheet was submitted', () => {
    const steps = timesheetProgress({ rates: [rate()], logs: [log({ submission_id: 's1' })], submissions: [sub()], invoices: [] });
    expect(states(steps)).toEqual(['done', 'done', 'done', 'current', 'todo']);
    expect(steps[2].detail).toMatch(/Oct 9, 2026/);
    expect(steps[3].detail).toBe('Waiting for the client');
  });

  it('needs attention when the client asked for changes', () => {
    const steps = timesheetProgress({ rates: [rate()], logs: [log({ submission_id: 's1' })], submissions: [sub({ status: 'changes_requested' })], invoices: [] });
    expect(states(steps)).toEqual(['done', 'done', 'done', 'attention', 'todo']);
    expect(progressChip(steps)).toEqual({ label: 'Changes requested', tone: 'orange' });
  });

  it('waits for the payment when the timesheet is approved and the invoice is open', () => {
    const steps = timesheetProgress({
      rates: [rate()], logs: [log({ submission_id: 's1' })], submissions: [sub({ status: 'signed', signed_at: '2026-10-11T10:00:00Z' })], invoices: [invoice()],
    });
    expect(states(steps)).toEqual(['done', 'done', 'done', 'done', 'current']);
    expect(steps[4].detail).toBe('Waiting for payment');
    expect(progressChip(steps)).toEqual({ label: 'Waiting for payment', tone: 'amber' });
  });

  it('is complete when the invoice is paid', () => {
    const steps = timesheetProgress({
      rates: [rate()], logs: [log({ submission_id: 's1' })], submissions: [sub({ status: 'signed', signed_at: '2026-10-11T10:00:00Z' })], invoices: [invoice({ status: 'completed' })],
    });
    expect(states(steps)).toEqual(['done', 'done', 'done', 'done', 'done']);
    expect(progressChip(steps)).toEqual({ label: 'Completed', tone: 'green' });
  });

  it('needs attention when the payment failed', () => {
    const steps = timesheetProgress({
      rates: [rate()], logs: [log({ submission_id: 's1' })], submissions: [sub({ status: 'signed', signed_at: '2026-10-11T10:00:00Z' })], invoices: [invoice({ status: 'failed' })],
    });
    expect(states(steps)[4]).toBe('attention');
  });

  it('has nothing to pay when an approved timesheet costs nothing', () => {
    const steps = timesheetProgress({
      rates: [rate()], logs: [log({ submission_id: 's1', billable: false, total_cost: 0 })], submissions: [sub({ status: 'signed', total_cost: 0, signed_at: '2026-10-11T10:00:00Z' })], invoices: [],
    });
    expect(steps[4]).toMatchObject({ state: 'done', detail: 'Nothing to pay' });
  });

  it('says that the invoice is missing when an approved timesheet costs money', () => {
    const steps = timesheetProgress({
      rates: [rate()], logs: [log({ submission_id: 's1' })], submissions: [sub({ status: 'signed', signed_at: '2026-10-11T10:00:00Z' })], invoices: [],
    });
    expect(steps[4]).toMatchObject({ state: 'todo', detail: 'No invoice yet' });
  });
});

describe('progressChip', () => {
  it('says that nothing started when there are no steps', () => {
    expect(progressChip([])).toEqual({ label: 'Not started', tone: 'muted' });
  });

  it('puts what needs attention before what is next', () => {
    const steps: ProgressStep[] = [
      { key: 'rate', label: 'Rate', state: 'current', detail: 'Waiting for the client' },
      { key: 'hours', label: 'Hours', state: 'attention', detail: 'Something is wrong' },
    ];
    expect(progressChip(steps).label).toBe('Something is wrong');
  });
});
