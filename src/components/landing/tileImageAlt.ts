/**
 * See `docs/accessibility.md` ("Tile image alt text — decorative vs
 * descriptive") and `CONTRIBUTING.md` for the project-wide rule this
 * helper enforces. Enforced in CI by `src/test/landing-a11y.test.tsx`.
 *
 * Decide the correct `alt` value for an image that lives inside a tile/card.
 *
 * Accessibility rule of thumb:
 *  - If the tile already exposes the same meaning to assistive tech via a
 *    visible heading, label, link text, or `aria-label`, the image is
 *    *decorative* and MUST use `alt=""` so screen readers don't announce it
 *    twice (WCAG 1.1.1 — "Decorative" technique H67).
 *  - If the tile has no accessible text label, the image is the only signal
 *    and needs a *descriptive* alt.
 *
 * This helper centralises that decision so every tile across the landing
 * page handles it the same way — callers just pass what they already know
 * about the tile and we return the right `alt` string.
 *
 * @example
 *   <img alt={tileImageAlt({ tileLabel: feature.title, fallback: feature.title })} … />
 *   //          ↑ tile shows the title visibly → returns "" (decorative)
 *
 *   <img alt={tileImageAlt({ tileLabel: undefined, fallback: 'SAP dashboard' })} … />
 *   //          ↑ no visible label → returns "SAP dashboard" (descriptive)
 */
export type TileImageAltInput = {
  /**
   * The accessible text the *tile* itself provides — typically the visible
   * `<h3>` title, an `aria-label`, or visible link text.
   * Pass `undefined`/empty string if the tile has no accessible label.
   */
  tileLabel?: string | null;

  /**
   * Descriptive fallback alt to use when the tile has no accessible label.
   * Should describe the image's meaning, not its appearance.
   */
  fallback: string;

  /**
   * Optional formatter for the descriptive case. Useful for i18n
   * (e.g. wrapping the fallback in "Illustration: {{title}}").
   * Defaults to returning the fallback verbatim.
   */
  format?: (description: string) => string;

  /**
   * Force a specific behaviour, bypassing auto-detection.
   *  - 'decorative'  → always returns ""
   *  - 'descriptive' → always returns the (formatted) fallback
   *  - 'auto'        → default; decide from `tileLabel`
   */
  mode?: 'auto' | 'decorative' | 'descriptive';
};

/** Returns "" when the image is decorative, or a descriptive string otherwise. */
export function tileImageAlt({
  tileLabel,
  fallback,
  format,
  mode = 'auto',
}: TileImageAltInput): string {
  if (mode === 'decorative') return '';
  if (mode === 'descriptive') {
    return format ? format(fallback) : fallback;
  }
  // auto: a non-empty visible label means the image is redundant for SR users.
  const hasLabel = typeof tileLabel === 'string' && tileLabel.trim().length > 0;
  if (hasLabel) return '';
  return format ? format(fallback) : fallback;
}
