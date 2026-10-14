import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Queries that answer an empty result while the session is still being restored. */
export const SIGN_IN_DEPENDENT_KEYS = [['my-consultant-availability'], ['my-availability-slots']] as const;

/** Reloads those queries once when the sign-in arrives. Mount once in the consultant layout. */
export function useRefetchOnSignIn(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_IN') return;
      for (const queryKey of SIGN_IN_DEPENDENT_KEYS) qc.invalidateQueries({ queryKey: [...queryKey] });
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);
}
