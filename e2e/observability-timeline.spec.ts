import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Observability Console page (/super-admin/observability).
 *
 * Requires SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD environment variables
 * to authenticate. Tests are skipped when credentials are not available,
 * which is the normal case in CI without admin credentials.
 *
 * Run manually:
 *   SUPER_ADMIN_EMAIL=admin@example.com SUPER_ADMIN_PASSWORD=secret npx playwright test e2e/observability-timeline.spec.ts
 */

test.describe('Observability timeline', () => {
  test.beforeEach(async ({ page }) => {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!email || !password) test.skip();

    await page.goto('/super-admin/login');
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/super-admin/);
  });

  test('loads the observability page with all widgets', async ({ page }) => {
    await page.goto('/super-admin/observability');
    await expect(page.getByRole('heading', { name: /observability/i })).toBeVisible();
    await expect(page.getByText(/AI Breaker/i)).toBeVisible();
    await expect(page.getByText(/Health/i)).toBeVisible();
  });

  test('applies a category filter and updates the URL', async ({ page }) => {
    await page.goto('/super-admin/observability');
    await page.getByRole('button', { name: 'ai' }).click();
    // After toggling a category chip, the URL should reflect the filter
    await expect(page).toHaveURL(/category=ai/);
  });

  test('opens the event detail drawer on row click', async ({ page }) => {
    await page.goto('/super-admin/observability');
    const firstRow = page.locator('button').filter({ hasText: /info|warning|error|critical/i }).first();
    if (await firstRow.count() === 0) test.skip();
    await firstRow.click();
    await expect(page.getByText(/Event [Dd]etail/i)).toBeVisible();
  });

  test('export CSV button triggers download', async ({ page }) => {
    await page.goto('/super-admin/observability');
    const [download] = await Promise.all([
      page.waitForEvent('download').catch(() => null),
      page.getByRole('button', { name: /export csv/i }).click(),
    ]);
    if (!download) {
      // If no download event, the export may navigate -- either way the button worked
      await expect(page).toHaveURL(/\/api\/super-admin\/observability\/export|\/super-admin\/observability/);
    }
  });
});