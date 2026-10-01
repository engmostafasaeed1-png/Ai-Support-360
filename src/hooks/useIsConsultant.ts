import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getSessionWithRetry } from '@/lib/authSession';

const QUERY_KEY = ['is-consultant'];

/**
 * True when the signed-in user holds the consultant role. This only decides
 * whether the "Switch to Consultant" shortcut is shown; the /consultant route
 * and the database policies remain the real access control.
 */
export function useIsConsultant() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    });
    return () => subscription.unsubscribe();
  }, [queryClient]);

  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<boolean> => {
      const session = await getSessionWithRetry();
      if (!session?.user) return false;
      const { data: rows } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('role', 'consultant' as any);
      return !!rows && rows.length > 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  return data === true;
}
