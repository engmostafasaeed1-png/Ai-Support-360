import React from 'react';

// A lazy page whose file failed to load (network drop, or an old file name after a new Publish) is retried,
// then the page is reloaded once per chunk per minute; after that a readable error reaches the ErrorBoundary.

export const LAZY_RETRY_DELAYS_MS = [300, 900];
export const LAZY_RELOAD_GAP_MS = 60_000;
export const LAZY_LOAD_FAILED_MESSAGE = 'Could not load the page. Please check your connection and try again.';

type Module<T> = { default: T };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function attempt<T>(factory: () => Promise<Module<T>>): Promise<Module<T>> {
  const mod = await factory();
  if (!mod || (mod as Module<T>).default === undefined) throw new Error('Lazy module has no default export');
  return mod;
}

/** Runs the import with retries; on final failure reloads once per 60 s for this chunk, otherwise throws the friendly error. */
export async function loadWithRetry<T>(
  factory: () => Promise<Module<T>>,
  name = 'page',
  reload: () => void = () => window.location.reload(),
): Promise<Module<T>> {
  for (let i = 0; ; i++) {
    try {
      return await attempt(factory);
    } catch {
      if (i >= LAZY_RETRY_DELAYS_MS.length) break;
      await wait(LAZY_RETRY_DELAYS_MS[i]);
    }
  }
  const key = `chunk-reload-${name}`;
  let mayReload = false;
  try {
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last >= LAZY_RELOAD_GAP_MS) {
      sessionStorage.setItem(key, String(Date.now()));
      mayReload = true;
    }
  } catch {
    mayReload = false;
  }
  if (mayReload) {
    reload();
    // Keep Suspense waiting while the page reloads.
    return new Promise<Module<T>>(() => {});
  }
  throw new Error(LAZY_LOAD_FAILED_MESSAGE);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends React.ComponentType<any>>(factory: () => Promise<Module<T>>, name?: string) {
  return React.lazy(() => loadWithRetry(factory, name));
}
