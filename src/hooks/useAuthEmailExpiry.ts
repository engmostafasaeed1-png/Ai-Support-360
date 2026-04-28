import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

const CACHE_KEY = 'auth_email_expiry_minutes';
const CACHE_TS_KEY = 'auth_email_expiry_fetched_at';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_MINUTES = 24 * 60;

let inflight: Promise<number> | null = null;

const readCache = (): number | null => {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    const t = localStorage.getItem(CACHE_TS_KEY);
    if (!v || !t) return null;
    if (Date.now() - parseInt(t, 10) > CACHE_TTL_MS) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
};

const writeCache = (minutes: number) => {
  try {
    localStorage.setItem(CACHE_KEY, String(minutes));
    localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
  } catch { /* ignore */ }
};

const fetchExpiry = async (): Promise<number> => {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('auth-email-expiry');
      if (error || !data) return DEFAULT_MINUTES;
      const minutes = (data as any).expiry_minutes;
      if (typeof minutes === 'number' && minutes > 0) {
        writeCache(minutes);
        return minutes;
      }
      return DEFAULT_MINUTES;
    } catch {
      return DEFAULT_MINUTES;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
};

/**
 * Returns the configured email verification link expiry, in minutes.
 * Uses a localStorage cache (6h TTL) and falls back to 24h.
 */
export function useAuthEmailExpiry(): number {
  const [minutes, setMinutes] = useState<number>(() => readCache() ?? DEFAULT_MINUTES);

  useEffect(() => {
    if (readCache() !== null) return;
    let cancelled = false;
    fetchExpiry().then((m) => { if (!cancelled) setMinutes(m); });
    return () => { cancelled = true; };
  }, []);

  return minutes;
}
