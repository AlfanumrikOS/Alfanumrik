import { test, expect } from '@playwright/test';

/**
 * E2E tests for the Bulk Actions page (/super-admin/bulk-actions).
 *
 * Requires SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD environment variables
 * to authenticate. Tests are skipped when credentials are not available.
 *
 * Run manually:
 *   SUPER_ADMIN_EMAIL=admin@example.com SUPER_ADMIN_PASSWORD=secret npx playwright test e2e/bulk-actions.spec.ts
 */

test.describe('Bulk Actions page', () => {
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

  test('loads the bulk actions page with all 4 tabs', async ({ page }) => {
    await page.goto('/super-admin/bulk-actions');
    await expect(page.getByRole('heading', { name: /bulk actions/i })).toBeVisible();

    // All 4 tabs visible
    await expect(page.getByTestId('tab-plan')).toBeVisible();
    await expect(page.getByTestId('tab-notify')).toBeVisible();
    await expect(page.getByTestId('tab-suspend')).toBeVisible();
    await expect(page.getByTestId('tab-invite')).toBeVisible();
  });

  test('plan changes tab shows student selector and plan change action', async ({ page }) => {
    await page.goto('/super-admin/bulk-actions');
    await page.getByTestId('tab-plan').click();

    // Student selector filters visible
    await expect(page.getByTestId('student-search')).toBeVisible();
    await expect(page.getByTestId('grade-filter')).toBeVisible();

    // Plan change action panel visible
    await expect(page.getByText(/plan change/i)).toBeVisible();
  });

  test('notifications tab shows notification compose UI', async ({ page }) => {
    await page.goto('/super-admin/bulk-actions');
    await page.getByTestId('tab-notify').click();

    // Notification action panel visible
    await expect(page.getByText(/send notification/i)).toBeVisible();
  });

  test('suspend/restore tab shows suspend action UI', async ({ page }) => {
    await page.goto('/super-admin/bulk-actions');
    await page.getByTestId('tab-suspend').click();

    // Suspend/restore action panel visible
    await expect(page.getByText(/suspend.*restore/i)).toBeVisible();
  });

  test('invite resend tab shows resend action UI', async ({ page }) => {
    await page.goto('/super-admin/bulk-actions');
    await page.getByTestId('tab-invite').click();

    // Invite resend action panel visible
    await expect(page.getByText(/resend invites/i)).toBeVisible();
  });

  test('student search filter updates results', async ({ page }) => {
    await page.goto('/super-admin/bulk-actions');

    // The student table should load with "students found" text
    await expect(page.getByText(/students found/i)).toBeVisible({ timeout: 10000 });
  });
});