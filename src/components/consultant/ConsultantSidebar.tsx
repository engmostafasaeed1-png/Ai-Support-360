import { useEffect, useState } from 'react';
import PortalSidebar from '@/components/sidebar/PortalSidebar';
import { consultantNavGroups } from '@/components/sidebar/navConfig';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { supabase } from '@/integrations/supabase/client';

export default function ConsultantSidebar() {
  const { isGuest } = useGuestMode();
  const [onboardingDone, setOnboardingDone] = useState(false);

  useEffect(() => {
    if (isGuest) return;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      supabase.from('profiles').select('onboarding_completed').eq('user_id', session.user.id).maybeSingle()
        .then(({ data }) => { if (data?.onboarding_completed) setOnboardingDone(true); });
    });
  }, [isGuest]);

  return (
    <PortalSidebar
      scope="consultant"
      rootPath="/consultant"
      subtitleKey="sidebar.portal_consultant"
      subtitleFallback="Consultant portal"
      groups={consultantNavGroups}
      itemState={{ onboarding: { done: onboardingDone } }}
      profileRole="consultant"
    />
  );
}
