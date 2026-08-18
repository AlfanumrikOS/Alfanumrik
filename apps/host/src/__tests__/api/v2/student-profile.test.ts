/**
 * Contract tests for GET /api/v2/student/profile.
 *
 * Pins: auth 401 + profile.view_own, 404 when no profile, 500 on lookup
 * failure, envelope shape (schemaVersion 1, P5 grade string), and
 * language/plan/stream passthrough.
 *
 * P8 REGRESSION GUARD (2026-08-10, learners repository module): the route used
 * to read via the identity domain + the RLS-BYPASSING service-role admin client.
 * It now composes `SupabaseLearnerRepository` over the RLS-scoped, Bearer-aware
 * `createSupabaseRouteClient(request)` (own-row read served by the
 * `students_select_merged` policy). We therefore mock `@alfanumrik/lib/supabase-route`
 * — both to drive the read result AND to ASSERT the route obtained its client
 * from that factory, so a future change cannot silently revert to service-role.
 * Same idiom as `src/__tests__/api/student/daily-plan.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();

const mockMaybeSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

const queryBuilder = { eq: mockEq, maybeSingle: mockMaybeSingle };
mockEq.mockImplementation(() => queryBuilder);
mockSelect.mockImplementation(() => queryBuilder);
mockFrom.mockImplementation(() => ({ select: mockSelect }));

const mockCreateRouteClient = vi.fn(async () => ({ from: mockFrom }));

vi.mock('@alfanumrik/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));
vi.mock('@alfanumrik/lib/supabase-route', () => ({
  createSupabaseRouteClient: (...args: unknown[]) => mockCreateRouteClient(...(args as [])),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const AUTH_USER_ID = 'auth-user-1';

/** A `students` row exactly as the repository's column projection returns it. */
const STUDENT_ROW = {
  id: STUDENT_A,
  auth_user_id: AUTH_USER_ID,
  name: 'Asha',
  grade: '9',
  board: 'CBSE',
  stream: 'science',
  subscription_plan: 'pro',
  preferred_language: 'hi',
  school_id: null,
};

function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true, userId: AUTH_USER_ID, studentId: STUDENT_A,
    roles: ['student'], permissions: ['profile.view_own'],
  });
}

const req = () => new Request('http://localhost/api/v2/student/profile', { method: 'GET' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  mockCreateRouteClient.mockImplementation(async () => ({ from: mockFrom }));
  mockEq.mockImplementation(() => queryBuilder);
  mockSelect.mockImplementation(() => queryBuilder);
  mockFrom.mockImplementation(() => ({ select: mockSelect }));
  mockMaybeSingle.mockResolvedValue({ data: STUDENT_ROW, error: null });
  GET = (await import('@/app/api/v2/student/profile/route')).GET;
});

describe('GET /api/v2/student/profile', () => {
  it('returns 401 when unauthenticated', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false, userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    expect((await GET(req())).status).toBe(401);
  });

  it('does not touch the database when authorization fails', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false, userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    await GET(req());
    expect(mockCreateRouteClient).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('uses profile.view_own with requireStudentId', async () => {
    await GET(req());
    expect(_authorizeImpl).toHaveBeenCalledWith(
      expect.anything(), 'profile.view_own', expect.objectContaining({ requireStudentId: true }),
    );
  });

  it('P8: builds its client from createSupabaseRouteClient, never the service-role client', async () => {
    await GET(req());
    // The regression guard: if a future change reverts to getSupabaseAdmin(),
    // this factory is no longer called and the RLS boundary is silently lost.
    expect(mockCreateRouteClient).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('students');
  });

  it('filters the own-row read on auth_user_id using the authenticated user id', async () => {
    await GET(req());
    expect(mockEq).toHaveBeenCalledWith('auth_user_id', AUTH_USER_ID);
    // students.id and auth.users.id are different uuids — filtering on the
    // wrong one would resolve a different learner.
    expect(mockEq).not.toHaveBeenCalledWith('id', expect.anything());
  });

  it('returns 404 when no student profile exists', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(req());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('NO_STUDENT_PROFILE');
  });

  it('returns 500 INTERNAL_ERROR when the profile lookup errors', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for table students' },
    });
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Profile lookup failed');
    expect(body.code).toBe('INTERNAL_ERROR');
    // A DB failure must not be laundered into "no profile".
    expect(body.code).not.toBe('NO_STUDENT_PROFILE');
    // P13: the driver message must not reach the client.
    expect(JSON.stringify(body)).not.toContain('permission denied');
  });

  it('returns the profile envelope with a string grade (P5) and passthrough fields', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.student_id).toBe(STUDENT_A);
    expect(body.data.name).toBe('Asha');
    expect(body.data.grade).toBe('9');
    expect(typeof body.data.grade).toBe('string');
    expect(body.data.board).toBe('CBSE');
    expect(body.data.stream).toBe('science');
    expect(body.data.plan).toBe('pro');
    expect(body.data.language).toBe('hi');
  });

  it('emits exactly the 8 frozen contract fields', async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(Object.keys(body.data).sort()).toEqual(
      ['board', 'grade', 'language', 'name', 'plan', 'schemaVersion', 'stream', 'student_id'].sort(),
    );
  });
});
