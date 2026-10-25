import { describe, expect, it } from 'vitest';
import {
  BLOCKED_REASONS,
  ERROR_CODE_REASONS,
  blockedErrorText,
  blockedSentence,
  blockingReasons,
  catalogueStrings,
  consultantAssignedReason,
  describeBlocked,
  isBlocked,
  moreStepsText,
  ndaReason,
  pageReasons,
  payoutReasons,
  profileReason,
  rateLimitReason,
  reasonFromError,
  textReason,
  ticketClosedReason,
} from './blockedReasons';

describe('blocked reasons catalogue', () => {
  it('has an English and an Arabic sentence for every reason and step label', () => {
    for (const s of catalogueStrings()) {
      expect(s.en.trim(), `${s.key}.${s.part} en`).not.toBe('');
      expect(s.ar.trim(), `${s.key}.${s.part} ar`).not.toBe('');
      expect(/[\u0600-\u06FF]/.test(s.ar), `${s.key}.${s.part} ar is Arabic`).toBe(true);
      // the same placeholders in both languages
      const ph = (t: string) => (t.match(/\{\{\w+\}\}/g) ?? []).sort().join();
      expect(ph(s.ar), `${s.key}.${s.part} placeholders`).toBe(ph(s.en));
    }
  });

  it('contains every reason the owner listed', () => {
    for (const k of [
      'no_consultant_assigned', 'nda_not_signed_by_you', 'nda_waiting_other_party', 'rate_not_approved', 'profile_incomplete',
      'ai_interview_not_passed', 'verification_pending', 'policy_not_accepted', 'sla_not_accepted', 'brd_not_approved',
      'engagement_not_confirmed', 'payment_not_confirmed', 'ticket_closed', 'outside_availability', 'feature_disabled_by_admin',
      'permission_missing', 'rate_limit', 'missing_payout_details', 'no_bank_account', 'minimum_payout_not_reached',
      'pending_admin_review', 'already_done',
    ]) expect(BLOCKED_REASONS, k).toHaveProperty(k);
  });

  it('feature switched off by an admin reads "Not available yet"', () => {
    expect(describeBlocked('feature_disabled_by_admin')?.first.message).toBe('Not available yet.');
    expect(describeBlocked('feature_disabled_by_admin', 'ar')?.first.message).toBe('غير متاح بعد.');
  });

  it('every server code maps to an existing reason', () => {
    for (const [code, key] of Object.entries(ERROR_CODE_REASONS)) expect(BLOCKED_REASONS, code).toHaveProperty(key);
  });
});

describe('several reasons: first blocking step and "N more steps"', () => {
  it('skips steps already done (falsy) and keeps the order', () => {
    const block = describeBlocked([false, 'nda_not_signed_by_you', null, 'rate_not_approved', 'sla_not_accepted']);
    expect(block?.first.key).toBe('nda_not_signed_by_you');
    expect(block?.more.map((m) => m.key)).toEqual(['rate_not_approved', 'sla_not_accepted']);
    expect(moreStepsText(block!.more.length)).toBe('2 more steps');
  });

  it('is not blocked when every step is done', () => {
    expect(isBlocked([false, null, undefined, ''])).toBe(false);
    expect(describeBlocked(null)).toBeNull();
    expect(blockingReasons(['not_a_real_key' as never])).toEqual([]);
  });

  it('shows progress "2 of 4 steps done"', () => {
    const block = describeBlocked('sla_not_accepted', 'en', { done: 2, total: 4 });
    expect(blockedSentence(block!)).toContain('2 of 4 steps done');
  });

  it('offers a next-step label only when there is somewhere to go', () => {
    expect(describeBlocked('no_consultant_assigned')?.first.nextLabel).toBeUndefined();
    expect(describeBlocked({ key: 'no_consultant_assigned', to: '/client/tickets/1#bids' })?.first.nextLabel).toBe('Go to Bids');
    expect(describeBlocked('profile_incomplete')?.first).toMatchObject({ nextLabel: 'Complete your profile', to: '/consultant/profile' });
    const fn = () => undefined;
    expect(describeBlocked({ key: 'nda_not_signed_by_you', onNext: fn })?.first).toMatchObject({ nextLabel: 'Sign the NDA', onNext: fn });
  });

  it('Arabic "more steps" wording', () => {
    expect(moreStepsText(1, 'ar')).toBe('وخطوة أخرى');
    expect(moreStepsText(2, 'ar')).toBe('وخطوتان أخريان');
    expect(moreStepsText(3, 'ar')).toBe('و3 خطوات أخرى');
  });
});

describe('prerequisite checks', () => {
  it('ticket closed and consultant assigned', () => {
    expect(ticketClosedReason('closed')).toBe('ticket_closed');
    expect(ticketClosedReason('Cancelled')).toBe('ticket_closed');
    expect(ticketClosedReason('in_progress')).toBeNull();
    expect(consultantAssignedReason(null)).toBe('no_consultant_assigned');
    expect(consultantAssignedReason('c1')).toBeNull();
  });

  it('NDA: me first, then the other party, revoked wins', () => {
    expect(ndaReason({ signedByMe: false, signedByOther: false, otherParty: 'client' })?.key).toBe('nda_not_signed_by_you');
    const wait = ndaReason({ signedByMe: true, signedByOther: false, otherParty: 'client' });
    expect(describeBlocked(wait)?.first.message).toBe('Waiting for the client to sign the NDA.');
    expect(ndaReason({ signedByMe: true, signedByOther: true, otherParty: 'client' })).toBeNull();
    expect(ndaReason({ revoked: true, signedByMe: true, signedByOther: true, otherParty: 'consultant' })?.key).toBe('nda_revoked');
  });

  it('profile incomplete lists the missing fields (at most 3, then +N)', () => {
    const r = profileReason(['Country', 'City', 'Phone', 'Modules']);
    expect(describeBlocked(r)?.first.message).toBe('Complete your profile first: Country, City, Phone +1.');
    expect(profileReason([])).toBeNull();
  });

  it('rate limit: try again in N min (rounded up)', () => {
    const now = new Date('2026-10-25T10:00:00Z');
    expect(rateLimitReason(new Date('2026-10-25T10:04:01Z'), now)?.params?.minutes).toBe(5);
    expect(rateLimitReason(new Date('2026-10-25T10:00:10Z'), now)?.params?.minutes).toBe(1);
    expect(rateLimitReason(new Date('2026-10-25T09:59:00Z'), now)).toBeNull();
    expect(describeBlocked(rateLimitReason(new Date('2026-10-25T10:10:00Z'), now))?.first.message).toBe('Please try again in 10 min.');
  });

  it('payout: details, bank account, minimum in that order', () => {
    const list = payoutReasons({ hasPayoutDetails: false, hasBankAccount: false, balance: 40, minimum: 50, formatAmount: (n) => `$${n}` });
    expect(list.map((x) => x.key)).toEqual(['missing_payout_details', 'no_bank_account', 'minimum_payout_not_reached']);
    expect(describeBlocked(list[2])?.first.message).toBe('Your balance is below the minimum payout of $50.');
    expect(payoutReasons({ hasPayoutDetails: true, hasBankAccount: true, balance: 50, minimum: 50 })).toEqual([]);
  });

  it('text checks', () => {
    expect(textReason('  ', { min: 1 })?.key).toBe('fill_required_fields');
    expect(textReason('abc', { min: 5, key: 'reason_required' })).toMatchObject({ key: 'reason_required', params: { min: 5 } });
    expect(textReason('hello', { min: 5 })).toBeNull();
    expect(textReason('x'.repeat(11), { max: 10 })?.key).toBe('text_too_long');
  });

  it('pagination', () => {
    expect(pageReasons(1, 3)).toEqual({ prev: 'first_page', next: null });
    expect(pageReasons(3, 3)).toEqual({ prev: null, next: 'last_page' });
    expect(pageReasons(0, 2, 0)).toEqual({ prev: 'first_page', next: null });
    expect(pageReasons(1, 2, 0)).toEqual({ prev: null, next: 'last_page' });
  });
});

describe('server refusal codes use the same words', () => {
  it.each([
    ['sla_acceptance_required: accept the SLA first', 'sla_not_accepted'],
    ['sa_sla_acceptance_required', 'sla_not_accepted'],
    ['brd_gate', 'brd_not_approved'],
    ['brd_approval_required', 'brd_not_approved'],
    ['nda_required', 'nda_not_signed'],
    ['rate_limited', 'rate_limit_soon'],
    ['sa_disabled', 'feature_disabled_by_admin'],
  ])('%s → %s', (code, key) => {
    expect(reasonFromError(new Error(code))?.key).toBe(key);
  });

  it('reads codes from edge function bodies and keeps the retry minutes', () => {
    expect(reasonFromError({ error: 'rate_limited', message: 'try again in 3 minutes' })).toEqual({ key: 'rate_limit', params: { minutes: 3 } });
    expect(blockedErrorText({ message: 'nda_required' }, 'ar')).toBe(BLOCKED_REASONS.nda_not_signed.message.ar);
  });

  it('leaves technical or unknown errors to the generic handler', () => {
    expect(reasonFromError(new Error('duplicate key value violates unique constraint'))).toBeNull();
    expect(reasonFromError(null)).toBeNull();
  });
});
