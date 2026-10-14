import { useSessionReady } from '@/hooks/useSessionReady';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TOUR_VERSION, type TourProgress, type TourStatus } from '@/lib/tour';

const db = supabase as any;

export const tourProgressQueryKey = (key: string) => ['tour-progress', key];

/** The saved progress of one tour. Errors never block the UI: the tour then simply runs locally. */
export function useTourProgress(key: string, enabled = true) {
  const qc = useQueryClient();
  const signedIn = useSessionReady().signedIn;
  const query = useQuery({
    enabled: signedIn,
    queryKey: tourProgressQueryKey(key),
    enabled,
    retry: false,
    queryFn: async (): Promise<TourProgress | null> => {
      try {
        const { data, error } = await db.from('user_tour_progress')
          .select('tour_key, tour_version, last_step, completed_at, skipped_at')
          .eq('tour_key', key)
          .maybeSingle();
        if (error) return null;
        return (data ?? null) as TourProgress | null;
      } catch {
        return null;
      }
    },
  });

  const saveM = useMutation({
    mutationFn: async ({ step, status }: { step: number; status: TourStatus }) => {
      try {
        await db.rpc('save_tour_progress', { _key: key, _version: TOUR_VERSION, _last_step: Math.max(0, Math.min(50, step)), _status: status });
      } catch { /* keep working locally */ }
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: tourProgressQueryKey(key) }); },
  });

  const resetM = useMutation({
    mutationFn: async () => {
      try { await db.rpc('reset_tour_progress', { _key: key }); } catch { /* keep working locally */ }
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: tourProgressQueryKey(key) }); },
  });

  return {
    progress: query.data ?? null,
    isLoading: query.isLoading,
    save: (step: number, status: TourStatus) => saveM.mutateAsync({ step, status }),
    reset: () => resetM.mutateAsync(),
  };
}
