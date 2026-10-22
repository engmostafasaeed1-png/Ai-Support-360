import { useCallback, useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import { noticeDisplay, type NoticeFamily } from '@/lib/noticeModalConfig';
import {
  acknowledgeInBackground, flushPendingAcks, isDismissed, markDismissed, markShown, subscribeGuard, wasShown,
} from '@/lib/noticeGuard';

// ---------------------------------------------------------------- one modal at a time across all notice families
let slotOwner: string | null = null;
const slotListeners = new Set<() => void>();
const emitSlot = () => slotListeners.forEach((l) => l());
const subscribeSlot = (l: () => void) => { slotListeners.add(l); return () => { slotListeners.delete(l); }; };

/** True while this family owns the single notice-modal slot (responsiveness, referral and broadcast never stack). */
export function useNoticeModalSlot(name: string, wants: boolean): boolean {
  const owner = useSyncExternalStore(subscribeSlot, () => slotOwner, () => slotOwner);
  useEffect(() => {
    if (wants && slotOwner === null) { slotOwner = name; emitSlot(); }
    else if (!wants && slotOwner === name) { slotOwner = null; emitSlot(); }
  }, [wants, owner, name]);
  useEffect(() => () => { if (slotOwner === name) { slotOwner = null; emitSlot(); } }, [name]);
  return owner === name;
}

/** Re-render when the device guard changes (this tab, other tabs) and when the window gets focus again. */
export function useGuardVersion(): number {
  const [v, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = subscribeGuard(bump);
    const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', onVisible);
    return () => { off(); window.removeEventListener('focus', bump); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  return v;
}

export interface NoticeQueueOptions<T> {
  family: NoticeFamily;
  items: readonly T[];
  idOf: (item: T) => string;
  kindOf: (item: T) => string;
  /** Server acknowledgement (mark read / acknowledged). Runs in the background; failures are retried silently. */
  ack: (ids: string[]) => Promise<void>;
  enabled?: boolean;
}

/**
 * Shared queue for notice pop-ups: only kinds listed in noticeModalConfig open a modal; one at a time with "1 of N";
 * each id at most once per device; closing is optimistic (closes at once, acknowledges in the background) and a closed
 * notice never re-opens, also not after a reload, in another tab or when the window gets focus again.
 */
export function useNoticeQueue<T>({ family, items, idOf, kindOf, ack, enabled = true }: NoticeQueueOptions<T>) {
  const guard = useGuardVersion();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [batch, setBatch] = useState<string[]>([]);

  // Acknowledgements left over from an earlier visit (offline, error): retry now, on focus and when back online.
  useEffect(() => {
    if (!enabled) return;
    const flush = () => flushPendingAcks(family, ack);
    flush();
    window.addEventListener('online', flush);
    window.addEventListener('focus', flush);
    return () => { window.removeEventListener('online', flush); window.removeEventListener('focus', flush); };
    // ack is a stable module function in every caller
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, family]);

  const modal = useMemo(
    () => (enabled ? items.filter((it) => noticeDisplay(family, kindOf(it)) === 'modal' && !isDismissed(family, idOf(it))) : []),
    // guard: re-evaluate the device state when it changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, items, family, guard],
  );
  const waiting = useMemo(() => modal.filter((it) => !wasShown(family, idOf(it))), [modal, family, idOf]);
  const current = currentId ? modal.find((it) => idOf(it) === currentId) ?? null : null;
  const hasSlot = useNoticeModalSlot(family, !!current || waiting.length > 0);

  // The open notice was dismissed elsewhere (other tab) or is no longer unread on the server: close it.
  useEffect(() => { if (currentId && !current) setCurrentId(null); }, [currentId, current]);

  // Next notice: not dismissed, not shown on this device yet, and no other notice modal is open.
  useEffect(() => {
    if (currentId || !hasSlot || waiting.length === 0) return;
    const next = idOf(waiting[0]);
    markShown(family, [next]);
    setBatch((b) => (b.includes(next) ? b : waiting.map(idOf)));
    setCurrentId(next);
  }, [currentId, hasSlot, waiting, family, idOf]);

  const dismiss = useCallback((ids: string[]) => {
    const list = [...new Set(ids)].filter(Boolean);
    if (!list.length) return;
    markDismissed(family, list);   // closed locally at once, also for other tabs
    setCurrentId(null);
    acknowledgeInBackground(family, list, ack);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family]);

  const total = Math.max(1, batch.length);
  const position = current ? Math.max(1, batch.indexOf(idOf(current)) + 1) : 0;
  /** This notice and every later one of the batch that is still open ("Dismiss all"). */
  const remaining = current
    ? [idOf(current), ...batch.slice(position).filter((id) => modal.some((it) => idOf(it) === id))]
    : [];
  return {
    current: hasSlot ? current : null,
    position,
    total,
    dismiss: (item?: T) => { if (item ?? current) dismiss([idOf((item ?? current) as T)]); },
    dismissAll: () => dismiss(remaining),
    remaining: remaining.length,
  };
}
