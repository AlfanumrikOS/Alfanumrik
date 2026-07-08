/**
 * Contract tests for GET /api/v2/today (Consumer Minimalism Wave A BFF).
 *
 * Pins:
 *   - auth: 401 when unauthenticated, study_plan.view permission code used,
 *   - flag gate: 404 when ff_today_home_v1 is OFF,
 *   - flag ON: TodayResponse envelope shape (schemaVersion 1, primary, queue,
 *     meta), with primary === queue[0] and items projected via the mapper,
 *   - no-profile → 404 (not 500).
 *
 * The state builders are mocked the same way existing api-route tests mock
 * their dependencies (see src/__tests__/api/student/daily-plan.test.ts). The
 * REAL resolveTodayQueue runs over a hand-built StudentState so the envelope
 * reflects genuine resolver output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAuthorizeRequest = vi.fn();
const mockIsFeatureEnabled = vi.fn();
const mockBuildLoopAugmentation = vi.fn();
const mockBuildState = vi.fn();

vi.mock('@alfanumrik/lib/rbac', () => ({ authorizeRequest: mockAuthorizeRequest }));
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
  CONSUMER_MINIMALISM_FLAGS: { TODAY_HOME_V1: 'ff_today_home_v1' },
}));
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({ __sb: true }),
}));
// Phase 3A Wave A / A3 — the route now resolves an admin client for the
// teacher-remediation read + status flip. The flip only runs for an `assigned`
// pendingTeacherRemediation (none in these fixtures), so the client is unused
// beyond being constructed; a stub object is sufficient.
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => ({ __admin: true })),
}));
vi.mock('@alfanumrik/lib/state/student-state-builder', () => ({
  createStudentStateBuilder: vi.fn(() => mockBuildState),
}));
// Keep the REAL resolveTodayQueue; only stub the I/O augmenter.
vi.mock('@alfanumrik/lib/state/learner-loop/resolve-next-action', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/state/learner-loop/resolve-next-action')>();
  return { ...actual, buildLoopAugmentation: mockBuildLoopAugmentation };
});
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const AUTH_USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const AUTH_OK = {
  authorized: true as const,
  userId: AUTH_USER_ID,
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

/** A StudentState with a single weak chapter and idle live state — the
 *  resolver's catch-all (start_quiz / practice_weakest) fires. */
function buildState(overrides: Record<string, unknown> = {}) {
  return {
    studentId: STUDENT_ID,
    mastery: [
      {
        subjectCode: 'math',
        meanMastery: 0.5,
        chapters: [
          { chapterNumber: 4, mastery: 0.5, lastUpdatedAt: null, attempts: 20 },
        ],
      },
    ],
    live: { kind: 'idle' },
    ...overrides,
  };
}

function buildRequest(): Request {
  return new Request('http://localhost/api/v2/today', { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  // DETERMINISM: the route calls `new Date()` and passes it into
  // resolveTodayQueue, whose branches 6/7 (weekly_dive on Sunday IST,
  // monthly_synthesis on the last calendar day of the month IST) fire on
  // calendar-dependent days. Without a pinned clock these tests pass on a
  // weekday and FAIL on a Sunday / month-end (e.g. 2026-06-07 is a Sunday),
  // because the asserted catch-all `start_quiz` branch is shadowed by
  // weekly_dive. Pin the system clock to a known weekday, non-month-end
  // instant so the asserted branch is stable on every real calendar date.
  //   2026-06-10T09:00+05:30 = Wednesday, 10 June (well clear of month-end),
  //   09:00 IST → 03:30 UTC, isSundayIst=false, isMonthEndDayIst=false.
  vi.setSystemTime(new Date('2026-06-10T09:00:00+05:30'));
  mockAuthorizeRequest.mockResolvedValue(AUTH_OK);
  mockIsFeatureEnabled.mockResolvedValue(true);
  mockBuildState.mockResolvedValue(buildState());
  mockBuildLoopAugmentation.mockResolvedValue({
    dueReviewCount: 0,
    attemptedQuizToday: true, // suppress branch 4 so branch 8 (catch-all) wins
    inProgressLessons: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/v2/today — auth', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuthorizeRequest.mockResolvedValueOnce(AUTH_DENIED_401());
    const { GET } = await import('@/app/api/v2/today/route');
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
  });

  it('uses the study_plan.view permission code with requireStudentId', async () => {
    const { GET } = await import('@/app/api/v2/today/route');
    await GET(buildRequest());
    expect(mockAuthorizeRequest).toHaveBeenCalledWith(
      expect.anything(),
      'study_plan.view',
      expect.objectContaining({ requireStudentId: true }),
    );
  });
});

describe('GET /api/v2/today — flag gate', () => {
  it('returns 404 when ff_today_home_v1 is OFF', async () => {
    mockIsFeatureEnabled.mockResolvedValueOnce(false);
    const { GET } = await import('@/app/api/v2/today/route');
    const res = await GET(buildRequest());
    expect(res.status).toBe(404);
  });

  it('reads the ff_today_home_v1 flag with a student context', async () => {
    const { GET } = await import('@/app/api/v2/today/route');
    await GET(buildRequest());
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith(
      'ff_today_home_v1',
      expect.objectContaining({ userId: AUTH_USER_ID, role: 'student' }),
    );
  });
});

describe('GET /api/v2/today — envelope (flag ON)', () => {
  it('returns the TodayResponse shape with primary === queue[0]', async () => {
    const { GET } = await import('@/app/api/v2/today/route');
    const res = await GET(buildRequest());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.schemaVersion).toBe(1);
    expect(typeof body.resolvedAt).toBe('string');
    expect(Array.isArray(body.queue)).toBe(true);
    expect(body.queue.length).toBeGreaterThan(0);
    expect(body.primary).toEqual(body.queue[0]);

    // Catch-all branch → render type practice_weakest, deep-linked into /quiz.
    expect(body.primary.type).toBe('practice_weakest');
    expect(body.primary.rank).toBe(1);
    expect(body.primary.deepLink.route).toBe('/quiz');
    expect(body.primary.deepLink.params).toMatchObject({ subject: 'math', chapter: 4 });
    expect(body.primary.labelKey).toBe('today.item.practice_weakest.label');

    // Meta from result.branch + state.mastery.length + augmentation.dueReviewCount.
    expect(body.meta.branch).toBe('start_quiz');
    expect(body.meta.masterySubjectCount).toBe(1);
    expect(body.meta.dueReviewCount).toBe(0);
  });

  it('sets the 30s private Cache-Control header', async () => {
    const { GET } = await import('@/app/api/v2/today/route');
    const res = await GET(buildRequest());
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=30, must-revalidate');
  });

  it('prepends a resume CTA when the learner is mid-lesson', async () => {
    mockBuildState.mockResolvedValueOnce(
      buildState({
        live: { kind: 'in_lesson', lessonId: 'x', subjectCode: 'science', chapterNumber: 7, startedAt: new Date().toISOString() },
      }),
    );
    const { GET } = await import('@/app/api/v2/today/route');
    const res = await GET(buildRequest());
    const body = await res.json();
    expect(body.primary.type).toBe('resume_in_progress');
    expect(body.primary.deepLink.route).toBe('/learn/science/7');
    expect(body.primary.meta).toMatchObject({ liveKind: 'in_lesson', subjectCode: 'science', chapterNumber: 7 });
    // branch still reports what the RAW resolver would have chosen.
    expect(body.meta.branch).toBe('start_quiz');
  });
});

describe('GET /api/v2/today — no profile', () => {
  it('returns 404 (not 500) when the state builder throws', async () => {
    mockBuildState.mockRejectedValueOnce(new Error('no student row'));
    const { GET } = await import('@/app/api/v2/today/route');
    const res = await GET(buildRequest());
    expect(res.status).toBe(404);
  });
});
