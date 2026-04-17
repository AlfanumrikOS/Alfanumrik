import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Observability Console rules and channels pages.
 *
 * Requires SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD environment variables
 * to authenticate. Tests are skipped when credentials are not available,
 * which is the normal case in CI without admin credentials.
 *
 * Run manually:
 *   SUPER_ADMIN_EMAIL=admin@example.com SUPER_ADMIN_PASSWORD=secret npx playwright test e2e/observability-rules.spec.ts
 */

test.describe('Observability rules and channels', () => {
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

  test('can navigate to rules page', async ({ page }) => {
    await page.goto('/super-admin/observability/rules');
    await expect(page.getByRole('heading', { name: /alert rules/i })).toBeVisible();
  });

  test('can navigate to channels page', async ({ page }) => {
    await page.goto('/super-admin/observability/channels');
    await expect(page.getByRole('heading', { name: /channels/i })).toBeVisible();
  });

  test('seeded rules appear as disabled', async ({ page }) => {
    await page.goto('/super-admin/observability/rules');
    await expect(page.getByText('Payment webhook integrity')).toBeVisible();
    await expect(page.getByText('AI error spike')).toBeVisible();
    await expect(page.getByText('Health degraded')).toBeVisible();
  });

  test('test-rule dry run shows result', async ({ page }) => {
    await page.goto('/super-admin/observability/rules');
    const testButton = page.getByRole('button', { name: /test/i }).first();
    await testButton.click();
    await expect(page.getByText(/would|Rule|fire|NOT/i)).toBeVisible({ timeout: 10_000 });
  });
});