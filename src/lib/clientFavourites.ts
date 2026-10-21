/**
 * Feature O: client favourite consultants, groups, tags, notes and the "do not suggest" list.
 * Pure rules shared by the My consultants page, the favourite buttons, the group invitation preview and the tests.
 * The database (docs/sql/client-favourites.sql) enforces the same limits; these give friendly messages first.
 */
import { MODULE_BY_CODE, modulesIn } from '../../supabase/functions/_shared/ticketMatch';
import { LEVEL_ORDER, type RespLevel } from '../../supabase/functions/_shared/responsiveness';
import type { ConsultantLive } from '@/lib/consultantDirectory';

export const FAV_LIMITS = {
  favourites: 500, groups: 50, blocks: 500, groupMembers: 200,
  tags: 10, tagLength: 30, note: 2000, groupName: 60, groupDescription: 300, areas: 10,
} as const;

/** Maximum people asked by one group invitation when the team-size setting cannot be read. */
export const DEFAULT_INVITE_LIMIT = 5;

export const GROUP_COLOURS = ['blue', 'green', 'amber', 'red', 'violet', 'teal', 'slate'] as const;
export type GroupColour = (typeof GROUP_COLOURS)[number];
export const GROUP_ICONS = ['users', 'star', 'shield', 'zap', 'flag', 'briefcase', 'globe', 'wrench'] as const;
export type GroupIcon = (typeof GROUP_ICONS)[number];

/** Semantic token classes per group colour (no raw colours). */
export const GROUP_TONE: Record<GroupColour, string> = {
  blue: 'border-info/30 bg-info/10 text-info',
  green: 'border-success/30 bg-success/10 text-success',
  amber: 'border-warning/40 bg-warning/15 text-warning-foreground',
  red: 'border-destructive/30 bg-destructive/10 text-destructive',
  violet: 'border-accent/30 bg-accent/10 text-accent',
  teal: 'border-primary/30 bg-primary/10 text-primary',
  slate: 'border-border bg-muted text-muted-foreground',
};

export type OrgRole = 'owner' | 'admin' | 'manager' | 'member';

/** Who owns the lists: the active client organisation, or the person when they have none. */
export interface FavScope { tenantId: string | null; ownerUserId: string | null }

export function scopeFor(tenantId: string | null | undefined, userId: string | null | undefined): FavScope | null {
  if (tenantId) return { tenantId, ownerUserId: null };
  if (userId) return { tenantId: null, ownerUserId: userId };
  return null;
}

/** Organisation owners and admins edit; managers and members read. A client without an organisation edits their own lists. */
export function canEditScope(scope: FavScope | null, orgRole: OrgRole | null | undefined): boolean {
  if (!scope) return false;
  if (!scope.tenantId) return true;
  return orgRole === 'owner' || orgRole === 'admin';
}

export interface Favourite { consultant_id: string; tags: string[]; created_at: string }
export interface ConsultantGroup {
  id: string;
  name: string;
  description: string | null;
  colour: GroupColour;
  icon: GroupIcon;
  position: number;
  preferred_areas: string[];
  archived_at: string | null;
  members: string[];
}

// ---------------------------------------------------------------- validation

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

export function cleanTags(raw: readonly string[]): { tags: string[]; error: 'tag_too_long' | 'tags_limit' | null } {
  const out: string[] = [];
  for (const r of raw) {
    const t = squash(r);
    if (!t) continue;
    if (t.length > FAV_LIMITS.tagLength) return { tags: out, error: 'tag_too_long' };
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  if (out.length > FAV_LIMITS.tags) return { tags: out.slice(0, FAV_LIMITS.tags), error: 'tags_limit' };
  return { tags: out, error: null };
}

export interface GroupDraft { name: string; description?: string | null; colour: string; icon: string; preferred_areas?: string[] }
export type GroupProblem = 'name_required' | 'name_too_long' | 'name_taken' | 'description_too_long' | 'colour' | 'icon' | 'areas_limit';

export function groupProblems(d: GroupDraft, otherNames: readonly string[]): GroupProblem[] {
  const out: GroupProblem[] = [];
  const name = squash(d.name);
  if (!name) out.push('name_required');
  else if (name.length > FAV_LIMITS.groupName) out.push('name_too_long');
  else if (otherNames.some((n) => squash(n).toLowerCase() === name.toLowerCase())) out.push('name_taken');
  if ((d.description ?? '').trim().length > FAV_LIMITS.groupDescription) out.push('description_too_long');
  if (!(GROUP_COLOURS as readonly string[]).includes(d.colour)) out.push('colour');
  if (!(GROUP_ICONS as readonly string[]).includes(d.icon)) out.push('icon');
  if ((d.preferred_areas ?? []).length > FAV_LIMITS.areas) out.push('areas_limit');
  return out;
}

/** Database error text to a message key (the database raises the same names). */
export function favouriteErrorKey(message: string | null | undefined): string {
  const m = String(message ?? '');
  const known = ['client_fav_limit', 'client_fav_blocked', 'client_fav_tags_limit', 'client_fav_tag_too_long', 'client_group_limit',
    'client_group_members_limit', 'client_group_archived', 'client_block_limit'];
  const hit = known.find((k) => m.includes(k));
  if (hit) return hit.replace(/^client_/, '');
  if (/client_group_(tenant|owner)_name_uq|duplicate key/.test(m)) return 'duplicate';
  if (/row-level security|permission denied|42501/.test(m)) return 'not_allowed';
  return 'generic';
}

/** True when the error means the Feature O tables are not there yet (prepared SQL not applied). */
export const isMissingFeature = (message: string | null | undefined) =>
  /client_consultant_|client_match_preferences|client_group_invite_limit|schema cache|does not exist|PGRST20[2-5]|42P01|42883/i.test(String(message ?? ''));

// ---------------------------------------------------------------- system categories

export interface SystemCategories { areas: string[]; modules: string[]; country: string | null; badges: string[] }

/** Categories taken from the public profile: SAP area (family) and module, country, badges. */
export function systemCategories(c: Pick<ConsultantLive, 'skills' | 'specialty' | 'country' | 'badges' | 'ai_interview_badge'>): SystemCategories {
  const modules = new Set<string>();
  for (const s of [...(c.skills ?? []), c.specialty]) modulesIn(s).forEach((m) => modules.add(m));
  const areas = new Set<string>();
  modules.forEach((m) => { const f = MODULE_BY_CODE.get(m)?.family; if (f) areas.add(f); });
  const badges = [...(c.badges ?? [])];
  if (c.ai_interview_badge) badges.push(String(c.ai_interview_badge).toLowerCase());
  return { areas: [...areas], modules: [...modules], country: c.country || null, badges: [...new Set(badges)] };
}

// ---------------------------------------------------------------- the My consultants list

export interface MyRow {
  consultantId: string;
  /** null = no longer available (removed, unverified, hidden or not visible): no data is shown. */
  consultant: ConsultantLive | null;
  addedAt: string;
  tags: string[];
  groups: string[];
  note: string | null;
  pastWork: boolean;
  level: RespLevel;
}

export interface MyFilters {
  q: string;
  area: string;
  module: string;
  group: string;
  tag: string;
  country: string;
  badge: string;
  availability: 'all' | 'available' | 'busy' | 'offline';
  minRating: number;
  level: RespLevel | 'all';
  pastWork: boolean;
  sort: 'recent' | 'name' | 'rating' | 'responsiveness' | 'availability';
}

export const DEFAULT_MY_FILTERS: MyFilters = {
  q: '', area: '', module: '', group: '', tag: '', country: '', badge: '', availability: 'all', minRating: 0, level: 'all', pastWork: false, sort: 'recent',
};

const STATUS_ORDER = { available: 0, busy: 1, offline: 2, on_hold: 3 } as const;

export function filterMyConsultants(rows: readonly MyRow[], f: MyFilters): MyRow[] {
  const q = f.q.trim().toLowerCase();
  const profileFilter = !!(f.area || f.module || f.country || f.badge || f.availability !== 'all' || f.minRating > 0 || f.level !== 'all' || f.pastWork);
  const out = rows.filter((r) => {
    if (f.group && !r.groups.includes(f.group)) return false;
    if (f.tag && !r.tags.some((t) => t.toLowerCase() === f.tag.toLowerCase())) return false;
    const c = r.consultant;
    if (!c) return !profileFilter && !q; // no data to match against: only shown without profile filters or search
    if (q && !(c.name.toLowerCase().includes(q) || c.specialty.toLowerCase().includes(q) || (c.skills ?? []).some((s) => s.toLowerCase().includes(q))
      || r.tags.some((t) => t.toLowerCase().includes(q)))) return false;
    const cat = systemCategories(c);
    if (f.area && !cat.areas.includes(f.area)) return false;
    if (f.module && !cat.modules.includes(f.module)) return false;
    if (f.country && cat.country !== f.country) return false;
    if (f.badge && !cat.badges.includes(f.badge)) return false;
    if (f.availability !== 'all' && c.status !== f.availability) return false;
    if (f.minRating > 0 && (Number(c.rating) || 0) < f.minRating) return false;
    if (f.level !== 'all' && r.level !== f.level) return false;
    if (f.pastWork && !r.pastWork) return false;
    return true;
  });
  const byName = (a: MyRow, b: MyRow) => (a.consultant?.name ?? '').localeCompare(b.consultant?.name ?? '');
  out.sort((a, b) => {
    // Unavailable entries always go last.
    if (!a.consultant !== !b.consultant) return a.consultant ? -1 : 1;
    if (!a.consultant || !b.consultant) return b.addedAt.localeCompare(a.addedAt);
    switch (f.sort) {
      case 'name': return byName(a, b);
      case 'rating': return (b.consultant.rating || 0) - (a.consultant.rating || 0) || byName(a, b);
      case 'responsiveness': return LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || byName(a, b);
      case 'availability': return STATUS_ORDER[a.consultant.status] - STATUS_ORDER[b.consultant.status] || byName(a, b);
      default: return b.addedAt.localeCompare(a.addedAt) || byName(a, b);
    }
  });
  return out;
}

// ---------------------------------------------------------------- CSV export (display names only)

const csvCell = (v: string) => {
  // Spreadsheet formula injection: a leading = + - @ is made literal.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Display name, groups, tags and status only: no contact data, ids or private notes. */
export function myConsultantsCsv(rows: readonly MyRow[], groupName: (id: string) => string, labels = { name: 'Name', groups: 'Groups', tags: 'Tags', status: 'Status', available: 'Available', unavailable: 'No longer available' }): string {
  const lines = [[labels.name, labels.groups, labels.tags, labels.status].map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.consultant?.name ?? labels.unavailable,
      r.groups.map(groupName).filter(Boolean).join('; '),
      r.tags.join('; '),
      r.consultant ? labels.available : labels.unavailable,
    ].map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- group invitations

export type SkipReason = 'unavailable' | 'blocked' | 'already' | 'over_limit';
export interface InvitePreview { ask: string[]; skipped: Array<{ id: string; reason: SkipReason }> }

/**
 * Who a group invitation would ask: members the client may still ask, in the given order, up to the limit
 * (the team-size setting). Every person gets their own normal request; nobody is engaged by the invitation itself.
 */
export function invitePreview(
  members: readonly string[],
  o: { selectable: ReadonlySet<string>; blocked?: ReadonlySet<string>; alreadyAsked?: ReadonlySet<string>; limit: number },
): InvitePreview {
  const limit = Math.max(1, Math.floor(o.limit) || DEFAULT_INVITE_LIMIT);
  const ask: string[] = [];
  const skipped: InvitePreview['skipped'] = [];
  for (const id of [...new Set(members)]) {
    if (o.blocked?.has(id)) skipped.push({ id, reason: 'blocked' });
    else if (!o.selectable.has(id)) skipped.push({ id, reason: 'unavailable' });
    else if (o.alreadyAsked?.has(id)) skipped.push({ id, reason: 'already' });
    else if (ask.length >= limit) skipped.push({ id, reason: 'over_limit' });
    else ask.push(id);
  }
  return { ask, skipped };
}

/** The client unticked some people: only ticked ones inside the preview are asked, never more than the limit. */
export function finalInvitees(preview: InvitePreview, ticked: ReadonlySet<string>, limit: number): string[] {
  return preview.ask.filter((id) => ticked.has(id)).slice(0, Math.max(1, limit));
}

// ---------------------------------------------------------------- preferred group per SAP area

/** Module codes and areas (families) of a request, upper-case, for matching preferred groups. */
export function requestAreas(modules: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const m of modules) for (const code of modulesIn(m)) {
    out.add(code.toUpperCase());
    const fam = MODULE_BY_CODE.get(code)?.family;
    if (fam) out.add(fam.toUpperCase());
  }
  return [...out];
}

/** The active group the client marked as preferred for one of the request's modules (module beats area). */
export function preferredGroupFor(groups: readonly ConsultantGroup[], areas: readonly string[]): ConsultantGroup | null {
  const active = groups.filter((g) => !g.archived_at);
  const wanted = areas.map((a) => a.toUpperCase());
  const moduleHit = active.find((g) => g.preferred_areas.some((a) => wanted.includes(a) && MODULE_BY_CODE.has(a)));
  return moduleHit ?? active.find((g) => g.preferred_areas.some((a) => wanted.includes(a))) ?? null;
}

/** Groups in display order: active by position, then archived. */
export function orderedGroups(groups: readonly ConsultantGroup[]): ConsultantGroup[] {
  return [...groups].sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at) || a.position - b.position || a.name.localeCompare(b.name));
}

/** New positions after moving one group up (-1) or down (+1) among the active ones. */
export function moveGroup(groups: readonly ConsultantGroup[], id: string, dir: -1 | 1): Array<{ id: string; position: number }> {
  const list = orderedGroups(groups).filter((g) => !g.archived_at);
  const i = list.findIndex((g) => g.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next.map((g, position) => ({ id: g.id, position })).filter((p) => list.find((g) => g.id === p.id)?.position !== p.position);
}
