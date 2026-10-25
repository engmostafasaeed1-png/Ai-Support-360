import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getSessionWithRetry } from '@/lib/authSession';
import { usePageVisibility } from '@/hooks/usePageVisibility';
import { pageAccess, type PageVisibilitySetting } from '@/lib/pageVisibility';

/**
 * Hides a page while its owner switch is off: visitors are sent to `redirectTo` (nothing is drawn before the
 * decision, so the page never flashes). Administrators may still open it by URL for review.
 */
export default function PageVisibilityGate({ setting, redirectTo, children }: { setting: PageVisibilitySetting; redirectTo: string; children: ReactNode }) {
  const { visible, loading } = usePageVisibility();
  const admin = useQuery({
    queryKey: ['page-visibility-admin'],
    queryFn: async (): Promise<boolean> => {
      const session = await getSessionWithRetry();
      if (!session?.user) return false;
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id).in('role', ['admin', 'super_admin'] as never);
      return !!data && data.length > 0;
    },
    staleTime: 5 * 60_000,
  });
  const decision = pageAccess({ loading: loading || admin.isLoading, visible: visible[setting] === true, isAdmin: admin.data === true });
  if (decision === 'wait') return null;
  if (decision === 'redirect') return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
