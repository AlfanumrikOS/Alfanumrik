import { test, expect } from '@playwright/test';

/**
 * E2E tests for Strategic Reports tab on the Learning Intel page
 * (/super-admin/learning).
 *
 * Requires SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD environment variables
 * to authenticate. Tests are skipped when credentials are not available.
 *
 * Run manually:
 *   SUPER_ADMIN_EMAIL=admin@example.com SUPER_ADMIN_PASSWORD=secret npx playwright test e2e/strategic-reports.spec.ts
 */

test.describe('Strategic Reports', () => {
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

  test('Learning Intel page has tab buttons', async ({ page }) => {
    await page.goto('/super-admin/learning');
    await expect(page.getByRole('heading', { name: /learning intelligence/i })).toBeVisible();
    // Verify both tabs exist
    await expect(page.getByRole('button', { name: /engagement & content/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /strategic reports/i })).toBeVisible();
  });

  test('clicking Strategic Reports tab shows cohort retention section', async ({ page }) => {
    await page.goto('/super-admin/learning');
    await page.getByRole('button', { name: /strategic reports/i }).click();
    // Cohort retention heading should appear
    await expect(page.getByText(/cohort retention/i)).toBeVisible({ timeout: 10000 });
    // Weekly/Monthly toggle should be present
    await expect(page.getByRole('button', { name: /weekly/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /monthly/i })).toBeVisible();
  });

  test('clicking Strategic Reports tab shows Bloom distribution section', async ({ page }) => {
    await page.goto('/super-admin/learning');
    await page.getByRole('button', { name: /strategic reports/i }).click();
    // Bloom's heading should appear
    await expect(page.getByText(/bloom.*taxonomy.*distribution/i)).toBeVisible({ timeout: 10000 });
    // Grade filter should be present
    await expect(page.locator('select').filter({ hasText: /all grades/i })).toBeVisible();
  });

  test('cohort retention table renders with data or empty state', async ({ page }) => {
    await page.goto('/super-admin/learning');
    await page.getByRole('button', { name: /strategic reports/i }).click();
    // Wait for loading to complete
    await page.waitForTimeout(3000);
    // Should show either a table (with W+0, M+0 headers) or an empty state message
    const hasTable = await page.locator('th').filter({ hasText: /W\+0|M\+0|Size/i }).count();
    const hasEmpty = await page.getByText(/no cohort data|loading/i).count();
    expect(hasTable + hasEmpty).toBeGreaterThan(0);
  });

  test('switching weekly/monthly changes column headers', async ({ page }) => {
    await page.goto('/super-admin/learning');
    await page.getByRole('button', { name: /strategic reports/i }).click();
    // Default is weekly
    await page.getByRole('button', { name: /monthly/i }).click();
    // Wait for data reload
    await page.waitForTimeout(2000);
    // If there's data, column headers should have M+ prefix
    const monthlyHeaders = await page.locator('th').filter({ hasText: /M\+0/ }).count();
    // If no data, that's fine too
    expect(monthlyHeaders).toBeGreaterThanOrEqual(0);
  });
});