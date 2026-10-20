import { describe, expect, it } from 'vitest';
import { clampInterviewWeight, interviewDoneFrom, profileCompleteness } from './profileCompleteness';

const FULL = {
  country: 'Egypt', city: 'Cairo',
  skills_count: 3, sap_roles: ['Functional consultant'], seniority_level: 'senior', total_sap_years: 8, sap_technologies: ['ABAP'],
  industries: ['Mining'], customer_segments: ['Large listed enterprise'], vertical_solutions: ['SAP Mining (mine-to-market, heavy equipment)'],
  localization_countries: ['Egypt'], localization_solutions: ['Egypt e-invoice & e-receipt (ETA)'], project_types: ['Implementation (greenfield)'],
  deployment_experience: ['Hybrid'], project_scale: 'Medium (20-100 people)', work_modes: ['Remote'], working_week: 'Flexible (both)', language_levels: { en: 'Fluent (business)' },
};

describe('profile completeness', () => {
  it('is 0 for an empty profile and lists every item, including the interview, as missing', () => {
    const r = profileCompleteness({});
    expect(r.percent).toBe(0);
    expect(r.done).toBe(0);
    expect(r.total).toBe(17);
    expect(r.items.every((i) => !i.done && i.hint.length > 10)).toBe(true);
    expect(r.items.find((i) => i.key === 'interview')?.label).toBe('AI interview - not taken');
  });

  it('stops at 85 % when every field is filled but the AI interview was never completed', () => {
    const r = profileCompleteness({ ...FULL, payout_ready: true });
    expect(r.percent).toBe(85);
    expect(r.fieldsPercent).toBe(100);
    expect(r.items.filter((i) => !i.done).map((i) => i.key)).toEqual(['interview']);
  });

  it('is 100 only with a completed AI interview', () => {
    const r = profileCompleteness({ ...FULL, payout_ready: true, interview_done: true });
    expect(r.percent).toBe(100);
    expect(r.items.filter((i) => !i.done)).toEqual([]);
    expect(r.items.find((i) => i.key === 'interview')?.label).toBe('AI interview');
  });

  it('gives a completed interview its full share even with an empty profile', () => {
    expect(profileCompleteness({ interview_done: true }).percent).toBe(15);
  });

  it('uses the admin-set interview share', () => {
    expect(profileCompleteness({ ...FULL, payout_ready: true }, { interviewWeight: 30 }).percent).toBe(70);
    expect(profileCompleteness({ interview_done: true }, { interviewWeight: 30 }).percent).toBe(30);
    expect(clampInterviewWeight(80)).toBe(50);
    expect(clampInterviewWeight(-5)).toBe(0);
    expect(clampInterviewWeight('abc')).toBe(15);
  });

  it('counts a pending session as not taken: only a completion date or an earned badge counts', () => {
    expect(interviewDoneFrom({ ai_interview_completed_at: null, ai_interview_badge: null })).toBe(false);
    expect(interviewDoneFrom({ ai_interview_completed_at: '2026-10-01T10:00:00Z' })).toBe(true);
    expect(interviewDoneFrom({ ai_interview_badge: 'Silver' })).toBe(true);
  });

  it('counts pairs only when both parts are filled and ignores blanks', () => {
    const r = profileCompleteness({ seniority_level: 'senior', total_sap_years: 0, work_modes: ['Remote'], working_week: '  ', industries: [], language_levels: {} });
    expect(r.items.find((i) => i.key === 'seniority')?.done).toBe(false);
    expect(r.items.find((i) => i.key === 'work')?.done).toBe(false);
    expect(r.items.find((i) => i.key === 'industries')?.done).toBe(false);
    expect(r.items.find((i) => i.key === 'languages')?.done).toBe(false);
    expect(r.percent).toBe(0);
  });

  it('rounds the percentage', () => {
    // 3 of 16 fields x 85 % = 15.9 -> 16 %.
    expect(profileCompleteness({ skills_count: 1, sap_roles: ['x'], industries: ['y'] }).percent).toBe(16);
  });

  it('counts the bank details only when saved with the disclaimer acknowledged', () => {
    const missing = profileCompleteness({}).items.find((i) => i.key === 'payout');
    expect(missing?.label).toBe('Bank details for payouts');
    expect(missing?.hint).toBe('Add your bank details to receive payouts');
    expect(missing?.done).toBe(false);
    expect(profileCompleteness({ payout_ready: true }).items.find((i) => i.key === 'payout')?.done).toBe(true);
  });

  it('excludes the payout item for client-facing views so payout status is never exposed', () => {
    const r = profileCompleteness({}, { includePayout: false });
    expect(r.total).toBe(16);
    expect(r.items.some((i) => i.key === 'payout')).toBe(false);
    expect(profileCompleteness(FULL, { includePayout: false }).percent).toBe(85);
    expect(profileCompleteness({ ...FULL, interview_done: true }, { includePayout: false }).percent).toBe(100);
  });

  it('counts the location only when both country and city are set', () => {
    expect(profileCompleteness({ country: 'Egypt' }).items.find((i) => i.key === 'location')?.done).toBe(false);
    expect(profileCompleteness({ city: 'Cairo' }).items.find((i) => i.key === 'location')?.done).toBe(false);
    expect(profileCompleteness({ country: 'Egypt', city: 'Cairo' }).items.find((i) => i.key === 'location')?.done).toBe(true);
    const { country: _c, city: _t, ...noPlace } = FULL;
    expect(profileCompleteness({ ...noPlace, payout_ready: true, interview_done: true }).percent).toBe(95);
  });
});
