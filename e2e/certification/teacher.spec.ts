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

  test('AI Tutor — BLOCKED by design: teacher role has no Foxy access (report 04, not a defect)', async ({
    page,
  }) => {
    // Report 04: "teachers do not have Foxy access; confirmed this is an
    // intentional scope boundary, not a defect." This assertion is
    // INTENTIONAL — /foxy must NOT render the student chat UI for a teacher
    // session. A future product decision to grant teachers Foxy access
    // should be a deliberate, reviewed change to this test.
    await loginAsCertificationAccount(page, 'teacher');
    await page.goto('/foxy');
    await page.waitForLoadState('domcontentloaded');
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
