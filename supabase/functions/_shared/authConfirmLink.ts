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
