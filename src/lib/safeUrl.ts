/** Helpers for opening links that come from data (meeting URLs, signed URLs, gateways). */

/** Parses a value and returns the URL only when it is http(s); otherwise null. */
export function parseHttpUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch {
    return null;
  }
}

/** True for https:// URLs without embedded credentials. */
export function isSafeHttpsUrl(value: string | null | undefined): boolean {
  const u = parseHttpUrl(value);
  return !!u && u.protocol === 'https:' && !u.username && !u.password;
}

/**
 * Opens an http(s) URL in a new tab without giving the opened page access to window.opener.
 * Returns false (and opens nothing) for javascript:, data:, file: and other schemes.
 */
export function openExternal(value: string | null | undefined): boolean {
  const u = parseHttpUrl(value);
  if (!u) return false;
  window.open(u.toString(), '_blank', 'noopener,noreferrer');
  return true;
}

/** Only allows opening a known custom-protocol link (e.g. anydesk:123456789). */
export function openProtocolLink(uri: string | null | undefined, allowedSchemes: string[]): boolean {
  if (!uri) return false;
  const scheme = uri.split(':', 1)[0].toLowerCase();
  if (!allowedSchemes.includes(scheme)) return false;
  window.open(uri, '_self');
  return true;
}

/** Returns the value when it is an http(s) URL, otherwise the fallback. Use for `href={...}` bound to data. */
export function safeHref(value: string | null | undefined, fallback = '#'): string {
  return parseHttpUrl(value) ? (value as string) : fallback;
}

/** True when the URL is http(s) and its hostname is one of the given domains or a subdomain of one. */
export function hostIsOneOf(value: string | null | undefined, domains: string[]): boolean {
  const u = parseHttpUrl(value);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}
