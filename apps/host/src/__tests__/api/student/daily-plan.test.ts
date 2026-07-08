/**
 * Daily Plan API tests (Phase 3 of Goal-Adaptive Learning Layers).
 * Pins the contract for src/app/api/student/daily-plan/route.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuthorizeRequest = vi.fn();
const mockIsFeatureEnabled = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();

const queryBuilder = {
  eq: mockEq,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
};
mockEq.mockImplementation(() => queryBuilder);
mockSelect.mockImplementation(() => queryBuilder);
mockFrom.mockImplementation(() => ({ select: mockSelect }));

const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();

// XC-3 Phase 2 batch 3 — Bearer batch (REG-220): the route now reads through the
// Bearer-AWARE, RLS-respecting createSupabaseRouteClient() instead of the
// RLS-bypassing service-role admin client. daily-plan has a mobile Bearer caller,
// so the client must forward the caller's JWT (Bearer path) or fall back to the
// cookie client (web) — both RLS-scoped. We mock the helper so we can both drive
// the read result AND assert the route built its client from this Bearer-aware
// factory (so a future regression back to admin/cookie-only is caught).
const mockCreateRouteClient = vi.fn(async () => ({ from: mockFrom }));

vi.mock('@alfanumrik/lib/rbac', () => ({ authorizeRequest: mockAuthorizeRequest }));
vi.mock('@alfanumrik/lib/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }));
vi.mock('@alfanumrik/lib/supabase-route', () => ({
  createSupabaseRouteClient: (...args: unknown[]) => mockCreateRouteClient(...(args as [])),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const AUTH_OK = {
  authorized: true as const,
  userId: STUDENT_ID,
  studentId: STUDENT_ID,
  roles: ['student'],
  permissions: ['study_plan.view'],
};

const AUTH_DENIED_401 = () => ({
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

function buildRequest(): Request {
  return new Request('http://localhost/api/student/daily-plan', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthorizeRequest.mockResolvedValue(AUTH_OK);
  mockIsFeatureEnabled.mockResolvedValue(false);
  mockSingle.mockResolvedValue({
    data: { id: STUDENT_ID, academic_goal: null, class_id: null },
    error: null,
  });
  mockMaybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
});

describe('GET /api/student/daily-plan: auth', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_401());
    const { GET } = await import('@/app/api/student/daily-plan/route');
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(401);
  });

  it('uses study_plan.view permission code', async () => {
    const { GET } = await import('@/app/api/student/daily-plan/route');
    await GET(buildRequest() as never);
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(
      expect.anything(),
      'study_plan.view',
      expect.objectContaining({ requireStudentId: true }),
    );
  });
});

describe('GET /api/student/daily-plan: flag OFF', () => {
  it('returns empty plan with flagEnabled false even when goal is set', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(false);
    mockSingle.mockResolvedValueOnce({
      data: { id: STUDENT_ID, academic_goal: 'board_topper' },
      error: null,
    });
    const { GET } = await import('@/app/api/student/daily-plan/route');
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.flagEnabled).toBe(false);
    expect(body.data.goal).toBeNull();
    expect(body.data.totalMinutes).toBe(0);
    expect(body.data.items).toEqual([]);
  });
});

describe('GET /api/student/daily-plan: flag ON', () => {
  it('returns 4-item plan for board_topper (45 min)', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockSingle.mockResolvedValueOnce({
      data: { id: STUDENT_ID, academic_goal: 'board_topper' },
      error: null,
    });
    const { GET } = await import('@/app/api/student/daily-plan/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.flagEnabled).toBe(true);
    expect(body.data.goal).toBe('board_topper');
    expect(body.data.items.length).toBe(4);
    expect(body.data.totalMinutes).toBe(45);
    expect(body.data.items[0].kind).toBe('pyq');
  });

  it('returns 2-item plan for improve_basics (10 min)', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockSingle.mockResolvedValueOnce({
      data: { id: STUDENT_ID, academic_goal: 'improve_basics' },
      error: null,
    });
    const { GET } = await import('@/app/api/student/daily-plan/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.data.goal).toBe('improve_basics');
    expect(body.data.items.length).toBe(2);
    expect(body.data.totalMinutes).toBe(10);
  });

  it('returns empty plan when goal is null but flag on', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockSingle.mockResolvedValueOnce({
      data: { id: STUDENT_ID, academic_goal: null },
      error: null,
    });
    const { GET } = await import('@/app/api/student/daily-plan/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.flagEnabled).toBe(true);
    expect(body.data.goal).toBeNull();
    expect(body.data.items).toEqual([]);
  });

  it('returns empty plan when goal is unknown string', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockSingle.mockResolvedValueOnce({
      data: { id: STUDENT_ID, academic_goal: 'not_a_real_goal' },
      error: null,
    });
    const { GET } = await import('@/app/api/student/daily-plan/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();
    expect(body.flagEnabled).toBe(true);
    expect(body.data.goal).toBeNull();
    expect(body.data.items).toEqual([]);
  });

  it('returns classroom-aligned daily plan if classroom lesson plan exists', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockSingle.mockResolvedValueOnce({
      data: { id: STUDENT_ID, academic_goal: 'board_topper', class_id: 'class-123' },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        topic_id: 'topic-999',
        curriculum_topics: { id: 'topic-999', title: 'Quadratic Equations' },
      },
      error: null,
    });

    const { GET } = await import('@/app/api/student/daily-plan/route');
    const res = await GET(buildRequest() as never);
    const body = await res.json();

    expect(body.flagEnabled).toBe(true);
    expect(body.intercepted).toBe(true);
    expect(body.data.items.length).toBe(2);
    expect(body.data.items[0].kind).toBe('concept');
    expect(body.data.items[0].titleEn).toContain('Quadratic Equations');
    expect(body.data.items[1].kind).toBe('practice');
    expect(body.data.items[1].titleEn).toContain('Quadratic Equations');
  });
});

describe('GET /api/student/daily-plan: error handling', () => {
  it('returns 404 when student row missing', async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows', code: 'PGRST116' },
    });
    const { GET } = await import('@/app/api/student/daily-plan/route');
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('student_not_found');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'daily-plan.student_not_found',
      expect.objectContaining({ studentId: 'present' }),
    );
  });
});

describe('GET /api/student/daily-plan: P13 PII redaction', () => {
  it('logger.info payload uses studentId present (NEVER raw UUID)', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockSingle.mockResolvedValueOnce({
      data: { id: STUDENT_ID, academic_goal: 'board_topper' },
      error: null,
    });
    const { GET } = await import('@/app/api/student/daily-plan/route');
    await GET(buildRequest() as never);
    expect(mockLoggerInfo).toHaveBeenCalledTimes(1);
    const [event, payload] = mockLoggerInfo.mock.calls[0];
    expect(event).toBe('daily-plan.requested');
    expect(payload.studentId).toBe('present');
    expect(payload.studentId).not.toBe(STUDENT_ID);
    expect(payload).toMatchObject({
      flagEnabled: true,
      hasGoal: true,
      itemCount: 4,
    });
    expect(payload).not.toHaveProperty('email');
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('phone');
  });
});

// ── XC-3 Phase 2 batch 3 — Bearer-aware RLS contract (REG-220) ───────────────
// Proves the admin→createSupabaseRouteClient swap (a) preserves the byte-identical
// envelope for the authenticated OWNER, (b) fails CLOSED (404, no plan payload)
// when RLS denies the students read, and (c) builds its data client from the
// Bearer-AWARE factory (so a future regression back to the RLS-bypassing admin
// client OR the cookie-only server client — which would break the mobile Bearer
// caller — is caught here).
describe('GET /api/student/daily-plan — Bearer-aware RLS contract (admin→route-client migration)', () => {
  it('uses the Bearer-aware createSupabaseRouteClient (NOT admin / NOT cookie-only) and forwards the request', async () => {
    const req = buildRequest();
    const { GET } = await import('@/app/api/student/daily-plan/route');
    await GET(req as never);
    // The route MUST build its data client from the Bearer-aware factory, passing
    // the request so the caller's Authorization: Bearer JWT (mobile) is forwarded
    // to PostgREST for RLS. A swap back to supabase-admin or the cookie-only
    // createSupabaseServerClient() would NOT call this and would fail this test.
    expect(mockCreateRouteClient).toHaveBeenCalledTimes(1);
    expect(mockCreateRouteClient).toHaveBeenCalledWith(req);
  });

  it('authenticated owner: returns the byte-identical envelope (flag ON, board_topper)', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(true);
    mockSingle.mockResolvedValueOnce({
      data: { id: STUDENT_ID, academic_goal: 'board_topper', class_id: null },
      error: null,
    });
    const { GET } = await import('@/app/api/student/daily-plan/route');
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Exact envelope keys the admin-client version returned — no drift.
    expect(Object.keys(body).sort()).toEqual(
      ['data', 'flagEnabled', 'intercepted', 'success'].sort(),
    );
    expect(body.success).toBe(true);
    expect(body.flagEnabled).toBe(true);
    expect(body.intercepted).toBe(false);
    expect(body.data.goal).toBe('board_topper');
    expect(body.data.items.length).toBe(4);
    expect(body.data.totalMinutes).toBe(45);
  });

  it('RLS denies the students read (cross-user / unauthenticated): fails CLOSED with 404 and no plan payload', async () => {
    // Under the RLS-scoped client, a caller whose auth.uid() does not own this
    // student row gets NO row back (students_select_merged hides it). The route
    // must 404 'student_not_found' — never fabricate or leak another student's
    // plan, never 500.
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows', code: 'PGRST116' },
    });
    const { GET } = await import('@/app/api/student/daily-plan/route');
    const res = await GET(buildRequest() as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('student_not_found');
    expect(body).not.toHaveProperty('data');
  });
});
