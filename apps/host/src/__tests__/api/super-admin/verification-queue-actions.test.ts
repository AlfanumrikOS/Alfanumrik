/**
 * Verification-queue action handler contract tests.
 *
 * Pins the POST contract for
 *   src/app/api/super-admin/grounding/verification-queue/route.ts
 *
 * Covers the three operator actions surfaced in
 * src/app/super-admin/grounding/verification-queue/page.tsx:
 *   - re-verify           (resets verification_state on a question_bank row)
 *   - soft-delete         (sets deleted_at on a question_bank row)
 *   - enable-enforcement  (UPSERTs ff_grounded_ai_enforced_pairs;
 *                          requires server-recomputed verified_ratio >= 0.9)
 *
 * Assertions in this file:
 *   1. 401 when caller is not super-admin (auth gate denies before any DB I/O).
 *   2. 200 happy path for each of the three actions.
 *   3. enable-enforcement REFUSES (400, no upsert, no ops_events) when the
 *      server-recomputed verified_ratio is below the 0.9 threshold — the
 *      client cannot bypass with a stale value.
 *   4. Each successful action records an admin_audit_log row via
 *      logAdminAuditByUserId() with the audit action names from the spec:
 *        - question.reverify_requested
 *        - question.soft_deleted
 *        - question_bank.enforcement_enabled
 *
 * Mocking style mirrors src/__tests__/super-admin-grounding-post-handlers.test.ts
 * — chainable supabase boundary mock, swap canned result per test. Wider
 * coverage of edge cases (malformed UUIDs, invalid grade enum, integer
 * grade rejection, etc.) lives in that sibling file; here we focus on the
 * task-spec contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────

const mockAuthorizeRequest = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: mockAuthorizeRequest,
}));

const mockLogOpsEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...args: unknown[]) => mockLogOpsEvent(...args),
}));

// admin-auth mock stubs logAdminAuditByUserId so the fire-and-forget audit
// promise resolves cleanly (vitest workers complain about unhandled
// rejections during teardown otherwise). We assert the call arguments
// directly via this spy.
const mockLogAdminAuditByUserId = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/admin-auth', () => ({
  logAdminAuditByUserId: (...args: unknown[]) => mockLogAdminAuditByUserId(...args),
}));

// ─── Chainable Supabase mock ──────────────────────────────────────────
//
// Each call to `from(table)` returns a fresh chain that records terminal
// writes (`.update(payload)` and `.upsert(payload, options)`) and resolves
// the awaited query with whatever `setResult(...)` last canned.
//
// The route reads question_bank rows via `.select().eq().is().limit()`
// then awaits the chain — `.then` resolves with `{ data, error }`. The
// `.update(...).eq().is()` chain also resolves via `.then` to
// `{ data: null, error }`.

interface QueryResult {
  data: unknown;
  error: unknown;
  count?: number;
}

let supabaseResult: QueryResult = { data: [], error: null };

function setResult(r: Partial<QueryResult>) {
  supabaseResult = { data: r.data ?? [], error: r.error ?? null, count: r.count };
}

const updateCalls: Array<{ table: string; payload: unknown }> = [];
const upsertCalls: Array<{ table: string; payload: unknown; options?: unknown }> = [];

function makeChainable(table: string) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    gte: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    in: vi.fn(() => chain),
    is: vi.fn(() => chain),
    not: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    update: vi.fn((payload: unknown) => {
      updateCalls.push({ table, payload });
      return chain;
    }),
    upsert: vi.fn((payload: unknown, options?: unknown) => {
      upsertCalls.push({ table, payload, options });
      return chain;
    }),
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(supabaseResult).then(resolve),
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => makeChainable(table)),
  },
  getSupabaseAdmin: () => ({
    from: vi.fn((table: string) => makeChainable(table)),
  }),
}));

// ─── Auth fixtures ────────────────────────────────────────────────────

const ADMIN_UID = '11111111-1111-1111-1111-111111111111';
const AUTH_OK = {
  authorized: true as const,
  userId: ADMIN_UID,
  studentId: null,
  roles: ['super_admin'],
  permissions: ['super_admin.access'],
};

const AUTH_DENIED = () => ({
  authorized: false as const,
  userId: null,
  studentId: null,
  roles: [],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  }),
});

const URL_BASE = 'http://localhost/api/super-admin/grounding/verification-queue';

function postRequest(body: unknown): Request {
  return new Request(URL_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setResult({ data: [], error: null, count: 0 });
  updateCalls.length = 0;
  upsertCalls.length = 0;
});

// ─── 1. 401 when not super-admin ──────────────────────────────────────

describe('POST verification-queue — auth gate', () => {
  it('returns 401 when caller is not super-admin (re-verify)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await POST(
      postRequest({ action: 're-verify', payload: { id: '22222222-2222-2222-2222-222222222222' } }) as never,
    );
    expect(res.status).toBe(401);
    // Confirms the gate ran before any DB / audit side-effects.
    expect(updateCalls).toHaveLength(0);
    expect(upsertCalls).toHaveLength(0);
    expect(mockLogOpsEvent).not.toHaveBeenCalled();
    expect(mockLogAdminAuditByUserId).not.toHaveBeenCalled();
  });

  it('returns 401 when caller is not super-admin (soft-delete)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await POST(
      postRequest({ action: 'soft-delete', payload: { id: '22222222-2222-2222-2222-222222222222' } }) as never,
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when caller is not super-admin (enable-enforcement)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await POST(
      postRequest({
        action: 'enable-enforcement',
        payload: { grade: '10', subject_code: 'science' },
      }) as never,
    );
    expect(res.status).toBe(401);
  });

  it('asks authorizeRequest for the super_admin.access permission', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult({ data: null, error: null });
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    await POST(
      postRequest({ action: 're-verify', payload: { id: '22222222-2222-2222-2222-222222222222' } }) as never,
    );
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'super_admin.access');
  });
});

// ─── 2. 200 happy path per action + audit row recorded ────────────────

describe('POST verification-queue — re-verify', () => {
  it('returns 200, updates question_bank, and writes question.reverify_requested audit row', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult({ data: null, error: null });
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');

    const rowId = '22222222-2222-2222-2222-222222222222';
    const res = await POST(postRequest({ action: 're-verify', payload: { id: rowId } }) as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ success: true }));
    expect(body.data).toEqual(expect.objectContaining({ action: 're-verify', id: rowId }));

    // DB write: verification_state reset so the worker re-picks the row.
    const qbUpdate = updateCalls.find((c) => c.table === 'question_bank');
    expect(qbUpdate).toBeDefined();
    expect(qbUpdate!.payload).toEqual(
      expect.objectContaining({
        verification_state: 'legacy_unverified',
        verification_claimed_by: null,
        verification_claim_expires_at: null,
        verifier_failure_reason: null,
      }),
    );

    // Audit row recorded with the spec'd action name.
    expect(mockLogAdminAuditByUserId).toHaveBeenCalledTimes(1);
    expect(mockLogAdminAuditByUserId).toHaveBeenCalledWith(
      ADMIN_UID,
      'question.reverify_requested',
      'question_bank',
      rowId,
      expect.objectContaining({ action: 're-verify' }),
      undefined,
    );
  });
});

describe('POST verification-queue — soft-delete', () => {
  it('returns 200, sets deleted_at, and writes question.soft_deleted audit row', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult({ data: null, error: null });
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');

    const rowId = '33333333-3333-3333-3333-333333333333';
    const reason = 'NCERT mismatch — duplicate of Ch3 Q12';
    const res = await POST(
      postRequest({ action: 'soft-delete', payload: { id: rowId, reason } }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ success: true }));

    // DB write: deleted_at is set to an ISO timestamp.
    const qbUpdate = updateCalls.find((c) => c.table === 'question_bank');
    expect(qbUpdate).toBeDefined();
    const payload = qbUpdate!.payload as Record<string, unknown>;
    expect(typeof payload.deleted_at).toBe('string');
    expect(new Date(payload.deleted_at as string).toString()).not.toBe('Invalid Date');

    // Audit row.
    expect(mockLogAdminAuditByUserId).toHaveBeenCalledTimes(1);
    expect(mockLogAdminAuditByUserId).toHaveBeenCalledWith(
      ADMIN_UID,
      'question.soft_deleted',
      'question_bank',
      rowId,
      expect.objectContaining({ action: 'soft-delete', reason }),
      undefined,
    );
  });
});

describe('POST verification-queue — enable-enforcement', () => {
  // Helper: synthesize a question_bank row set with a given verified ratio.
  function rowsWithVerifiedRatio(verified: number, total: number) {
    const rows: Array<{ verification_state: string }> = [];
    for (let i = 0; i < verified; i++) rows.push({ verification_state: 'verified' });
    const fillerCount = total - verified;
    for (let i = 0; i < fillerCount; i++) {
      // Mix of non-verified states so the ratio computation is exercised.
      const states = ['pending', 'legacy_unverified', 'failed'];
      rows.push({ verification_state: states[i % states.length] });
    }
    return rows;
  }

  it('returns 200, upserts enforcement, and writes question_bank.enforcement_enabled audit row when verified_ratio >= 0.9', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    // 9 verified out of 10 = 0.9 — meets threshold exactly.
    setResult({ data: rowsWithVerifiedRatio(9, 10), error: null });
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');

    const res = await POST(
      postRequest({
        action: 'enable-enforcement',
        payload: { grade: '10', subject_code: 'science' },
      }) as never,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expect.objectContaining({ success: true }));
    expect(body.data).toEqual(
      expect.objectContaining({
        action: 'enable-enforcement',
        grade: '10',
        subject_code: 'science',
        verified_ratio: 0.9,
      }),
    );

    // Composite-PK upsert.
    const upsert = upsertCalls.find((c) => c.table === 'ff_grounded_ai_enforced_pairs');
    expect(upsert).toBeDefined();
    expect(upsert!.payload).toEqual(
      expect.objectContaining({
        grade: '10',
        subject_code: 'science',
        enabled: true,
        enabled_by: ADMIN_UID,
        auto_disabled_at: null,
        auto_disabled_reason: null,
      }),
    );
    expect(upsert!.options).toEqual(expect.objectContaining({ onConflict: 'grade,subject_code' }));

    // Audit row.
    expect(mockLogAdminAuditByUserId).toHaveBeenCalledTimes(1);
    expect(mockLogAdminAuditByUserId).toHaveBeenCalledWith(
      ADMIN_UID,
      'question_bank.enforcement_enabled',
      'enforcement_pair',
      '10::science',
      expect.objectContaining({
        action: 'enable-enforcement',
        grade: '10',
        subject_code: 'science',
        verified_ratio: 0.9,
        verified: 9,
        total: 10,
      }),
      undefined,
    );
  });

  it('returns 400 and refuses upsert when verified_ratio < 0.9 (client cannot bypass)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    // 5 verified out of 10 = 0.5, below 0.9 threshold.
    setResult({ data: rowsWithVerifiedRatio(5, 10), error: null });
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');

    const res = await POST(
      postRequest({
        action: 'enable-enforcement',
        payload: { grade: '10', subject_code: 'science' },
      }) as never,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/verified_ratio/);
    // The error message exposes the failing numbers so ops can act on them.
    expect(body.context).toEqual(expect.objectContaining({ verified: 5, total: 10 }));

    // No write should have fired on the enforcement table.
    expect(upsertCalls.filter((c) => c.table === 'ff_grounded_ai_enforced_pairs')).toHaveLength(0);
    // No audit row on denial — the action did not happen.
    expect(mockLogAdminAuditByUserId).not.toHaveBeenCalled();
    // No ops_events on denial either.
    expect(mockLogOpsEvent).not.toHaveBeenCalled();
  });

  it('returns 400 when the pair has zero rows (verified_ratio = 0 < 0.9)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult({ data: [], error: null });
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');

    const res = await POST(
      postRequest({
        action: 'enable-enforcement',
        payload: { grade: '11', subject_code: 'physics' },
      }) as never,
    );

    expect(res.status).toBe(400);
    expect(upsertCalls.filter((c) => c.table === 'ff_grounded_ai_enforced_pairs')).toHaveLength(0);
  });
});
