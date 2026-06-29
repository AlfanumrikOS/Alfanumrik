import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Gap 2 regression — payments.subscribe RBAC enforcement on the payment routes.
 *
 * Backend added a defense-in-depth RBAC gate to BOTH payment write routes
 * (create-order, verify), AFTER getUser() resolves identity and BEFORE any
 * Razorpay / DB work:
 *
 *   const auth = await authorizeRequest(request, 'payments.subscribe');
 *   if (!auth.authorized) return auth.errorResponse!;
 *
 * This test PINS that contract so a future edit can't silently drop the guard:
 *   1. Each route calls authorizeRequest with the EXACT string 'payments.subscribe'.
 *   2. When authorizeRequest denies (authorized:false), the route returns that
 *      errorResponse verbatim and SHORT-CIRCUITS before Razorpay (no fetch) and
 *      before any Supabase DB read/write.
 *   3. When authorizeRequest allows, the route proceeds PAST the gate (it does NOT
 *      return the gate's error; it reaches the Razorpay/DB stage).
 *
 * Fully deterministic: no network. global.fetch is mocked; getUser() is mocked to
 * return a logged-in user so execution reaches the RBAC gate (getUser runs first
 * in the route). The RBAC layer itself is mocked — its own behavior is proven in
 * rbac.test.ts; here we only verify the route WIRING to it.
 */

// ── RBAC seam (the unit under contract). ──────────────────────────────────────
const mockAuthorizeRequest = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a),
}));

// ── Cookie-auth seam. Both routes FIRST construct a real @supabase/ssr client
//    (createServerClient) and call `.auth.getUser()`, reading cookies via
//    `request.cookies.getAll()`. In this unit test the routes receive a plain
//    `Request` (its `.cookies` is undefined), so letting the REAL ssr client run
//    fires GoTrueClient._emitInitialSession() as a FLOATING promise that throws on
//    the undefined cookies — an unhandled rejection that crashes Vitest's shared
//    worker pool and cascades a bogus "reading 'config'" error onto every other
//    test file. We mock @supabase/ssr so createServerClient resolves cleanly to a
//    null user (no network, no cookie access), which deterministically forces the
//    route down to the Bearer fallback below. ──
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  }),
}));

// ── getUser() seam (Bearer fallback). After the cookie path returns null above,
//    both routes fall back to the Bearer token path on @/lib/supabase-client. We
//    mock it to return our user so control flow reaches authorizeRequest. Requests
//    below carry an Authorization: Bearer header to take that branch. ──
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase-client', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } },
}));

// ── Supabase admin (verify route DB). If the RBAC gate works, the DENY path never
//    touches this; the `from`/`rpc` spies record any access to prove short-circuit. ──
const adminAccess = vi.hoisted(() => ({ called: false }));
vi.mock('@/lib/supabase-admin', () => {
  function adminFromMock() {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'insert', 'update', 'upsert']) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.single = () => Promise.resolve({ data: null, error: null });
    return chain;
  }
  const adminClient = {
    from: () => {
      adminAccess.called = true;
      return adminFromMock();
    },
    rpc: () => {
      adminAccess.called = true;
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { supabaseAdmin: adminClient, getSupabaseAdmin: () => adminClient };
});

// ── Quiet infra. ──────────────────────────────────────────────────────────────
vi.mock('@/lib/posthog/server', () => ({ capture: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: vi.fn() }));

// ── Razorpay lib seam (subscribe route). `subscribe` creates Razorpay objects via
//    @/lib/razorpay (createRazorpaySubscription / createRazorpayOrder), not a raw
//    fetch. We spy on both so the DENY tests can prove the RBAC gate short-circuits
//    BEFORE any Razorpay object is minted (PAY-1 / P9 / P11). ──
const mockCreateSub = vi.fn();
const mockCreateOrder = vi.fn();
vi.mock('@/lib/razorpay', () => ({
  createRazorpaySubscription: (...a: unknown[]) => mockCreateSub(...a),
  createRazorpayOrder: (...a: unknown[]) => mockCreateOrder(...a),
}));

import { POST as createOrder } from '@/app/api/payments/create-order/route';
import { POST as verify } from '@/app/api/payments/verify/route';
import { POST as subscribe } from '@/app/api/payments/subscribe/route';

const USER = { id: 'auth-user-123', email: 'student@test.example' };

function denied(status: number) {
  return {
    authorized: false,
    userId: USER.id,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ error: 'Access denied', code: 'PERMISSION_DENIED' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
    reason: 'denied',
  };
}

function allowed() {
  return {
    authorized: true,
    userId: USER.id,
    studentId: 'student-1',
    roles: ['student'],
    permissions: ['payments.subscribe'],
    errorResponse: undefined,
  };
}

function orderReq(body: unknown = { plan_code: 'pro', billing_cycle: 'monthly' }): Request {
  return new Request('http://localhost/api/payments/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function subscribeReq(body: unknown = { plan_code: 'pro', billing_cycle: 'monthly' }): Request {
  return new Request('http://localhost/api/payments/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function verifyReq(): Request {
  return new Request('http://localhost/api/payments/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify({
      razorpay_payment_id: 'pay_abc123',
      razorpay_signature: 'deadbeef',
      razorpay_order_id: 'order_xyz',
      plan_code: 'pro',
      billing_cycle: 'monthly',
      type: 'order',
    }),
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  adminAccess.called = false;
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
  // Razorpay env so an authorized create-order reaches the fetch stage.
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
  fetchSpy = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'order_1', amount: 69900, currency: 'INR' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchSpy);
});

// ── Test isolation (2026-06-11 flaky-suite fix). ──────────────────────────────
// `vi.stubGlobal('fetch', ...)` above replaces globalThis.fetch and — unlike
// per-test mocks cleared by vi.clearAllMocks() — is NOT auto-restored between
// files (vitest's `unstubGlobals` config flag is not enabled project-wide).
// Vitest reuses a worker process across the files scheduled to it, so without an
// explicit unstub the Razorpay-shaped fetch stub LEAKED into whatever auth/test
// suite ran next in the same worker, intermittently breaking the hermetic
// "no session → 401" and bootstrap-validation assertions in
// auth-bootstrap.test.ts / auth-onboarding.test.ts depending on shard ordering.
// Restoring here keeps this suite's global mutation file-scoped.
afterEach(() => {
  vi.unstubAllGlobals();
});

// ═════════════════════════════════════════════════════════════════════════════
// create-order
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/payments/create-order — payments.subscribe RBAC gate', () => {
  it('authorizes against the EXACT permission string "payments.subscribe"', async () => {
    mockAuthorizeRequest.mockResolvedValue(allowed());
    await createOrder(orderReq() as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'payments.subscribe');
  });

  it('returns the authorize errorResponse (403) and short-circuits BEFORE Razorpay when denied', async () => {
    mockAuthorizeRequest.mockResolvedValue(denied(403));
    const res = await createOrder(orderReq() as never);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PERMISSION_DENIED');
    // No Razorpay order was attempted — the gate ran first.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('propagates a 401 denial verbatim', async () => {
    mockAuthorizeRequest.mockResolvedValue(denied(401));
    const res = await createOrder(orderReq() as never);
    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proceeds PAST the gate to Razorpay when authorized (does not return the gate error)', async () => {
    mockAuthorizeRequest.mockResolvedValue(allowed());
    const res = await createOrder(orderReq() as never);
    // Authorized → reached the Razorpay order stage (mocked fetch hit) and 200 OK.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain('api.razorpay.com');
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// verify
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/payments/verify — payments.subscribe RBAC gate', () => {
  it('authorizes against the EXACT permission string "payments.subscribe"', async () => {
    mockAuthorizeRequest.mockResolvedValue(denied(403));
    await verify(verifyReq() as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'payments.subscribe');
  });

  it('returns the authorize errorResponse (403) and short-circuits BEFORE any DB / HMAC work when denied', async () => {
    mockAuthorizeRequest.mockResolvedValue(denied(403));
    const res = await verify(verifyReq() as never);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PERMISSION_DENIED');
    // Denial happens before the route touches the service-role admin client.
    expect(adminAccess.called).toBe(false);
  });

  it('propagates a 401 denial verbatim and never touches the admin client', async () => {
    mockAuthorizeRequest.mockResolvedValue(denied(401));
    const res = await verify(verifyReq() as never);
    expect(res.status).toBe(401);
    expect(adminAccess.called).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// subscribe (PAY-1) — the LIVE checkout entry point; previously lacked this gate.
// ═════════════════════════════════════════════════════════════════════════════
describe('POST /api/payments/subscribe — payments.subscribe RBAC gate (PAY-1)', () => {
  it('authorizes against the EXACT permission string "payments.subscribe"', async () => {
    mockAuthorizeRequest.mockResolvedValue(denied(403));
    await subscribe(subscribeReq() as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'payments.subscribe');
  });

  it('denies (403) and short-circuits BEFORE any Razorpay object is created or admin DB touched', async () => {
    mockAuthorizeRequest.mockResolvedValue(denied(403));
    const res = await subscribe(subscribeReq() as never);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PERMISSION_DENIED');
    // No Razorpay subscription/order minted, no service-role DB access — the gate ran
    // first (P9/P11): a non-student authenticated principal cannot reach the creator.
    expect(mockCreateSub).not.toHaveBeenCalled();
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(adminAccess.called).toBe(false);
  });

  it('propagates a 401 denial verbatim and never mints a Razorpay object', async () => {
    mockAuthorizeRequest.mockResolvedValue(denied(401));
    const res = await subscribe(subscribeReq() as never);
    expect(res.status).toBe(401);
    expect(mockCreateSub).not.toHaveBeenCalled();
    expect(mockCreateOrder).not.toHaveBeenCalled();
    expect(adminAccess.called).toBe(false);
  });
});
