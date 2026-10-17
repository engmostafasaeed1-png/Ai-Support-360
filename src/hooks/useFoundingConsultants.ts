import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSessionReady } from './useSessionReady';
import type { FoundingAward } from '@/lib/foundingConsultants';
export const FOUNDING_KEY = ['founding-consultants'] as const;
// Optional feature: fail closed until its deliberately unapplied SQL is installed.
export function useFoundingConsultants() {
  const { signedIn } = useSessionReady();
  return useQuery({ queryKey: FOUNDING_KEY, enabled: signedIn, retry: false, staleTime: 60_000,
    queryFn: async () => {
      const awards: FoundingAward[] = [];
      for (let from = 0; from < 100000; from += 1000) {
        const { data, error } = await (supabase as any).from('founding_consultants')
          .select('consultant_id, founding_number, awarded_at, revoked_at').is('revoked_at', null).order('founding_number').range(from, from + 999);
        if (error) return new Map<string, FoundingAward>();
        awards.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return new Map(awards.map(a => [a.consultant_id, a]));
    },
  });
}
export function useFoundingSpots() {
  return useQuery({ queryKey: ['founding-spots'], retry: false, staleTime: 60_000, queryFn: async () => {
    const { data, error } = await (supabase as any).rpc('founding_spots_remaining');
    return !error && typeof data === 'number' ? data : 0;
  } });
}
export function useFoundingBoost() {
  const { signedIn } = useSessionReady();
  return useQuery({ queryKey: ['founding-boost'], enabled: signedIn, retry: false, staleTime: 60_000, queryFn: async () => {
    const { data, error } = await (supabase as any).rpc('founding_boost_duration');
    return !error && typeof data === 'number' ? data : 0;
  } });
}
