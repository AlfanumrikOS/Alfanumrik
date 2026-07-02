import { test, expect } from '@playwright/test';
import {
  certificationSuiteEnabled,
  certificationSkipReason,
  loginAsCertificationAccount,
  CERTIFICATION_BASE_URL,
} from './helpers/cert-gate';

/**
 * Certification journey — Role: School Administrator.
 *
 * PREPARATION ONLY — see e2e/certification/helpers/cert-gate.ts. Do NOT run
 * against any live URL until CERT-17 closes.
 *
 * Steps mirror docs/audit/2026-07-02-certification/reports/04-user-journey-
 * certification-report.md exactly (Role: School Administrator table) — no
 * invented steps: Registration/Auth/Authz, Dashboard/Reports/Analytics,
 * Notifications, Logout.
 *
 * Run: CERTIFICATION_RUN_ENABLED=true CERTIFICATION_BASE_URL=<target> \
 *      CERTIFICATION_RUN_ID=<uuid> npx playwright test e2e/certification/school-admin.spec.ts
 */

test.describe('Certification journey — School Administrator', () => {
  test.skip(!certificationSuiteEnabled(), certificationSkipReason());
  test.use({ baseURL: CERTIFICATION_BASE_URL || undefined });

  test('Registration / Auth / Authz — seeded school_admin account logs in and lands on a post-auth route', async ({
    page,
  }) => {
    await loginAsCertificationAccount(page, 'school_admin');
    await page.waitForURL(/\/(school-admin|onboarding)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Dashboard / Reports / Analytics — /school-admin renders real content', async ({ page }) => {
    await loginAsCertificationAccount(page, 'school_admin');
    await page.waitForURL(/\/(school-admin|onboarding)/, { timeout: 15_000 });
    if (!page.url().includes('/school-admin')) {
      await page.goto('/school-admin');
    }
    await page.waitForLoadState('domcontentloaded');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.trim().length).toBeGreaterThan(0);
    await expect(page.getByText(/application error/i)).toHaveCount(0);
  });

  test('Notifications — /notifications (or the school-admin portal equivalent) renders', async ({ page }) => {
    await loginAsCertificationAccount(page, 'school_admin');
    await page.goto('/notifications');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Logout — signing out returns the school admin to a logged-out route', async ({ page }) => {
    await loginAsCertificationAccount(page, 'school_admin');
    await page.waitForURL(/\/(school-admin|onboarding)/, { timeout: 15_000 });
    const logoutButton = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
    await logoutButton.click({ timeout: 10_000 });
    await page.waitForURL(/\/(login|welcome|$)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/school-admin/);
  });
});
