/**
 * R9 — the grading idempotency key MUST be the session id, never a client header.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HOLE THIS PINS
 *
 * `/api/quiz/submit` and `/api/v2/quiz/submit` took `Idempotency-Key` from a
 * CLIENT header and forwarded it verbatim as `p_idempotency_key`, unbound to
 * `sessionId`. The ONLY server-side enforcement of "one graded submission per
 * session" is the partial unique index
 *
 *     quiz_sessions_idempotency_key_uniq ON (student_id, idempotency_key)
 *     WHERE idempotency_key IS NOT NULL          (migration 20260504100200)
 *
 * which constrains the KEY, not the session. So two different client-chosen
 * keys for ONE session were two legal rows → two gradings → DOUBLE XP (P2),
 * and the two "has this session been graded?" readers — the resume route's
 * `already_submitted` gate and `resolveResumableQuiz`'s `/today` card gate,
 * both of which look the SESSION ID up in `quiz_sessions.idempotency_key` —
 * silently stopped matching, so a graded session became resumable again.
 *
 * Unreachable from web today (the client calls the RPC directly, and
 * `submitQuizResults` already passes `p_idempotency_key: sessionId ?? null`).
 * It goes live at the `ff_server_only_quiz_submit` cutover, when these routes
 * become the only legal grading path.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE MODEL BELOW IS FAITHFUL
 *
 * `fakeRpc` reproduces `submit_quiz_results_v2`'s Phase 2.8 behaviour exactly
 * as the migration writes it: look `(student_id, idempotency_key)` up FIRST and
 * short-circuit to the cached row with `idempotent_replay: true`; otherwise
 * INSERT, with the partial unique index raising 23505 on a collision. It awards
 * XP only on a real insert, so `db.xpAwards` counts GRADINGS, not requests.
 *
 * These tests do not touch P1/P2/P3/P4: no score, XP value, anti-cheat rule or
 * RPC grading behaviour is asserted or altered here — only WHICH key is passed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Ids ─────────────────────────────────────────────────────────────────────
const AUTH_USER_ID = '99999999-9999-4999-8999-999999999999';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';
/** Two DIFFERENT client-supplied keys for the SAME session — the attack. */
const CLIENT_KEY_A = '33333333-3333-4333-8333-333333333333';
const CLIENT_KEY_B = '77777777-7777-4777-8777-777777777777';

// ── RBAC ────────────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@alfanumrik/lib/posthog/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/posthog/server')>();
  return { ...actual, capture: vi.fn().mockResolvedValue(undefined) };
});
// Post-submit fan-out is covered by its own suites; silence it so a failure
// here can only ever be about the idempotency key.
vi.mock('@alfanumrik/lib/quiz/submit-side-effects', () => ({
  runQuizSubmitSideEffects: vi.fn(),
}));
vi.mock('@alfanumrik/lib/quiz/post-submit-telemetry', () => ({
  prepareQuizTelemetry: vi.fn().mockResolvedValue(undefined),
}));

// Both the submit routes (`isFeatureEnabled`) and the resume gate
// (`readFeatureFlagStrict`) read flags. `determined:true, enabled:false` is
// "read successfully and OFF" — the only state that permits resume.
vi.mock('@alfanumrik/lib/feature-flags', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
  readFeatureFlagStrict: vi.fn().mockResolvedValue({ determined: true, enabled: false }),
}));

// ── In-memory database ──────────────────────────────────────────────────────
interface QuizSessionRow {
  id: string;
  student_id: string;
  idempotency_key: string | null;
  total_questions: number;
  correct_answers: number;
  score_percent: number;
  score: number;
}

const db: {
  students: Array<Record<string, unknown>>;
  quiz_sessions: QuizSessionRow[];
  quiz_session_shuffles: Array<Record<string, unknown>>;
  question_bank: Array<Record<string, unknown>>;
  /** One entry per REAL grading (never on a replay) — the double-XP detector. */
  xpAwards: number[];
} = {
  students: [],
  quiz_sessions: [],
  quiz_session_shuffles: [],
  question_bank: [],
  xpAwards: [],
};

function resetDb() {
  db.students = [
    {
      id: STUDENT_ID,
      auth_user_id: AUTH_USER_ID,
      account_status: 'active',
      is_active: true,
      deleted_at: null,
    },
  ];
  db.quiz_sessions = [];
  db.quiz_session_shuffles = [
    {
      session_id: SESSION_ID,
      student_id: STUDENT_ID,
      question_id: QUESTION_ID,
      student_selected_displayed_index: 1,
      student_time_spent_seconds: 10,
      student_answered_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      session_mode: 'practice',
      shuffle_map: [0, 1, 2, 3],
      options_snapshot: ['a', 'b', 'c', 'd'],
    },
  ];
  db.question_bank = [
    {
      id: QUESTION_ID,
      subject: 'math',
      question_text: 'q?',
      question_hi: null,
      question_type: 'mcq',
      explanation: 'because',
      explanation_hi: null,
      hint: null,
      difficulty: 'medium',
      bloom_level: 'understand',
      chapter_number: 3,
    },
  ];
  db.xpAwards = [];
}

// ── Generic supabase-admin fake (filters applied for real) ─────────────────
type Filter = (row: Record<string, unknown>) => boolean;

function buildChain(table: keyof typeof db) {
  const filters: Filter[] = [];
  let limitN: number | null = null;

  const rows = () => {
    let out = (db[table] as Array<Record<string, unknown>>).filter(r =>
      filters.every(f => f(r)),
    );
    if (limitN !== null) out = out.slice(0, limitN);
    return out;
  };

  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters.push(r => r[col] === val);
      return chain;
    },
    is: (col: string, val: unknown) => {
      filters.push(r => r[col] === val);
      return chain;
    },
    in: (col: string, vals: unknown[]) => {
      filters.push(r => vals.includes(r[col]));
      return chain;
    },
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    order: () => chain,
    maybeSingle: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: rows()[0] ?? null, error: null }),
    // Awaiting the builder itself resolves to the row list.
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(resolve),
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: (table: string) => buildChain(table as keyof typeof db) }),
}));

// ── Faithful submit_quiz_results_v2 model ──────────────────────────────────
let rowSeq = 0;

function fakeRpc(_name: string, args: Record<string, unknown>) {
  const studentId = args.p_student_id as string;
  const key = (args.p_idempotency_key as string | null) ?? null;

  // Phase 2.8 short-circuit: (student_id, idempotency_key) lookup FIRST.
  if (key !== null) {
    const existing = db.quiz_sessions.find(
      r => r.student_id === studentId && r.idempotency_key === key,
    );
    if (existing) {
      return Promise.resolve({
        data: {
          session_id: existing.id,
          total: existing.total_questions,
          correct: existing.correct_answers,
          score_percent: existing.score_percent,
          xp_earned: existing.score,
          flagged: false,
          idempotent_replay: true,
        },
        error: null,
      });
    }
  }

  // The partial unique index. (Unreachable after the short-circuit above
  // except in a true in-flight race; modelled so the 23505 branch is real.)
  if (
    key !== null &&
    db.quiz_sessions.some(r => r.student_id === studentId && r.idempotency_key === key)
  ) {
    return Promise.resolve({
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "quiz_sessions_idempotency_key_uniq"',
      },
    });
  }

  const row: QuizSessionRow = {
    id: `graded-row-${++rowSeq}`,
    student_id: studentId,
    idempotency_key: key,
    total_questions: 10,
    correct_answers: 8,
    score_percent: 80,
    score: 100,
  };
  db.quiz_sessions.push(row);
  db.xpAwards.push(row.score); // a REAL grading happened

  return Promise.resolve({
    data: {
      session_id: row.id,
      total: row.total_questions,
      correct: row.correct_answers,
      score_percent: row.score_percent,
      xp_earned: row.score,
      flagged: false,
      idempotent_replay: false,
    },
    error: null,
  });
}

const rpcSpy = vi.fn(fakeRpc);
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi
    .fn()
    .mockResolvedValue({ rpc: (...a: unknown[]) => rpcSpy(...(a as [string, Record<string, unknown>])) }),
}));

// ── Request builders ───────────────────────────────────────────────────────
function submitRequest(path: string, clientKey: string) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'idempotency-key': clientKey },
    body: JSON.stringify({
      sessionId: SESSION_ID,
      studentId: STUDENT_ID,
      subject: 'math',
      grade: '9', // P5: grades are STRINGS
      responses: [{ question_id: QUESTION_ID, selected_option: 1, time_taken_seconds: 10 }],
      totalTimeSeconds: 30,
    }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let webPOST: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let v2POST: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resumeGET: any;

beforeEach(async () => {
  vi.clearAllMocks();
  rpcSpy.mockImplementation(fakeRpc);
  rowSeq = 0;
  resetDb();
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['quiz.attempt'],
  });
  webPOST = (await import('@/app/api/quiz/submit/route')).POST;
  v2POST = (await import('@/app/api/v2/quiz/submit/route')).POST;
  resumeGET = (await import('@/app/api/quiz/session/[sessionId]/progress/route')).GET;
});

// ════════════════════════════════════════════════════════════════════════════
// 1. THE HOLE: two client keys, one session, one grading.
// ════════════════════════════════════════════════════════════════════════════
describe('R9 — /api/quiz/submit binds the grading key to the session', () => {
  it('two DIFFERENT client Idempotency-Keys on one session grade it ONCE (no double XP)', async () => {
    const first = await webPOST(submitRequest('/api/quiz/submit', CLIENT_KEY_A));
    const second = await webPOST(submitRequest('/api/quiz/submit', CLIENT_KEY_B));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // THE INVARIANT: exactly one graded row and one XP award for this session.
    expect(db.quiz_sessions).toHaveLength(1);
    expect(db.xpAwards).toEqual([100]);

    // The second call replayed rather than re-graded.
    expect((await second.json()).data.idempotent_replay).toBe(true);
  });

  it('passes the SESSION id — not the header — as p_idempotency_key', async () => {
    await webPOST(submitRequest('/api/quiz/submit', CLIENT_KEY_A));

    const args = rpcSpy.mock.calls[0][1];
    expect(args.p_idempotency_key).toBe(SESSION_ID);
    expect(args.p_idempotency_key).not.toBe(CLIENT_KEY_A);
    // Grading inputs are untouched (P1/P3 pass-through unchanged).
    expect(args.p_session_id).toBe(SESSION_ID);
    expect(args.p_time).toBe(30);
  });
});

describe('R9 — /api/v2/quiz/submit binds the grading key to the session', () => {
  it('two DIFFERENT client Idempotency-Keys on one session grade it ONCE (no double XP)', async () => {
    const ctx = { params: Promise.resolve({}) };
    const first = await v2POST(submitRequest('/api/v2/quiz/submit', CLIENT_KEY_A), ctx);
    const second = await v2POST(submitRequest('/api/v2/quiz/submit', CLIENT_KEY_B), ctx);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.quiz_sessions).toHaveLength(1);
    expect(db.xpAwards).toEqual([100]);
    expect((await second.json()).data.idempotent_replay).toBe(true);
  });

  it('passes the SESSION id — not the header — as p_idempotency_key', async () => {
    await v2POST(submitRequest('/api/v2/quiz/submit', CLIENT_KEY_A), {
      params: Promise.resolve({}),
    });

    const args = rpcSpy.mock.calls[0][1];
    expect(args.p_idempotency_key).toBe(SESSION_ID);
    expect(args.p_idempotency_key).not.toBe(CLIENT_KEY_A);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. The downstream gate the key binding exists to keep working.
// ════════════════════════════════════════════════════════════════════════════
describe('R9 — the resume already-submitted gate still matches after a submit', () => {
  it('a session graded via /api/quiz/submit is NOT resumable', async () => {
    // Resumable before submit (sanity: the gate is not just always-blocked).
    const before = await resumeGET(
      new Request(`http://localhost/api/quiz/session/${SESSION_ID}/progress`),
      { params: Promise.resolve({ sessionId: SESSION_ID }) },
    );
    const beforeBody = await before.json();
    expect(before.status).toBe(200);
    expect(beforeBody.data?.reason).not.toBe('already_submitted');

    await webPOST(submitRequest('/api/quiz/submit', CLIENT_KEY_A));

    const after = await resumeGET(
      new Request(`http://localhost/api/quiz/session/${SESSION_ID}/progress`),
      { params: Promise.resolve({ sessionId: SESSION_ID }) },
    );
    const body = await after.json();
    expect(body.success).toBe(true);
    expect(body.data.resumable).toBe(false);
    // The gate reads `.eq('idempotency_key', sessionId)` — it only matches
    // because the submit route stored the SESSION id as the key.
    expect(body.data.reason).toBe('already_submitted');
  });

  it('a session graded via /api/v2/quiz/submit (mobile) is NOT resumable either', async () => {
    await v2POST(submitRequest('/api/v2/quiz/submit', CLIENT_KEY_A), {
      params: Promise.resolve({}),
    });

    const after = await resumeGET(
      new Request(`http://localhost/api/quiz/session/${SESSION_ID}/progress`),
      { params: Promise.resolve({ sessionId: SESSION_ID }) },
    );
    expect((await after.json()).data.reason).toBe('already_submitted');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Legitimate retries must STILL replay, not re-grade.
// ════════════════════════════════════════════════════════════════════════════
describe('R9 — genuine retry semantics are preserved', () => {
  it('the same request sent twice (same client key) replays with the prior result', async () => {
    const first = await webPOST(submitRequest('/api/quiz/submit', CLIENT_KEY_A));
    const second = await webPOST(submitRequest('/api/quiz/submit', CLIENT_KEY_A));

    const b1 = await first.json();
    const b2 = await second.json();

    expect(b1.data.idempotent_replay).toBe(false);
    expect(b2.data.idempotent_replay).toBe(true);
    // Same numbers returned, not re-derived.
    expect(b2.data.score_percent).toBe(b1.data.score_percent);
    expect(b2.data.xp_earned).toBe(b1.data.xp_earned);
    expect(db.xpAwards).toEqual([100]);
  });

  it('the in-flight unique-violation race still resolves to the cached row', async () => {
    // First submit commits normally.
    await webPOST(submitRequest('/api/quiz/submit', CLIENT_KEY_A));

    // Now force the 23505 branch: the route must look the cached row up by
    // the SAME key it graded under (the session id), else it 503s.
    rpcSpy.mockImplementationOnce(() =>
      Promise.resolve({
        data: null,
        error: {
          code: '23505',
          message:
            'duplicate key value violates unique constraint "quiz_sessions_idempotency_key_uniq"',
        },
      }),
    );

    const raced = await webPOST(submitRequest('/api/quiz/submit', CLIENT_KEY_B));
    expect(raced.status).toBe(200);
    const body = await raced.json();
    expect(body.data.idempotent_replay).toBe(true);
    expect(body.data.xp_earned).toBe(100);
    expect(db.xpAwards).toEqual([100]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. No new failure mode for a caller without a session id.
// ════════════════════════════════════════════════════════════════════════════
describe('R9 — no sessionId', () => {
  it('both routes REJECT a body with no sessionId (400), so grading is never keyless', async () => {
    const noSession = (path: string) =>
      new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'idempotency-key': CLIENT_KEY_A },
        body: JSON.stringify({
          studentId: STUDENT_ID,
          responses: [{ question_id: QUESTION_ID, selected_option: 1, time_taken_seconds: 10 }],
          totalTimeSeconds: 30,
        }),
      });

    const web = await webPOST(noSession('/api/quiz/submit'));
    expect(web.status).toBe(400);

    const v2 = await v2POST(noSession('/api/v2/quiz/submit'), { params: Promise.resolve({}) });
    expect(v2.status).toBe(400);

    // Nothing was graded on either path.
    expect(db.quiz_sessions).toHaveLength(0);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('the resolver falls back to the header key only when there is no usable sessionId', async () => {
    const { resolveGradingIdempotencyKey } = await import('@alfanumrik/lib/quiz/idempotency');
    // With a session id → always the session id.
    expect(resolveGradingIdempotencyKey(SESSION_ID, CLIENT_KEY_A)).toBe(SESSION_ID);
    // Without one → today's behaviour, unchanged (no new failure mode).
    expect(resolveGradingIdempotencyKey(null, CLIENT_KEY_A)).toBe(CLIENT_KEY_A);
    expect(resolveGradingIdempotencyKey(undefined, CLIENT_KEY_A)).toBe(CLIENT_KEY_A);
    expect(resolveGradingIdempotencyKey('not-a-uuid', CLIENT_KEY_A)).toBe(CLIENT_KEY_A);
  });
});
