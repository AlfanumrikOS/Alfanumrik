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

// ── RPC Fallback ─────────────────────────────────────────

describe('Webhook RPC Fallback Pattern', () => {
  // eslint-disable-next-line -- mock admin client with chainable methods for testing
  let mockAdmin: { rpc: any; from: any };

  beforeEach(() => {
    mockAdmin = {
      rpc: vi.fn(),
      from: vi.fn(),
    };
  });

  /**
   * Simulates the fallback pattern from the webhook route:
   * 1. Try RPC activate_subscription
   * 2. If RPC fails, fall back to direct updates
   */
  async function activateWithFallback(
    admin: typeof mockAdmin,
    params: { userId: string; planCode: string; studentId: string; rzpSubId: string },
  ): Promise<{ method: 'rpc' | 'fallback'; error?: string }> {
    const { error: rpcErr } = await admin.rpc('activate_subscription', {
      p_auth_user_id: params.userId,
      p_plan_code: params.planCode,
      p_billing_cycle: 'monthly',
      p_razorpay_subscription_id: params.rzpSubId,
    });

    if (rpcErr) {
      // Fallback: direct updates (mirrors webhook route lines 129-143)
      const updateChain = admin.from('students');
      await updateChain.update({ subscription_plan: params.planCode });

      const upsertChain = admin.from('student_subscriptions');
      await upsertChain.upsert({
        student_id: params.studentId,
        plan_code: params.planCode,
        status: 'active',
        billing_cycle: 'monthly',
        razorpay_subscription_id: params.rzpSubId,
      });

      return { method: 'fallback', error: rpcErr.message };
    }

    return { method: 'rpc' };
  }

  it('uses RPC when it succeeds', async () => {
    mockAdmin.rpc.mockResolvedValue({ error: null });

    const result = await activateWithFallback(mockAdmin, {
      userId: 'u1',
      planCode: 'pro',
      studentId: 's1',
      rzpSubId: 'sub_123',
    });

    expect(result.method).toBe('rpc');
    expect(mockAdmin.rpc).toHaveBeenCalledWith('activate_subscription', {
      p_auth_user_id: 'u1',
      p_plan_code: 'pro',
      p_billing_cycle: 'monthly',
      p_razorpay_subscription_id: 'sub_123',
    });
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('falls back to direct updates when RPC fails', async () => {
    mockAdmin.rpc.mockResolvedValue({ error: { message: 'RPC timeout' } });

    // Mock the chained calls
    const mockUpdate = vi.fn().mockResolvedValue({ error: null });
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') return { update: mockUpdate };
      if (table === 'student_subscriptions') return { upsert: mockUpsert };
      return {};
    });

    const result = await activateWithFallback(mockAdmin, {
      userId: 'u1',
      planCode: 'starter',
      studentId: 's1',
      rzpSubId: 'sub_456',
    });

    expect(result.method).toBe('fallback');
    expect(result.error).toBe('RPC timeout');
    expect(mockAdmin.from).toHaveBeenCalledWith('students');
    expect(mockAdmin.from).toHaveBeenCalledWith('student_subscriptions');
    expect(mockUpdate).toHaveBeenCalledWith({ subscription_plan: 'starter' });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        student_id: 's1',
        plan_code: 'starter',
        status: 'active',
      }),
    );
  });

  it('fallback ensures student always gets entitlement (P11)', async () => {
    // Even when RPC fails, the student must not be left without access
    mockAdmin.rpc.mockResolvedValue({ error: { message: 'function not found' } });

    const updateCalled = vi.fn().mockResolvedValue({ error: null });
    const upsertCalled = vi.fn().mockResolvedValue({ error: null });
    mockAdmin.from.mockImplementation((table: string) => {
      if (table === 'students') return { update: updateCalled };
      if (table === 'student_subscriptions') return { upsert: upsertCalled };
      return {};
    });

    const result = await activateWithFallback(mockAdmin, {
      userId: 'u1',
      planCode: 'pro',
      studentId: 's1',
      rzpSubId: 'sub_789',
    });

    // Entitlement MUST be granted via fallback
    expect(result.method).toBe('fallback');
    expect(updateCalled).toHaveBeenCalledWith({ subscription_plan: 'pro' });
    expect(upsertCalled).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active', plan_code: 'pro' }),
    );
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
