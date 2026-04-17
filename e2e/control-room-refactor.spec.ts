import { test, expect } from '@playwright/test';

test.describe('Control Room (refactored)', () => {
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

  test('control room loads with all sections', async ({ page }) => {
    await page.goto('/super-admin');
    // Verify key sections still render
    await expect(page.getByText(/control room/i).first()).toBeVisible();
    await expect(page.getByText(/quick operations/i)).toBeVisible();
    await expect(page.getByText(/live status/i)).toBeVisible();
    await expect(page.getByText(/pending actions/i)).toBeVisible();
  });

  test('refresh button is visible and clickable', async ({ page }) => {
    await page.goto('/super-admin');
    const refreshBtn = page.getByRole('button', { name: /refresh all/i });
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    // Should not error — page should still show control room
    await expect(page.getByText(/control room/i).first()).toBeVisible();
  });
});