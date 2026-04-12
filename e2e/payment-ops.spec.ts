import { test, expect } from '@playwright/test';

/**
 * Payment Ops E2E Tests
 *
 * Tests the Payment Ops tab on the super-admin subscriptions page.
 * Requires SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars.
 */

test.describe('Payment Ops', () => {
  test.beforeEach(async ({ page }) => {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!email || !password) test.skip();

    await page.goto('/super-admin/login');
    await page.getByLabel(/email/i).fill(email!);
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/super-admin/, { timeout: 15000 });
  });

  test('subscriptions page has Payment Ops tab', async ({ page }) => {
    await page.goto('/super-admin/subscriptions');
    await expect(page.getByRole('button', { name: /payment ops/i })).toBeVisible();
  });

  test('Payment Ops tab shows health strip', async ({ page }) => {
    await page.goto('/super-admin/subscriptions');
    await page.getByRole('button', { name: /payment ops/i }).click();

    // Health strip stat cards should be visible
    await expect(page.getByText(/stuck payments/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/failed webhooks/i)).toBeVisible();
  });

  test('Payment Ops tab shows stuck payments section', async ({ page }) => {
    await page.goto('/super-admin/subscriptions');
    await page.getByRole('button', { name: /payment ops/i }).click();

    // Stuck payments section should be visible (either table or empty state)
    await expect(page.getByText(/stuck payments/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('Payment Ops tab shows activation timing section', async ({ page }) => {
    await page.goto('/super-admin/subscriptions');
    await page.getByRole('button', { name: /payment ops/i }).click();

    // Activation timing section should render
    await expect(page.getByText(/activation timing/i)).toBeVisible({ timeout: 10000 });
  });

  test('Revenue tab still works after switching', async ({ page }) => {
    await page.goto('/super-admin/subscriptions');

    // Switch to ops tab
    await page.getByRole('button', { name: /payment ops/i }).click();
    await expect(page.getByText(/stuck payments/i).first()).toBeVisible({ timeout: 10000 });

    // Switch back to revenue tab
    await page.getByRole('button', { name: /revenue & entitlements/i }).click();
    await expect(page.getByText(/plan distribution/i)).toBeVisible({ timeout: 10000 });
  });
});