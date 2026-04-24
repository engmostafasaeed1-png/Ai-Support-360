import { test, expect, devices } from '@playwright/test';

/**
 * Visual regression + overflow guard for the landing navbar.
 *
 * Captures a snapshot of the navbar at three critical mobile widths and
 * asserts that:
 *   1. The navbar fits its viewport horizontally (no overflow / clipped menu).
 *   2. Wordmark text is not visually truncated (matches its scrollWidth).
 *   3. The pixel layout matches the committed baseline (catches future drift).
 *
 * Baselines live in e2e/navbar-visual.spec.ts-snapshots/.
 * Update with: bunx playwright test e2e/navbar-visual.spec.ts --update-snapshots
 */

const VIEWPORTS = [
  { name: 'iphone-se-320', width: 320, height: 568 },
  { name: 'iphone-x-375', width: 375, height: 812 },
  { name: 'iphone-xr-414', width: 414, height: 896 },
] as const;

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

test.describe('Landing navbar — mobile responsive guards', () => {
  for (const vp of VIEWPORTS) {
    test(`navbar @ ${vp.width}px (${vp.name})`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();

      await page.goto(BASE_URL, { waitUntil: 'networkidle' });

      const nav = page.locator('nav').first();
      await expect(nav).toBeVisible();

      // Disable animations / transitions so screenshots are deterministic
      await page.addStyleTag({
        content: `*, *::before, *::after {
          animation: none !important;
          transition: none !important;
        }`,
      });

      // 1) No horizontal overflow
      const overflow = await nav.evaluate((el) => ({
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
      }));
      expect(
        overflow.scrollWidth,
        `navbar overflows viewport at ${vp.width}px (scroll=${overflow.scrollWidth} > client=${overflow.clientWidth})`,
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);

      // 2) Brand wordmark is not text-truncated (when shown)
      const truncated = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('nav a[href="/"] span'));
        return spans
          .filter((s) => {
            const style = window.getComputedStyle(s as HTMLElement);
            return style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map((s) => {
            const el = s as HTMLElement;
            return {
              text: el.textContent ?? '',
              clientWidth: el.clientWidth,
              scrollWidth: el.scrollWidth,
            };
          });
      });
      for (const t of truncated) {
        expect(
          t.scrollWidth,
          `wordmark "${t.text}" is truncated at ${vp.width}px (scroll=${t.scrollWidth} > client=${t.clientWidth})`,
        ).toBeLessThanOrEqual(t.clientWidth + 1);
      }

      // 3) Visual baseline comparison
      await expect(nav).toHaveScreenshot(`navbar-${vp.name}.png`, {
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });

      await context.close();
    });
  }
});
