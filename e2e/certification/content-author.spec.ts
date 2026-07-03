import { test, expect } from '@playwright/test';
import {
  certificationSuiteEnabled,
  certificationSkipReason,
  loginAsCertificationAccount,
  CERTIFICATION_BASE_URL,
} from './helpers/cert-gate';

/**
 * Certification journey — Role: Content Author.
 *
 * PREPARATION ONLY — see e2e/certification/helpers/cert-gate.ts. Do NOT run
 * against any live URL until CERT-17 closes.
 *
 * Steps mirror docs/audit/2026-07-02-certification/reports/04-user-journey-
 * certification-report.md exactly (Role: Content Author table):
 *   Registration/Auth/Authz (PASS), Dashboard (FAIL/BLOCKED — no dedicated
 *   frontend portal, silent misroute to student dashboard), All subsequent
 *   steps BLOCKED.
 *
 * This is one of the two roles this session's Wave 1 findings showed have NO
 * frontend portal (the other is Support Staff, see support-staff.spec.ts).
 * The "Dashboard" test below asserts the EXPECTED-FAIL behavior
 * (documented gap, CERT-07 in the risk register) as a DELIBERATE,
 * INTENTIONAL assertion — this is exactly the live proof the certification
 * plan needs for Stage 2, not an omission. If this test starts failing
 * because content_author now lands somewhere OTHER than /dashboard, that is
 * a signal worth investigating (either the gap was fixed — update this test
 * and report 04/CERT-07 — or something else regressed).
 *
 * Note: content_author has no `demo_accounts` registry row (see the "Known
 * limitation" note in scripts/seed-certification-accounts.ts —
 * `demo_accounts_role_check` has no legal value for this role today). The
 * account is still fully seeded and loginable via the other three
 * traceability signals (is_demo=true, the @certification.alfanumrik.invalid
 * email domain, and the cert-<run_id_short>-content_author-<n> name marker).
 *
 * Run: CERTIFICATION_RUN_ENABLED=true CERTIFICATION_BASE_URL=<target> \
 *      CERTIFICATION_RUN_ID=<uuid> npx playwright test e2e/certification/content-author.spec.ts
 */

test.describe('Certification journey — Content Author', () => {
  test.skip(!certificationSuiteEnabled(), certificationSkipReason());
  test.use({ baseURL: CERTIFICATION_BASE_URL || undefined });

  test('Registration / Auth / Authz — seeded content_author account logs in successfully', async ({
    page,
  }) => {
    // Report 04: "content_manager and reviewer roles exist with real RBAC
    // permission grants." Auth itself works — the gap is purely at the
    // frontend-portal layer, asserted in the next test.
    await loginAsCertificationAccount(page, 'content_author');
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    expect(page.url()).not.toMatch(/\/login\?/);
  });

  test('Dashboard — EXPECTED FAIL/BLOCKED: content_author has no dedicated portal; silently misrouted to the student /dashboard (CERT-07)', async ({
    page,
  }) => {
    // Report 04 verdict: FAIL / BLOCKED. "zero dedicated frontend portal
    // exists for these roles; a session holding only content_manager or
    // reviewer is silently misrouted to the student dashboard." Risk
    // register CERT-07 tracks this as a real product gap (Should-Fix-
    // Before-Release), not an audit limitation. This assertion PINS the
    // documented gap so a future fix is a deliberate, reviewed change to
    // this test — not a silent regression discovered later.
    await loginAsCertificationAccount(page, 'content_author');
    await page.waitForURL(/\/dashboard/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/dashboard/);
  });

  test('All subsequent steps — BLOCKED past Dashboard, nothing to exercise (CERT-07)', async () => {
    test.fixme(
      true,
      'Per report 04 (Role: Content Author) and risk-register CERT-07: every step past ' +
        'Dashboard is BLOCKED because content_author has no dedicated frontend surface to drive. ' +
        'Re-enable/replace this placeholder once frontend ships a dedicated content-author ' +
        'portal (or the role is deprecated per CERT-07\'s "Clarify product intent first" note).',
    );
  });
});
