/**
 * Append a cache-busting `?v=<epoch>` query parameter to an image URL
 * derived from a row's `updated_at` timestamp.
 *
 * Why: Supabase Storage public-bucket URLs are aggressively cached by
 * browsers and CDNs. When an admin replaces a logo, the file path
 * usually stays the same (e.g. `client-logos/<id>.png`), so visitors
 * keep seeing the stale image until the cache expires. Pinning the
 * query string to `updated_at` flips the URL the moment the row is
 * touched, forcing a fresh fetch without invalidating unrelated rows.
 *
 * Returns the original URL unchanged if either argument is missing,
 * and is a no-op for blob: / data: URLs (which don't go through caches).
 */
export function withCacheBust(url: string | null | undefined, updatedAt?: string | null): string | null {
  if (!url) return url ?? null;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  const ts = updatedAt ? Date.parse(updatedAt) : NaN;
  const v = Number.isFinite(ts) ? ts : Date.now();
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${v}`;
}
