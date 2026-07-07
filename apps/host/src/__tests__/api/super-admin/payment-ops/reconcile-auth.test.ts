/**
 * Payment-ops reconcile auth-level pin (CEO-approved money-route tightening,
 * 2026-06-11).
 *
 * src/app/api/super-admin/payment-ops/reconcile/route.ts POST (line ~170) is
 * the P0 of this batch: it grants paid student entitlement (students.update +
 * student_subscriptions.upsert + audit) for a single stuck payment OR — with
 * `{ all: true }` — for EVERY stuck payment in one batch. A support-tier admin
 * reaching this handler could mass-grant paid plans for free, so the required
 * level was raised from the defaulted 'support' floor to 'super_admin'.
 *
 * This file pins that contract:
 *   1. Denial path: when `authorizeAdmin` denies, the handler returns that exact
 *      response and performs ZERO state change — no students.update, no
 *      student_subscriptions.upsert, no ops event, no admin audit. Asserted for
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
// The route does, per stuck payment:
//   .from('students').update(payload).eq('id', sid)              → entitlement grant
//   .from('subscription_plans').select(...).eq(...).limit().maybeSingle()
//   .from('student_subscriptions').upsert(payload, opts)         → sub grant
// and for single mode:
//   .from('payment_history').select(...).eq().eq().eq().maybeSingle()
//
// We record every update/upsert so the denial tests can assert zero writes.

interface CannedResult {
  data: unknown;
  error: unknown;
}

let paymentReadResult: CannedResult = { data: null, error: null };
let planReadResult: CannedResult = { data: { id: 'plan-1' }, error: null };

const updateCalls: Array<{ table: string; payload: unknown }> = [];
const upsertCalls: Array<{ table: string; payload: unknown }> = [];

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
    expect(updateCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
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
    expect(updateCalls).toHaveLength(0); // no students.update
    expect(upsertCalls).toHaveLength(0); // no student_subscriptions.upsert
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

    // Entitlement actually granted on the success path.
    expect(updateCalls.some((c) => c.table === 'students')).toBe(true);
    expect(upsertCalls.some((c) => c.table === 'student_subscriptions')).toBe(true);
  });
});
