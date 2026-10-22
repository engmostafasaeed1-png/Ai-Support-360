/** Shared, side-effect-light helpers for page scrolling (back to top, reading progress, restoration, chat anchoring). */

export const BACK_TO_TOP_THRESHOLD = 600;

export function prefersReducedMotion(win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  try {
    return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Smooth only when the visitor has not asked for less motion. */
export function scrollBehavior(win?: Window): ScrollBehavior {
  return prefersReducedMotion(win) ? 'auto' : 'smooth';
}

export function shouldShowBackToTop(scrollY: number, threshold = BACK_TO_TOP_THRESHOLD): boolean {
  return scrollY > threshold;
}

/** 0..1 share of the page that has been scrolled past. */
export function readingProgress(scrollY: number, scrollHeight: number, viewportHeight: number): number {
  const max = scrollHeight - viewportHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / max));
}

/** Long enough to be worth a reading-progress bar (more than ~1.5 screens). */
export function isLongPage(scrollHeight: number, viewportHeight: number): boolean {
  return viewportHeight > 0 && scrollHeight > viewportHeight * 1.5;
}

/** Within `slack` px of the bottom of a scroll container. */
export function isNearBottom(el: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>, slack = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}

const STORE_KEY = 'scroll-positions';
const MAX_ENTRIES = 50;

type Store = Record<string, number>;

function readStore(storage: Storage | undefined): Store {
  try {
    const raw = storage?.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function defaultStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Remember where a history entry was scrolled to (kept per tab, newest 50 entries). */
export function saveScrollPosition(key: string, y: number, storage: Storage | undefined = defaultStorage()): void {
  if (!key) return;
  const store = readStore(storage);
  delete store[key];
  store[key] = Math.max(0, Math.round(y));
  const keys = Object.keys(store);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete store[k];
  try {
    storage?.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked: restoration is a nicety */
  }
}

export function readScrollPosition(key: string, storage: Storage | undefined = defaultStorage()): number | null {
  const v = readStore(storage)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** What to do with the window scroll after a navigation. */
export function scrollActionFor(opts: {
  navType: 'POP' | 'PUSH' | 'REPLACE';
  pathChanged: boolean;
  hash: string;
  saved: number | null;
}): { kind: 'hash' } | { kind: 'restore'; y: number } | { kind: 'top' } | { kind: 'keep' } {
  if (opts.hash) return { kind: 'hash' };
  if (opts.navType === 'POP') return opts.saved != null ? { kind: 'restore', y: opts.saved } : opts.pathChanged ? { kind: 'top' } : { kind: 'keep' };
  // Same page, only the query changed (tabs, filters): keep the reader where they are.
  return opts.pathChanged ? { kind: 'top' } : { kind: 'keep' };
}

/** Scroll the window so `el` sits `offset` px below the top (sticky header / in-page navigation), respecting reduced motion. */
export function scrollToElement(el: HTMLElement, offset = 0, win: Window = window): void {
  const top = el.getBoundingClientRect().top + (win.scrollY || 0) - offset;
  try { win.scrollTo({ top: Math.max(0, top), behavior: scrollBehavior(win) }); } catch { /* old browsers / tests */ }
}
