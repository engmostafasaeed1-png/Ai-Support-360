import { useCallback, useEffect, useState } from 'react';

export type TileDensity = 'compact' | 'comfortable';

const STORAGE_KEY = 'sidebar:tile-density';
const DEFAULT_DENSITY: TileDensity = 'comfortable';

function readDensity(): TileDensity {
  if (typeof window === 'undefined') return DEFAULT_DENSITY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'compact' || raw === 'comfortable') return raw;
  } catch {
    /* ignore */
  }
  return DEFAULT_DENSITY;
}

/**
 * Per-user preference for sidebar tile density on mobile.
 * - `comfortable` (default): roomier rows, larger label text.
 * - `compact`: tighter rows, smaller label text — more tiles per screen.
 *
 * The setting is persisted in localStorage and synced across tabs.
 */
export function useTileDensity() {
  const [density, _setDensity] = useState<TileDensity>(() => readDensity());

  // Sync across tabs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === 'compact' || e.newValue === 'comfortable') {
        _setDensity(e.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setDensity = useCallback((next: TileDensity) => {
    _setDensity(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleDensity = useCallback(() => {
    setDensity(density === 'compact' ? 'comfortable' : 'compact');
  }, [density, setDensity]);

  return { density, setDensity, toggleDensity };
}
