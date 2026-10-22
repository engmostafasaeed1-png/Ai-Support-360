import PortalSidebar from '@/components/sidebar/PortalSidebar';
import { consultantNavGroups } from '@/components/sidebar/navConfig';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useReferNav } from '@/hooks/useReferralTracking';

export default function ConsultantSidebar() {
  const { isGuest } = useGuestMode();
  const nav = useReferNav(!isGuest);
  return (
    <PortalSidebar
      scope="consultant"
      rootPath="/consultant"
      subtitleKey="sidebar.portal_consultant"
      subtitleFallback="Consultant portal"
      groups={consultantNavGroups}
      itemState={{ referrals: { dot: nav.dot || nav.count > 0 } }}
      profileRole="consultant"
    />
  );
}
