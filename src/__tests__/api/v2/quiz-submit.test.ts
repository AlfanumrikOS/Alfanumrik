/**
 * Contract + PARITY tests for POST /api/v2/quiz/submit.
 *
 * The /v2 submit route is an ASSESSMENT-APPROVED THIN PASS-THROUGH (P1-P6):
 * it calls the SAME RPC (submit_quiz_results_v2) with the SAME mapped args as
 * /api/quiz/submit and returns the RPC result VERBATIM. These tests pin:
 *   - Idempotency-Key required (400 when missing/non-UUID),
 *   - auth 401 + RBAC permission code, JWT/body studentId 403 mismatch,
 *   - the RPC is called with the SAME mapped args (selected_displayed_index,
 *     time_spent, p_time, p_idempotency_key) — the parity contract,
 *   - RPC values returned verbatim (no recompute) in the /v2 envelope,
 *   - error translation: P0001 → 409, unique-violation → cached replay, else → 503.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/ops-events', () => ({ logOpsEvent: vi.fn().mockResolvedValue(undefined) }));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';

let _studentLookup: { data: { id: string } | null } = { data: { id: STUDENT_A } };
let _cachedRow: { data: Record<string, unknown> | null } = { data: null };

function adminFromMock(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () =>
    Promise.resolve(table === 'quiz_sessions' ? _cachedRow : _studentLookup);
  chain.single = () => Promise.resolve(_studentLookup);
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => adminFromMock(t) }),
}));

let _rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const rpcSpy = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => {
      rpcSpy(...args);
      return Promise.resolve(_rpcResult);
    },
  }),
}));

function setAuthorized(userId = 'auth-user-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['student'],
    permissions: ['quiz.attempt'],
  });
}

function makeRequest(opts: {
  bodyStudentId?: string;
  idemKey?: string | null;
  body?: Record<string, unknown>;
} = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.idemKey !== null) headers['idempotency-key'] = opts.idemKey ?? IDEMPOTENCY_KEY;
  return new Request('http://localhost/api/v2/quiz/submit', {
    method: 'POST',
    headers,
    body: JSON.stringify(
      opts.body ?? {
        sessionId: SESSION_ID,
        studentId: opts.bodyStudentId ?? STUDENT_A,
        responses: [{ question_id: QUESTION_ID, selected_option: 2, time_taken_seconds: 7 }],
        totalTimeSeconds: 42,
        subject: 'math',
        grade: '9',
        topic: 'algebra',
        chapter: 3,
      },
    ),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;
beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _studentLookup = { data: { id: STUDENT_A } };
  _cachedRow = { data: null };
  _rpcResult = { data: null, error: null };
  POST = (await import('@/app/api/v2/quiz/submit/route')).POST;
});

describe('POST /api/v2/quiz/submit — auth + idempotency', () => {
  it('returns 401 when unauthenticated', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false,
      userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('uses the quiz.attempt permission code', async () => {
    await POST(makeRequest());
    expect(_authorizeImpl).toHaveBeenCalledWith(expect.anything(), 'quiz.attempt');
  });

  it('returns 400 when Idempotency-Key is missing', async () => {
    const res = await POST(makeRequest({ idemKey: null }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('returns 400 when Idempotency-Key is not a UUID', async () => {
    const res = await POST(makeRequest({ idemKey: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('returns 403 when JWT student A but body claims student B', async () => {
    _studentLookup = { data: { id: STUDENT_A } };
    const res = await POST(makeRequest({ bodyStudentId: STUDENT_B }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('STUDENT_ID_MISMATCH');
  });

  it('returns 403 when no student profile is linked', async () => {
    _studentLookup = { data: null };
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_STUDENT_PROFILE');
  });

  it('returns 400 on invalid body (selected_option out of range)', async () => {
    const res = await POST(
      makeRequest({
        body: {
          sessionId: SESSION_ID,
          studentId: STUDENT_A,
          responses: [{ question_id: QUESTION_ID, selected_option: 9, time_taken_seconds: 5 }],
          totalTimeSeconds: 10,
        },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/v2/quiz/submit — RPC parity (mirrors /api/quiz/submit)', () => {
  it('calls submit_quiz_results_v2 with the SAME mapped args as /api/quiz/submit', async () => {
    _rpcResult = {
      data: {
        session_id: SESSION_ID,
        score_percent: 80,
        xp_earned: 100,
        correct: 8,
        total: 10,
        flagged: false,
        idempotent_replay: false,
      },
      error: null,
    };

    await POST(makeRequest());

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [rpcName, args] = rpcSpy.mock.calls[0];
    expect(rpcName).toBe('submit_quiz_results_v2');
    // The PARITY contract: rename-only mapping + identical scalar args.
    expect(args).toEqual({
      p_session_id: SESSION_ID,
      p_student_id: STUDENT_A,
      p_subject: 'math',
      p_grade: '9',
      p_topic: 'algebra',
      p_chapter: 3,
      p_responses: [
        { question_id: QUESTION_ID, selected_displayed_index: 2, time_spent: 7 },
      ],
      p_time: 42,
      p_idempotency_key: IDEMPOTENCY_KEY,
    });
  });

  it('returns RPC score/xp VERBATIM (no recompute) in the /v2 envelope', async () => {
    _rpcResult = {
      data: {
        session_id: SESSION_ID,
        // Deliberately "wrong" math the route must NOT recompute — server is authoritative.
        score_percent: 73,
        xp_earned: 137,
        correct: 8,
        total: 10,
        flagged: false,
        idempotent_replay: false,
        xp_capped: true,
      },
      error: null,
    };

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.score_percent).toBe(73);
    expect(body.data.xp_earned).toBe(137);
    expect(body.data.correct).toBe(8);
    expect(body.data.total).toBe(10);
    expect(body.data.xp_capped).toBe(true);
    expect(body.data.marking_authenticity_path).toBe('oracle_v2');
  });

  it('falls back unknown subject/grade to the SAME defaults as /api/quiz/submit', async () => {
    _rpcResult = {
      data: { session_id: SESSION_ID, score_percent: 0, xp_earned: 0, correct: 0, total: 1, flagged: false, idempotent_replay: false },
      error: null,
    };
    await POST(
      makeRequest({
        body: {
          sessionId: SESSION_ID,
          studentId: STUDENT_A,
          responses: [{ question_id: QUESTION_ID, selected_option: 0, time_taken_seconds: 5 }],
          totalTimeSeconds: 10,
        },
      }),
    );
    const [, args] = rpcSpy.mock.calls[0];
    expect(args.p_subject).toBe('unknown');
    expect(args.p_grade).toBe('0');
    expect(args.p_topic).toBeNull();
    expect(args.p_chapter).toBeNull();
  });
});

describe('POST /api/v2/quiz/submit — error translation', () => {
  it('translates P0001 session_not_started → 409', async () => {
    _rpcResult = { data: null, error: { message: 'session_not_started: bad', code: 'P0001' } };
    const res = await POST(makeRequest());
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SESSION_NOT_STARTED');
  });

  it('translates a unique-violation into a cached idempotent replay (200)', async () => {
    _rpcResult = { data: null, error: { message: 'duplicate key value', code: '23505' } };
    _cachedRow = {
      data: { id: SESSION_ID, total_questions: 10, correct_answers: 8, score_percent: 80, score: 100 },
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.idempotent_replay).toBe(true);
    expect(body.data.score_percent).toBe(80);
    expect(body.data.xp_earned).toBe(100);
  });

  it('returns 503 on any other RPC failure (retry with same key)', async () => {
    _rpcResult = { data: null, error: { message: 'connection reset', code: '08006' } };
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('RPC_FAILED');
  });

  it('returns 503 when the RPC returns an empty result', async () => {
    _rpcResult = { data: null, error: null };
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('EMPTY_RESPONSE');
  });
});
