import { test, expect } from '@playwright/test';
import {
  certificationSuiteEnabled,
  certificationSkipReason,
  loginAsCertificationAccount,
  CERTIFICATION_BASE_URL,
} from './helpers/cert-gate';

/**
 * Certification journey — Role: Super Administrator.
 *
 * PREPARATION ONLY — see e2e/certification/helpers/cert-gate.ts. Do NOT run
 * against any live URL until CERT-17 closes.
 *
 * Steps mirror docs/audit/2026-07-02-certification/reports/04-user-journey-
 * certification-report.md exactly (Role: Super Administrator table) — no
 * invented steps: Registration/Auth/Authz, Dashboard/Reports/Analytics
 * (PARTIAL — doc staleness, not a page defect), Notifications, Logout.
 *
 * Run: CERTIFICATION_RUN_ENABLED=true CERTIFICATION_BASE_URL=<target> \
 *      CERTIFICATION_RUN_ID=<uuid> npx playwright test e2e/certification/super-admin.spec.ts
 */

test.describe('Certification journey — Super Administrator', () => {
  test.skip(!certificationSuiteEnabled(), certificationSkipReason());
  test.use({ baseURL: CERTIFICATION_BASE_URL || undefined });

  test('Registration / Auth / Authz — seeded super_admin account logs in and lands on a post-auth route', async ({
    page,
  }) => {
    // Report 04 evidence: "branch protection and admin-secret path both
    // confirmed live." This test exercises the normal session-login path;
    // the separate x-admin-secret header path is a server-side API concern
    // covered by unit tests (src/__tests__/admin-control-plane.test.ts), not
    // this browser-driven journey spec.
    await loginAsCertificationAccount(page, 'super_admin');
    await page.waitForURL(/\/(super-admin|onboarding)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Dashboard / Reports / Analytics — /super-admin renders real content (PARTIAL: panel doc is stale, not a page defect)', async ({
    page,
  }) => {
    // Report 04 verdict: PARTIAL — "62 pages confirmed functional;
    // documentation describing the panel (8-tab claim) is materially stale
    // versus the real 62-page/119-route surface." This is an operator-facing
    // documentation risk, not a runtime defect, so this test only asserts
    // the panel itself renders — it does not assert against the stale
    // 8-tab claim.
    await loginAsCertificationAccount(page, 'super_admin');
    await page.waitForURL(/\/(super-admin|onboarding)/, { timeout: 15_000 });
    if (!page.url().includes('/super-admin')) {
      await page.goto('/super-admin');
    }
    await page.waitForLoadState('domcontentloaded');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.trim().length).toBeGreaterThan(0);
    await expect(page.getByText(/application error/i)).toHaveCount(0);
  });

  test('Notifications — /notifications (or the super-admin portal equivalent) renders', async ({ page }) => {
    await loginAsCertificationAccount(page, 'super_admin');
    await page.goto('/notifications');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Logout — signing out returns the super admin to a logged-out route', async ({ page }) => {
    await loginAsCertificationAccount(page, 'super_admin');
    await page.waitForURL(/\/(super-admin|onboarding)/, { timeout: 15_000 });
    const logoutButton = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
    await logoutButton.click({ timeout: 10_000 });
    await page.waitForURL(/\/(login|welcome|$)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/super-admin/);
  });
});
