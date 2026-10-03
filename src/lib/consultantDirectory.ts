// What the consultants directory (list, cards and map for clients) shows about a consultant, made from a row of the table `consultants`.
// The place is the centre of the consultant's city; the availability is what the consultant set (Online, Busy, Offline).
// LinkedIn and Credly are "linked" (given by the consultant) or "checked" (confirmed by the platform team); nothing here claims more than that.

import { STATE_META, availabilityState, type AvailabilityState } from './mapMarkers';
import { linkState, normalizeCredlyUsername, normalizeLinkedinUrl, type LinkState } from './consultantLinks';
import { placeLabel } from './geo';

export interface ConsultantLive {
  id: string;
  name: string;
  specialty: string;
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
  city: string;
  country: string;
  /** "Cairo, Egypt", or an empty text. */
  place: string;
  industries: string[];
  credly_username?: string | null;
  linkedin_url: string | null;
  linkedin_state: LinkState;
  credly_state: LinkState;
  languages: string[];
  response_time_minutes: number;
  verification_status: string;
  credibility_credits?: number;
  ai_interview_badge?: string | null;
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
  linkedin_url: string | null;
  linkedin_checked_at: string | null;
  credly_username: string | null;
  credly_checked_at: string | null;
  credibility_credits?: number | null;
  ai_interview_badge?: string | null;
}

function point(row: DirectoryRow): { lat: number; lng: number } | null {
  const { latitude, longitude } = row;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { lat: latitude, lng: longitude } : null;
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
  const where = point(row);
  const linkedin = normalizeLinkedinUrl(row.linkedin_url);
  const credly = normalizeCredlyUsername(row.credly_username);
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
    rating,
    reviews: row.total_reviews || 0,
    rate: Number(row.hourly_rate) || 0,
    avatar: initialsOf(name),
    available: status === 'available',
    status,
    badges,
    lat: where ? where.lat : null,
    lng: where ? where.lng : null,
    city: row.city ?? '',
    country: row.country ?? '',
    place: placeLabel(row.city, row.country),
    industries: row.industries || [],
    credly_username: credly,
    linkedin_url: linkedin,
    linkedin_state: linkState(linkedin, row.linkedin_checked_at),
    credly_state: linkState(credly, row.credly_checked_at),
    languages: row.languages && row.languages.length > 0 ? row.languages : ['en'],
    response_time_minutes: responseTime,
    verification_status: row.verification_status || 'pending',
    credibility_credits: row.credibility_credits || 0,
    ai_interview_badge: row.ai_interview_badge || null,
  };
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
