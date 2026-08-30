import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

/**
 * C1 (P11 CRITICAL) — forensic-audit fix regression.
 *
 * `verify/route.ts` previously trusted the CLIENT-SUPPLIED `plan_code` /
 * `billing_cycle` from the request body for entitlement, even though the
 * Razorpay HMAC signature only proves `order_id|payment_id` (or
 * `subscription_id|payment_id`) pairing — NOT which plan was purchased. A
 * client who genuinely paid for `starter` could re-POST the real signature
 * tuple while claiming `plan_code: 'unlimited'` and be granted the pricier
 * plan for free.
 *
 * The fix (2026-07-29) re-derives plan_code/billing_cycle server-side from
 * the Razorpay order/subscription's own `notes` (written only by our server
 * at creation time via createRazorpayOrder/createRazorpaySubscription) and
 * cross-checks `notes.student_id`/`notes.user_id` against the authenticated
 * caller.
 *
 * This file pins THREE behaviors:
 *   1. FORGERY REJECTED — body claims `plan_code: 'unlimited'` but Razorpay's
 *      own notes say `starter`; the route must activate/record `starter`
 *      (the authoritative value), never `unlimited`.
 *   2. FAIL-CLOSED ON MISSING NOTES — if notes.plan_code/billing_cycle can't
 *      be resolved (fetch fails or Razorpay returns no notes), the route
 *      must NOT fall back to the client body; it returns 202
 *      activation_pending and grants nothing.
 *   3. CROSS-ACCOUNT BINDING — the order/subscription's notes.student_id
 *      belongs to a DIFFERENT student than the authenticated caller; the
 *      route rejects with 403 and never activates.
 *
 * Mocking pattern mirrors verify-hmac-reject.test.ts (same file, same seams).
 */

// ── RBAC seam — ALLOW so control flow reaches the HMAC + notes logic. ──
const mockAuthorizeRequest = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a),
}));

// ── Cookie-auth seam → null user, forcing the Bearer fallback below. ──
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));

// ── Bearer-fallback getUser seam → our logged-in user. ──
const mockGetUser = vi.fn();
vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } },
}));

// ── Razorpay notes read-back seam — this IS the fix under test. ──
const mockGetRazorpayOrder = vi.fn();
const mockGetRazorpaySubscription = vi.fn();
vi.mock('@alfanumrik/lib/razorpay', () => ({
  getRazorpayOrder: (...a: unknown[]) => mockGetRazorpayOrder(...a),
  getRazorpaySubscription: (...a: unknown[]) => mockGetRazorpaySubscription(...a),
}));

// ── Supabase admin (service-role). Records the plan_code actually used for
//    the payment_history insert + activation RPC so we can assert on it. ──
const captured = vi.hoisted(() => ({
  insertedPlanCode: undefined as string | undefined,
  insertedBillingCycle: undefined as string | undefined,
  rpcPlanCode: undefined as string | undefined,
  rpcCalled: false,
  insertCalled: false,
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  const STUDENT_ID = 'student-real-owner';

  function adminFromMock(table: string) {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'insert', 'update', 'upsert']) {
      chain[m] = (...args: unknown[]) => {
        if (table === 'payment_history' && m === 'insert') {
          captured.insertCalled = true;
          const row = args[0] as Record<string, unknown>;
          captured.insertedPlanCode = row.plan_code as string;
          captured.insertedBillingCycle = row.billing_cycle as string;
        }
        return chain;
      };
    }
    chain.limit = () => chain;
    // Chain resolves as a thenable for bare-await queries (existing-payment check).
    chain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(res);
    chain.maybeSingle = () => {
      if (table === 'students') {
        return Promise.resolve({ data: { id: STUDENT_ID, subscription_plan: captured.rpcPlanCode }, error: null });
      }
      if (table === 'feature_flags') {
        return Promise.resolve({ data: { is_enabled: true }, error: null });
      }
      if (table === 'subscription_plans') {
        return Promise.resolve({ data: { price_monthly: 299, price_yearly: 2999 }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    chain.single = () => Promise.resolve({ data: null, error: null });
    return chain;
  }

  const adminClient = {
    from: (table: string) => adminFromMock(table),
    rpc: (name: string, params: Record<string, unknown>) => {
      if (name === 'activate_subscription_locked') {
        captured.rpcCalled = true;
        captured.rpcPlanCode = params.p_plan_code as string;
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { supabaseAdmin: adminClient, getSupabaseAdmin: () => adminClient };
});

// ── Quiet infra. ──
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@alfanumrik/lib/ops-events', () => ({ logOpsEvent: vi.fn() }));
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
  PAYMENT_FLAGS: { GST_INVOICING_V1: 'ff_gst_invoicing_v1' },
}));
// Rate limiter (always-allow) — payments/verify now rate-limits per user
// (VULN-D2, 20/hour — 43654b97); mock keeps this file's tests off the real
// in-memory fallback (Upstash absent in tests), matching the fix already
// applied once in auth-bootstrap.test.ts for the same bug.
vi.mock('@alfanumrik/lib/api-rate-limit', () => ({
  checkApiRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 999, resetAt: Math.ceil(Date.now() / 1000) + 3600 }),
}));

import { POST as verify } from '@/app/api/payments/verify/route';

const USER = { id: 'auth-user-real-owner', email: 'student@test.example' };
const REAL_SECRET = 'rzp_real_secret_for_test';
const ORDER_ID = 'order_xyz';
const PAYMENT_ID = 'pay_abc123';
const SIG_PAYLOAD = `${ORDER_ID}|${PAYMENT_ID}`;

function hmac(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyReq(body: Record<string, unknown>): Request {
  const validSig = hmac(REAL_SECRET, SIG_PAYLOAD);
  return new Request('http://localhost/api/payments/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify({
      razorpay_payment_id: PAYMENT_ID,
      razorpay_signature: validSig,
      razorpay_order_id: ORDER_ID,
      type: 'order',
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  captured.insertedPlanCode = undefined;
  captured.insertedBillingCycle = undefined;
  captured.rpcPlanCode = undefined;
  captured.rpcCalled = false;
  captured.insertCalled = false;
  mockAuthorizeRequest.mockResolvedValue({ authorized: true, errorResponse: undefined });
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_key';
  process.env.RAZORPAY_KEY_SECRET = REAL_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/payments/verify — plan-code forgery rejection (C1, P11)', () => {
  it('a forged client plan_code is IGNORED; the Razorpay notes plan_code (starter) is what activates', async () => {
    mockGetRazorpayOrder.mockResolvedValue({
      notes: { plan_code: 'starter', billing_cycle: 'monthly', student_id: 'student-real-owner' },
    });

    const res = await verify(
      verifyReq({
        // Client claims the expensive plan even though notes say 'starter'.
        plan_code: 'unlimited',
        billing_cycle: 'monthly',
      }) as never,
    );

    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);

    // The authoritative source (Razorpay notes) must be what was actually granted —
    // never the forged client value.
    expect(body.plan).toBe('starter');
    expect(captured.rpcCalled).toBe(true);
    expect(captured.rpcPlanCode).toBe('starter');
    expect(captured.rpcPlanCode).not.toBe('unlimited');
    expect(captured.insertedPlanCode).toBe('starter');
  });

  it('legacy plan aliases in notes are canonicalized the same way as the client-facing schema', async () => {
    // Razorpay notes stored the legacy 'premium' alias (pre-rename); the
    // canonicalizePlan() helper must still normalize it to 'pro' even though
    // it's coming from the authoritative source, not the client.
    mockGetRazorpayOrder.mockResolvedValue({
      notes: { plan_code: 'premium', billing_cycle: 'monthly', student_id: 'student-real-owner' },
    });

    const res = await verify(
      verifyReq({ plan_code: 'unlimited', billing_cycle: 'yearly' }) as never,
    );
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.plan).toBe('pro');
    expect(captured.rpcPlanCode).toBe('pro');
  });

  it('fails CLOSED (202 activation_pending, no RPC) when Razorpay notes cannot be resolved', async () => {
    mockGetRazorpayOrder.mockResolvedValue({ notes: undefined });

    const res = await verify(
      verifyReq({ plan_code: 'unlimited', billing_cycle: 'yearly' }) as never,
    );
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(202);
    expect(body.status).toBe('activation_pending');
    expect(body.success).toBe(false);
    // No entitlement path was reached with the forged client value.
    expect(captured.rpcCalled).toBe(false);
    expect(captured.insertCalled).toBe(false);
  });

  it('fails CLOSED (202) when the Razorpay notes fetch throws', async () => {
    mockGetRazorpayOrder.mockRejectedValue(new Error('Razorpay API timeout'));

    const res = await verify(
      verifyReq({ plan_code: 'starter', billing_cycle: 'monthly' }) as never,
    );
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(202);
    expect(captured.rpcCalled).toBe(false);
  });

  it('rejects with 403 when notes.student_id belongs to a different account (cross-account binding)', async () => {
    mockGetRazorpayOrder.mockResolvedValue({
      notes: { plan_code: 'starter', billing_cycle: 'monthly', student_id: 'SOMEONE-ELSES-STUDENT-ID' },
    });

    const res = await verify(
      verifyReq({ plan_code: 'starter', billing_cycle: 'monthly' }) as never,
    );
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(body.error).toMatch(/not associated with your account/i);
    expect(captured.rpcCalled).toBe(false);
    expect(captured.insertCalled).toBe(false);
  });

  it('accepts binding via legacy notes.user_id when notes.student_id is absent', async () => {
    mockGetRazorpayOrder.mockResolvedValue({
      notes: { plan_code: 'starter', billing_cycle: 'monthly', user_id: USER.id },
    });

    const res = await verify(
      verifyReq({ plan_code: 'starter', billing_cycle: 'monthly' }) as never,
    );
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(captured.rpcCalled).toBe(true);
  });
});
