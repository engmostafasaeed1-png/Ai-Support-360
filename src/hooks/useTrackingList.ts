import { useCallback, useMemo, useState } from 'react';
import { useTrackingSettings, useTrackingSummaries } from '@/hooks/useTicketTracking';
import {
  EMPTY_FILTER, addSaved, applyListFilter, countNeedsMe, parseSaved,
  type ListFilter, type SavedFilter,
} from '@/lib/ticketTracking';

const storageKey = (area: string) => `tt-saved-filters:${area}`;

/** Working status chips, filters, "needs my action" and saved filters (this browser) for any ticket list. */
export function useTrackingList<T extends { id: string }>(items: readonly T[], area: 'client' | 'consultant' | 'admin') {
  const ids = useMemo(() => items.map((x) => x.id), [items]);
  const { data: summaries } = useTrackingSummaries(ids);
  const { data: s } = useTrackingSettings();
  const settings = s?.settings;
  const [filter, setFilter] = useState<ListFilter>(EMPTY_FILTER);
  const [saved, setSaved] = useState<SavedFilter[]>(() => {
    try { return parseSaved(localStorage.getItem(storageKey(area))); } catch { return []; }
  });
  const active = !!summaries && summaries.size > 0 && !!settings;
  const apply = useCallback((list: readonly T[]) => (active ? applyListFilter(list, summaries!, filter, settings!) : [...list]), [active, summaries, filter, settings]);
  const needsCount = active ? countNeedsMe(summaries!, settings!) : 0;
  const persist = (next: SavedFilter[]) => {
    setSaved(next);
    try { localStorage.setItem(storageKey(area), JSON.stringify(next)); } catch { /* private mode */ }
  };
  return {
    active, summaries: summaries ?? new Map(), settings, filter, setFilter, apply, needsCount, saved,
    saveCurrent: (name: string) => persist(addSaved(saved, name, filter)),
    removeSaved: (name: string) => persist(saved.filter((x) => x.name !== name)),
  };
}
