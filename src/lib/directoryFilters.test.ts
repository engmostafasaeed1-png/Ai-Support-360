import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILTERS, countActive, directoryMatches, facetCounts, parseFilters, passes, serializeFilters, slotCovers, sortDirectory,
  type DirectoryContext, type DirectoryFilters,
} from './directoryFilters';
import type { ConsultantLive } from './consultantDirectory';
import { deleteSaved, loadSaved, saveFilter } from './savedFilters';
import { clusterPoints } from './mapCluster';
import { successView } from './successLevel';

const person = (id: string, patch: Partial<ConsultantLive> = {}): ConsultantLive => ({
  id, name: `Name ${id}`, specialty: 'SAP FI', skills: ['SAP FI'], rating: 4.5, reviews: 5, rate: 80, avatar: 'NN', available: true, status: 'available',
  badges: ['verified'], lat: 24.7, lng: 46.7, city: 'Riyadh', country: 'Saudi Arabia', place: 'Riyadh, Saudi Arabia', industries: [], linkedinVerified: false,
  credlyVerified: false, linkedin_state: 'none', credly_state: 'none', languages: ['en'], response_time_minutes: 30, verification_status: 'verified',
  completion_percent: 80, ...patch,
});
const ctx: DirectoryContext = { founding: new Set(['b']), viewerOffset: 3 };
const tie = (a: ConsultantLive, b: ConsultantLive) => a.id.localeCompare(b.id);

describe('directory filters in the URL', () => {
  it('round-trips every filter through the query string', () => {
    const f: DirectoryFilters = {
      ...DEFAULT_FILTERS, q: 'month-end', family: 'finance', module: 'FI', sub: 'FI-CLOSE', role: 'functional', skill: 'SAP FI', cert: 'S/4HANA',
      years: 5, industry: 'Retail', segment: 'Enterprise', country: 'Saudi Arabia', vertical: 'IS-Retail', deployment: 'On-premise', workMode: 'Remote',
      lang: 'ar', rateMin: 40, rateMax: 120, avail: 'slot', slotDay: 2, slotTime: '10:30', tz: 'near', tier: 'silver', rating: 4, verified: true,
      founding: true, credly: true, completion: 70, response: 60, status: 'online', sort: 'rating', view: 'map', bbox: [20.5, 40.25, 26, 50],
    };
    const query = serializeFilters(f).toString();
    expect(parseFilters(new URLSearchParams(query))).toEqual(f);
  });
  it('writes nothing for the defaults and keeps old industry links working', () => {
    expect(serializeFilters(DEFAULT_FILTERS).toString()).toBe('');
    expect(parseFilters(new URLSearchParams('industry=Retail')).industry).toBe('Retail');
  });
  it('ignores invalid values', () => {
    const f = parseFilters(new URLSearchParams('rate_min=-5&rate_max=9999&avail=soon&day=9&time=25:00&tier=platinum&bbox=1,2,x,4&sort=random'));
    expect(f).toMatchObject({ rateMin: 0, rateMax: 500, avail: 'any', slotDay: null, slotTime: '', tier: '', bbox: null, sort: 'best_match' });
  });
  it('counts active filters, not the sort or the view', () => {
    expect(countActive({ ...DEFAULT_FILTERS, sort: 'rating', view: 'map' })).toBe(0);
    expect(countActive({ ...DEFAULT_FILTERS, module: 'FI', verified: true, rateMax: 200 })).toBe(3);
  });
});

describe('applying filters', () => {
  const list = [
    person('a', { skills: ['SAP FI', 'FI - General Ledger (FI-GL)'], sap_roles: ['functional'], timezone: 'Asia/Riyadh', ai_interview_badge: 'Gold' }),
    person('b', { skills: ['SAP MM'], status: 'offline', available: false, rate: 150, timezone: 'Europe/London', lat: null, lng: null, ai_interview_badge: 'Bronze' }),
    person('c', { skills: ['ABAP'], sap_roles: ['technical'], languages: ['en', 'ar'], certifications: ['SAP Certified Development Associate - ABAP'] }),
  ];
  const ids = (f: Partial<DirectoryFilters>) => list.filter(c => passes(c, { ...DEFAULT_FILTERS, ...f }, ctx)).map(c => c.id);

  it('filters by module, area, sub-module, role, language and certification', () => {
    expect(ids({ module: 'FI' })).toEqual(['a']);
    expect(ids({ family: 'logistics' })).toEqual(['b']);
    expect(ids({ sub: 'FI-GL' })).toEqual(['a']);
    expect(ids({ role: 'technical' })).toEqual(['c']);
    expect(ids({ lang: 'ar' })).toEqual(['c']);
    expect(ids({ cert: 'abap' })).toEqual(['c']);
  });
  it('filters by rate, availability, time zone, badge tier and founding', () => {
    expect(ids({ rateMax: 100 })).toEqual(['a', 'c']);
    expect(ids({ avail: 'now' })).toEqual(['a', 'c']);
    expect(ids({ tz: 'near' })).toEqual(['a']);
    expect(ids({ tier: 'silver' })).toEqual(['a']);
    expect(ids({ founding: true })).toEqual(['b']);
  });
  it('keeps consultants without a location out of a map area', () => {
    expect(ids({ bbox: [20, 40, 30, 50] })).toEqual(['a', 'c']);
  });
  it('counts per option with the other filters applied', () => {
    const counts = facetCounts(list, { ...DEFAULT_FILTERS, avail: 'now' }, 'module', ['FI', 'MM', 'ABAP'], ctx);
    expect([...counts.entries()]).toEqual([['FI', 1], ['MM', 0], ['ABAP', 1]]);
  });
  it('matches a weekly slot in the viewer time zone', () => {
    const slots = [{ day_of_week: 1, start_time: '09:00:00', end_time: '12:00:00' }];
    expect(slotCovers(slots, 'Asia/Riyadh', 1, '10:00', 3)).toBe(true);
    expect(slotCovers(slots, 'Asia/Riyadh', 1, '12:30', 3)).toBe(false);
    // Viewer in London (UTC+0): 07:00 London is 10:00 in Riyadh.
    expect(slotCovers(slots, 'Asia/Riyadh', 1, '07:00', 0)).toBe(true);
  });
  it('ranks best match with the ticket rules and gives why-chips', () => {
    const f = { ...DEFAULT_FILTERS, q: 'ABAP extension' };
    const m = directoryMatches(list, f, ctx.founding);
    expect(m).not.toBeNull();
    expect(sortDirectory(list, f, m, tie)[0].id).toBe('c');
    expect(m!.get('c')!.chips.length).toBeGreaterThan(0);
    expect(directoryMatches(list, DEFAULT_FILTERS, ctx.founding)).toBeNull();
  });
});

describe('saved filters', () => {
  it('saves, replaces by name and deletes', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveFilter('FI Saudi', 'module=FI', storage);
    saveFilter('FI Saudi', 'module=FI&country=Saudi+Arabia', storage);
    expect(loadSaved(storage)).toEqual([{ name: 'FI Saudi', query: 'module=FI&country=Saudi+Arabia' }]);
    expect(deleteSaved('FI Saudi', storage)).toEqual([]);
  });
});

describe('map clusters', () => {
  const pts = [{ id: 'a', lat: 24.7, lng: 46.7 }, { id: 'b', lat: 24.72, lng: 46.72 }, { id: 'c', lat: 30.04, lng: 31.24 }];
  it('groups close pins when zoomed out and splits them when zoomed in', () => {
    expect(clusterPoints(pts, 4).map(g => g.ids)).toEqual([['a', 'b'], ['c']]);
    expect(clusterPoints(pts, 13)).toHaveLength(3);
  });
});

describe('Success level filter and sort (Feature W)', () => {
  const view = (t: number, s: number) => successView(true, { requests_total: t, solved: s, not_solved: t - s, requests_12m: t, solved_12m: s });
  const success = new Map([['a', view(10, 10)], ['b', view(20, 17)], ['c', view(10, 8)], ['d', view(3, 3)]]);
  const list = [person('d'), person('c'), person('b'), person('a'), person('e')];
  it('keeps the success filters in the URL', () => {
    const f: DirectoryFilters = { ...DEFAULT_FILTERS, success: 'gold', successRate: 85, sort: 'success_level' };
    expect(parseFilters(new URLSearchParams(serializeFilters(f)))).toMatchObject({ success: 'gold', successRate: 85, sort: 'success_level' });
    expect(parseFilters(new URLSearchParams('success=diamond')).success).toBe('');
  });
  it('filters by minimum level and rate; New consultants never pass a level filter', () => {
    const x = { ...ctx, success };
    const keep = (f: Partial<DirectoryFilters>) => list.filter((c) => passes(c, { ...DEFAULT_FILTERS, ...f }, x)).map((c) => c.id).sort();
    expect(keep({ success: 'gold' })).toEqual(['a', 'b']);
    expect(keep({ success: 'platinum' })).toEqual(['a']);
    expect(keep({ successRate: 80 })).toEqual(['a', 'b', 'c']);
  });
  it('the filters do nothing while the success display is off', () => {
    expect(list.filter((c) => passes(c, { ...DEFAULT_FILTERS, success: 'gold', successRate: 90 }, { ...ctx, success: null })).length).toBe(list.length);
  });
  it('sorts by level and by rate, New and unknown last', () => {
    expect(sortDirectory(list, { ...DEFAULT_FILTERS, sort: 'success_level' }, null, tie, null, success).map((c) => c.id).slice(0, 3)).toEqual(['a', 'b', 'c']);
    expect(sortDirectory(list, { ...DEFAULT_FILTERS, sort: 'success_rate' }, null, tie, null, success).map((c) => c.id).slice(0, 3)).toEqual(['a', 'b', 'c']);
  });
});
