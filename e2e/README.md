# E2E — Visual regression tests

These tests guard the **landing navbar** against responsive regressions
(overflow, wordmark truncation, layout shift) at the three most-used
mobile widths: **320px**, **375px**, **414px**.

## Run

```bash
# Start the app first (or set E2E_BASE_URL to a deployed preview URL)
bun run dev

# In another shell:
bunx playwright test e2e/navbar-visual.spec.ts

# Or against a hosted preview:
E2E_BASE_URL=https://smart-sap-connect.lovable.app \
  bunx playwright test e2e/navbar-visual.spec.ts
```

## Update baselines

Run after intentional navbar design changes:

```bash
bunx playwright test e2e/navbar-visual.spec.ts --update-snapshots
```

Commit the regenerated PNGs in `e2e/navbar-visual.spec.ts-snapshots/`.

## What is asserted

For each viewport (320 / 375 / 414):

1. **No horizontal overflow** — `nav.scrollWidth ≤ nav.clientWidth`.
2. **No wordmark truncation** — every visible brand `<span>` fits its box.
3. **Pixel diff vs baseline** — `maxDiffPixelRatio: 0.01` (1% tolerance).

Animations and transitions are disabled during capture for determinism.
