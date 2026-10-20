import { describe, expect, it } from 'vitest';
import {
  HARD_REQUIRED_FIELDS, isHardRequiredField, locationError, locationGrace, locationDisplay, resolvePlacePoint,
  hasLocation, backfillProposal, LOCATION_REQUIRED_MESSAGE,
} from '@/lib/consultantLocation';
import { missingLocationCsv, csvCell } from '@/lib/missingLocationCsv';

const DAY = 86_400_000;
const START = '2026-11-01T00:00:00Z';
const at = (iso: string) => Date.parse(iso);

describe('hard-required location', () => {
  it('country and city are always required, whatever the admin rules say', () => {
    expect([...HARD_REQUIRED_FIELDS]).toEqual(['country', 'city']);
    expect(isHardRequiredField('country')).toBe(true);
    expect(isHardRequiredField('city')).toBe(true);
    expect(isHardRequiredField('linkedin_url')).toBe(false);
  });

  it('blocks saving without both country and city', () => {
    expect(locationError('', '')).toBe(LOCATION_REQUIRED_MESSAGE);
    expect(locationError('Egypt', '')).toBe(LOCATION_REQUIRED_MESSAGE);
    expect(locationError('', 'Cairo')).toBe(LOCATION_REQUIRED_MESSAGE);
    expect(locationError('Egypt', '   ')).toBe(LOCATION_REQUIRED_MESSAGE);
    expect(locationError('Egypt', 'Cairo')).toBeNull();
    expect(hasLocation(null)).toBe(false);
  });
});

describe('location grace period (default 7 days, counted from the start)', () => {
  const base = { hasLocation: false, graceStartedAt: START, signedUpAt: '2026-01-01T00:00:00Z', graceDays: 7 };

  it('a consultant with a location is never blocked', () => {
    expect(locationGrace({ ...base, hasLocation: true, now: at(START) + 100 * DAY })).toEqual({ state: 'ok' });
  });

  it('without the start date (rules not switched on) nobody is blocked', () => {
    expect(locationGrace({ ...base, graceStartedAt: null, now: at(START) + 100 * DAY }).state).toBe('grace');
  });

  it('inside the 7 days: grace with days left', () => {
    expect(locationGrace({ ...base, now: at(START) + 2 * DAY })).toEqual({ state: 'grace', deadline: at(START) + 7 * DAY, daysLeft: 5 });
  });

  it('on the 7th day and after: blocked', () => {
    expect(locationGrace({ ...base, now: at(START) + 7 * DAY }).state).toBe('blocked');
    expect(locationGrace({ ...base, now: at(START) + 30 * DAY }).state).toBe('blocked');
  });

  it('a consultant who signed up after the start gets their own full 7 days', () => {
    const signed = '2026-11-20T00:00:00Z';
    expect(locationGrace({ ...base, signedUpAt: signed, now: at(signed) + 6 * DAY }).state).toBe('grace');
    expect(locationGrace({ ...base, signedUpAt: signed, now: at(signed) + 7 * DAY }).state).toBe('blocked');
  });

  it('uses the admin-edited days and clamps them to 0-90', () => {
    expect(locationGrace({ ...base, graceDays: 14, now: at(START) + 10 * DAY }).state).toBe('grace');
    expect(locationGrace({ ...base, graceDays: 0, now: at(START) }).state).toBe('blocked');
    expect(locationGrace({ ...base, graceDays: 500, now: at(START) + 91 * DAY }).state).toBe('blocked');
    expect(locationGrace({ ...base, graceDays: null, now: at(START) + 6 * DAY }).state).toBe('grace');
  });
});

describe('location display fallbacks', () => {
  it('shows "City, Country" for everyone', () => {
    for (const a of ['client', 'owner', 'admin'] as const) expect(locationDisplay('Cairo', 'Egypt', a)).toEqual({ text: 'Cairo, Egypt', unset: false });
  });

  it('falls back to the country only', () => {
    expect(locationDisplay('', 'Egypt', 'client')).toEqual({ text: 'Egypt', unset: false });
  });

  it('nothing set: badge for the owner and admins, nothing for clients', () => {
    expect(locationDisplay(null, null, 'client')).toBeNull();
    expect(locationDisplay(null, null, 'owner')).toEqual({ text: 'Location not set', unset: true });
    expect(locationDisplay('', ' ', 'admin')).toEqual({ text: 'Location not set', unset: true });
  });
});

describe('map point (city level only)', () => {
  it('uses the listed city centre', () => {
    expect(resolvePlacePoint('Egypt', 'Cairo')).toEqual({ lat: 30.04, lng: 31.24, source: 'city' });
  });

  it('falls back to the country centre for a city typed by hand, so nobody gets stuck', () => {
    const p = resolvePlacePoint('Saudi Arabia', 'Small Village', 'c1');
    expect(p?.source).toBe('country');
    expect(p && p.lat > 16 && p.lat < 33 && p.lng > 34 && p.lng < 56).toBe(true);
    expect(resolvePlacePoint('Saudi Arabia', 'Small Village', 'c1')).toEqual(p);
  });

  it('no country: no point', () => {
    expect(resolvePlacePoint('', 'Cairo')).toBeNull();
  });

  it('backfill proposes a point only for rows with a place but no coordinates', () => {
    expect(backfillProposal({ id: 'a', country: 'Egypt', city: 'Cairo', latitude: 30, longitude: 31 })).toBeNull();
    expect(backfillProposal({ id: 'a', country: 'Egypt', city: 'Cairo' })).toMatchObject({ id: 'a', source: 'city' });
    expect(backfillProposal({ id: 'a', city: 'Cairo' })).toBeNull();
  });
});

describe('missing-location CSV', () => {
  it('neutralises formulas and quotes cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell(null)).toBe('""');
  });

  it('has one header line and one line per consultant', () => {
    const csv = missingLocationCsv([{ consultant_id: 'id1', display_name: 'Sara', email: 's@example.com', verification_status: 'verified', signed_up_at: null, country: null, city: null, deadline: null, blocked: true, last_reminded_at: null }]);
    const lines = csv.replace('\uFEFF', '').split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Sara"');
    expect(lines[1]).toContain('"yes"');
  });
});
