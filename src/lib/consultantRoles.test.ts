import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLE_CATALOG, categoryOf, defaultVerificationKinds, fieldAppliesToRoles, helpRolesFrom, interviewFocusFor,
  isRequiredForRoles, normalizeRoles, primaryToStore, roleFit, roleKeyFor, suggestedRateRange,
} from './consultantRoles';
import { extractTicketSignals } from '../../supabase/functions/_shared/ticketMatch';

describe('role catalogue', () => {
  it('has about 25 roles over the 11 categories, unique keys', () => {
    expect(DEFAULT_ROLE_CATALOG.length).toBeGreaterThanOrEqual(25);
    expect(new Set(DEFAULT_ROLE_CATALOG.map((r) => r.key)).size).toBe(DEFAULT_ROLE_CATALOG.length);
    expect(new Set(DEFAULT_ROLE_CATALOG.map((r) => r.category)).size).toBe(11);
  });
});

describe('legacy mapping', () => {
  it('maps the old editor labels and keys to catalogue keys', () => {
    expect(roleKeyFor('Functional consultant')).toBe('functional');
    expect(roleKeyFor('Solution / enterprise architect')).toBe('solution_architect');
    expect(roleKeyFor('architect')).toBe('solution_architect');
    expect(roleKeyFor('Project / program manager')).toBe('project_manager');
    expect(roleKeyFor('SAP Program Manager')).toBe('program_manager');
    expect(roleKeyFor('SAP Support Manager')).toBe('support_manager');
    expect(roleKeyFor('Basis / security / admin')).toBe('basis');
  });
  it('keeps unknown legacy values visible and counts them as Other', () => {
    const r = normalizeRoles(['SAP PTW', 'Functional consultant']);
    expect(r.roles).toEqual(['SAP PTW', 'functional']);
    expect(r.primary).toBe('other');
    expect(categoryOf('SAP PTW')).toBe('other');
  });
  it('puts the main role first and removes duplicates', () => {
    expect(normalizeRoles(['Functional consultant', 'Solution / enterprise architect', 'functional'], 'architect').roles)
      .toEqual(['solution_architect', 'functional']);
  });
  it('stores only old main-role keys until the catalogue exists', () => {
    expect(primaryToStore('presales', false)).toBeNull();
    expect(primaryToStore('program_manager', false)).toBe('project_manager');
    expect(primaryToStore('presales', true)).toBe('presales');
  });
});

describe('role-aware profile fields', () => {
  it('never applies technical fields to managers or pre-sales only', () => {
    expect(fieldAppliesToRoles('sap_technologies', ['project_manager'])).toBe(false);
    expect(fieldAppliesToRoles('certifications', ['presales'])).toBe(false);
    expect(isRequiredForRoles('certifications', true, ['program_manager', 'change_lead'])).toBe(false);
  });
  it('keeps technical fields for technical and functional roles', () => {
    expect(isRequiredForRoles('sap_technologies', true, ['technical'])).toBe(true);
    expect(isRequiredForRoles('certifications', true, ['project_manager', 'functional'])).toBe(true);
  });
  it('shows manager and pre-sales details only to those roles', () => {
    expect(fieldAppliesToRoles('methodologies', ['project_manager'])).toBe(true);
    expect(fieldAppliesToRoles('methodologies', ['technical'])).toBe(false);
    expect(fieldAppliesToRoles('presales_experience', ['solution_sales'])).toBe(true);
    expect(fieldAppliesToRoles('presales_experience', ['solution_architect'])).toBe(false);
  });
  it('changes nothing for profiles without roles or with only unknown roles', () => {
    expect(fieldAppliesToRoles('sap_technologies', [])).toBe(true);
    expect(fieldAppliesToRoles('sap_technologies', ['SAP PTW'])).toBe(true);
    expect(fieldAppliesToRoles('methodologies', [])).toBe(false);
    expect(fieldAppliesToRoles('bio', ['presales'])).toBe(true);
  });
  it('asks non-technical roles for LinkedIn and references instead of certificates', () => {
    expect(defaultVerificationKinds(['project_manager'])).toEqual(['links', 'references']);
    expect(defaultVerificationKinds(['basis'])).toEqual(['certificates']);
  });
});

describe('matching and interview', () => {
  it('scores role fit: exact, techno-functional, same category, architect', () => {
    expect(roleFit('solution_architect', ['Solution / enterprise architect'])).toBe(1);
    expect(roleFit('technical', ['techno_functional'])).toBe(0.8);
    expect(roleFit('program_manager', ['project_manager'])).toBe(0.6);
    expect(roleFit('technical', ['solution_architect'])).toBe(0.5);
    expect(roleFit('presales', ['technical'])).toBe(0);
  });
  it('uses the client-chosen type of help instead of the guessed roles', () => {
    const s = extractTicketSignals({ title: 'Plan the S/4HANA rollout', sap_modules: ['SAP FI'], help_roles: ['project_manager', 'solution_architect'] });
    expect(s.roles).toEqual(['project_manager', 'solution_architect']);
    expect(extractTicketSignals({ title: 'Posting error', sap_modules: ['SAP FI'] }).roles).toContain('functional');
    expect(helpRolesFrom(['presales', 'DROP TABLE', 7])).toEqual(['presales']);
  });
  it('picks the interview focus from the main role', () => {
    expect(interviewFocusFor('program_manager')).toBe('manager');
    expect(interviewFocusFor('enterprise_architect')).toBe('architect');
    expect(interviewFocusFor('solution_sales')).toBe('presales');
    expect(interviewFocusFor('basis')).toBe('technical');
    expect(interviewFocusFor('functional')).toBe('functional');
  });
  it('shows a suggested rate range only when the admin set a valid one', () => {
    const settings = { rate_ranges: { delivery_management: { min: 60, max: 120 }, presales_sales: { min: 90, max: 50 } } };
    expect(suggestedRateRange(settings, 'project_manager')).toEqual({ category: 'delivery_management', min: 60, max: 120 });
    expect(suggestedRateRange(settings, 'presales')).toBeNull();
    expect(suggestedRateRange({}, 'project_manager')).toBeNull();
  });
});
