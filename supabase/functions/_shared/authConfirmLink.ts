// Builds the link put into the sign-up confirmation e-mail.
// The sign-in service's own link confirms on the first GET, so e-mail security scanners that open links
// use it up before the person clicks. Our /auth/confirm page only confirms when the person presses a button.
// Anything unexpected falls back to the original link, so confirmation never breaks.

const TOKEN_RE = /^[A-Za-z0-9_-]{6,200}$/;
const TYPES = new Set(['signup', 'invite', 'magiclink', 'email_change', 'email']);

export function confirmPageUrl(verifyUrl: string, siteUrl: string, email?: string | null): string {
  try {
    const u = new URL(verifyUrl);
    const token = u.searchParams.get('token') || u.searchParams.get('token_hash');
    const type = u.searchParams.get('type');
    if (!token || !TOKEN_RE.test(token) || !type || !TYPES.has(type)) return verifyUrl;
    const out = new URL('/auth/confirm', siteUrl);
    out.searchParams.set('token_hash', token);
    out.searchParams.set('type', type);
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254) out.searchParams.set('email', email);
    return out.toString();
  } catch {
    return verifyUrl;
  }
}

/** The 6-digit (up to 8) code from the sign-in service, or null when absent. */
export function confirmCode(token: string | null | undefined): string | null {
  return token && /^\d{6,8}$/.test(token) ? token : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Safety net (bug H4): only link to /auth/confirm when the published site actually has that page.
// The page ships a small marker file with the front end; when it is missing (front end not published yet,
// or the page removed) the e-mail keeps the sign-in service's original link, which always works.
// The answer is cached so the check costs at most one short request per few minutes.

export const CONFIRM_PAGE_MARKER = '/auth-confirm-ready.json';
const READY_TTL_MS = 10 * 60_000;
const NOT_READY_TTL_MS = 60_000;
const TIMEOUT_MS = 2_000;

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; text(): Promise<string> }>;

/** True only for the exact marker body, so a site that answers every address with its home page does not count. */
export function isConfirmMarker(body: string): boolean {
  try {
    const j = JSON.parse(body);
    return !!j && j.route === '/auth/confirm' && j.ready === true;
  } catch {
    return false;
  }
}

export function createConfirmPageProbe(siteUrl: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, now: () => number = Date.now) {
  let cached: { ready: boolean; until: number } | null = null;
  return async function confirmPageReady(): Promise<boolean> {
    if (cached && now() < cached.until) return cached.ready;
    let ready = false;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetchImpl(new URL(CONFIRM_PAGE_MARKER, siteUrl).toString(), { signal: ctrl.signal, headers: { accept: 'application/json' } });
        ready = res.ok && isConfirmMarker(await res.text());
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

/** The link for the confirmation e-mail: our one-click page when it is live, otherwise the original link. */
export function confirmationLink(verifyUrl: string, siteUrl: string, email: string | null | undefined, pageReady: boolean): string {
  return pageReady ? confirmPageUrl(verifyUrl, siteUrl, email) : verifyUrl;
}
