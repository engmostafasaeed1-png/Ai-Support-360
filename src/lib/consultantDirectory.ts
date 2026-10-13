// What the consultants directory (list, cards and map for clients) shows about a consultant, made from a row of the table `consultants`.
// The place is the centre of the consultant's city; the availability is what the consultant set (Online, Busy, Offline).
// LinkedIn and Credly are "linked" (given by the consultant) or "checked" (confirmed by the platform team); nothing here claims more than that.

import { STATE_META, availabilityState, type AvailabilityState } from './mapMarkers';
import type { LinkState } from './consultantLinks';
import { cityPoint, countryPoint, placeLabel } from './geo';

export interface ConsultantLive {
  id: string;
  name: string;
  specialty: string;
  /** Every module of the consultant (the specialty is the first one). */
  skills?: string[];
  rating: number;
  reviews: number;
  rate: number;
  avatar: string;
  /** True only for Online; Busy and Offline are false. */
  available: boolean;
  status: AvailabilityState;
  /** Only in the demo data. A real consultant has none: the list does not know which request it is for. */
  matchScore?: number;
  badges: string[];
  /** The centre of the consultant's city, or null when the consultant has not chosen a city. */
  lat: number | null;
  lng: number | null;
  /** True when the pin is only the centre of the consultant's country. */
  approximate?: boolean;
  city: string;
  country: string;
  /** "Cairo, Egypt", or an empty text. */
  place: string;
  industries: string[];
  /** True when the platform team has checked the consultant's LinkedIn profile. The link itself is never sent to clients. */
  linkedinVerified: boolean;
  /** True when the platform team has checked the consultant's Credly profile. The username itself is never sent to clients. */
  credlyVerified: boolean;
  linkedin_state: LinkState;
  credly_state: LinkState;
  languages: string[];
  response_time_minutes: number;
  verification_status: string;
  credibility_credits?: number;
  ai_interview_badge?: string | null;
  /** Weekly working hours, e.g. "Mon 09:00–17:00". */
  hours?: string[];
  customer_segments?: string[];
  vertical_solutions?: string[];
  localization_countries?: string[];
  localization_solutions?: string[];
  project_types?: string[];
  deployment_experience?: string[];
  project_scale?: string | null;
  work_modes?: string[];
  working_week?: string | null;
}

/** The columns of `consultants` that the directory reads. */
export interface DirectoryRow {
  id: string;
  rating: number | string | null;
  total_reviews: number | null;
  hourly_rate: number | string | null;
  availability_status: string | null;
  verification_status: string | null;
  response_time_minutes: number | null;
  industries: string[] | null;
  languages: string[] | null;
  city: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  linkedin_checked_at: string | null;
  credly_checked_at: string | null;
  credibility_credits?: number | null;
  ai_interview_badge?: string | null;
  customer_segments?: string[] | null;
  vertical_solutions?: string[] | null;
  localization_countries?: string[] | null;
  localization_solutions?: string[] | null;
  project_types?: string[] | null;
  deployment_experience?: string[] | null;
  project_scale?: string | null;
  work_modes?: string[] | null;
  working_week?: string | null;
}

/** True when the consultant passes a single-choice filter: no choice ('' or 'all') passes everyone; otherwise the label must be in the list. */
export function passesListFilter(list: string[] | null | undefined, chosen: string): boolean {
  if (!chosen || chosen === 'all') return true;
  return (list || []).includes(chosen);
}

export interface ExperienceFilters { segment: string; country: string; vertical: string }

/** True when the consultant passes the customer segment, localization country and vertical solution filters together. */
export function matchesExperienceFilters(
  c: Pick<ConsultantLive, 'customer_segments' | 'localization_countries' | 'vertical_solutions'>,
  f: ExperienceFilters,
): boolean {
  return passesListFilter(c.customer_segments, f.segment)
    && passesListFilter(c.localization_countries, f.country)
    && passesListFilter(c.vertical_solutions, f.vertical);
}

/**
 * The place of a consultant on the map: the point that is stored; when there is none, the centre of the stored city if that city is in the list of places
 * (consultants who gave their city before the map existed have a city but no point). No city in the list: null, and the consultant is not on the map.
 */
export function consultantPoint(row: Pick<DirectoryRow, 'latitude' | 'longitude' | 'city' | 'country'> & { id?: string }): { lat: number; lng: number; approximate?: boolean } | null {
  const { latitude, longitude } = row;
  if (typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { lat: latitude, lng: longitude };
  }
  const city = row.city && row.country ? cityPoint(row.country, row.city) : null;
  if (city) return city;
  // No point and no known city: the centre of the country (with a small stable offset), marked as approximate.
  const country = countryPoint(row.country, row.id ?? '');
  return country ? { ...country, approximate: true } : null;
}

/** The first letters of the first two words of a name. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(word => Array.from(word)[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function toConsultantLive(row: DirectoryRow, displayName: string | null | undefined, skills: string[]): ConsultantLive {
  const name = displayName || 'Consultant';
  const status = availabilityState(row.availability_status);
  const where = consultantPoint(row);
  const linkedinVerified = !!row.linkedin_checked_at;
  const credlyVerified = !!row.credly_checked_at;
  const rating = Number(row.rating) || 0;
  const responseTime = row.response_time_minutes || 0;

  const badges: string[] = [];
  if (row.verification_status === 'verified') badges.push('verified');
  if (rating >= 4.5) badges.push('top_rated');
  if ((row.response_time_minutes || 999) <= 30) badges.push('fast_responder');

  return {
    id: row.id,
    name,
    specialty: skills[0] || 'SAP',
    skills,
    rating,
    reviews: row.total_reviews || 0,
    rate: Number(row.hourly_rate) || 0,
    avatar: initialsOf(name),
    available: status === 'available',
    status,
    badges,
    lat: where ? where.lat : null,
    lng: where ? where.lng : null,
    approximate: !!where?.approximate,
    city: row.city ?? '',
    country: row.country ?? '',
    place: placeLabel(row.city, row.country),
    industries: row.industries || [],
    linkedinVerified,
    credlyVerified,
    linkedin_state: linkedinVerified ? 'checked' : 'none',
    credly_state: credlyVerified ? 'checked' : 'none',
    languages: row.languages && row.languages.length > 0 ? row.languages : ['en'],
    response_time_minutes: responseTime,
    verification_status: row.verification_status || 'pending',
    credibility_credits: row.credibility_credits || 0,
    ai_interview_badge: row.ai_interview_badge || null,
    customer_segments: row.customer_segments || [],
    vertical_solutions: row.vertical_solutions || [],
    localization_countries: row.localization_countries || [],
    localization_solutions: row.localization_solutions || [],
    project_types: row.project_types || [],
    deployment_experience: row.deployment_experience || [],
    project_scale: row.project_scale || null,
    work_modes: row.work_modes || [],
    working_week: row.working_week || null,
  };
}

const moduleKey = (value: string) => value.toLowerCase().replace(/^sap\s+/, '').trim();

/** True when the consultant has the module. Compared without case and without a leading "SAP ": "SAP FI" and "FI" are the same module. */
export function hasModule(c: Pick<ConsultantLive, 'specialty' | 'skills'>, module: string): boolean {
  const wanted = moduleKey(module);
  if (!wanted) return true;
  const all = c.skills && c.skills.length > 0 ? c.skills : [c.specialty];
  return all.some(s => moduleKey(s) === wanted);
}

/** True when the text is found in the name of any module of the consultant. */
export function skillMatchesText(c: Pick<ConsultantLive, 'specialty' | 'skills'>, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  const all = c.skills && c.skills.length > 0 ? c.skills : [c.specialty];
  return all.some(s => s.toLowerCase().includes(q));
}

type Rankable = Pick<ConsultantLive, 'status' | 'rating' | 'reviews' | 'name'>;

/** Online first, then busy, then offline; inside a state the better rated and the one with more reviews first, then by name. */
export function compareRecommended(a: Rankable, b: Rankable): number {
  return (
    STATE_META[a.status].order - STATE_META[b.status].order ||
    b.rating - a.rating ||
    b.reviews - a.reviews ||
    a.name.localeCompare(b.name)
  );
}

export interface WeeklySlot { day_of_week: number; start_time: string; end_time: string }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One line per weekday: "Mon 09:00–12:00, 13:00–17:00", Monday first. */
export function formatWeeklyHours(slots: WeeklySlot[]): string[] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.flatMap(d => {
    const day = slots.filter(s => s.day_of_week === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
    if (day.length === 0) return [];
    return [`${DAYS[d]} ${day.map(s => `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`).join(', ')}`];
  });
}
