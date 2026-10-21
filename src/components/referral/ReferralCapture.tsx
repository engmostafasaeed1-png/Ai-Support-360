import { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { referralRpc } from '@/hooks/useReferralProgram';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { captureReferral, clearStoredReferral, deviceId, normalizeReferralCode, storedReferral } from '@/lib/referrals';

/** Keeps ?ref=CODE from /join, /signup and /for-consultants for 30 days and counts one anonymous link visit. */
export function ReferralCapture() {
  const { pathname, search } = useLocation();
  const counted = useRef(new Set<string>());
  useEffect(() => {
    const code = captureReferral(pathname, search);
    if (!code || counted.current.has(code)) return;
    counted.current.add(code);
    void referralRpc('referral_track_click', { _code: code }).catch(() => undefined);
  }, [pathname, search]);
  return null;
}

/** /join?ref=CODE opens the consultant sign-up with the code (campaign parameters kept). */
export function ReferralJoinRedirect() {
  const { search } = useLocation();
  captureReferral('/join', search);
  const kept = new URLSearchParams();
  new URLSearchParams(search).forEach((v, k) => { if (k.startsWith('utm_')) kept.set(k, v); });
  const code = normalizeReferralCode(new URLSearchParams(search).get('ref'));
  if (code) kept.set('ref', code);
  kept.set('role', 'consultant');
  return <Navigate to={`/signup?${kept.toString()}`} replace />;
}

/**
 * Signed-in consultants with a code kept from a link (for example after Google sign-in, which carries no sign-up
 * metadata) claim it once. The database only accepts it within the claim window and before the first paid ticket.
 */
export function ReferralClaimer() {
  const { t } = useTranslation();
  const { isGuest } = useGuestMode();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || isGuest) return;
    done.current = true;
    const code = storedReferral();
    if (!code) return;
    void (async () => {
      const { data, error } = await referralRpc('referral_claim', { _code: code, _device: deviceId() || null });
      if (error) {
        if (!/does not exist|schema cache|PGRST202|too many/i.test(error.message)) clearStoredReferral();
        return;
      }
      const o = (data ?? {}) as { result?: string; name?: string };
      clearStoredReferral();
      if (o.result === 'ok') toast.success(t('refz.claimed', 'Your referral code is linked. You were referred by {{name}}.', { name: o.name ?? '' }));
    })();
  }, [t, isGuest]);
  return null;
}
