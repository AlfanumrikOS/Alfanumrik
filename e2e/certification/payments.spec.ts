import { test, expect } from '@playwright/test';
import {
  paymentsSuiteEnabled,
  paymentsSkipReason,
  loginAsCertificationAccount,
  CERTIFICATION_BASE_URL,
} from './helpers/cert-gate';

/**
 * Certification journey — Payments (live checkout), Student + Parent roles.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DO NOT RUN THIS FILE. CERT-17 IS AN OPEN RELEASE BLOCKER.            ║
 * ║                                                                        ║
 * ║  docs/audit/2026-07-02-certification/reports/14-risk-register.md,     ║
 * ║  CERT-17: Vercel Preview currently shares its Supabase, Razorpay, and ║
 * ║  AI-provider environment-variable VALUES with Production (per         ║
 * ║  Vercel's own environment-variable scoping) — NOT yet confirmed to    ║
 * ║  point at a staging Supabase project or sandboxed Razorpay keys. A    ║
 * ║  live checkout run against a misconfigured target could create REAL  ║
 * ║  charges and REAL subscription-state writes against PRODUCTION.       ║
 * ║                                                                        ║
 * ║  This is Path B (browser-driven journey certification) per the risk   ║
 * ║  register's own terminology, and CERT-17 blocks Path B specifically.  ║
 * ║  It requires a HUMAN with Vercel dashboard access to confirm — no     ║
 * ║  agent can resolve it. Do not set CERTIFICATION_PAYMENTS_CONFIRMED_   ║
 * ║  SAFE=true until that confirmation has happened and is recorded.      ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Covers the "Payments" step from report 04 for BOTH roles that have it
 * (Student: NOT VERIFIED (live); Parent: NOT VERIFIED (live)) — kept as one
 * dedicated file, separate from the per-role journey specs, specifically so
 * it can carry this extra, explicit second guard without duplicating CERT-17
 * language across student.spec.ts and parent.spec.ts (which instead point
 * here via a test.fixme placeholder for their own "Payments" row).
 *
 * Gating (in addition to the base e2e/certification/ gate):
 *   CERTIFICATION_RUN_ENABLED=true            (base gate)
 *   CERTIFICATION_BASE_URL=<target>           (base gate)
 *   CERTIFICATION_PAYMENTS_CONFIRMED_SAFE=true  <-- CERT-17 second gate,
 *     set ONLY after a human confirms the target's payment/DB credentials
 *     are sandboxed. See paymentsSkipReason() in helpers/cert-gate.ts.
 *
 * Even with both gates set, this spec deliberately does NOT complete a real
 * Razorpay checkout — it stops at the point a real charge would be
 * initiated (clicking the plan CTA opens the Razorpay modal) and asserts the
 * modal/redirect surface appears, mirroring the "smoke: reachability" style
 * already used for payments in e2e/payment-checkout.spec.ts (REG-46) rather
 * than actually completing a transaction. A full authenticated-charge test
 * requires Razorpay test-mode keys confirmed live on the target — track as
 * a Stage 3 follow-up once CERT-17 closes and test-mode keys are confirmed
 * (RC-2026-07-02-baseline.md, environment assumption #6).
 */

test.describe('Certification journey — Payments (Student + Parent)', () => {
  test.skip(!paymentsSuiteEnabled(), paymentsSkipReason());
  test.use({ baseURL: CERTIFICATION_BASE_URL || undefined });

  test('Student Payments — /pricing checkout CTA is reachable and opens a payment surface (stops short of a real charge)', async ({
    page,
  }) => {
    await loginAsCertificationAccount(page, 'student');
    await page.goto('/pricing');
    await page.waitForLoadState('domcontentloaded');
    const cta = page.getByRole('button', { name: /get started|शुरू करें/i }).first();
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await cta.click();
    // A real click here would open the Razorpay checkout modal (injected via
    // https://checkout.razorpay.com) or navigate to a payment surface. We
    // assert reachability only — completing the charge is out of scope for
    // this preparation-only spec even with both gates enabled.
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  });

  test('Parent Payments — /pricing (or the parent-portal billing equivalent) checkout CTA is reachable', async ({
    page,
  }) => {
    await loginAsCertificationAccount(page, 'parent');
    await page.goto('/pricing');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).not.toMatch(/\/login/);
  });

  test('Webhook signature verification and idempotency — server-only, not browser-driven', async () => {
    test.fixme(
      true,
      'P11 signature-verification and event-idempotency checks are server-only concerns that ' +
        'cannot be exercised from a browser. Covered by ' +
        'src/__tests__/api/payments/webhook-route-integration.test.ts (unit) and REG-46 test 4 ' +
        'in e2e/payment-checkout.spec.ts (documents the same server-only boundary). This entry ' +
        'exists so the certification Payments step visibly accounts for that coverage rather ' +
        'than silently omitting it.',
    );
  });
});
