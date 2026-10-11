/**
 * Timing rules of a consultation session; the consultant calendar and its tests use them.
 * The database has the same rule for "Mark as completed" (function complete_session): from 15 minutes before the start.
 */
export const COMPLETE_GRACE_MINUTES = 15;

export interface TimedSession {
  status: string;
  scheduled_at: string;
  duration_minutes: number | null;
}

export function sessionStart(s: Pick<TimedSession, 'scheduled_at'>): number {
  return new Date(s.scheduled_at).getTime();
}

/** The planned end of a session (a session without a length counts as one hour, like the booking rule of the database). */
export function sessionEnd(s: Pick<TimedSession, 'scheduled_at' | 'duration_minutes'>): number {
  return sessionStart(s) + Math.max(s.duration_minutes || 60, 1) * 60_000;
}

export function canComplete(s: TimedSession, now: number): boolean {
  return (s.status === 'scheduled' || s.status === 'in_progress') && sessionStart(s) <= now + COMPLETE_GRACE_MINUTES * 60_000;
}

export type SessionGroup = 'upcoming' | 'to_close' | 'completed' | 'cancelled';

/** upcoming = not over yet; to_close = the planned end has passed but nobody completed or cancelled the session. */
export function groupOf(s: TimedSession, now: number): SessionGroup {
  if (s.status === 'completed') return 'completed';
  if (s.status === 'cancelled') return 'cancelled';
  return sessionEnd(s) < now ? 'to_close' : 'upcoming';
}
