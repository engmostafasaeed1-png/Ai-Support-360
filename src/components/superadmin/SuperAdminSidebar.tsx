import PortalSidebar from '@/components/sidebar/PortalSidebar';
import { superAdminNavGroups } from '@/components/sidebar/navConfig';

export default function SuperAdminSidebar() {
  return (
    <PortalSidebar
      scope="super-admin"
      rootPath="/super-admin"
      homePath="/super-admin"
      subtitleKey="super_admin.title"
      subtitleFallback="Super Admin"
      groups={superAdminNavGroups}
    />
  );
}
