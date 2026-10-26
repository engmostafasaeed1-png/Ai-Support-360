import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { safeRpc } from '@/lib/safeRpc';
import { PUBLIC_ACHIEVEMENT_COLUMNS, type Achievement, type AchievementInput } from '@/lib/achievements';

export const MY_ACHIEVEMENTS_KEY = ['my-achievements'] as const;
const db = supabase as any;

/** The signed-in consultant's own stories (all statuses). `applied` is false until docs/sql/consultant-achievements.sql exists. */
export function useMyAchievements() {
  const q = useQuery({
    queryKey: MY_ACHIEVEMENTS_KEY,
    staleTime: 60_000,
    queryFn: async (): Promise<{ applied: boolean; list: Achievement[] }> => {
      const { data, error } = await safeRpc('my_achievements');
      if (error) return { applied: false, list: [] };
      return { applied: true, list: Array.isArray(data) ? (data as Achievement[]) : [] };
    },
  });
  return { applied: q.data?.applied === true, list: q.data?.list ?? [], isLoading: q.isLoading };
}

export function useAchievementActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: MY_ACHIEVEMENTS_KEY });
  return {
    save: async (id: string | null, input: AchievementInput & { is_public?: boolean }) => {
      const r = await safeRpc('my_achievement_save', { _id: id, _data: input });
      await done();
      return r;
    },
    setPublic: async (id: string, value: boolean) => { const r = await safeRpc('my_achievement_set_public', { _id: id, _public: value }); await done(); return r; },
    remove: async (id: string) => { const r = await safeRpc('my_achievement_delete', { _id: id }); await done(); return r; },
    /** Private evidence upload: "<user>/<story>/<file>" in the private bucket, then the path is recorded by the database. */
    uploadEvidence: async (id: string, file: File) => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return { data: null, error: { message: 'permission_missing' } };
      const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80);
      const path = `${auth.user.id}/${id}/${Date.now()}-${safe}`;
      const up = await supabase.storage.from('achievement-evidence').upload(path, file, { upsert: false, contentType: file.type });
      if (up.error) return { data: null, error: { message: up.error.message } };
      const r = await safeRpc('my_achievement_set_evidence', { _id: id, _path: path });
      await done();
      return r;
    },
  };
}

/** Public stories of one consultant (as the viewer may see them). Empty until the SQL is applied. */
export function usePublicAchievements(consultantId: string | null | undefined) {
  return useQuery({
    queryKey: ['public-achievements', consultantId],
    enabled: !!consultantId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Achievement[]> => {
      const { data, error } = await db.from('consultant_achievements').select(PUBLIC_ACHIEVEMENT_COLUMNS)
        .eq('consultant_id', consultantId).eq('is_public', true).in('status', ['verified', 'self_declared']).order('sort');
      return error || !Array.isArray(data) ? [] : (data as Achievement[]);
    },
  });
}

/** Public stories for a list of consultants in one request (directory, team cards). */
export function usePublicAchievementsMap(ids: string[]): Map<string, Achievement[]> {
  const key = useMemo(() => [...new Set(ids)].sort().join(','), [ids]);
  const q = useQuery({
    queryKey: ['public-achievements-map', key],
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Achievement[]> => {
      const { data, error } = await db.from('consultant_achievements').select(PUBLIC_ACHIEVEMENT_COLUMNS)
        .in('consultant_id', key.split(',').slice(0, 500)).eq('is_public', true).in('status', ['verified', 'self_declared']).order('sort');
      return error || !Array.isArray(data) ? [] : (data as Achievement[]);
    },
  });
  return useMemo(() => {
    const m = new Map<string, Achievement[]>();
    for (const a of q.data ?? []) if (a.consultant_id) m.set(a.consultant_id, [...(m.get(a.consultant_id) ?? []), a]);
    return m;
  }, [q.data]);
}
