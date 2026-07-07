/**
 * Offline-payment reconciliation action handler tests
 * (Phase 4 / 2026-06-11 — privilege-escalation surface coverage).
 *
 * Pins the PATCH contract for two of the highest-risk uncovered super-admin
 * mutation routes — the point where money actually moves (invoice marked
 * paid + school subscription extended):
 *
 *   src/app/api/super-admin/reconciliation/[id]/approve/route.ts
 *   src/app/api/super-admin/reconciliation/[id]/reject/route.ts
 *
 * Assertions in this file:
 *   1. Auth gate: when `authorizeAdmin` denies, the handler returns the exact
 *      `auth.response` it was handed and performs NO state change (no row read,
 *      no update, no RPC, no audit). This is the 403-below-threshold path.
 *   2. Invalid / non-UUID `[id]` → 400 BEFORE any DB write.
 *   3. On success, an `audit_logs` row is written via `logAdminAudit` with the
 *      spec'd action name (reconciliation.approve / reconciliation.reject) AND
 *      the reconciliation state transition (`status` flip) is applied.
 *   4. Idempotency: re-approving an already-approved row (status !== 'pending')
 *      is rejected at 409 and does NOT double-apply (no second update, no RPC,
 *      no audit row).
 *
 * Mocking style mirrors
 *   src/__tests__/api/super-admin/verification-queue-actions.test.ts
 *   src/__tests__/api/super-admin/plan-change-atomicity.test.ts
 * — chainable getSupabaseAdmin() boundary mock, swap canned result per test,
 * authorizeAdmin / logAdminAudit / isFeatureEnabled stubbed at the module seam.
 *
 * AUTH LEVEL (HIGH finding fixed 2026-06-11): both routes now call
 * `authorizeAdmin(request, 'super_admin')` — the required level is pinned, not
 * defaulted. These are money-movement mutations (invoice marked paid + school
 * subscription extended), so anything below the super_admin floor is a
 * privilege-escalation gap. The previous version of this file deliberately did
 * NOT assert the level because the routes defaulted to the weak 'support' floor;
 * that gap is now closed by backend (approve/route.ts + reject/route.ts) and is
 * locked in here via explicit `toHaveBeenCalledWith(..., 'super_admin')`
 * assertions on both handlers' happy paths.
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

const isFeatureEnabled = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabled(...args),
}));

vi.mock('@alfanumrik/lib/posthog/server', () => ({
  capture: vi.fn(),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Chainable Supabase mock ──────────────────────────────────────────
//
// The approve route does:
//   .from(table).select(...).eq('id', id).maybeSingle()   → row read
//   .from(table).update(payload).eq('id', id).eq('status', 'pending') → flip
//   .rpc('reconcile_payment', { p_reconciliation_id })
// The reject route does:
//   .from(table).select(...).eq('id', id).maybeSingle()   → row read
//   .from(table).update(payload).eq('id', id)             → flip
//
// `.maybeSingle()` resolves to the canned READ result; the terminal update
// chain (`.eq(...)`) resolves via `.then` to the canned UPDATE result.

interface CannedResult {
  data: unknown;
  error: unknown;
}

let readResult: CannedResult = { data: null, error: null };
let updateResult: CannedResult = { data: null, error: null };
let rpcResult: CannedResult = { data: { ok: true }, error: null };

const updateCalls: Array<{ table: string; payload: unknown }> = [];
const rpcCalls: Array<{ fn: string; args: unknown }> = [];

function makeChainable(table: string) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(readResult)),
    update: vi.fn((payload: unknown) => {
      updateCalls.push({ table, payload });
      return chain;
    }),
    // terminal update chain resolves here
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(updateResult).then(resolve),
  };
  return chain;
}

const supabaseStub = {
  from: vi.fn((table: string) => makeChainable(table)),
  rpc: vi.fn((fn: string, args: unknown) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve(rpcResult);
  }),
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => supabaseStub,
  supabaseAdmin: supabaseStub,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────

const UUID = '11111111-1111-4111-8111-111111111111';
const ADMIN_UID = '22222222-2222-4222-8222-222222222222';
const SUBMITTER_UID = '33333333-3333-4333-8333-333333333333';

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

function patchReq(id: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/super-admin/reconciliation/${id}/approve`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  updateCalls.length = 0;
  rpcCalls.length = 0;
  readResult = { data: null, error: null };
  updateResult = { data: null, error: null };
  rpcResult = { data: { ok: true }, error: null };
  // Default: gate denies (most tests opt into AUTH_OK explicitly).
  authorizeAdmin.mockResolvedValue(AUTH_DENIED());
  // Default: flag enabled so non-auth tests reach the handler body.
  isFeatureEnabled.mockResolvedValue(true);
});

// ══════════════════════════════════════════════════════════════════════
//  APPROVE
// ══════════════════════════════════════════════════════════════════════

describe('PATCH reconciliation/[id]/approve — auth gate', () => {
  it('returns the authorizeAdmin denial response (403) and performs NO state change', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { PATCH } = await import('@/app/api/super-admin/reconciliation/[id]/approve/route');

    const res = await PATCH(patchReq(UUID), ctx(UUID));

    expect(res.status).toBe(403);
    // No DB I/O, no money movement, no audit on denial.
    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
    // Feature-flag check never runs because the gate short-circuits first.
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });
});

describe('PATCH reconciliation/[id]/approve — id validation', () => {
  it('returns 400 for a non-UUID id BEFORE any DB write', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { PATCH } = await import('@/app/api/super-admin/reconciliation/[id]/approve/route');

    const res = await PATCH(patchReq('not-a-uuid'), ctx('not-a-uuid'));

    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

describe('PATCH reconciliation/[id]/approve — happy path', () => {
  it('flips status to approved, calls reconcile_payment RPC, and writes a reconciliation.approve audit row', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    // Pending row submitted by a DIFFERENT admin (two-person rule satisfied).
    readResult = {
      data: {
        id: UUID,
        status: 'pending',
        submitted_by_user_id: SUBMITTER_UID,
        school_id: 'school-1',
        invoice_id: 'inv-1',
        received_amount_inr: 5000,
      },
      error: null,
    };
    rpcResult = { data: { reconciled: true }, error: null };

    const { PATCH } = await import('@/app/api/super-admin/reconciliation/[id]/approve/route');
    const res = await PATCH(patchReq(UUID), ctx(UUID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Auth contract pinned (HIGH finding fixed 2026-06-11): money-movement
    // route requires the super_admin level, not the defaulted 'support' floor.
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');

    // State transition: status flipped to 'approved'.
    const flip = updateCalls.find((c) => c.table === 'payment_reconciliation_queue');
    expect(flip).toBeDefined();
    expect(flip!.payload).toEqual(
      expect.objectContaining({ status: 'approved', approved_by_user_id: ADMIN_UID }),
    );

    // Atomic reconciliation RPC fired exactly once.
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      fn: 'reconcile_payment',
      args: { p_reconciliation_id: UUID },
    });

    // Audit row: WHO approved which offline payment.
    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const [adminArg, action, entityType, entityId, details] = logAdminAudit.mock.calls[0];
    expect(adminArg).toMatchObject({ userId: ADMIN_UID });
    expect(action).toBe('reconciliation.approve');
    expect(entityType).toBe('payment_reconciliation_queue');
    expect(entityId).toBe(UUID);
    expect(details).toEqual(
      expect.objectContaining({ submitter_user_id: SUBMITTER_UID, invoice_id: 'inv-1' }),
    );
  });
});

describe('PATCH reconciliation/[id]/approve — idempotency', () => {
  it('re-approving an already-approved row → 409, no second flip, no RPC, no audit (no double-apply)', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    // Row already approved — the route must refuse.
    readResult = {
      data: {
        id: UUID,
        status: 'approved',
        submitted_by_user_id: SUBMITTER_UID,
        school_id: 'school-1',
        invoice_id: 'inv-1',
        received_amount_inr: 5000,
      },
      error: null,
    };

    const { PATCH } = await import('@/app/api/super-admin/reconciliation/[id]/approve/route');
    const res = await PATCH(patchReq(UUID), ctx(UUID));

    expect(res.status).toBe(409);
    // The row was read but NOT mutated again, and the RPC never re-ran.
    expect(updateCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });

  it('blocks the two-person rule: submitter cannot approve their own row → 403, no flip, no RPC', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    // The approving admin IS the submitter.
    readResult = {
      data: {
        id: UUID,
        status: 'pending',
        submitted_by_user_id: ADMIN_UID,
        school_id: 'school-1',
        invoice_id: 'inv-1',
        received_amount_inr: 5000,
      },
      error: null,
    };

    const { PATCH } = await import('@/app/api/super-admin/reconciliation/[id]/approve/route');
    const res = await PATCH(patchReq(UUID), ctx(UUID));

    expect(res.status).toBe(403);
    expect(updateCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════
//  REJECT
// ══════════════════════════════════════════════════════════════════════

function rejectReq(id: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/super-admin/reconciliation/${id}/reject`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : null,
  });
}

describe('PATCH reconciliation/[id]/reject — auth gate', () => {
  it('returns the authorizeAdmin denial response (403) and performs NO state change', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_DENIED());
    const { PATCH } = await import('@/app/api/super-admin/reconciliation/[id]/reject/route');

    const res = await PATCH(rejectReq(UUID, { reason: 'duplicate' }), ctx(UUID));

    expect(res.status).toBe(403);
    expect(supabaseStub.from).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });
});

describe('PATCH reconciliation/[id]/reject — id validation', () => {
  it('returns 400 for a non-UUID id BEFORE any DB write', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { PATCH } = await import('@/app/api/super-admin/reconciliation/[id]/reject/route');

    const res = await PATCH(rejectReq('not-a-uuid', { reason: 'duplicate' }), ctx('not-a-uuid'));

    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

describe('PATCH reconciliation/[id]/reject — payload validation', () => {
  it('returns 400 when reason is missing/empty (no state change)', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    const { PATCH } = await import('@/app/api/super-admin/reconciliation/[id]/reject/route');

    const res = await PATCH(rejectReq(UUID, { reason: '' }), ctx(UUID));

    expect(res.status).toBe(400);
    expect(updateCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});

describe('PATCH reconciliation/[id]/reject — happy path', () => {
  it('flips status to rejected and writes a reconciliation.reject audit row', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    readResult = {
      data: {
        id: UUID,
        status: 'pending',
        submitted_by_user_id: SUBMITTER_UID,
        school_id: 'school-1',
        invoice_id: 'inv-1',
      },
      error: null,
    };
    updateResult = { data: null, error: null };

    const { PATCH } = await import('@/app/api/super-admin/reconciliation/[id]/reject/route');
    const reason = 'amount mismatch with bank statement';
    const res = await PATCH(rejectReq(UUID, { reason }), ctx(UUID));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Auth contract pinned (HIGH finding fixed 2026-06-11): money-movement
    // route requires the super_admin level, not the defaulted 'support' floor.
    expect(authorizeAdmin).toHaveBeenCalledWith(expect.anything(), 'super_admin');

    const flip = updateCalls.find((c) => c.table === 'payment_reconciliation_queue');
    expect(flip).toBeDefined();
    expect(flip!.payload).toEqual(
      expect.objectContaining({
        status: 'rejected',
        rejected_by_user_id: ADMIN_UID,
        rejection_reason: reason,
      }),
    );

    expect(logAdminAudit).toHaveBeenCalledTimes(1);
    const [adminArg, action, entityType, entityId, details] = logAdminAudit.mock.calls[0];
    expect(adminArg).toMatchObject({ userId: ADMIN_UID });
    expect(action).toBe('reconciliation.reject');
    expect(entityType).toBe('payment_reconciliation_queue');
    expect(entityId).toBe(UUID);
    expect(details).toEqual(expect.objectContaining({ reason, prior_status: 'pending' }));
  });
});

describe('PATCH reconciliation/[id]/reject — idempotency / terminal states', () => {
  it('rejecting an already-rejected row → 409, no second flip, no audit (no double-apply)', async () => {
    authorizeAdmin.mockResolvedValue(AUTH_OK);
    readResult = {
      data: {
        id: UUID,
        status: 'rejected',
        submitted_by_user_id: SUBMITTER_UID,
        school_id: 'school-1',
        invoice_id: 'inv-1',
      },
      error: null,
    };

    const { PATCH } = await import('@/app/api/super-admin/reconciliation/[id]/reject/route');
    const res = await PATCH(rejectReq(UUID, { reason: 'already handled' }), ctx(UUID));

    expect(res.status).toBe(409);
    expect(updateCalls).toHaveLength(0);
    expect(logAdminAudit).not.toHaveBeenCalled();
  });
});
