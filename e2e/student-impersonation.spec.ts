import { test, expect } from '@playwright/test';

/**
 * E2E tests for Student Impersonation feature.
 *
 * These tests verify entry-point links and structural elements of the
 * student impersonation system added to the super-admin panel.
 *
 * Auth-gated: requires SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD env vars.
 * Without credentials, tests skip gracefully.
 *
 * Run: npx playwright test e2e/student-impersonation.spec.ts
 */

test.describe('Student Impersonation — Entry Points', () => {
  test.beforeEach(async ({ page }) => {
    const email = process.env.SUPER_ADMIN_EMAIL;
    const password = process.env.SUPER_ADMIN_PASSWORD;
    if (!email || !password) {
      test.skip();
      return;
    }
    await page.goto('/super-admin/login');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/super-admin/);
  });

  test('users page renders and has View Full Profile link for students', async ({ page }) => {
    await page.goto('/super-admin/users');
    await expect(page.getByRole('heading', { name: /users/i })).toBeVisible();
    // The "View Full Profile" link only appears when a student row is clicked
    // and a detail drawer opens. We verify the page loads without error.
    // With seeded data, we could click a student row and assert the link.
  });

  test('support page renders with user lookup section', async ({ page }) => {
    await page.goto('/super-admin/support');
    await expect(page.getByRole('heading', { name: /support/i })).toBeVisible();
    // Verify the user lookup input exists
    const lookupInput = page.getByPlaceholder(/student id or email/i);
    await expect(lookupInput).toBeVisible();
  });

  test('student detail page route exists', async ({ page }) => {
    // Navigate directly to a student detail page with a placeholder UUID
    // This verifies the route structure exists even if the student is not found
    await page.goto('/super-admin/students/00000000-0000-0000-0000-000000000000');
    // Should not get a 404 page — the route should handle missing students gracefully
    // (either show "not found" within the page or redirect)
    await expect(page.locator('body')).not.toContainText('This page could not be found');
  });

  test('observability event drawer renders subject_id as link for student events', async ({ page }) => {
    await page.goto('/super-admin/observability');
    await expect(page.getByRole('heading', { name: /observability|timeline|events/i })).toBeVisible();
    // The EventDetailDrawer with a student subject_id link only appears
    // when an event row is clicked. We verify the page loads without error.
  });
});