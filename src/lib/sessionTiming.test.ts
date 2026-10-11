import { describe, expect, it } from 'vitest';
import { canComplete, groupOf, sessionEnd } from './sessionTiming';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const at = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString();
const session = (status: string, minutesFromNow: number, duration: number | null = 60) => ({
  status,
  scheduled_at: at(minutesFromNow),
  duration_minutes: duration,
});

describe('sessionTiming', () => {
  it('a session without a length lasts one hour', () => {
    expect(sessionEnd({ scheduled_at: at(0), duration_minutes: null }) - NOW).toBe(60 * 60_000);
  });

  it('splits sessions into upcoming, to close, completed and cancelled', () => {
    expect(groupOf(session('scheduled', 120), NOW)).toBe('upcoming');
    expect(groupOf(session('scheduled', -30), NOW)).toBe('upcoming'); // running now
    expect(groupOf(session('scheduled', -90), NOW)).toBe('to_close'); // ended 30 minutes ago
    expect(groupOf(session('in_progress', -300), NOW)).toBe('to_close');
    expect(groupOf(session('completed', -300), NOW)).toBe('completed');
    expect(groupOf(session('cancelled', 300), NOW)).toBe('cancelled');
  });

  it('a session can be completed from 15 minutes before it starts', () => {
    expect(canComplete(session('scheduled', 10), NOW)).toBe(true);
    expect(canComplete(session('scheduled', 20), NOW)).toBe(false);
    expect(canComplete(session('scheduled', -600), NOW)).toBe(true);
    expect(canComplete(session('completed', -600), NOW)).toBe(false);
    expect(canComplete(session('cancelled', -600), NOW)).toBe(false);
  });
});
