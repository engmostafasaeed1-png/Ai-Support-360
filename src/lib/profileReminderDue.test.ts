import { describe, expect, it } from 'vitest';
import { DAY_MS, HOUR_MS, WEEK_MS, profileReminderDue, type ProfileReminderState } from '../../supabase/functions/_shared/profileReminderDue';

const NOW = 1_800_000_000_000;
const base: ProfileReminderState = {
  signedUpAt: NOW - 2 * DAY_MS,
  lastSentAt: null,
  complete: false,
  interviewDone: false,
  unsubscribed: false,
  disabled: false,
  flagOn: true,
};

describe('profile reminder due selection', () => {
  it('sends the first reminder 24 h after sign-up, not before', () => {
    expect(profileReminderDue({ ...base, signedUpAt: NOW - 23 * HOUR_MS }, NOW)).toEqual({ due: false, reason: 'first_after_24h' });
    expect(profileReminderDue({ ...base, signedUpAt: NOW - 25 * HOUR_MS }, NOW)).toEqual({ due: true, kind: 'daily' });
  });

  it('sends daily while incomplete, capped at one per 20 h', () => {
    expect(profileReminderDue({ ...base, lastSentAt: NOW - 19 * HOUR_MS }, NOW)).toEqual({ due: false, reason: 'cap_20h' });
    expect(profileReminderDue({ ...base, lastSentAt: NOW - 21 * HOUR_MS }, NOW)).toEqual({ due: true, kind: 'daily' });
  });

  it('switches to weekly after 30 days (default) and respects the weekly gap', () => {
    const old = { ...base, signedUpAt: NOW - 40 * DAY_MS };
    expect(profileReminderDue({ ...old, lastSentAt: NOW - 2 * DAY_MS }, NOW)).toEqual({ due: false, reason: 'weekly_wait' });
    expect(profileReminderDue({ ...old, lastSentAt: NOW - WEEK_MS - HOUR_MS }, NOW)).toEqual({ due: true, kind: 'weekly' });
  });

  it('honours an admin-edited daily window', () => {
    const s = { ...base, signedUpAt: NOW - 10 * DAY_MS, lastSentAt: NOW - 2 * DAY_MS, dailyDays: 7 };
    expect(profileReminderDue(s, NOW)).toEqual({ due: false, reason: 'weekly_wait' });
  });

  it('stops when profile is complete and the AI interview is done', () => {
    expect(profileReminderDue({ ...base, complete: true, interviewDone: true }, NOW)).toEqual({ due: false, reason: 'complete' });
    expect(profileReminderDue({ ...base, complete: true, interviewDone: false }, NOW).due).toBe(true);
  });

  it('stops when unsubscribed, disabled, or the admin flag is off', () => {
    expect(profileReminderDue({ ...base, unsubscribed: true }, NOW)).toEqual({ due: false, reason: 'unsubscribed' });
    expect(profileReminderDue({ ...base, disabled: true }, NOW)).toEqual({ due: false, reason: 'disabled' });
    expect(profileReminderDue({ ...base, flagOn: false }, NOW)).toEqual({ due: false, reason: 'flag_off' });
  });
});
