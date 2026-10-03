// When a new version is published while a tab is still open, the old file names no longer exist on the server:
// opening a page that was not loaded yet then fails with "Failed to fetch dynamically imported module".
// Reload once to pick up the new build (at most once a minute per tab, so a real outage cannot cause a reload loop).

const STORAGE_KEY = 'stale-chunk-reload-at';
const MIN_GAP_MS = 60_000;

const STALE_CHUNK_PATTERN =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function isStaleChunkError(message: string | null | undefined): boolean {
  return STALE_CHUNK_PATTERN.test(message ?? '');
}

/** Reloads the page unless it already did so during the last minute. Returns true when a reload was started. */
export function reloadForNewVersion(reload: () => void = () => window.location.reload()): boolean {
  try {
    const last = Number(sessionStorage.getItem(STORAGE_KEY) ?? 0);
    if (Date.now() - last < MIN_GAP_MS) return false;
    sessionStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    return false;
  }
  reload();
  return true;
}

export function installStaleChunkReload(): void {
  // Vite fires this event when a lazily loaded file cannot be fetched; cancelling it keeps the error from being thrown.
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewVersion()) event.preventDefault();
  });
}
