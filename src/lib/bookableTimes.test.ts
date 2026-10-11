import { describe, expect, it } from 'vitest';
import { bookableTimes, hasWindowOn, localDateKey, windowsForDate, type WindowRow } from './bookableTimes';

// 14 October 2026 is a Wednesday (getDay() is 3). All dates are local, so the tests do not depend on the time zone.
const WED = new Date(2026, 9, 14);
const THU = new Date(2026, 9, 15);
const LONG_BEFORE = new Date(2026, 9, 1).getTime();
const at = (day: Date, hour: number, minute = 0) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime();

const weekly = (day: number, from: string, to: string): WindowRow => ({ day_of_week: day, start_time: from, end_time: to, is_recurring: true, specific_date: null });
const oneDate = (key: string, from: string, to: string): WindowRow => ({ day_of_week: null, start_time: from, end_time: to, is_recurring: false, specific_date: key });

describe('bookableTimes', () => {
  it('writes a date the way the database column does', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateKey(WED)).toBe('2026-10-14');
  });

  it('offers one-hour starts inside the weekly hours of that weekday', () => {
    const rows = [weekly(3, '09:00:00', '12:00:00'), weekly(4, '09:00:00', '10:00:00')];
    expect(bookableTimes(WED, rows, [], LONG_BEFORE)).toEqual(['09:00', '10:00', '11:00']);
    expect(bookableTimes(THU, rows, [], LONG_BEFORE)).toEqual(['09:00']);
  });

  it('adds the windows that are set for exactly one date', () => {
    const rows = [weekly(3, '09:00', '10:00'), oneDate('2026-10-14', '14:00', '16:00'), oneDate('2026-10-21', '14:00', '16:00')];
    expect(bookableTimes(WED, rows, [], LONG_BEFORE)).toEqual(['09:00', '14:00', '15:00']);
    expect(hasWindowOn(WED, rows)).toBe(true);
    expect(hasWindowOn(THU, rows)).toBe(false);
    expect(windowsForDate(new Date(2026, 9, 21), rows)).toHaveLength(2); // the weekly Wednesday window and the one-date window
  });

  it('leaves out hours that overlap a booking', () => {
    const rows = [weekly(3, '09:00', '13:00')];
    const booked: [number, number][] = [[at(WED, 10, 30), at(WED, 11, 30)]];
    expect(bookableTimes(WED, rows, booked, LONG_BEFORE)).toEqual(['09:00', '12:00']);
  });

  it('leaves out hours that have started already', () => {
    const rows = [weekly(3, '09:00', '12:00')];
    expect(bookableTimes(WED, rows, [], at(WED, 10, 0))).toEqual(['11:00']);
    expect(bookableTimes(WED, rows, [], at(WED, 9, 59))).toEqual(['10:00', '11:00']);
  });

  it('ignores a window that is not recurring and has no date', () => {
    const rows: WindowRow[] = [{ day_of_week: 3, start_time: '09:00', end_time: '12:00', is_recurring: false, specific_date: null }];
    expect(bookableTimes(WED, rows, [], LONG_BEFORE)).toEqual([]);
  });

  it('keeps a start with minutes and does not repeat a start that two windows share', () => {
    const rows = [weekly(3, '09:30', '11:30'), oneDate('2026-10-14', '09:30', '10:30')];
    expect(bookableTimes(WED, rows, [], LONG_BEFORE)).toEqual(['09:30', '10:30']);
  });
});
