import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PAGE_VISIBILITY_SETTINGS, type PageVisibility } from '@/lib/pageVisibility';

/** Owner switches for hideable pages (see src/lib/pageVisibility.ts). Rows the user may not read count as off. */
export function usePageVisibility() {
  const q = useQuery({
    queryKey: ['page-visibility'],
    queryFn: async (): Promise<PageVisibility> => {
      const { data, error } = await supabase.from('platform_settings').select('key, value').in('key', [...PAGE_VISIBILITY_SETTINGS]);
      if (error) return {};
      const out: PageVisibility = {};
      for (const row of data ?? []) out[row.key as keyof PageVisibility] = row.value === true || row.value === 'true';
      return out;
    },
    staleTime: 60_000,
  });
  return { visible: q.data ?? {}, loading: q.isLoading };
}
