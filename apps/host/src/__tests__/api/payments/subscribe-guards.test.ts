/**
 * /api/payments/subscribe — auth + plan-selection guards (P11).
 *
 * Pins the route's pre-charge guards at src/app/api/payments/subscribe/route.ts:
 *   1. Unauthenticated → 401, no plan lookup, no Razorpay call.
 *   2. 'free' plan is rejected at 400 (you cannot "subscribe" to free).
 *   3. Unknown / inactive plan (DB lookup returns nothing) → 400, no Razorpay.
 *   4. plan_code is canonicalized (legacy alias / cycle suffix) BEFORE the DB
 *      lookup so pending and active rows always agree.
 *   5. A duplicate ACTIVE recurring subscription to the same plan+cycle → 409,
 *      no new Razorpay subscription created.
 *
 * Strategy mirrors src/__tests__/api/payments/cancel-guardian-ownership.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Auth ────────────────────────────────────────────────────────────────────
const ssrGetUser = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: (...a: unknown[]) => ssrGetUser(...a) } }),
}));
const bearerGetUser = vi.fn();
vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => bearerGetUser(...a) } },
}));

// ── RBAC (PAY-1) ─────────────────────────────────────────────────────────────
// The route now carries `authorizeRequest('payments.subscribe')` AFTER the
// getUser() null-check and BEFORE plan selection. These plan-selection-guard tests
// exercise logic past that gate, so we mock it ALLOWED here; the dedicated PAY-1
// deny pins live in payments-subscribe-rbac.test.ts. (The unauthenticated test
// below still returns 401 from getUser() before the gate is ever reached.)
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: vi.fn().mockResolvedValue({ authorized: true, errorResponse: undefined }),
}));

// ── Razorpay ────────────────────────────────────────────────────────────────
const createRazorpaySubscription = vi.fn();
const createRazorpayOrder = vi.fn();
vi.mock('@alfanumrik/lib/razorpay', () => ({
  createRazorpaySubscription: (...a: unknown[]) => createRazorpaySubscription(...a),
  createRazorpayOrder: (...a: unknown[]) => createRazorpayOrder(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));

// ── Validation — mirror the real zod enum reject for 'free' passes through but
//    invalid enum values fail. We model: enum rejects unknown plan_code as 400.
vi.mock('@alfanumrik/lib/validation', () => {
  const { NextResponse } = require('next/server');
  const VALID = new Set(['free', 'starter', 'pro', 'unlimited']);
  return {
    paymentSubscribeSchema: {},
    validateBody: (_schema: unknown, body: any) => {
      const raw = String(body?.plan_code ?? '');
      // The real route canonicalizes AFTER validation, so validation runs on
      // the raw plan_code. Legacy aliases ('premium', 'ultimate', suffixes)
      // are NOT in the enum — but the real schema is applied to the raw value.
      // For these tests we only feed canonical or alias values and assert the
      // route's own canonicalization, so accept anything string-shaped that
      // canonicalizes into the enum; reject genuinely-unknown values at 400.
      const canon = raw
        .replace(/_(monthly|yearly)$/, '')
        .replace(/^ultimate$/, 'unlimited')
        .replace(/^basic$/, 'starter')
        .replace(/^premium$/, 'pro');
      if (!VALID.has(canon)) {
        return {
          success: false,
          error: NextResponse.json(
            { success: false, error: 'Validation failed', code: 'VALIDATION_ERROR' },
            { status: 400 },
          ),
        };
      }
      return {
        success: true,
        data: { plan_code: raw, billing_cycle: body?.billing_cycle ?? 'monthly' },
      };
    },
  };
});

// ── supabaseAdmin chain mock ────────────────────────────────────────────────
// Chains used:
//   subscription_plans: .select(...).eq('plan_code', x).eq('is_active', true).single()
//   students:           .select('id').eq('auth_user_id', x).single()
//   student_subscriptions: .select(...).eq('student_id', x).single()
let _planRow: any = { data: null, error: null };
let _studentRow: any = { data: null, error: null };
let _existingSub: any = { data: null, error: null };
const planSelectArgs: unknown[] = [];
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });

function fromMock(table: string) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    if (table === 'subscription_plans') planSelectArgs.push([col, val]);
    return chain;
  };
  chain.order = () => chain;
  chain.limit = () => chain;
  const resolve = () => {
    if (table === 'subscription_plans') return _planRow;
    if (table === 'students') return _studentRow;
    return _existingSub;
  };
  chain.single = () => Promise.resolve(resolve());
  chain.maybeSingle = () => Promise.resolve(resolve());
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t), rpc: (...a: unknown[]) => rpcMock(...a) },
}));

function makeRequest(body: unknown): any {
  return { cookies: { getAll: () => [] }, headers: { get: () => null }, json: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
  planSelectArgs.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  ssrGetUser.mockResolvedValue({ data: { user: { id: 'auth-1', email: 'u@x.com' } } });
  bearerGetUser.mockResolvedValue({ data: { user: null } });
  _planRow = { data: null, error: null };
  _studentRow = { data: null, error: null };
  _existingSub = { data: null, error: null };
});

async function loadPOST() {
  return (await import('@/app/api/payments/subscribe/route')).POST;
}

describe('POST /api/payments/subscribe — auth gate', () => {
  it('returns 401 when unauthenticated and never looks up a plan or calls Razorpay', async () => {
    ssrGetUser.mockResolvedValue({ data: { user: null } });
    bearerGetUser.mockResolvedValue({ data: { user: null } });

    const POST = await loadPOST();
    const res = await POST(makeRequest({ plan_code: 'pro', billing_cycle: 'monthly' }));

    expect(res.status).toBe(401);
    expect(planSelectArgs).toHaveLength(0);
    expect(createRazorpaySubscription).not.toHaveBeenCalled();
    expect(createRazorpayOrder).not.toHaveBeenCalled();
  });
});

describe('POST /api/payments/subscribe — plan selection guards', () => {
  it('rejects the free plan with 400 before any plan lookup', async () => {
    const POST = await loadPOST();
    const res = await POST(makeRequest({ plan_code: 'free', billing_cycle: 'monthly' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Cannot subscribe to the free plan');
    expect(createRazorpaySubscription).not.toHaveBeenCalled();
  });

  it('returns 400 when the plan is unknown/inactive (DB lookup empty) and never calls Razorpay', async () => {
    _planRow = { data: null, error: { message: 'no rows' } };

    const POST = await loadPOST();
    const res = await POST(makeRequest({ plan_code: 'pro', billing_cycle: 'monthly' }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Plan not available');
    expect(createRazorpaySubscription).not.toHaveBeenCalled();
  });

  it('canonicalizes a legacy alias ("premium" → "pro") before the DB lookup', async () => {
    _planRow = {
      data: {
        id: 'plan-1', plan_code: 'pro', name: 'Pro', price_monthly: 299,
        price_yearly: 2999, razorpay_plan_id_monthly: 'rzp_plan_pro', is_active: true,
      },
      error: null,
    };
    _studentRow = { data: { id: 'student-1' }, error: null };
    _existingSub = { data: null, error: null };
    createRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_new' });
    rpcMock.mockResolvedValue({ data: null, error: null });

    const POST = await loadPOST();
    const res = await POST(makeRequest({ plan_code: 'premium', billing_cycle: 'monthly' }));

    expect(res.status).toBe(200);
    // The DB lookup used the canonical 'pro', not the raw 'premium'.
    expect(planSelectArgs).toContainEqual(['plan_code', 'pro']);
    expect(planSelectArgs).not.toContainEqual(['plan_code', 'premium']);
  });

  it('rejects a duplicate active recurring subscription to the same plan+cycle with 409', async () => {
    _planRow = {
      data: {
        id: 'plan-1', plan_code: 'pro', name: 'Pro', price_monthly: 299,
        price_yearly: 2999, razorpay_plan_id_monthly: 'rzp_plan_pro', is_active: true,
      },
      error: null,
    };
    _studentRow = { data: { id: 'student-1' }, error: null };
    _existingSub = {
      data: {
        id: 'sub-1', status: 'active', razorpay_subscription_id: 'rzp_sub_existing',
        plan_code: 'pro', billing_cycle: 'monthly',
      },
      error: null,
    };

    const POST = await loadPOST();
    const res = await POST(makeRequest({ plan_code: 'pro', billing_cycle: 'monthly' }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain('already have an active subscription');
    // No new Razorpay subscription created on the duplicate path.
    expect(createRazorpaySubscription).not.toHaveBeenCalled();
  });
});
