/**
 * GET /api/v2/parent/glance — Wave 2.4 contract tests.
 *
 * Pins:
 *   1. authorizeRequest gate fires with `child.view_progress` and returns the
 *      auth errorResponse verbatim when not authorized.
 *   2. 400 when student_id is missing / not a UUID (Zod-style validation).
 *   3. 403 when the caller has no guardian profile.
 *   4. 403 when the guardian is NOT linked to the requested student
 *      (cross-guardian isolation, P13).
 *   5. 200 happy path: reuses the parent-portal `get_child_dashboard` payload
 *      and shapes it into snapshot + moments + weeklyActivity; envelope +
 *      schemaVersion correct; response data round-trips through the registered
 *      Zod schema. P5 grade string; P13 no PII leak.
 *   6. 502 when the Edge Function is unreachable / errors; 404 when it returns
 *      an error payload. No raw upstream error text reaches the client.
 *
 * The parent-portal Edge Function is reached via global fetch; we stub fetch.
 * authorizeRequest + the domain helpers are mocked like the encourage route test.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ParentGlanceResponse } from '@alfanumrik/lib/api/v2/contract';
import { z } from 'zod';

const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockGetGuardian: vi.fn(),
  mockIsLinked: vi.fn(),
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
}));

vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getGuardianByAuthUserId: (...a: unknown[]) => holders.mockGetGuardian(...a),
}));

vi.mock('@alfanumrik/lib/domains/relationship', () => ({
  isGuardianLinkedToStudent: (...a: unknown[]) => holders.mockIsLinked(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const GUARDIAN_AUTH = '11111111-1111-4111-a111-111111111111';
const GUARDIAN_ID = '22222222-2222-4222-a222-222222222222';
const STUDENT_X = '33333333-3333-4333-a333-333333333333';

const successEnvelope = z.object({ success: z.literal(true), data: ParentGlanceResponse });

function makeRequest(studentId: string | null = STUDENT_X): Request {
  const url = studentId
    ? `http://localhost/api/v2/parent/glance?student_id=${studentId}`
    : 'http://localhost/api/v2/parent/glance';
  return new Request(url, { method: 'GET', headers: { Authorization: 'Bearer fake.jwt.x' } });
}

function authAsParent(userId: string = GUARDIAN_AUTH) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['parent'],
    permissions: ['child.view_progress'],
  });
}

function asGuardian(id: string = GUARDIAN_ID) {
  holders.mockGetGuardian.mockResolvedValue({
    ok: true,
    data: { id, authUserId: GUARDIAN_AUTH, name: 'Test Parent', email: 'p@x.com', phone: '+919999999999' },
  });
}

function linked(value = true) {
  holders.mockIsLinked.mockResolvedValue({ ok: true, data: value });
}

/** A representative get_child_dashboard payload (subset the route reads). */
const DASH_PAYLOAD = {
  name: 'Asha',
  grade: '9',
  student: { name: 'Asha', grade: '9' },
  stats: { xp: 1450, streak: 7, accuracy: 72, totalQuizzes: 23, minutes: 120, totalChats: 11, avgScore: 68 },
  dailyActivity: [
    { label: 'Mon', active: true, quizzes: 2 },
    { label: 'Tue', active: false, quizzes: 0 },
  ],
  weekSummary: { quizzes: 4, avgScore: 68, activeDays: 3 },
  bktMastery: { levels: { mastered: 5, proficient: 2, familiar: 1, attempted: 0 }, total: 8 },
  insights: ['Strong performance with 72% accuracy overall.'],
};

function stubFetch(ok: boolean, status: number, jsonBody: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: () => Promise.resolve(jsonBody),
    } as Response),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('GET /api/v2/parent/glance — auth gate', () => {
  it('returns the authorizeRequest errorResponse when not authorized', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(403);
    expect(holders.mockGetGuardian).not.toHaveBeenCalled();
  });

  it('asks authorizeRequest for the child.view_progress permission', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    asGuardian();
    linked(true);
    stubFetch(true, 200, DASH_PAYLOAD);
    await GET(makeRequest() as never);
    const [, perm] = holders.mockAuthorize.mock.calls[0];
    expect(perm).toBe('child.view_progress');
  });
});

describe('GET /api/v2/parent/glance — validation', () => {
  it('returns 400 when student_id is missing', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    const res = await GET(makeRequest(null) as never);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(holders.mockGetGuardian).not.toHaveBeenCalled();
  });

  it('returns 400 when student_id is not a valid UUID', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    const res = await GET(makeRequest('not-a-uuid') as never);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v2/parent/glance — ownership', () => {
  it('returns 403 when the caller has no guardian profile', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    holders.mockGetGuardian.mockResolvedValue({ ok: true, data: null });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/parent/i);
  });

  it('returns 403 when the guardian is NOT linked to the student (no data fetched)', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    authAsParent();
    asGuardian();
    linked(false);
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not linked/i);
    // No upstream data fetch happens for an unlinked child.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/v2/parent/glance — happy path', () => {
  it('shapes the get_child_dashboard payload into snapshot + moments + weeklyActivity', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    asGuardian();
    linked(true);
    stubFetch(true, 200, DASH_PAYLOAD);

    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);

    // child: P5 grade string.
    expect(body.data.child).toEqual({ student_id: STUDENT_X, name: 'Asha', grade: '9' });
    expect(typeof body.data.child.grade).toBe('string');

    // snapshot lifted verbatim from the Edge Function stats/weekSummary.
    expect(body.data.snapshot.sessions_this_week).toBe(4);
    expect(body.data.snapshot.streak_days).toBe(7);
    expect(body.data.snapshot.accuracy).toBe(72);
    expect(body.data.snapshot.avg_score).toBe(68);
    expect(body.data.snapshot.time_minutes).toBe(120);

    // moments derived from the same existing fields.
    expect(Array.isArray(body.data.moments.highlights)).toBe(true);
    expect(body.data.moments.highlights.join(' ')).toMatch(/quiz/i);
    expect(body.data.moments.highlights.join(' ')).toMatch(/streak/i);
    expect(body.data.moments.suggestion).toBe('Strong performance with 72% accuracy overall.');

    // weeklyActivity passthrough.
    expect(body.data.weeklyActivity).toHaveLength(2);
    expect(body.data.weeklyActivity[0]).toEqual({ label: 'Mon', active: true, quizzes: 2 });

    // Reuse: the Edge Function get_child_dashboard action was called with the
    // forwarded Bearer JWT.
    const fetchMock = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as { body: string }).body).action).toBe('get_child_dashboard');
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer fake.jwt.x');

    // P13: no guardian PII in the payload.
    const str = JSON.stringify(body.data);
    expect(str).not.toMatch(/p@x\.com/);
    expect(str).not.toMatch(/\+919999999999/);
  });

  it('surfaces concerns when the child is struggling (low accuracy, no streak)', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    asGuardian();
    linked(true);
    stubFetch(true, 200, {
      ...DASH_PAYLOAD,
      stats: { ...DASH_PAYLOAD.stats, streak: 0, accuracy: 38 },
      weekSummary: { quizzes: 0, avgScore: 0, activeDays: 0 },
    });
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    const concerns = body.data.moments.concerns.join(' ');
    expect(concerns).toMatch(/streak/i);
    expect(concerns).toMatch(/38%/);
  });

  it('response data round-trips through the registered Zod schema', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    asGuardian();
    linked(true);
    stubFetch(true, 200, DASH_PAYLOAD);
    const res = await GET(makeRequest() as never);
    const body = await res.json();
    const parsed = successEnvelope.safeParse(body);
    if (!parsed.success) {
      throw new Error(`conformance failed: ${JSON.stringify(parsed.error.issues, null, 2)}`);
    }
    expect(parsed.success).toBe(true);
  });
});

describe('GET /api/v2/parent/glance — upstream failures', () => {
  it('returns 502 with no raw upstream text when the Edge Function 500s', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    asGuardian();
    linked(true);
    stubFetch(false, 500, { error: 'internal edge boom' });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).not.toMatch(/edge boom/);
  });

  it('returns 502 when fetch itself throws (Edge Function unreachable)', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    asGuardian();
    linked(true);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).not.toMatch(/network down/);
  });

  it('returns 404 when the Edge Function payload carries an error', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    asGuardian();
    linked(true);
    stubFetch(true, 200, { error: 'Student not found' });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('NO_DATA');
  });

  it('maps a 403 from the Edge Function to a 403 not-linked response', async () => {
    const { GET } = await import('@/app/api/v2/parent/glance/route');
    authAsParent();
    asGuardian();
    linked(true);
    stubFetch(false, 403, { error: 'You do not have access to this child\'s data.' });
    const res = await GET(makeRequest() as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NOT_LINKED');
  });
});
