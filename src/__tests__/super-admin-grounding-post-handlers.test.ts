import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Super-admin grounding POST handler tests (Phase 4 Task 4-prep-A).
 *
 * Covers the POST routes added to:
 *   - /api/super-admin/grounding/verification-queue
 *       actions: re-verify | soft-delete | enable-enforcement
 *   - /api/super-admin/grounding/ai-issues
 *       actions: resolve
 *
 * Assertions:
 *   1. Auth gate — 401 when authorizeRequest denies.
 *   2. Invalid action → 400.
 *   3. enable-enforcement precondition: verified_ratio >= 0.9 enforced
 *      server-side (rows computed from mocked question_bank rows).
 *   4. Happy path writes the correct update + ops_events row.
 *
 * The supabase client is mocked at the boundary; no network.
 */

// ─── Mocks ────────────────────────────────────────────────────────────

const mockAuthorizeRequest = vi.fn();
vi.mock('@/lib/rbac', () => ({
  authorizeRequest: mockAuthorizeRequest,
}));

const mockLogOpsEvent = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/ops-events', () => ({
  logOpsEvent: (...args: unknown[]) => mockLogOpsEvent(...args),
}));

/**
 * Chainable Supabase mock. The terminal resolution is controlled by
 * `setResult(...)` — each call to a terminal (.update, .upsert, .select then
 * awaited) resolves with the cannned { data, error, count } payload.
 *
 * We also record `update` / `upsert` call payloads for assertion.
 */
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

vi.mock('@/lib/supabase-admin', () => ({
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

function postRequest(url: string, body: unknown): Request {
  return new Request(url, {
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

// ─── /verification-queue POST ────────────────────────────────────────

describe('POST /api/super-admin/grounding/verification-queue', () => {
  const URL = 'http://localhost/api/super-admin/grounding/verification-queue';

  it('returns 401 when auth denies', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await POST(postRequest(URL, { action: 're-verify', payload: { id: '00000000-0000-0000-0000-000000000001' } }) as never);
    expect(res.status).toBe(401);
  });

  it('checks the super_admin.access permission', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    await POST(postRequest(URL, { action: 're-verify', payload: { id: '00000000-0000-0000-0000-000000000001' } }) as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'super_admin.access');
  });

  it('rejects invalid JSON body (400)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const bad = new Request(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(bad as never);
    expect(res.status).toBe(400);
  });

  it('rejects unknown action (400)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await POST(postRequest(URL, { action: 'bogus', payload: {} }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid action/);
  });

  it('re-verify rejects malformed id (400)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await POST(postRequest(URL, { action: 're-verify', payload: { id: 'not-a-uuid' } }) as never);
    expect(res.status).toBe(400);
  });

  it('re-verify happy path: updates question_bank + logs ops event', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult({ data: null, error: null });
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const rowId = '22222222-2222-2222-2222-222222222222';
    const res = await POST(postRequest(URL, { action: 're-verify', payload: { id: rowId } }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(expect.objectContaining({ action: 're-verify', id: rowId }));

    const qbUpdate = updateCalls.find((c) => c.table === 'question_bank');
    expect(qbUpdate).toBeDefined();
    expect(qbUpdate!.payload).toEqual(expect.objectContaining({
      verification_state: 'legacy_unverified',
      verification_claimed_by: null,
      verification_claim_expires_at: null,
      verifier_failure_reason: null,
    }));

    expect(mockLogOpsEvent).toHaveBeenCalledTimes(1);
    expect(mockLogOpsEvent).toHaveBeenCalledWith(expect.objectContaining({
      category: 'grounding.admin_action',
      source: 'super-admin.verification-queue',
      subjectType: 'question_bank',
      subjectId: rowId,
    }));
  });

  it('soft-delete sets deleted_at + logs warning ops event', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult({ data: null, error: null });
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const rowId = '33333333-3333-3333-3333-333333333333';
    const res = await POST(postRequest(URL, { action: 'soft-delete', payload: { id: rowId, reason: 'duplicate' } }) as never);
    expect(res.status).toBe(200);

    const qbUpdate = updateCalls.find((c) => c.table === 'question_bank');
    expect(qbUpdate).toBeDefined();
    const payload = qbUpdate!.payload as Record<string, unknown>;
    expect(typeof payload.deleted_at).toBe('string');
    expect(mockLogOpsEvent).toHaveBeenCalledWith(expect.objectContaining({
      severity: 'warning',
      subjectType: 'question_bank',
    }));
  });

  it('enable-enforcement rejects if verified_ratio < 0.9', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    // 5 verified out of 10 = 0.5, below 0.9 threshold
    setResult({
      data: [
        { verification_state: 'verified' }, { verification_state: 'verified' },
        { verification_state: 'verified' }, { verification_state: 'verified' },
        { verification_state: 'verified' }, { verification_state: 'pending' },
        { verification_state: 'pending' }, { verification_state: 'legacy_unverified' },
        { verification_state: 'legacy_unverified' }, { verification_state: 'failed' },
      ],
      error: null,
    });
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await POST(postRequest(URL, {
      action: 'enable-enforcement',
      payload: { grade: '10', subject_code: 'science' },
    }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/verified_ratio/);
    // No upsert should have fired
    expect(upsertCalls.filter((c) => c.table === 'ff_grounded_ai_enforced_pairs')).toHaveLength(0);
    // No ops_events on denial
    expect(mockLogOpsEvent).not.toHaveBeenCalled();
  });

  it('enable-enforcement happy path: 9/10 verified, upserts enforcement + logs event', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    // 9 verified / 10 = 0.9, meets threshold
    setResult({
      data: [
        { verification_state: 'verified' }, { verification_state: 'verified' },
        { verification_state: 'verified' }, { verification_state: 'verified' },
        { verification_state: 'verified' }, { verification_state: 'verified' },
        { verification_state: 'verified' }, { verification_state: 'verified' },
        { verification_state: 'verified' }, { verification_state: 'pending' },
      ],
      error: null,
    });
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await POST(postRequest(URL, {
      action: 'enable-enforcement',
      payload: { grade: '10', subject_code: 'science' },
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(expect.objectContaining({
      action: 'enable-enforcement',
      grade: '10',
      subject_code: 'science',
      verified_ratio: 0.9,
    }));

    const upsert = upsertCalls.find((c) => c.table === 'ff_grounded_ai_enforced_pairs');
    expect(upsert).toBeDefined();
    expect(upsert!.payload).toEqual(expect.objectContaining({
      grade: '10',
      subject_code: 'science',
      enabled: true,
      enabled_by: ADMIN_UID,
      auto_disabled_at: null,
      auto_disabled_reason: null,
    }));
    expect(upsert!.options).toEqual(expect.objectContaining({ onConflict: 'grade,subject_code' }));

    expect(mockLogOpsEvent).toHaveBeenCalledWith(expect.objectContaining({
      category: 'grounding.admin_action',
      source: 'super-admin.verification-queue',
      severity: 'warning',
      subjectType: 'enforcement_pair',
    }));
  });

  it('enable-enforcement rejects invalid grade', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    // grade="5" is out of CBSE 6-12 scope
    const res = await POST(postRequest(URL, {
      action: 'enable-enforcement',
      payload: { grade: '5', subject_code: 'science' },
    }) as never);
    expect(res.status).toBe(400);
  });

  it('enable-enforcement rejects integer grade (P5)', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await POST(postRequest(URL, {
      action: 'enable-enforcement',
      payload: { grade: 10, subject_code: 'science' },
    }) as never);
    expect(res.status).toBe(400);
  });

  it('enable-enforcement rejects invalid subject_code', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/verification-queue/route');
    const res = await POST(postRequest(URL, {
      action: 'enable-enforcement',
      payload: { grade: '10', subject_code: 'Science WITH SPACES!' },
    }) as never);
    expect(res.status).toBe(400);
  });
});

// ─── /ai-issues POST ─────────────────────────────────────────────────

describe('POST /api/super-admin/grounding/ai-issues', () => {
  const URL = 'http://localhost/api/super-admin/grounding/ai-issues';

  it('returns 401 when auth denies', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED());
    const { POST } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    const res = await POST(postRequest(URL, {
      action: 'resolve',
      payload: { id: '00000000-0000-0000-0000-000000000001', admin_resolution: 'no_issue' },
    }) as never);
    expect(res.status).toBe(401);
  });

  it('checks the super_admin.access permission', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    await POST(postRequest(URL, {
      action: 'resolve',
      payload: { id: '00000000-0000-0000-0000-000000000001', admin_resolution: 'no_issue' },
    }) as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(expect.anything(), 'super_admin.access');
  });

  it('rejects invalid JSON body', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    const bad = new Request(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    const res = await POST(bad as never);
    expect(res.status).toBe(400);
  });

  it('rejects unknown action', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    const res = await POST(postRequest(URL, { action: 'delete', payload: {} }) as never);
    expect(res.status).toBe(400);
  });

  it('rejects malformed id', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    const res = await POST(postRequest(URL, {
      action: 'resolve',
      payload: { id: 'nope', admin_resolution: 'bad_chunk' },
    }) as never);
    expect(res.status).toBe(400);
  });

  it('rejects admin_resolution outside the CHECK constraint values', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    const { POST } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    const res = await POST(postRequest(URL, {
      action: 'resolve',
      payload: { id: '44444444-4444-4444-4444-444444444444', admin_resolution: 'totally_broken' },
    }) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/admin_resolution/);
  });

  it('happy path updates ai_issue_reports + logs ops_events', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
    setResult({ data: null, error: null });
    const { POST } = await import('@/app/api/super-admin/grounding/ai-issues/route');
    const issueId = '55555555-5555-5555-5555-555555555555';
    const res = await POST(postRequest(URL, {
      action: 'resolve',
      payload: {
        id: issueId,
        admin_resolution: 'bad_chunk',
        admin_notes: 'Chunk text was truncated; re-ingest scheduled.',
      },
    }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(expect.objectContaining({
      action: 'resolve',
      id: issueId,
      admin_resolution: 'bad_chunk',
    }));

    const update = updateCalls.find((c) => c.table === 'ai_issue_reports');
    expect(update).toBeDefined();
    expect(update!.payload).toEqual(expect.objectContaining({
      admin_resolution: 'bad_chunk',
      admin_notes: 'Chunk text was truncated; re-ingest scheduled.',
      resolved_by: ADMIN_UID,
    }));

    expect(mockLogOpsEvent).toHaveBeenCalledWith(expect.objectContaining({
      category: 'grounding.admin_action',
      source: 'super-admin.ai-issues',
      subjectType: 'ai_issue_report',
      subjectId: issueId,
    }));
    // Confirm admin_notes NOT leaked into ops_events.context
    const opsCall = mockLogOpsEvent.mock.calls[0]?.[0] as { context?: Record<string, unknown> };
    expect(opsCall.context).not.toHaveProperty('admin_notes');
    expect(opsCall.context?.has_notes).toBe(true);
  });

  it('accepts all valid admin_resolution values', async () => {
    const valid = ['bad_chunk', 'bad_prompt', 'bad_question', 'infra', 'no_issue', 'pending'] as const;
    for (const resolution of valid) {
      mockAuthorizeRequest.mockResolvedValueOnce(AUTH_OK);
      setResult({ data: null, error: null });
      const { POST } = await import('@/app/api/super-admin/grounding/ai-issues/route');
      const res = await POST(postRequest(URL, {
        action: 'resolve',
        payload: { id: '66666666-6666-6666-6666-666666666666', admin_resolution: resolution },
      }) as never);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.admin_resolution).toBe(resolution);
    }
  });
});
