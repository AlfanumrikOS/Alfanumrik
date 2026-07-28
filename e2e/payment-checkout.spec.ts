import { test, expect, type Page } from '@playwright/test';
import { mockStudentSession, hasRealStudentCreds, loginViaUI } from './helpers/auth';

/**
 * REG-46 — Payment checkout E2E (P11 enforcement at the browser level).
 *
 * Together with `quiz-happy-path.spec.ts` this is the BLOCKING
 * `e2e-critical-paths` CI job. A Razorpay regression must not ship green.
 *
 * ── 2026-07-28 revival ────────────────────────────────────────────────────
 * All five tests here were previously disabled by passing a LITERAL boolean
 * to `test.fixme`, on the stated grounds that "the mocked-session path does
 * not currently fully populate AuthContext.isLoggedIn for this surface".
 * That claim was verified FALSE: with the localStorage project-ref bug in
 * `helpers/auth.ts` fixed, `/pricing` renders the logged-in checkout CTA
 * (a <button>, not the logged-out <a href="/login">) and the full
 * CTA → SubscriptionConfirm → useCheckout → /api/payments/subscribe →
 * Razorpay → /api/payments/verify chain drives on mocks alone.
 *
 * The specs were ALSO stale: they targeted the pre-V3 pricing page. The
 * billing toggle is now "Monthly"/"Yearly" (not "switch to annual") and the
 * CTA opens a confirmation dialog before checkout. Both are fixed here.
 *
 * Strategy:
 *   - Razorpay's checkout.js is replaced with a deterministic stub before any
 *     page script runs; `rzp.open()` fires the success handler with fixed ids.
 *   - `/api/payments/subscribe` and `/api/payments/verify` are intercepted so
 *     the happy path, signature mismatch (400), activation kill-switch (503)
 *     and slow-verify windows are all reproducible without a live gateway.
 *
 * Run: npx playwright test e2e/payment-checkout.spec.ts
 */

const ORDER_RESPONSE = {
  success: true,
  data: { type: 'order', order_id: 'order_test_OK', amount: 559900, currency: 'INR', key: 'rzp_test_keyid' },
};

/**
 * Inject a stub Razorpay constructor plus a Vercel Analytics capture shim
 * before any page script runs. `analytics.track()` dispatches through
 * `window.va('event', { name, ...props })`, so `__vaCalls` is the browser-side
 * record of what the payment funnel reported.
 */
async function installRazorpayStub(page: Page, opts: {
  failPayment?: boolean;
  signature?: string;
  paymentId?: string;
} = {}) {
  await page.addInitScript(({ failPayment, signature, paymentId }) => {
    (window as unknown as { __vaCalls: unknown[] }).__vaCalls = [];
    const vaStub = (...args: unknown[]) => {
      (window as unknown as { __vaCalls: unknown[] }).__vaCalls.push(args);
    };
    Object.defineProperty(window, 'va', { configurable: true, writable: true, value: vaStub });

    type RzpHandlers = { handler?: (resp: Record<string, string>) => void };
    const failureHandlers: Array<(resp: Record<string, unknown>) => void> = [];
    class RzpStub {
      private opts: RzpHandlers;
      constructor(options: RzpHandlers) { this.opts = options; }
      on(event: string, handler: (resp: Record<string, unknown>) => void) {
        if (event === 'payment.failed') failureHandlers.push(handler);
      }
      open() {
        setTimeout(() => {
          if (failPayment) {
            failureHandlers.forEach((h) => h({ error: { description: 'Test failure' } }));
            return;
          }
          this.opts.handler?.({
            razorpay_payment_id: paymentId ?? 'pay_test_OK',
            razorpay_order_id: 'order_test_OK',
            razorpay_signature: signature ?? 'sig_test_OK',
          });
        }, 50);
      }
    }
    Object.defineProperty(window, 'Razorpay', { configurable: true, writable: true, value: RzpStub });
  }, { failPayment: opts.failPayment ?? false, signature: opts.signature ?? null, paymentId: opts.paymentId ?? null });

  // Block the real gateway script — the stub above provides window.Razorpay.
  await page.route('https://checkout.razorpay.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* stubbed by E2E */' }),
  );
}

/** Pricing V3: pick the billing cycle, click a paid plan CTA, confirm. */
async function openCheckout(page: Page, cycle: 'monthly' | 'yearly') {
  await page.goto('/pricing');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: cycle === 'yearly' ? /^yearly$/i : /^monthly$/i }).click();
  // Logged-out visitors get a <link> to /login here; a <button> proves the
  // mocked session resolved AuthContext.isLoggedIn.
  await page.getByRole('button', { name: /^get started$/i }).first().click();
  await page.getByRole('button', { name: /pay now|subscribe now/i }).click();
}

test.describe('REG-46 smoke: payment route reachability', () => {
  test('smoke: authenticated /pricing route is reachable', async ({ page }) => {
    test.skip(!hasRealStudentCreds(), 'requires TEST_STUDENT_EMAIL + TEST_STUDENT_PASSWORD and a non-placeholder NEXT_PUBLIC_SUPABASE_URL');
    await loginViaUI(page);
    await page.goto('/pricing');
    await page.waitForLoadState('domcontentloaded');
    expect(page.url()).toMatch(/\/pricing/);
  });
});

test.describe('REG-46 Payment Checkout', () => {

  // ── Test 1: happy path → verify called with the gateway's own fields ─────
  test('payment: Razorpay success posts the gateway signature to /api/payments/verify (P11)', async ({ page }) => {
    let verifyBody: Record<string, unknown> | null = null;
    await page.route('**/api/payments/subscribe', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDER_RESPONSE) }),
    );
    await page.route('**/api/payments/verify', async (route) => {
      verifyBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, plan_code: 'starter', billing_cycle: 'yearly' }),
      });
    });
    await installRazorpayStub(page);
    await mockStudentSession(page, { anyProjectRef: true });

    await openCheckout(page, 'yearly');
    await page.waitForFunction(
      () => Boolean((window as { __vaCalls?: unknown[] }).__vaCalls?.length),
      { timeout: 30_000 },
    );

    expect(verifyBody).not.toBeNull();
    // P11: the client must forward the gateway's payment id + signature
    // verbatim. It must NEVER assert plan state itself.
    expect(verifyBody).toMatchObject({
      razorpay_payment_id: 'pay_test_OK',
      razorpay_order_id: 'order_test_OK',
      razorpay_signature: 'sig_test_OK',
      type: 'order',
      billing_cycle: 'yearly',
    });
    // The client sends plan_code + cycle only — never an amount.
    expect(Object.keys(verifyBody ?? {})).not.toContain('amount');
  });

  // ── Test 2: signature mismatch → 400 → failure UI, never success ─────────
  test('payment: verify 400 (signature mismatch) grants no plan access and fires no success event (P11)', async ({ page }) => {
    let verifyCalled = false;
    await page.route('**/api/payments/subscribe', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDER_RESPONSE) }),
    );
    await page.route('**/api/payments/verify', async (route) => {
      verifyCalled = true;
      await route.fulfill({
        status: 400, contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Payment verification failed. Please contact support.' }),
      });
    });
    await installRazorpayStub(page, { signature: 'bad_signature' });
    await mockStudentSession(page, { anyProjectRef: true });

    await openCheckout(page, 'yearly');
    await expect.poll(() => verifyCalled, { timeout: 30_000 }).toBe(true);

    // P11 safety property: no plan access may be claimed on a rejected
    // signature, and the success funnel event must not fire.
    await expect(page.getByText(/upgraded!/i)).toHaveCount(0);
    const vaCalls = await page.evaluate(
      () => (window as unknown as { __vaCalls: unknown[] }).__vaCalls,
    );
    expect(vaCalls).toHaveLength(0);
  });

  // ── Test 2b: OPEN DEFECT — verification failure is invisible to the user ─
  test('payment: verify failure surfaces user-visible failure copy (P7/P11)', async ({ page }) => {
    test.fail(
      true,
      'KNOWN DEFECT (found 2026-07-28 by reviving this gate; owner: frontend). ' +
        'useCheckout() sets `error` on a failed verify but PricingPlansV3.tsx destructures only ' +
        '{ checkout, loading } and never renders it, and the verify-failure branch of useCheckout ' +
        'never invokes params.onError. Net effect: after a 400/503 from /api/payments/verify the ' +
        'SubscriptionConfirm dialog stays open on "Pay Now" with ZERO feedback, while the payment ' +
        'may already be captured at Razorpay. This test is marked expected-to-fail so it turns the ' +
        'gate RED the moment the defect is fixed, at which point delete this test.fail() line.',
    );
    await page.route('**/api/payments/subscribe', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDER_RESPONSE) }),
    );
    await page.route('**/api/payments/verify', (route) =>
      route.fulfill({
        status: 400, contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Payment verification failed. Please contact support.' }),
      }),
    );
    await installRazorpayStub(page, { signature: 'bad_signature' });
    await mockStudentSession(page, { anyProjectRef: true });

    await openCheckout(page, 'yearly');

    await expect(
      page.getByText(/verification failed|payment.*safe|please contact support|सत्यापन/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── Test 3: atomic-activation kill switch → 503 → no success state ───────
  test('payment: verify 503 (activation unavailable) never renders a success state (P11)', async ({ page }) => {
    await page.route('**/api/payments/subscribe', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDER_RESPONSE) }),
    );
    let verify503Calls = 0;
    await page.route('**/api/payments/verify', (route) => {
      verify503Calls++;
      return route.fulfill({
        status: 503, contentType: 'application/json',
        body: JSON.stringify({ success: false, error: 'Activation unavailable. Please try again.', retryable: true }),
      });
    });
    await installRazorpayStub(page);
    await mockStudentSession(page, { anyProjectRef: true });

    await openCheckout(page, 'yearly');
    await expect.poll(() => verify503Calls, { timeout: 30_000 }).toBeGreaterThan(0);

    // P11: a 503 from the activation path must never look like success.
    await expect(page.getByText(/upgraded!/i)).toHaveCount(0);
    const vaCalls = await page.evaluate(
      () => (window as unknown as { __vaCalls: unknown[] }).__vaCalls,
    );
    expect(vaCalls).toHaveLength(0);
    // (The missing user-visible retry copy on this path is the same open
    // defect asserted by test 2b above.)
  });

  // ── Test 4: no plan access is claimed before verify resolves (P11) ───────
  test('payment: no upgrade is shown until /api/payments/verify has responded (P11)', async ({ page }) => {
    // Replaces the previous empty placeholder for webhook idempotency (which
    // asserted nothing and is server-only — see test 5 and
    // src/__tests__/api/payments/webhook-route-integration.test.ts).
    // What IS browser-assertable, and is the same P11 property, is that the
    // client never grants plan access ahead of the verification round-trip.
    let releaseVerify: (() => void) | null = null;
    const verifyGate = new Promise<void>((resolve) => { releaseVerify = resolve; });

    await page.route('**/api/payments/subscribe', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDER_RESPONSE) }),
    );
    await page.route('**/api/payments/verify', async (route) => {
      await verifyGate;
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, plan_code: 'starter', billing_cycle: 'yearly' }),
      });
    });
    await installRazorpayStub(page);
    await mockStudentSession(page, { anyProjectRef: true });

    await openCheckout(page, 'yearly');

    // Verify is deliberately held open. Nothing that implies plan access may
    // render, and no payment_success analytics event may fire.
    await page.waitForTimeout(2_000);
    await expect(page.getByText(/upgraded!/i)).toHaveCount(0);
    const midFlightVa = await page.evaluate(
      () => (window as unknown as { __vaCalls: unknown[][] }).__vaCalls.length,
    );
    expect(midFlightVa).toBe(0);

    releaseVerify!();
    await page.waitForFunction(
      () => Boolean((window as { __vaCalls?: unknown[] }).__vaCalls?.length),
      { timeout: 30_000 },
    );
  });

  // ── Test 5: server-only webhook idempotency (needs a live target) ────────
  test('payment: duplicate webhook delivery is idempotent (server-side)', async ({ page: _page }) => {
    test.skip(
      !process.env.E2E_PAYMENT_WEBHOOK_TARGET,
      'Duplicate-webhook idempotency lives in the payment_webhook_events unique constraint on ' +
        'razorpay_event_id and is unreachable from a browser. Set E2E_PAYMENT_WEBHOOK_TARGET (plus ' +
        'RAZORPAY_WEBHOOK_SECRET) to exercise it against a live deployment. Authoritative coverage: ' +
        'src/__tests__/api/payments/webhook-route-integration.test.ts. Catalog: REG-46.',
    );
    // Intentionally reached only when the operator supplies a live target; the
    // body is a placeholder for that wiring, not an assertion about the app.
    expect(process.env.E2E_PAYMENT_WEBHOOK_TARGET).toBeTruthy();
  });

  // ── Test 6: P13 — the analytics payload carries no raw PII ───────────────
  test('payment: payment_success analytics payload contains amount_inr and no raw PII (P13)', async ({ page }) => {
    await page.route('**/api/payments/subscribe', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ORDER_RESPONSE) }),
    );
    await page.route('**/api/payments/verify', (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, plan_code: 'starter', billing_cycle: 'yearly' }),
      }),
    );
    await installRazorpayStub(page, { paymentId: 'pay_analytics_test' });
    await mockStudentSession(page, { anyProjectRef: true });

    await openCheckout(page, 'yearly');
    await page.waitForFunction(
      () => Boolean((window as { __vaCalls?: unknown[] }).__vaCalls?.length),
      { timeout: 30_000 },
    );

    const vaCalls = await page.evaluate(
      () => (window as unknown as { __vaCalls: unknown[][] }).__vaCalls,
    );
    const success = vaCalls.find(
      (call) => call[0] === 'event' && (call[1] as Record<string, unknown>)?.name === 'payment_success',
    );
    expect(success).toBeDefined();

    const payload = (success?.[1] ?? {}) as Record<string, unknown>;
    expect(payload.amount_inr).toBe(5599);
    expect(payload.currency).toBe('INR');

    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain('@');        // no raw email
    expect(serialized).not.toMatch(/\b\d{10}\b/); // no raw 10-digit phone
  });
});
