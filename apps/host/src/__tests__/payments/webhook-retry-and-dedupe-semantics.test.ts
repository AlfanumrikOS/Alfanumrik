import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * PAY-7 (P11 retry semantics) + PAY-5 (P11 idempotency) on the Razorpay webhook.
 *
 * PAY-7 — the webhook must distinguish a SERVER env-misconfig from a malformed
 *   REQUEST:
 *     • missing RAZORPAY_WEBHOOK_SECRET (server) → 503 so Razorpay RETRIES through a
 *       deploy/secret-rotation window (a 400 would permanently DROP a real event).
 *     • invalid/forged signature (request) → 4xx reject, event NOT processed.
 *   These pin the split introduced for PAY-7; they do NOT weaken the existing
 *   missing-header / invalid-signature pins in webhook-route-integration.test.ts.
 *
 * PAY-5 — when an event cannot be event-level-deduped (no account_id/id), the
 *   handler still PROCESSES it through the idempotent activation RPC (failing closed
 *   there would drop a genuine event); a re-fired/already-recorded event is a clean
 *   no-op (dedupe → ACK, no activation). Together: re-delivery never double-grants.
 */

vi.mock('@supabase/supabase-js', async () => {
  const actual = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  return { ...actual, createClient: vi.fn() };
});

import { createClient } from '@supabase/supabase-js';

let globalMockAdmin: any;
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: new Proxy({} as any, {
    get(_t, prop) {
      if (!globalMockAdmin) return undefined;
      const v = globalMockAdmin[prop];
      return typeof v === 'function' ? v.bind(globalMockAdmin) : v;
    },
  }),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/payments/webhook/route';
import { __resetFlagCacheForTests } from '@alfanumrik/lib/state/events/publish';

const WEBHOOK_SECRET = 'test_webhook_secret';

function signed(body: string, secret = WEBHOOK_SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function buildEvent(overrides: Partial<{
  event: string; account_id?: string; id?: string; payment_id: string; notes: Record<string, unknown>;
}> = {}) {
  const event = overrides.event ?? 'payment.captured';
  const notes = overrides.notes ?? { plan_code: 'pro', billing_cycle: 'yearly', user_id: 'u1', student_id: 's1' };
  const base: Record<string, unknown> = {
    id: 'evt_default',
    event,
    payload: {
      payment: { entity: { id: overrides.payment_id ?? 'pay_1', order_id: 'ord_1', amount: 199900, currency: 'INR', notes } },
    },
  };
  if ('account_id' in overrides) {
    if (overrides.account_id !== undefined) base.account_id = overrides.account_id;
  } else {
    base.account_id = 'acc_test';
  }
  if ('id' in overrides) {
    if (overrides.id === undefined) delete base.id;
    else base.id = overrides.id;
  }
  return base;
}

function makeRequest(body: object, opts: { header?: string | null } = {}): Request {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.header !== null) headers['x-razorpay-signature'] = opts.header ?? signed(raw);
  return new Request('http://localhost/api/payments/webhook', { method: 'POST', headers, body: raw });
}

function studentResolver() {
  return (table: string) => {
    if (table === 'students') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 's1', auth_user_id: 'u1' }, error: null }) }) }) };
    }
    if (table === 'payment_history') {
      return {
        select: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: { id: 'p1' }, error: null }) }) }),
        insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: 'p1' }, error: null }) }) }),
      };
    }
    if (table === 'feature_flags') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_enabled: true }, error: null }) }) }) };
    }
    if (table === 'state_events') {
      return { insert: async () => ({ error: null }) };
    }
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      insert: async () => ({ error: null }),
    };
  };
}

let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };

beforeEach(() => {
  __resetFlagCacheForTests();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  mockAdmin = { rpc: vi.fn(), from: vi.fn() };
  (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
  globalMockAdmin = mockAdmin;
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAY-7 — retry vs reject status semantics
// ═══════════════════════════════════════════════════════════════════════════════
describe('webhook route — PAY-7 missing-secret is retryable (503), forged signature is rejected (4xx)', () => {
  it('missing RAZORPAY_WEBHOOK_SECRET env → 503 (Razorpay retries) and event NOT processed', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const res = await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(503);
    // No DB / RPC work — the server-config fault short-circuits before processing.
    expect(mockAdmin.rpc).not.toHaveBeenCalled();
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('invalid (forged) signature → 400 reject, event NOT processed', async () => {
    // A valid env secret, but a signature signed with the WRONG secret.
    const raw = JSON.stringify(buildEvent());
    const forged = signed(raw, 'attacker_secret');
    const req = new Request('http://localhost/api/payments/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': forged },
      body: raw,
    });
    const res = await POST(req as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid signature');
    expect(mockAdmin.rpc).not.toHaveBeenCalled();
    expect(mockAdmin.from).not.toHaveBeenCalled();
  });

  it('missing signature HEADER stays a 400 client error (not retryable)', async () => {
    const res = await POST(makeRequest(buildEvent(), { header: null }) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(400);
    expect(mockAdmin.rpc).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PAY-5 — idempotency under re-delivery / un-dedupable events
// ═══════════════════════════════════════════════════════════════════════════════
describe('webhook route — PAY-5 re-delivery never double-grants', () => {
  it('an already-recorded (duplicate) event ACKs 200 with note=dedupe and does NOT activate', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') return { data: [{ is_new: false, id: 'wh-dup' }], error: null };
      throw new Error(`unexpected RPC ${name}`);
    });

    const res = await POST(makeRequest(buildEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    expect((await res.json()).note).toBe('dedupe');

    const calls = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('record_webhook_event');
    expect(calls).not.toContain('activate_subscription_locked');
    expect(calls).not.toContain('atomic_subscription_activation_locked');
  });

  it('an un-dedupable event (no account_id/id) STILL routes through the idempotent activation RPC', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'activate_subscription_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      // record_webhook_event must NOT be reachable without account_id/id, but stay safe.
      if (name === 'record_webhook_event') return { data: [{ is_new: true, id: 'wh-x' }], error: null };
      return { data: null, error: null };
    });
    mockAdmin.from.mockImplementation(studentResolver());

    // Strip both dedupe keys → handler skips event-level dedupe but must still process.
    const evt = buildEvent({ account_id: undefined, id: undefined });
    const res = await POST(makeRequest(evt) as unknown as import('next/server').NextRequest);

    expect(res.status).toBe(200);
    const calls = mockAdmin.rpc.mock.calls.map((c: unknown[]) => c[0]);
    // Event-level dedupe was skipped (no keys) ...
    expect(calls).not.toContain('record_webhook_event');
    // ... but activation still ran — and it is itself idempotent (ON CONFLICT upsert),
    // so a re-delivery cannot double-grant.
    expect(calls).toContain('activate_subscription_locked');
  });
});
