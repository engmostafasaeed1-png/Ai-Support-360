import { hasLocation } from '@/lib/consultantLocation';

/** A location chosen on the sign-up page, kept until the first consultant sign-in saves it (also for Google sign-up). */
const KEY = 'signup_location';
const TTL_MS = 24 * 60 * 60 * 1000;

export function storeSignupLocation(country: string, city: string): void {
  try { localStorage.setItem(KEY, JSON.stringify({ country: country.trim(), city: city.trim(), at: Date.now() })); } catch { /* storage unavailable */ }
}

export function clearSignupLocation(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The pending location from sign-up metadata first, else from this browser (24 hours), else null. */
export function pendingSignupLocation(metadata: Record<string, unknown> | null | undefined, now = Date.now()): { country: string; city: string } | null {
  const meta = { country: typeof metadata?.country === 'string' ? metadata.country : '', city: typeof metadata?.city === 'string' ? metadata.city : '' };
  if (hasLocation(meta)) return { country: meta.country.trim(), city: meta.city.trim() };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { country?: string; city?: string; at?: number };
    if (!v.at || now - v.at > TTL_MS || !hasLocation(v)) { clearSignupLocation(); return null; }
    return { country: String(v.country).trim(), city: String(v.city).trim() };
  } catch { return null; }
}
