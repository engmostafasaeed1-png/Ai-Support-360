import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  achievementErrorKey, achievementProblems, achievementWarnings, platformAchievements, referenceUrlOk, storyFacets, topAchievements,
  type Achievement, type AchievementInput,
} from './achievements';
import { ROLE_DETAIL_SPEC, cleanRoleDetails, fieldAppliesToRoles } from './consultantRoles';
import { contactDetailsInText } from '../../supabase/functions/_shared/assignmentInfo';

const base: AchievementInput = { title: 'Faster month-end close', role_played: 'functional_lead', sap_area: 'SAP FI', sap_version: 'S/4HANA 2023', industry: 'Retail', outcome: 'Cut month-end close from 8 to 4 days', year: 2024, reference_url: null };
const story = (o: Partial<Achievement>): Achievement => ({ id: 'x', ...base, is_public: true, status: 'self_declared', ...o });

describe('success story checks', () => {
  it('accepts a clean, measurable story', () => {
    expect(achievementProblems(base, new Date('2026-10-26'))).toEqual([]);
    expect(achievementWarnings(base)).toEqual([]);
  });
  it('rejects contact details anywhere in the story', () => {
    expect(achievementProblems({ ...base, outcome: 'Write to me at a@b.com for the details' })).toContain('contact');
    expect(achievementProblems({ ...base, title: 'Call +966 55 123 4567' })).toContain('contact');
  });
  it('warns about client names and absolute claims', () => {
    expect(achievementWarnings({ title: 'Rollout for Acme Trading Ltd', outcome: 'Cut close from 8 to 4 days' })).toContain('client_name');
    expect(achievementWarnings({ title: 'مشروع شركة الأمل', outcome: 'Cut close from 8 to 4 days' })).toContain('client_name');
    expect(achievementWarnings({ title: 'Best migration ever', outcome: 'Guaranteed 100 % uptime' })).toContain('absolute');
    expect(achievementWarnings({ title: 'Migration', outcome: 'Delivered a smooth migration' })).toContain('no_number');
  });
  it('checks limits and year', () => {
    expect(achievementProblems({ ...base, outcome: 'x'.repeat(401) })).toContain('outcome_long');
    expect(achievementProblems({ ...base, year: 2030 }, new Date('2026-10-26'))).toContain('year');
  });
  it('accepts only https reference links without short links or IPs', () => {
    expect(referenceUrlOk('https://www.linkedin.com/in/someone')).toBe(true);
    expect(referenceUrlOk('https://www.credly.com/badges/abc')).toBe(true);
    expect(referenceUrlOk('http://example.com')).toBe(false);
    expect(referenceUrlOk('https://bit.ly/abc')).toBe(false);
    expect(referenceUrlOk('https://10.0.0.1/x')).toBe(false);
  });
  it('turns database codes into readable texts', () => {
    expect(achievementErrorKey('achievement_client_name')).toBe('achievements.err_client_name');
    expect(achievementErrorKey('achievement_contact_details')).toBe('achievements.err_contact_details');
    expect(achievementErrorKey('rate_limited')).toBe('achievements.err_rate');
  });
});

describe('visibility', () => {
  it('shows only public, not hidden or rejected stories; verified first', () => {
    const list = [story({ id: 'a', year: 2025 }), story({ id: 'b', status: 'verified', year: 2020 }), story({ id: 'c', is_public: false }), story({ id: 'd', status: 'hidden' }), story({ id: 'e', status: 'rejected' })];
    expect(topAchievements(list).map((a) => a.id)).toEqual(['b', 'a']);
    expect(storyFacets(list)).toEqual({ industries: ['Retail'], roles: ['functional_lead'] });
  });
  it('builds platform achievements only from existing data', () => {
    expect(platformAchievements({})).toEqual([]);
    expect(platformAchievements({ solved: 12, successLevel: 'gold', respLevel: 'new', joinedAt: '2024-01-01', foundingNumber: 7, now: new Date('2026-10-26') }))
      .toEqual([{ key: 'solved', value: 12 }, { key: 'success_level', value: 'gold' }, { key: 'years', value: 2 }, { key: 'founding', value: 7 }]);
  });
});

describe('role details', () => {
  it('shows category fields only to that category', () => {
    expect(fieldAppliesToRoles('budget_range', ['program_manager'])).toBe(true);
    expect(fieldAppliesToRoles('budget_range', ['technical'])).toBe(false);
    expect(fieldAppliesToRoles('frameworks', ['enterprise_architect'])).toBe(true);
    expect(fieldAppliesToRoles('cloud_ops', ['security_grc'])).toBe(true);
    expect(fieldAppliesToRoles('deal_size_range', ['solution_sales'])).toBe(true);
    expect(fieldAppliesToRoles('trainings_delivered', ['training_lead'])).toBe(true);
    expect(fieldAppliesToRoles('testing_tools', ['presales'])).toBe(false);
  });
  it('cleans values and refuses contact details', () => {
    const r = cleanRoleDetails({ go_lives_led: '4', methodologies: ['SAP Activate', 'SAP Activate', 'My own'], regions: ['call +966 55 123 4567'], unknown: 'x' } as never, contactDetailsInText);
    expect(r.details).toEqual({ go_lives_led: 4, methodologies: ['SAP Activate', 'My own'] });
    expect(r.problems).toEqual(['regions']);
  });
  it('keeps the database file in step with the field list', () => {
    const sql = readFileSync('docs/sql/consultant-roles.sql', 'utf8');
    const kinds = JSON.parse(sql.match(/_kinds jsonb := '(.+?)'::jsonb/)![1]);
    expect(kinds).toEqual(Object.fromEntries(ROLE_DETAIL_SPEC.map((d) => [d.key, d.kind])));
    for (const d of ROLE_DETAIL_SPEC) {
      expect(sql).toContain(`WHEN '${d.key}' THEN ARRAY[${d.cats.map((c) => `'${c}'`).join(',')}]`);
    }
  });
});
