/**
 * POST /api/rhythm/remediation/[id]/resolve — Phase 3A Wave A / A3 contract.
 *
 * Pins:
 *   1. auth gate fires with `quiz.attempt` + requireStudentId; the auth
 *      errorResponse is returned verbatim when not authorized.
 *   2. 403 when the caller has no linked student profile (auth.studentId null).
 *   3. 400 when the path id is not a UUID.
 *   4. happy path: calls resolveTeacherRemediation(admin, id, auth.studentId)
 *      — student_id is the INTERNAL students.id resolved by authorizeRequest,
 *      NEVER auth.uid() — and returns 200 { success, status:'resolved' }.
 *   5. notFound → 404; not-ok → 500; already-resolved → 200 idempotent:true.
 *
 * The helper (resolveTeacherRemediation) is unit-tested separately in
 * src/__tests__/state/learner-loop/teacher-remediation.test.ts; here we only
 * pin the route's wiring (auth, id validation, status code mapping, and that
 * the INTERNAL studentId is the one threaded through).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockResolve: vi.fn(),
  resolveArgs: [] as unknown[],
}));

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ __admin: true }),
}));
vi.mock('@/lib/state/learner-loop/resolve-next-action', () => ({
  resolveTeacherRemediation: (...a: unknown[]) => {
    holders.resolveArgs = a;
    return holders.mockResolve(...a);
  },
}));

import { POST } from '@/app/api/rhythm/remediation/[id]/resolve/route';

const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
const AUTH_UID = '11111111-1111-1111-1111-111111111111';
const ASSIGN_ID = '99999999-9999-9999-9999-999999999999';

function authOk(studentId: string | null = STUDENT_ID) {
  return {
    authorized: true as const,
    userId: AUTH_UID,
    studentId,
    roles: ['student'],
    permissions: ['quiz.attempt'],
  };
}

function req() {
  return new Request(`http://localhost/api/rhythm/remediation/${ASSIGN_ID}/resolve`, {
    method: 'POST',
  }) as never;
}

function ctx(id: string = ASSIGN_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.resolveArgs = [];
});

describe('POST /api/rhythm/remediation/[id]/resolve', () => {
  it('returns the auth errorResponse verbatim when not authorized', async () => {
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(403);
    // resolveTeacherRemediation never called when unauthorized.
    expect(holders.mockResolve).not.toHaveBeenCalled();
  });

  it('gates on quiz.attempt + requireStudentId', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockResolve.mockResolvedValue({ ok: true, alreadyResolved: false });
    await POST(req(), ctx());
    expect(holders.mockAuthorize).toHaveBeenCalledWith(
      expect.anything(),
      'quiz.attempt',
      { requireStudentId: true },
    );
  });

  it('403 when the caller has no linked student profile', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk(null));
    const res = await POST(req(), ctx());
    expect(res.status).toBe(403);
    expect(holders.mockResolve).not.toHaveBeenCalled();
  });

  it('400 when the path id is not a UUID', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    const res = await POST(req(), ctx('not-a-uuid'));
    expect(res.status).toBe(400);
    expect(holders.mockResolve).not.toHaveBeenCalled();
  });

  it('happy path: threads the INTERNAL studentId (not auth.uid()) and returns 200', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockResolve.mockResolvedValue({ ok: true, alreadyResolved: false });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, status: 'resolved', idempotent: false });
    // (admin, assignmentId, studentId) — studentId is the internal id, NOT auth.uid().
    expect(holders.resolveArgs[1]).toBe(ASSIGN_ID);
    expect(holders.resolveArgs[2]).toBe(STUDENT_ID);
    expect(holders.resolveArgs[2]).not.toBe(AUTH_UID);
  });

  it('already-resolved → 200 idempotent:true', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockResolve.mockResolvedValue({ ok: true, alreadyResolved: true });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
  });

  it('notFound → 404', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockResolve.mockResolvedValue({ ok: false, notFound: true });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('not-ok (DB error) → 500', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockResolve.mockResolvedValue({ ok: false });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(500);
  });
});
