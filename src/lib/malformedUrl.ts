/**
 * Repairs a request URL that cannot be decoded (for example `/signup?ref=%%%`): every `%` not followed by two hex
 * digits becomes `%25`. Valid URLs are returned unchanged. Used by the preview server so a garbled link opens the
 * app instead of a blank "URI malformed" page.
 */
export function repairMalformedUrl(url: string): string {
  try {
    decodeURI(url);
    return url;
  } catch {
    const fixed = url.replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
    try {
      decodeURI(fixed);
      return fixed;
    } catch {
      // Still undecodable (e.g. an invalid UTF-8 sequence): keep only the path so the app can load.
      return fixed.split('?')[0].replace(/%[0-9A-Fa-f]{2}/g, (m) => (/%[0-7][0-9A-Fa-f]/.test(m) ? m : '')) || '/';
    }
  }
}
