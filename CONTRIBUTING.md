# Contributing

Thanks for working on this project! A few house rules to keep things
consistent.

## Accessibility

We treat accessibility as a build-time concern, not a polish step.
Before opening a PR that touches the landing page or any tile/card UI,
read [`docs/accessibility.md`](./docs/accessibility.md).

The most common gotcha:

- **Tile images must use [`tileImageAlt`](./src/components/landing/tileImageAlt.ts)**
  to decide between decorative (`alt=""`) and descriptive alt text. Do
  not hand-write the `alt` attribute on tile images.
- All landing images must also set `loading="lazy"` (except the LCP
  image) and `decoding="async"`.

These rules are enforced by `src/test/landing-a11y.test.tsx`, which runs
on every PR via the `landing-a11y-gate` workflow.

## Running the a11y gate locally

```bash
bunx vitest run src/test/landing-a11y.test.tsx
```

If it fails, the test output names the offending component and image.

## Other notes

- Use semantic design tokens from `src/index.css` and
  `tailwind.config.ts` — never hard-code colors in components.
- Backend lives in Lovable Cloud (Supabase). Schema changes go through
  migrations; never edit `src/integrations/supabase/{client,types}.ts`.
