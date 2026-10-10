import { describe, it, expect } from 'vitest';
import { isSlotPast, nowInZone } from './demoSlots';

// 10:30 in Riyadh (UTC+3), 00:30 in Los Angeles (UTC-7), 07:30 UTC
const NOW = new Date('2026-10-10T07:30:00Z');

describe('nowInZone', () => {
  it('reads the date and the minutes in the timezone', () => {
    expect(nowInZone('Asia/Riyadh', NOW)).toEqual({ date: '2026-10-10', minutes: 10 * 60 + 30 });
    expect(nowInZone('America/Los_Angeles', NOW)).toEqual({ date: '2026-10-10', minutes: 30 });
  });
  it('uses UTC for an unknown timezone', () => {
    expect(nowInZone('Mars/Base', NOW)).toEqual({ date: '2026-10-10', minutes: 7 * 60 + 30 });
  });
});

describe('isSlotPast', () => {
  it('is past before the current time and not past after it', () => {
    expect(isSlotPast('2026-10-10', '10:00', 'Asia/Riyadh', NOW)).toBe(true);
    expect(isSlotPast('2026-10-10', '10:30', 'Asia/Riyadh', NOW)).toBe(true);
    expect(isSlotPast('2026-10-10', '11:00', 'Asia/Riyadh', NOW)).toBe(false);
  });
  it('compares whole days', () => {
    expect(isSlotPast('2026-10-09', '23:59', 'Asia/Riyadh', NOW)).toBe(true);
    expect(isSlotPast('2026-10-11', '00:00', 'Asia/Riyadh', NOW)).toBe(false);
  });
  it('depends on the timezone', () => {
    expect(isSlotPast('2026-10-10', '09:00', 'America/Los_Angeles', NOW)).toBe(false);
    expect(isSlotPast('2026-10-10', '09:00', 'Asia/Riyadh', NOW)).toBe(true);
  });
  it('does not count a value that cannot be read as past', () => {
    expect(isSlotPast('', '10:00', 'Asia/Riyadh', NOW)).toBe(false);
    expect(isSlotPast('2026-10-10', '', 'Asia/Riyadh', NOW)).toBe(false);
  });
});
