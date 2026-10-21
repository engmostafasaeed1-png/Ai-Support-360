import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { filterLocally, isNotInstalled, normalizeUserDetail, toRpcParams, type UserFilters, type UserRow } from '@/lib/userAdmin';

// The new database functions are not in the generated types until the prepared file is applied.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as any).call(supabase, fn, args) as Promise<{ data: any; error: any }>;

export class NotInstalledError extends Error {
  constructor() { super('not_installed'); }
}

export async function callRpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) {
    if (isNotInstalled(error)) throw new NotInstalledError();
    throw new Error(error.message || 'Action failed');
  }
  return data as T;
}

export async function callEdge<T = Record<string, unknown>>(fn: 'admin-manage-user' | 'admin-send-invitation', body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error || data?.error) {
    let msg = data?.error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = (error as any)?.context;
    if (!msg && ctx?.json) { try { msg = (await ctx.json()).error; } catch { /* ignore */ } }
    throw new Error(msg || 'Action failed');
  }
  return data as T;
}

export interface MyAdminPermissions {
  installed: boolean; is_super: boolean; is_admin: boolean; scoped: boolean; permissions: string[];
  four_eyes: boolean; security_alerts: boolean;
}

/** The signed-in admin's permissions; installed=false until the prepared database update is applied. */
export function useMyAdminPermissions() {
  return useQuery({
    queryKey: ['um', 'me'],
    staleTime: 60_000,
    queryFn: async (): Promise<MyAdminPermissions> => {
      try {
        return await callRpc<MyAdminPermissions>('my_admin_permissions');
      } catch (e) {
        if (!(e instanceof NotInstalledError)) throw e;
        const { data: { session } } = await supabase.auth.getSession();
        const { data } = await supabase.from('user_roles').select('role').eq('user_id', session?.user.id ?? '');
        const roles = (data ?? []).map((r) => String(r.role));
        const isSuper = roles.includes('super_admin');
        const base = ['users.read', 'users.edit', 'users.roles', 'users.suspend', 'users.invite', 'users.export', 'users.sessions'];
        return {
          installed: false, is_super: isSuper, is_admin: isSuper || roles.includes('admin'), scoped: false,
          permissions: isSuper ? [...base, 'users.hard_delete', 'users.mfa_reset'] : base, four_eyes: false, security_alerts: false,
        };
      }
    },
  });
}

export interface SearchResult { total: number; rows: UserRow[] }

export function useUsersSearch(filters: UserFilters, installed: boolean | undefined) {
  return useQuery({
    queryKey: ['um', 'search', installed, filters],
    enabled: installed !== undefined,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<SearchResult> => {
      if (installed) return await callRpc<SearchResult>('admin_users_search', { _p: toRpcParams(filters) });
      const all = await legacyList();
      return filterLocally(all, filters);
    },
  });
}

let legacyCache: { at: number; rows: UserRow[] } | null = null;
async function legacyList(): Promise<UserRow[]> {
  if (legacyCache && Date.now() - legacyCache.at < 30_000) return legacyCache.rows;
  const data = await callEdge<{ users: UserRow[] }>('admin-manage-user', { action: 'list' });
  legacyCache = { at: Date.now(), rows: data.users ?? [] };
  return legacyCache.rows;
}
export function clearLegacyCache() { legacyCache = null; }

/** Every matching id (first 200) for "select all matching". */
export async function searchIds(filters: UserFilters, installed: boolean): Promise<{ total: number; ids: string[] }> {
  if (installed) return await callRpc('admin_users_search', { _p: { ...toRpcParams(filters), ids_only: true } });
  const all = filterLocally(await legacyList(), { ...filters, page: 1, page_size: 100_000 });
  return { total: all.total, ids: all.rows.slice(0, 200).map((r) => r.id) };
}

export async function searchAll(filters: UserFilters, installed: boolean, max = 2000): Promise<UserRow[]> {
  if (!installed) return filterLocally(await legacyList(), { ...filters, page: 1, page_size: max }).rows;
  const out: UserRow[] = [];
  for (let page = 1; out.length < max; page++) {
    const r = await callRpc<SearchResult>('admin_users_search', { _p: { ...toRpcParams(filters), page, page_size: 100 } });
    out.push(...r.rows);
    if (r.rows.length < 100) break;
  }
  return out;
}

export interface UserStats {
  total: number; active_30d: number; new_week: number; suspended: number; unverified_email: number; deleted: number;
  pending_approvals: number; inactive_90d: number; incomplete_profiles: number;
}
export function useUsersStats(installed: boolean | undefined) {
  return useQuery({
    queryKey: ['um', 'stats', installed],
    enabled: installed !== undefined,
    queryFn: async (): Promise<UserStats> => {
      if (installed) return await callRpc<UserStats>('admin_users_stats');
      const all = await legacyList();
      const now = Date.now();
      const active = (u: UserRow) => u.last_active_at && Date.parse(u.last_active_at) > now - 30 * 86_400_000;
      return {
        total: all.length, active_30d: all.filter((u) => u.status === 'active' && active(u)).length,
        new_week: all.filter((u) => Date.parse(u.created_at) > now - 7 * 86_400_000).length,
        suspended: all.filter((u) => u.status === 'suspended').length,
        unverified_email: all.filter((u) => u.status === 'pending' || u.status === 'invited').length, deleted: 0,
        pending_approvals: all.filter((u) => u.client_approval === 'awaiting_confirmation' || u.verification_status === 'pending' || u.verification_status === 'under_review').length,
        inactive_90d: all.filter((u) => u.status === 'active' && Date.parse(u.last_active_at ?? u.created_at) < now - 90 * 86_400_000).length,
        incomplete_profiles: 0,
      };
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UserDetail = Record<string, any>;
export function useUserDetail(id: string | null, installed: boolean | undefined) {
  return useQuery({
    queryKey: ['um', 'detail', id, installed],
    enabled: !!id && installed !== undefined,
    queryFn: async (): Promise<UserDetail> => {
      if (installed) return await callRpc<UserDetail>('admin_user_detail', { _uid: id });
      const row = (await legacyList()).find((u) => u.id === id);
      return { user: row ?? null, legacy: true };
    },
  });
}

export function useInvalidateUsers() {
  const qc = useQueryClient();
  return () => {
    clearLegacyCache();
    qc.invalidateQueries({ queryKey: ['um'] });
    qc.invalidateQueries({ queryKey: ['admin-users'] });
  };
}

export function useSavedViews(enabled: boolean) {
  return useQuery({
    queryKey: ['um', 'views'],
    enabled,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)('admin_saved_views').select('id, name, params, created_at').order('name');
      if (error) { if (isNotInstalled(error)) return []; throw error; }
      return (data ?? []) as Array<{ id: string; name: string; params: Record<string, string> }>;
    },
  });
}

export async function saveView(name: string, params: Record<string, string>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from as any)('admin_saved_views').insert({ name: name.trim().slice(0, 60), params });
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'A view with this name already exists' : error.message);
}
export async function deleteView(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from as any)('admin_saved_views').delete().eq('id', id);
  if (error) throw error;
}

export function useRpcQuery<T>(key: string, fn: string, enabled: boolean, args?: Record<string, unknown>) {
  return useQuery({
    queryKey: ['um', key, args],
    enabled,
    queryFn: () => callRpc<T>(fn, args),
  });
}
