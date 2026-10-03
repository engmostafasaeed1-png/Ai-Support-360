import { describe, it, expect } from 'vitest';
import { compareRecommended, initialsOf, toConsultantLive, type DirectoryRow } from './consultantDirectory';

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
  linkedin_url: 'https://www.linkedin.com/in/jane-doe',
  linkedin_checked_at: '2026-10-04T10:00:00Z',
  credly_username: 'jane-doe.1a2b3c4d',
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

  it('has no point when only one of the two numbers is there or a number is not valid', () => {
    expect(live({ latitude: 30.04, longitude: null }).lat).toBeNull();
    expect(live({ latitude: null, longitude: 31.24 }).lng).toBeNull();
    expect(live({ latitude: NaN, longitude: 31.24 }).lat).toBeNull();
  });
});

describe('toConsultantLive: LinkedIn and Credly', () => {
  it('says "checked" for a link that the platform team confirmed and "linked" for one that it did not', () => {
    const c = live();
    expect(c.linkedin_state).toBe('checked');
    expect(c.credly_state).toBe('linked');
    expect(c.linkedin_url).toBe('https://www.linkedin.com/in/jane-doe');
    expect(c.credly_username).toBe('jane-doe.1a2b3c4d');
  });

  it('shows no link when there is none', () => {
    const c = live({ linkedin_url: null, credly_username: null, linkedin_checked_at: null });
    expect(c.linkedin_state).toBe('none');
    expect(c.credly_state).toBe('none');
    expect(c.linkedin_url).toBeNull();
  });

  it('shows no link for a stored value that is not a profile address', () => {
    const c = live({ linkedin_url: 'https://evil.example.com/in/jane', credly_username: 'jane doe' });
    expect(c.linkedin_state).toBe('none');
    expect(c.linkedin_url).toBeNull();
    expect(c.credly_state).toBe('none');
    expect(c.credly_username).toBeNull();
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
