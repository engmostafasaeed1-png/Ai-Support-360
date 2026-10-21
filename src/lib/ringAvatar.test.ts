import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { arcPath, arcPattern, arcSegments, ratingArc, ringGeometry, RING_SIZES, ratingTone, respArc, responsivenessScore, ringSummary, ringTier, speedFactor } from './ringAvatar';
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

describe('visible, modern ring (Feature W addition)', () => {
  it('uses 6 px outer and 5 px inner arcs at md with a 3 px gap and 4 px to the photo', () => {
    const md = RING_SIZES.md;
    expect([md.outerW, md.innerW, md.gap, md.photoGap]).toEqual([6, 5, 3, 4]);
    const g = ringGeometry('md');
    expect(g.outerR - g.outerW / 2 - (g.innerR + g.innerW / 2)).toBeCloseTo(3);
    expect(g.innerR - g.innerW / 2 - g.photoR).toBeCloseTo(4);
  });
  it('never draws an arc thinner than 3 px and scales with size', () => {
    for (const s of Object.values(RING_SIZES)) {
      expect(s.outerW).toBeGreaterThanOrEqual(3);
      expect(s.innerW).toBeGreaterThanOrEqual(3);
    }
    expect(RING_SIZES.xl.outerW).toBeGreaterThan(RING_SIZES.md.outerW);
  });
  it('makes card avatars at least 64 px and the profile header 120-140 px', () => {
    expect(RING_SIZES.md.px).toBeGreaterThanOrEqual(64);
    expect(RING_SIZES.xl.px).toBeGreaterThanOrEqual(120);
    expect(RING_SIZES.xl.px).toBeLessThanOrEqual(140);
  });
  it('shows only the number on xs/sm rings', () => {
    expect(RING_SIZES.xs.short && RING_SIZES.sm.short).toBe(true);
    expect(RING_SIZES.md.short || RING_SIZES.lg.short || RING_SIZES.xl.short).toBe(false);
    expect(ringSummary({ rating: 4.8, reviews: 23, publicOn: true }).short).toBe('4.8');
    expect(ringSummary({ rating: 0, reviews: 0, publicOn: true }).short).toBe('New');
  });
  it('writes the pills "4.8 (23)" and "Fast reply - 18 min"', () => {
    const s = ringSummary({ rating: 4.8, reviews: 23, publicOn: true, resp: { level: 'excellent', median_minutes: 18, response_rate: 96 } });
    expect(s.pills.rating.text).toBe('4.8 (23)');
    expect(s.pills.resp?.text).toBe('Fast reply - 18 min');
    expect(s.pills.resp?.tone).toBe('gold');
  });
  it('has no responsiveness pill while responsiveness is private', () => {
    expect(ringSummary({ rating: 4.8, reviews: 23, publicOn: false }).pills.resp).toBeNull();
  });
  it('splits the arc into pieces that run without gaps from 12 o\'clock to the end', () => {
    const segs = arcSegments(80, 30, 36, 36);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs[0].d.startsWith('M 36 6 ')).toBe(true);
    expect(segs[0].t).toBeLessThan(segs[segs.length - 1].t);
  });
  it('keeps every ring colour at 3:1 or more against light and dark cards', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    const block = (sel: RegExp) => css.slice(css.search(sel));
    const val = (src: string, name: string) => {
      const m = src.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
      if (!m) throw new Error(`missing --${name}`);
      return [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
    };
    const light = block(/:root\s*\{/);
    const dark = block(/\.dark\s*\{/);
    const cards = [val(light, 'card'), val(dark, 'card')];
    for (const tone of ['red', 'amber', 'green', 'gold']) {
      for (const stop of ['a', 'b']) {
        for (const src of [light, dark]) {
          const c = val(src, `ring-${tone}-${stop}`);
          for (const card of cards) expect(contrast(c, card), `${tone}-${stop}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });
});

function luminance([h, s, l]: [number, number, number]): number {
  const sat = s / 100, lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const ch = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(ch(0)) + 0.7152 * lin(ch(8)) + 0.0722 * lin(ch(4));
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
