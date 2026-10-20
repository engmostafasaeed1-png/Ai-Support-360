import { describe, expect, it } from 'vitest';
import {
  POLICY_DEFAULTS, clientRequestView, responseFit, timingsProblems,
} from '../../supabase/functions/_shared/assignmentPolicy';
import { rankConsultants, type MatchConsultant, type MatchTicket } from '../../supabase/functions/_shared/ticketMatch';

describe('client request card (Feature L)', () => {
  it('a pending request shows the reply deadline countdown', () => {
    const v = clientRequestView({ status: 'pending', response_due_at: '2026-10-21T08:00:00Z' });
    expect(v).toEqual({ kind: 'waiting', deadline: Date.parse('2026-10-21T08:00:00Z') });
  });

  it('an old request without a deadline waits without a countdown', () => {
    expect(clientRequestView({ status: 'pending' })).toEqual({ kind: 'waiting', deadline: null });
  });

  it('No response offers Wait longer once', () => {
    expect(clientRequestView({ status: 'expired', extended_at: null })).toEqual({ kind: 'no_response', canExtend: true });
    expect(clientRequestView({ status: 'expired', extended_at: '2026-10-20T10:00:00Z' })).toEqual({ kind: 'no_response', canExtend: false });
  });

  it('no Wait longer on a closed ticket', () => {
    expect(clientRequestView({ status: 'expired' }, true)).toEqual({ kind: 'no_response', canExtend: false });
  });

  it('answered or withdrawn requests have no actions', () => {
    for (const status of ['accepted', 'rejected', 'withdrawn']) expect(clientRequestView({ status }).kind).toBe('done');
  });
});

describe('admin timings check', () => {
  it('the owner defaults are valid (2 h / 4 h / 24 h, Critical 10 / 20 / 30 min)', () => {
    expect(POLICY_DEFAULTS).toMatchObject({ r1: 120, r2: 240, r3: 1440, expire: 1440, critical_r1: 10, critical_r2: 20, critical_r3: 30, critical_expire: 30, extend: 1440 });
    expect(timingsProblems(POLICY_DEFAULTS)).toEqual([]);
  });

  it('reminders out of order are refused', () => {
    expect(timingsProblems({ ...POLICY_DEFAULTS, r2: 100 })).toEqual(['order']);
    expect(timingsProblems({ ...POLICY_DEFAULTS, r3: 1500 })).toEqual(['order']);
    expect(timingsProblems({ ...POLICY_DEFAULTS, critical_r3: 40 })).toEqual(['critical_order']);
  });

  it('values outside 1 minute to 7 days are refused', () => {
    expect(timingsProblems({ ...POLICY_DEFAULTS, extend: 0 })).toContain('range');
    expect(timingsProblems({ ...POLICY_DEFAULTS, extend: 10_081 })).toContain('range');
    expect(timingsProblems({ ...POLICY_DEFAULTS, hourly_limit: 61 })).toContain('range');
    expect(timingsProblems({ ...POLICY_DEFAULTS, r1: Number.NaN })).toContain('range');
  });
});

describe('response rate in ranking', () => {
  it('unknown rate keeps the reply-speed score', () => {
    expect(responseFit(25, null)).toBe(1);
    expect(responseFit(120, undefined)).toBe(0.5);
  });

  it('a low answered share lowers the response score', () => {
    expect(responseFit(25, 1)).toBe(1);
    expect(responseFit(25, 0.4)).toBeCloseTo(0.7);
  });

  it('of two otherwise identical consultants, the one who often did not reply ranks lower', () => {
    const base: Omit<MatchConsultant, 'id'> = {
      verification_status: 'verified', active: true, languages: ['en'], availability_status: 'available',
      skills: [{ module: 'SAP FI', years: 8 }], rating: 4.5, total_reviews: 10, response_time_minutes: 30, completion_percent: 80,
    };
    const ticket: MatchTicket = { title: 'FB50 posting error', description: 'SAP FI posting fails', sap_module: 'FI', preferred_language: 'en' } as MatchTicket;
    const out = rankConsultants(ticket, [
      { ...base, id: 'a-often-silent', assignment_response_rate: 0.25 },
      { ...base, id: 'b-replies', assignment_response_rate: 1 },
    ]);
    expect(out.ranked.map((r) => r.consultant_id)).toEqual(['b-replies', 'a-often-silent']);
  });
});
