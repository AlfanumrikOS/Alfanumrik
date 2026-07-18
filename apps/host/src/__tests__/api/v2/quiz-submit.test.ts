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
 *
 * Wave 2.3 — POST-SUBMIT SIDE-EFFECT PARITY with /api/quiz/submit:
 *   - on a successful (non-replay) submit the SAME shared side-effects run —
 *     PostHog `quiz_graded` + `xp_awarded` capture AND the ADR-005 spine emit
 *     `publishEvent(learner.mastery_changed)` — with the SAME args the web
 *     route uses (both routes call runQuizSubmitSideEffects, single source),
 *   - on an idempotent replay NEITHER fires (no funnel double-count, no
 *     double-publish on the bus).
 * The side-effects mock @alfanumrik/lib/posthog/server + @alfanumrik/lib/state/events/publish the
 * same way the web route's tests do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const logOpsEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({ logOpsEvent: (...a: unknown[]) => logOpsEventMock(...a) }));

// ── Side-effect dependency mocks (mirror /api/quiz/submit's tests) ──────────
// runQuizSubmitSideEffects() (the SHARED post-submit code path) fans out to
// PostHog capture, the ADR-005 bus publishEvent, and the orchestrator bridge.
// We mock those leaf modules so the REAL side-effects orchestration runs and
// we can assert the same args the web route emits.
const posthogCaptureMock = vi.fn().mockResolvedValue(undefined);
// Partial mock: keep the REAL hashDistinctId (submit-side-effects imports it
// for the quiz_graded auth.uid stitch — Wave 2, commit 4e2288fa). A
// `() => ({ capture })` factory that omits it makes every fresh-grade path
// throw "No hashDistinctId export is defined on the mock".
vi.mock('@alfanumrik/lib/posthog/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/posthog/server')>();
  return { ...actual, capture: (...a: unknown[]) => posthogCaptureMock(...a) };
});
// Real hashDistinctId (preserved by the partial mock above) — used to assert the
// quiz_graded distinctId is the hashed AUTH uid, not the raw students.id.
import { hashDistinctId } from '@alfanumrik/lib/posthog/server';

const publishEventMock = vi.fn().mockResolvedValue({ published: false, reason: 'flag_off' });
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: (...a: unknown[]) => publishEventMock(...a),
}));

const maybeDispatchMock = vi
  .fn()
  .mockResolvedValue({ ranOrchestrator: false, publishedEventCount: 0 });
vi.mock('@alfanumrik/lib/state/quiz-orchestrator-bridge', () => ({
  maybeDispatchQuizCompletion: (...a: unknown[]) => maybeDispatchMock(...a),
}));

/** Flush pending microtasks so the spine-emit IIFE's deferred publishEvent runs. */
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';

let _studentLookup: { data: { id: string } | null } = { data: { id: STUDENT_A } };
let _cachedRow: { data: Record<string, unknown> | null } = { data: null };
// Server-stored quiz_session_shuffles snapshot rows (Wave 2.5.1 offline gate).
let _shuffleRows: { data: Array<{ question_id: string; shuffle_map: number[] }> | null } = {
  data: null,
};

function adminFromMock(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is']) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () =>
    Promise.resolve(table === 'quiz_sessions' ? _cachedRow : _studentLookup);
  chain.single = () => Promise.resolve(_studentLookup);
  // The quiz_session_shuffles read terminates on `.eq()` (no maybeSingle), so
  // the chain itself must be awaitable → make it a thenable resolving to the
  // snapshot rows for that table.
  chain.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown,
  ) => {
    const value = table === 'quiz_session_shuffles' ? _shuffleRows : { data: null };
    return Promise.resolve(value).then(resolve, reject);
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => adminFromMock(t) }),
}));

let _rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const rpcSpy = vi.fn();
vi.mock('@alfanumrik/lib/supabase-server', () => ({
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
  _shuffleRows = { data: null };
  _rpcResult = { data: null, error: null };
  posthogCaptureMock.mockResolvedValue(undefined);
  publishEventMock.mockResolvedValue({ published: false, reason: 'flag_off' });
  maybeDispatchMock.mockResolvedValue({ ranOrchestrator: false, publishedEventCount: 0 });
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

describe('POST /api/v2/quiz/submit — post-submit side-effect parity (Wave 2.3)', () => {
  const FRESH_RPC = {
    session_id: SESSION_ID,
    score_percent: 80,
    xp_earned: 100,
    correct: 8,
    total: 10,
    flagged: false,
    idempotent_replay: false,
  };

  it('emits PostHog quiz_graded once with the SAME payload the web route uses', async () => {
    _rpcResult = { data: FRESH_RPC, error: null };

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    await flushAsync();

    const gradedCalls = posthogCaptureMock.mock.calls.filter((c) => c[0] === 'quiz_graded');
    expect(gradedCalls).toHaveLength(1);
    // event, distinctId, properties, $insert_id — identical to /api/quiz/submit.
    // Wave 2 (commit 4e2288fa): quiz_graded distinctId is hashDistinctId(authUserId)
    // — the hashed AUTH uid ('auth-user-1' here; see the spine-emit test below) —
    // NOT the raw students.id (STUDENT_A). Keying by students.id would stitch the
    // activation funnel to a PHANTOM person and read a false 0%. Both routes call
    // the same runQuizSubmitSideEffects, so this value is identical across them.
    const [, distinctId, props, insertId] = gradedCalls[0];
    expect(distinctId).toBe(hashDistinctId('auth-user-1'));
    expect(distinctId).not.toBe(STUDENT_A);
    expect(props).toMatchObject({
      session_id: SESSION_ID,
      score_percent: 80,
      xp_earned: 100,
      correct: 8,
      total: 10,
      marking_authenticity_path: 'oracle_v2',
      anti_cheat_flagged: false,
      idempotent_replay: false,
    });
    expect(insertId).toBe(`quiz_graded:${SESSION_ID}`);
  });

  it('emits PostHog xp_awarded once with the SAME payload the web route uses', async () => {
    _rpcResult = { data: FRESH_RPC, error: null };

    await POST(makeRequest());
    await flushAsync();

    const xpCalls = posthogCaptureMock.mock.calls.filter((c) => c[0] === 'xp_awarded');
    expect(xpCalls).toHaveLength(1);
    const [, distinctId, props, insertId] = xpCalls[0];
    expect(distinctId).toBe(STUDENT_A);
    expect(props).toMatchObject({
      xp_delta: 100,
      source: 'quiz',
      daily_total_after: 100,
      capped: false,
    });
    expect(insertId).toBe(`xp_awarded:quiz:${SESSION_ID}`);
  });

  it('emits publishEvent(learner.mastery_changed) on the ADR-005 spine with the SAME envelope', async () => {
    _rpcResult = { data: FRESH_RPC, error: null };

    await POST(makeRequest());
    await flushAsync();

    expect(publishEventMock).toHaveBeenCalled();
    // The single response maps to the primary chapter (3) → one mastery delta.
    const masteryCalls = publishEventMock.mock.calls.filter(
      (c) => (c[1] as { kind?: string })?.kind === 'learner.mastery_changed',
    );
    expect(masteryCalls).toHaveLength(1);
    const event = masteryCalls[0][1] as {
      kind: string;
      actorAuthUserId: string;
      idempotencyKey: string;
      payload: { subjectCode: string; chapterNumber: number; trigger: string };
    };
    expect(event.actorAuthUserId).toBe('auth-user-1');
    // Idempotency key matches the orchestrator's key verbatim (bus de-dupes).
    expect(event.idempotencyKey).toBe(`mastery-changed:${SESSION_ID}:3`);
    expect(event.payload).toMatchObject({
      subjectCode: 'math',
      chapterNumber: 3,
      trigger: 'quiz',
    });
  });

  it('dispatches the orchestrator bridge with the SAME session id', async () => {
    _rpcResult = { data: FRESH_RPC, error: null };

    await POST(makeRequest());
    await flushAsync();

    expect(maybeDispatchMock).toHaveBeenCalledTimes(1);
    const arg = maybeDispatchMock.mock.calls[0][0] as {
      authUserId: string;
      legacySessionId: string;
      input: { quizSessionId: string; subjectCode: string; chapterNumber: number };
    };
    expect(arg.authUserId).toBe('auth-user-1');
    expect(arg.legacySessionId).toBe(SESSION_ID);
    expect(arg.input).toMatchObject({
      quizSessionId: SESSION_ID,
      subjectCode: 'math',
      chapterNumber: 3,
    });
  });

  it('does NOT fire PostHog, publishEvent, or the bridge on an idempotent replay', async () => {
    // Unique-violation race → cached replay (idempotent_replay: true).
    _rpcResult = { data: null, error: { message: 'duplicate key value', code: '23505' } };
    _cachedRow = {
      data: { id: SESSION_ID, total_questions: 10, correct_answers: 8, score_percent: 80, score: 100 },
    };

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect((await res.json()).data.idempotent_replay).toBe(true);
    await flushAsync();

    // CRITICAL: no double-count on replay.
    expect(posthogCaptureMock.mock.calls.filter((c) => c[0] === 'quiz_graded')).toHaveLength(0);
    expect(posthogCaptureMock.mock.calls.filter((c) => c[0] === 'xp_awarded')).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(maybeDispatchMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Wave 2.5.1 + 2.5.3 — OFFLINE-REPLAY gates + offline-sync telemetry.
//
// The offline branch fires ONLY when attemptMode === 'offline_replay'. All
// gates run BEFORE the RPC. The RPC remains the sole grading authority — no
// score/correct/XP field is ever accepted; the P3 source stays totalTimeSeconds
// (NEVER a wall-clock derivation). Online submissions are byte-identical.
// ════════════════════════════════════════════════════════════════════════════

const FRESH = {
  session_id: SESSION_ID,
  score_percent: 80,
  xp_earned: 100,
  correct: 8,
  total: 10,
  flagged: false,
  idempotent_replay: false,
};

/** A valid offline_replay body. Overrides merge over the offline defaults. */
function offlineBody(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: SESSION_ID,
    studentId: STUDENT_A,
    responses: [{ question_id: QUESTION_ID, selected_option: 2, time_taken_seconds: 7 }],
    totalTimeSeconds: 42,
    subject: 'math',
    grade: '9',
    topic: 'algebra',
    chapter: 3,
    attemptMode: 'offline_replay',
    capturedAt: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
    ...overrides,
  };
}

describe('POST /api/v2/quiz/submit — offline-replay gates (Wave 2.5.1)', () => {
  it('ONLINE path: no offline gate fires and no offline-sync event is emitted', async () => {
    _rpcResult = { data: FRESH, error: null };
    // Default makeRequest() has attemptMode absent → online.
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    await flushAsync();
    // RPC still called with the same args; no new offline-sync ops-event.
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(
      logOpsEventMock.mock.calls.filter(
        (c) => (c[0] as { category?: string })?.category === 'offline-sync',
      ),
    ).toHaveLength(0);
  });

  it('happy path forwards the SAME RPC args (P3 source = totalTimeSeconds, no wall-clock)', async () => {
    _rpcResult = { data: FRESH, error: null };
    const res = await POST(makeRequest({ body: offlineBody() }));
    expect(res.status).toBe(200);

    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [rpcName, args] = rpcSpy.mock.calls[0];
    expect(rpcName).toBe('submit_quiz_results_v2');
    // p_time MUST equal the device-summed totalTimeSeconds — never a derived
    // wall-clock duration from capturedAt / drainedAt.
    expect(args.p_time).toBe(42);
    // No score/correct/xp field is forwarded to the RPC by the route.
    expect(args).not.toHaveProperty('p_correct');
    expect(args).not.toHaveProperty('p_score');
    expect(args).not.toHaveProperty('p_xp');
    // Offline-only fields are NOT passed to the grading RPC.
    expect(args).not.toHaveProperty('p_captured_at');
    expect(args).not.toHaveProperty('p_attempt_mode');
  });

  it('missing capturedAt on an offline replay → 400 OFFLINE_CAPTURED_AT_REQUIRED', async () => {
    _rpcResult = { data: FRESH, error: null };
    const res = await POST(makeRequest({ body: offlineBody({ capturedAt: undefined }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('OFFLINE_CAPTURED_AT_REQUIRED');
    // Gate runs BEFORE the RPC.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('capturedAt too far in the future → 422 REPLAY_CLOCK_INVALID', async () => {
    _rpcResult = { data: FRESH, error: null };
    const future = new Date(Date.now() + 10 * 60_000).toISOString(); // +10 min
    const res = await POST(makeRequest({ body: offlineBody({ capturedAt: future }) }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('REPLAY_CLOCK_INVALID');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('capturedAt older than 168h → 422 REPLAY_TOO_STALE', async () => {
    _rpcResult = { data: FRESH, error: null };
    const stale = new Date(Date.now() - 169 * 60 * 60 * 1000).toISOString(); // 169h ago
    const res = await POST(makeRequest({ body: offlineBody({ capturedAt: stale }) }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('REPLAY_TOO_STALE');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('clientCapturedTotalSeconds !== totalTimeSeconds → 400 OFFLINE_TIME_INCONSISTENT', async () => {
    _rpcResult = { data: FRESH, error: null };
    const res = await POST(
      makeRequest({ body: offlineBody({ clientCapturedTotalSeconds: 99 }) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('OFFLINE_TIME_INCONSISTENT');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('clientCapturedTotalSeconds === totalTimeSeconds → passes the gate', async () => {
    _rpcResult = { data: FRESH, error: null };
    const res = await POST(
      makeRequest({ body: offlineBody({ clientCapturedTotalSeconds: 42 }) }),
    );
    expect(res.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
  });

  it('client shuffle map matching the server snapshot → grades normally', async () => {
    _rpcResult = { data: FRESH, error: null };
    _shuffleRows = { data: [{ question_id: QUESTION_ID, shuffle_map: [2, 0, 3, 1] }] };
    const res = await POST(
      makeRequest({
        body: offlineBody({ shuffleMapsClientGradedAgainst: { [QUESTION_ID]: [2, 0, 3, 1] } }),
      }),
    );
    expect(res.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledTimes(1);
  });

  it('client shuffle map diverging from the server snapshot → 422 SHUFFLE_MAP_MISMATCH (no grading)', async () => {
    _rpcResult = { data: FRESH, error: null };
    _shuffleRows = { data: [{ question_id: QUESTION_ID, shuffle_map: [0, 1, 2, 3] }] };
    const res = await POST(
      makeRequest({
        body: offlineBody({ shuffleMapsClientGradedAgainst: { [QUESTION_ID]: [2, 0, 3, 1] } }),
      }),
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('SHUFFLE_MAP_MISMATCH');
    // Fail closed: the RPC is NEVER called.
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('missing server snapshot row → defers to the RPC session_not_started → 409', async () => {
    // No snapshot at all → route does NOT invent a new code; lets the RPC
    // session_not_started path handle it.
    _shuffleRows = { data: [] };
    _rpcResult = { data: null, error: { message: 'session_not_started: x', code: 'P0001' } };
    const res = await POST(
      makeRequest({
        body: offlineBody({ shuffleMapsClientGradedAgainst: { [QUESTION_ID]: [2, 0, 3, 1] } }),
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('SESSION_NOT_STARTED');
    // The RPC WAS reached (shuffle gate skipped on empty snapshot).
    expect(rpcSpy).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/v2/quiz/submit — offline-sync telemetry (Wave 2.5.3)', () => {
  function offlineSyncEvents() {
    return logOpsEventMock.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((e) => e?.category === 'offline-sync');
  }

  it('emits learner_offline_sync_replay with wasIdempotentReplay=false on a fresh grade', async () => {
    _rpcResult = { data: FRESH, error: null };
    const capturedAt = new Date(Date.now() - 30_000).toISOString();
    const res = await POST(
      makeRequest({ body: offlineBody({ capturedAt, drainAttempt: 2 }) }),
    );
    expect(res.status).toBe(200);
    await flushAsync();

    const events = offlineSyncEvents();
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.severity).toBe('info');
    expect(ev.message).toBe('learner_offline_sync_replay');
    expect(ev.subjectType).toBe('student');
    expect(ev.subjectId).toBe(STUDENT_A);
    const ctx = ev.context as Record<string, unknown>;
    expect(ctx.schemaVersion).toBe(1);
    expect(ctx.sessionId).toBe(SESSION_ID);
    expect(ctx.capturedAt).toBe(capturedAt);
    expect(typeof ctx.drainedAt).toBe('string');
    expect(typeof ctx.queueLatencySeconds).toBe('number');
    expect(ctx.queueLatencySeconds as number).toBeGreaterThanOrEqual(0);
    expect(ctx.wasIdempotentReplay).toBe(false);
    expect(ctx.drainAttempt).toBe(2);
    // METADATA ONLY (P13): no answer/question text leaks into context.
    expect(JSON.stringify(ctx)).not.toContain('time_taken_seconds');
    expect(JSON.stringify(ctx)).not.toContain('selected_option');
  });

  it('emits learner_offline_sync_replay with wasIdempotentReplay=true on a cached replay', async () => {
    // Unique-violation race → cached idempotent replay.
    _rpcResult = { data: null, error: { message: 'duplicate key value', code: '23505' } };
    _cachedRow = {
      data: { id: SESSION_ID, total_questions: 10, correct_answers: 8, score_percent: 80, score: 100 },
    };
    const res = await POST(makeRequest({ body: offlineBody({ drainAttempt: 5 }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.idempotent_replay).toBe(true);
    await flushAsync();

    const events = offlineSyncEvents();
    expect(events).toHaveLength(1);
    const ctx = events[0].context as Record<string, unknown>;
    expect(ctx.wasIdempotentReplay).toBe(true);
    expect(ctx.drainAttempt).toBe(5);
    // The replay must NOT double-count the funnels — only the offline-sync event fires.
    expect(posthogCaptureMock.mock.calls.filter((c) => c[0] === 'quiz_graded')).toHaveLength(0);
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(maybeDispatchMock).not.toHaveBeenCalled();
  });

  it('emits the offline-sync event exactly once per drain (fresh grade)', async () => {
    _rpcResult = { data: FRESH, error: null };
    await POST(makeRequest({ body: offlineBody() }));
    await flushAsync();
    expect(offlineSyncEvents()).toHaveLength(1);
  });

  it('online path emits NO offline-sync event (byte-identical)', async () => {
    _rpcResult = { data: FRESH, error: null };
    await POST(makeRequest());
    await flushAsync();
    expect(offlineSyncEvents()).toHaveLength(0);
  });
});
