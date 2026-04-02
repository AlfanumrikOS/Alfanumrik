import { test, expect } from '@playwright/test';

/**
 * E2E Public Pages Tests -- Verify all public pages render with
 * meaningful content and return HTTP 200 without authentication.
 *
 * Run: npx playwright test e2e/public-pages.spec.ts
 */

const publicPages = [
  { path: '/welcome', label: 'Welcome / Landing' },
  { path: '/about', label: 'About' },
  { path: '/contact', label: 'Contact' },
  { path: '/pricing', label: 'Pricing' },
  { path: '/privacy', label: 'Privacy Policy' },
  { path: '/terms', label: 'Terms of Service' },
  { path: '/security', label: 'Security' },
  { path: '/for-parents', label: 'For Parents' },
  { path: '/for-teachers', label: 'For Teachers' },
  { path: '/for-schools', label: 'For Schools' },
  { path: '/product', label: 'Product' },
  { path: '/research', label: 'Research' },
];

test.describe('Public pages render correctly', () => {
  for (const { path, label } of publicPages) {
    test(`${label} (${path}) returns 200 and has content`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);

      // Page should not be empty -- must have meaningful body text
      const body = await page.locator('body').textContent();
      expect(body!.trim().length).toBeGreaterThan(50);

      // Page should have at least one heading or main content area
      const hasHeading = await page.locator('h1, h2, main').first().isVisible().catch(() => false);
      expect(hasHeading).toBe(true);
    });
  }
});

test.describe('Public pages have proper metadata', () => {
  test('/welcome has Alfanumrik in title', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page).toHaveTitle(/Alfanumrik/);
  });

  test('/pricing has Pricing in title', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page).toHaveTitle(/Pricing/);
  });

  test('/for-schools has For Schools in title', async ({ page }) => {
    await page.goto('/for-schools');
    await expect(page).toHaveTitle(/For Schools/);
  });

  test('/for-parents has For Parents in title', async ({ page }) => {
    await page.goto('/for-parents');
    await expect(page).toHaveTitle(/For Parents/);
  });

  test('/for-teachers has For Teachers in title', async ({ page }) => {
    await page.goto('/for-teachers');
    await expect(page).toHaveTitle(/For Teachers/);
  });
});

test.describe('Public pages have navigation', () => {
  test('public pages include footer with legal links', async ({ page }) => {
    await page.goto('/welcome');
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.locator('a[href="/privacy"]')).toBeVisible();
    await expect(footer.locator('a[href="/terms"]')).toBeVisible();
  });
});
