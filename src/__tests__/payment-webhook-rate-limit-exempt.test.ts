import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression — webhook rate-limit exemption (P11).
 *
 * Background (2026-05-09 incident):
 *   The proxy/middleware applied a 200-req/min general rate limit to every
 *   route except /api/v1/health. Razorpay delivers webhooks from a small
 *   pool of static egress IPs; once the bucket for one of those IPs filled
 *   up the webhook receiver returned HTTP 429. Razorpay treats 4xx as
 *   TERMINAL (does not retry, unlike 5xx) — so the webhook event was
 *   silently dropped. Result: students paid via Razorpay, the payment was
 *   captured at Razorpay's end, but our backend was never told. Verified
 *   for hridaankaushik307@gmail.com — payment_webhook_events empty since
 *   the table was created on 2026-04-25.
 *
 * Invariant: /api/payments/webhook MUST be exempt from the general rate
 * limiter, alongside /api/v1/health. The route handler still verifies the
 * Razorpay HMAC signature before any DB write, so this exemption does not
 * widen the attack surface.
 *
 * This is a structural test against src/proxy.ts because middleware-level
 * behavior is hard to exercise in vitest without spinning up the Next
 * runtime. If the exempt block is removed, this test fails fast.
 */

const PROXY_PATH = join(process.cwd(), 'src/proxy.ts');

describe('Webhook rate-limit exemption (P11 incident 2026-05-09)', () => {
  const proxySource = readFileSync(PROXY_PATH, 'utf8');

  it('exempts /api/payments/webhook from the general rate limiter', () => {
    // Find the general rate limit block.
    const generalBlockIdx = proxySource.indexOf("checkRateLimit(`general:${ip}`");
    expect(generalBlockIdx, 'general rate limit block missing — proxy.ts shape changed').toBeGreaterThan(-1);

    // Find the webhook exemption.
    const exemptIdx = proxySource.indexOf("pathname === '/api/payments/webhook'");
    expect(exemptIdx, 'webhook rate-limit exemption removed — Razorpay 4xx will silently drop webhooks again').toBeGreaterThan(-1);

    // Exemption must come BEFORE the general rate limiter, otherwise it is dead code.
    expect(exemptIdx, 'webhook exemption is positioned AFTER the general rate limiter — has no effect')
      .toBeLessThan(generalBlockIdx);
  });

  it('keeps /api/v1/health exempt (don\'t regress the existing exemption)', () => {
    expect(proxySource).toContain("pathname === '/api/v1/health'");
  });

  it('does NOT exempt cron endpoints (they have CRON_SECRET auth + are internal)', () => {
    // /api/cron/* should still be rate-limited because they're protected by
    // CRON_SECRET and only ever called from Vercel's cron runner.
    expect(proxySource).not.toMatch(/pathname.*startsWith\(['"]\/api\/cron/);
  });
});
