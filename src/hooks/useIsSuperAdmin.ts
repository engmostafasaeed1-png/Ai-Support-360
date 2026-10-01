import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const QUERY_KEY = ['is-super-admin'];

/**
 * True when the signed-in user holds the super_admin role.
 * This only decides whether a menu link is shown; the /super-admin routes
 * and the database policies remain the real access control.
 */
export function useIsSuperAdmin() {
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
      const { data: row } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('role', 'super_admin' as any)
        .maybeSingle();
      return !!row;
    },
    staleTime: 5 * 60 * 1000,
  });

  return data === true;
}
