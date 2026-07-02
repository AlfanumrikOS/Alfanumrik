import { test, expect } from '@playwright/test';
import {
  certificationSuiteEnabled,
  certificationSkipReason,
  loginAsCertificationAccount,
  loginAsSuperAdminConsole,
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

  test('Registration / Auth / Authz — seeded super_admin account logs in via the console and lands on /super-admin', async ({
    page,
  }) => {
    // The super-admin panel has its OWN login at /super-admin/login (POSTs to
    // /api/super-admin/login → rate-limit/lockout → Supabase Auth →
    // admin_users membership check → redirect to /super-admin). The shared
    // /login form CANNOT route a super_admin to the panel: getRoleDestination
    // has no super_admin mapping (defaults to the student destination) and
    // AuthContext never resolves an admin_users-only identity into a portal
    // role. So the certification super-admin journey authenticates through the
    // real console path. The seeded super_admin is an is_active admin_users row
    // with admin_level='super_admin', which /api/super-admin/login accepts.
    await loginAsSuperAdminConsole(page);
    // On success the console redirects to exactly /super-admin (not
    // /super-admin/login, which is where an auth failure would leave us).
    await page.waitForURL(/\/super-admin$/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/super-admin\/login/);
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
    await loginAsSuperAdminConsole(page);
    await page.waitForURL(/\/super-admin$/, { timeout: 15_000 });
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

  test('Logout — signing out returns the super admin to the logged-out console login', async ({ page }) => {
    await loginAsSuperAdminConsole(page);
    await page.waitForURL(/\/super-admin$/, { timeout: 15_000 });
    const logoutButton = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
    await logoutButton.click({ timeout: 10_000 });
    // The AdminShell logout calls supabase.auth.signOut() then sends the
    // operator to /super-admin/login — the console's own logged-out login
    // page. That IS the correct logged-out destination for this role (it is
    // NOT the panel), so we assert we landed on the console login rather than
    // the over-broad "not under /super-admin" which the real flow never
    // satisfies.
    await page.waitForURL(/\/super-admin\/login$/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/super-admin\/login$/);
  });
});
