import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import PortalSidebar from '@/components/sidebar/PortalSidebar';
import { adminNavGroups } from '@/components/sidebar/navConfig';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { supabase } from '@/integrations/supabase/client';

export default function AdminSidebar() {
  const isSuperAdmin = useIsSuperAdmin();

  // How many new clients wait for a decision: shown as a badge on "Client approvals".
  const { data: waiting = 0 } = useQuery({
    queryKey: ['admin-client-approval-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_client_approval_counts');
      if (error) throw error;
      const counts = (data ?? {}) as { awaiting_confirmation?: number };
      return Number(counts.awaiting_confirmation ?? 0);
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
  const itemState = useMemo(() => ({ client_approvals: { badge: waiting } }), [waiting]);

  // The Super Admin link is only useful to people who can open it.
  const groups = useMemo(
    () =>
      adminNavGroups.map((g) => ({
        ...g,
        items: g.items.filter((i) => i.key !== 'super_admin' || isSuperAdmin),
      })),
    [isSuperAdmin],
  );

  return (
    <PortalSidebar
      scope="admin"
      rootPath="/admin"
      subtitleKey="sidebar.portal_admin"
      subtitleFallback="Admin console"
      groups={groups}
      itemState={itemState}
    />
  );
}
