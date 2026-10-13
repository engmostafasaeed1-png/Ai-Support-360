import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** The consultants that the client directory, the map and the pickers must not show (incomplete profiles while the admin switch is on). */
export async function fetchHiddenConsultantIds(): Promise<string[]> {
  try {
    const { data, error } = await (supabase as any).rpc('hidden_consultant_ids');
    if (error || !Array.isArray(data)) return [];
    return data as string[];
  } catch {
    // Never show an error: when the call fails everyone is shown.
    return [];
  }
}

export function useHiddenConsultantIds(enabled = true) {
  const { data } = useQuery({
    queryKey: ['hidden-consultant-ids'],
    queryFn: fetchHiddenConsultantIds,
    staleTime: 2 * 60 * 1000,
    enabled,
  });
  return data || [];
}

/** The list without the hidden ids. */
export function withoutHidden<T extends { id: string }>(list: T[], hidden: readonly string[]): T[] {
  if (hidden.length === 0) return list;
  const set = new Set(hidden);
  return list.filter(c => !set.has(c.id));
}
