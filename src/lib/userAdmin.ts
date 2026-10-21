/**
 * Shared rules for the admin Users console (Feature P). The database (docs/sql/user-management.sql) is the real
 * gate; these mirrors decide what the console shows, power the "view as permissions" preview and are covered by tests.
 */

export const APP_ROLES = ['client', 'consultant', 'admin', 'super_admin'] as const;
export type AppRole = typeof APP_ROLES[number];
export const ADMIN_ROLES: AppRole[] = ['admin', 'super_admin'];

export const USER_STATUSES = ['active', 'pending', 'invited', 'suspended', 'deleted'] as const;
export type UserStatus = typeof USER_STATUSES[number];

/** Grantable through admin groups (same list and order as admin_permission_catalog()). */
export const ADMIN_PERMISSIONS = [
  'users.read', 'users.edit', 'users.roles', 'users.suspend', 'users.delete', 'users.invite', 'users.export',
  'users.notes', 'users.message', 'users.sessions', 'consultants.verify', 'finance.view',
  'finance.approve_payout', 'content.edit', 'settings.edit', 'audit.read', 'messages.send',
] as const;
/** Never grantable to admins; super admins always have them. */
export const SUPER_ONLY_PERMISSIONS = ['admins.manage', 'users.merge', 'users.mfa_reset', 'users.anonymise', 'users.hard_delete'] as const;
export type AdminPermission = typeof ADMIN_PERMISSIONS[number] | typeof SUPER_ONLY_PERMISSIONS[number];

/** Permissions that only change what this Users console allows (other admin pages keep using the admin role). */
export const CONSOLE_ENFORCED: AdminPermission[] = [
  'users.read', 'users.edit', 'users.roles', 'users.suspend', 'users.delete', 'users.invite', 'users.export',
  'users.notes', 'users.message', 'users.sessions', 'audit.read',
  'admins.manage', 'users.merge', 'users.mfa_reset', 'users.anonymise', 'users.hard_delete',
];

export const BULK_LIMIT = 200;
export const MIN_REASON = 5;

export interface PermissionSubject {
  roles: string[];
  /** Permissions of the admin groups the person belongs to; empty = not in any group. */
  groupPermissions?: string[][];
}

/** Mirror of admin_can(): super admin = everything; admin outside groups = every grantable permission; groups limit. */
export function hasPermission(subject: PermissionSubject, perm: AdminPermission): boolean {
  if (subject.roles.includes('super_admin')) return true;
  if (!subject.roles.includes('admin')) return false;
  if (!(ADMIN_PERMISSIONS as readonly string[]).includes(perm)) return false;
  const groups = subject.groupPermissions ?? [];
  // Bulk messages are never implied: an admin needs a group that grants messages.send.
  if (groups.length === 0) return perm !== 'messages.send';
  return groups.some((g) => g.includes(perm));
}

export function effectivePermissions(subject: PermissionSubject): AdminPermission[] {
  return ([...ADMIN_PERMISSIONS, ...SUPER_ONLY_PERMISSIONS] as AdminPermission[]).filter((p) => hasPermission(subject, p));
}

/** What each console action needs. */
export const ACTION_PERMISSION = {
  view: 'users.read', edit_profile: 'users.edit', tags: 'users.edit', roles: 'users.roles', suspend: 'users.suspend',
  reactivate: 'users.suspend', force_sign_out: 'users.sessions', password_reset: 'users.edit', resend_verification: 'users.edit',
  mfa_reset: 'users.mfa_reset', soft_delete: 'users.delete', restore: 'users.delete', anonymise: 'users.anonymise',
  hard_delete: 'users.hard_delete', merge: 'users.merge', notes: 'users.notes', message: 'users.message',
  invite: 'users.invite', export: 'users.export', gdpr_export: 'users.export', audit: 'audit.read',
  bulk_tags: 'users.edit', bulk_suspend: 'users.suspend', bulk_remind: 'users.message', manage_admins: 'admins.manage',
  access_review: 'users.roles',
} as const satisfies Record<string, AdminPermission>;
export type ConsoleAction = keyof typeof ACTION_PERMISSION;

export function allowedActions(perms: readonly string[]): ConsoleAction[] {
  return (Object.keys(ACTION_PERMISSION) as ConsoleAction[]).filter((a) => perms.includes(ACTION_PERMISSION[a]));
}

/** Actions that need a written reason (at least MIN_REASON characters). */
export const REASON_REQUIRED: ConsoleAction[] = ['suspend', 'force_sign_out', 'mfa_reset', 'soft_delete', 'anonymise', 'hard_delete', 'merge'];
export function reasonOk(reason: string | null | undefined) {
  return (reason ?? '').trim().length >= MIN_REASON;
}

export interface RoleChangeInput {
  actorId: string;
  actorRoles: string[];
  targetId: string;
  targetRoles: string[];
  next: string[];
  superAdminCount: number;
  reason?: string;
  fourEyes?: boolean;
}
export type RoleChangeResult =
  | { ok: true; add: string[]; remove: string[]; adminLevel: boolean; pendingSuperGrant: boolean }
  | { ok: false; error: 'self' | 'unknown_role' | 'needs_super' | 'reason' | 'last_super' | 'no_change' };

/** Mirror of um_apply_roles(). */
export function checkRoleChange(i: RoleChangeInput): RoleChangeResult {
  if (i.actorId === i.targetId) return { ok: false, error: 'self' };
  const next = [...new Set(i.next)].sort();
  if (next.some((r) => !(APP_ROLES as readonly string[]).includes(r))) return { ok: false, error: 'unknown_role' };
  const add = next.filter((r) => !i.targetRoles.includes(r));
  const remove = i.targetRoles.filter((r) => !next.includes(r));
  if (!add.length && !remove.length) return { ok: false, error: 'no_change' };
  const adminLevel = [...add, ...remove].some((r) => r === 'admin' || r === 'super_admin');
  const actorSuper = i.actorRoles.includes('super_admin');
  if ((adminLevel || i.targetRoles.includes('super_admin')) && !actorSuper) return { ok: false, error: 'needs_super' };
  if (adminLevel && !reasonOk(i.reason)) return { ok: false, error: 'reason' };
  if (remove.includes('super_admin') && i.superAdminCount <= 1) return { ok: false, error: 'last_super' };
  return { ok: true, add, remove, adminLevel, pendingSuperGrant: add.includes('super_admin') && !!i.fourEyes };
}

/** Rows shown in the read-only role matrix (what each account role can do today). */
export const ROLE_MATRIX: Array<{ key: string; roles: Record<AppRole, boolean> }> = [
  { key: 'submit_tickets', roles: { client: true, consultant: false, admin: true, super_admin: true } },
  { key: 'approve_timesheets', roles: { client: true, consultant: false, admin: true, super_admin: true } },
  { key: 'favourites', roles: { client: true, consultant: false, admin: false, super_admin: false } },
  { key: 'bid_and_accept', roles: { client: false, consultant: true, admin: false, super_admin: false } },
  { key: 'timesheets_invoices', roles: { client: false, consultant: true, admin: false, super_admin: false } },
  { key: 'payout_details', roles: { client: false, consultant: true, admin: false, super_admin: false } },
  { key: 'admin_pages', roles: { client: false, consultant: false, admin: true, super_admin: true } },
  { key: 'verify_consultants', roles: { client: false, consultant: false, admin: true, super_admin: true } },
  { key: 'payments_payouts', roles: { client: false, consultant: false, admin: true, super_admin: true } },
  { key: 'manage_client_consultant_roles', roles: { client: false, consultant: false, admin: true, super_admin: true } },
  { key: 'grant_admin', roles: { client: false, consultant: false, admin: false, super_admin: true } },
  { key: 'admin_groups', roles: { client: false, consultant: false, admin: false, super_admin: true } },
  { key: 'merge_mfa_anonymise', roles: { client: false, consultant: false, admin: false, super_admin: true } },
];

// ---------------------------------------------------------------------------------------------------------------
// List filters (URL-synced) and the RPC parameters they become
// ---------------------------------------------------------------------------------------------------------------
export interface UserFilters {
  q: string;
  roles: string[];
  status: string[];
  provider: string;
  email_verified: string;
  mfa: string;
  country: string;
  org: string;
  verification: string[];
  badge: string[];
  founding: string;
  policy: string;
  completion_min: string;
  completion_max: string;
  active_from: string;
  active_to: string;
  created_from: string;
  created_to: string;
  inactive_days: string;
  open_tickets: string;
  payout_ready: string;
  tags: string[];
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  page_size: number;
}

export const DEFAULT_FILTERS: UserFilters = {
  q: '', roles: [], status: [], provider: '', email_verified: '', mfa: '', country: '', org: '', verification: [], badge: [],
  founding: '', policy: '', completion_min: '', completion_max: '', active_from: '', active_to: '', created_from: '',
  created_to: '', inactive_days: '', open_tickets: '', payout_ready: '', tags: [], sort: 'created_at', dir: 'desc', page: 1, page_size: 25,
};

const LIST_KEYS = ['roles', 'status', 'verification', 'badge', 'tags'] as const;
const TEXT_KEYS = ['q', 'provider', 'email_verified', 'mfa', 'country', 'org', 'founding', 'policy', 'completion_min', 'completion_max',
  'active_from', 'active_to', 'created_from', 'created_to', 'inactive_days', 'open_tickets', 'payout_ready', 'sort'] as const;
export const SORT_KEYS = ['created_at', 'last_active_at', 'last_sign_in_at', 'name', 'email', 'completion', 'open_tickets', 'status'];

export function parseFilters(sp: URLSearchParams): UserFilters {
  const f: UserFilters = { ...DEFAULT_FILTERS, roles: [], status: [], verification: [], badge: [], tags: [] };
  for (const k of LIST_KEYS) {
    const v = sp.get(k);
    f[k] = v ? v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20) : [];
  }
  for (const k of TEXT_KEYS) {
    const v = sp.get(k);
    if (v != null) (f as unknown as Record<string, string>)[k] = v.slice(0, 100);
  }
  if (!SORT_KEYS.includes(f.sort)) f.sort = 'created_at';
  f.dir = sp.get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Number(sp.get('page'));
  f.page = Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1;
  const size = Number(sp.get('size'));
  f.page_size = [10, 25, 50, 100].includes(size) ? size : 25;
  return f;
}

/** Only non-default values go into the address, so shared links stay short. Other parameters are kept. */
export function filtersToParams(f: UserFilters, base?: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams(base);
  for (const k of [...LIST_KEYS, ...TEXT_KEYS, 'dir', 'page', 'size']) sp.delete(k);
  for (const k of LIST_KEYS) if (f[k].length) sp.set(k, f[k].join(','));
  for (const k of TEXT_KEYS) {
    const v = (f as unknown as Record<string, string>)[k];
    if (v && v !== (DEFAULT_FILTERS as unknown as Record<string, string>)[k]) sp.set(k, v);
  }
  if (f.dir !== 'desc') sp.set('dir', f.dir);
  if (f.page !== 1) sp.set('page', String(f.page));
  if (f.page_size !== 25) sp.set('size', String(f.page_size));
  return sp;
}

export function toRpcParams(f: UserFilters): Record<string, unknown> {
  const out: Record<string, unknown> = { sort: f.sort, dir: f.dir, page: f.page, page_size: f.page_size };
  for (const k of LIST_KEYS) if (f[k].length) out[k] = f[k];
  for (const k of TEXT_KEYS) {
    const v = (f as unknown as Record<string, string>)[k];
    if (k !== 'sort' && v) out[k] = k === 'active_to' || k === 'created_to' ? endOfDay(v) : v;
  }
  return out;
}

function endOfDay(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : v;
}

export function activeFilterCount(f: UserFilters): number {
  let n = 0;
  for (const k of LIST_KEYS) if (k !== 'roles' && k !== 'status' && f[k].length) n++;
  for (const k of TEXT_KEYS) if (!['q', 'sort'].includes(k) && (f as unknown as Record<string, string>)[k]) n++;
  return n;
}

export interface UserRow {
  id: string; email: string; name: string; phone?: string | null; avatar_url: string | null; roles: string[];
  status: UserStatus; providers: string[]; email_verified: boolean; mfa_enabled: boolean;
  created_at: string; last_sign_in_at: string | null; last_active_at: string | null;
  country: string | null; company: string | null; organisations: string[]; consultant_id: string | null;
  verification_status: string | null; badge: string | null; founding: boolean | null; policy_ok: boolean | null;
  completion: number | null; open_tickets: number | null; payout_ready: boolean | null; client_approval: string | null;
  tags: string[]; suspended_reason?: string | null; suspended_until?: string | null; deleted_at?: string | null;
  anonymise_after?: string | null; merged_into?: string | null; is_self: boolean;
}

const tri = (v: string, actual: boolean | null | undefined) => !v || (actual ?? false) === (v === 'true');

/**
 * Same filtering as admin_users_search, used before the database update is applied (the older list returns every
 * account at once). Filters whose data the older list does not have are ignored.
 */
export function filterLocally(rows: UserRow[], f: UserFilters, now = Date.now()): { total: number; rows: UserRow[] } {
  const q = f.q.trim().toLowerCase();
  const day = 86_400_000;
  const list = rows.filter((u) =>
    (!q || [u.name, u.email, u.company ?? '', u.phone ?? '', u.id, ...u.organisations].some((s) => s.toLowerCase().includes(q))) &&
    (!f.roles.length || u.roles.some((r) => f.roles.includes(r)) || (f.roles.includes('none') && u.roles.length === 0)) &&
    (f.status.length ? f.status.includes(u.status) : u.status !== 'deleted') &&
    (!f.provider || u.providers.includes(f.provider)) &&
    tri(f.email_verified, u.email_verified) && tri(f.mfa, u.mfa_enabled) &&
    (!f.country || (u.country ?? '').toLowerCase() === f.country.toLowerCase()) &&
    (!f.verification.length || (u.verification_status != null && f.verification.includes(u.verification_status))) &&
    (!f.badge.length || (u.badge != null && f.badge.includes(u.badge)) || (f.badge.includes('none') && !!u.consultant_id && !u.badge)) &&
    (!f.created_from || u.created_at >= f.created_from) &&
    (!f.created_to || u.created_at <= endOfDay(f.created_to)) &&
    (!f.active_from || (u.last_active_at ?? '') >= f.active_from) &&
    (!f.active_to || (!!u.last_active_at && u.last_active_at <= endOfDay(f.active_to))) &&
    (!f.inactive_days || Date.parse(u.last_active_at ?? u.created_at) < now - Number(f.inactive_days) * day) &&
    (!f.tags.length || u.tags.some((t) => f.tags.includes(t))));
  const dir = f.dir === 'asc' ? 1 : -1;
  const key = (u: UserRow): string | number => {
    switch (f.sort) {
      case 'name': return (u.name || u.email).toLowerCase();
      case 'email': return u.email.toLowerCase();
      case 'status': return u.status;
      case 'completion': return u.completion ?? -1;
      case 'open_tickets': return u.open_tickets ?? -1;
      case 'last_active_at': return u.last_active_at ?? '';
      case 'last_sign_in_at': return u.last_sign_in_at ?? '';
      default: return u.created_at;
    }
  };
  const sorted = [...list].sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka < kb ? -dir : ka > kb ? dir : a.id.localeCompare(b.id);
  });
  const start = (f.page - 1) * f.page_size;
  return { total: sorted.length, rows: sorted.slice(start, start + f.page_size) };
}

// ---------------------------------------------------------------------------------------------------------------
// CSV and invitations
// ---------------------------------------------------------------------------------------------------------------
/** Spreadsheet-safe cell: values that start with = + - @ (or tab/CR) would run as formulas. */
export function csvCell(v: unknown): string {
  const s = v == null ? '' : Array.isArray(v) ? v.join(' ') : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export const CSV_COLUMNS: Array<{ key: keyof UserRow; header: string }> = [
  { key: 'name', header: 'Name' }, { key: 'email', header: 'Email' }, { key: 'roles', header: 'Roles' },
  { key: 'status', header: 'Status' }, { key: 'company', header: 'Company' }, { key: 'country', header: 'Country' },
  { key: 'providers', header: 'Sign-in' }, { key: 'email_verified', header: 'Email verified' },
  { key: 'verification_status', header: 'Verification' }, { key: 'completion', header: 'Profile %' },
  { key: 'created_at', header: 'Joined' }, { key: 'last_active_at', header: 'Last active' }, { key: 'tags', header: 'Tags' },
];

/** No phone numbers, ids, notes or payout data are exported. */
export function usersCsv(rows: UserRow[]): string {
  const head = CSV_COLUMNS.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((r) => CSV_COLUMNS.map((c) => csvCell(r[c.key])).join(','));
  return [head, ...body].join('\n');
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface InviteRow { email: string; name?: string; role: 'client' | 'consultant'; language: 'en' | 'ar' }
export interface InviteParse { rows: InviteRow[]; invalid: string[]; duplicates: string[]; overLimit: number }

/**
 * Pasted list or CSV: one person per line, "email" or "email, name, role, language" (a header line is skipped).
 * Separators: comma, semicolon or tab. Unknown role/language fall back to the defaults.
 */
export function parseInviteList(text: string, defaults: { role: 'client' | 'consultant'; language: 'en' | 'ar' }): InviteParse {
  const rows: InviteRow[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();
  let overLimit = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(/^"|"$/g, ''));
    const email = (parts[0] ?? '').toLowerCase();
    if (email === 'email' || email === 'e-mail') continue;
    if (!EMAIL_RE.test(email) || email.length > 254) { invalid.push(parts[0] ?? line); continue; }
    if (seen.has(email)) { duplicates.push(email); continue; }
    seen.add(email);
    if (rows.length >= BULK_LIMIT) { overLimit++; continue; }
    const role = parts.find((p) => /^(client|consultant)$/i.test(p))?.toLowerCase() as InviteRow['role'] | undefined;
    const language = parts.find((p, i) => i > 0 && /^(en|ar)$/i.test(p))?.toLowerCase() as InviteRow['language'] | undefined;
    const name = parts[1] && !/^(client|consultant|en|ar)$/i.test(parts[1]) ? parts[1].slice(0, 80) : undefined;
    rows.push({ email, name, role: role ?? defaults.role, language: language ?? defaults.language });
  }
  return { rows, invalid, duplicates, overLimit };
}

/** Keyboard j/k movement through a list (stays inside the list). */
export function nextIndex(current: number, key: string, length: number): number {
  if (length <= 0) return -1;
  if (key === 'j' || key === 'ArrowDown') return current < 0 ? 0 : Math.min(current + 1, length - 1);
  if (key === 'k' || key === 'ArrowUp') return current < 0 ? 0 : Math.max(current - 1, 0);
  return current;
}

/** Days left of the 30-day restore window (0 when it has passed). */
export function restoreDaysLeft(anonymiseAfter: string | null | undefined, now = Date.now()): number {
  if (!anonymiseAfter) return 0;
  return Math.max(0, Math.ceil((Date.parse(anonymiseAfter) - now) / 86_400_000));
}

/** True when the edge/RPC error says the prepared database update has not been applied. */
export function isNotInstalled(e: { code?: string; message?: string } | null | undefined): boolean {
  return !!e && (e.code === 'PGRST202' || e.code === '42883' || e.code === 'PGRST205' || /Could not find the function|schema cache/i.test(e.message ?? ''));
}
