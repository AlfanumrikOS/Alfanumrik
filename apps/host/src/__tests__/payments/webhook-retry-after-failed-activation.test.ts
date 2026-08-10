import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * P11 — the Razorpay webhook must dedupe on SUCCESSFUL PROCESSING, not on row
 * existence (migration 20260814000006_webhook_dedupe_on_processed_not_existence).
 *
 * ─── THE DEFECT THESE TESTS CLOSE ──────────────────────────────────────────
 * `record_webhook_event` commits the payment_webhook_events receipt in its own
 * transaction, BEFORE the route attempts any activation. The route used to
 * short-circuit on `row.is_new === false`, i.e. on the mere EXISTENCE of that
 * receipt. Consequences, both observed in source:
 *
 *   1. FALSE ACKNOWLEDGEMENT. Delivery 1 records the receipt, both activation
 *      RPCs fail, the route returns 503 with the explicit intent "so Razorpay
 *      retries". Delivery 2 (that very retry) finds the receipt, gets
 *      is_new=false, and is answered 200 {note:'dedupe'} — activation is never
 *      re-attempted and Razorpay stops retrying. Every retryable status on this
 *      route (503s and 500s alike) was un-retryable in practice.
 *   2. PERMANENT SILENT LOSS. A crash / Vercel timeout between the receipt
 *      commit and the activation leaves the row present with processed_at NULL.
 *      Every future delivery is deduped away and the customer has paid without
 *      being activated.
 *
 * The fix keys the short-circuit on `already_processed` — true only when
 * processed_at IS NOT NULL AND outcome IN ('ack','activated','downgraded'),
 * the outcomes the route pairs with a 2xx. 'failed' (503), 'unresolved' (500),
 * 'dedupe' and NULL all return false and must re-attempt.
 *
 * Re-processing is safe by construction: activate_subscription_locked /
 * atomic_subscription_activation_locked are ON CONFLICT (student_id) upserts
 * under pg_advisory_xact_lock('subscription:'||student_id), and payment_history
 * is unique on razorpay_payment_id.
 *
 * Assertions below spy on RPC NAMES, not just status codes — a 200 tells you
 * nothing about whether the activation actually ran.
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
vi.mock('@alfanumrik/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@alfanumrik/lib/posthog/server', () => ({ capture: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: vi.fn().mockResolvedValue({ ok: true }),
  __resetFlagCacheForTests: () => {},
}));

import { POST } from '@/app/api/payments/webhook/route';

const WEBHOOK_SECRET = 'test_webhook_secret';

function signed(body: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

/** One and the same Razorpay event, re-delivered verbatim on every retry. */
function theSameEvent() {
  return {
    account_id: 'acc_retry',
    id: 'evt_retry_me',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_retry_1',
          order_id: 'ord_retry_1',
          amount: 199900,
          currency: 'INR',
          notes: { plan_code: 'pro', billing_cycle: 'yearly', user_id: 'u1', student_id: 's1' },
        },
      },
    },
  };
}

function makeRequest(body: object): Request {
  const raw = JSON.stringify(body);
  return new Request('http://localhost/api/payments/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': signed(raw) },
    body: raw,
  });
}

function tableResolver() {
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
      // razorpay_payments kill switch ON, ff_atomic_subscription_activation ON.
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { is_enabled: true }, error: null }) }) }) };
    }
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      insert: async () => ({ error: null }),
    };
  };
}

/** RPC names seen by the admin client, in call order. */
function rpcNames(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((c: unknown[]) => c[0] as string);
}

const ACTIVATION_RPCS = ['activate_subscription_locked', 'atomic_subscription_activation_locked'];

let mockAdmin: { rpc: ReturnType<typeof vi.fn>; from: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
  mockAdmin = { rpc: vi.fn(), from: vi.fn(tableResolver()) };
  (createClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin);
  globalMockAdmin = mockAdmin;
});

// ═══════════════════════════════════════════════════════════════════════════
// (a) The retry the route asked for must actually re-attempt the work.
// ═══════════════════════════════════════════════════════════════════════════
describe('webhook — a 503 retry re-attempts activation (receipt exists but is NOT processed)', () => {
  it('delivery 1 fails both activation RPCs → 503 and stamps outcome=failed (not a success outcome)', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') {
        return { data: [{ is_new: true, id: 'wh-retry', already_processed: false }], error: null };
      }
      if (name === 'activate_subscription_locked') return { data: null, error: { message: 'primary fail' } };
      if (name === 'atomic_subscription_activation_locked') return { data: null, error: { message: 'atomic fail' } };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      return { data: null, error: null };
    });

    const res = await POST(makeRequest(theSameEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(503);

    const names = rpcNames(mockAdmin.rpc);
    expect(names).toContain('activate_subscription_locked');
    expect(names).toContain('atomic_subscription_activation_locked');

    // The receipt must be stamped 'failed' — a RETRYABLE outcome. If this ever
    // became 'ack'/'activated'/'downgraded', already_processed would flip true
    // and the retry in the next test would be deduped away again.
    const markCall = mockAdmin.rpc.mock.calls.find((c: unknown[]) => c[0] === 'mark_webhook_event_processed');
    expect(markCall).toBeDefined();
    expect((markCall![1] as { p_id: string; p_outcome: string })).toEqual(
      expect.objectContaining({ p_id: 'wh-retry', p_outcome: 'failed' }),
    );
  });

  it('delivery 2 of the SAME event (receipt exists, already_processed=false) RE-ATTEMPTS activation — no dedupe', async () => {
    // The receipt from delivery 1 is still there (is_new=false), but it carries
    // outcome='failed' / a NULL outcome, so already_processed is false. This is
    // Razorpay honouring the 503 the route itself asked for.
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') {
        return { data: [{ is_new: false, id: 'wh-retry', already_processed: false }], error: null };
      }
      if (name === 'activate_subscription_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      return { data: null, error: null };
    });

    const res = await POST(makeRequest(theSameEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    // Not the dedupe short-circuit.
    expect((await res.json()).note).toBeUndefined();

    const names = rpcNames(mockAdmin.rpc);
    // THE POINT OF THE FIX: activation ran again on the redelivery.
    expect(names).toContain('activate_subscription_locked');

    // And the re-run still has a row id to stamp its terminal outcome onto —
    // the existing-but-unprocessed row id must be carried through, otherwise
    // this event could never become already_processed and would retry forever.
    const markCall = mockAdmin.rpc.mock.calls.find((c: unknown[]) => c[0] === 'mark_webhook_event_processed');
    expect(markCall).toBeDefined();
    expect((markCall![1] as { p_id: string; p_outcome: string })).toEqual(
      expect.objectContaining({ p_id: 'wh-retry', p_outcome: 'activated' }),
    );
  });

  it('is_new=false ALONE no longer suppresses processing (the old, defective signal)', async () => {
    // Guard against a revert to `if (row.is_new === false) return dedupe`.
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') {
        return { data: [{ is_new: false, id: 'wh-seen-only', already_processed: false }], error: null };
      }
      if (name === 'activate_subscription_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      return { data: null, error: null };
    });

    const res = await POST(makeRequest(theSameEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    expect(rpcNames(mockAdmin.rpc)).toContain('activate_subscription_locked');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (b) A genuinely finished event is still suppressed.
// ═══════════════════════════════════════════════════════════════════════════
describe('webhook — an already-PROCESSED event is deduped (200) and never re-activates', () => {
  it('already_processed=true → 200 {note:dedupe} and NO activation RPC', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') {
        return { data: [{ is_new: false, id: 'wh-done', already_processed: true }], error: null };
      }
      return { data: null, error: null };
    });

    const res = await POST(makeRequest(theSameEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    expect((await res.json()).note).toBe('dedupe');

    const names = rpcNames(mockAdmin.rpc);
    expect(names).toEqual(['record_webhook_event']);
    for (const rpc of ACTIVATION_RPCS) expect(names).not.toContain(rpc);
    // The short-circuit precedes student resolution and every ledger write: the
    // only table touched is feature_flags (the razorpay_payments kill switch,
    // read before dedupe).
    const tables = mockAdmin.from.mock.calls.map((c: unknown[]) => c[0]);
    expect(new Set(tables)).toEqual(new Set(['feature_flags']));
  });

  it('the dedupe short-circuit must NOT re-stamp the receipt', async () => {
    // mark_webhook_event_processed does a blind UPDATE of `outcome`. Writing
    // 'dedupe' over the row's terminal 'ack'/'activated'/'downgraded' would flip
    // already_processed back to FALSE and re-open the defect on the next
    // delivery. The row is already terminal; leave it alone.
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') {
        return { data: [{ is_new: false, id: 'wh-done', already_processed: true }], error: null };
      }
      return { data: null, error: null };
    });

    await POST(makeRequest(theSameEvent()) as unknown as import('next/server').NextRequest);
    expect(rpcNames(mockAdmin.rpc)).not.toContain('mark_webhook_event_processed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (c) Unknown processed-state fails SAFE — toward re-processing.
// ═══════════════════════════════════════════════════════════════════════════
describe('webhook — a missing already_processed field fails safe (re-attempt, never skip)', () => {
  it('already_processed absent from the RPC row → route RE-ATTEMPTS activation', async () => {
    // Happens if migration 20260814000006 has not been applied in this
    // environment (the pre-migration function returns only is_new + id). Reading
    // undefined as "not processed" costs at most one idempotent re-attempt;
    // reading it as "processed" would silently lose a paid activation.
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') {
        return { data: [{ is_new: false, id: 'wh-legacy' }], error: null }; // no already_processed
      }
      if (name === 'activate_subscription_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      return { data: null, error: null };
    });

    const res = await POST(makeRequest(theSameEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    expect((await res.json()).note).toBeUndefined();
    expect(rpcNames(mockAdmin.rpc)).toContain('activate_subscription_locked');
  });

  it('already_processed explicitly null → route RE-ATTEMPTS activation', async () => {
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') {
        return { data: [{ is_new: false, id: 'wh-null', already_processed: null }], error: null };
      }
      if (name === 'activate_subscription_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      return { data: null, error: null };
    });

    const res = await POST(makeRequest(theSameEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    expect(rpcNames(mockAdmin.rpc)).toContain('activate_subscription_locked');
  });

  it('a truthy-but-not-true already_processed (e.g. the string "true") does NOT suppress', async () => {
    // Strict === true. A loose check would let a shape drift in PostgREST's JSON
    // encoding silently re-create the skip-without-processing failure mode.
    mockAdmin.rpc.mockImplementation(async (name: string) => {
      if (name === 'record_webhook_event') {
        return { data: [{ is_new: false, id: 'wh-stringy', already_processed: 'true' }], error: null };
      }
      if (name === 'activate_subscription_locked') return { data: null, error: null };
      if (name === 'mark_webhook_event_processed') return { data: null, error: null };
      return { data: null, error: null };
    });

    const res = await POST(makeRequest(theSameEvent()) as unknown as import('next/server').NextRequest);
    expect(res.status).toBe(200);
    expect(rpcNames(mockAdmin.rpc)).toContain('activate_subscription_locked');
  });
});
