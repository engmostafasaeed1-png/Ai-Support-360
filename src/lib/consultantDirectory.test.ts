import { describe, it, expect } from 'vitest';
import { compareRecommended, passesListFilter, initialsOf, toConsultantLive, type DirectoryRow } from './consultantDirectory';

const ROW: DirectoryRow = {
  id: 'c-1',
  rating: 4.6,
  total_reviews: 12,
  hourly_rate: 150,
  availability_status: 'available',
  verification_status: 'verified',
  response_time_minutes: 20,
  industries: ['banking'],
  languages: ['en', 'ar'],
  city: 'Cairo',
  country: 'Egypt',
  latitude: 30.04,
  longitude: 31.24,
  linkedin_checked_at: '2026-10-04T10:00:00Z',
  credly_checked_at: null,
  credibility_credits: 75,
  ai_interview_badge: 'Gold',
};

const live = (patch: Partial<DirectoryRow> = {}) => toConsultantLive({ ...ROW, ...patch }, 'Jane Doe', ['SAP FI/CO', 'SAP MM']);

describe('toConsultantLive: availability', () => {
  it('shows the three states as the consultant set them', () => {
    expect(live({ availability_status: 'available' }).status).toBe('available');
    expect(live({ availability_status: 'busy' }).status).toBe('busy');
    expect(live({ availability_status: 'offline' }).status).toBe('offline');
  });

  it('counts only Online as available', () => {
    expect(live({ availability_status: 'available' }).available).toBe(true);
    expect(live({ availability_status: 'busy' }).available).toBe(false);
    expect(live({ availability_status: 'offline' }).available).toBe(false);
  });

  it('shows a missing state as offline', () => {
    expect(live({ availability_status: null }).status).toBe('offline');
  });
});

describe('toConsultantLive: place', () => {
  it('uses the point and the city of the consultant, not a random place and not the time zone', () => {
    const c = live();
    expect(c.lat).toBe(30.04);
    expect(c.lng).toBe(31.24);
    expect(c.city).toBe('Cairo');
    expect(c.country).toBe('Egypt');
    expect(c.place).toBe('Cairo, Egypt');
  });

  it('gives the same answer every time', () => {
    expect(live()).toEqual(live());
  });

  it('has no point when the consultant has not chosen a city', () => {
    const c = live({ city: null, country: null, latitude: null, longitude: null });
    expect(c.lat).toBeNull();
    expect(c.lng).toBeNull();
    expect(c.place).toBe('');
  });

  it('has no point when there is no city and only one of the two numbers is there or a number is not valid', () => {
    const noCity = { city: null, country: null };
    expect(live({ ...noCity, latitude: 30.04, longitude: null }).lat).toBeNull();
    expect(live({ ...noCity, latitude: null, longitude: 31.24 }).lng).toBeNull();
    expect(live({ ...noCity, latitude: NaN, longitude: 31.24 }).lat).toBeNull();
  });

  it('uses the centre of the stored city when there is no point yet (a consultant who gave the city before the map existed)', () => {
    const c = live({ latitude: null, longitude: null });
    expect(c.lat).toBe(30.04);
    expect(c.lng).toBe(31.24);
    expect(live({ latitude: 30.04, longitude: null }).lng).toBe(31.24);
    expect(live({ latitude: NaN, longitude: 31.24 }).lat).toBe(30.04);
  });

  it('keeps the stored point and does not replace it by the centre of the city', () => {
    const c = live({ latitude: 30.1, longitude: 31.3 });
    expect(c.lat).toBe(30.1);
    expect(c.lng).toBe(31.3);
  });

  it('has no point for a city that is not in the list of places', () => {
    const c = live({ city: 'Atlantis', latitude: null, longitude: null });
    expect(c.lat).toBeNull();
    expect(c.lng).toBeNull();
  });
});

describe('toConsultantLive: LinkedIn and Credly', () => {
  it('derives "verified" only from the checks of the platform team', () => {
    const c = live();
    expect(c.linkedinVerified).toBe(true);
    expect(c.credlyVerified).toBe(false);
    expect(c.linkedin_state).toBe('checked');
    expect(c.credly_state).toBe('none');
    expect(live({ credly_checked_at: '2026-10-05T10:00:00Z' }).credlyVerified).toBe(true);
  });

  it('carries no LinkedIn address and no Credly username', () => {
    const c = live() as unknown as Record<string, unknown>;
    expect('linkedin_url' in c).toBe(false);
    expect('credly_username' in c).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/linkedin\.com|credly\.com/);
  });

  it('shows nothing when nothing was checked', () => {
    const c = live({ linkedin_checked_at: null });
    expect(c.linkedinVerified).toBe(false);
    expect(c.linkedin_state).toBe('none');
  });

  it('does not call a consultant "Credly verified" any more', () => {
    expect(live().badges.includes('credly')).toBe(false);
  });
});

describe('toConsultantLive: the rest', () => {
  it('has no match score for a real consultant', () => {
    expect(live().matchScore).toBeUndefined();
  });

  it('gives the badges of verification, rating and answering time', () => {
    expect(live().badges).toEqual(['verified', 'top_rated', 'fast_responder']);
    expect(live({ verification_status: 'pending', rating: 4, response_time_minutes: 90 }).badges).toEqual([]);
  });

  it('uses the first skill as the specialty and the name from the profile', () => {
    const c = live();
    expect(c.specialty).toBe('SAP FI/CO');
    expect(c.name).toBe('Jane Doe');
    expect(c.avatar).toBe('JD');
    expect(toConsultantLive(ROW, null, []).name).toBe('Consultant');
    expect(toConsultantLive(ROW, null, []).specialty).toBe('SAP');
  });

  it('copes with empty lists and texts for numbers', () => {
    const c = live({ languages: [], industries: null, rating: '4.25', hourly_rate: '99.5', total_reviews: null });
    expect(c.languages).toEqual(['en']);
    expect(c.industries).toEqual([]);
    expect(c.rating).toBe(4.25);
    expect(c.rate).toBe(99.5);
    expect(c.reviews).toBe(0);
  });
});

describe('initialsOf', () => {
  it('takes the first letters of the first two words', () => {
    expect(initialsOf('Jane Doe')).toBe('JD');
    expect(initialsOf('  jane   van  der Berg ')).toBe('JV');
    expect(initialsOf('Madonna')).toBe('M');
    expect(initialsOf('')).toBe('');
  });
});

describe('compareRecommended', () => {
  const p = (name: string, status: 'available' | 'busy' | 'offline', rating: number, reviews: number) => ({ name, status, rating, reviews });

  it('puts online first, then busy, then offline', () => {
    const sorted = [p('c', 'offline', 5, 100), p('b', 'busy', 5, 100), p('a', 'available', 1, 0)].sort(compareRecommended);
    expect(sorted.map(x => x.name)).toEqual(['a', 'b', 'c']);
  });

  it('puts the better rated first inside a state, then the one with more reviews, then by name', () => {
    const sorted = [p('d', 'available', 4, 5), p('c', 'available', 4.5, 1), p('b', 'available', 4.5, 9), p('a', 'available', 4.5, 9)].sort(compareRecommended);
    expect(sorted.map(x => x.name)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('toConsultantLive: experience lists', () => {
  it('maps the experience columns and defaults missing lists to []', () => {
    const c = live({ customer_segments: ['Mid-market company'], localization_countries: ['Saudi Arabia'], project_scale: 'Large' });
    expect(c.customer_segments).toEqual(['Mid-market company']);
    expect(c.localization_countries).toEqual(['Saudi Arabia']);
    expect(c.vertical_solutions).toEqual([]);
    expect(c.project_scale).toBe('Large');
    expect(c.working_week).toBeNull();
  });
});

describe('passesListFilter', () => {
  it('passes everyone without a choice and only consultants with the label otherwise', () => {
    expect(passesListFilter([], 'all')).toBe(true);
    expect(passesListFilter(undefined, '')).toBe(true);
    expect(passesListFilter(['Saudi Arabia'], 'Saudi Arabia')).toBe(true);
    expect(passesListFilter(['Egypt'], 'Saudi Arabia')).toBe(false);
  });
});
