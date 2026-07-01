/**
 * /api/payments/cancel — guardian-ownership + auth gate (P11, P13).
 *
 * THE PRIORITY of this file. payments/cancel accepts an optional
 * `body.student_id` so a verified guardian can cancel a CHILD's subscription.
 * It runs on `supabaseAdmin` (RLS bypass), so the ONLY thing standing between
 * a parent and an arbitrary student's subscription is the in-handler
 * ownership check (`listChildrenForGuardian` → must contain the requested
 * student_id). If that check were dropped, any authenticated guardian could
 * cancel ANY student's subscription by guessing/enumerating student UUIDs.
 *
 * Contract pinned here (mirrors the route source at
 * src/app/api/payments/cancel/route.ts):
 *   1. Unauthenticated → 401, no DB read/write.
 *   2. Guardian supplies a student_id NOT in their linked-children set →
 *      404 "Student not found", and NO subscription read, NO Razorpay cancel,
 *      NO atomic_cancel_subscription RPC fires. (The ownership check runs
 *      BEFORE any write — enumeration-safe: same 404 as "no such student".)
 *   3. Guardian supplies a student_id that IS in their linked-children set →
 *      proceeds (subscription lookup + RPC).
 *   4. Self-cancel (no student_id) → resolves via students.auth_user_id and
 *      proceeds.
 *
 * Strategy: dynamic-import handler test in the same family as
 * src/__tests__/api/super-admin/plan-change-atomicity.test.ts. We mock the
 * SSR auth client, supabaseAdmin, the guardian-link domain helper, Razorpay,
 * validation, logger, and ops-events, then assert on status + which seams
 * were (not) touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Auth: @supabase/ssr createServerClient ──────────────────────────────────
const ssrGetUser = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: (...a: unknown[]) => ssrGetUser(...a) },
  }),
}));

// ── Bearer-token fallback client ────────────────────────────────────────────
const bearerGetUser = vi.fn();
vi.mock('@/lib/supabase-client', () => ({
  supabase: { auth: { getUser: (...a: unknown[]) => bearerGetUser(...a) } },
}));

// ── RBAC / authorizeRequest mock ─────────────────────────────────────────────
// authorizeRequest() uses next/headers internally (dynamic import) which is
// unavailable in the Vitest jsdom environment.  We mock the whole module so
// route tests can focus on route logic; RBAC internals are tested in rbac.test.ts.
const mockAuthorizeRequest = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorizeRequest(...a),
  PERMISSIONS: { PAYMENTS_SUBSCRIBE: 'payments.subscribe' },
}));

// ── Guardian-link ownership helper ──────────────────────────────────────────
const listChildrenForGuardian = vi.fn();
vi.mock('@/lib/domains/relationship', () => ({
  listChildrenForGuardian: (...a: unknown[]) => listChildrenForGuardian(...a),
}));

// ── Razorpay ────────────────────────────────────────────────────────────────
const cancelRazorpaySubscription = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/razorpay', () => ({
  cancelRazorpaySubscription: (...a: unknown[]) => cancelRazorpaySubscription(...a),
}));

// ── Logger + ops-events silencers ───────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));

// ── Validation (pass-through, mirrors real zod shape) ───────────────────────
vi.mock('@/lib/validation', () => ({
  paymentCancelSchema: {},
  validateBody: (_schema: unknown, body: any) => ({
    success: true,
    data: { immediate: body?.immediate ?? false, reason: body?.reason ?? null },
  }),
}));

// ── supabaseAdmin chain mock ────────────────────────────────────────────────
// The route does, in order:
//   self-cancel:    from('students').select('id').eq('auth_user_id', x).single()
//   then (always):  from('student_subscriptions').select(...).eq('student_id', x).single()
//   on RPC path:    admin.rpc('atomic_cancel_subscription', {...})
//   audit:          from('subscription_events').insert({...})
const studentsSingle = vi.fn();
const subscriptionsSingle = vi.fn();
const rpcMock = vi.fn();
const insertMock = vi.fn().mockResolvedValue({ data: null, error: null });

function fromMock(table: string) {
  const chain: any = {};
  const passthrough = ['select', 'eq', 'order', 'limit'];
  for (const m of passthrough) chain[m] = () => chain;
  chain.single = () =>
    table === 'students' ? studentsSingle() : subscriptionsSingle();
  chain.maybeSingle = chain.single;
  chain.insert = (...a: unknown[]) => insertMock(...a);
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => fromMock(table),
    rpc: (...a: unknown[]) => rpcMock(...a),
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────
const PARENT_AUTH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SELF_AUTH_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LINKED_CHILD_ID = '11111111-1111-4111-8111-111111111111';
const UNLINKED_CHILD_ID = '99999999-9999-4999-8999-999999999999';
const SELF_STUDENT_ID = '22222222-2222-4222-8222-222222222222';

function makeRequest(body: unknown): any {
  return {
    cookies: { getAll: () => [] },
    headers: { get: () => null },
    json: async () => body,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'stub-anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub-service';
  // Default: authorizeRequest succeeds as the parent.
  mockAuthorizeRequest.mockResolvedValue({
    authorized: true,
    userId: PARENT_AUTH_ID,
    roles: ['parent'],
    errorResponse: null,
  });
  // Default: authenticated as the parent (SSR client used after authorizeRequest).
  ssrGetUser.mockResolvedValue({ data: { user: { id: PARENT_AUTH_ID, email: 'p@x.com' } } });
  bearerGetUser.mockResolvedValue({ data: { user: null } });
  // Default subscription row is an active pro sub with no razorpay id (so the
  // Razorpay-cancel branch is skipped and we go straight to the RPC).
  subscriptionsSingle.mockResolvedValue({
    data: {
      id: 'sub-1',
      status: 'active',
      plan_code: 'pro',
      razorpay_subscription_id: null,
      current_period_end: '2026-12-31T00:00:00.000Z',
      auto_renew: true,
    },
    error: null,
  });
  rpcMock.mockResolvedValue({ data: [{ outcome: 'cancel_scheduled' }], error: null });
  studentsSingle.mockResolvedValue({ data: { id: SELF_STUDENT_ID }, error: null });
});

async function loadPOST() {
  const mod = await import('@/app/api/payments/cancel/route');
  return mod.POST;
}

describe('POST /api/payments/cancel — auth gate', () => {
  it('returns 401 when unauthenticated and never reads a subscription or calls the RPC', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce({
      authorized: false,
      userId: null,
      roles: [],
      errorResponse: new Response(
        JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHENTICATED' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    });
    // These are harmless given authorizeRequest short-circuits before SSR is reached.
    ssrGetUser.mockResolvedValue({ data: { user: null } });
    bearerGetUser.mockResolvedValue({ data: { user: null } });

    const POST = await loadPOST();
    const res = await POST(makeRequest({ student_id: LINKED_CHILD_ID }));

    expect(res.status).toBe(401);
    expect(subscriptionsSingle).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(cancelRazorpaySubscription).not.toHaveBeenCalled();
  });
});

describe('POST /api/payments/cancel — guardian ownership check runs BEFORE any write', () => {
  it('rejects a guardian cancelling an UNLINKED student_id with 404 and performs NO cancel write', async () => {
    // Parent is linked only to LINKED_CHILD_ID, but requests UNLINKED_CHILD_ID.
    listChildrenForGuardian.mockResolvedValue({
      ok: true,
      data: [{ studentId: LINKED_CHILD_ID }],
    });

    const POST = await loadPOST();
    const res = await POST(makeRequest({ student_id: UNLINKED_CHILD_ID }));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Student not found');

    // Ownership check fired with the parent's auth id.
    expect(listChildrenForGuardian).toHaveBeenCalledWith(PARENT_AUTH_ID);

    // CRITICAL: no subscription read, no Razorpay cancel, no RPC, no audit
    // insert — the guard short-circuits before any state-changing work.
    expect(subscriptionsSingle).not.toHaveBeenCalled();
    expect(cancelRazorpaySubscription).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('rejects with the same 404 when the guardian has no links at all (no enumeration signal)', async () => {
    listChildrenForGuardian.mockResolvedValue({ ok: true, data: [] });

    const POST = await loadPOST();
    const res = await POST(makeRequest({ student_id: LINKED_CHILD_ID }));

    expect(res.status).toBe(404);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('allows a guardian cancelling a LINKED student_id — proceeds to the atomic RPC', async () => {
    listChildrenForGuardian.mockResolvedValue({
      ok: true,
      data: [{ studentId: LINKED_CHILD_ID }],
    });

    const POST = await loadPOST();
    const res = await POST(makeRequest({ student_id: LINKED_CHILD_ID, immediate: false }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // It never did a self-lookup (a student_id was supplied).
    expect(studentsSingle).not.toHaveBeenCalled();
    // The atomic cancel ran against the LINKED child, not anyone else.
    expect(rpcMock).toHaveBeenCalledWith('atomic_cancel_subscription', {
      p_student_id: LINKED_CHILD_ID,
      p_immediate: false,
      p_reason: null,
    });
  });
});

describe('POST /api/payments/cancel — self-cancel path', () => {
  it('resolves the caller via students.auth_user_id and cancels their own subscription', async () => {
    // No student_id in the body → self path. Authed as the student themselves.
    mockAuthorizeRequest.mockResolvedValueOnce({
      authorized: true,
      userId: SELF_AUTH_ID,
      roles: ['student'],
      errorResponse: null,
    });
    // SSR client also needs to return SELF_AUTH_ID so the route resolves the
    // correct student row via from('students').eq('auth_user_id', SELF_AUTH_ID).
    ssrGetUser.mockResolvedValue({ data: { user: { id: SELF_AUTH_ID, email: 's@x.com' } } });
    studentsSingle.mockResolvedValue({ data: { id: SELF_STUDENT_ID }, error: null });

    const POST = await loadPOST();
    const res = await POST(makeRequest({ immediate: false }));

    expect(res.status).toBe(200);
    // Guardian-link helper is NOT consulted on the self path.
    expect(listChildrenForGuardian).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith('atomic_cancel_subscription', {
      p_student_id: SELF_STUDENT_ID,
      p_immediate: false,
      p_reason: null,
    });
  });

  it('returns 404 when the caller has no student row (no subscription read, no RPC)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce({
      authorized: true,
      userId: SELF_AUTH_ID,
      roles: ['student'],
      errorResponse: null,
    });
    ssrGetUser.mockResolvedValue({ data: { user: { id: SELF_AUTH_ID, email: 's@x.com' } } });
    studentsSingle.mockResolvedValue({ data: null, error: null });

    const POST = await loadPOST();
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(404);
    expect(subscriptionsSingle).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
