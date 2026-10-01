import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const QUERY_KEY = ['is-admin'];

/**
 * True when the signed-in user holds the admin or super_admin role.
 * This only decides whether the "Admin console" shortcut is shown; the
 * /admin routes and the database policies remain the real access control.
 */
export function useIsAdmin() {
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return false;
      const { data: rows } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .in('role', ['admin', 'super_admin'] as any);
      return !!rows && rows.length > 0;
    },
    staleTime: 5 * 60 * 1000,
  });

  return data === true;
}
