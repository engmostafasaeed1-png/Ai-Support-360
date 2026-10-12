import { describe, expect, it } from 'vitest';
import { profileCompleteness } from './profileCompleteness';

describe('profile completeness', () => {
  it('is 0 for an empty profile and lists every item as missing', () => {
    const r = profileCompleteness({});
    expect(r.percent).toBe(0);
    expect(r.done).toBe(0);
    expect(r.total).toBe(14);
    expect(r.items.every((i) => !i.done && i.hint.length > 10)).toBe(true);
  });

  it('is 100 for a full profile', () => {
    const r = profileCompleteness({
      skills_count: 3, sap_roles: ['Functional consultant'], seniority_level: 'senior', total_sap_years: 8, sap_technologies: ['ABAP'],
      industries: ['Mining'], customer_segments: ['Large listed enterprise'], vertical_solutions: ['SAP Mining (mine-to-market, heavy equipment)'],
      localization_countries: ['Egypt'], localization_solutions: ['Egypt e-invoice & e-receipt (ETA)'], project_types: ['Implementation (greenfield)'],
      deployment_experience: ['Hybrid'], project_scale: 'Medium (20-100 people)', work_modes: ['Remote'], working_week: 'Flexible (both)', language_levels: { en: 'Fluent (business)' },
    });
    expect(r.percent).toBe(100);
    expect(r.items.filter((i) => !i.done)).toEqual([]);
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
    expect(profileCompleteness({ skills_count: 1, sap_roles: ['x'], industries: ['y'] }).percent).toBe(21);
  });
});
