import { test, expect } from '@playwright/test';
import {
  certificationSuiteEnabled,
  certificationSkipReason,
  loginAsCertificationAccount,
  CERTIFICATION_BASE_URL,
} from './helpers/cert-gate';

/**
 * Certification journey — Role: Parent.
 *
 * PREPARATION ONLY — see e2e/certification/helpers/cert-gate.ts. Do NOT run
 * against any live URL until CERT-17 closes.
 *
 * Steps mirror docs/audit/2026-07-02-certification/reports/04-user-journey-
 * certification-report.md exactly (Role: Parent table) — no invented steps:
 *   Registration/Auth/Authz, Dashboard/Reports, Payments, Logout.
 *
 * Run: CERTIFICATION_RUN_ENABLED=true CERTIFICATION_BASE_URL=<target> \
 *      CERTIFICATION_RUN_ID=<uuid> npx playwright test e2e/certification/parent.spec.ts
 */

test.describe('Certification journey — Parent', () => {
  test.skip(!certificationSuiteEnabled(), certificationSkipReason());
  test.use({ baseURL: CERTIFICATION_BASE_URL || undefined });

  test('Registration / Auth / Authz — seeded parent account logs in and lands on a post-auth route', async ({
    page,
  }) => {
    await loginAsCertificationAccount(page, 'parent');
    await page.waitForURL(/\/(parent|onboarding)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Dashboard / Reports — /parent renders real content', async ({ page }) => {
    // Report 04 evidence: "parent-portal Edge Function ownership checks
    // (guardian_student_links, active/approved status) re-confirmed." This
    // seeded parent account is standalone (not linked to a certification
    // student by default — see scripts/seed-certification-accounts.ts) so
    // this test only asserts the portal shell renders, not that linked-child
    // data is present. A Stage 2 operator wanting to exercise the link flow
    // must additionally seed + approve a guardian_student_links row.
    await loginAsCertificationAccount(page, 'parent');
    await page.waitForURL(/\/(parent|onboarding)/, { timeout: 15_000 });
    if (!page.url().includes('/parent')) {
      await page.goto('/parent');
    }
    await page.waitForLoadState('domcontentloaded');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.trim().length).toBeGreaterThan(0);
    await expect(page.getByText(/application error/i)).toHaveCount(0);
  });

  test('Payments — live checkout run (delegated to payments.spec.ts under the CERT-17 guard)', async () => {
    test.fixme(
      true,
      'Report 04 verdict for this step is NOT VERIFIED (live) — a static trace only, pending ' +
        'Stage 2/3. The live checkout assertion lives in e2e/certification/payments.spec.ts, ' +
        'behind BOTH the base certification gate AND the additional CERT-17 ' +
        '(CERTIFICATION_PAYMENTS_CONFIRMED_SAFE) guard. Kept as a fixme placeholder here so this ' +
        "file's step list stays a complete, honest mirror of report 04.",
    );
  });

  test('Logout — signing out returns the parent to a logged-out route', async ({ page }) => {
    await loginAsCertificationAccount(page, 'parent');
    await page.waitForURL(/\/(parent|onboarding)/, { timeout: 15_000 });
    const logoutButton = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
    await logoutButton.click({ timeout: 10_000 });
    await page.waitForURL(/\/(login|welcome|$)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/parent/);
  });
});
