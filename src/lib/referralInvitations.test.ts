import { describe, expect, it } from 'vitest';
import {
  csvCell, filterSummary, inviteBlocker, invitePayload, inviteProgress, inviteReportCsv, inviteSkipReason, resendReasonOk, INVITE_DEFAULTS,
  type InviteCandidate,
} from './referralInvitations';

const ok: InviteCandidate = { exists: true, consultant: true, verified: true, emailConfirmed: true };

describe('Refer & earn invitation eligibility (mirror of ri_candidates)', () => {
  it('a verified consultant with a confirmed e-mail receives it', () => {
    expect(inviteSkipReason(ok)).toBeNull();
  });
  it('clients and other non-consultants are skipped', () => {
    expect(inviteSkipReason({ ...ok, consultant: false })).toBe('not_consultant');
  });
  it('unverified consultants are skipped', () => {
    expect(inviteSkipReason({ ...ok, verified: false })).toBe('not_verified');
  });
  it('suspended and deleted accounts are skipped', () => {
    expect(inviteSkipReason({ ...ok, suspended: true })).toBe('suspended');
    expect(inviteSkipReason({ ...ok, deleted: true })).toBe('deleted');
  });
  it('unconfirmed e-mail is skipped', () => {
    expect(inviteSkipReason({ ...ok, emailConfirmed: false })).toBe('email_unconfirmed');
  });
  it('the service policy gate is respected', () => {
    expect(inviteSkipReason({ ...ok, policyBlocked: true })).toBe('policy_blocked');
  });
  it('a notification pause is respected (skipped and reported)', () => {
    expect(inviteSkipReason({ ...ok, paused: true })).toBe('paused');
  });
  it('accounts tagged "test" are skipped unless tests are included explicitly', () => {
    expect(inviteSkipReason({ ...ok, tags: ['VIP', ' Test '] })).toBe('test_account');
    expect(inviteSkipReason({ ...ok, tags: ['test'] }, { includeTests: true })).toBeNull();
  });
  it('one invitation per user and version; a normal send skips people already invited', () => {
    expect(inviteSkipReason({ ...ok, invitedThisVersion: true })).toBe('already_invited');
  });
  it('a resend is allowed at most once per 14 days', () => {
    const now = new Date('2026-10-22T12:00:00Z');
    expect(INVITE_DEFAULTS.resendDays).toBe(14);
    expect(inviteSkipReason({ ...ok, invitedThisVersion: true, lastInvitedAt: '2026-10-10T12:00:00Z' }, { resend: true, now })).toBe('resend_too_soon');
    expect(inviteSkipReason({ ...ok, invitedThisVersion: true, lastInvitedAt: '2026-10-07T12:00:00Z' }, { resend: true, now })).toBeNull();
  });
  it('the default maximum per request is 500', () => {
    expect(INVITE_DEFAULTS.maxRecipients).toBe(500);
  });
});

describe('Refer & earn invitation sending rules', () => {
  const base = { installed: true, enabled: true, eligible: 3, maxRecipients: 500, confirmed: true, resend: false, reason: '', busy: false };
  it('never sends on the first click: "I confirm" is required', () => {
    expect(inviteBlocker({ ...base, confirmed: false })).toBe('confirm');
    expect(inviteBlocker(base)).toBeNull();
  });
  it('the kill switch (off by default) blocks real sends', () => {
    expect(inviteBlocker({ ...base, enabled: false })).toBe('switched_off');
  });
  it('more recipients than the maximum are refused', () => {
    expect(inviteBlocker({ ...base, eligible: 501 })).toBe('too_many');
  });
  it('a resend needs a reason of 10 to 300 characters', () => {
    expect(resendReasonOk('too short')).toBe(false);
    expect(resendReasonOk('Owner asked for a reminder')).toBe(true);
    expect(resendReasonOk('x'.repeat(301))).toBe(false);
    expect(inviteBlocker({ ...base, resend: true, reason: 'short' })).toBe('reason');
  });
  it('the payload carries only valid ids, the chosen channels (known ones, fixed order) and the request id', () => {
    const p = invitePayload({ mode: 'selected', ids: ['00000000-0000-4000-8000-000000000001', 'bad', '00000000-0000-4000-8000-000000000001'], channels: ['telegram', 'in_app', 'fax' as never], confirmed: true, key: 'k' });
    expect(p.user_ids).toEqual(['00000000-0000-4000-8000-000000000001']);
    expect(p.channels).toEqual(['in_app', 'telegram']);
    expect(p.idempotency_key).toBe('k');
    expect(invitePayload({ mode: 'all_eligible', key: 'k' }).user_ids).toBeUndefined();
    expect(invitePayload({ mode: 'all_eligible', key: 'k' }).channels).toEqual(['in_app']);
  });
  it('progress is complete when nothing waits any more', () => {
    expect(inviteProgress({ queued: 4, sent: 3, failed: 1, sending: 0 })).toMatchObject({ done: true, percent: 100 });
    expect(inviteProgress({ queued: 4, sent: 1, failed: 0, sending: 3 })).toMatchObject({ done: false, percent: 25 });
  });
});

describe('Refer & earn invitation report CSV', () => {
  it('has no e-mail column and neutralises formulas in names', () => {
    const csv = inviteReportCsv([{ user_id: 'u1', name: '=HYPERLINK("x")', lang: 'ar', outcome: 'skipped', reason: 'paused', telegram: null, sent_at: null, resend: false }]);
    // Per-channel status columns only: no column with e-mail addresses.
    expect(csv.split('\n')[0].split(',').filter((h) => /mail/i.test(h))).toEqual(['channel_email']);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('notifications paused');
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
  });
  it('filter summary keeps only simple filter keys for the audit', () => {
    expect(filterSummary(new URLSearchParams('roles=consultant&page=2&Bad-Key=x&sort=name'))).toEqual({ roles: 'consultant' });
  });
});
