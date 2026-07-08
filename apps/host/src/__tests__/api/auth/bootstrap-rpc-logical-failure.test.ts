import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * AO-4 regression — /api/auth/bootstrap honours the RPC's in-body
 * logical-failure channel.
 *
 * Context (audit Cycle 1, Auth & Onboarding / P15):
 *   `bootstrap_user_profile` has a DUAL error channel. It can (a) RAISE
 *   (surfaced as the Supabase client's `rpcError`) OR (b) RETURN a logical
 *   error `{ status: 'error', error: <msg> }` from its invalid-role ELSE branch
 *   and its `EXCEPTION WHEN OTHERS` branch WITHOUT raising
 *   (20260610090100_bootstrap_link_code.sql:224-225, :233-234). Success and
 *   idempotent paths both RETURN a non-null `profile_id`.
 *
 *   Before AO-4 the route branched ONLY on `rpcError`, so an in-body
 *   `status:'error'` (or a result with no `profile_id`) fell through to the
 *   success return: HTTP 200 `success:true` with `profile_id` undefined — a
 *   masked failure that defeated the P15 3-layer failsafe (the client's
 *   AuthContext runtime fallback never engaged) and inflated `signup_complete`.
 *
 *   The fix (src/app/api/auth/bootstrap/route.ts) adds a guard immediately
 *   after the `rpcError` block: `rpcStatus === 'error' || !profileId` →
 *   non-200 `{ success:false, code:'BOOTSTRAP_FAILED' }`.
 *
 * These tests pin that behaviour and guard the happy path against regressing.
 * Mock pattern mirrors src/__tests__/auth-bootstrap.test.ts.
 */

// ── Mock setup (mirrors auth-bootstrap.test.ts) ──

const mockGetUser = vi.fn();
const mockRpc = vi.fn();
const mockInsert = vi.fn().mockReturnValue({ catch: vi.fn() });
const mockFrom = vi.fn((table: string) => {
  if (table === 'subjects') {
    return {
      select: () => ({
        eq: () => Promise.resolve({ data: [{ code: 'math' }, { code: 'science' }], error: null }),
      }),
    };
  }
  // auth_audit_log (logIdentityEvent) and any other table → insert sink
  return { insert: mockInsert };
});

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

const mockAdminAuthGetUser = vi.fn();

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
    auth: { getUser: (token: string) => mockAdminAuthGetUser(token) },
  })),
}));

vi.mock('@alfanumrik/lib/sanitize', () => ({
  sanitizeText: vi.fn((input: string) => input),
}));

function bootstrapRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const MOCK_USER = {
  id: 'user-uuid-ao4-0001',
  email: 'student@example.com',
  user_metadata: { role: 'student' },
};

describe('AO-4: POST /api/auth/bootstrap RPC logical-failure handling', () => {
  let POST: (request: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    const mod = await import('@/app/api/auth/bootstrap/route');
    POST = mod.POST;
  }, 30000);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockGetUser.mockResolvedValue({ data: { user: MOCK_USER }, error: null });
    // Default: RPC succeeds with a profile_id (happy path).
    mockRpc.mockResolvedValue({
      data: { status: 'success', profile_id: 'profile-uuid-ok' },
      error: null,
    });
    mockInsert.mockReturnValue({ catch: vi.fn() });
    mockAdminAuthGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } });
  });

  // A VALID role + name is required so execution reaches the RPC (the route's
  // own role/name validation rejects before that with a 400, which would NOT
  // exercise the AO-4 guard). 'student' + grade '9' clears all pre-RPC checks.
  const validReachesRpcBody = { role: 'student', name: 'Aarav Sharma', grade: '9' };

  it('returns 500 BOOTSTRAP_FAILED when the RPC returns in-body { status: "error" } with rpcError null', async () => {
    // The no-raise EXCEPTION/invalid-role channel: data present, error null.
    mockRpc.mockResolvedValue({
      data: { status: 'error', error: 'duplicate key value violates unique constraint', link_status: 'not_attempted' },
      error: null,
    });

    const response = await POST(bootstrapRequest(validReachesRpcBody));
    const json = await response.json();

    // The pre-AO-4 behaviour was 200 success:true here — pin the fixed shape.
    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.code).toBe('BOOTSTRAP_FAILED');
    // The RPC WAS called (proves this is the logical-failure path, not a
    // pre-RPC validation rejection).
    expect(mockRpc).toHaveBeenCalledWith('bootstrap_user_profile', expect.objectContaining({
      p_auth_user_id: MOCK_USER.id,
      p_role: 'student',
    }));
  });

  it('returns 500 when the RPC returns status:"success" but NO profile_id (missing-profile_id branch)', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'success' /* profile_id absent */ },
      error: null,
    });

    const response = await POST(bootstrapRequest(validReachesRpcBody));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.success).toBe(false);
    expect(json.code).toBe('BOOTSTRAP_FAILED');
  });

  it('does NOT report success:true on a logical failure (the masked-success regression)', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'error', error: 'Invalid role', link_status: 'not_attempted' },
      error: null,
    });

    const response = await POST(bootstrapRequest(validReachesRpcBody));
    const json = await response.json();

    expect(json.success).not.toBe(true);
    expect(response.status).not.toBe(200);
  });

  it('writes a metadata-only bootstrap_failure audit row (P13: no raw SQLERRM / name / email)', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'error', error: 'duplicate key value violates unique constraint "students_email_key" (aarav@example.com)' },
      error: null,
    });

    await POST(bootstrapRequest(validReachesRpcBody));

    expect(mockFrom).toHaveBeenCalledWith('auth_audit_log');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      auth_user_id: MOCK_USER.id,
      event_type: 'bootstrap_failure',
      metadata: expect.objectContaining({
        error: 'rpc_logical_error',
        role: 'student',
        rpc_status: 'error',
      }),
    }));

    // P13: the raw SQLERRM (which embeds an email) must NOT be persisted.
    const auditCalls = mockInsert.mock.calls.map((c) => JSON.stringify(c[0]));
    for (const serialized of auditCalls) {
      expect(serialized).not.toContain('students_email_key');
      expect(serialized).not.toContain('aarav@example.com');
    }
  });

  it('uses error token "missing_profile_id" in the audit metadata when profile_id is absent', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'success' /* no profile_id */ },
      error: null,
    });

    await POST(bootstrapRequest(validReachesRpcBody));

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'bootstrap_failure',
      metadata: expect.objectContaining({ error: 'missing_profile_id' }),
    }));
  });

  // ── Happy-path regression guard: the AO-4 guard must be a no-op here ──

  it('still returns 200 success:true when the RPC returns status:"success" WITH a profile_id', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'success', profile_id: 'profile-uuid-real' },
      error: null,
    });

    const response = await POST(bootstrapRequest(validReachesRpcBody));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.profile_id).toBe('profile-uuid-real');
    expect(json.data.redirect).toBe('/dashboard');
  });

  it('still returns 200 success:true for the idempotent already_completed path (carries profile_id)', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'already_completed', profile_id: 'existing-profile-uuid' },
      error: null,
    });

    const response = await POST(bootstrapRequest(validReachesRpcBody));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('already_completed');
    expect(json.data.profile_id).toBe('existing-profile-uuid');
  });
});
