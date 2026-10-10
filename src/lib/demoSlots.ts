/**
 * The slots of the demo wizard and of the reschedule form. "Today" and "now" are read in the timezone of the request:
 * the same rule as the database function assert_demo_slot_not_past.
 */

/** The date (YYYY-MM-DD) and the minutes since midnight right now in a timezone. An unknown timezone name counts as UTC, like in the database. */
export function nowInZone(tz: string, now: Date = new Date()): { date: string; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** True when the time (HH:MM) on the date (YYYY-MM-DD) has passed in the timezone. A date or time that cannot be read is not counted as past. */
export function isSlotPast(date: string, time: string, tz: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const current = nowInZone(tz, now);
  if (date < current.date) return true;
  if (date > current.date) return false;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return false;
  return Number(m[1]) * 60 + Number(m[2]) <= current.minutes;
}
