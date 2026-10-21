import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_REMINDER, availabilityGrace, availabilityReminderDue, clientHoldNotice, copyToDays, dayGroups, hasWeeklyAvailability, holdDirectoryView,
  holdLabel, holdState, mergeHolds, presetIntervals, shortAvailability, summarizeWeekly, validateHold, validateWeekly, weeklyFromSlots, weeklyHoursText,
  workingWeekFor, type HoldRow,
} from './availabilityRules';
import { buildChecklist, sectionOf } from './profileSubmission';
import { missingAvailabilityCsv, remindable, type MissingAvailabilityRow } from './availabilityAdmin';

const H = 3_600_000;
const D = 86_400_000;
const NOW = Date.parse('2026-10-21T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('weekly availability is a required profile item', () => {
  it('appears in the missing list and links to the availability section', () => {
    expect(sectionOf('availability')).toBe('availability');
    const list = buildChecklist(['bio', 'availability'], 10, (k) => (k === 'availability' ? 'Weekly availability' : k));
    expect(list.missing.map((m) => [m.key, m.sectionId])).toContainEqual(['availability', 'availability']);
  });
  it('only recurring slots count (one-date slots do not)', () => {
    expect(hasWeeklyAvailability(weeklyFromSlots([{ day_of_week: null, specific_date: '2026-11-01', start_time: '09:00:00', end_time: '12:00:00' }]))).toBe(false);
    expect(hasWeeklyAvailability(weeklyFromSlots([{ day_of_week: 0, specific_date: null, start_time: '09:00:00', end_time: '17:00:00' }]))).toBe(true);
  });
});

describe('editor rules', () => {
  it('presets: Sun-Thu 9-17 and Mon-Fri 9-17', () => {
    expect(presetIntervals('sun_thu').map((s) => s.day)).toEqual([0, 1, 2, 3, 4]);
    expect(presetIntervals('mon_fri').map((s) => s.day)).toEqual([1, 2, 3, 4, 5]);
    expect(presetIntervals('mon_fri')[0]).toEqual({ day: 1, start: '09:00', end: '17:00' });
  });
  it('validation: end after start, no overlaps on the same day', () => {
    expect(validateWeekly([{ day: 0, start: '17:00', end: '09:00' }]).map((p) => p.code)).toEqual(['end_before_start']);
    expect(validateWeekly([{ day: 0, start: '09:00', end: '09:00' }]).map((p) => p.code)).toEqual(['end_before_start']);
    expect(validateWeekly([{ day: 0, start: '09:00', end: '13:00' }, { day: 0, start: '12:00', end: '17:00' }]).map((p) => p.code)).toEqual(['overlap', 'overlap']);
    expect(validateWeekly([{ day: 0, start: '09:00', end: '12:00' }, { day: 0, start: '12:00', end: '17:00' }, { day: 1, start: '10:00', end: '11:00' }])).toEqual([]);
    expect(validateWeekly([{ day: 0, start: '9', end: '17:00' }]).map((p) => p.code)).toEqual(['invalid_time']);
  });
  it('copy to all working days replaces the times of the other chosen days', () => {
    const list = [{ day: 0, start: '08:00', end: '12:00' }, { day: 0, start: '13:00', end: '16:00' }, { day: 1, start: '09:00', end: '17:00' }, { day: 2, start: '10:00', end: '11:00' }];
    const out = copyToDays(list, 0, [0, 1, 2]);
    expect(out.filter((s) => s.day === 1)).toEqual([{ day: 1, start: '08:00', end: '12:00' }, { day: 1, start: '13:00', end: '16:00' }]);
    expect(out.filter((s) => s.day === 2)).toHaveLength(2);
    expect(out.filter((s) => s.day === 0)).toHaveLength(2);
  });
  it('live summary: "Sun-Thu, 09:00-17:00 Riyadh time, 40 h/week"', () => {
    expect(summarizeWeekly(presetIntervals('sun_thu'), 'Asia/Riyadh')).toBe('Sun-Thu, 09:00-17:00 Riyadh time, 40 h/week');
    expect(summarizeWeekly(presetIntervals('sun_thu'), 'Asia/Riyadh', 'ar')).toBe('الأحد-الخميس، 09:00-17:00 بتوقيت الرياض، 40 ساعة/أسبوع');
    const mixed = [...presetIntervals('sun_thu').slice(0, 4), { day: 4, start: '09:00', end: '13:00' }];
    expect(summarizeWeekly(mixed, 'Africa/Cairo')).toBe('Sun-Wed 09:00-17:00 · Thu 09:00-13:00, Cairo time, 36 h/week');
    expect(weeklyHoursText([{ day: 1, start: '09:00', end: '11:30' }])).toBe('2.5');
    expect(summarizeWeekly([], 'Asia/Riyadh')).toBe('No weekly availability yet');
  });
  it('card line: "Available Sun-Thu 09-17"', () => {
    expect(shortAvailability(presetIntervals('sun_thu'))).toBe('Available Sun-Thu 09-17');
    expect(shortAvailability(presetIntervals('mon_fri'), 'ar')).toBe('متاح الاثنين-الجمعة 09-17');
    expect(shortAvailability([{ day: 6, start: '09:30', end: '12:00' }])).toBe('Available Sat 09:30-12');
    expect(shortAvailability([])).toBeNull();
    expect(dayGroups([{ day: 0, start: '09:00', end: '17:00' }, { day: 2, start: '09:00', end: '17:00' }])).toHaveLength(2);
  });
  it('the profile "Working week" follows the chosen days', () => {
    expect(workingWeekFor(presetIntervals('sun_thu'))).toBe('Sunday to Thursday');
    expect(workingWeekFor(presetIntervals('mon_fri'))).toBe('Monday to Friday');
    expect(workingWeekFor([{ day: 3, start: '09:00', end: '10:00' }])).toBeNull();
  });
});

describe('grace period (default 7 days from today or sign-up)', () => {
  const base = { missing: true, required: true, graceStartedAt: iso(NOW - 2 * D), graceDays: 7 };
  it('inside the grace period: deadline and days left', () => {
    expect(availabilityGrace({ ...base, signedUpAt: iso(NOW - 30 * D), now: NOW })).toEqual({ state: 'grace', deadline: NOW + 5 * D, daysLeft: 5 });
  });
  it('a later sign-up gets its own 7 days', () => {
    expect(availabilityGrace({ ...base, signedUpAt: iso(NOW - D), now: NOW })).toMatchObject({ state: 'grace', daysLeft: 6 });
  });
  it('after it: left out of new matching (blocked)', () => {
    expect(availabilityGrace({ ...base, signedUpAt: iso(NOW - 30 * D), now: NOW + 6 * D }).state).toBe('blocked');
  });
  it('never blocked once filled or when the admin made it optional', () => {
    expect(availabilityGrace({ ...base, missing: false, now: NOW + 60 * D }).state).toBe('ok');
    expect(availabilityGrace({ ...base, required: false, now: NOW + 60 * D }).state).toBe('ok');
  });
});

describe('urgent notice and reminder cadence', () => {
  const at = (h: number) => iso(NOW - h * H);
  const base = { required: true, missing: true, onHold: false, now: NOW };
  it('first the one-time urgent notice', () => {
    expect(availabilityReminderDue({ ...base, firstAt: null, reminders: 0, lastTouchAt: null })).toBe('first');
  });
  it('then every 2 days', () => {
    expect(availabilityReminderDue({ ...base, firstAt: at(24), reminders: 0, lastTouchAt: at(24) })).toBe('wait');
    expect(availabilityReminderDue({ ...base, firstAt: at(44), reminders: 0, lastTouchAt: at(44) })).toBe('due');
    expect(availabilityReminderDue({ ...base, firstAt: at(400), reminders: 7, lastTouchAt: at(45) })).toBe('due');
  });
  it('after 8 reminders: weekly', () => {
    expect(AVAILABILITY_REMINDER.max).toBe(8);
    expect(availabilityReminderDue({ ...base, firstAt: at(900), reminders: 8, lastTouchAt: at(50) })).toBe('wait');
    expect(availabilityReminderDue({ ...base, firstAt: at(900), reminders: 8, lastTouchAt: at(164) })).toBe('due');
  });
  it('stops at once when filled, on hold or not required', () => {
    expect(availabilityReminderDue({ ...base, missing: false, firstAt: at(100), reminders: 1, lastTouchAt: at(100) })).toBe('stop');
    expect(availabilityReminderDue({ ...base, onHold: true, firstAt: at(100), reminders: 1, lastTouchAt: at(100) })).toBe('stop');
    expect(availabilityReminderDue({ ...base, required: false, firstAt: null, reminders: 0, lastTouchAt: null })).toBe('stop');
  });
});

describe('hold validation', () => {
  const v = (start: number | null, end: number | null, extra: Partial<Parameters<typeof validateHold>[0]> = {}) =>
    validateHold({ startsAt: start == null ? null : iso(start), endsAt: end == null ? null : iso(end), now: NOW, ...extra });
  it('start defaults to now; end is required', () => {
    expect(v(null, NOW + 3 * D)).toEqual([]);
    expect(v(null, null)).toContain('end_required');
  });
  it('maximum duration (default 90 days, admin setting)', () => {
    expect(v(NOW, NOW + 90 * D)).toEqual([]);
    expect(v(NOW, NOW + 91 * D)).toContain('too_long');
    expect(v(NOW, NOW + 31 * D, { maxDays: 30 })).toContain('too_long');
  });
  it('future holds up to 180 days ahead; never in the past', () => {
    expect(v(NOW + 180 * D, NOW + 181 * D)).toEqual([]);
    expect(v(NOW + 181 * D, NOW + 182 * D)).toContain('too_far_ahead');
    expect(v(NOW - H, NOW + D)).toContain('start_in_past');
    expect(v(NOW - 2 * 60_000, NOW + D)).toEqual([]);
    expect(v(NOW + 2 * D, NOW + D)).toContain('end_before_start');
  });
  it('private reason: no contact details, at most 500 characters', () => {
    expect(v(null, NOW + D, { reason: 'Family leave' })).toEqual([]);
    expect(v(null, NOW + D, { reason: 'mail me at sara@example.com' })).toContain('reason_contact');
    expect(v(null, NOW + D, { reason: 'x'.repeat(501) })).toContain('reason_too_long');
  });
});

describe('hold start / end / merge', () => {
  const h = (id: string, s: number, e: number, status: HoldRow['status'] = 'scheduled'): HoldRow => ({ id, starts_at: iso(s), ends_at: iso(e), status });
  it('time-based state: scheduled, active, ended (automatic resume)', () => {
    expect(holdState(h('a', NOW + D, NOW + 2 * D), NOW)).toBe('scheduled');
    expect(holdState(h('a', NOW - D, NOW + D), NOW)).toBe('active');
    expect(holdState(h('a', NOW - 2 * D, NOW - 1), NOW)).toBe('ended');
    expect(holdState(h('a', NOW - D, NOW + D, 'cancelled'), NOW)).toBe('cancelled');
  });
  it('an overlapping or touching hold is merged; a separate one is kept', () => {
    const existing = [h('a', NOW, NOW + 10 * D, 'active'), h('b', NOW + 40 * D, NOW + 45 * D), h('c', NOW + 20 * D, NOW + 25 * D)];
    const m = mergeHolds(existing, { starts_at: iso(NOW + 9 * D), ends_at: iso(NOW + 20 * D) });
    expect(m.merged.sort()).toEqual(['a', 'c']);
    expect(m.starts_at).toBe(iso(NOW));
    expect(m.ends_at).toBe(iso(NOW + 25 * D));
    expect(mergeHolds(existing, { starts_at: iso(NOW + 60 * D), ends_at: iso(NOW + 61 * D) }).merged).toEqual([]);
    expect(mergeHolds([h('x', NOW, NOW + D, 'ended')], { starts_at: iso(NOW), ends_at: iso(NOW + D) }).merged).toEqual([]);
  });
});

describe('directory label and client notice', () => {
  const end = '2026-11-15T08:00:00Z';
  it('"On hold until 15 Nov 2026", not selectable; hidden in hide mode', () => {
    expect(holdLabel(end)).toBe('On hold until 15 Nov 2026');
    expect(holdLabel(end, 'ar')).toBe('متوقف مؤقتًا حتى 2026-11-15');
    expect(holdDirectoryView(end, 'label')).toEqual({ hidden: false, label: 'On hold until 15 Nov 2026', selectable: false });
    expect(holdDirectoryView(end, 'hide')).toEqual({ hidden: true, label: null, selectable: false });
    expect(holdDirectoryView(null, 'hide')).toEqual({ hidden: false, label: null, selectable: true });
  });
  it('client notice text (same as the database)', () => {
    expect(clientHoldNotice('2026-11-01T08:00:00Z', end)).toBe('Your consultant is on hold from 1 Nov 2026 to 15 Nov 2026, current work continues as agreed.');
    expect(clientHoldNotice('2026-11-01T08:00:00Z', end, 'ar')).toBe('مستشارك متوقف مؤقتًا من 2026-11-01 إلى 2026-11-15، ويستمر العمل الحالي كما هو متفق عليه.');
  });
  it('Riyadh date: late UTC evening already counts as the next day', () => {
    expect(holdLabel('2026-11-14T22:30:00Z')).toBe('On hold until 15 Nov 2026');
  });
});

describe('admin list', () => {
  const row = (p: Partial<MissingAvailabilityRow>): MissingAvailabilityRow => ({ consultant_id: 'c1', display_name: 'Sara', email: 's@example.com', verification_status: 'verified', signed_up_at: null, days_since_signup: 3, deadline: null, blocked: false, on_hold: false, last_reminded_at: null, reminders: 0, ...p });
  it('CSV neutralises formulas', () => {
    expect(missingAvailabilityCsv([row({ display_name: '=HYPERLINK("x")' })])).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it('reminder now: skip consultants on hold or reminded in the last 24 hours', () => {
    const now = NOW;
    const rows = [row({ consultant_id: 'a' }), row({ consultant_id: 'b', on_hold: true }), row({ consultant_id: 'c', last_reminded_at: iso(now - 2 * H) }), row({ consultant_id: 'd', last_reminded_at: iso(now - 25 * H) })];
    expect(remindable(rows, now).map((r) => r.consultant_id)).toEqual(['a', 'd']);
  });
});
