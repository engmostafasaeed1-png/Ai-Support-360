import { describe, it, expect } from 'vitest';
import { cairoToday, daysBetween, deadlineSummary, payoutDeadline } from './payoutDeadline';

const TODAY = '2026-10-11';

describe('daysBetween', () => {
  it('counts calendar days, also over a month end and backwards', () => {
    expect(daysBetween('2026-10-11', '2026-10-12')).toBe(1);
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysBetween('2026-10-11', '2026-10-11')).toBe(0);
    expect(daysBetween('2026-10-11', '2026-10-08')).toBe(-3);
  });
});

describe('cairoToday', () => {
  it('gives the date in Cairo as YYYY-MM-DD', () => {
    expect(cairoToday(new Date('2026-07-01T12:00:00Z'))).toBe('2026-07-01');
    // late in the evening in UTC it is already the next day in Cairo
    expect(cairoToday(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02');
  });
});

describe('payoutDeadline', () => {
  it('says "Paid" for a paid payout whatever the date', () => {
    expect(payoutDeadline({ status: 'completed', due_by: '2026-01-01' }, TODAY)).toEqual({ days: null, tone: 'done', label: 'Paid' });
  });

  it('counts the days left of an open payout', () => {
    expect(payoutDeadline({ status: 'pending', due_by: '2026-10-16' }, TODAY)).toEqual({ days: 5, tone: 'ok', label: 'Due in 5 days' });
    expect(payoutDeadline({ status: 'processing', due_by: '2026-10-14' }, TODAY)).toEqual({ days: 3, tone: 'soon', label: 'Due in 3 days' });
    expect(payoutDeadline({ status: 'pending', due_by: '2026-10-12' }, TODAY)).toEqual({ days: 1, tone: 'soon', label: 'Due in 1 day' });
  });

  it('says "Due today" on the day', () => {
    expect(payoutDeadline({ status: 'pending', due_by: TODAY }, TODAY)).toEqual({ days: 0, tone: 'soon', label: 'Due today' });
  });

  it('says how late a payout is', () => {
    expect(payoutDeadline({ status: 'pending', due_by: '2026-10-10' }, TODAY)).toEqual({ days: -1, tone: 'overdue', label: 'Overdue by 1 day' });
    expect(payoutDeadline({ status: 'pending', due_by: '2026-10-07' }, TODAY)).toEqual({ days: -4, tone: 'overdue', label: 'Overdue by 4 days' });
  });

  it('keeps a failed payout on the clock, and is calm when there is no date', () => {
    expect(payoutDeadline({ status: 'failed', due_by: '2026-10-09' }, TODAY).tone).toBe('overdue');
    expect(payoutDeadline({ status: 'pending', due_by: null }, TODAY)).toEqual({ days: null, tone: 'ok', label: 'No due date' });
    expect(payoutDeadline({ status: 'pending' }, TODAY).label).toBe('No due date');
  });
});

describe('deadlineSummary', () => {
  it('counts the late payouts and the ones due in the next days, and ignores paid ones', () => {
    const payouts = [
      { status: 'pending', due_by: '2026-10-09' },
      { status: 'failed', due_by: '2026-10-10' },
      { status: 'processing', due_by: '2026-10-11' },
      { status: 'pending', due_by: '2026-10-14' },
      { status: 'pending', due_by: '2026-10-20' },
      { status: 'completed', due_by: '2026-10-01' },
      { status: 'pending', due_by: null },
    ];
    expect(deadlineSummary(payouts, TODAY)).toEqual({ overdue: 2, soon: 2 });
    expect(deadlineSummary(payouts, TODAY, 10)).toEqual({ overdue: 2, soon: 3 });
    expect(deadlineSummary([], TODAY)).toEqual({ overdue: 0, soon: 0 });
  });
});
