import { describe, expect, it } from 'vitest';
import { noticeDisplay } from './noticeModalConfig';

describe('which notices may open a pop-up (one shared list)', () => {
  it('the Refer & earn invitation is a bell card with a one-time banner, never a modal', () => {
    expect(noticeDisplay('referral', 'invitation')).toBe('banner');
  });
  it('routine referral events stay in the bell', () => {
    for (const k of ['registered', 'interview_passed', 'activated', 'reward_earned', 'reward_available', 'reward_paid', 'statement']) {
      expect(noticeDisplay('referral', k)).toBe('bell');
    }
  });
  it('important referral events open a modal', () => {
    for (const k of ['reward_reversed', 'referral_rejected', 'bank_changed', 'ack_request', 'terms_pending']) {
      expect(noticeDisplay('referral', k)).toBe('modal');
    }
  });
  it('a not-counted responsiveness notice is informational; counted and friendly notices open a modal', () => {
    expect(noticeDisplay('responsiveness', 'not_counted')).toBe('bell');
    expect(noticeDisplay('responsiveness', 'counted')).toBe('modal');
    expect(noticeDisplay('responsiveness', 'warning_2')).toBe('modal');
  });
  it('admin messages open a modal only when the admin chose the pop-up channel', () => {
    expect(noticeDisplay('broadcast', 'popup')).toBe('modal');
    expect(noticeDisplay('broadcast', 'in_app')).toBe('bell');
  });
});
