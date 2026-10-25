import { describe, expect, it } from 'vitest';
import { emptyTerms, offerPatch, saErrorCode, saProblemList, slaSummary, SA_DEFAULT_SETTINGS, stepIndex, termsProblems, withModel } from './model';
import { platformDefaultBody } from '@/lib/sla/policy';
import { rankConsultants } from '../../../supabase/functions/_shared/ticketMatch';

describe('support agreement form rules', () => {
  it('a fresh draft passes the terms check once it has a name, an area and a rate inside the bounds', () => {
    const t = { ...emptyTerms('payg', '2099-01-01'), name: 'FI support', scope: { ...emptyTerms().scope, modules: ['FI'] } };
    t.rate.hourly_rate = 100;
    expect(termsProblems(t, SA_DEFAULT_SETTINGS, '2098-12-01')).toEqual([]);
  });

  it('switching to the hours bank adds bank defaults and removes capacity', () => {
    const t = withModel(emptyTerms('availability'), 'hours_bank');
    expect(t.bank?.hours_per_month).toBe(20);
    expect(t.capacity_hours_per_week).toBeNull();
  });

  it('a counter-offer only carries the fields that changed', () => {
    const t = emptyTerms('hours_bank', '2099-01-01');
    t.rate.hourly_rate = 100;
    expect(offerPatch(t, { hourly_rate: 100, hours_per_month: 30, notice_days: 30 })).toEqual({ bank: { hours_per_month: 30 } });
    expect(offerPatch(t, { hourly_rate: 90 })).toEqual({ rate: { hourly_rate: 90 } });
  });

  it('the SLA summary lists the exact S1-S4 targets the applicant accepts', () => {
    const s = slaSummary('Gold', 3, platformDefaultBody());
    expect(s.startsWith('Gold (v3): S1: response')).toBe(true);
    expect(s).toContain('S4: response');
  });

  it('database errors map to short codes and problem lists', () => {
    expect(saErrorCode('sa_rate_out_of_bounds: rate_high')).toBe('sa_rate_out_of_bounds');
    expect(saProblemList('sa_terms_invalid: modules,start_past')).toEqual(['modules', 'start_past']);
  });

  it('suspended agreements sit on the Active step; ended ones are past the last step', () => {
    expect(stepIndex('suspended')).toBe(stepIndex('active'));
    expect(stepIndex('terminated')).toBe(6);
  });
});

describe('availability commitments in matching', () => {
  const base = { id: 'a', availability_status: 'available', skills: [{ sap_module: 'FI', proficiency_level: 'expert' }] } as never;
  it('a consultant with half the week reserved by agreements scores lower on availability than a free one', () => {
    const ranked = rankConsultants({ sap_modules: ['FI'] } as never, [
      { ...(base as object), id: 'free' } as never,
      { ...(base as object), id: 'busy', reserved_share: 0.5 } as never,
    ]);
    const free = ranked.find((r: { id: string }) => r.id === 'free') as { score: number };
    const busy = ranked.find((r: { id: string }) => r.id === 'busy') as { score: number };
    expect(free.score).toBeGreaterThan(busy.score);
  });
});
