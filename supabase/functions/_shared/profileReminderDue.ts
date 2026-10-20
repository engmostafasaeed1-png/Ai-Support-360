/** Pure due-selection for daily consultant profile reminders (Feature B). */

export interface ProfileReminderState {
  /** Sign-up time (ms epoch). */
  signedUpAt: number;
  /** Last reminder send (ms epoch), or null when none was sent yet. */
  lastSentAt: number | null;
  /** Every profile item is complete (the fields part of completion; the AI interview is checked separately). */
  complete: boolean;
  /** At least one AI interview is completed; a pending or never-started session does not count. */
  interviewDone: boolean;
  unsubscribed: boolean;
  /** Account disabled. */
  disabled: boolean;
  /** Admin flag profile_reminder_emails. */
  flagOn: boolean;
  /** Days of daily reminders before switching to weekly (default 30). */
  dailyDays?: number;
}

export type ProfileReminderDue =
  | { due: true; kind: 'daily' | 'weekly' }
  | { due: false; reason: 'flag_off' | 'disabled' | 'unsubscribed' | 'complete' | 'first_after_24h' | 'cap_20h' | 'weekly_wait' };

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const MIN_GAP_MS = 20 * HOUR_MS;
export const WEEK_MS = 7 * DAY_MS;

export function profileReminderDue(s: ProfileReminderState, now: number): ProfileReminderDue {
  if (!s.flagOn) return { due: false, reason: 'flag_off' };
  if (s.disabled) return { due: false, reason: 'disabled' };
  if (s.unsubscribed) return { due: false, reason: 'unsubscribed' };
  if (s.complete && s.interviewDone) return { due: false, reason: 'complete' };
  const dailyDays = s.dailyDays ?? 30;
  if (s.lastSentAt == null) {
    return now - s.signedUpAt >= DAY_MS ? { due: true, kind: 'daily' } : { due: false, reason: 'first_after_24h' };
  }
  if (now - s.lastSentAt < MIN_GAP_MS) return { due: false, reason: 'cap_20h' };
  if (now - s.signedUpAt >= dailyDays * DAY_MS) {
    return now - s.lastSentAt >= WEEK_MS ? { due: true, kind: 'weekly' } : { due: false, reason: 'weekly_wait' };
  }
  return { due: true, kind: 'daily' };
}
