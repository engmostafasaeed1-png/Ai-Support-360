import { describe, expect, it } from 'vitest';
import { arcPath, arcPattern, ratingArc, ratingTone, respArc, responsivenessScore, ringSummary, ringTier, speedFactor } from './ringAvatar';
import { DEFAULT_FILTERS, passes, sortDirectory, type DirectoryContext } from './directoryFilters';
import type { ConsultantLive } from './consultantDirectory';

describe('outer arc: pure client rating', () => {
  it.each([[2.9, 'red'], [3.0, 'amber'], [3.9, 'amber'], [4.0, 'green'], [4.5, 'green'], [4.6, 'gold'], [5, 'gold']])('%s stars is %s', (r, tone) => {
    expect(ratingTone(Number(r))).toBe(tone);
  });
  it('fills the arc as rating / 5', () => {
    expect(ratingArc(4.8, 12).pct).toBe(96);
    expect(ratingArc(2.5, 4).pct).toBe(50);
  });
  it('shows no arc and "New" when there are no reviews, and never invents a rating', () => {
    const s = ringSummary({ rating: 0, reviews: 0, publicOn: true });
    expect(s.rating.state).toBe('none');
    expect(s.label.startsWith('New')).toBe(true);
    expect(s.text).toContain('no reviews yet');
  });
  it('marks fewer than 3 reviews (default minimum) as a low sample with a dotted lighter arc', () => {
    expect(ratingArc(5, 2).state).toBe('low');
    expect(ratingArc(5, 3).state).toBe('ok');
    expect(arcPattern('gold', true, 6)).toEqual({ dash: '0.01 10.2', opacity: 0.6 });
    expect(ringSummary({ rating: 5, reviews: 1, publicOn: false }).text).toBe('Client rating 5.0 of 5, based on 1 review');
  });
  it('follows an owner-set minimum', () => {
    expect(ratingArc(4.5, 4, 5).state).toBe('low');
    expect(ratingArc(4.5, 5, 5).state).toBe('ok');
  });
  it('keeps responsiveness out of the client rating', () => {
    const fast = ringSummary({ rating: 3.2, reviews: 10, publicOn: true, resp: { level: 'excellent', median_minutes: 10, response_rate: 100 } });
    expect(fast.rating.rating).toBe(3.2);
    expect(fast.rating.tone).toBe('amber');
  });
  it('uses a dashed pattern for low values so colour is not the only signal', () => {
    expect(arcPattern('red', false).dash).not.toBeNull();
    expect(arcPattern('green', false).dash).toBeNull();
  });
});

describe('inner arc: public responsiveness', () => {
  it('draws nothing and says nothing while the owner keeps responsiveness private', () => {
    const s = ringSummary({ rating: 4.7, reviews: 9, publicOn: false, resp: { level: 'excellent', median_minutes: 10, response_rate: 100 } });
    expect(s.resp.state).toBe('hidden');
    expect(s.text).not.toMatch(/Responsiveness/);
    expect(s.label).toBe('4.7 ★');
  });
  it('shows "New" under the minimum sample', () => {
    const s = ringSummary({ rating: 4.7, reviews: 9, publicOn: true, resp: { level: 'new', median_minutes: null, response_rate: null } });
    expect(s.resp.state).toBe('new');
    expect(s.text).toContain('Responsiveness: New, not enough requests yet');
    expect(s.label).toBe('4.7 ★ | New');
  });
  it('keeps the score inside the band of the public level, so colour and level agree', () => {
    expect(responsivenessScore({ level: 'excellent', median_minutes: 10, response_rate: 100 })).toBe(100);
    const good = responsivenessScore({ level: 'good', median_minutes: 300, response_rate: 85 }) as number;
    expect(good).toBeGreaterThanOrEqual(80);
    expect(good).toBeLessThanOrEqual(91);
    expect(respArc(true, { level: 'good', median_minutes: 300, response_rate: 85 }).tone).toBe('green');
    expect(respArc(true, { level: 'fair', median_minutes: 900, response_rate: 70 }).tone).toBe('amber');
    expect(respArc(true, { level: 'needs_improvement', median_minutes: 3000, response_rate: 40 }).tone).toBe('red');
  });
  it('scores speed from the median reply', () => {
    expect(speedFactor(15)).toBe(1);
    expect(speedFactor(60)).toBeCloseTo(0.9);
    expect(speedFactor(1440)).toBeCloseTo(0.5);
    expect(speedFactor(5000)).toBe(0);
  });
});

describe('tier, texts and geometry', () => {
  it('maps the existing badges', () => {
    expect(ringTier('Gold')).toBe('gold');
    expect(ringTier(null, true)).toBe('verified');
    expect(ringTier(null, false)).toBeNull();
  });
  it('writes the full text in Arabic', () => {
    const s = ringSummary({ rating: 4.8, reviews: 12, publicOn: true, resp: { level: 'excellent', median_minutes: 20, response_rate: 95 }, badge: 'silver', lang: 'ar' });
    expect(s.text).toContain('تقييم العملاء 4.8 من 5 من 12 تقييمات');
    expect(s.text).toContain('سرعة الاستجابة');
    expect(s.text).toContain('فضية');
    expect(s.label).toBe('4.8 ★ | رد سريع');
  });
  it('starts every arc at 12 o\'clock and runs clockwise', () => {
    expect(arcPath(25, 45)).toBe('M 50 5 A 45 45 0 0 1 95 50');
    expect(arcPath(75, 45)).toMatch(/^M 50 5 A 45 45 0 1 1 /);
    expect(arcPath(0, 45)).toBe('');
  });
});

describe('directory: responsiveness sort and filter', () => {
  const person = (id: string): ConsultantLive => ({
    id, name: `Name ${id}`, specialty: 'SAP FI', skills: ['SAP FI'], rating: 4.5, reviews: 5, rate: 80, avatar: 'NN', available: true, status: 'available',
    badges: ['verified'], lat: 24.7, lng: 46.7, city: 'Riyadh', country: 'Saudi Arabia', place: 'Riyadh, Saudi Arabia', industries: [], linkedinVerified: false,
    credlyVerified: false, linkedin_state: 'none', credly_state: 'none', languages: ['en'], response_time_minutes: 30, verification_status: 'verified',
    completion_percent: 80,
  });
  const list = ['a', 'b', 'c'].map(person);
  const tie = (x: ConsultantLive, y: ConsultantLive) => x.id.localeCompare(y.id);
  it('sorts the most responsive first and puts New last', () => {
    const scores = new Map([['a', 70], ['c', 95]]);
    expect(sortDirectory(list, { ...DEFAULT_FILTERS, sort: 'responsiveness' }, null, tie, scores).map(c => c.id)).toEqual(['c', 'a', 'b']);
  });
  it('filters by minimum level only while responsiveness is public', () => {
    const levels = new Map([['a', 'good'], ['b', 'fair'], ['c', 'excellent']] as const);
    const on: DirectoryContext = { founding: new Set(), viewerOffset: 0, respLevels: levels };
    const off: DirectoryContext = { founding: new Set(), viewerOffset: 0, respLevels: null };
    expect(list.filter(c => passes(c, { ...DEFAULT_FILTERS, resp: 'good' }, on)).map(c => c.id)).toEqual(['a', 'c']);
    expect(list.filter(c => passes(c, { ...DEFAULT_FILTERS, resp: 'good' }, off))).toHaveLength(3);
  });
});
