/**
 * /api/payments/status + /api/payments/setup-plans guards (P11, P13).
 *
 * status (GET): src/app/api/payments/status/route.ts
 *   1. Unauthenticated → 401.
 *   2. Returns ONLY the caller's own subscription. The route resolves the
 *      student strictly from the authenticated user (students.auth_user_id =
 *      user.id) — it never reads a student id from query params or body, so
 *      a supplied `?id=` / `?student_id=` cannot leak another user's plan.
 *      We pin this by asserting the eq filter used is ('auth_user_id', user.id)
 *      and that the response reflects the authed user's own row.
 *
 * setup-plans (POST): src/app/api/payments/setup-plans/route.ts
 *   3. NOT open — it requires the x-admin-secret header to equal the service
 *      role key (constant-time compare). Missing/wrong secret → 401, and NO
 *      Razorpay plan creation happens.
 *   4. Idempotent — a plan that already has BOTH razorpay_plan_id_monthly AND
 *      razorpay_plan_id_quarterly is reported fully 'already_exists' for both
 *      cadences and is NOT re-created at Razorpay. (Quarterly provisioning was
 *      added with the per-school quarterly-billing change — the route now
 *      provisions a monthly AND a quarterly Razorpay plan per paid tier and
 *      reports a combined "monthly:…; quarterly:…" status string.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── RBAC / authorizeRequest mock ─────────────────────────────────────────────
// authorizeRequest() uses next/headers internally (dynamic import) not
// available in the Vitest jsdom environment. Mock the module so route tests
// focus on route logic; RBAC internals are tested in rbac.test.ts.
const mockAuthorizeRequest = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a),
  PERMISSIONS: { PAYMENTS_SUBSCRIBE: 'payments.subscribe' },
}));

// ── Auth (status route only uses this) ──────────────────────────────────────
const ssrGetUser = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: (...a: unknown[]) => ssrGetUser(...a) } }),
}));
const bearerGetUser = vi.fn();
vi.mock('@/lib/supabase-client', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => bearerGetUser(...a) } },
}));

// ── Razorpay (setup-plans) ──────────────────────────────────────────────────
const createRazorpayPlan = vi.fn();
vi.mock('@/lib/razorpay', () => ({
  createRazorpayPlan: (...a: unknown[]) => createRazorpayPlan(...a),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// secureEqual: real constant-time compare semantics (equal strings → true).
vi.mock('@/lib/secure-compare', () => ({
  secureEqual: (a: string, b: string) => a === b,
}));

// ── supabaseAdmin chain mock ────────────────────────────────────────────────
// status route chains:
//   students:               .select('id, subscription_plan').eq('auth_user_id', x).maybeSingle()
//   student_subscriptions:  .select(...).eq('student_id', x).maybeSingle()
//   subscription_plans:     .select(...).eq('plan_code', x).maybeSingle()
// setup-plans chains:
//   subscription_plans:     .select(...).eq('is_active', true).gt('price_monthly', 0).order(...)
//   subscription_plans:     .update({...}).eq('id', x)
let _studentRow: any = { data: null, error: null };
let _subRow: any = { data: null, error: null };
let _planDisplayRow: any = { data: null, error: null };
let _setupPlansList: any = { data: [], error: null };
const studentEqArgs: unknown[] = [];
const updateCalls: unknown[] = [];

function fromMock(table: string) {
  const chain: any = {};
  chain.select = () => chain;
  chain.eq = (col: string, val: unknown) => {
    if (table === 'students') studentEqArgs.push([col, val]);
    return chain;
  };
  chain.gt = () => chain;
  chain.order = () => Promise.resolve(_setupPlansList);
  chain.update = (patch: unknown) => {
    updateCalls.push(patch);
    return { eq: () => Promise.resolve({ data: null, error: null }) };
  };
  chain.maybeSingle = () => {
    if (table === 'students') return Promise.resolve(_studentRow);
    if (table === 'student_subscriptions') return Promise.resolve(_subRow);
    return Promise.resolve(_planDisplayRow);
  };
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (t: string) => fromMock(t) },
}));

function makeGet(): any {
  return { cookies: { getAll: () => [] }, headers: { get: () => null } };
}
function makePost(adminSecret: string | null): any {
  return {
    headers: { get: (k: string) => (k === 'x-admin-secret' ? adminSecret : null) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  studentEqArgs.length = 0;
  updateCalls.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service-key';
  ssrGetUser.mockResolvedValue({ data: { user: { id: 'auth-self', email: 'self@x.com' } } });
  bearerGetUser.mockResolvedValue({ data: { user: null } });
  // Default: authorizeRequest succeeds as the student.
  mockAuthorizeRequest.mockResolvedValue({
    authorized: true,
    userId: 'auth-self',
    roles: ['student'],
    errorResponse: null,
  });
});

describe('GET /api/payments/status — auth + own-record-only', () => {
  it('returns 401 when unauthenticated', async () => {
    ssrGetUser.mockResolvedValue({ data: { user: null } });
    bearerGetUser.mockResolvedValue({ data: { user: null } });
    mockAuthorizeRequest.mockResolvedValueOnce({
      authorized: false,
      userId: null,
      roles: [],
      errorResponse: new Response(
        JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHENTICATED' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    });
    const { GET } = await import('@/app/api/payments/status/route');
    const res = await GET(makeGet());
    expect(res.status).toBe(401);
  });

  it('resolves the student strictly from the authed user id (no cross-user leak vector)', async () => {
    _studentRow = { data: { id: 'student-self', subscription_plan: 'pro' }, error: null };
    _subRow = {
      data: {
        plan_code: 'pro', status: 'active', billing_cycle: 'monthly', auto_renew: true,
        current_period_start: '2026-01-01', current_period_end: '2026-02-01',
        next_billing_at: '2026-02-01', grace_period_end: null, cancelled_at: null,
        cancel_reason: null, renewal_attempts: 0, amount_paid: 299,
        razorpay_subscription_id: 'rzp_sub_self',
      },
      error: null,
    };
    _planDisplayRow = { data: { name: 'Pro', price_monthly: 299, price_yearly: 2999 }, error: null };

    const { GET } = await import('@/app/api/payments/status/route');
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan_code).toBe('pro');

    // The ONLY student filter is auth_user_id = the authed user's id. There is
    // no code path that reads a student id from the request, so no supplied id
    // could redirect the lookup to another user's row.
    expect(studentEqArgs).toContainEqual(['auth_user_id', 'auth-self']);
    expect(studentEqArgs.every(([col]: any) => col === 'auth_user_id')).toBe(true);
  });

  it('returns the free-plan default when the authed user has no student row', async () => {
    _studentRow = { data: null, error: null };
    const { GET } = await import('@/app/api/payments/status/route');
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.plan_code).toBe('free');
  });
});

describe('POST /api/payments/setup-plans — admin-secret gate (NOT open)', () => {
  it('returns 401 when the x-admin-secret header is missing — no Razorpay plan created', async () => {
    const { POST } = await import('@/app/api/payments/setup-plans/route');
    const res = await POST(makePost(null));
    expect(res.status).toBe(401);
    expect(createRazorpayPlan).not.toHaveBeenCalled();
  });

  it('returns 401 when the x-admin-secret header is wrong — no Razorpay plan created', async () => {
    const { POST } = await import('@/app/api/payments/setup-plans/route');
    const res = await POST(makePost('not-the-service-key'));
    expect(res.status).toBe(401);
    expect(createRazorpayPlan).not.toHaveBeenCalled();
  });

  it('is idempotent: a plan already carrying BOTH monthly + quarterly Razorpay ids is reported already_exists for both cadences, not re-created', async () => {
    // pro is FULLY provisioned (monthly + quarterly) → fully already_exists,
    // zero Razorpay calls. starter has NEITHER → both cadences created (2 calls).
    _setupPlansList = {
      data: [
        {
          id: 'p1', plan_code: 'pro', name: 'Pro', price_monthly: 299,
          razorpay_plan_id_monthly: 'rzp_plan_existing',
          razorpay_plan_id_quarterly: 'rzp_plan_existing_q',
        },
        {
          id: 'p2', plan_code: 'starter', name: 'Starter', price_monthly: 99,
          razorpay_plan_id_monthly: null,
          razorpay_plan_id_quarterly: null,
        },
      ],
      error: null,
    };
    createRazorpayPlan.mockResolvedValue({ id: 'rzp_plan_new' });

    const { POST } = await import('@/app/api/payments/setup-plans/route');
    // Correct secret == the service role key (secureEqual stub is ===).
    const res = await POST(makePost('stub-service-key'));
    expect(res.status).toBe(200);
    const body = await res.json();

    const proResult = body.results.find((r: any) => r.plan_code === 'pro');
    const starterResult = body.results.find((r: any) => r.plan_code === 'starter');
    // pro is fully provisioned for both cadences → no recreation on either.
    expect(proResult.status).toBe('monthly:already_exists; quarterly:already_exists');
    // starter is missing both → both created.
    expect(starterResult.status).toBe('monthly:created; quarterly:created');

    // Razorpay was called exactly twice — only for starter's two missing cadences.
    expect(createRazorpayPlan).toHaveBeenCalledTimes(2);
    // The fully-provisioned plan (pro) was NOT re-updated; only starter's two writes.
    expect(updateCalls).toHaveLength(2);
  });
});
