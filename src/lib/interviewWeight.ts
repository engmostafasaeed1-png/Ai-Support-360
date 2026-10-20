import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { clampInterviewWeight, DEFAULT_INTERVIEW_WEIGHT } from '@/lib/profileCompleteness';

export const INTERVIEW_WEIGHT_KEY = ['profile-interview-weight'] as const;
const TTL_MS = 5 * 60 * 1000;
let cached: { value: number; at: number } | null = null;
let inflight: Promise<number> | null = null;

/**
 * The admin-set share of profile completion that belongs to the AI interview.
 * Read through the public weight function; until the prepared SQL is applied (or on any error) the default 15 is used.
 */
export function fetchInterviewWeight(): Promise<number> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await (supabase as any).rpc('profile_interview_weight');
      const value = error || data === null || data === undefined ? DEFAULT_INTERVIEW_WEIGHT : clampInterviewWeight(data);
      cached = { value, at: Date.now() };
      return value;
    } catch {
      return DEFAULT_INTERVIEW_WEIGHT;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function resetInterviewWeightCache(): void { cached = null; inflight = null; }

export function useInterviewWeight(): number {
  const q = useQuery({ queryKey: INTERVIEW_WEIGHT_KEY, queryFn: fetchInterviewWeight, staleTime: TTL_MS });
  return q.data ?? DEFAULT_INTERVIEW_WEIGHT;
}
