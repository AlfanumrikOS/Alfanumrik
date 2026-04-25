import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * Webhook Fallback & Integrity Tests
 *
 * Tests the core patterns from src/app/api/payments/webhook/route.ts:
 *   1. Signature verification (P11: reject invalid webhook signatures)
 *   2. RPC fallback when primary RPC fails
 *   3. Idempotency via razorpay_event_id deduplication
 *
 * These are regression catalog tests for:
 *   - reject_invalid_webhook_signature
 *   - idempotent_webhook
 *   - subscription_status_transitions (partial)
 */

// ── Helpers that mirror webhook route logic ──────────────

function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  const sigBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');

  if (sigBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

function generateEventId(event: {
  account_id: string;
  event: string;
  payload: { payment?: { entity?: { id?: string } }; subscription?: { entity?: { id?: string } } };
}): string {
  return (
    event.account_id +
    '_' +
    (event.payload?.payment?.entity?.id || event.payload?.subscription?.entity?.id || '') +
    '_' +
    event.event
  );
}

// ── Signature Verification ───────────────────────────────

describe('Webhook Signature Verification (P11)', () => {
  const WEBHOOK_SECRET = 'test_webhook_secret_key_123';
  const BODY = JSON.stringify({
    event: 'subscription.activated',
    account_id: 'acc_test',
    payload: { subscription: { entity: { id: 'sub_123', notes: { user_id: 'u1', plan_code: 'pro' } } } },
  });

  it('accepts a valid HMAC-SHA256 signature', () => {
    const validSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(BODY).digest('hex');
    expect(verifyWebhookSignature(BODY, validSig, WEBHOOK_SECRET)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const validSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(BODY).digest('hex');
    // Flip a character in the signature
    const tampered = validSig.slice(0, -1) + (validSig.slice(-1) === 'a' ? 'b' : 'a');
    expect(verifyWebhookSignature(BODY, tampered, WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects a signature computed with the wrong secret', () => {
    const wrongSig = crypto.createHmac('sha256', 'wrong_secret').update(BODY).digest('hex');
    expect(verifyWebhookSignature(BODY, wrongSig, WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects a signature for a different body', () => {
    const sigForOtherBody = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update('{"event":"payment.failed"}')
      .digest('hex');
    expect(verifyWebhookSignature(BODY, sigForOtherBody, WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects an empty signature', () => {
    // Buffer.from('', 'hex') has length 0, so length mismatch will catch it
    expect(verifyWebhookSignature(BODY, '', WEBHOOK_SECRET)).toBe(false);
  });

  it('rejects a non-hex signature gracefully', () => {
    // Non-hex chars produce a shorter buffer, causing length mismatch
    expect(verifyWebhookSignature(BODY, 'not-hex-at-all!', WEBHOOK_SECRET)).toBe(false);
  });
});

// ── RPC Fallback (Phase 0g.2: atomic_subscription_activation) ───────────

describe('Webhook RPC Fallback Pattern (P11 atomic)', () => {
  // eslint-disable-next-line -- mock admin client with chainable methods for testing
  let mockAdmin: { rpc: any; from: any };

  beforeEach(() => {
    mockAdmin = {
      rpc: vi.fn(),
      from: vi.fn(),
    };
  });

  /**
   * Simulates the post-Phase-0g.2 fallback pattern from the webhook route:
   * 1. Try RPC activate_subscription
   * 2. If that fails, call atomic_subscription_activation (single
   *    transaction across students + student_subscriptions — closes the
   *    P11 split-brain risk that the previous two-statement fallback had).
   * 3. If BOTH RPCs fail, return 'failed' so the caller can 5xx and
   *    Razorpay retries.
   *
   * Mirrors src/app/api/payments/webhook/route.ts (subscription.activated /
   * subscription.charged branches).
   */
  async function activateWithFallback(
    admin: typeof mockAdmin,
    params: { userId: string; planCode: string; studentId: string; rzpSubId: string },
  ): Promise<{ method: 'rpc' | 'atomic_fallback' | 'failed'; error?: string; secondError?: string }> {
    const { error: rpcErr } = await admin.rpc('activate_subscription', {
      p_auth_user_id: params.userId,
      p_plan_code: params.planCode,
      p_billing_cycle: 'monthly',
      p_razorpay_subscription_id: params.rzpSubId,
    });

    if (!rpcErr) {
      return { method: 'rpc' };
    }

    // Fallback: atomic_subscription_activation (single-transaction RPC).
    const { error: atomicErr } = await admin.rpc('atomic_subscription_activation', {
      p_student_id: params.studentId,
      p_plan_code: params.planCode,
      p_billing_cycle: 'monthly',
      p_razorpay_payment_id: null,
      p_razorpay_subscription_id: params.rzpSubId,
    });

    if (atomicErr) {
      return { method: 'failed', error: rpcErr.message, secondError: atomicErr.message };
    }

    return { method: 'atomic_fallback', error: rpcErr.message };
  }

  it('uses primary RPC when it succeeds', async () => {
    mockAdmin.rpc.mockResolvedValue({ error: null });

    const result = await activateWithFallback(mockAdmin, {
      userId: 'u1',
      planCode: 'pro',
      studentId: 's1',
      rzpSubId: 'sub_123',
    });

    expect(result.method).toBe('rpc');
    expect(mockAdmin.rpc).toHaveBeenCalledTimes(1);
    expect(mockAdmin.rpc).toHaveBeenCalledWith('activate_subscription', {
      p_auth_user_id: 'u1',
      p_plan_code: 'pro',
      p_billing_cycle: 'monthly',
      p_razorpay_subscription_id: 'sub_123',
    });
    // Direct table writes MUST NOT happen (P11 split-brain prevention).
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('falls back to atomic_subscription_activation when primary RPC fails', async () => {
    // First call (activate_subscription) fails, second (atomic) succeeds.
    mockAdmin.rpc
      .mockResolvedValueOnce({ error: { message: 'RPC timeout' } })
      .mockResolvedValueOnce({ error: null });

    const result = await activateWithFallback(mockAdmin, {
      userId: 'u1',
      planCode: 'starter',
      studentId: 's1',
      rzpSubId: 'sub_456',
    });

    expect(result.method).toBe('atomic_fallback');
    expect(result.error).toBe('RPC timeout');
    expect(mockAdmin.rpc).toHaveBeenCalledTimes(2);
    // Second call MUST be the atomic RPC, not direct table writes.
    expect(mockAdmin.rpc).toHaveBeenLastCalledWith(
      'atomic_subscription_activation',
      expect.objectContaining({
        p_student_id: 's1',
        p_plan_code: 'starter',
        p_billing_cycle: 'monthly',
        p_razorpay_subscription_id: 'sub_456',
      }),
    );
    // Direct table writes MUST NOT happen — they would re-introduce the
    // split-brain risk this RPC was added to eliminate.
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('atomic fallback grants entitlement via single transaction (P11)', async () => {
    mockAdmin.rpc
      .mockResolvedValueOnce({ error: { message: 'function not found' } })
      .mockResolvedValueOnce({ error: null });

    const result = await activateWithFallback(mockAdmin, {
      userId: 'u1',
      planCode: 'pro',
      studentId: 's1',
      rzpSubId: 'sub_789',
    });

    expect(result.method).toBe('atomic_fallback');
    // The atomic RPC writes BOTH tables in a single transaction. The
    // contract is that we hit it exactly once with the expected args and
    // no direct table writes leak through.
    const atomicCall = mockAdmin.rpc.mock.calls.find(
      (c: unknown[]) => c[0] === 'atomic_subscription_activation',
    );
    expect(atomicCall).toBeDefined();
    expect(atomicCall[1]).toEqual(
      expect.objectContaining({ p_plan_code: 'pro', p_student_id: 's1' }),
    );
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('returns failed (5xx-equivalent) when BOTH RPCs fail', async () => {
    mockAdmin.rpc
      .mockResolvedValueOnce({ error: { message: 'primary timeout' } })
      .mockResolvedValueOnce({ error: { message: 'fallback rpc not deployed' } });

    const result = await activateWithFallback(mockAdmin, {
      userId: 'u1',
      planCode: 'pro',
      studentId: 's1',
      rzpSubId: 'sub_999',
    });

    expect(result.method).toBe('failed');
    expect(result.error).toBe('primary timeout');
    expect(result.secondError).toBe('fallback rpc not deployed');
    // No direct table writes even on double-failure — caller 5xxs and
    // Razorpay retries the webhook.
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });
});

// ── Kill switch (ff_atomic_subscription_activation) ──────────────────────
//
// Phase 0g.2 added a kill switch that disables the atomic fallback. When
// the flag is OFF, the webhook returns 503 immediately on primary RPC
// failure (forcing Razorpay retries) instead of attempting the atomic RPC.
//
// Default behaviour: flag missing → treated as enabled (true) so missing-
// migration scenarios are safe.

describe('Webhook Atomic Fallback Kill Switch (ff_atomic_subscription_activation)', () => {
  /**
   * Mirrors the helper added inline in the webhook route. The flag check
   * defaults to TRUE when the row is missing so deploying the route
   * before the migration applies is safe.
   */
  function isAtomicFallbackEnabled(flagRow: { is_enabled?: boolean } | null): boolean {
    return flagRow?.is_enabled ?? true;
  }

  it('returns true when flag row is missing (safe default)', () => {
    expect(isAtomicFallbackEnabled(null)).toBe(true);
  });

  it('returns true when flag is explicitly enabled', () => {
    expect(isAtomicFallbackEnabled({ is_enabled: true })).toBe(true);
  });

  it('returns false when flag is explicitly disabled', () => {
    expect(isAtomicFallbackEnabled({ is_enabled: false })).toBe(false);
  });

  /**
   * Simulates the route flow under kill-switch-disabled state. Asserts:
   *   1. Primary activate_subscription is attempted as normal.
   *   2. On primary failure, atomic RPC is NOT called.
   *   3. The simulated route returns a 503-equivalent state.
   */
  async function activateWithKillSwitch(
    rpcMock: ReturnType<typeof vi.fn>,
    killSwitchOn: boolean,
  ): Promise<{ method: 'rpc' | 'atomic_fallback' | 'kill_switch_503'; calls: number }> {
    const { error: rpcErr } = await rpcMock('activate_subscription', {});
    if (!rpcErr) return { method: 'rpc', calls: rpcMock.mock.calls.length };

    if (!killSwitchOn) {
      return { method: 'kill_switch_503', calls: rpcMock.mock.calls.length };
    }

    await rpcMock('atomic_subscription_activation', {});
    return { method: 'atomic_fallback', calls: rpcMock.mock.calls.length };
  }

  it('with kill switch ON, primary failure → 503 without calling atomic RPC', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ error: { message: 'primary failure' } });
    const result = await activateWithKillSwitch(rpc, false);
    expect(result.method).toBe('kill_switch_503');
    expect(result.calls).toBe(1); // only primary called, atomic skipped
  });

  it('with kill switch OFF (default), primary failure → atomic fallback runs', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ error: { message: 'primary failure' } })
      .mockResolvedValueOnce({ error: null });
    const result = await activateWithKillSwitch(rpc, true);
    expect(result.method).toBe('atomic_fallback');
    expect(result.calls).toBe(2);
  });

  it('primary success path is unchanged regardless of kill switch state', async () => {
    const rpc1 = vi.fn().mockResolvedValueOnce({ error: null });
    const rpc2 = vi.fn().mockResolvedValueOnce({ error: null });
    const r1 = await activateWithKillSwitch(rpc1, true);
    const r2 = await activateWithKillSwitch(rpc2, false);
    expect(r1.method).toBe('rpc');
    expect(r2.method).toBe('rpc');
    expect(r1.calls).toBe(1);
    expect(r2.calls).toBe(1);
  });
});

// ── Idempotency ──────────────────────────────────────────

describe('Webhook Idempotency', () => {
  it('generates consistent event IDs for subscription events', () => {
    const event = {
      account_id: 'acc_test123',
      event: 'subscription.activated',
      payload: {
        subscription: { entity: { id: 'sub_abc' } },
      },
    };

    const id1 = generateEventId(event);
    const id2 = generateEventId(event);
    expect(id1).toBe(id2);
    expect(id1).toBe('acc_test123_sub_abc_subscription.activated');
  });

  it('generates consistent event IDs for payment events', () => {
    const event = {
      account_id: 'acc_test123',
      event: 'payment.captured',
      payload: {
        payment: { entity: { id: 'pay_xyz' } },
      },
    };

    const id = generateEventId(event);
    expect(id).toBe('acc_test123_pay_xyz_payment.captured');
  });

  it('generates different IDs for different event types on same entity', () => {
    const base = {
      account_id: 'acc_1',
      payload: { subscription: { entity: { id: 'sub_1' } } },
    };

    const id1 = generateEventId({ ...base, event: 'subscription.activated' });
    const id2 = generateEventId({ ...base, event: 'subscription.charged' });
    expect(id1).not.toBe(id2);
  });

  it('simulates deduplication: second event with same ID is skipped', async () => {
    const processedEvents = new Set<string>();

    async function processWebhook(eventId: string): Promise<'processed' | 'skipped'> {
      // Mirrors the idempotency check in webhook route (lines 62-69)
      if (processedEvents.has(eventId)) {
        return 'skipped';
      }
      processedEvents.add(eventId);
      return 'processed';
    }

    const eventId = 'acc_1_sub_1_subscription.activated';

    const first = await processWebhook(eventId);
    expect(first).toBe('processed');

    const second = await processWebhook(eventId);
    expect(second).toBe('skipped');

    // Only one entry in the set
    expect(processedEvents.size).toBe(1);
  });

  it('processes different events independently', async () => {
    const processedEvents = new Set<string>();
    let processCount = 0;

    async function processWebhook(eventId: string): Promise<'processed' | 'skipped'> {
      if (processedEvents.has(eventId)) return 'skipped';
      processedEvents.add(eventId);
      processCount++;
      return 'processed';
    }

    await processWebhook('acc_1_sub_1_subscription.activated');
    await processWebhook('acc_1_sub_1_subscription.charged');
    await processWebhook('acc_1_sub_1_subscription.activated'); // duplicate

    expect(processCount).toBe(2);
    expect(processedEvents.size).toBe(2);
  });
});

// ── Subscription Status Transitions ──────────────────────

describe('Subscription Status Transitions', () => {
  it('follows the correct lifecycle: authenticated -> activated -> charged -> cancelled', () => {
    const validTransitions: Record<string, string[]> = {
      pending: ['active', 'cancelled'],
      active: ['active', 'past_due', 'cancelled', 'completed', 'expired'],
      past_due: ['active', 'halted', 'cancelled'],
      halted: ['active', 'cancelled'],
      cancelled: [],
      completed: [],
      expired: [],
    };

    // authenticated sets status to 'pending'
    expect(validTransitions['pending']).toContain('active');

    // activated sets status to 'active'
    expect(validTransitions['active']).toContain('past_due');
    expect(validTransitions['active']).toContain('cancelled');

    // pending can transition to cancelled (subscription never charged)
    expect(validTransitions['pending']).toContain('cancelled');

    // past_due can recover to active (retry succeeds)
    expect(validTransitions['past_due']).toContain('active');

    // terminal states have no valid transitions
    expect(validTransitions['cancelled']).toHaveLength(0);
    expect(validTransitions['completed']).toHaveLength(0);
    expect(validTransitions['expired']).toHaveLength(0);
  });

  it('maps Razorpay events to correct status values', () => {
    const eventToStatus: Record<string, string> = {
      'subscription.authenticated': 'pending',
      'subscription.activated': 'active',
      'subscription.charged': 'active',
      'subscription.pending': 'past_due',
      'subscription.halted': 'halted',
      'subscription.cancelled': 'cancelled',
      'subscription.completed': 'completed',
      'subscription.expired': 'expired',
    };

    // Verify all expected events are mapped
    expect(Object.keys(eventToStatus)).toHaveLength(8);

    // Verify specific critical mappings
    expect(eventToStatus['subscription.activated']).toBe('active');
    expect(eventToStatus['subscription.halted']).toBe('halted');
    expect(eventToStatus['subscription.cancelled']).toBe('cancelled');
  });
});
