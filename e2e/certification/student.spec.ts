import { test, expect } from '@playwright/test';
import {
  certificationSuiteEnabled,
  certificationSkipReason,
  loginAsCertificationAccount,
  CERTIFICATION_BASE_URL,
} from './helpers/cert-gate';

/**
 * Certification journey — Role: Student.
 *
 * PREPARATION ONLY — see e2e/certification/helpers/cert-gate.ts for the full
 * gating explanation. Do NOT run against any live URL until CERT-17 closes.
 *
 * Steps mirror docs/audit/2026-07-02-certification/reports/04-user-journey-
 * certification-report.md exactly (Role: Student table) — no invented steps:
 *   Registration/Auth/Authz, Subscriptions, Dashboard, Assessments, AI Tutor,
 *   Reports/Analytics, Notifications, Payments, Certificates, Logout.
 *
 * Run (once CERT-17 is closed and a run has been seeded):
 *   CERTIFICATION_RUN_ENABLED=true \
 *   CERTIFICATION_BASE_URL=<target> \
 *   CERTIFICATION_RUN_ID=<uuid from seed-certification-accounts.ts> \
 *     npx playwright test e2e/certification/student.spec.ts
 */

test.describe('Certification journey — Student', () => {
  test.skip(!certificationSuiteEnabled(), certificationSkipReason());
  test.use({ baseURL: CERTIFICATION_BASE_URL || undefined });

  test('Registration / Auth / Authz — seeded student account logs in and lands on a post-auth route', async ({
    page,
  }) => {
    await loginAsCertificationAccount(page, 'student');
    await page.waitForURL(/\/(dashboard|onboarding|foxy|learn)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Subscriptions — /pricing renders plan options for a logged-in student', async ({ page }) => {
    // Read-only surface (no checkout initiated) — distinct from the live
    // money-moving "Payments" step, which is covered separately in
    // payments.spec.ts under the additional CERT-17 guard.
    await loginAsCertificationAccount(page, 'student');
    await page.goto('/pricing');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('h1')).toBeVisible({ timeout: 10_000 });
  });

  test('Dashboard — /dashboard renders real content, not an error/empty shell', async ({ page }) => {
    await loginAsCertificationAccount(page, 'student');
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 15_000 });
    if (!page.url().includes('/dashboard')) {
      await page.goto('/dashboard');
    }
    await page.waitForLoadState('domcontentloaded');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.trim().length).toBeGreaterThan(0);
    await expect(page.getByText(/application error/i)).toHaveCount(0);
  });

  test('Assessments — /quiz is reachable (P1/P2/P4/P5 verified statically; CERT-01 open at RPC layer for suspended accounts)', async ({
    page,
  }) => {
    // Report 04 verdict: PARTIAL. Static trace confirmed P1 (score accuracy),
    // P2 (XP economy), P4 (atomic submission), P5 (grade format) correct.
    // CERT-01 (risk register) is a live-reachable gap for suspended/deleted
    // accounts at the SQL/RPC layer — out of scope for a healthy seeded
    // account's reachability check, which is all this test asserts.
    await loginAsCertificationAccount(page, 'student');
    await page.goto('/quiz');
    await page.waitForLoadState('domcontentloaded');
    // /quiz either renders QuizSetup directly or 307-redirects to /foxy
    // (documented app behavior — next.config.js). Either indicates the
    // auth-protected assessments surface is reachable for this account.
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('AI Tutor — /foxy is reachable for a student account', async ({ page }) => {
    await loginAsCertificationAccount(page, 'student');
    await page.goto('/foxy');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Reports / Analytics — /progress renders for a logged-in student', async ({ page }) => {
    await loginAsCertificationAccount(page, 'student');
    await page.goto('/progress');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Notifications — /notifications renders for a logged-in student', async ({ page }) => {
    await loginAsCertificationAccount(page, 'student');
    await page.goto('/notifications');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Payments — live checkout run (delegated to payments.spec.ts under the CERT-17 guard)', async () => {
    test.fixme(
      true,
      'Report 04 verdict for this step is NOT VERIFIED (live) — a static trace only, pending ' +
        'Stage 2/3. The live checkout assertion lives in e2e/certification/payments.spec.ts, ' +
        'behind BOTH the base certification gate AND the additional CERT-17 ' +
        '(CERTIFICATION_PAYMENTS_CONFIRMED_SAFE) guard. Kept as a fixme placeholder here so this ' +
        "file's step list stays a complete, honest mirror of report 04 — do not delete without " +
        'also removing the corresponding report-04 row.',
    );
  });

  test('Certificates — surface not located in Stage 1 static trace (NOT VERIFIED)', async () => {
    test.fixme(
      true,
      'Report 04 verdict: NOT VERIFIED — "not located/traced in depth this wave." No certificate ' +
        'route/surface was confirmed to exist during Stage 1. A Stage 2 operator must locate the ' +
        'actual surface (if any) and replace this placeholder with a real assertion, or confirm ' +
        'the feature does not exist and update report 04 accordingly. Deliberately NOT guessing ' +
        'a route here.',
    );
  });

  test('Logout — signing out returns the student to a logged-out route', async ({ page }) => {
    await loginAsCertificationAccount(page, 'student');
    await page.waitForURL(/\/(dashboard|onboarding|foxy|learn)/, { timeout: 15_000 });
    // The student portal does NOT expose logout in the dashboard sidebar — the
    // Sign Out control lives on the Profile page (src/app/profile/page.tsx,
    // "Danger Zone"), reached via the sidebar's collapsed Account → Profile
    // entry. Navigate there before signing out, mirroring the real student
    // logout path. (handleSignOut → signOut() → router.replace('/login').)
    await page.goto('/profile');
    await page.waitForLoadState('domcontentloaded');
    const logoutButton = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
    await logoutButton.click({ timeout: 10_000 });
    await page.waitForURL(/\/(login|welcome|$)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/dashboard/);
  });
});
