import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ADMIN_PERMISSIONS, BULK_LIMIT, DEFAULT_FILTERS, SUPER_ONLY_PERMISSIONS, allowedActions, checkRoleChange, csvCell, effectivePermissions,
  filterLocally, filtersToParams, hasPermission, nextIndex, parseFilters, parseInviteList, reasonOk, restoreDaysLeft, toRpcParams, usersCsv,
  type UserRow,
} from './userAdmin';

const sql = readFileSync(resolve(__dirname, '../../docs/sql/user-management.sql'), 'utf8');

describe('permission matrix', () => {
  it('super admins have every permission, including super-only ones', () => {
    const p = effectivePermissions({ roles: ['super_admin'] });
    expect(p).toEqual([...ADMIN_PERMISSIONS, ...SUPER_ONLY_PERMISSIONS]);
  });
  it('admins outside any group keep every grantable permission but no super-only one', () => {
    expect(effectivePermissions({ roles: ['admin'] })).toEqual(ADMIN_PERMISSIONS.filter((p) => p !== 'messages.send'));
    expect(effectivePermissions({ roles: ['admin'], groupPermissions: [['users.read', 'messages.send']] })).toContain('messages.send');
    for (const p of SUPER_ONLY_PERMISSIONS) expect(hasPermission({ roles: ['admin'] }, p)).toBe(false);
  });
  it('an admin group limits the admin to its permissions', () => {
    const s = { roles: ['admin'], groupPermissions: [['users.read', 'users.notes']] };
    expect(hasPermission(s, 'users.read')).toBe(true);
    expect(hasPermission(s, 'users.suspend')).toBe(false);
    expect(allowedActions(effectivePermissions(s))).toEqual(['view', 'notes']);
  });
  it('clients and consultants have no admin permissions', () => {
    expect(effectivePermissions({ roles: ['client', 'consultant'] })).toEqual([]);
  });
  it('the catalog matches the database list', () => {
    const m = sql.match(/admin_permission_catalog\(\)[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\]/);
    const fromSql = (m?.[1] ?? '').match(/'([a-z_.]+)'/g)?.map((s) => s.slice(1, -1));
    expect(fromSql).toEqual([...ADMIN_PERMISSIONS]);
  });
});

describe('role changes', () => {
  const base = { actorId: 'a', actorRoles: ['super_admin'], targetId: 'b', targetRoles: ['client'], superAdminCount: 2 };
  it('nobody changes their own roles, not even a super admin', () => {
    expect(checkRoleChange({ ...base, targetId: 'a', targetRoles: ['super_admin'], next: ['super_admin', 'client'] })).toEqual({ ok: false, error: 'self' });
  });
  it('only a super admin grants admin, and needs a reason', () => {
    expect(checkRoleChange({ ...base, actorRoles: ['admin'], next: ['client', 'admin'], reason: 'promote please' })).toEqual({ ok: false, error: 'needs_super' });
    expect(checkRoleChange({ ...base, next: ['client', 'admin'] })).toEqual({ ok: false, error: 'reason' });
    expect(checkRoleChange({ ...base, next: ['client', 'admin'], reason: 'new team lead' }).ok).toBe(true);
  });
  it('an admin may change client and consultant roles without a reason', () => {
    expect(checkRoleChange({ ...base, actorRoles: ['admin'], next: ['client', 'consultant'] }).ok).toBe(true);
  });
  it('the last super admin cannot be removed', () => {
    expect(checkRoleChange({ ...base, targetRoles: ['super_admin'], next: [], reason: 'stepping down', superAdminCount: 1 })).toEqual({ ok: false, error: 'last_super' });
    expect(checkRoleChange({ ...base, targetRoles: ['super_admin'], next: [], reason: 'stepping down', superAdminCount: 2 }).ok).toBe(true);
  });
  it('with 4-eyes on, granting super admin becomes a request', () => {
    const r = checkRoleChange({ ...base, next: ['client', 'super_admin'], reason: 'second owner', fourEyes: true });
    expect(r.ok && r.pendingSuperGrant).toBe(true);
  });
  it('reasons need at least 5 characters', () => {
    expect(reasonOk('abcd')).toBe(false);
    expect(reasonOk(' abcde ')).toBe(true);
  });
});

describe('filters in the address', () => {
  it('round-trips and keeps other parameters', () => {
    const f = { ...DEFAULT_FILTERS, q: 'sara', roles: ['consultant'], status: ['suspended'], inactive_days: '90', sort: 'name', dir: 'asc' as const, page: 3 };
    const sp = filtersToParams(f, new URLSearchParams('tab=users&user=x'));
    expect(sp.get('tab')).toBe('users');
    expect(sp.get('user')).toBe('x');
    expect(parseFilters(sp)).toEqual(f);
  });
  it('ignores unknown sort keys and page sizes', () => {
    const f = parseFilters(new URLSearchParams('sort=password&size=7&page=-2'));
    expect([f.sort, f.page_size, f.page]).toEqual(['created_at', 25, 1]);
  });
  it('turns end dates into the end of that day', () => {
    expect(toRpcParams({ ...DEFAULT_FILTERS, created_to: '2026-10-21' }).created_to).toBe('2026-10-21T23:59:59.999Z');
  });
});

const row = (o: Partial<UserRow>): UserRow => ({
  id: 'id', email: 'x@example.com', name: '', avatar_url: null, roles: [], status: 'active', providers: ['email'], email_verified: true,
  mfa_enabled: false, created_at: '2026-01-01T00:00:00Z', last_sign_in_at: null, last_active_at: null, country: null, company: null,
  organisations: [], consultant_id: null, verification_status: null, badge: null, founding: null, policy_ok: null, completion: null,
  open_tickets: null, payout_ready: null, client_approval: null, tags: [], is_self: false, ...o,
});

describe('basic-mode list filtering', () => {
  const rows = [
    row({ id: 'a', name: 'Sara', email: 'sara@x.com', roles: ['consultant'], last_active_at: '2026-10-20T00:00:00Z' }),
    row({ id: 'b', name: 'Omar', email: 'omar@x.com', roles: ['client'], status: 'suspended', company: 'Acme' }),
    row({ id: 'c', name: 'Old', email: 'old@x.com', roles: [], status: 'deleted' }),
  ];
  it('searches company, filters roles and hides deleted accounts by default', () => {
    expect(filterLocally(rows, { ...DEFAULT_FILTERS, q: 'acme' }).rows.map((r) => r.id)).toEqual(['b']);
    expect(filterLocally(rows, { ...DEFAULT_FILTERS, roles: ['none'], status: ['deleted'] }).rows.map((r) => r.id)).toEqual(['c']);
    expect(filterLocally(rows, DEFAULT_FILTERS).total).toBe(2);
  });
  it('finds people inactive for 90+ days', () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    expect(filterLocally(rows, { ...DEFAULT_FILTERS, inactive_days: '90' }, now).rows.map((r) => r.id)).toEqual(['b']);
  });
  it('pages the result', () => {
    const many = Array.from({ length: 30 }, (_, i) => row({ id: String(i).padStart(2, '0'), created_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z` }));
    const r = filterLocally(many, { ...DEFAULT_FILTERS, page: 2, page_size: 25 });
    expect([r.total, r.rows.length]).toEqual([30, 5]);
  });
});

describe('CSV export', () => {
  it('neutralises spreadsheet formulas and quotes', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell(['client', 'consultant'])).toBe('"client consultant"');
  });
  it('never exports phone numbers or ids', () => {
    const csv = usersCsv([row({ id: 'secret-id', phone: '+20123', name: 'Sara' })]);
    expect(csv).not.toContain('secret-id');
    expect(csv).not.toContain('+20123');
    expect(csv).toContain('"Sara"');
  });
});

describe('bulk invitations', () => {
  it('validates, de-duplicates and reads optional name, role and language', () => {
    const r = parseInviteList('email,name,role,language\nSara@x.com, Sara, consultant, ar\nsara@x.com\nnot-an-email\nomar@x.com', { role: 'client', language: 'en' });
    expect(r.rows).toEqual([
      { email: 'sara@x.com', name: 'Sara', role: 'consultant', language: 'ar' },
      { email: 'omar@x.com', name: undefined, role: 'client', language: 'en' },
    ]);
    expect(r.duplicates).toEqual(['sara@x.com']);
    expect(r.invalid).toEqual(['not-an-email']);
  });
  it(`stops at ${BULK_LIMIT} per run`, () => {
    const text = Array.from({ length: 205 }, (_, i) => `p${i}@x.com`).join('\n');
    const r = parseInviteList(text, { role: 'client', language: 'en' });
    expect([r.rows.length, r.overLimit]).toEqual([200, 5]);
  });
});

describe('keyboard and restore helpers', () => {
  it('j/k stay inside the list', () => {
    expect(nextIndex(-1, 'j', 3)).toBe(0);
    expect(nextIndex(2, 'j', 3)).toBe(2);
    expect(nextIndex(0, 'k', 3)).toBe(0);
    expect(nextIndex(0, 'j', 0)).toBe(-1);
  });
  it('counts restore days left', () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    expect(restoreDaysLeft('2026-10-31T00:00:00Z', now)).toBe(30);
    expect(restoreDaysLeft('2026-09-01T00:00:00Z', now)).toBe(0);
  });
});

describe('prepared database file', () => {
  it('is prepared only and never granted to signed-out visitors', () => {
    expect(sql).toMatch(/PREPARED ONLY/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon'/);
    expect(sql).not.toMatch(/GRANT[^;]*\bTO anon\b/);
  });
  it('every function fixes its search path', () => {
    const fns = sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?(?:AS \$\$|AS \$function\$)/g) ?? [];
    expect(fns.length).toBeGreaterThan(30);
    for (const f of fns) expect(f).toMatch(/SET search_path/);
  });
  it('suspended consultants are excluded from matching with the same rule as matching.sql', () => {
    const matching = readFileSync(resolve(__dirname, '../../docs/sql/matching.sql'), 'utf8');
    const body = (s: string) => s.slice(s.indexOf('CREATE OR REPLACE FUNCTION public.matching_inactive_consultants()'), s.indexOf('GRANT EXECUTE ON FUNCTION public.matching_inactive_consultants()'));
    expect(body(sql)).toBe(body(matching));
    expect(sql).toContain("IF to_regprocedure('public.um_suspended_consultant_ids()') IS NOT NULL THEN");
  });
  it('the last super admin and own-role rules are in the database', () => {
    expect(sql).toContain("RAISE EXCEPTION 'You cannot change your own roles'");
    expect(sql).toContain("RAISE EXCEPTION 'The last super admin cannot be removed'");
    expect(sql).toContain("RAISE EXCEPTION 'A bulk action can include at most 200 people'");
  });
});
