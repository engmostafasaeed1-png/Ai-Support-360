import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
export function useProfileAutosaveReady() {
  return useQuery({ queryKey: ['profile-autosave-ready'], retry: false, staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc('profile_autosave_ready');
      return !error && data === true;
    },
  });
}
