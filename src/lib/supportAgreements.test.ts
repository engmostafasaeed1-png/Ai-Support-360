import { describe, expect, it } from 'vitest';
import {
  bankMonth, canTransition, dailyStatus, feeExample, inactive, normalizeSaSettings, rateBounds, rateChangeEffectiveOk, rateProblems,
  renewalRemindersDue, reservedShare, settlementBase, terminationEnd, termsProblems, ticketRate, canonicalJson, SA_DEFAULT_SETTINGS, type BankTerms, type SaTerms,
} from '../../supabase/functions/_shared/supportAgreements';

const bank = (o: Partial<BankTerms> = {}): BankTerms => ({ hours_per_month: 40, rollover: 'none', rollover_hours: 0, rollover_months: 0, unused: 'charge', overage_rate: null, ...o });

describe('hours bank (rollover / overage)', () => {
  it('no rollover: unused committed hours are invoiced at month end (client pays the committed hours)', () => {
    const m = bankMonth('2026-11', [], 25, bank());
    expect(m).toMatchObject({ expired_hours: 15, charge_hours: 15, overage_hours: 0, carried_out: [] });
    expect(settlementBase(m, 100, null)).toBe(1500); // 25 h billed by timesheets + 15 h settlement = 40 h
  });
  it('usage above the bank is overage; with an overage rate only the difference is settled', () => {
    const m = bankMonth('2026-11', [], 50, bank({ overage_rate: 120 }));
    expect(m).toMatchObject({ expired_hours: 0, overage_hours: 10 });
    expect(settlementBase(m, 100, 120)).toBe(200);
  });
  it('rollover up to N hours: only this month\'s unused hours move, capped', () => {
    const m = bankMonth('2026-11', [], 25, bank({ rollover: 'hours', rollover_hours: 10 }));
    expect(m.carried_out).toEqual([{ month: '2026-11', hours: 10 }]);
    expect(m.charge_hours).toBe(5);
    // Next month the carried 10 h are used first; unused carried hours then expire (they are not carried twice).
    const n = bankMonth('2026-12', m.carried_out, 5, bank({ rollover: 'hours', rollover_hours: 10 }));
    expect(n.available).toBe(50);
    expect(n.carried_out).toEqual([{ month: '2026-12', hours: 10 }]);
    expect(n.expired_hours).toBe(35); // 5 carried left + 30 of this month above the cap
  });
  it('rollover N months: oldest hours are used first and expire after N months', () => {
    const t = bank({ rollover: 'months', rollover_months: 2 });
    const a = bankMonth('2026-10', [], 30, t); // 10 left from Oct
    expect(a.carried_out).toEqual([{ month: '2026-10', hours: 10 }]);
    const b = bankMonth('2026-11', a.carried_out, 35, t); // uses 10 Oct + 25 Nov, 15 Nov left
    expect(b.carried_out).toEqual([{ month: '2026-11', hours: 15 }]);
    expect(b.expired_hours).toBe(0);
    const c = bankMonth('2026-12', b.carried_out, 0, t); // Nov hours are 2 months old in Dec -> kept; Dec 40 kept
    const d = bankMonth('2027-01', c.carried_out, 0, t); // Nov hours expire now (3rd month)
    expect(d.expired_hours).toBe(15);
  });
  it('forfeit drops expired hours without charge', () => {
    expect(bankMonth('2026-11', [], 0, bank({ unused: 'forfeit' }))).toMatchObject({ expired_hours: 40, charge_hours: 0 });
  });
});

describe('rates', () => {
  const s = { ...SA_DEFAULT_SETTINGS, rate_caps: { FI: { min: 50, max: 200 } } };
  it('bounds: the strictest module cap applies', () => {
    expect(rateBounds(s, ['FI', 'MM'])).toEqual({ min: 50, max: 200 });
    expect(rateProblems({ hourly_rate: 40 }, s, ['FI'])).toContain('rate_low');
    expect(rateProblems({ hourly_rate: 250 }, s, ['FI'])).toContain('rate_high');
    expect(rateProblems({ hourly_rate: 100, s1_multiplier: 3 }, s, ['FI'])).toContain('multiplier');
    expect(rateProblems({ hourly_rate: 100, overage_rate: 90 }, s, ['FI'])).toContain('overage_low');
  });
  it('S1 critical tickets use the agreed multiplier instead of +30 %', () => {
    expect(ticketRate({ hourly_rate: 100, s1_multiplier: 1.2 }, true)).toBe(120);
    expect(ticketRate({ hourly_rate: 100, s1_multiplier: 1.2 }, false)).toBe(100);
  });
  it('rate changes are never retroactive', () => {
    expect(rateChangeEffectiveOk('2026-10-25', '2026-10-25')).toBe(false);
    expect(rateChangeEffectiveOk('2026-11-01', '2026-10-25')).toBe(true);
  });
});

describe('lifecycle', () => {
  it('state machine allows only the agreed path', () => {
    expect(canTransition('negotiating', 'agreed')).toBe(true);
    expect(canTransition('open', 'active')).toBe(false);
    expect(canTransition('terminated', 'active')).toBe(false);
    expect(canTransition('suspended', 'active')).toBe(true);
  });
  it('renewal reminders at 60/30/7 days, auto-renew extends, otherwise expires', () => {
    expect(renewalRemindersDue('2026-12-31', '2026-12-01', [60, 30, 7])).toEqual([30]);
    const base = { status: 'active' as const, end_date: '2026-12-31', auto_renew: false, renew_months: 12, termination_end: null };
    expect(dailyStatus(base, '2026-11-01', 60).status).toBe('renewal_due');
    expect(dailyStatus({ ...base, status: 'renewal_due' }, '2027-01-01', 60).status).toBe('expired');
    expect(dailyStatus({ ...base, status: 'renewal_due', auto_renew: true }, '2027-01-01', 60)).toMatchObject({ status: 'active', end_date: '2027-12-31' });
  });
  it('termination respects the notice period (capped at the term end)', () => {
    expect(terminationEnd('2026-10-25', 30, null)).toBe('2026-11-24');
    expect(terminationEnd('2026-10-25', 30, '2026-11-10')).toBe('2026-11-10');
    const s = dailyStatus({ status: 'active', end_date: null, auto_renew: false, renew_months: 0, termination_end: '2026-11-24' }, '2026-11-25', 60);
    expect(s.status).toBe('terminated');
  });
  it('bypass alert after N weeks without activity', () => {
    expect(inactive(null, '2026-09-01', '2026-10-13', 6)).toBe(true);
    expect(inactive('2026-10-01', '2026-09-01', '2026-10-13', 6)).toBe(false);
  });
});

describe('terms, fees, settings', () => {
  const terms: SaTerms = {
    name: 'FI support 2027', scope: { modules: ['FI'], versions: ['S/4HANA 2023'], systems: ['PRD'], covered: 'Incidents', not_covered: 'Projects' },
    term: { start_date: '2026-11-01', end_date: '2027-10-31', notice_days: 30, auto_renew: false, renew_months: 12 },
    model: 'hours_bank', bank: bank(), capacity_hours_per_week: null,
    rate: { hourly_rate: 100, currency: 'USD', s1_multiplier: 1.2, ooh_multiplier: null, overage_rate: null },
    sla: { policy_id: null, version: null, summary: '' }, reporting: 'monthly', language: 'en', timezone: 'Asia/Riyadh', nda_required: true, team: [],
  };
  it('valid terms have no problems; past start, short term and disabled models are refused', () => {
    expect(termsProblems(terms, SA_DEFAULT_SETTINGS, '2026-10-25')).toEqual([]);
    expect(termsProblems({ ...terms, term: { ...terms.term, start_date: '2026-10-01' } }, SA_DEFAULT_SETTINGS, '2026-10-25')).toContain('start_past');
    expect(termsProblems({ ...terms, term: { ...terms.term, end_date: '2026-11-15' } }, SA_DEFAULT_SETTINGS, '2026-10-25')).toContain('term_short');
    expect(termsProblems(terms, { ...SA_DEFAULT_SETTINGS, models_enabled: ['payg'] }, '2026-10-25')).toContain('model_disabled');
  });
  it('canonical JSON ignores key order (same hash for both parties)', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
  it('pricing v2 example: 40 h x 100 + 10 % + 5 % + 15 % VAT = 5,290; with an 8 % portal fee = 5,198', () => {
    expect(feeExample(4000, 10)).toEqual({ base: 4000, service_fee: 400, processing_fee: 200, subtotal: 4600, vat: 690, total: 5290 });
    expect(feeExample(4000, 8).total).toBe(5198);
  });
  it('settings default OFF with admin review ON and the same portal fee as today', () => {
    const s = normalizeSaSettings({});
    expect([s.enabled, s.needs_admin_review, s.service_fee_percent, s.draft_legal_flag]).toEqual([false, true, null, true]);
    expect(reservedShare(20)).toBe(0.5);
  });
});
