import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { useMyPolicy, usePolicyVersion } from '@/hooks/useConsultantPolicy';
import { sessionIdOf } from '@/lib/assignmentPopupAcks';
import { isNewConsultant, policyPopupKey, shouldShowPolicyPopup } from '@/lib/consultantPolicy';
import PolicyDialog, { policyLang } from './PolicyDialog';

const PREFIX = 'consultant-policy-popup:';

function handled(key: string | null): boolean {
  if (!key) return false;
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}

function remember(key: string | null) {
  if (!key) return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k !== key) localStorage.removeItem(k);
    }
    localStorage.setItem(key, '1');
  } catch { /* storage unavailable: the pop-up comes back on the next page load */ }
}

/**
 * Mounted once in the consultant portal. While the current policy version is not confirmed, the pop-up opens once per
 * sign-in session (every sign-in until confirmed). Never on the profile page, which shows the same step inline.
 * Never blocks sign-in or navigation.
 */
export default function PolicyGate() {
  const { t, i18n } = useTranslation();
  const { isGuest } = useGuestMode();
  const { pathname } = useLocation();
  const my = useMyPolicy();
  const version = my.raw?.current_version ?? null;
  const policyQ = usePolicyVersion(version);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const shownFor = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => { if (active) setSessionId(sessionIdOf(data.session)); });
    return () => { active = false; };
  }, []);

  const key = version ? policyPopupKey(sessionId, version) : null;
  useEffect(() => {
    if (isGuest || !my.ready || !my.isConsultant || !version || !sessionId || !policyQ.data?.ready || open) return;
    if (!shouldShowPolicyPopup({ state: my.status.state, handledThisSession: handled(key), onInlinePage: pathname.startsWith('/consultant/profile') })) return;
    if (shownFor.current === key) return;
    shownFor.current = key;
    setOpen(true);
    void my.markShown(version);
  }, [isGuest, my.ready, my.isConsultant, my.status.state, version, sessionId, key, policyQ.data?.ready, pathname, open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !version || !policyQ.data?.ready) return null;
  const later = () => { remember(key); setOpen(false); };
  return (
    <PolicyDialog
      open={open}
      onLater={later}
      policy={policyQ.data.policy}
      status={my.status}
      graceDays={my.raw?.grace_days}
      isNew={isNewConsultant(my.raw?.signed_up_at, my.raw?.effective_at)}
      onAccept={async v => {
        await my.accept.mutateAsync({ version: v, lang: policyLang(i18n.language), source: 'popup' });
        remember(key);
        setOpen(false);
        toast.success(t('consultantPolicy.thanks', 'Thank you - the policy is confirmed.'));
      }}
    />
  );
}
