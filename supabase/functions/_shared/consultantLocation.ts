/**
 * Consultant location rules (Fix K). Country and city are mandatory for every consultant, independent of the
 * global profile-rules enforcement switch. Only city level is stored and shown (a city or country centre, never an address).
 */
import { cityPoint, countryPoint, placeLabel } from './geo.ts';

/** Profile fields that are always required, whatever the admin field rules or the enforcement switch say. */
export const HARD_REQUIRED_FIELDS: readonly string[] = ['country', 'city'];
export const isHardRequiredField = (key: string): boolean => HARD_REQUIRED_FIELDS.includes(key);

export const DEFAULT_LOCATION_GRACE_DAYS = 7;
export const MAX_LOCATION_GRACE_DAYS = 90;

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Both country and city are filled in. */
export function hasLocation(row: { country?: string | null; city?: string | null } | null | undefined): boolean {
  return !!text(row?.country) && !!text(row?.city);
}

export const LOCATION_REQUIRED_MESSAGE = 'Add your country and city - needed to appear in search and on the map.';

/** The inline error for a location section, or null when it can be saved. */
export function locationError(country: string | null | undefined, city: string | null | undefined): string | null {
  return hasLocation({ country, city }) ? null : LOCATION_REQUIRED_MESSAGE;
}

export type PlacePoint = { lat: number; lng: number; source: 'city' | 'country' };

/**
 * The map point for a chosen place: the listed city centre, else the country centre (stable small offset by seed),
 * so a city typed by hand still gets a pin and nobody is stuck. Null only for an unknown country.
 */
export function resolvePlacePoint(country: string | null | undefined, city: string | null | undefined, seed = ''): PlacePoint | null {
  const c = text(country);
  const town = text(city);
  if (!c) return null;
  const exact = town ? cityPoint(c, town) : null;
  if (exact) return { ...exact, source: 'city' };
  const centre = countryPoint(c, seed);
  return centre ? { ...centre, source: 'country' } : null;
}

export type LocationAudience = 'client' | 'owner' | 'admin';

/**
 * What a location line shows: "City, Country", else whichever part exists.
 * Nothing set: the owner and admins see a "Location not set" badge, clients see nothing at all.
 */
export function locationDisplay(city: string | null | undefined, country: string | null | undefined, audience: LocationAudience): { text: string; unset: boolean } | null {
  const label = placeLabel(city, country);
  if (label) return { text: label, unset: false };
  return audience === 'client' ? null : { text: 'Location not set', unset: true };
}

export type LocationGrace = { state: 'ok' } | { state: 'grace'; deadline: number | null; daysLeft: number | null } | { state: 'blocked'; deadline: number };

/**
 * Grace period for consultants without a location. The deadline is the later of the grace start (the day the rule
 * was switched on) and the consultant's sign-up, plus the grace days. Unknown start: grace without a deadline (never blocks).
 */
export function locationGrace(input: { hasLocation: boolean; graceStartedAt: string | null | undefined; signedUpAt?: string | null; graceDays?: number | null; now: number }): LocationGrace {
  if (input.hasLocation) return { state: 'ok' };
  const start = input.graceStartedAt ? Date.parse(input.graceStartedAt) : NaN;
  if (!Number.isFinite(start)) return { state: 'grace', deadline: null, daysLeft: null };
  const signed = input.signedUpAt ? Date.parse(input.signedUpAt) : NaN;
  const from = Number.isFinite(signed) ? Math.max(start, signed) : start;
  const days = Math.max(0, Math.min(MAX_LOCATION_GRACE_DAYS, Math.round(input.graceDays ?? DEFAULT_LOCATION_GRACE_DAYS)));
  const deadline = from + days * 86_400_000;
  if (input.now >= deadline) return { state: 'blocked', deadline };
  return { state: 'grace', deadline, daysLeft: Math.ceil((deadline - input.now) / 86_400_000) };
}

/** Backfill: the coordinates to propose for a row that has place text but no point. City only (no country): no proposal. */
export function backfillProposal(row: { id: string; country?: string | null; city?: string | null; latitude?: number | null; longitude?: number | null }): (PlacePoint & { id: string }) | null {
  if (typeof row.latitude === 'number' && typeof row.longitude === 'number') return null;
  const point = resolvePlacePoint(row.country, row.city, row.id);
  return point ? { id: row.id, ...point } : null;
}
