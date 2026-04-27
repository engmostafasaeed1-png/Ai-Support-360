/**
 * Auth Smoke Tests
 * -----------------
 * Pre-release regression checks for sign-in flows.
 *
 *   bunx playwright test e2e/auth-smoke.spec.ts --reporter=list
 *
 * Covers:
 *   1. Login page renders without runtime errors (catches duplicate-React /
 *      "useEffect on null" regressions).
 *   2. Email + password form is present, validates, and submits.
 *   3. Google OAuth button is present and initiates the OAuth redirect
 *      (we intercept before leaving the app — no real Google login).
 *   4. LinkedIn: not natively supported by Lovable Cloud. We assert the
 *      button is NOT present so accidental re-introduction is caught.
 *
 * Optional env vars (test skips gracefully if absent):
 *   E2E_BASE_URL              default http://localhost:8080
 *   SMOKE_CLIENT_EMAIL / SMOKE_CLIENT_PASSWORD   real client credentials
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
const CLIENT_EMAIL = process.env.SMOKE_CLIENT_EMAIL;
const CLIENT_PASSWORD = process.env.SMOKE_CLIENT_PASSWORD;

test.describe('Auth — sign-in smoke', () => {
  test.beforeEach(async ({ page }) => {
    // Fail fast on any uncaught runtime error (e.g. duplicate React).
    page.on('pageerror', (err) => {
      throw new Error(`Uncaught page error on login: ${err.message}`);
    });
  });

  test('login page renders without runtime errors', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });

    // Login card visible
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();

    // No null-hook / duplicate-React errors
    const fatal = consoleErrors.filter((e) =>
      /Cannot read properties of null|Invalid hook call|duplicate React/i.test(e)
    );
    expect(fatal, fatal.join('\n')).toHaveLength(0);
  });

  test('email/password form rejects invalid credentials', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/email/i).fill('nobody+smoke@example.invalid');
    await page.getByLabel(/password/i).fill('definitely-wrong-password');
    await page.getByRole('button', { name: /log in|sign in/i }).click();

    // Either a toast or inline message — assert any "invalid"/"locked" copy
    await expect(
      page.getByText(/invalid credentials|locked|attempts? remaining/i)
    ).toBeVisible({ timeout: 10_000 });
  });

  test('email/password sign-in succeeds with real credentials', async ({ page }) => {
    test.skip(
      !CLIENT_EMAIL || !CLIENT_PASSWORD,
      'Set SMOKE_CLIENT_EMAIL and SMOKE_CLIENT_PASSWORD to run this test'
    );

    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/email/i).fill(CLIENT_EMAIL!);
    await page.getByLabel(/password/i).fill(CLIENT_PASSWORD!);
    await page.getByRole('button', { name: /log in|sign in/i }).click();

    // Successful sign-in routes away from /login
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 15_000,
    });
    expect(page.url()).not.toContain('/login');
  });

  test('Google OAuth button initiates redirect (if enabled)', async ({ page, context }) => {
    await page.goto(`${BASE_URL}/login`);

    const googleBtn = page.getByRole('button', { name: /google/i });
    const count = await googleBtn.count();
    test.skip(count === 0, 'Google sign-in is not enabled on this build');

    // Block the actual navigation to Google so the test stays sandboxed.
    let oauthInitiated = false;
    await context.route(/accounts\.google\.com|oauth\.lovable\.app|\/~oauth\//, (route) => {
      oauthInitiated = true;
      return route.abort();
    });

    await googleBtn.first().click();

    // Give the redirect a moment to fire
    await page.waitForTimeout(2000);
    expect(
      oauthInitiated,
      'Clicking Google did not trigger an OAuth redirect'
    ).toBeTruthy();
  });

  test('LinkedIn sign-in is NOT exposed (unsupported by Lovable Cloud)', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    const linkedin = page.getByRole('button', { name: /linkedin/i });
    expect(
      await linkedin.count(),
      'LinkedIn button found — Lovable Cloud does not natively support LinkedIn OAuth. Remove it or migrate the provider.'
    ).toBe(0);
  });
});
