import { useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { referralRpc } from '@/hooks/useReferralProgram';
import { useGuestMode } from '@/contexts/GuestModeContext';
import { fireAndForget, isMissingRpc, safeRpc } from '@/lib/safeRpc';
import { captureReferral, clearStoredReferral, deviceId, referralCodeFromSearch, storedReferral } from '@/lib/referrals';

const CLICKS_KEY = 'aisupport360.ref_clicks';

/** One link-visit count per code per browser session (sessionStorage, with an in-memory fallback). */
const countedThisSession = new Set<string>();
function alreadyCounted(code: string): boolean {
  if (countedThisSession.has(code)) return true;
  try {
    const list = JSON.parse(sessionStorage.getItem(CLICKS_KEY) || '[]');
    return Array.isArray(list) && list.includes(code);
  } catch {
    return false;
  }
}
function markCounted(code: string): void {
  countedThisSession.add(code);
  try {
    const raw = JSON.parse(sessionStorage.getItem(CLICKS_KEY) || '[]');
    const list = Array.isArray(raw) ? raw.filter((c) => typeof c === 'string').slice(-20) : [];
    if (!list.includes(code)) sessionStorage.setItem(CLICKS_KEY, JSON.stringify([...list, code]));
  } catch { /* storage blocked: the in-memory set still prevents repeats on this page load */ }
}

/** Test helper: forget the per-session counts. */
export function resetReferralClickCounts(): void {
  countedThisSession.clear();
  try { sessionStorage.removeItem(CLICKS_KEY); } catch { /* ignore */ }
}

/**
 * Counts one anonymous link visit. Never throws, never blocks rendering and stays silent when the database function
 * is not installed yet or the call fails: the visit count is optional, sign-up never depends on it.
 */
export function trackReferralClick(code: string): void {
  if (!code || alreadyCounted(code)) return;
  markCounted(code);
  const run = () => fireAndForget(() => safeRpc('referral_track_click', { _code: code }));
  try {
    setTimeout(run, 0);
  } catch {
    /* ignore */
  }
}

/** Keeps ?ref=CODE from /join, /signup and /for-consultants for 30 days and counts one anonymous link visit. */
export function ReferralCapture() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    try {
      // Stored in the browser first; the optional visit count runs afterwards.
      const code = captureReferral(pathname, search);
      if (code) trackReferralClick(code);
    } catch {
      /* referral capture is optional */
    }
  }, [pathname, search]);
  return null;
}

/** /join?ref=CODE opens the consultant sign-up with the code (campaign parameters kept). */
export function ReferralJoinRedirect() {
  const { search } = useLocation();
  const kept = new URLSearchParams();
  try {
    captureReferral('/join', search);
    new URLSearchParams(search).forEach((v, k) => { if (k.startsWith('utm_')) kept.set(k, v); });
    const code = referralCodeFromSearch(search);
    if (code) kept.set('ref', code);
  } catch { /* fall through to the plain consultant sign-up */ }
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
      try {
        const { data, error } = await referralRpc('referral_claim', { _code: code, _device: deviceId() || null });
        if (error) {
          if (!isMissingRpc(error) && !/too many/i.test(error.message)) clearStoredReferral();
          return;
        }
        const o = (data ?? {}) as { result?: string; name?: string };
        clearStoredReferral();
        if (o.result === 'ok') toast.success(t('refz.claimed', 'Your referral code is linked. You were referred by {{name}}.', { name: o.name ?? '' }));
      } catch {
        /* the claim is optional */
      }
    })();
  }, [t, isGuest]);
  return null;
}
