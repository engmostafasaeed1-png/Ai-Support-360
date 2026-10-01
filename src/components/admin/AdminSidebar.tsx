import { useMemo } from 'react';
import PortalSidebar from '@/components/sidebar/PortalSidebar';
import { adminNavGroups } from '@/components/sidebar/navConfig';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';

export default function AdminSidebar() {
  const isSuperAdmin = useIsSuperAdmin();

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
    />
  );
}
