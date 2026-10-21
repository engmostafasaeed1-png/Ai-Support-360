import { describe, expect, it } from 'vitest';
import { buildChecklist, parseMissingRequired, POLICY_ITEM, requiredFieldsCleared, sectionOf, submissionState } from './profileSubmission';

const label = (k: string) => k;

describe('required-items checklist (Feature V)', () => {
  it('lists the server\'s missing items in screen order with counts per section', () => {
    const c = buildChecklist(['cv', 'bio', POLICY_ITEM, 'country'], 17, label);
    expect(c.missing.map((m) => m.key)).toEqual(['bio', 'country', 'cv', POLICY_ITEM]);
    expect(c.left).toBe(4);
    expect(c.total).toBe(17);
    expect(c.complete).toBe(false);
    expect(c.bySection).toEqual({ 'profile-details': 2, experience: 1, 'service-policy': 1 });
  });

  it('is complete (100 %) when nothing is missing', () => {
    const c = buildChecklist([], 17, label);
    expect(c.complete).toBe(true);
    expect(c.percent).toBe(100);
  });

  it('follows an admin rule change: the list is whatever the server now reports', () => {
    const before = buildChecklist(['bio', 'linkedin_url'], 20, label);
    // The admin made LinkedIn optional and GitHub required.
    const after = buildChecklist(['bio', 'github_url'], 20, label);
    expect(before.missing.map((m) => m.key)).toContain('linkedin_url');
    expect(after.missing.map((m) => m.key)).toEqual(['bio', 'github_url']);
  });

  it('never shows fewer required items than are missing', () => {
    expect(buildChecklist(['bio', 'cv'], 0, label).total).toBe(2);
  });

  it('bank details count only because the admin rules make them required (payout section)', () => {
    expect(sectionOf('bank_details')).toBe('payout-details');
    expect(buildChecklist([], 5, label).missing).toEqual([]);
  });
});

describe('server rejection', () => {
  it('reads the list of missing items from the error', () => {
    expect(parseMissingRequired('missing_required:bio,cv,service_policy')).toEqual(['bio', 'cv', 'service_policy']);
    expect(parseMissingRequired('permission denied')).toBeNull();
  });
});

describe('draft status', () => {
  it('a draft is never "finished"', () => {
    expect(submissionState(null, 'pending')).toBe('draft');
    expect(submissionState('2026-10-21T10:00:00Z', 'pending')).toBe('submitted');
    expect(submissionState(null, 'verified')).toBe('verified');
  });
});

describe('draft saving rule', () => {
  const fields = { displayName: 'display_name', bio: 'bio', hourlyRate: 'hourly_rate', githubUrl: 'github_url' };
  const required = (f: string) => ['display_name', 'bio', 'hourly_rate'].includes(f);

  it('a partial draft saves: required fields that were never filled are not in the change and do not block', () => {
    expect(requiredFieldsCleared({ displayName: 'Mona Ali' }, fields, required)).toEqual([]);
  });

  it('emptying a required field that had a value is refused and named (no data wiped)', () => {
    expect(requiredFieldsCleared({ bio: '   ', hourlyRate: 0, githubUrl: '' }, fields, required)).toEqual(['bio', 'hourly_rate']);
  });
});
