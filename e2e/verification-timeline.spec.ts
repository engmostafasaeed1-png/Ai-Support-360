/**
 * Verification Timeline UI Tests
 * -------------------------------
 * Drives the dev harness route (`/dev/verification-timeline`) to validate the
 * <VerificationTimeline /> component in a real browser, including:
 *   - active / "expiring soon" / expired visual states
 *   - ARIA progressbar attributes
 *   - resend CTA cooldown lifecycle
 *
 * The harness route is only registered in non-production builds.
 *
 * Run:  bunx playwright test e2e/verification-timeline.spec.ts --reporter=list
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const HARNESS = `${BASE_URL}/dev/verification-timeline`;

test.describe('VerificationTimeline — UI states', () => {
  test('active window: shows "Link expires", primary progress, no Resend CTA', async ({ page }) => {
    await page.goto(`${HARNESS}?sentMinutesAgo=5&expiresInMinutes=1440`);

    await expect(page.getByText(/email sent/i)).toBeVisible();
    await expect(page.getByText(/link expires/i)).toBeVisible();
    await expect(page.getByText(/link expired/i)).toHaveCount(0);

    const bar = page.getByRole('progressbar');
    await expect(bar).toBeVisible();
    const valueNow = Number(await bar.getAttribute('aria-valuenow'));
    expect(valueNow).toBeGreaterThanOrEqual(0);
    expect(valueNow).toBeLessThan(5); // ~5min of 1440 ≈ 0.3%

    // No Resend button while link is still valid.
    await expect(page.getByRole('button', { name: /resend/i })).toHaveCount(0);
  });

  test('expiring soon: progressbar near full, status reflects time left', async ({ page }) => {
    // 10 minutes left out of 1440 → ~99.3% progress, expiringSoon=true
    await page.goto(`${HARNESS}?sentMinutesAgo=1430&expiresInMinutes=1440`);

    const bar = page.getByRole('progressbar');
    const valueNow = Number(await bar.getAttribute('aria-valuenow'));
    expect(valueNow).toBeGreaterThanOrEqual(98);
    expect(valueNow).toBeLessThan(100);

    const valueText = await bar.getAttribute('aria-valuetext');
    expect(valueText).toMatch(/left/i);
    expect(valueText).not.toMatch(/expired/i);

    // Still not expired → no Resend CTA inside the timeline.
    await expect(page.getByRole('button', { name: /resend verification email/i }))
      .toHaveCount(0);
  });

  test('expired: shows "Link expired" and exposes Resend CTA', async ({ page }) => {
    await page.goto(`${HARNESS}?sentMinutesAgo=1500&expiresInMinutes=1440`);

    await expect(page.getByText(/link expired/i)).toBeVisible();

    const bar = page.getByRole('progressbar');
    await expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(await bar.getAttribute('aria-valuetext')).toMatch(/expired/i);

    const resend = page.getByRole('button', { name: /resend verification email/i });
    await expect(resend).toBeVisible();
    await expect(resend).toBeEnabled();
    await expect(resend).toHaveAttribute('aria-disabled', 'false');
    await expect(resend).toHaveAttribute('aria-busy', 'false');
  });
});

test.describe('VerificationTimeline — Resend cooldown lifecycle', () => {
  test('clicking Resend disables the button and shows a cooldown countdown', async ({ page }) => {
    await page.goto(`${HARNESS}?sentMinutesAgo=1500&expiresInMinutes=1440`);

    const resend = page.getByRole('button', { name: /resend verification email/i });
    await expect(resend).toBeEnabled();
    await resend.click();

    // Harness sets cooldown=60 on click; button should be disabled and relabeled.
    const cooling = page.getByRole('button', { name: /resend available in \d+s/i });
    await expect(cooling).toBeVisible();
    await expect(cooling).toBeDisabled();
    await expect(cooling).toHaveAttribute('aria-disabled', 'true');

    // The cooldown should tick down (label changes within ~3s).
    const initialLabel = await cooling.getAttribute('aria-label');
    await page.waitForTimeout(2500);
    const laterLabel = await cooling.getAttribute('aria-label');
    expect(laterLabel).not.toEqual(initialLabel);
    expect(laterLabel).toMatch(/resend available in \d+s/i);
  });

  test('hydrated cooldown via query param renders disabled with correct label', async ({ page }) => {
    await page.goto(`${HARNESS}?sentMinutesAgo=1500&expiresInMinutes=1440&cooldown=42`);

    const btn = page.getByRole('button', { name: /resend available in 4\ds/i });
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('resending=1 puts the button into busy state', async ({ page }) => {
    await page.goto(
      `${HARNESS}?sentMinutesAgo=1500&expiresInMinutes=1440&resending=1`,
    );

    const btn = page.getByRole('button');
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  test('resetting cooldown re-enables the Resend CTA', async ({ page }) => {
    await page.goto(`${HARNESS}?sentMinutesAgo=1500&expiresInMinutes=1440&cooldown=30`);

    await expect(page.getByRole('button', { name: /resend available in/i })).toBeDisabled();

    await page.getByTestId('reset-cooldown').click();

    const ready = page.getByRole('button', { name: /resend verification email/i });
    await expect(ready).toBeEnabled();
    await expect(ready).toHaveAttribute('aria-disabled', 'false');
  });
});
