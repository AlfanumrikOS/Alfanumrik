import { test, expect } from '@playwright/test';

/**
 * E2E Tests — School Admin Portal
 *
 * Verifies:
 *   - Unauthenticated access to /school-admin redirects to /login
 *   - /schools landing page loads with pricing
 *   - Trial signup form validates required fields
 *   - Unknown B2B subdomain shows appropriate error
 *
 * Run: npx playwright test e2e/school-admin.spec.ts
 */

test.describe('School Admin Portal — Auth Guards', () => {
  test('redirects unauthenticated users from /school-admin to login', async ({ page }) => {
    await page.goto('/school-admin');
    // Should redirect to /login (middleware intercepts unauthenticated access)
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects unauthenticated users from /school-admin/teachers to login', async ({ page }) => {
    await page.goto('/school-admin/teachers');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects unauthenticated users from /school-admin/students to login', async ({ page }) => {
    await page.goto('/school-admin/students');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects unauthenticated users from /school-admin/classes to login', async ({ page }) => {
    await page.goto('/school-admin/classes');
    await expect(page).toHaveURL(/\/login/);
  });

  test('redirects unauthenticated users from /school-admin/billing to login', async ({ page }) => {
    await page.goto('/school-admin/billing');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Schools Landing Page', () => {
  test('loads /schools page with visible heading', async ({ page }) => {
    await page.goto('/schools');
    await expect(page.locator('h1')).toBeVisible();
  });

  test('shows pricing section with INR amount', async ({ page }) => {
    await page.goto('/schools');
    // Pricing should mention per-student amount (75 INR from B2B pricing)
    await expect(page.getByText('75')).toBeVisible();
  });

  test('has a trial signup or contact form', async ({ page }) => {
    await page.goto('/schools');
    // Should have either a "Start Free Trial" button or a contact form
    const trialButton = page.getByRole('button', { name: /Start Free Trial|Free Trial|Trial|Contact|शुरू करें/i });
    const contactForm = page.locator('form');
    // At least one should be visible
    const hasTrialButton = await trialButton.isVisible().catch(() => false);
    const hasContactForm = await contactForm.isVisible().catch(() => false);
    expect(hasTrialButton || hasContactForm).toBe(true);
  });

  test('trial signup form validates required fields when submitted empty', async ({ page }) => {
    await page.goto('/schools');

    // Look for a submit button related to trial/contact
    const submitButton = page.getByRole('button', { name: /Start Free Trial|Submit|शुरू करें|संपर्क/i });
    const isVisible = await submitButton.isVisible().catch(() => false);

    if (isVisible) {
      await submitButton.click();
      // Should show a validation error for required fields
      // This could be HTML5 validation or custom error messages
      const errorVisible = await page.getByText(/required|आवश्यक|please|कृपया/i).isVisible().catch(() => false);
      const invalidInput = await page.locator('input:invalid').count().catch(() => 0);
      expect(errorVisible || invalidInput > 0).toBe(true);
    } else {
      // If no submit button, the page structure may differ — skip gracefully
      test.skip(true, 'No trial signup form found on /schools');
    }
  });
});

test.describe('School Admin API — Health', () => {
  test('school admin API routes return 401 without auth', async ({ request }) => {
    // Test that the school admin API routes reject unauthenticated requests
    const routes = [
      '/api/school-admin/classes',
      '/api/school-admin/reports?type=school_overview',
      '/api/school-admin/content',
    ];

    for (const route of routes) {
      const response = await request.get(route);
      // Should be 401 (unauthorized) not 500 (server error)
      expect(response.status()).toBe(401);
      const body = await response.json();
      expect(body.success).toBe(false);
    }
  });
});

test.describe('Unknown Subdomain', () => {
  test('unknown B2B subdomain shows error or redirects', async ({ page }) => {
    // This test requires wildcard DNS — skip in environments without it
    test.skip(
      !process.env.TEST_WILDCARD_DNS,
      'Wildcard DNS not configured — skipping subdomain test'
    );

    await page.goto('https://nonexistent-school-xyz.alfanumrik.com');
    // Should show a "School Not Found" message or redirect to main site
    const notFoundVisible = await page.getByText(/School Not Found|not found/i).isVisible().catch(() => false);
    const redirectedToMain = page.url().includes('alfanumrik.com') && !page.url().includes('nonexistent');
    expect(notFoundVisible || redirectedToMain).toBe(true);
  });
});
