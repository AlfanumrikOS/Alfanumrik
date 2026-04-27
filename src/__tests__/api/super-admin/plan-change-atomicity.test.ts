/**
 * Plan-change bulk action atomicity tests (Round 2 / 2026-04-27).
 *
 * Pins the post-recovery contract for
 * `src/app/api/super-admin/bulk-actions/plan-change/route.ts`:
 *
 *   - The route never UPDATEs students or student_subscriptions directly.
 *     Plan changes go through `atomic_plan_change(p_student_id, p_new_plan,
 *     p_reason)` (migration 20260427000002) which holds a
 *     pg_advisory_xact_lock and writes both rows in a single transaction
 *     plus a domain_events audit row. This closes the P11 split-brain
 *     vector on bulk plan changes.
 *
 *   - Per-student isolation: a single RPC failure does not poison the
 *     batch. The route reports `{ processed, succeeded, failed, errors,
 *     failures: [{ student_id, error }] }` and bumps ops-event severity
 *     to 'warning' when any student failed.
 *
 *   - The auth gate stays in front of the RPC: missing admin auth →
 *     401 with no RPC calls.
 *
 *   - Bad plan name → RPC raises (validation lives in the SQL RPC) and
 *     the route reports the failure for that student. The route does
 *     not pre-filter unknown plans before calling the RPC, but the
 *     existing VALID_PLANS allow-list still rejects payloads with
 *     completely off-spec plan names at 400 level. We assert the post-
 *     allow-list path: a plan that passes VALID_PLANS but the RPC
 *     rejects (e.g. business-rule violation) shows up in `failures`.
 *
 * Mocking style follows `src/__tests__/bulk-actions-api.test.ts` — the
 * canonical pattern for these admin route tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks (must be hoisted before route import) ───────────────

vi.mock('@/lib/admin-auth', () => {
  const { NextResponse } = require('next/server');
  return {
    authorizeAdmin: vi.fn().mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }),
    logAdminAudit: vi.fn().mockResolvedValue(undefined),
    isValidUUID: (s: string) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  };
});

vi.mock('@/lib/ops-events', () => ({
  logOpsEvent: vi.fn().mockResolvedValue(undefined),
}));

const rpcMock = vi.fn();
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

// ── Test helpers ──────────────────────────────────────────────────────

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/super-admin/bulk-actions/plan-change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const STUDENT_IDS = [
  '550e8400-e29b-41d4-a716-446655440001',
  '550e8400-e29b-41d4-a716-446655440002',
  '550e8400-e29b-41d4-a716-446655440003',
];

// ── 1. Auth check preserved (must run BEFORE any RPC call) ────────────

describe('plan-change atomicity: auth gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockReset();
  });

  it('returns 401 when authorizeAdmin denies and never calls the RPC', async () => {
    // Default mock from above already returns authorized:false.
    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const req = makeRequest({
      studentIds: STUDENT_IDS,
      targetPlan: 'pro',
      action: 'upgrade_plan',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

// ── 2. Authed paths — exercise atomic_plan_change RPC ─────────────────

describe('plan-change atomicity: RPC behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    rpcMock.mockReset();
    const { authorizeAdmin } = await import('@/lib/admin-auth');
    (authorizeAdmin as any).mockResolvedValue({
      authorized: true,
      adminId: 'test-admin-id',
      adminEmail: 'admin@test.com',
      response: null,
    });
  });

  it('happy path: 3 succeed → { processed:3, succeeded:3, failed:0, errors:[], failures:[] }', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const req = makeRequest({
      studentIds: STUDENT_IDS,
      targetPlan: 'pro',
      action: 'upgrade_plan',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.processed).toBe(3);
    expect(body.data.succeeded).toBe(3);
    expect(body.data.failed).toBe(0);
    expect(Array.isArray(body.data.errors)).toBe(true);
    expect(body.data.errors).toHaveLength(0);
    expect(Array.isArray(body.data.failures)).toBe(true);
    expect(body.data.failures).toHaveLength(0);

    // Each student → exactly one RPC call to atomic_plan_change.
    expect(rpcMock).toHaveBeenCalledTimes(3);
    for (const id of STUDENT_IDS) {
      expect(rpcMock).toHaveBeenCalledWith('atomic_plan_change', {
        p_student_id: id,
        p_new_plan: 'pro',
        p_reason: expect.stringContaining('bulk.upgrade_plan'),
      });
    }

    // Severity stays 'info' when nothing failed.
    const { logOpsEvent } = await import('@/lib/ops-events');
    expect(logOpsEvent).toHaveBeenCalledTimes(1);
    const opsCall = (logOpsEvent as any).mock.calls[0][0];
    expect(opsCall.severity).toBe('info');
  });

  it('partial failure: 2 succeed, 1 fails → bumps severity to "warning" and lists failure', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'student not found' } })
      .mockResolvedValueOnce({ data: null, error: null });

    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const req = makeRequest({
      studentIds: STUDENT_IDS,
      targetPlan: 'pro',
      action: 'upgrade_plan',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.processed).toBe(3);
    expect(body.data.succeeded).toBe(2);
    expect(body.data.failed).toBe(1);

    // Per-student failure shape.
    expect(body.data.failures).toHaveLength(1);
    expect(body.data.failures[0]).toEqual({
      student_id: STUDENT_IDS[1],
      error: 'student not found',
    });

    // Backwards-compat flat error list also populated.
    expect(body.data.errors).toHaveLength(1);
    expect(body.data.errors[0]).toContain(STUDENT_IDS[1]);
    expect(body.data.errors[0]).toContain('student not found');

    // Severity bumped on any failure.
    const { logOpsEvent } = await import('@/lib/ops-events');
    const opsCall = (logOpsEvent as any).mock.calls[0][0];
    expect(opsCall.severity).toBe('warning');
    expect(opsCall.context).toMatchObject({
      action: 'upgrade_plan',
      targetPlan: 'pro',
      requested: 3,
      succeeded: 2,
      failed: 1,
    });
  });

  it('all fail: still HTTP 200 with per-student error report (route does not 5xx on RPC errors)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'rpc explosion' } });

    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const req = makeRequest({
      studentIds: STUDENT_IDS,
      targetPlan: 'pro',
      action: 'upgrade_plan',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true); // route-level success — per-student status lives in data
    expect(body.data.processed).toBe(3);
    expect(body.data.succeeded).toBe(0);
    expect(body.data.failed).toBe(3);
    expect(body.data.failures).toHaveLength(3);
    expect(body.data.errors).toHaveLength(3);

    const { logOpsEvent } = await import('@/lib/ops-events');
    const opsCall = (logOpsEvent as any).mock.calls[0][0];
    expect(opsCall.severity).toBe('warning');
  });

  it('plan validation passthrough: RPC raises a per-student error which is reported in failures', async () => {
    // VALID_PLANS lets 'unlimited' through at the route layer. Suppose the
    // SQL RPC has its own business rule rejecting 'unlimited' for a
    // particular student (e.g. school-scoped plan ban). The error text is
    // surfaced verbatim.
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'plan_not_allowed_for_school' },
    });

    const { POST } = await import('@/app/api/super-admin/bulk-actions/plan-change/route');
    const req = makeRequest({
      studentIds: [STUDENT_IDS[0]],
      targetPlan: 'unlimited',
      action: 'upgrade_plan',
    });

    const res = await POST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.processed).toBe(1);
    expect(body.data.succeeded).toBe(0);
    expect(body.data.failed).toBe(1);
    expect(body.data.failures[0]).toEqual({
      student_id: STUDENT_IDS[0],
      error: 'plan_not_allowed_for_school',
    });
  });

  it('atomicity contract: route never updates students or student_subscriptions directly — only via RPC', async () => {
    // Static contract: read the route source and assert it never touches
    // students/student_subscriptions tables directly. All plan changes
    // must flow through the atomic_plan_change RPC. This is the regression
    // canary for the P11 split-brain prevention.
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(
      resolve(process.cwd(), 'src/app/api/super-admin/bulk-actions/plan-change/route.ts'),
      'utf8',
    );

    // The route must call the atomic RPC.
    expect(src).toMatch(/rpc\(\s*['"]atomic_plan_change['"]/);

    // The route MUST NOT do direct table updates on students or
    // student_subscriptions for plan changes (split-brain risk).
    expect(src).not.toMatch(/\.from\(\s*['"]students['"]\s*\)[\s\S]*?\.update\(/);
    expect(src).not.toMatch(/\.from\(\s*['"]student_subscriptions['"]\s*\)[\s\S]*?\.update\(/);
  });
});
