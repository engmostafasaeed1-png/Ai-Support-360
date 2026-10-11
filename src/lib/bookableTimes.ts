/**
 * Which times can a client book on a day? One rule, used by the booking dialog and by the Availability tab of a consultant profile.
 * A window is either the weekly hours of a weekday, or a time on exactly one date (specific_date set, no weekday).
 */
export interface WindowRow {
  day_of_week: number | null;
  start_time: string;
  end_time: string;
  is_recurring: boolean | null;
  specific_date: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** yyyy-mm-dd of a date in the local time zone: the form of the database column specific_date. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const toMinutes = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** The windows that count for one calendar day: the weekly hours of that weekday plus the windows set for exactly that date. */
export function windowsForDate(date: Date, rows: WindowRow[]): WindowRow[] {
  const key = localDateKey(date);
  const weekday = date.getDay();
  return rows.filter((s) => s.specific_date === key || ((s.is_recurring ?? true) && s.day_of_week === weekday && !s.specific_date));
}

export function hasWindowOn(date: Date, rows: WindowRow[]): boolean {
  return windowsForDate(date, rows).length > 0;
}

/**
 * Start times ("HH:mm") at which a one-hour session can be booked on a date: the hour lies inside a window,
 * starts in the future and does not overlap a time that is already booked ([start, end) in milliseconds).
 */
export function bookableTimes(date: Date, rows: WindowRow[], booked: [number, number][], now: number): string[] {
  const out = new Set<string>();
  for (const w of windowsForDate(date, rows)) {
    for (let m = toMinutes(w.start_time); m + 60 <= toMinutes(w.end_time); m += 60) {
      const start = new Date(date);
      start.setHours(Math.floor(m / 60), m % 60, 0, 0);
      const st = start.getTime();
      const en = st + 60 * 60_000;
      if (st <= now) continue;
      if (booked.some(([bs, be]) => st < be && en > bs)) continue;
      out.add(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    }
  }
  return Array.from(out).sort();
}
