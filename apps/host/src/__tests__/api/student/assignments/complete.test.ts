/**
 * POST /api/student/assignments/[id]/complete — route wiring test.
 *
 * Mirrors apps/host/src/__tests__/api/rhythm/remediation-resolve.test.ts:
 * the business logic (class-membership / session-ownership / already-graded
 * checks) is unit-tested separately in
 * apps/host/src/__tests__/learn/assignment-submission.test.ts. Here we only
 * pin the route's wiring: auth gate, id/body validation, and status-code
 * mapping from the helper's result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockComplete: vi.fn(),
  completeArgs: [] as unknown[],
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ __admin: true }),
}));
vi.mock('@alfanumrik/lib/learn/assignment-submission', () => ({
  completeAssignmentFromSession: (...a: unknown[]) => {
    holders.completeArgs = a;
    return holders.mockComplete(...a);
  },
}));

import { POST } from '@/app/api/student/assignments/[id]/complete/route';

const STUDENT_ID = '22222222-2222-2222-2222-222222222222';
const AUTH_UID = '11111111-1111-1111-1111-111111111111';
const ASSIGNMENT_ID = '99999999-9999-9999-9999-999999999999';
const SESSION_ID = '88888888-8888-8888-8888-888888888888';

function authOk(studentId: string | null = STUDENT_ID) {
  return {
    authorized: true as const,
    userId: AUTH_UID,
    studentId,
    roles: ['student'],
    permissions: ['quiz.attempt'],
  };
}

function req(body: unknown = { session_id: SESSION_ID }) {
  return new Request(`http://localhost/api/student/assignments/${ASSIGNMENT_ID}/complete`, {
    method: 'POST',
    body: JSON.stringify(body),
  }) as never;
}

function ctx(id: string = ASSIGNMENT_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.completeArgs = [];
});

describe('POST /api/student/assignments/[id]/complete', () => {
  it('returns the auth errorResponse verbatim when not authorized', async () => {
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(403);
    expect(holders.mockComplete).not.toHaveBeenCalled();
  });

  it('gates on quiz.attempt + requireStudentId', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({ ok: true, submissionId: 's1', status: 'submitted', scorePercent: 80 });
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
    expect(holders.mockComplete).not.toHaveBeenCalled();
  });

  it('400 when the path id is not a UUID', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    const res = await POST(req(), ctx('not-a-uuid'));
    expect(res.status).toBe(400);
    expect(holders.mockComplete).not.toHaveBeenCalled();
  });

  it('400 when session_id is missing or not a UUID', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    const res = await POST(req({ session_id: 'not-a-uuid' }), ctx());
    expect(res.status).toBe(400);
    expect(holders.mockComplete).not.toHaveBeenCalled();
  });

  it('happy path: threads the INTERNAL studentId (never auth.uid()) and returns 200 with scorePercent', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({ ok: true, submissionId: 'sub-1', status: 'submitted', scorePercent: 90 });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, status: 'submitted', submissionId: 'sub-1', scorePercent: 90 });
    // (admin, { assignmentId, studentId, sessionId }) — studentId is internal, never auth.uid().
    const passedArg = holders.completeArgs[1] as { assignmentId: string; studentId: string; sessionId: string };
    expect(passedArg.assignmentId).toBe(ASSIGNMENT_ID);
    expect(passedArg.studentId).toBe(STUDENT_ID);
    expect(passedArg.studentId).not.toBe(AUTH_UID);
    expect(passedArg.sessionId).toBe(SESSION_ID);
  });

  it('not_enrolled → 403 (cross-class boundary)', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({ ok: false, reason: 'not_enrolled' });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(403);
  });

  it('assignment_not_found → 404', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({ ok: false, reason: 'assignment_not_found' });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('session_not_found → 404 (a session id cannot be borrowed cross-student)', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({ ok: false, reason: 'session_not_found' });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(404);
  });

  it('session_incomplete → 400', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({ ok: false, reason: 'session_incomplete' });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(400);
  });

  it('already_graded → 200 soft-success (never a hard error for the student)', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({ ok: false, reason: 'already_graded' });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, status: 'already_graded' });
  });

  it('max_attempts_reached → 409 (item 3.8)', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({ ok: false, reason: 'max_attempts_reached' });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
  });

  it('submission_closed → 409 (item 3.9 — past due, allow_late_submission=false)', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({ ok: false, reason: 'submission_closed' });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
  });

  it('happy path threads attemptNumber/bestScorePercent/isLateSubmission through to the response', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({
      ok: true, submissionId: 'sub-1', status: 'submitted', scorePercent: 80,
      attemptNumber: 2, bestScorePercent: 90, isLateSubmission: true,
    });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      success: true, status: 'submitted', submissionId: 'sub-1', scorePercent: 80,
      attemptNumber: 2, bestScorePercent: 90, isLateSubmission: true,
    });
  });

  it('db_error → 500', async () => {
    holders.mockAuthorize.mockResolvedValue(authOk());
    holders.mockComplete.mockResolvedValue({ ok: false, reason: 'db_error', message: 'boom' });
    const res = await POST(req(), ctx());
    expect(res.status).toBe(500);
  });
});
