import { useCallback, useEffect, useRef, useState } from 'react';

export const PROFILE_SAVE_DELAY = 4000;
export function changedFields<T extends Record<string, unknown>>(current: T, saved: T): Partial<T> {
  return Object.fromEntries(Object.keys(current).filter(k => JSON.stringify(current[k]) !== JSON.stringify(saved[k])).map(k => [k, current[k]])) as Partial<T>;
}
export type SectionSave = ReturnType<typeof useSectionAutosave>;
/** In-memory draft only: captures a snapshot, serializes writes and acknowledges only that snapshot. */
export function useSectionAutosave<T extends Record<string, unknown>>({ values, ready, automatic = true, validate, persist, beforeManual, resetKey }: {
  values: T; ready: boolean; automatic?: boolean; resetKey?: string; validate?: (patch: Partial<T>) => string | null;
  persist: (patch: Partial<T>) => Promise<void>; beforeManual?: (proceed: () => void) => void;
}) {
  const baseline = useRef<T | null>(null);
  const identity = useRef(resetKey);
  if (identity.current !== resetKey) { identity.current = resetKey; baseline.current = null; }
  const latest = useRef({ values, ready, automatic, validate, persist, beforeManual });
  latest.current = { values, ready, automatic, validate, persist, beforeManual };
  const flight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const mounted = useRef(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNow, setSavedNow] = useState(false);
  const [, render] = useState(0);
  // Initial values cannot become a save payload until a successful load supplied the baseline.
  if (ready && baseline.current === null) baseline.current = structuredCloneSafe(values);
  const patch = baseline.current ? changedFields(values, baseline.current) : {};
  const dirty = Object.keys(patch).length > 0;
  const validationError = dirty ? validate?.(patch) ?? null : null;
  const revision = JSON.stringify(values);
  const save = useCallback(async () => {
    const state = latest.current;
    if (!state.ready || !baseline.current) return;
    if (flight.current) { queued.current = true; await flight.current; return; }
    const sent = changedFields(state.values, baseline.current);
    if (!Object.keys(sent).length) return;
    const invalid = state.validate?.(sent);
    if (invalid) { setError(invalid); return; }
    setSaving(true); setError(null); setSavedNow(false);
    const operation = (async () => {
      try {
        await state.persist(sent);
        baseline.current = { ...baseline.current, ...structuredCloneSafe(sent) } as T;
        if (mounted.current) { setSavedNow(true); render(n => n + 1); }
      } catch (failure) {
        if (mounted.current) setError(failure instanceof Error ? failure.message : (failure as { message?: string })?.message ?? 'Could not save changes. Try again.');
        queued.current = false;
      } finally {
        flight.current = null;
        if (mounted.current) setSaving(false);
      }
    })();
    flight.current = operation;
    await operation;
    if (queued.current) { queued.current = false; await save(); }
  }, []);
  const manualSave = useCallback(() => {
    const proceed = () => { void save(); };
    if (latest.current.beforeManual) latest.current.beforeManual(proceed); else proceed();
  }, [save]);
  useEffect(() => { setError(null); setSavedNow(false); }, [revision]);
  useEffect(() => {
    if (!ready || !automatic || !dirty || validationError || error) return;
    const timer = setTimeout(() => { void save(); }, PROFILE_SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [revision, ready, automatic, dirty, validationError, error, save]);
  useEffect(() => {
    mounted.current = true;
    const unload = (event: BeforeUnloadEvent) => {
      const s = latest.current;
      if (!baseline.current || !Object.keys(changedFields(s.values, baseline.current)).length) return;
      if (s.automatic) void save();
      event.preventDefault(); event.returnValue = '';
    };
    const flush = () => { if (latest.current.automatic) void save(); };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('profile-section-change', flush);
    const visibility = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      flush(); mounted.current = false;
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('profile-section-change', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [save]);
  return { dirty, saving, error: validationError || error, savedNow, automatic, manualSave, flush: save };
}
function structuredCloneSafe<T>(value: T): T {
  // Keep File objects intact; form state updates are immutable, so a shallow snapshot is sufficient.
  return Array.isArray(value) ? [...value] as T : { ...value };
}
