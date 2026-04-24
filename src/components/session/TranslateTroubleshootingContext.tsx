import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

interface TranslateTroubleshootingContextValue {
  /** When true, troubleshooting copy is rendered through i18n (default). */
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'troubleshoot:translate-enabled';

const TranslateTroubleshootingContext = createContext<TranslateTroubleshootingContextValue>({
  enabled: true,
  setEnabled: () => {},
  toggle: () => {},
});

/**
 * Provides a single source of truth for whether troubleshooting copy
 * (framed/fallback panels, link button, validation notice) should be
 * rendered translated or in the original English source. Persisted to
 * sessionStorage so the choice survives navigation within the session.
 */
export function TranslateTroubleshootingProvider({
  children,
  defaultEnabled = true,
}: {
  children: React.ReactNode;
  defaultEnabled?: boolean;
}) {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return defaultEnabled;
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === '0') return false;
    if (raw === '1') return true;
    return defaultEnabled;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      /* ignore quota / privacy errors */
    }
  }, [enabled]);

  const setEnabled = useCallback((next: boolean) => setEnabledState(next), []);
  const toggle = useCallback(() => setEnabledState((v) => !v), []);

  const value = useMemo(
    () => ({ enabled, setEnabled, toggle }),
    [enabled, setEnabled, toggle],
  );

  return (
    <TranslateTroubleshootingContext.Provider value={value}>
      {children}
    </TranslateTroubleshootingContext.Provider>
  );
}

export function useTranslateTroubleshooting() {
  return useContext(TranslateTroubleshootingContext);
}
