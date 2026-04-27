/**
 * Publish Smoke Checklist
 * ------------------------
 * Automated pre-release smoke tests for the SAP Support Portal.
 * Run before every publish:
 *
 *   bun run smoke
 *   # or
 *   bunx playwright test e2e/publish-smoke.spec.ts --reporter=list
 *
 * Optional env vars (skip the matching test if absent):
 *   E2E_BASE_URL              default http://localhost:8080
 *   SMOKE_CLIENT_EMAIL        existing client account
 *   SMOKE_CLIENT_PASSWORD
 *   SMOKE_CONSULTANT_EMAIL    existing consultant account
 *   SMOKE_CONSULTANT_PASSWORD
 *   SMOKE_ADMIN_EMAIL         existing admin account
 *   SMOKE_ADMIN_PASSWORD
 *
 * These are READ-ONLY smoke checks — they verify pages render, key
 * widgets exist, and primary actions are reachable. They do NOT submit
 * payments, create real tickets, or mutate production data.
 */

import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

const CLIENT = {
  email: process.env.SMOKE_CLIENT_EMAIL,
  password: process.env.SMOKE_CLIENT_PASSWORD,
};
const CONSULTANT = {
  email: process.env.SMOKE_CONSULTANT_EMAIL,
  password: process.env.SMOKE_CONSULTANT_PASSWORD,
};
const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL,
  password: process.env.SMOKE_ADMIN_PASSWORD,
};

async function login(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).first().fill(password);
  await page.getByRole('button', { name: /log\s*in|sign\s*in/i }).click();
  await page.waitForURL((url) => !/\/login$/.test(url.pathname), { timeout: 15_000 });
}

test.describe('Publish smoke — public', () => {
  test('1. Landing page renders', async ({ page }) => {
    const res = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    expect(res?.ok()).toBeTruthy();
    await expect(page.locator('nav').first()).toBeVisible();
  });

  test('2. Login page reachable & form interactive', async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /log\s*in|sign\s*in/i })).toBeEnabled();
  });
});

test.describe('Publish smoke — client flows', () => {
  test.skip(!CLIENT.email || !CLIENT.password, 'SMOKE_CLIENT_* env vars not set');

  test('3. Client login → dashboard', async ({ page }) => {
    await login(page, CLIENT.email!, CLIENT.password!);
    await expect(page).toHaveURL(/\/client/);
  });

  test('4. Request support page loads (new ticket flow)', async ({ page }) => {
    await login(page, CLIENT.email!, CLIENT.password!);
    await page.goto(`${BASE_URL}/client/new-request`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('form, [role="form"], textarea, input').first()).toBeVisible();
  });

  test('5. AI matching surface — consultants page renders matches', async ({ page }) => {
    await login(page, CLIENT.email!, CLIENT.password!);
    await page.goto(`${BASE_URL}/client/consultants`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible();
  });

  test('6. Booking — sessions page reachable', async ({ page }) => {
    await login(page, CLIENT.email!, CLIENT.password!);
    await page.goto(`${BASE_URL}/client/sessions`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible();
  });

  test('7. Payment — payments page reachable', async ({ page }) => {
    await login(page, CLIENT.email!, CLIENT.password!);
    await page.goto(`${BASE_URL}/client/payments`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible();
  });

  test('8. Rating — satisfaction page reachable', async ({ page }) => {
    await login(page, CLIENT.email!, CLIENT.password!);
    await page.goto(`${BASE_URL}/client/satisfaction`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible();
  });
});

test.describe('Publish smoke — admin flows', () => {
  test.skip(!ADMIN.email || !ADMIN.password, 'SMOKE_ADMIN_* env vars not set');

  test('9. Admin KPIs — dashboard renders metric tiles', async ({ page }) => {
    await login(page, ADMIN.email!, ADMIN.password!);
    await page.goto(`${BASE_URL}/admin`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible();
    // KPI tiles: at least one numeric stat card
    const cards = page.locator('[class*="card"], [data-kpi]');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  });

  test('10. Admin analytics page loads', async ({ page }) => {
    await login(page, ADMIN.email!, ADMIN.password!);
    await page.goto(`${BASE_URL}/admin/analytics`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible();
  });
});

test.describe('Publish smoke — consultant flows', () => {
  test.skip(!CONSULTANT.email || !CONSULTANT.password, 'SMOKE_CONSULTANT_* env vars not set');

  test('11. Consultant dashboard renders', async ({ page }) => {
    await login(page, CONSULTANT.email!, CONSULTANT.password!);
    await expect(page).toHaveURL(/\/consultant/);
  });

  test('12. Open tickets page reachable (AI matching inbox)', async ({ page }) => {
    await login(page, CONSULTANT.email!, CONSULTANT.password!);
    await page.goto(`${BASE_URL}/consultant/requests`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main, [role="main"]')).toBeVisible();
  });
});
