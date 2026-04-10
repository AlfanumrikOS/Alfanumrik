import { test, expect } from '@playwright/test';

/**
 * E2E Public Pages Tests -- Verify all public pages render with
 * meaningful content and return HTTP 200 without authentication.
 *
 * Also verifies:
 * - Pages are not stuck on "Loading..." state
 * - Pages contain expected domain-specific content
 * - Protected routes redirect unauthenticated users to /login
 * - Admin routes redirect to /super-admin/login
 *
 * Run: npx playwright test e2e/public-pages.spec.ts
 */

const PUBLIC_PAGES = [
  { path: '/welcome', label: 'Welcome / Landing', mustContain: ['Alfanumrik', 'CBSE'] },
  { path: '/login', label: 'Login', mustContain: ['Welcome Back', 'Student'] },
  { path: '/about', label: 'About', mustContain: ['About', 'Alfanumrik'] },
  { path: '/contact', label: 'Contact', mustContain: ['Contact'] },
  { path: '/pricing', label: 'Pricing', mustContain: ['Plan', 'Pricing'] },
  { path: '/privacy', label: 'Privacy Policy', mustContain: ['Privacy'] },
  { path: '/terms', label: 'Terms of Service', mustContain: ['Terms'] },
  { path: '/security', label: 'Security', mustContain: ['Security'] },
  { path: '/for-parents', label: 'For Parents', mustContain: ['Parent'] },
  { path: '/for-teachers', label: 'For Teachers', mustContain: ['Teacher'] },
  { path: '/for-schools', label: 'For Schools', mustContain: ['School'] },
  { path: '/product', label: 'Product', mustContain: ['Product'] },
  { path: '/research', label: 'Research', mustContain: ['Research'] },
];

test.describe('Public pages render correctly', () => {
  for (const { path, label } of PUBLIC_PAGES) {
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

test.describe('Public pages render meaningful content (not just Loading...)', () => {
  for (const { path, label, mustContain } of PUBLIC_PAGES) {
    test(`${label} (${path}) is not stuck on loading state`, async ({ page }) => {
      await page.goto(path);

      // Wait for content to load (not just the initial shell)
      await page.waitForLoadState('domcontentloaded');

      const bodyText = await page.locator('body').textContent();
      expect(bodyText).toBeTruthy();
      expect(bodyText!.length).toBeGreaterThan(50);

      // Should not be stuck on loading
      const trimmed = bodyText!.trim();
      expect(trimmed).not.toBe('Loading...');
      expect(trimmed).not.toBe('Loading');

      // Should contain at least one expected content keyword
      const hasExpected = mustContain.some(text =>
        bodyText!.toLowerCase().includes(text.toLowerCase())
      );
      expect(hasExpected).toBe(true);
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

/* ================================================================
 * Protected Routes Redirect (unauthenticated users)
 * Regression: redirect_unauthenticated -- all protected pages redirect to /login
 * ================================================================ */
test.describe('Protected routes redirect unauthenticated users to login', () => {
  const PROTECTED_ROUTES = [
    '/dashboard',
    '/quiz',
    '/profile',
    '/progress',
    '/foxy',
    '/billing',
    '/notifications',
    '/leaderboard',
    '/reports',
  ];

  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects to login or welcome`, async ({ page }) => {
      await page.goto(route);
      // Middleware redirects unauthenticated users to /welcome or /login
      await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
    });
  }
});

/* ================================================================
 * Admin Routes Protected
 * Regression: admin_secret_required
 * ================================================================ */
test.describe('Admin routes are protected', () => {
  test('/super-admin redirects to super-admin login', async ({ page }) => {
    await page.goto('/super-admin');
    // Should redirect to the super-admin login page, not the main app login
    await page.waitForURL(/\/super-admin\/login/, { timeout: 10_000 });
  });
});
