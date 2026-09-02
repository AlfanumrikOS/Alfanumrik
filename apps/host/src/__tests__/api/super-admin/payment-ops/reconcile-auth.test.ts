/**
 * Payment-ops reconcile auth-level pin (CEO-approved money-route tightening,
 * 2026-06-11).
 *
 * src/app/api/super-admin/payment-ops/reconcile/route.ts POST (line ~170) is
 * the P0 of this batch: it grants paid student entitlement for a single
 * stuck payment OR — with `{ all: true }` — for EVERY stuck payment in one
 * batch. A support-tier admin reaching this handler could mass-grant paid
 * plans for free, so the required level was raised from the defaulted
 * 'support' floor to 'super_admin'.
 *
 * P1-5 fix (2026-09-02 launch audit): entitlement is no longer granted via
 * two independent raw writes (students.update + student_subscriptions.upsert)
 * — that shape could itself create a split-brain if the second write failed
 * after the first succeeded. It now goes through the SAME single-transaction,
 * per-student-locked `atomic_subscription_activation_locked` RPC the webhook
 * and the reconcile cron use (packages/lib/src/reconcile-stuck-payments.ts).
 * This file's assertions were updated to match: the success-path check now
 * pins the RPC call and its args instead of the old updateCalls/upsertCalls
 * shape.
 *
 * This file pins the contract:
 *   1. Denial path: when `authorizeAdmin` denies, the handler returns that exact
 *      response and performs ZERO state change — no RPC call, no
 *      payment_history update, no ops event, no admin audit. Asserted for
 *      BOTH the single `{ studentId, paymentId }` and batch `{ all: true }`
 *      bodies (the batch path is the dangerous one).
 *   2. Level pin: on the success path, authorizeAdmin is called with
 *      'super_admin' as the second arg.
 *
 * Mocking mirrors reconciliation-actions.test.ts — module-seam mock of
 * @alfanumrik/lib/admin-auth (authorizeAdmin / logAdminAudit), plus a chainable
 * supabase-admin boundary mock. This route uses the `supabaseAdmin` singleton
 * (NOT getSupabaseAdmin()) and `logOpsEvent`, so both seams are stubbed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// ─── Module mocks (hoisted before route import) ───────────────────────

const authorizeAdmin = vi.fn();
const logAdminAudit = vi.fn().mockResolvedValue(undefined);

vi.mock('@alfanumrik/lib/admin-auth', () => ({
  authorizeAdmin: (...args: unknown[]) => authorizeAdmin(...args),
  logAdminAudit: (...args: unknown[]) => logAdminAudit(...args),
}));

const logOpsEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...args: unknown[]) => logOpsEvent(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Chainable supabase-admin (singleton) mock ────────────────────────
//
// The route does, per stuck payment (via reconcileStuckPayment):
//   .rpc('atomic_subscription_activation_locked', {...})         → entitlement grant (single tx)
//   .from('payment_history').update({reconciled_at}).eq('id', x) → best-effort stamp
// and for single mode, first:
//   .from('payment_history').select(...).eq().eq().eq().maybeSingle()
//
// We record every rpc/update so the denial tests can assert zero writes.

interface CannedResult {
  data: unknown;
  error: unknown;
}

let paymentReadResult: CannedResult = { data: null, error: null };
let planReadResult: CannedResult = { data: { id: 'plan-1' }, error: null };

const updateCalls: Array<{ table: string; payload: unknown }> = [];
const upsertCalls: Array<{ table: string; payload: unknown }> = [];
const rpcCalls: Array<{ name: string; params: unknown }> = [];

function makeChainable(table: string) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => Promise.resolve({ data: [], error: null })),
    limit: vi.fn(() => chain),
    maybeSingle: vi.fn(() =>
      Promise.resolve(table === 'subscription_plans' ? planReadResult : paymentReadResult),
    ),
    update: vi.fn((payload: unknown) => {
      updateCalls.push({ table, payload });
      return chain;
    }),
    upsert: vi.fn((payload: unknown) => {
      upsertCalls.push({ table, payload });
      return chain;
    }),
    // terminal .eq() after update resolves here
    then: (resolve: (r: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  };
  return chain;
}

const supabaseStub = {
  from: vi.fn((table: string) => makeChainable(table)),
  rpc: vi.fn((name: string, params: unknown) => {
    rpcCalls.push({ name, params });
    return Promise.resolve({ data: null, error: null });
  }),
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => supabaseStub,
  supabaseAdmin: supabaseStub,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────

const UUID = '11111111-1111-4111-8111-111111111111';
const STUDENT_UID = '33333333-3333-4333-8333-333333333333';
const ADMIN_UID = '22222222-2222-4222-8222-222222222222';

const AUTH_OK = {
  authorized: true as const,
  userId: ADMIN_UID,
  adminId: 'admin-row-id',
  email: 'admin@test.com',
  name: 'Test Admin',
  adminLevel: 'super_admin',
};

const AUTH_DENIED = () => ({
  authorized: false as const,
  response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
});

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/super-admin/payment-ops/reconcile', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  upsertCalls.length = 0;
  rpcCalls.length = 0;
  paymentReadResult = { data: null, error: null };
  planReadResult = { data: { id: 'plan-1' }, error: null };
  authorizeAdmin.mockResolvedValue(AUTH_DENIED());
});

// ══════════════════════════════════════════════════════════════════════
//  Denial path — no entitlement granted
// ══════════════════════════════════════════════════════════════════════

describe('POST payment-ops/reconcile — auth gate (single)', () => {
  it('returns the authorizeAdmin denial (403) and grants NO entitlement', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/payment-ops/reconcile/route');

    const res = await POST(postReq({ studentId: STUDENT_UID, paymentId: UUID }));

    expect(res.status).toBe(403);
    // No money movement on denial.
    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(supabaseStub.rpc).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(logOpsEvent).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

describe('POST payment-ops/reconcile — auth gate (batch all:true)', () => {
  it('returns the authorizeAdmin denial (403) and grants NO entitlement to ANY student', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/payment-ops/reconcile/route');

    // The dangerous body: a support-tier admin could otherwise mass-grant.
    const res = await POST(postReq({ all: true }));

    expect(res.status).toBe(403);
    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(supabaseStub.rpc).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0); // no atomic_subscription_activation_locked
    expect(logOpsEvent).not.toHaveBeenCalled();
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  Level pin — super_admin required
// ══════════════════════════════════════════════════════════════════════

describe('POST payment-ops/reconcile — required level', () => {
  it('calls authorizeAdmin with super_admin and grants entitlement on the single happy path', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    paymentReadResult = {
      data: {
        id: UUID,
        student_id: STUDENT_UID,
        plan_code: 'premium',
        billing_cycle: 'monthly',
        razorpay_payment_id: 'pay_abc',
        razorpay_order_id: 'order_abc',
        created_at: '2026-06-01T00:00:00.000Z',
      },
      error: null,
    };

    const { POST } = await import('@/app/api/super-admin/payment-ops/reconcile/route');
    const res = await POST(postReq({ studentId: STUDENT_UID, paymentId: UUID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Auth contract pinned: money-movement route requires super_admin, not the
    // defaulted 'support' floor.
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');

    // Entitlement actually granted on the success path, via the single
    // atomic per-student-locked RPC (P1-5 fix) — not raw students/
    // student_subscriptions writes, which this route no longer performs.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('atomic_subscription_activation_locked');
    expect(rpcCalls[0].params).toMatchObject({
      p_student_id: STUDENT_UID,
      p_plan_code: 'premium',
      p_billing_cycle: 'monthly',
      p_razorpay_payment_id: 'pay_abc',
      p_razorpay_subscription_id: null,
    });
    expect(updateCalls.some((c) => c.table === 'students')).toBe(false);
    expect(upsertCalls.some((c) => c.table === 'student_subscriptions')).toBe(false);
  });
});
