/**
 * POST /api/parent/approve-link — parent↔student link approval boundary tests.
 *
 * This route lets a SIGNED-IN STUDENT approve / reject a PENDING parent-link
 * request addressed to them. The launch-critical invariant (P8/P13 parent↔child
 * boundary) is the OWNERSHIP CHECK: a student may only act on a link whose
 * `studentId` equals THEIR OWN resolved student id. A student must NOT be able
 * to approve (and thereby grant a stranger guardian access to) a link belonging
 * to a DIFFERENT student by passing that link's id.
 *
 * Pins (boundary/scoping prioritised over happy path):
 *   1. 401 when there is no authenticated session (no DB write).
 *   2. 400 when linkId is absent / not a UUID, or action is not approve|reject.
 *   3. 403 when the caller has a session but no student profile.
 *   4. 404 when the link exists but belongs to ANOTHER student — the cross-
 *      student boundary. The status UPDATE is NEVER issued (no write across the
 *      boundary), and the 404 message is generic (does not confirm the link
 *      exists for someone else).
 *   5. 404 when the link is not found / not pending (findLinkById null).
 *   6. Happy path: a student approving / rejecting THEIR OWN pending link
 *      flips the status through the auth.uid()-anchored RPC and echoes the new status.
 *
 * Seams mocked: the cookie session (`createSupabaseServerClient().auth.getUser`)
 * and the RLS/auth-scoped RPC. The route handler itself is the real code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const holders = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: (...a: unknown[]) => holders.mockGetUser(...a) },
    rpc: (...a: unknown[]) => holders.mockRpc(...a),
  })),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// RFC4122-v4-shaped fake ids (isValidUUID requires `4` + `[89ab]` slots).
const AUTH_USER = '11111111-1111-4111-a111-111111111111';
const LINK_ID = '44444444-4444-4444-a444-444444444444';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/parent/approve-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function authedAs(authUserId: string | null) {
  if (authUserId === null) {
    holders.mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  } else {
    holders.mockGetUser.mockResolvedValue({ data: { user: { id: authUserId } }, error: null });
  }
}

function rpcResult(data: Record<string, unknown>, error: { message: string } | null = null) {
  holders.mockRpc.mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/parent/approve-link — service-role migration guard', () => {
  it('does not import the service-role admin client or relationship service-role helper', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/api/parent/approve-link/route.ts'),
      'utf8'
    );

    expect(source).not.toContain('@alfanumrik/lib/supabase-admin');
    expect(source).not.toContain('@alfanumrik/lib/domains/relationship');
    expect(source).toContain("rpc('student_review_guardian_link'");
  });

  it('ships an auth.uid()-anchored RPC migration for student link review', () => {
    const migrationPath = join(
      process.cwd(),
      '../../supabase/migrations/20260710150000_xc3_student_review_guardian_link_rpc.sql'
    );
    expect(existsSync(migrationPath)).toBe(true);

    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.student_review_guardian_link/i);
    expect(sql).toMatch(/auth\.uid\(\)/i);
    expect(sql).not.toMatch(/p_student_auth_id/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.student_review_guardian_link/i);
  });
});

describe('POST /api/parent/approve-link — authentication', () => {
  it('returns 401 with no session and never touches the DB', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(null);
    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'approve' }) as never);
    expect(res.status).toBe(401);
    expect(holders.mockRpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/parent/approve-link — input validation', () => {
  it('returns 400 when linkId is not a UUID', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    const res = await POST(makeRequest({ linkId: 'nope', action: 'approve' }) as never);
    expect(res.status).toBe(400);
    expect(holders.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 when action is not approve|reject', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'delete' }) as never);
    expect(res.status).toBe(400);
    expect(holders.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 400 on malformed JSON body (no 500)', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    const res = await POST(makeRequest('{ not json') as never);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/parent/approve-link — profile resolution', () => {
  it('returns 403 when the session has no student profile', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    rpcResult({ success: false, error_code: 'no_student' });
    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'approve' }) as never);
    expect(res.status).toBe(403);
    expect(holders.mockRpc).toHaveBeenCalledWith('student_review_guardian_link', {
      p_link_id: LINK_ID,
      p_action: 'approved',
    });
  });
});

describe('POST /api/parent/approve-link — cross-student boundary (P8/P13)', () => {
  it("returns 404 and writes nothing when the link belongs to ANOTHER student", async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    rpcResult({ success: false, error_code: 'not_found' });

    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'approve' }) as never);

    // Boundary: cannot approve someone else's link. Generic 404 (no info leak).
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    // Generic message — must NOT confirm the link exists for another student.
    expect(body.error).not.toMatch(/other|another|different student/i);
    // The critical assertion lives in the RPC: it resolves ownership from auth.uid().
    expect(holders.mockRpc).toHaveBeenCalledOnce();
  });

  it('returns 404 when the link is not found / not pending', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    rpcResult({ success: false, error_code: 'not_found' });

    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'approve' }) as never);
    expect(res.status).toBe(404);
    expect(holders.mockRpc).toHaveBeenCalledOnce();
  });
});

describe('POST /api/parent/approve-link — happy path (own link)', () => {
  it('approves the student\'s OWN pending link and flips status to approved', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    rpcResult({ success: true, status: 'approved' });

    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'approve' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, status: 'approved' });

    expect(holders.mockRpc).toHaveBeenCalledWith('student_review_guardian_link', {
      p_link_id: LINK_ID,
      p_action: 'approved',
    });
  });

  it('rejects the student\'s OWN pending link and flips status to rejected', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    rpcResult({ success: true, status: 'rejected' });

    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'reject' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, status: 'rejected' });
    expect(holders.mockRpc).toHaveBeenCalledWith('student_review_guardian_link', {
      p_link_id: LINK_ID,
      p_action: 'rejected',
    });
  });
});
