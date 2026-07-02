import { test, expect } from '@playwright/test';
import {
  certificationSuiteEnabled,
  certificationSkipReason,
  loginAsCertificationAccount,
  CERTIFICATION_BASE_URL,
} from './helpers/cert-gate';

/**
 * Certification journey — Role: Teacher.
 *
 * PREPARATION ONLY — see e2e/certification/helpers/cert-gate.ts. Do NOT run
 * against any live URL until CERT-17 closes.
 *
 * Steps mirror docs/audit/2026-07-02-certification/reports/04-user-journey-
 * certification-report.md exactly (Role: Teacher table) — no invented steps:
 *   Registration/Auth/Authz, Dashboard/Reports/Analytics, AI Tutor
 *   (BLOCKED by design), Notifications (PARTIAL), Logout.
 *
 * Run: CERTIFICATION_RUN_ENABLED=true CERTIFICATION_BASE_URL=<target> \
 *      CERTIFICATION_RUN_ID=<uuid> npx playwright test e2e/certification/teacher.spec.ts
 */

test.describe('Certification journey — Teacher', () => {
  test.skip(!certificationSuiteEnabled(), certificationSkipReason());
  test.use({ baseURL: CERTIFICATION_BASE_URL || undefined });

  test('Registration / Auth / Authz — seeded teacher account logs in and lands on a post-auth route', async ({
    page,
  }) => {
    await loginAsCertificationAccount(page, 'teacher');
    await page.waitForURL(/\/(teacher|onboarding)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Dashboard / Reports / Analytics — /teacher renders real content', async ({ page }) => {
    await loginAsCertificationAccount(page, 'teacher');
    await page.waitForURL(/\/(teacher|onboarding)/, { timeout: 15_000 });
    if (!page.url().includes('/teacher')) {
      await page.goto('/teacher');
    }
    await page.waitForLoadState('domcontentloaded');
    const body = (await page.locator('body').textContent()) ?? '';
    expect(body.trim().length).toBeGreaterThan(0);
    await expect(page.getByText(/application error/i)).toHaveCount(0);
  });

  test('AI Tutor — teacher role SHOULD be blocked from Foxy (report 04) — RED: CERT-FE-01 real finding', async ({
    page,
  }) => {
    // Report 04 claimed: "teachers do not have Foxy access; confirmed this is
    // an intentional scope boundary, not a defect." The live journey against
    // the Vercel Preview DISPROVES the enforcement half of that claim.
    //
    // EXPECTED-RED / KNOWN FINDING (CERT-FE-01, see journey-run-01/findings.md):
    // /foxy has NO role gate. Its only client guard
    // (src/app/foxy/page.tsx:535) redirects when NOT logged in; there is no
    // wrong-role redirect, and middleware route protection was removed
    // (src/proxy.ts Layer 0.9). So an authenticated teacher session stays on
    // /foxy and renders the student chat UI. Fixing this is a gated product
    // change (needs assessment/architect review); this test stays RED to
    // document the gap rather than papering over it.
    //
    // The previous version of this test raced: it navigated to /foxy before
    // the teacher session was established, so it sometimes caught an
    // unauthenticated login screen at /foxy instead of a real teacher session.
    // We now establish the teacher session first (wait for /teacher) so the
    // assertion is a faithful probe of an AUTHENTICATED teacher reaching /foxy.
    await loginAsCertificationAccount(page, 'teacher');
    await page.waitForURL(/\/(teacher|onboarding)/, { timeout: 15_000 });
    await page.goto('/foxy');
    await page.waitForLoadState('domcontentloaded');
    // Give the client-side auth guard a beat to fire a wrong-role redirect if
    // one existed (it does not today — that is the finding).
    await page.waitForTimeout(1_500);
    expect(page.url()).not.toMatch(/\/foxy$/);
  });

  test('Notifications — PARTIAL: NotificationCenter is confirmed orphaned dead code for this portal (report 04)', async ({
    page,
  }) => {
    // Report 04 verdict: PARTIAL — "NotificationCenter component confirmed
    // orphaned dead code (zero live imports) for this portal." This
    // documents the gap rather than asserting a working notification bell
    // exists. Stage 2 operator: replace with a positive assertion once the
    // component is wired (or remove this test and update report 04 if the
    // gap is instead closed by deprecating the dead code).
    await loginAsCertificationAccount(page, 'teacher');
    await page.waitForURL(/\/(teacher|onboarding)/, { timeout: 15_000 });
    if (!page.url().includes('/teacher')) {
      await page.goto('/teacher');
    }
    await page.waitForLoadState('domcontentloaded');
    const notificationBell = page.locator('[data-testid*="notification"], [aria-label*="notification" i]');
    const count = await notificationBell.count().catch(() => 0);
    // Documented gap: expect NO live notification affordance on the teacher
    // portal today. If this starts failing, the gap has likely been closed —
    // update this test to assert the positive behavior instead.
    expect(count).toBe(0);
  });

  test('Logout — signing out returns the teacher to a logged-out route', async ({ page }) => {
    await loginAsCertificationAccount(page, 'teacher');
    await page.waitForURL(/\/(teacher|onboarding)/, { timeout: 15_000 });
    const logoutButton = page.getByRole('button', { name: /log ?out|sign ?out/i }).first();
    await logoutButton.click({ timeout: 10_000 });
    await page.waitForURL(/\/(login|welcome|$)/, { timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/teacher/);
  });
});
