import { describe, it, expect } from 'vitest';
import { slaState, summarize, formatHours, type SlaTicket } from './slaOverview';

const NOW = new Date('2026-10-10T12:00:00Z').getTime();
const base: SlaTicket = {
  id: 't1',
  title: 'Test',
  urgency: 'high',
  status: 'in_progress',
  created_at: '2026-10-10T08:00:00Z',
  sla_response_deadline: '2026-10-10T09:00:00Z',
  sla_deadline: '2026-10-10T20:00:00Z',
  first_response_at: null,
  resolved_at: null,
  sla_breached: false,
};

describe('slaState', () => {
  it('has no state without a deadline', () => {
    expect(slaState({ ...base, sla_deadline: null }, NOW)).toBeNull();
  });
  it('is on track while plenty of time is left', () => {
    expect(slaState(base, NOW)).toBe('on_track');
  });
  it('is at risk in the last quarter of the time', () => {
    expect(slaState({ ...base, sla_deadline: '2026-10-10T13:00:00Z' }, NOW)).toBe('at_risk');
  });
  it('is breached after the deadline', () => {
    expect(slaState({ ...base, sla_deadline: '2026-10-10T11:00:00Z' }, NOW)).toBe('breached');
  });
  it('is breached when the platform flagged it', () => {
    expect(slaState({ ...base, sla_breached: true }, NOW)).toBe('breached');
  });
  it('is met when resolved before the deadline', () => {
    expect(slaState({ ...base, status: 'resolved', resolved_at: '2026-10-10T10:00:00Z' }, NOW)).toBe('met');
  });
  it('is breached when resolved after the deadline', () => {
    expect(slaState({ ...base, status: 'resolved', sla_deadline: '2026-10-10T10:00:00Z', resolved_at: '2026-10-10T11:00:00Z' }, NOW)).toBe('breached');
  });
});

describe('summarize', () => {
  it('measures the averages and the breach rate', () => {
    const tickets: SlaTicket[] = [
      { ...base, id: 'a', first_response_at: '2026-10-10T09:00:00Z', status: 'resolved', resolved_at: '2026-10-10T12:00:00Z' },
      { ...base, id: 'b', first_response_at: '2026-10-10T11:00:00Z', sla_deadline: '2026-10-10T11:30:00Z' },
      { ...base, id: 'c', sla_deadline: null },
    ];
    const s = summarize(tickets, NOW);
    expect(s.tracked).toBe(2);
    expect(s.breached).toBe(1);
    expect(s.breachRate).toBe(50);
    expect(s.firstResponseCount).toBe(2);
    expect(s.avgFirstResponseHours).toBe(2);
    expect(s.resolutionCount).toBe(1);
    expect(s.avgResolutionHours).toBe(4);
  });
  it('returns empty values without tickets', () => {
    const s = summarize([], NOW);
    expect(s.tracked).toBe(0);
    expect(s.breachRate).toBeNull();
    expect(s.avgFirstResponseHours).toBeNull();
    expect(s.avgResolutionHours).toBeNull();
  });
});

describe('formatHours', () => {
  it('formats minutes, hours and days', () => {
    expect(formatHours(0.5)).toBe('30 min');
    expect(formatHours(2)).toBe('2.0 hrs');
    expect(formatHours(72)).toBe('3.0 days');
    expect(formatHours(null)).toBe('—');
  });
});
