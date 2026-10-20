import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MY_FILTERS, FAV_LIMITS, canEditScope, cleanTags, favouriteErrorKey, filterMyConsultants, finalInvitees, groupProblems,
  invitePreview, isMissingFeature, moveGroup, myConsultantsCsv, preferredGroupFor, requestAreas, scopeFor,
  type ConsultantGroup, type MyRow,
} from './clientFavourites';
import { rankConsultants } from '../../supabase/functions/_shared/ticketMatch';
import { FIXTURE_CONSULTANTS, FIXTURE_TICKETS } from '@/test/fixtures/matchFixtures';
import type { ConsultantLive } from '@/hooks/useRealtimeConsultants';

const live = (id: string, extra: Partial<ConsultantLive> = {}): ConsultantLive => ({
  id, name: `Name ${id}`, specialty: 'SAP FI', skills: ['SAP FI'], country: 'Egypt', badges: [], ai_interview_badge: null,
  rating: 4, status: 'available', ...extra,
} as unknown as ConsultantLive);
const row = (id: string, extra: Partial<MyRow> = {}): MyRow => ({
  consultantId: id, consultant: live(id), addedAt: '2026-01-01', tags: [], groups: [], note: null, pastWork: false, level: 'new', ...extra,
});
const group = (id: string, extra: Partial<ConsultantGroup> = {}): ConsultantGroup => ({
  id, name: id, description: null, colour: 'blue', icon: 'users', position: 0, preferred_areas: [], archived_at: null, members: [], ...extra,
});

describe('who owns and who edits the lists', () => {
  it('belongs to the company when there is one, otherwise to the person', () => {
    expect(scopeFor('t1', 'u1')).toEqual({ tenantId: 't1', ownerUserId: null });
    expect(scopeFor(null, 'u1')).toEqual({ tenantId: null, ownerUserId: 'u1' });
    expect(scopeFor(null, null)).toBeNull();
  });
  it('company owners and admins edit; managers and members only read', () => {
    const org = scopeFor('t1', 'u1');
    expect(canEditScope(org, 'owner')).toBe(true);
    expect(canEditScope(org, 'admin')).toBe(true);
    expect(canEditScope(org, 'manager')).toBe(false);
    expect(canEditScope(org, 'member')).toBe(false);
    expect(canEditScope(scopeFor(null, 'u1'), null)).toBe(true);
  });
});

describe('limits', () => {
  it('uses 500 favourites, 50 groups and 500 blocked people', () => {
    expect(FAV_LIMITS.favourites).toBe(500);
    expect(FAV_LIMITS.groups).toBe(50);
    expect(FAV_LIMITS.blocks).toBe(500);
  });
  it('allows at most 10 tags of 30 characters, without duplicates', () => {
    expect(cleanTags(['A', 'a', ' b '])).toEqual({ tags: ['A', 'b'], error: null });
    expect(cleanTags(Array.from({ length: 11 }, (_, i) => `t${i}`)).error).toBe('tags_limit');
    expect(cleanTags(['x'.repeat(31)]).error).toBe('tag_too_long');
  });
  it('rejects empty or duplicate group names', () => {
    expect(groupProblems({ name: ' ', colour: 'blue', icon: 'users' }, [])).toContain('name_required');
    expect(groupProblems({ name: 'Finance team', colour: 'blue', icon: 'users' }, ['finance  TEAM'])).toContain('name_taken');
    expect(groupProblems({ name: 'Basis on-call', colour: 'blue', icon: 'users' }, [])).toEqual([]);
  });
  it('turns database limit errors into messages', () => {
    expect(favouriteErrorKey('client_group_limit')).toBe('group_limit');
    expect(favouriteErrorKey('client_fav_limit')).toBe('fav_limit');
    expect(favouriteErrorKey('new row violates row-level security policy')).toBe('not_allowed');
    expect(isMissingFeature('relation "public.client_consultant_favourites" does not exist')).toBe(true);
    expect(isMissingFeature('client_fav_limit')).toBe(false);
  });
});

describe('My consultants list', () => {
  it('filters by group, tag and past work, and puts unavailable people last', () => {
    const rows = [row('a', { groups: ['g1'], tags: ['Closing'] }), row('b', { pastWork: true }), row('gone', { consultant: null, addedAt: '2026-05-01' })];
    expect(filterMyConsultants(rows, { ...DEFAULT_MY_FILTERS, group: 'g1' }).map((r) => r.consultantId)).toEqual(['a']);
    expect(filterMyConsultants(rows, { ...DEFAULT_MY_FILTERS, tag: 'closing' }).map((r) => r.consultantId)).toEqual(['a']);
    expect(filterMyConsultants(rows, { ...DEFAULT_MY_FILTERS, pastWork: true }).map((r) => r.consultantId)).toEqual(['b']);
    expect(filterMyConsultants(rows, DEFAULT_MY_FILTERS).at(-1)?.consultantId).toBe('gone');
  });
  it('shows no data for someone no longer available, even in search', () => {
    const rows = [row('gone', { consultant: null })];
    expect(filterMyConsultants(rows, { ...DEFAULT_MY_FILTERS, q: 'name' })).toEqual([]);
  });
  it('exports display names only (no ids or notes) and neutralises spreadsheet formulas', () => {
    const csv = myConsultantsCsv([row('id-123', { note: 'secret note', consultant: live('id-123', { name: '=HYPERLINK("x")' }) }), row('gone', { consultant: null })], () => '');
    expect(csv).not.toContain('id-123');
    expect(csv).not.toContain('secret note');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('No longer available');
  });
});

describe('inviting a whole group', () => {
  it('asks only people who can still be chosen, up to the team-size limit (default 5)', () => {
    const members = ['a', 'b', 'blocked', 'gone', 'asked', 'c', 'd', 'e', 'f'];
    const p = invitePreview(members, {
      selectable: new Set(['a', 'b', 'blocked', 'asked', 'c', 'd', 'e', 'f']), blocked: new Set(['blocked']), alreadyAsked: new Set(['asked']), limit: 5,
    });
    expect(p.ask).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(p.skipped).toEqual([
      { id: 'blocked', reason: 'blocked' }, { id: 'gone', reason: 'unavailable' }, { id: 'asked', reason: 'already' }, { id: 'f', reason: 'over_limit' },
    ]);
  });
  it('unticked people are not asked', () => {
    const p = invitePreview(['a', 'b', 'c'], { selectable: new Set(['a', 'b', 'c']), limit: 5 });
    expect(finalInvitees(p, new Set(['a', 'c', 'zz']), 5)).toEqual(['a', 'c']);
  });
});

describe('preferred group for an SAP area', () => {
  it('a module choice beats an area choice; archived groups are ignored', () => {
    const areas = requestAreas(['SAP FI']);
    const byArea = group('area', { preferred_areas: areas.filter((a) => a !== 'FI') });
    const byModule = group('module', { preferred_areas: ['FI'] });
    const archived = group('old', { preferred_areas: ['FI'], archived_at: '2026-01-01' });
    expect(preferredGroupFor([archived, byArea, byModule], areas)?.id).toBe('module');
    expect(preferredGroupFor([archived], areas)).toBeNull();
  });
  it('reorders only the two moved groups', () => {
    const gs = [group('a', { position: 0 }), group('b', { position: 1 }), group('c', { position: 2 })];
    expect(moveGroup(gs, 'b', -1)).toEqual([{ id: 'b', position: 0 }, { id: 'a', position: 1 }]);
    expect(moveGroup(gs, 'a', -1)).toEqual([]);
  });
});

describe('favourite boost in matching', () => {
  const ticket = FIXTURE_TICKETS[0];
  const score = (cs: typeof FIXTURE_CONSULTANTS, id: string) => rankConsultants(ticket, cs).ranked.find((r) => r.consultant_id === id)?.score ?? -1;
  it('is small, shows "Your favourite" and never brings back someone the hard filters removed', () => {
    const plain = FIXTURE_CONSULTANTS.map((c) => ({ ...c, favourite: false }));
    const fav = FIXTURE_CONSULTANTS.map((c) => ({ ...c, favourite: c.id === 'c02' || c.id === 'c12' }));
    const before = score(plain, 'c02');
    const after = score(fav, 'c02');
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeLessThanOrEqual(3);
    const out = rankConsultants(ticket, fav).ranked;
    expect(out.find((r) => r.consultant_id === 'c02')?.why.some((w) => w.key === 'favourite')).toBe(true);
    expect(out.map((r) => r.consultant_id)).not.toContain('c12'); // unverified stays out
    expect(out[0]?.consultant_id).toBe(ticket.expectTop); // the best match stays first
  });
  it('gives nothing to an offline favourite', () => {
    const off = FIXTURE_CONSULTANTS.map((c) => (c.id === 'c02' ? { ...c, availability_status: 'offline' as const } : c));
    const plain = off.map((c) => ({ ...c, favourite: false }));
    const fav = off.map((c) => ({ ...c, favourite: c.id === 'c02' }));
    expect(score(fav, 'c02')).toBe(score(plain, 'c02'));
  });
});
