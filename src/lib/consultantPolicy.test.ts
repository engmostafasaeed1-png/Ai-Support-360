import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DAY_MS, DRAFT_POLICY_V1, isNewConsultant, parsePolicyBody, policyPopupKey, policyState, shouldShowPolicyPopup,
} from './consultantPolicy';
import { filterPolicyRows, policyOverviewCsv, type PolicyOverviewRow } from './consultantPolicyCsv';
import { formatPolicyDeadline, POLICY_NOTICE_STR } from '../../supabase/functions/_shared/consultantPolicyCopy';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * DAY_MS).toISOString();

describe('version bump re-prompts', () => {
  it('accepted v1 is accepted while v1 is current', () => {
    expect(policyState({ currentVersion: 1, acceptedVersion: 1, firstShownAt: daysAgo(1), graceDays: 7, now: NOW }).state).toBe('accepted');
  });
  it('publishing v2 makes the same consultant pending again', () => {
    expect(policyState({ currentVersion: 2, acceptedVersion: 1, firstShownAt: null, graceDays: 7, now: NOW }).state).toBe('pending');
  });
  it('no published version means nothing to accept', () => {
    expect(policyState({ currentVersion: null, acceptedVersion: null, firstShownAt: null, graceDays: 7, now: NOW }).state).toBe('none');
  });
});

describe('grace logic (policy_grace_days, counted from first display)', () => {
  it('never shown: pending, not restricted, "Remind me later" allowed', () => {
    expect(policyState({ currentVersion: 1, acceptedVersion: null, firstShownAt: null, graceDays: 7, now: NOW })).toEqual({ state: 'pending', deadline: null, canSnooze: true });
  });
  it('shown 3 days ago with 7 grace days: in grace until day 7', () => {
    const s = policyState({ currentVersion: 1, acceptedVersion: null, firstShownAt: daysAgo(3), graceDays: 7, now: NOW });
    expect(s.state).toBe('grace');
    expect(s.canSnooze).toBe(true);
    expect(s.deadline).toBe(new Date(NOW + 4 * DAY_MS).toISOString());
  });
  it('exactly 7 days after first display: restricted and no more "Remind me later"', () => {
    expect(policyState({ currentVersion: 1, acceptedVersion: null, firstShownAt: daysAgo(7), graceDays: 7, now: NOW })).toMatchObject({ state: 'blocked', canSnooze: false });
  });
  it('defaults to 7 days and clamps to 0-90', () => {
    expect(policyState({ currentVersion: 1, acceptedVersion: null, firstShownAt: daysAgo(6), graceDays: null, now: NOW }).state).toBe('grace');
    expect(policyState({ currentVersion: 1, acceptedVersion: null, firstShownAt: daysAgo(0), graceDays: 0, now: NOW }).state).toBe('blocked');
    expect(policyState({ currentVersion: 1, acceptedVersion: null, firstShownAt: daysAgo(100), graceDays: 500, now: NOW }).state).toBe('blocked');
    expect(policyState({ currentVersion: 1, acceptedVersion: null, firstShownAt: daysAgo(89), graceDays: 500, now: NOW }).state).toBe('grace');
  });
});

describe('popup once per session unless pending', () => {
  it('opens while an acknowledgement is outstanding and not yet handled in this sign-in', () => {
    for (const state of ['pending', 'grace', 'blocked'] as const) expect(shouldShowPolicyPopup({ state, handledThisSession: false, onInlinePage: false })).toBe(true);
  });
  it('stays closed after "Remind me later" in the same sign-in, after accepting, and on the profile page', () => {
    expect(shouldShowPolicyPopup({ state: 'grace', handledThisSession: true, onInlinePage: false })).toBe(false);
    expect(shouldShowPolicyPopup({ state: 'accepted', handledThisSession: false, onInlinePage: false })).toBe(false);
    expect(shouldShowPolicyPopup({ state: 'none', handledThisSession: false, onInlinePage: false })).toBe(false);
    expect(shouldShowPolicyPopup({ state: 'pending', handledThisSession: false, onInlinePage: true })).toBe(false);
  });
  it('a new sign-in or a new version uses a new key, so the popup comes back', () => {
    expect(policyPopupKey('s1', 1)).not.toBe(policyPopupKey('s2', 1));
    expect(policyPopupKey('s1', 1)).not.toBe(policyPopupKey('s1', 2));
    expect(policyPopupKey(null, 1)).toBeNull();
  });
});

describe('new vs existing consultants', () => {
  it('signed up after the version took effect: registration step (email or Google, same rule)', () => {
    expect(isNewConsultant('2026-10-21T00:00:00Z', '2026-10-20T00:00:00Z')).toBe(true);
    expect(isNewConsultant('2026-01-01T00:00:00Z', '2026-10-20T00:00:00Z')).toBe(false);
  });
});

describe('policy text', () => {
  it('has the draft note, a summary and the five policy areas plus changes', () => {
    for (const lang of ['en', 'ar'] as const) {
      const sections = parsePolicyBody(DRAFT_POLICY_V1[lang].body);
      expect(sections[0].blocks[0].kind).toBe('note');
      expect(sections.filter(s => s.heading).length).toBe(6);
      expect(DRAFT_POLICY_V1[lang].summary.length).toBeGreaterThan(100);
    }
    expect(DRAFT_POLICY_V1.en.body).toContain('within 24 hours');
    expect(DRAFT_POLICY_V1.en.body).toContain('30 minutes');
    expect(DRAFT_POLICY_V1.en.body).toContain('after 2 hours, 4 hours and 1 day');
    expect(DRAFT_POLICY_V1.en.body).toContain('within 7 days');
  });

  it('the SQL seed is exactly the bundled draft', () => {
    const sql = readFileSync(resolve(__dirname, '../../docs/sql/consultant-policy.sql'), 'utf8');
    for (const [tag, value] of [['t_en', DRAFT_POLICY_V1.en.title], ['t_ar', DRAFT_POLICY_V1.ar.title], ['s_en', DRAFT_POLICY_V1.en.summary], ['s_ar', DRAFT_POLICY_V1.ar.summary], ['b_en', DRAFT_POLICY_V1.en.body], ['b_ar', DRAFT_POLICY_V1.ar.body]]) {
      expect(sql).toContain(`$${tag}$${value}$${tag}$`);
    }
  });

  it('the combined directory and alert rules are identical in every prepared file', () => {
    const read = (f: string) => readFileSync(resolve(__dirname, `../../docs/sql/${f}`), 'utf8');
    const fn = (sql: string, head: string) => { const i = sql.indexOf(head); const end = sql.indexOf('$function$;', sql.indexOf('$function$', i) + 10); return sql.slice(i, end); };
    const hidden = 'CREATE OR REPLACE FUNCTION public.hidden_consultant_ids()';
    const critical = 'CREATE OR REPLACE FUNCTION public.critical_alert_targets(_ticket_id uuid)';
    expect(fn(read('consultant-location.sql'), hidden)).toBe(fn(read('consultant-policy.sql'), hidden));
    expect(fn(read('user-management.sql'), hidden)).toBe(fn(read('consultant-policy.sql'), hidden));
    expect(fn(read('consultant-policy.sql'), hidden)).toContain('um_suspended_consultant_ids');
    expect(fn(read('responsiveness.sql'), critical)).toBe(fn(read('consultant-policy.sql'), critical));
    expect(fn(read('consultant-policy.sql'), hidden)).toContain('consultant_policy_blocked_ids');
    expect(fn(read('consultant-policy.sql'), critical)).toContain('consultant_policy_blocked_ids');
  });
});

describe('admin list and e-mail copy', () => {
  const rows: PolicyOverviewRow[] = [
    { consultant_id: 'a', display_name: 'Sara', email: 'sara@example.com', verification_status: 'verified', signed_up_at: null, state: 'accepted', current_version: 1, accepted_version: 1, accepted_at: '2026-10-20T10:00:00Z', accepted_language: 'ar', first_shown_at: null, deadline: null, last_reminder_at: null, reminders: 0 },
    { consultant_id: 'b', display_name: '=HYPERLINK("x")', email: 'omar@example.com', verification_status: 'pending', signed_up_at: null, state: 'blocked', current_version: 1, accepted_version: null, accepted_at: null, accepted_language: null, first_shown_at: '2026-10-01T10:00:00Z', deadline: '2026-10-08T10:00:00Z', last_reminder_at: null, reminders: 2 },
  ];
  it('filters by status and search', () => {
    expect(filterPolicyRows(rows, 'blocked', '').map(r => r.consultant_id)).toEqual(['b']);
    expect(filterPolicyRows(rows, 'all', 'sara').map(r => r.consultant_id)).toEqual(['a']);
  });
  it('CSV neutralises spreadsheet formulas', () => {
    expect(policyOverviewCsv(rows)).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it('first notice and reminder subjects differ; Arabic dates use the Gregorian calendar', () => {
    expect(POLICY_NOTICE_STR.en.subject('notice')).toBe('Please confirm our updated service policy');
    expect(POLICY_NOTICE_STR.en.subject('reminder')).toMatch(/^Reminder:/);
    expect(formatPolicyDeadline('2026-10-27T10:00:00Z', 'en')).toBe('27 October 2026');
    expect(formatPolicyDeadline('2026-10-27T10:00:00Z', 'ar')).toContain('2026');
  });
});
