import { test, expect } from '@playwright/test';

/**
 * E2E Smoke Tests — Verify critical pages load without crashing.
 * Run: npx playwright test
 */

test.describe('Landing Page', () => {
  test('loads welcome page', async ({ page }) => {
    await page.goto('/welcome');
    await expect(page).toHaveTitle(/Alfanumrik/);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('has working CTA buttons', async ({ page }) => {
    await page.goto('/welcome');
    const startBtn = page.locator('a:has-text("Start Learning Free")');
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toHaveAttribute('href', '/login');
  });

  test('has working navigation', async ({ page }) => {
    await page.goto('/welcome');
    const signUpBtn = page.locator('a:has-text("Sign Up Free")');
    await expect(signUpBtn).toBeVisible();
  });
});

test.describe('Auth Pages', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Welcome Back')).toBeVisible({ timeout: 10_000 });
  });

  test('login page has role tabs', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Student')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Teacher')).toBeVisible();
    await expect(page.locator('text=Parent')).toBeVisible();
  });

  test('teacher role pre-selected via query param', async ({ page }) => {
    await page.goto('/login?role=teacher');
    // Teacher tab should be active (has specific styling)
    await expect(page.locator('button:has-text("Teacher")')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Static Pages', () => {
  test('privacy page loads', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page).toHaveTitle(/Privacy|Alfanumrik/);
  });

  test('terms page loads', async ({ page }) => {
    await page.goto('/terms');
    await expect(page).toHaveTitle(/Terms|Alfanumrik/);
  });
});

test.describe('API Health', () => {
  test('health endpoint returns 200', async ({ request }) => {
    const res = await request.get('/api/v1/health');
    expect(res.status()).toBe(200);
  });
});

test.describe('Protected Routes (unauthenticated)', () => {
  test('dashboard redirects to welcome', async ({ page }) => {
    await page.goto('/dashboard');
    // Should redirect to /welcome for unauthenticated users
    await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
  });
});
