import PortalSidebar from '@/components/sidebar/PortalSidebar';
import { consultantNavGroups } from '@/components/sidebar/navConfig';

export default function ConsultantSidebar() {
  return (
    <PortalSidebar
      scope="consultant"
      rootPath="/consultant"
      subtitleKey="sidebar.portal_consultant"
      subtitleFallback="Consultant portal"
      groups={consultantNavGroups}
      profileRole="consultant"
    />
  );
}
