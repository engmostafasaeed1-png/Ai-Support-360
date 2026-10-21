/**
 * Feature N: the versioned Consultant Service Policy.
 * The live text comes from the consultant_policy_versions table; DRAFT_POLICY_V1 is the first version (seeded by
 * docs/sql/consultant-policy.sql with exactly this text) and the fallback shown before that file is applied.
 * The rules below mirror the database functions in that file; the database is what enforces them.
 */

export type PolicyLang = 'en' | 'ar';

export interface PolicyText {
  title: string;
  summary: string;
  /** Plain text: "## " starts a section, "- " a list item, other lines are paragraphs. */
  body: string;
}

export interface PolicyVersion {
  version: number;
  effectiveAt: string | null;
  en: PolicyText;
  ar: PolicyText;
}

export const DEFAULT_POLICY_GRACE_DAYS = 7;
export const MAX_POLICY_GRACE_DAYS = 90;
export const POLICY_REMINDER_DAYS = 3;
export const DAY_MS = 86_400_000;

import {
  POLICY_DRAFT_BODY_AR, POLICY_DRAFT_BODY_EN, POLICY_DRAFT_NOTE_AR, POLICY_DRAFT_NOTE_EN, POLICY_DRAFT_SUMMARY_AR, POLICY_DRAFT_SUMMARY_EN,
} from '../../supabase/functions/_shared/consultantPolicyDraft';

export { POLICY_DRAFT_NOTE_AR, POLICY_DRAFT_NOTE_EN };

export const DRAFT_POLICY_V1: PolicyVersion = {
  version: 1,
  effectiveAt: null,
  en: {
    title: 'Consultant Service Policy',
    summary: POLICY_DRAFT_SUMMARY_EN,
    body: POLICY_DRAFT_BODY_EN,
  },
  ar: {
    title: 'سياسة خدمة المستشار',
    summary: POLICY_DRAFT_SUMMARY_AR,
    body: POLICY_DRAFT_BODY_AR,
  },
};

export interface PolicyBlock { kind: 'p' | 'li' | 'note'; text: string }
export interface PolicySection { heading: string | null; blocks: PolicyBlock[] }

/** Splits a policy body into sections for display; never produces HTML. */
export function parsePolicyBody(body: string): PolicySection[] {
  const sections: PolicySection[] = [];
  let cur: PolicySection = { heading: null, blocks: [] };
  for (const raw of (body || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) {
      if (cur.heading !== null || cur.blocks.length) sections.push(cur);
      cur = { heading: line.slice(3).trim(), blocks: [] };
    } else if (line.startsWith('- ')) cur.blocks.push({ kind: 'li', text: line.slice(2).trim() });
    else if (cur.heading === null && (line === POLICY_DRAFT_NOTE_EN || line === POLICY_DRAFT_NOTE_AR)) cur.blocks.push({ kind: 'note', text: line });
    else cur.blocks.push({ kind: 'p', text: line });
  }
  if (cur.heading !== null || cur.blocks.length) sections.push(cur);
  return sections;
}

export function policyText(v: PolicyVersion, lang: string | undefined): PolicyText {
  return lang?.startsWith('ar') ? v.ar : v.en;
}

// ---------------------------------------------------------------------------------------------------------------
// Acknowledgement state (mirrors public.consultant_policy_state in docs/sql/consultant-policy.sql).

export type PolicyState = 'none' | 'accepted' | 'pending' | 'grace' | 'blocked';

export interface PolicyStateInput {
  currentVersion: number | null;
  acceptedVersion: number | null;
  /** First time this version was shown to the consultant (pop-up, registration step or e-mail). */
  firstShownAt: string | null;
  graceDays: number | null;
  now: number;
}

export interface PolicyStatus {
  state: PolicyState;
  deadline: string | null;
  /** "Remind me later" is offered only inside the grace period. */
  canSnooze: boolean;
}

export function clampGraceDays(days: number | null | undefined): number {
  if (days === null || days === undefined) return DEFAULT_POLICY_GRACE_DAYS;
  const n = Number(days);
  if (!Number.isFinite(n)) return DEFAULT_POLICY_GRACE_DAYS;
  return Math.min(MAX_POLICY_GRACE_DAYS, Math.max(0, Math.trunc(n)));
}

export function policyState(i: PolicyStateInput): PolicyStatus {
  if (!i.currentVersion) return { state: 'none', deadline: null, canSnooze: false };
  if (i.acceptedVersion != null && i.acceptedVersion >= i.currentVersion) return { state: 'accepted', deadline: null, canSnooze: false };
  const first = i.firstShownAt ? Date.parse(i.firstShownAt) : NaN;
  if (!Number.isFinite(first)) return { state: 'pending', deadline: null, canSnooze: true };
  const deadline = first + clampGraceDays(i.graceDays) * DAY_MS;
  const iso = new Date(deadline).toISOString();
  return i.now < deadline ? { state: 'grace', deadline: iso, canSnooze: true } : { state: 'blocked', deadline: iso, canSnooze: false };
}

export function needsAcknowledgement(state: PolicyState): boolean {
  return state === 'pending' || state === 'grace' || state === 'blocked';
}

/**
 * The pop-up opens once per sign-in session while an acknowledgement is outstanding. "Remind me later" (or closing it)
 * hides it until the next sign-in; it never opens on the profile page, where the same step is shown inline.
 */
export function shouldShowPolicyPopup(i: { state: PolicyState; handledThisSession: boolean; onInlinePage: boolean }): boolean {
  return needsAcknowledgement(i.state) && !i.handledThisSession && !i.onInlinePage;
}

export function policyPopupKey(sessionId: string | null, version: number): string | null {
  return sessionId ? `consultant-policy-popup:${sessionId}:v${version}` : null;
}

/** A consultant who signed up after the version took effect meets it at registration ("new"), others by pop-up ("updated"). */
export function isNewConsultant(signedUpAt: string | null | undefined, effectiveAt: string | null | undefined): boolean {
  if (!signedUpAt || !effectiveAt) return false;
  return Date.parse(signedUpAt) >= Date.parse(effectiveAt);
}
