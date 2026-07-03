import { test, expect } from '@playwright/test';
import {
  certificationSuiteEnabled,
  certificationSkipReason,
  loginAsCertificationAccount,
  CERTIFICATION_BASE_URL,
} from './helpers/cert-gate';

/**
 * Certification journey — Role: Support Staff.
 *
 * PREPARATION ONLY — see e2e/certification/helpers/cert-gate.ts. Do NOT run
 * against any live URL until CERT-17 closes.
 *
 * Steps mirror docs/audit/2026-07-02-certification/reports/04-user-journey-
 * certification-report.md exactly (Role: Support Staff table):
 *   Registration/Auth/Authz (PASS), Dashboard (FAIL/BLOCKED — same finding
 *   as Content Author, no dedicated portal, silent misroute to student
 *   dashboard), All subsequent steps BLOCKED.
 *
 * This is the second of the two roles this session's Wave 1 findings showed
 * have NO frontend portal (the other is Content Author, see
 * content-author.spec.ts). The "Dashboard" test below asserts the
 * EXPECTED-FAIL behavior (documented gap, CERT-07 in the risk register) as a
 * DELIBERATE, INTENTIONAL assertion — this is exactly the live proof the
 * certification plan needs for Stage 2, not an omission.
 *
 * Note: support_staff has no `demo_accounts` registry row (see the "Known
 * limitation" note in scripts/seed-certification-accounts.ts). The account
 * is still fully seeded and loginable via the other three traceability
 * signals (is_demo=true, the @certification.alfanumrik.invalid email domain,
 * and the cert-<run_id_short>-support_staff-<n> name marker).
 *
 * Run: CERTIFICATION_RUN_ENABLED=true CERTIFICATION_BASE_URL=<target> \
 *      CERTIFICATION_RUN_ID=<uuid> npx playwright test e2e/certification/support-staff.spec.ts
 */

test.describe('Certification journey — Support Staff', () => {
  test.skip(!certificationSuiteEnabled(), certificationSkipReason());
  test.use({ baseURL: CERTIFICATION_BASE_URL || undefined });

  test('Registration / Auth / Authz — seeded support_staff account logs in successfully', async ({
    page,
  }) => {
    // Report 04: "support and finance roles exist with real RBAC permission
    // grants; 2 of the 7 high-blast-radius admin routes are gated at the
    // support tier." Auth itself works — the gap is purely at the
    // frontend-portal layer, asserted in the next test.
    await loginAsCertificationAccount(page, 'support_staff');
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    expect(page.url()).not.toMatch(/\/login\?/);
  });

  test('Dashboard — EXPECTED FAIL/BLOCKED: support_staff has no dedicated portal; silently misrouted to the student /dashboard (CERT-07)', async ({
    page,
  }) => {
    // Report 04 verdict: FAIL / BLOCKED — "same finding as Content Author,
    // no dedicated portal, silent misroute to student dashboard." This
    // assertion PINS the documented gap so a future fix is a deliberate,
    // reviewed change to this test — not a silent regression discovered
    // later.
    await loginAsCertificationAccount(page, 'support_staff');
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/dashboard/);
  });

  test('All subsequent steps — BLOCKED past Dashboard, nothing to exercise (CERT-07)', async () => {
    test.fixme(
      true,
      'Per report 04 (Role: Support Staff) and risk-register CERT-07: every step past Dashboard ' +
        'is BLOCKED because support_staff has no dedicated frontend surface to drive. ' +
        'Re-enable/replace this placeholder once frontend ships a dedicated support-staff portal ' +
        '(or the role is deprecated per CERT-07\'s "Clarify product intent first" note).',
    );
  });
});
