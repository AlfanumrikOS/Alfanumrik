/**
 * /api/parent/billing — contract & ownership tests (Phase C.4).
 *
 * Pins:
 *   1. Calls authorizeRequest with the parent-scoped permission.
 *   2. Returns 403 when there is no guardian record for the caller (no
 *      cross-role leakage).
 *   3. Free-tier zero-state: guardian with no linked children gets 200 +
 *      empty arrays so the UI can render the link-a-child CTA instead of
 *      erroring.
 *   4. Per-child shape: each linked child appears in `children[]`, with
 *      plan_name resolved from subscription_plans + status flags set.
 *   5. Cross-parent isolation: the route only fetches subscriptions for
 *      students returned by listChildrenForGuardian. A second parent's
 *      students never appear in the response, even if the DB held those
 *      rows in the same student_subscriptions table.
 *   6. Payment history is bounded to the caller's children only.
 *   7. The summary roll-up counts active subs and total monthly spend,
 *      and flags grace / cancel-scheduled states.
 *   8. Source-level contract: route file uses authorizeRequest and the
 *      `child.view_progress` permission (parents inherit this scope).
 *   9. Source-level contract: route file does NOT call out to
 *      /api/payments/* — cancel/upgrade flows live there and the parent
 *      billing route is read-only.
 *  10. Internal error path returns 500 (not 200 with junk data).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── Mock state holders ────────────────────────────────────────────────────
// All mock state lives behind getters / lazily-evaluated closures so the
// vi.mock factories below (which are hoisted to the top of the module)
// don't capture undefined references.
interface MockState {
  subscriptions?: Array<Record<string, unknown>>;
  plans?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
  subscriptionsError?: { message: string } | null;
  paymentsError?: { message: string } | null;
}

// Hoisted holders so the vi.mock() factories (themselves hoisted) can
// reference them safely. The fns + state object are created in the
// hoisted block so they exist before the route module is evaluated.
const holders = vi.hoisted(() => ({
  mockAuthorize: ((..._a: unknown[]): unknown => undefined) as ((..._a: unknown[]) => unknown) & { mockReset?: () => void },
  mockGetGuardian: ((..._a: unknown[]): unknown => undefined) as (..._a: unknown[]) => unknown,
  mockListChildren: ((..._a: unknown[]): unknown => undefined) as (..._a: unknown[]) => unknown,
  mockState: {} as {
    subscriptions?: Array<Record<string, unknown>>;
    plans?: Array<Record<string, unknown>>;
    payments?: Array<Record<string, unknown>>;
    subscriptionsError?: { message: string } | null;
    paymentsError?: { message: string } | null;
  },
}));

const mockAuthorize = vi.fn();
const mockGetGuardian = vi.fn();
const mockListChildren = vi.fn();
// Wire the vi.fn() spies in as the implementations the hoisted mocks call.
holders.mockAuthorize = mockAuthorize as unknown as typeof holders.mockAuthorize;
holders.mockGetGuardian = mockGetGuardian;
holders.mockListChildren = mockListChildren;
const mockState = holders.mockState;

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
  logAudit: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: vi.fn(() => []),
    setAll: vi.fn(),
  })),
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  const chain = {
    from(table: string) {
      if (table === 'student_subscriptions') {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => {
              if (holders.mockState.subscriptionsError) {
                return Promise.resolve({ data: null, error: holders.mockState.subscriptionsError });
              }
              const rows = (holders.mockState.subscriptions ?? []).filter((r) =>
                ids.includes(r.student_id as string)
              );
              return Promise.resolve({ data: rows, error: null });
            },
          }),
        };
      }
      if (table === 'subscription_plans') {
        return {
          select: () => ({
            in: (_col: string, codes: string[]) => {
              const rows = (holders.mockState.plans ?? []).filter((r) =>
                codes.includes(r.plan_code as string)
              );
              return Promise.resolve({ data: rows, error: null });
            },
          }),
        };
      }
      if (table === 'payment_history') {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => ({
              order: () => ({
                limit: () => {
                  if (holders.mockState.paymentsError) {
                    return Promise.resolve({ data: null, error: holders.mockState.paymentsError });
                  }
                  const rows = (holders.mockState.payments ?? []).filter((r) =>
                    ids.includes(r.student_id as string)
                  );
                  return Promise.resolve({ data: rows, error: null });
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`unmocked table: ${table}`);
    },
  };
  return { supabaseAdmin: chain };
});

vi.mock('@supabase/ssr', () => {
  const chain = {
    from(table: string) {
      if (table === 'student_subscriptions') {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => {
              if (holders.mockState.subscriptionsError) {
                return Promise.resolve({ data: null, error: holders.mockState.subscriptionsError });
              }
              const rows = (holders.mockState.subscriptions ?? []).filter((r) =>
                ids.includes(r.student_id as string)
              );
              return Promise.resolve({ data: rows, error: null });
            },
          }),
        };
      }
      if (table === 'subscription_plans') {
        return {
          select: () => ({
            in: (_col: string, codes: string[]) => {
              const rows = (holders.mockState.plans ?? []).filter((r) =>
                codes.includes(r.plan_code as string)
              );
              return Promise.resolve({ data: rows, error: null });
            },
          }),
        };
      }
      if (table === 'payment_history') {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => ({
              order: () => ({
                limit: () => {
                  if (holders.mockState.paymentsError) {
                    return Promise.resolve({ data: null, error: holders.mockState.paymentsError });
                  }
                  const rows = (holders.mockState.payments ?? []).filter((r) =>
                    ids.includes(r.student_id as string)
                  );
                  return Promise.resolve({ data: rows, error: null });
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`unmocked table: ${table}`);
    },
  };
  return { createServerClient: vi.fn(() => chain) };
});
vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getGuardianByAuthUserId: (...a: unknown[]) => holders.mockGetGuardian(...a),
}));
vi.mock('@alfanumrik/lib/domains/relationship', () => ({
  listChildrenForGuardian: (...a: unknown[]) => holders.mockListChildren(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { GET } from '@/app/api/parent/billing/route';

const GUARDIAN_ID = '00000000-0000-0000-0000-00000000aaaa';
const AUTH_USER_ID = '00000000-0000-0000-0000-00000000bbbb';
const STUDENT_A = '11111111-1111-1111-1111-111111111111';
const STUDENT_B = '22222222-2222-2222-2222-222222222222';
const OTHER_STUDENT = '99999999-9999-9999-9999-999999999999';

function makeRequest(): Request {
  return new Request('http://localhost/api/parent/billing', {
    method: 'GET',
    headers: { Authorization: 'Bearer fake.jwt.token' },
  });
}

function authAsParent() {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: null,
    roles: ['parent'],
    permissions: ['child.view_progress'],
  });
}

function asGuardian() {
  mockGetGuardian.mockResolvedValue({
    ok: true,
    data: { id: GUARDIAN_ID, authUserId: AUTH_USER_ID, name: 'Test Parent', email: 'p@x.com', phone: null },
  });
}

function withChildren(children: Array<{ studentId: string; name: string; grade?: string }>) {
  mockListChildren.mockResolvedValue({
    ok: true,
    data: children.map((c) => ({
      studentId: c.studentId,
      name: c.name,
      grade: c.grade ?? '8',
      schoolId: null,
      linkId: `link-${c.studentId}`,
      linkStatus: 'active',
      linkedAt: '2026-05-01T00:00:00.000Z',
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mock state in-place — `mockState` is a const reference held by
  // both this test file and the hoisted vi.mock factories.
  delete mockState.subscriptions;
  delete mockState.plans;
  delete mockState.payments;
  delete mockState.subscriptionsError;
  delete mockState.paymentsError;
});

describe('GET /api/parent/billing — auth & ownership', () => {
  it('returns the authorizeRequest errorResponse when not authorized', async () => {
    mockAuthorize.mockResolvedValue({
      authorized: false,
      userId: null,
      studentId: null,
      roles: [],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 403 when the authenticated user has no guardian record (not a parent)', async () => {
    authAsParent();
    mockGetGuardian.mockResolvedValue({ ok: true, data: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/parent/i);
  });

  it('asks authorizeRequest for the parent-scoped permission', async () => {
    authAsParent();
    asGuardian();
    withChildren([]);
    await GET(makeRequest());
    expect(mockAuthorize).toHaveBeenCalledTimes(1);
    const [, perm] = mockAuthorize.mock.calls[0];
    expect(perm).toBe('child.view_progress');
  });
});

describe('GET /api/parent/billing — zero-state (free tier / no children)', () => {
  it('returns 200 with empty children + empty payments when no children are linked', async () => {
    authAsParent();
    asGuardian();
    withChildren([]);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.children).toEqual([]);
    expect(body.data.payment_history).toEqual([]);
    expect(body.data.summary.total_active_subscriptions).toBe(0);
    expect(body.data.summary.total_monthly_spend_inr).toBe(0);
  });

  it('represents a linked free-tier child as plan_code=free with zero price', async () => {
    authAsParent();
    asGuardian();
    withChildren([{ studentId: STUDENT_A, name: 'Aanya' }]);
    mockState.subscriptions = []; // No row → free
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.children).toHaveLength(1);
    expect(body.data.children[0]).toMatchObject({
      student_id: STUDENT_A,
      plan_code: 'free',
      price_inr: 0,
      is_in_grace: false,
      is_cancel_scheduled: false,
    });
    expect(body.data.summary.total_active_subscriptions).toBe(0);
  });
});

describe('GET /api/parent/billing — per-child attribution', () => {
  it('joins each child with their subscription row and plan display name', async () => {
    authAsParent();
    asGuardian();
    withChildren([
      { studentId: STUDENT_A, name: 'Aanya' },
      { studentId: STUDENT_B, name: 'Bhuvan' },
    ]);
    mockState.subscriptions = [
      {
        id: 'sub-a',
        student_id: STUDENT_A,
        plan_code: 'pro',
        status: 'active',
        billing_cycle: 'monthly',
        auto_renew: true,
        current_period_start: '2026-05-01T00:00:00.000Z',
        current_period_end: '2026-06-01T00:00:00.000Z',
        next_billing_at: '2026-06-01T00:00:00.000Z',
        grace_period_end: null,
        cancelled_at: null,
        cancel_reason: null,
        amount_paid: 499,
        razorpay_subscription_id: 'sub_rzp_a',
      },
    ];
    mockState.plans = [
      { plan_code: 'pro', name: 'Pro', price_monthly: 499, price_yearly: 4990 },
    ];

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.children).toHaveLength(2);

    const aanya = body.data.children.find((c: { student_id: string }) => c.student_id === STUDENT_A);
    expect(aanya).toMatchObject({
      plan_code: 'pro',
      plan_name: 'Pro',
      status: 'active',
      billing_cycle: 'monthly',
      price_inr: 499,
      razorpay_subscription_id: 'sub_rzp_a',
    });

    // Bhuvan has no subscription row → free
    const bhuvan = body.data.children.find((c: { student_id: string }) => c.student_id === STUDENT_B);
    expect(bhuvan.plan_code).toBe('free');

    expect(body.data.summary.total_active_subscriptions).toBe(1);
    expect(body.data.summary.total_monthly_spend_inr).toBe(499);
  });

  it('flags an in-grace subscription and exposes it in the summary roll-up', async () => {
    authAsParent();
    asGuardian();
    withChildren([{ studentId: STUDENT_A, name: 'Aanya' }]);
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    mockState.subscriptions = [
      {
        id: 'sub-a',
        student_id: STUDENT_A,
        plan_code: 'pro',
        status: 'past_due',
        billing_cycle: 'monthly',
        auto_renew: true,
        current_period_start: '2026-04-01T00:00:00.000Z',
        current_period_end: '2026-05-01T00:00:00.000Z',
        next_billing_at: null,
        grace_period_end: future,
        cancelled_at: null,
        cancel_reason: null,
        amount_paid: 499,
        razorpay_subscription_id: 'sub_rzp_a',
      },
    ];
    mockState.plans = [
      { plan_code: 'pro', name: 'Pro', price_monthly: 499, price_yearly: 4990 },
    ];

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.data.children[0].is_in_grace).toBe(true);
    expect(body.data.summary.any_in_grace).toBe(true);
  });

  it('flags a cancel-scheduled subscription (active + cancelled_at set)', async () => {
    authAsParent();
    asGuardian();
    withChildren([{ studentId: STUDENT_A, name: 'Aanya' }]);
    mockState.subscriptions = [
      {
        id: 'sub-a',
        student_id: STUDENT_A,
        plan_code: 'pro',
        status: 'active',
        billing_cycle: 'monthly',
        auto_renew: false,
        current_period_start: '2026-05-01T00:00:00.000Z',
        current_period_end: '2026-06-01T00:00:00.000Z',
        next_billing_at: null,
        grace_period_end: null,
        cancelled_at: '2026-05-15T00:00:00.000Z',
        cancel_reason: 'user_request',
        amount_paid: 499,
        razorpay_subscription_id: 'sub_rzp_a',
      },
    ];
    mockState.plans = [
      { plan_code: 'pro', name: 'Pro', price_monthly: 499, price_yearly: 4990 },
    ];

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.data.children[0].is_cancel_scheduled).toBe(true);
    expect(body.data.summary.any_cancel_scheduled).toBe(true);
  });
});

describe('GET /api/parent/billing — cross-parent isolation', () => {
  it('never returns subscription rows for students not linked to the caller', async () => {
    authAsParent();
    asGuardian();
    withChildren([{ studentId: STUDENT_A, name: 'Aanya' }]);
    // Database has subscriptions for both our child AND another parent's child.
    // The mock honors `.in('student_id', ids)`, so the chain only sees STUDENT_A
    // rows — proving the route never asks for OTHER_STUDENT.
    mockState.subscriptions = [
      {
        id: 'sub-a',
        student_id: STUDENT_A,
        plan_code: 'pro',
        status: 'active',
        billing_cycle: 'monthly',
        auto_renew: true,
        current_period_end: '2026-06-01T00:00:00.000Z',
        next_billing_at: '2026-06-01T00:00:00.000Z',
        grace_period_end: null,
        cancelled_at: null,
        amount_paid: 499,
        razorpay_subscription_id: 'sub_rzp_a',
      },
      {
        id: 'sub-other',
        student_id: OTHER_STUDENT,
        plan_code: 'pro',
        status: 'active',
        billing_cycle: 'monthly',
        auto_renew: true,
        current_period_end: '2026-06-01T00:00:00.000Z',
        next_billing_at: null,
        grace_period_end: null,
        cancelled_at: null,
        amount_paid: 499,
        razorpay_subscription_id: 'sub_rzp_other',
      },
    ];
    mockState.plans = [
      { plan_code: 'pro', name: 'Pro', price_monthly: 499, price_yearly: 4990 },
    ];
    mockState.payments = [
      {
        id: 'pay-a',
        student_id: STUDENT_A,
        amount: 499,
        currency: 'INR',
        status: 'captured',
        plan_code: 'pro',
        billing_cycle: 'monthly',
        razorpay_payment_id: 'pay_rzp_a',
        razorpay_order_id: 'ord_rzp_a',
        created_at: '2026-05-01T00:00:00.000Z',
      },
      {
        id: 'pay-other',
        student_id: OTHER_STUDENT,
        amount: 499,
        currency: 'INR',
        status: 'captured',
        plan_code: 'pro',
        billing_cycle: 'monthly',
        razorpay_payment_id: 'pay_rzp_other',
        razorpay_order_id: 'ord_rzp_other',
        created_at: '2026-05-02T00:00:00.000Z',
      },
    ];

    const res = await GET(makeRequest());
    const body = await res.json();

    // The other parent's row must NOT appear in the response.
    const studentIds = body.data.children.map((c: { student_id: string }) => c.student_id);
    expect(studentIds).toContain(STUDENT_A);
    expect(studentIds).not.toContain(OTHER_STUDENT);

    const paymentStudentIds = body.data.payment_history.map(
      (p: { student_id: string }) => p.student_id
    );
    expect(paymentStudentIds).toContain(STUDENT_A);
    expect(paymentStudentIds).not.toContain(OTHER_STUDENT);
  });
});

describe('GET /api/parent/billing — error handling', () => {
  it('returns 500 when the subscriptions query fails (no silent success)', async () => {
    authAsParent();
    asGuardian();
    withChildren([{ studentId: STUDENT_A, name: 'Aanya' }]);
    mockState.subscriptionsError = { message: 'connection reset' };
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});

// ─── Source-level contract guards ────────────────────────────────────────
//
// These are static checks that protect against accidental regressions
// (e.g. someone bypasses authorizeRequest or introduces a parallel
// payment endpoint inside the parent route).

describe('GET /api/parent/billing — source-level contract', () => {
  it('uses authorizeRequest with child.view_progress permission', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/app/api/parent/billing/route.ts'),
      'utf8'
    );
    expect(src).toMatch(/authorizeRequest\([^)]*['"]child\.view_progress['"]\s*\)/);
  });

  it('does not call /api/payments/* itself — cancel/upgrade are reused, not duplicated', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/app/api/parent/billing/route.ts'),
      'utf8'
    );
    // The parent billing route is read-only; it must not initiate or
    // cancel a Razorpay subscription itself. Those operations live at
    // /api/payments/subscribe and /api/payments/cancel.
    expect(src).not.toMatch(/createRazorpaySubscription/);
    expect(src).not.toMatch(/cancelRazorpaySubscription/);
    expect(src).not.toMatch(/createRazorpayOrder/);
  });

  it('runs billing aggregation reads through an RLS-scoped request client', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/app/api/parent/billing/route.ts'),
      'utf8'
    );
    expect(src).not.toContain('@alfanumrik/lib/supabase-admin');
    expect(src).toContain('@supabase/ssr');
    expect(src).toContain('createServerClient');
    expect(src).toContain('Authorization');
  });

  it('exports only GET — no POST/PATCH/DELETE writes from this route', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/app/api/parent/billing/route.ts'),
      'utf8'
    );
    expect(src).toMatch(/export\s+async\s+function\s+GET\b/);
    expect(src).not.toMatch(/export\s+async\s+function\s+POST\b/);
    expect(src).not.toMatch(/export\s+async\s+function\s+PATCH\b/);
    expect(src).not.toMatch(/export\s+async\s+function\s+DELETE\b/);
  });
});
