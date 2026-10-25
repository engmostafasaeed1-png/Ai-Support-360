// Safety net for e-mail links to a new front-end page: link to the page only while the published site serves the
// page's marker file ({"route": "<route>", "ready": true} in public/), otherwise use a fallback page that always
// exists. Cached so the check costs at most one short request every few minutes. Same pattern as authConfirmLink.

const READY_TTL_MS = 10 * 60_000;
const NOT_READY_TTL_MS = 60_000;
const TIMEOUT_MS = 2_000;

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; text(): Promise<string> }>;

/** True only for the exact marker body, so a site that answers every address with its home page does not count. */
export function isPageMarker(body: string, route: string): boolean {
  try {
    const j = JSON.parse(body);
    return !!j && j.route === route && j.ready === true;
  } catch {
    return false;
  }
}

export function createPageProbe(siteUrl: string, marker: string, route: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, now: () => number = Date.now) {
  let cached: { ready: boolean; until: number } | null = null;
  return async function pageReady(): Promise<boolean> {
    if (cached && now() < cached.until) return cached.ready;
    let ready = false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetchImpl(new URL(marker, siteUrl).toString(), { signal: ctrl.signal, headers: { accept: 'application/json' } });
        ready = res.ok && isPageMarker(await res.text(), route);
      } finally {
        clearTimeout(timer);
      }
    } catch {
      ready = false;
    }
    cached = { ready, until: now() + (ready ? READY_TTL_MS : NOT_READY_TTL_MS) };
    return ready;
  };
}
