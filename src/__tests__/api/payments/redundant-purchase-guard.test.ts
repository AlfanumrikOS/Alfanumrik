import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Track A.5 — redundant-purchase guard on the checkout routes (NO double-charge).
 *
 * Under test:
 *   - src/app/api/payments/create-order/route.ts
 *   - src/app/api/payments/subscribe/route.ts
 *
 * Contract pinned on BOTH routes:
 *   A. Covered student requesting a tier ≤ school tier → structured
 *      409 { already_covered:true, covered_by_school:true, school_plan } and
 *      NO Razorpay order/subscription is ever created.
 *   B. Requesting a tier ABOVE the school tier → NOT blocked; the route proceeds
 *      to the Razorpay path (the guard does not return 409).
 *   C. A resolver ERROR fails OPEN: checkout proceeds (never a hard block on a
 *      legitimate sale because the coverage check was unavailable).
 *
 * The effective-plan module is mocked (its logic is proven in the resolver
 * suites); here we pin the route WIRING + the guard's no-order behavior.
 */

// ─── effective-plan resolver seam (BOTH routes import from here) ──────────────
const resolveEffectiveEntitlement = vi.fn();
const resolveEffectiveEntitlementForUser = vi.fn();
const isRedundantPurchase = vi.fn();
vi.mock('@/lib/entitlements/effective-plan', () => ({
  resolveEffectiveEntitlement: (...a: unknown[]) => resolveEffectiveEntitlement(...a),
  resolveEffectiveEntitlementForUser: (...a: unknown[]) => resolveEffectiveEntitlementForUser(...a),
  isRedundantPurchase: (...a: unknown[]) => isRedundantPurchase(...a),
}));

// ─── Auth seams ──────────────────────────────────────────────────────────────
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }),
}));
const bearerGetUser = vi.fn();
vi.mock('@/lib/supabase-client', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => bearerGetUser(...a) } },
}));
const mockAuthorizeRequest = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a),
}));

// ─── Razorpay seam (subscribe route uses these helpers) ──────────────────────
const createRazorpaySubscription = vi.fn();
const createRazorpayOrder = vi.fn();
vi.mock('@/lib/razorpay', () => ({
  createRazorpaySubscription: (...a: unknown[]) => createRazorpaySubscription(...a),
  createRazorpayOrder: (...a: unknown[]) => createRazorpayOrder(...a),
}));

// ─── GST gate OFF + flags ────────────────────────────────────────────────────
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
  PAYMENT_FLAGS: { GST_INVOICING_V1: 'ff_gst_invoicing_v1' },
}));
vi.mock('@/lib/gst', () => ({
  computeGst: vi.fn().mockResolvedValue(null),
  gstToRazorpayNotes: vi.fn().mockReturnValue({}),
  supplierStateCode: vi.fn().mockReturnValue('27'),
}));

// ─── Quiet infra ─────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/posthog/server', () => ({ capture: vi.fn().mockResolvedValue(undefined) }));

// ─── Validation passthrough (accepts the canonical plan codes) ───────────────
vi.mock('@/lib/validation', () => {
  const { NextResponse } = require('next/server');
  const VALID = new Set(['free', 'starter', 'pro', 'unlimited']);
  return {
    paymentSubscribeSchema: {},
    validateBody: (_s: unknown, body: any) => {
      const code = String(body?.plan_code ?? '');
      if (!VALID.has(code)) {
        return { success: false, error: NextResponse.json({ error: 'Validation failed' }, { status: 400 }) };
      }
      return { success: true, data: { plan_code: code, billing_cycle: body?.billing_cycle ?? 'monthly' } };
    },
  };
});

// ─── supabase-admin: plan + student + existing-sub rows for the subscribe route ─
let _planRow: any;
let _studentRow: any;
let _existingSub: any;
const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
function fromMock(table: string) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = () => chain;
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
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t), rpc: (...a: unknown[]) => rpcMock(...a) },
  getSupabaseAdmin: () => ({ from: (t: string) => fromMock(t), rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

const USER = { id: 'auth-1', email: 'u@x.com' };

function makeRequest(body: unknown): any {
  return {
    cookies: { getAll: () => [] },
    headers: { get: (h: string) => (h === 'Authorization' ? 'Bearer t' : null) },
    json: async () => body,
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
  bearerGetUser.mockResolvedValue({ data: { user: USER } });
  mockAuthorizeRequest.mockResolvedValue({ authorized: true, userId: USER.id, errorResponse: undefined });
  _planRow = {
    data: {
      id: 'plan-1', plan_code: 'starter', name: 'Starter', price_monthly: 299,
      price_yearly: 2399, razorpay_plan_id_monthly: 'rzp_plan_starter', is_active: true,
    },
    error: null,
  };
  _studentRow = { data: { id: 'student-1' }, error: null };
  _existingSub = { data: null, error: null };
  createRazorpaySubscription.mockResolvedValue({ id: 'rzp_sub_new' });
  createRazorpayOrder.mockResolvedValue({ id: 'order_1', amount: 239900, currency: 'INR' });
  fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'order_1', amount: 239900, currency: 'INR' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadSubscribe() {
  return (await import('@/app/api/payments/subscribe/route')).POST;
}
async function loadCreateOrder() {
  return (await import('@/app/api/payments/create-order/route')).POST;
}

// ═════════════════════════════════════════════════════════════════════════════
// subscribe route
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/payments/subscribe — redundant-purchase guard', () => {
  it('A. covered student requesting ≤ school tier → 409 already_covered, NO Razorpay sub', async () => {
    resolveEffectiveEntitlement.mockResolvedValue({
      schoolCoverage: { plan: 'pro', schoolId: 's-1' }, effectivePlan: 'pro', source: 'school',
    });
    isRedundantPurchase.mockReturnValue({ redundant: true, schoolPlan: 'pro' });

    const POST = await loadSubscribe();
    const res = await POST(makeRequest({ plan_code: 'starter', billing_cycle: 'monthly' }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.already_covered).toBe(true);
    expect(body.covered_by_school).toBe(true);
    expect(body.school_plan).toBe('pro');
    // No charge of any kind.
    expect(createRazorpaySubscription).not.toHaveBeenCalled();
    expect(createRazorpayOrder).not.toHaveBeenCalled();
  });

  it('B. requesting ABOVE school tier → proceeds (Razorpay sub created), no 409', async () => {
    _planRow.data.plan_code = 'unlimited';
    resolveEffectiveEntitlement.mockResolvedValue({
      schoolCoverage: { plan: 'pro', schoolId: 's-1' }, effectivePlan: 'pro', source: 'school',
    });
    isRedundantPurchase.mockReturnValue({ redundant: false });

    const POST = await loadSubscribe();
    const res = await POST(makeRequest({ plan_code: 'unlimited', billing_cycle: 'monthly' }));

    expect(res.status).toBe(200);
    expect(createRazorpaySubscription).toHaveBeenCalledTimes(1);
  });

  it('C. resolver error → fail-OPEN: checkout proceeds (Razorpay sub created)', async () => {
    resolveEffectiveEntitlement.mockRejectedValue(new Error('resolver down'));

    const POST = await loadSubscribe();
    const res = await POST(makeRequest({ plan_code: 'starter', billing_cycle: 'monthly' }));

    expect(res.status).toBe(200);
    expect(createRazorpaySubscription).toHaveBeenCalledTimes(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// create-order route
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/payments/create-order — redundant-purchase guard', () => {
  it('A. covered student requesting ≤ school tier → 409 already_covered, NO Razorpay order (no fetch)', async () => {
    resolveEffectiveEntitlementForUser.mockResolvedValue({
      studentId: 'student-1',
      entitlement: { schoolCoverage: { plan: 'pro', schoolId: 's-1' }, effectivePlan: 'pro', source: 'school' },
    });
    isRedundantPurchase.mockReturnValue({ redundant: true, schoolPlan: 'pro' });

    const POST = await loadCreateOrder();
    const res = await POST(makeRequest({ plan_code: 'starter', billing_cycle: 'monthly' }));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.already_covered).toBe(true);
    expect(body.school_plan).toBe('pro');
    // The Razorpay order fetch was never reached.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('B. requesting ABOVE school tier → proceeds to Razorpay (fetch hit), no 409', async () => {
    resolveEffectiveEntitlementForUser.mockResolvedValue({
      studentId: 'student-1',
      entitlement: { schoolCoverage: { plan: 'starter', schoolId: 's-1' }, effectivePlan: 'starter', source: 'school' },
    });
    isRedundantPurchase.mockReturnValue({ redundant: false });

    const POST = await loadCreateOrder();
    const res = await POST(makeRequest({ plan_code: 'pro', billing_cycle: 'monthly' }));

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('api.razorpay.com');
  });

  it('C. resolver error → fail-OPEN: order creation proceeds (fetch hit)', async () => {
    resolveEffectiveEntitlementForUser.mockRejectedValue(new Error('resolver down'));

    const POST = await loadCreateOrder();
    const res = await POST(makeRequest({ plan_code: 'starter', billing_cycle: 'monthly' }));

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('B2C-only student (resolver null) → never blocked, order proceeds', async () => {
    resolveEffectiveEntitlementForUser.mockResolvedValue(null);

    const POST = await loadCreateOrder();
    const res = await POST(makeRequest({ plan_code: 'starter', billing_cycle: 'monthly' }));

    expect(res.status).toBe(200);
    expect(isRedundantPurchase).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
