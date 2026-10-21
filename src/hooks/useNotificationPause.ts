import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from '@/hooks/useSessionReady';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { isPauseActive, type PauseDuration, type PauseState } from '@/lib/notificationPause';

export interface ActivePause extends PauseState {
  paused_from: string;
  duration: PauseDuration;
  mark_unavailable: boolean;
  source: 'settings' | 'bell' | 'email';
}
export interface PauseInfo {
  enabled: boolean;
  max_days: number;
  is_consultant: boolean;
  pause: ActivePause | null;
}
export interface PauseInput {
  duration: PauseDuration;
  email: boolean;
  in_app: boolean;
  categories: string[];
  hold_in_app: boolean;
  mark_unavailable: boolean;
  source: 'settings' | 'bell';
}

export const PAUSE_QUERY_KEY = ['notification-pause'];

// Called on the client object itself: a detached rpc method loses its binding.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>) => (supabase as any).rpc(name, args);

/**
 * The signed-in user's notification pause (Feature Q). `available` is false until the prepared database update is
 * applied, or while administrators have switched pausing off; controls are then hidden.
 */
export function useNotificationPause() {
  const { signedIn } = useSessionReady();
  const { isGuest } = useGuestMode();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: PAUSE_QUERY_KEY,
    enabled: signedIn && !isGuest,
    retry: false,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<PauseInfo> => {
      const { data, error } = await rpc('my_notification_pause');
      if (error) throw error;
      return data as PauseInfo;
    },
  });
  const info = query.data ?? null;
  const pause = info?.pause && isPauseActive(info.pause, Date.now()) ? info.pause : null;

  const pauseMutation = useMutation({
    mutationFn: async (input: PauseInput): Promise<PauseInfo> => {
      const { data, error } = await rpc('pause_my_notifications', {
        _duration: input.duration, _email: input.email, _in_app: input.in_app, _categories: input.categories,
        _hold_in_app: input.hold_in_app, _mark_unavailable: input.mark_unavailable, _source: input.source,
      });
      if (error) throw error;
      return data as PauseInfo;
    },
    onSuccess: (data) => {
      qc.setQueryData(PAUSE_QUERY_KEY, data);
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
  const resumeMutation = useMutation({
    mutationFn: async (source: 'settings' | 'bell'): Promise<PauseInfo> => {
      const { data, error } = await rpc('resume_my_notifications', { _source: source });
      if (error) throw error;
      return data as PauseInfo;
    },
    onSuccess: (data) => qc.setQueryData(PAUSE_QUERY_KEY, data),
  });

  return {
    loading: query.isLoading,
    available: query.isSuccess && !!info?.enabled,
    notInstalled: query.isError,
    info,
    pause,
    pauseNow: pauseMutation,
    resume: resumeMutation,
  };
}
