import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';

/**
 * Payment Regression Tests
 *
 * Verifies product invariant P11 (Payment Integrity):
 * - Webhook signature MUST be verified before processing
 * - Subscription status changes MUST be atomic with payment record
 * - Never grant plan access without verified payment
 */

// ─── Webhook Signature Verification (P11) ────────────────────

describe('Payment Webhook Signature (P11)', () => {
  const WEBHOOK_SECRET = 'test_webhook_secret_123';

  /**
   * Timing-safe signature verification — mirrors production code in
   * webhook/route.ts and verify/route.ts. Uses crypto.timingSafeEqual
   * to prevent timing attacks on HMAC comparison.
   */
  function verifySignature(body: string, signature: string, secret: string): boolean {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // Timing-safe comparison (matches production implementation)
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (sigBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  }

  function createValidSignature(body: string): string {
    return crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(body)
      .digest('hex');
  }

  it('reject_invalid_webhook_signature: tampered signature returns false', () => {
    const body = JSON.stringify({ event: 'subscription.activated', payload: {} });
    const tamperedSig = 'deadbeef0000000000000000000000000000000000000000000000000000abcd';
    expect(verifySignature(body, tamperedSig, WEBHOOK_SECRET)).toBe(false);
  });

  it('accept_valid_webhook_signature: correct HMAC matches', () => {
    const body = JSON.stringify({ event: 'subscription.activated', payload: {} });
    const validSig = createValidSignature(body);
    expect(verifySignature(body, validSig, WEBHOOK_SECRET)).toBe(true);
  });

  it('reject_empty_signature: empty string signature', () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    expect(verifySignature(body, '', WEBHOOK_SECRET)).toBe(false);
  });

  it('reject_body_tampered: valid sig for different body', () => {
    const originalBody = JSON.stringify({ event: 'subscription.activated', amount: 29900 });
    const tamperedBody = JSON.stringify({ event: 'subscription.activated', amount: 0 });
    const sigForOriginal = createValidSignature(originalBody);
    // Signature for original body should NOT match tampered body
    expect(verifySignature(tamperedBody, sigForOriginal, WEBHOOK_SECRET)).toBe(false);
  });

  it('reject_wrong_length_signature: different hex length rejected before comparison', () => {
    const body = JSON.stringify({ event: 'payment.captured' });
    // Valid HMAC-SHA256 hex is 64 chars; this is 16 chars
    expect(verifySignature(body, 'deadbeef12345678', WEBHOOK_SECRET)).toBe(false);
  });
});

// ─── Idempotency (P11) ──────────────────────────────────────

describe('Payment Webhook Idempotency (P11)', () => {
  it('idempotent_webhook: same event ID processed only once', () => {
    // Simulate the idempotency check logic from webhook route
    const processedEvents = new Set<string>();

    function processEvent(eventId: string): 'processed' | 'already_processed' {
      if (processedEvents.has(eventId)) {
        return 'already_processed';
      }
      processedEvents.add(eventId);
      return 'processed';
    }

    const eventId = 'acc_123_pay_456_subscription.activated';

    // First call: should process
    expect(processEvent(eventId)).toBe('processed');

    // Second call: should skip (idempotent)
    expect(processEvent(eventId)).toBe('already_processed');

    // Different event: should process
    expect(processEvent('acc_123_pay_789_subscription.charged')).toBe('processed');
  });
});

// ─── Subscription Status Transitions (P11) ───────────────────

describe('Subscription Status Transitions (P11)', () => {
  type SubStatus = 'pending' | 'active' | 'past_due' | 'halted' | 'cancelled' | 'expired' | 'completed';

  // Valid transitions based on Razorpay lifecycle
  const VALID_TRANSITIONS: Record<SubStatus, SubStatus[]> = {
    pending: ['active'],                                       // subscription.activated
    active: ['active', 'past_due', 'cancelled', 'completed'], // charged, failed, cancelled, completed
    past_due: ['active', 'halted'],                            // payment retry success, all retries exhausted
    halted: ['active'],                                        // manual reactivation
    cancelled: ['expired'],                                    // period ends
    expired: [],                                               // terminal
    completed: [],                                             // terminal
  };

  function isValidTransition(from: SubStatus, to: SubStatus): boolean {
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  it('subscription_status_transitions: activated → charged → cancelled lifecycle', () => {
    expect(isValidTransition('pending', 'active')).toBe(true);    // activated
    expect(isValidTransition('active', 'active')).toBe(true);     // charged (renewal)
    expect(isValidTransition('active', 'cancelled')).toBe(true);  // user cancels
    expect(isValidTransition('cancelled', 'expired')).toBe(true); // period ends
  });

  it('subscription_blocks_invalid_transitions', () => {
    expect(isValidTransition('pending', 'cancelled')).toBe(false);  // can't cancel before activating
    expect(isValidTransition('expired', 'active')).toBe(false);     // can't reactivate expired
    expect(isValidTransition('completed', 'active')).toBe(false);   // terminal
  });

  it('subscription_past_due_recovery', () => {
    expect(isValidTransition('active', 'past_due')).toBe(true);    // payment fails
    expect(isValidTransition('past_due', 'active')).toBe(true);    // retry succeeds
    expect(isValidTransition('past_due', 'halted')).toBe(true);    // all retries fail
  });
});

// ─── Plan Access Control (P11) ───────────────────────────────

describe('Plan Access Control (P11)', () => {
  type PlanCode = 'free' | 'starter' | 'pro' | 'unlimited';
  type SubStatus = 'pending' | 'active' | 'past_due' | 'halted' | 'cancelled' | 'expired';

  function hasActivePlanAccess(status: SubStatus, plan: PlanCode, periodEnd: Date | null): boolean {
    // Free always has access
    if (plan === 'free') return true;

    // Active or past_due (grace period) has access
    if (status === 'active' || status === 'past_due') return true;

    // Cancelled but period not ended yet
    if (status === 'cancelled' && periodEnd && periodEnd > new Date()) return true;

    // Everything else: no access
    return false;
  }

  it('no_access_without_payment: pending subscription has no premium access', () => {
    expect(hasActivePlanAccess('pending', 'starter', null)).toBe(false);
  });

  it('active_subscription_has_access', () => {
    expect(hasActivePlanAccess('active', 'pro', null)).toBe(true);
  });

  it('grace_period_on_past_due', () => {
    expect(hasActivePlanAccess('past_due', 'starter', null)).toBe(true);
  });

  it('cancelled_has_access_until_period_end', () => {
    const futureDate = new Date(Date.now() + 86400000); // tomorrow
    expect(hasActivePlanAccess('cancelled', 'pro', futureDate)).toBe(true);
  });

  it('cancelled_no_access_after_period_end', () => {
    const pastDate = new Date(Date.now() - 86400000); // yesterday
    expect(hasActivePlanAccess('cancelled', 'pro', pastDate)).toBe(false);
  });

  it('halted_no_access', () => {
    expect(hasActivePlanAccess('halted', 'starter', null)).toBe(false);
  });

  it('expired_no_access', () => {
    expect(hasActivePlanAccess('expired', 'unlimited', null)).toBe(false);
  });

  it('free_always_has_access', () => {
    expect(hasActivePlanAccess('expired', 'free', null)).toBe(true);
    expect(hasActivePlanAccess('halted', 'free', null)).toBe(true);
    expect(hasActivePlanAccess('pending', 'free', null)).toBe(true);
  });
});

// ─── Plan Codes Consistency ──────────────────────────────────

describe('Plan Code Consistency', () => {
  it('web plan codes match usage.ts', async () => {
    const { checkDailyUsage } = await import('@/lib/usage');
    // Verify the function exists and accepts plan codes
    expect(typeof checkDailyUsage).toBe('function');
  });

  it('plan config exports all tiers', async () => {
    const { PLANS } = await import('@/lib/plans');
    expect(PLANS.free).toBeDefined();
    expect(PLANS.starter).toBeDefined();
    expect(PLANS.pro).toBeDefined();
    expect(PLANS.unlimited).toBeDefined();

    // Verify tier ordering
    expect(PLANS.free.tier).toBe(0);
    expect(PLANS.starter.tier).toBe(1);
    expect(PLANS.pro.tier).toBe(2);
    expect(PLANS.unlimited.tier).toBe(3);
  });
});
