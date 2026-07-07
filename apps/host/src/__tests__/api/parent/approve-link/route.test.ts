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
 *      flips the status via the admin write and echoes the new status.
 *
 * Seams mocked: the cookie session (`createSupabaseServerClient().auth.getUser`),
 * the student-profile lookup (`supabaseAdmin.from('students')`), and the
 * relationship-domain `findLinkById`. The route handler itself is the real code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const holders = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFindLinkById: vi.fn(),
  // student-profile lookup result for supabaseAdmin.from('students')
  studentLookup: { data: null as { id: string } | null, error: null as { message: string } | null },
  // capture of the guardian_student_links UPDATE so tests can assert it never
  // fired across the boundary.
  updateCalls: [] as Array<{ table: string; values: Record<string, unknown>; id: unknown }>,
  updateError: null as { message: string } | null,
}));

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: { getUser: (...a: unknown[]) => holders.mockGetUser(...a) },
  })),
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  // Minimal chainable stub. We only need:
  //   .from('students').select('id').eq('auth_user_id', x).maybeSingle()
  //   .from('guardian_student_links').update(values).eq('id', linkId)
  const from = (table: string) => ({
    select: (_cols: string) => ({
      eq: (_col: string, _val: unknown) => ({
        maybeSingle: () =>
          Promise.resolve({ data: holders.studentLookup.data, error: holders.studentLookup.error }),
      }),
    }),
    update: (values: Record<string, unknown>) => ({
      eq: (_col: string, id: unknown) => {
        holders.updateCalls.push({ table, values, id });
        return Promise.resolve({ error: holders.updateError });
      },
    }),
  });
  return { supabaseAdmin: { from } };
});

vi.mock('@alfanumrik/lib/domains/relationship', () => ({
  findLinkById: (...a: unknown[]) => holders.mockFindLinkById(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// RFC4122-v4-shaped fake ids (isValidUUID requires `4` + `[89ab]` slots).
const AUTH_USER = '11111111-1111-4111-a111-111111111111';
const STUDENT_ME = '22222222-2222-4222-a222-222222222222';
const STUDENT_OTHER = '33333333-3333-4333-a333-333333333333';
const LINK_ID = '44444444-4444-4444-a444-444444444444';
const GUARDIAN_ID = '55555555-5555-4555-a555-555555555555';

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

function studentProfile(id: string | null) {
  holders.studentLookup.data = id ? { id } : null;
  holders.studentLookup.error = null;
}

function pendingLinkOwnedBy(studentId: string) {
  holders.mockFindLinkById.mockResolvedValue({
    ok: true,
    data: {
      id: LINK_ID,
      guardianId: GUARDIAN_ID,
      studentId,
      status: 'pending',
      permissionLevel: null,
      isVerified: false,
      linkedAt: null,
      createdAt: null,
      updatedAt: null,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.studentLookup = { data: null, error: null };
  holders.updateCalls = [];
  holders.updateError = null;
});

describe('POST /api/parent/approve-link — authentication', () => {
  it('returns 401 with no session and never touches the DB', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(null);
    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'approve' }) as never);
    expect(res.status).toBe(401);
    expect(holders.mockFindLinkById).not.toHaveBeenCalled();
    expect(holders.updateCalls).toHaveLength(0);
  });
});

describe('POST /api/parent/approve-link — input validation', () => {
  it('returns 400 when linkId is not a UUID', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    const res = await POST(makeRequest({ linkId: 'nope', action: 'approve' }) as never);
    expect(res.status).toBe(400);
    expect(holders.updateCalls).toHaveLength(0);
  });

  it('returns 400 when action is not approve|reject', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'delete' }) as never);
    expect(res.status).toBe(400);
    expect(holders.updateCalls).toHaveLength(0);
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
    studentProfile(null);
    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'approve' }) as never);
    expect(res.status).toBe(403);
    expect(holders.mockFindLinkById).not.toHaveBeenCalled();
    expect(holders.updateCalls).toHaveLength(0);
  });
});

describe('POST /api/parent/approve-link — cross-student boundary (P8/P13)', () => {
  it("returns 404 and writes nothing when the link belongs to ANOTHER student", async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    studentProfile(STUDENT_ME);
    // The pending link is addressed to a DIFFERENT student.
    pendingLinkOwnedBy(STUDENT_OTHER);

    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'approve' }) as never);

    // Boundary: cannot approve someone else's link. Generic 404 (no info leak).
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    // Generic message — must NOT confirm the link exists for another student.
    expect(body.error).not.toMatch(/other|another|different student/i);
    // The critical assertion: NO status UPDATE crosses the boundary.
    expect(holders.updateCalls).toHaveLength(0);
  });

  it('returns 404 when the link is not found / not pending', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    studentProfile(STUDENT_ME);
    holders.mockFindLinkById.mockResolvedValue({ ok: true, data: null });

    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'approve' }) as never);
    expect(res.status).toBe(404);
    expect(holders.updateCalls).toHaveLength(0);
  });
});

describe('POST /api/parent/approve-link — happy path (own link)', () => {
  it('approves the student\'s OWN pending link and flips status to approved', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    studentProfile(STUDENT_ME);
    pendingLinkOwnedBy(STUDENT_ME);

    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'approve' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, status: 'approved' });

    // Exactly one write, against guardian_student_links, keyed by THIS link id,
    // setting status=approved.
    expect(holders.updateCalls).toHaveLength(1);
    expect(holders.updateCalls[0].table).toBe('guardian_student_links');
    expect(holders.updateCalls[0].id).toBe(LINK_ID);
    expect(holders.updateCalls[0].values.status).toBe('approved');
  });

  it('rejects the student\'s OWN pending link and flips status to rejected', async () => {
    const { POST } = await import('@/app/api/parent/approve-link/route');
    authedAs(AUTH_USER);
    studentProfile(STUDENT_ME);
    pendingLinkOwnedBy(STUDENT_ME);

    const res = await POST(makeRequest({ linkId: LINK_ID, action: 'reject' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, status: 'rejected' });
    expect(holders.updateCalls[0].values.status).toBe('rejected');
  });
});
