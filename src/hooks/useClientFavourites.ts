import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/contexts/TenantContext';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useSessionReady } from '@/hooks/useSessionReady';
import { safeRpc } from '@/lib/safeRpc';
import {
  canEditScope, cleanTags, DEFAULT_INVITE_LIMIT, isMissingFeature, scopeFor,
  type ConsultantGroup, type Favourite, type FavScope, type GroupColour, type GroupIcon,
} from '@/lib/clientFavourites';

// Feature O tables are not in the generated types until docs/sql/client-favourites.sql is applied.
const from = (table: string): any => (supabase as unknown as { from: (t: string) => any }).from(table);
type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = (fn: string, args?: Record<string, unknown>): Promise<RpcResult> =>
  safeRpc(fn, args);

export interface ClientFavData {
  ready: boolean;
  favourites: Map<string, Favourite>;
  groups: ConsultantGroup[];
  notes: Map<string, string>;
  blocked: Set<string>;
  inviteLimit: number;
}

const EMPTY: ClientFavData = { ready: false, favourites: new Map(), groups: [], notes: new Map(), blocked: new Set(), inviteLimit: DEFAULT_INVITE_LIMIT };

const scoped = (q: any, s: FavScope) => (s.tenantId ? q.eq('tenant_id', s.tenantId) : q.eq('owner_user_id', s.ownerUserId));
const scopeCols = (s: FavScope) => (s.tenantId ? { tenant_id: s.tenantId } : { owner_user_id: s.ownerUserId });

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

function fail(error: { message?: string } | null | undefined): never {
  throw new Error(error?.message || 'request failed');
}

/**
 * Feature O: the favourites, groups, private notes and "do not suggest" list of the active client organisation
 * (or of the client when they have none). Everything stays empty and `ready` false until the prepared SQL is applied,
 * so every favourite control hides itself (fails closed).
 */
export function useClientFavourites() {
  const qc = useQueryClient();
  const { isGuest } = useGuestMode();
  const { signedIn } = useSessionReady();
  const { tenant, membership, loading: tenantLoading } = useTenant();

  const user = useQuery({
    queryKey: ['client-favs-user'],
    enabled: signedIn && !isGuest,
    staleTime: Infinity,
    queryFn: currentUserId,
  });
  const scope = useMemo(() => scopeFor(tenant?.id, user.data), [tenant?.id, user.data]);
  const canEdit = canEditScope(scope, membership?.org_role ?? null);
  const key = useMemo(() => ['client-favs', scope?.tenantId ?? null, scope?.ownerUserId ?? null] as const, [scope]);

  const q = useQuery({
    queryKey: key,
    enabled: !!scope && !tenantLoading && !isGuest,
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<ClientFavData> => {
      const s = scope as FavScope;
      const [favs, groups, notes, blocks, limit] = await Promise.all([
        scoped(from('client_consultant_favourites').select('consultant_id, tags, created_at'), s).limit(1000),
        scoped(from('client_consultant_groups').select('id, name, description, colour, icon, position, preferred_areas, archived_at, client_consultant_group_members(consultant_id)'), s).limit(200),
        scoped(from('client_consultant_notes').select('consultant_id, note'), s).limit(1000),
        scoped(from('client_consultant_blocks').select('consultant_id'), s).limit(1000),
        rpc('client_group_invite_limit'),
      ]);
      const firstError = favs.error ?? groups.error ?? notes.error ?? blocks.error;
      if (firstError) {
        if (isMissingFeature(firstError.message)) return EMPTY;
        fail(firstError);
      }
      return {
        ready: true,
        favourites: new Map(((favs.data ?? []) as Favourite[]).map((f) => [f.consultant_id, { ...f, tags: f.tags ?? [] }])),
        groups: ((groups.data ?? []) as Array<Record<string, any>>).map((g) => ({
          id: g.id, name: g.name, description: g.description ?? null, colour: g.colour as GroupColour, icon: g.icon as GroupIcon,
          position: Number(g.position) || 0, preferred_areas: g.preferred_areas ?? [], archived_at: g.archived_at ?? null,
          members: ((g.client_consultant_group_members ?? []) as Array<{ consultant_id: string }>).map((m) => m.consultant_id),
        })),
        notes: new Map(((notes.data ?? []) as Array<{ consultant_id: string; note: string }>).map((n) => [n.consultant_id, n.note])),
        blocked: new Set(((blocks.data ?? []) as Array<{ consultant_id: string }>).map((b) => b.consultant_id)),
        inviteLimit: typeof limit.data === 'number' && limit.data > 0 ? limit.data : DEFAULT_INVITE_LIMIT,
      };
    },
  });

  const data = q.data ?? EMPTY;
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['client-favs'] }), [qc]);

  const run = useCallback(async (job: (s: FavScope, uid: string) => Promise<{ error: any } | Array<{ error: any }>>) => {
    if (!scope || !canEdit) throw new Error('not_allowed');
    const uid = await currentUserId();
    if (!uid) throw new Error('not_allowed');
    const res = await job(scope, uid);
    const err = Array.isArray(res) ? res.find((r) => r.error)?.error : res.error;
    await refresh();
    if (err) fail(err);
  }, [scope, canEdit, refresh]);

  const api = useMemo(() => ({
    addFavourite: (id: string) => run((s, uid) => from('client_consultant_favourites').insert({ ...scopeCols(s), consultant_id: id, added_by: uid })),
    removeFavourites: (ids: string[]) => run((s) => scoped(from('client_consultant_favourites').delete(), s).in('consultant_id', ids)),
    setTags: (id: string, tags: string[]) => {
      const c = cleanTags(tags);
      if (c.error) return Promise.reject(new Error(`client_fav_${c.error}`));
      return run((s) => scoped(from('client_consultant_favourites').update({ tags: c.tags }), s).eq('consultant_id', id));
    },
    tagMany: (ids: string[], tag: string) => run((s) => Promise.all(ids.map((id) => {
      const current = data.favourites.get(id)?.tags ?? [];
      const c = cleanTags([...current, tag]);
      if (c.error) return Promise.resolve({ error: { message: `client_fav_${c.error}` } });
      return scoped(from('client_consultant_favourites').update({ tags: c.tags }), s).eq('consultant_id', id);
    }))),
    // Partial unique indexes cannot be used for upsert: update first, insert when there was no note.
    saveNote: (id: string, note: string) => run(async (s, uid) => {
      const text = note.trim();
      if (!text) return scoped(from('client_consultant_notes').delete(), s).eq('consultant_id', id);
      const upd = await scoped(from('client_consultant_notes').update({ note: text, updated_by: uid }), s).eq('consultant_id', id).select('consultant_id');
      if (upd.error || (upd.data ?? []).length > 0) return upd;
      return from('client_consultant_notes').insert({ ...scopeCols(s), consultant_id: id, note: text, updated_by: uid });
    }),
    block: (id: string) => run((s, uid) => from('client_consultant_blocks').insert({ ...scopeCols(s), consultant_id: id, created_by: uid })),
    unblock: (id: string) => run((s) => scoped(from('client_consultant_blocks').delete(), s).eq('consultant_id', id)),
    createGroup: (g: { name: string; description: string | null; colour: GroupColour; icon: GroupIcon; preferred_areas: string[] }) =>
      run((s, uid) => from('client_consultant_groups').insert({ ...scopeCols(s), ...g, position: data.groups.length, created_by: uid })),
    updateGroup: (id: string, patch: Partial<{ name: string; description: string | null; colour: GroupColour; icon: GroupIcon; preferred_areas: string[]; archived_at: string | null; position: number }>) =>
      run(() => from('client_consultant_groups').update(patch).eq('id', id)),
    reorderGroups: (positions: Array<{ id: string; position: number }>) =>
      run(() => Promise.all(positions.map((p) => from('client_consultant_groups').update({ position: p.position }).eq('id', p.id)))),
    deleteGroup: (id: string) => run(() => from('client_consultant_groups').delete().eq('id', id)),
    addToGroup: (groupId: string, ids: string[]) => run((_s, uid) => from('client_consultant_group_members')
      .upsert(ids.map((consultant_id) => ({ group_id: groupId, consultant_id, added_by: uid })), { onConflict: 'group_id,consultant_id', ignoreDuplicates: true })),
    removeFromGroup: (groupId: string, ids: string[]) => run(() => from('client_consultant_group_members').delete().eq('group_id', groupId).in('consultant_id', ids)),
  }), [run, data]);

  return {
    ...data,
    loading: q.isLoading,
    error: q.error as Error | null,
    canEdit: data.ready && canEdit,
    scope,
    isOrganisation: !!scope?.tenantId,
    isFavourite: (id: string) => data.favourites.has(id),
    groupsOf: (id: string) => data.groups.filter((g) => g.members.includes(id)).map((g) => g.id),
    ...api,
  };
}

export type ClientFavourites = ReturnType<typeof useClientFavourites>;
