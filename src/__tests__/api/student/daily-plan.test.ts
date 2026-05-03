/**
 * Daily Plan API tests (Phase 3 of Goal-Adaptive Learning Layers).
 * Pins the contract for src/app/api/student/daily-plan/route.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuthorizeRequest = vi.fn();
const mockIsFeatureEnabled = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ single: mockSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({ select: mockSelect }));
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock('@/lib/rbac', () => ({ authorizeRequest: mockAuthorizeRequest }));
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }));
vi.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: mockFrom } }));
vi.mock('@/lib/logger', () => ({
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
    data: { id: STUDENT_ID, academic_goal: null },
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
