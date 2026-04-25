# Accessibility notes

This project enforces a small set of accessibility rules in code and CI.
The most-touched one — **tile image alt text** — is documented here so
contributors don't have to rediscover it every time they add a new card.

## Tile image alt text — decorative vs descriptive

Many landing-page sections render images *inside* tiles/cards that
already have a visible heading or label (e.g. `WhyQurtuba`,
`ValueDifferentiation`). The rule for the image's `alt` attribute is:

| Tile already has an accessible text label? | `alt` should be… | Why |
|---|---|---|
| **Yes** (visible `<h3>`, link text, `aria-label`, etc.) | `alt=""` (decorative) | The screen reader already announces the title. A second announcement of the image would be redundant noise. See WCAG 1.1.1, technique [H67](https://www.w3.org/WAI/WCAG21/Techniques/html/H67). |
| **No** (image is the only signal) | A short descriptive string | The image carries meaning the user can't get any other way. Describe what it conveys, not what it looks like. |

### Always use the helper

Do **not** hand-write `alt=""` or `alt="something"` on tile images.
Use [`tileImageAlt`](../src/components/landing/tileImageAlt.ts), which
encodes the rule in one place and is unit-tested:

```tsx
import { tileImageAlt } from '@/components/landing/tileImageAlt';

<img
  src={feature.image}
  alt={tileImageAlt({
    tileLabel: feature.title,   // visible heading on the tile
    fallback: feature.title,    // used only if tileLabel is empty
  })}
  loading="lazy"
  decoding="async"
/>
```

Pass:
- `tileLabel` — the text the tile *already* exposes (the `<h3>`, the
  `aria-label`, link text…). Leave `undefined`/empty if there is none.
- `fallback` — the descriptive alt to use when there is no label.
- `format` *(optional)* — i18n wrapper, e.g.
  `(d) => t('a11y.illustration', { title: d })`.
- `mode` *(optional)* — force `'decorative'` or `'descriptive'` to
  bypass auto-detection (rare; prefer `'auto'`).

### Why a helper instead of a convention

Three reasons:

1. **One place to change.** If WCAG guidance evolves, or we want to
   support `role="img"` patterns differently, only `tileImageAlt.ts`
   changes.
2. **Auditable.** The helper makes the decision explicit at the call
   site instead of relying on every contributor remembering the rule.
3. **CI-enforceable.** Our [a11y gate](../.github/workflows/landing-a11y-gate.yml)
   runs `axe-core` over the landing sections and fails the build if any
   image is missing an `alt`, `loading="lazy"`, or `decoding="async"`.

## Other landing-image rules (enforced in CI)

Every `<img>` rendered inside the landing components must have:

- `alt` — set via `tileImageAlt(...)` for tile images, or a hand-written
  descriptive string for standalone images (e.g. portraits, logos).
- `loading="lazy"` — except the LCP/hero image, which should load
  eagerly.
- `decoding="async"` — always.

The check lives in [`src/test/landing-a11y.test.tsx`](../src/test/landing-a11y.test.tsx)
and is wired up via the `landing-a11y-gate` GitHub Actions workflow.
