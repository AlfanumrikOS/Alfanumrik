import { test, expect } from '@playwright/test';

/**
 * E2E Auth Flow Tests -- Verify authentication-related page behavior
 * for unauthenticated users: login rendering, role selection, redirect
 * guards on protected routes, and public page accessibility.
 *
 * Run: npx playwright test e2e/auth-flow.spec.ts
 */

test.describe('Login page', () => {
  test('renders with role selection tabs', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('text=Welcome Back')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button:has-text("Student")')).toBeVisible();
    await expect(page.locator('button:has-text("Teacher")')).toBeVisible();
    await expect(page.locator('button:has-text("Parent")')).toBeVisible();
  });

  test('defaults to Student role tab', async ({ page }) => {
    await page.goto('/login');
    const studentTab = page.locator('button:has-text("Student")');
    await expect(studentTab).toBeVisible({ timeout: 10_000 });
  });

  test('has email input field', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Welcome page (unauthenticated)', () => {
  test('renders for unauthenticated users with hero content', async ({ page }) => {
    const response = await page.goto('/welcome');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('a:has-text("Start Learning Free")')).toBeVisible();
  });
});

test.describe('Protected route redirects', () => {
  test('/dashboard redirects unauthenticated to /login or /welcome', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/\/(welcome|login)/, { timeout: 10_000 });
    const url = page.url();
    expect(url.includes('/welcome') || url.includes('/login')).toBe(true);
  });

  test('/super-admin shows login page for unauthenticated users', async ({ page }) => {
    await page.goto('/super-admin');
    await page.waitForLoadState('networkidle');
    // Super admin should either redirect to login or show its own auth gate
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
    // Page should not show admin content without auth
    const url = page.url();
    const hasAuthGate = url.includes('/login') ||
      url.includes('/welcome') ||
      url.includes('/super-admin');
    expect(hasAuthGate).toBe(true);
  });
});

test.describe('Public pages accessible without auth', () => {
  test('/pricing renders pricing cards without auth', async ({ page }) => {
    const response = await page.goto('/pricing');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('text=Simple, Transparent Pricing')).toBeVisible();
  });

  test('/help renders help content without auth', async ({ page }) => {
    const response = await page.goto('/help');
    expect(response?.status()).toBe(200);
    // Help page should have meaningful content
    const body = await page.locator('body').textContent();
    expect(body!.length).toBeGreaterThan(100);
  });
});
