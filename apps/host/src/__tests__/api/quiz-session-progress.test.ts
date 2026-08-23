/**
 * /api/quiz/session/[sessionId]/progress — the quiz RESUME substrate route.
 *
 * Pins:
 *   - AUTH + OWNERSHIP: `quiz.attempt` required; a session belonging to
 *     another student is 403 (the service-role client bypasses RLS here, so
 *     this check IS the boundary).
 *   - SECURITY: the GET select lists never name `correct_answer_index` /
 *     `correct_answer_index_snapshot`, so the answer key never leaves
 *     Postgres, and the response body carries no correctness signal.
 *   - IMMEDIATE-FEEDBACK INTERLOCK: resume is mechanically refused while
 *     `ff_quiz_v2` is ON, because `submit_quiz_results_v2` still grades from
 *     client-supplied responses — the one combination that would turn resume
 *     into an "answer, see it's wrong, refresh, retry" exploit. The read is
 *     FAIL-CLOSED: an undetermined flag (missing row, unreachable service)
 *     refuses too, and the caller's REAL roles are used for scoping.
 *   - INSTRUMENT: an `exam` session is not resumable at all, and a session
 *     whose `session_mode` was never recorded cannot be proven not to have
 *     been one — both refuse.
 *   - NO DOUBLE SUBMISSION: a session whose id already appears as a graded
 *     `quiz_sessions.idempotency_key` is refused (`already_submitted`).
 *   - ANSWER IMMUTABILITY: POST is first-write-wins — the UPDATE is filtered
 *     on `student_selected_displayed_index IS NULL`, and `session_mode` rides
 *     that same statement so it inherits the same immutability.
 *   - P1/P2/P4: this route never writes quiz_sessions / quiz_responses /
 *     students / xp_transactions and never calls an RPC.
 *   - P3: per-question time is clamped before it is persisted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SHUFFLE_RESUME_COLUMNS } from '@alfanumrik/lib/quiz/resume';

// ── RBAC mock ────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

const STUDENT_ID = 'student-uuid-1';

function setAuthorized(opts?: { studentId?: string | null }) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: opts?.studentId === undefined ? STUDENT_ID : opts.studentId,
    roles: ['student'],
    permissions: ['quiz.attempt'],
  });
}

function setUnauthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(JSON.stringify({ success: false, error: 'AUTH_REQUIRED' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Feature-flag mock (the ff_quiz_v2 interlock) ─────────────────────────
//
// The route no longer calls `isFeatureEnabled` — it goes through
// `isResumeBlockedByImmediateFeedback`, which reads the flag with
// `readFeatureFlagStrict` so that "off" and "could not determine" stay APART.
// Only that one export is replaced; everything else in the module is real, so
// this mock cannot accidentally hide an unrelated flag dependency.
const _flagImpl = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readFeatureFlagStrict: (...args: unknown[]) => _flagImpl(...args),
}));

/** The flag was read successfully and is OFF for this caller → resume allowed. */
const FLAG_OFF = { determined: true, enabled: false };
/** Read successfully and ON → refuse. */
const FLAG_ON = { determined: true, enabled: true };
/** Could not be read at all → must ALSO refuse (fail-closed). */
const FLAG_UNAVAILABLE = { determined: false, reason: 'flags_unavailable' };
/** Read fine, but the seeded row is absent → our world model is wrong → refuse. */
const FLAG_MISSING_ROW = { determined: false, reason: 'flag_not_found' };

// ── Supabase admin mock ──────────────────────────────────────────────────
interface SelectCall {
  table: string;
  columns: string;
  filters: Array<{ op: string; col: string; val: unknown }>;
}
interface UpdateCall {
  table: string;
  values: Record<string, unknown>;
  filters: Array<{ op: string; col: string; val: unknown }>;
}

const selectCalls: SelectCall[] = [];
const updateCalls: UpdateCall[] = [];
const rpcSpy = vi.fn();

/** table → rows the mocked chain resolves with, per select invocation order. */
let selectResults: Record<string, unknown[][]> = {};
let updateResultIds: string[] = [];

function nextResult(table: string, columns: string): unknown[] {
  const key = `${table}::${columns}`;
  const queue = selectResults[key] ?? selectResults[table];
  if (!queue || queue.length === 0) return [];
  return queue.length === 1 ? queue[0] : (queue.shift() as unknown[]);
}

function buildSelectChain(table: string, columns: string) {
  const filters: Array<{ op: string; col: string; val: unknown }> = [];
  const settle = () => {
    selectCalls.push({ table, columns, filters });
    return Promise.resolve({ data: nextResult(table, columns), error: null });
  };
  const chain: Record<string, unknown> = {
    eq(col: string, val: unknown) {
      filters.push({ op: 'eq', col, val });
      return chain;
    },
    in(col: string, val: unknown) {
      filters.push({ op: 'in', col, val });
      return chain;
    },
    limit() {
      return settle();
    },
    maybeSingle() {
      return settle();
    },
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      return settle().then(onFulfilled, onRejected);
    },
  };
  return chain;
}

function buildUpdateChain(table: string, values: Record<string, unknown>) {
  const filters: Array<{ op: string; col: string; val: unknown }> = [];
  const chain: Record<string, unknown> = {
    eq(col: string, val: unknown) {
      filters.push({ op: 'eq', col, val });
      return chain;
    },
    is(col: string, val: unknown) {
      filters.push({ op: 'is', col, val });
      return chain;
    },
    select() {
      updateCalls.push({ table, values, filters });
      return Promise.resolve({
        data: updateResultIds.map(id => ({ question_id: id })),
        error: null,
      });
    },
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      select: (columns: string) => buildSelectChain(table, columns),
      update: (values: Record<string, unknown>) => buildUpdateChain(table, values),
    }),
    rpc: (...args: unknown[]) => rpcSpy(...args),
  }),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────

const SESSION = '11111111-1111-4111-a111-111111111111';
const Q1 = 'aaaaaaaa-1111-4111-a111-111111111111';
const Q2 = 'bbbbbbbb-2222-4222-a222-222222222222';

const makeCtx = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) });

function makePost(sessionId: string, body: unknown): Request {
  return new Request(`http://localhost/api/quiz/session/${sessionId}/progress`, {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeGet(sessionId: string): Request {
  return new Request(`http://localhost/api/quiz/session/${sessionId}/progress`, {
    method: 'GET',
    headers: { Authorization: 'Bearer fake.jwt' },
  });
}

const OWNERSHIP_ROWS = [{ student_id: STUDENT_ID }];

function snapshotRow(questionId: string, answered: boolean, mode: string | null = 'cognitive') {
  return {
    question_id: questionId,
    shuffle_map: [0, 1, 2, 3],
    options_snapshot: ['a', 'b', 'c', 'd'],
    student_selected_displayed_index: answered ? 1 : null,
    student_time_spent_seconds: answered ? 15 : null,
    student_answered_at: answered ? '2026-08-11T10:01:00.000Z' : null,
    created_at: new Date().toISOString(),
    session_mode: mode,
  };
}

function questionRow(id: string) {
  return {
    id,
    subject: 'science',
    question_text: 'Q?',
    question_hi: null,
    question_type: 'mcq',
    explanation: 'because',
    explanation_hi: null,
    hint: null,
    difficulty: 2,
    bloom_level: 'understand',
    chapter_number: 4,
  };
}

/**
 * Keyed off the PRODUCTION column whitelist rather than a copied literal, so
 * this fixture cannot silently stop matching when the select list changes.
 */
const SNAPSHOT_KEY = `quiz_session_shuffles::${SHUFFLE_RESUME_COLUMNS}`;

/** Wire the happy-path reads: owned session, not graded, 1 answered + 1 not. */
function setResumeReads(opts?: { graded?: boolean; mode?: string | null }) {
  const mode = opts?.mode === undefined ? 'cognitive' : opts.mode;
  selectResults = {
    'quiz_session_shuffles::student_id': [OWNERSHIP_ROWS],
    quiz_sessions: [opts?.graded ? [{ id: 'graded-1' }] : []],
    [SNAPSHOT_KEY]: [[snapshotRow(Q1, true, mode), snapshotRow(Q2, false, mode)]],
    question_bank: [[questionRow(Q1), questionRow(Q2)]],
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let POST: any;
let GET: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(async () => {
  vi.clearAllMocks();
  selectCalls.length = 0;
  updateCalls.length = 0;
  updateResultIds = [Q1];
  selectResults = { 'quiz_session_shuffles::student_id': [OWNERSHIP_ROWS] };
  setAuthorized();
  _flagImpl.mockResolvedValue(FLAG_OFF); // ff_quiz_v2 OFF (its seeded state)
  const mod = await import('@/app/api/quiz/session/[sessionId]/progress/route');
  POST = mod.POST;
  GET = mod.GET;
});

// ── POST: persist one answer ──────────────────────────────────────────────

describe('POST /api/quiz/session/[sessionId]/progress', () => {
  const body = {
    questionId: Q1,
    selectedDisplayedIndex: 2,
    timeSpentSeconds: 12,
    mode: 'cognitive',
  };

  it('401 when unauthenticated', async () => {
    setUnauthorized();
    const res = await POST(makePost(SESSION, body), makeCtx(SESSION));
    expect(res.status).toBe(401);
  });

  it('requires the quiz.attempt permission', async () => {
    await POST(makePost(SESSION, body), makeCtx(SESSION));
    expect(_authorizeImpl).toHaveBeenCalledWith(expect.anything(), 'quiz.attempt');
  });

  it('400 on an invalid session id', async () => {
    const res = await POST(makePost('not-a-uuid', body), makeCtx('not-a-uuid'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_session_id');
  });

  it('403 when the caller has no linked student profile', async () => {
    setAuthorized({ studentId: null });
    const res = await POST(makePost(SESSION, body), makeCtx(SESSION));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('student_profile_required');
  });

  it('403 when the session belongs to a different student', async () => {
    selectResults = { 'quiz_session_shuffles::student_id': [[{ student_id: 'someone-else' }]] };
    const res = await POST(makePost(SESSION, body), makeCtx(SESSION));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('forbidden');
    expect(updateCalls).toHaveLength(0);
  });

  it('404 when no such session exists', async () => {
    selectResults = { 'quiz_session_shuffles::student_id': [[]] };
    const res = await POST(makePost(SESSION, body), makeCtx(SESSION));
    expect(res.status).toBe(404);
  });

  it('400 on an out-of-range selected index', async () => {
    const res = await POST(
      makePost(SESSION, { ...body, selectedDisplayedIndex: 9 }),
      makeCtx(SESSION),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_selected_index');
  });

  it('400 on a negative time', async () => {
    const res = await POST(makePost(SESSION, { ...body, timeSpentSeconds: -3 }), makeCtx(SESSION));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_time_spent');
  });

  it('FIRST-WRITE-WINS: the UPDATE is filtered on student_selected_displayed_index IS NULL', async () => {
    const res = await POST(makePost(SESSION, body), makeCtx(SESSION));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { saved: true } });

    expect(updateCalls).toHaveLength(1);
    const call = updateCalls[0];
    expect(call.table).toBe('quiz_session_shuffles');
    expect(call.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', col: 'session_id', val: SESSION },
        { op: 'eq', col: 'question_id', val: Q1 },
        { op: 'is', col: 'student_selected_displayed_index', val: null },
      ]),
    );
  });

  it('an already-answered question is a benign no-op (saved:false), not an error', async () => {
    updateResultIds = [];
    const res = await POST(makePost(SESSION, body), makeCtx(SESSION));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { saved: false } });
  });

  it('P3: an absurd per-question time is clamped before it is persisted', async () => {
    await POST(makePost(SESSION, { ...body, timeSpentSeconds: 999_999 }), makeCtx(SESSION));
    expect(updateCalls[0].values.student_time_spent_seconds).toBe(3600);
  });

  it('P1/P2/P4: writes ONLY the durability + instrument columns, on ONLY the snapshot table, and calls no RPC', async () => {
    await POST(makePost(SESSION, body), makeCtx(SESSION));
    expect(updateCalls.map(c => c.table)).toEqual(['quiz_session_shuffles']);
    // `session_mode` is session METADATA, not a scoring input — no RPC reads
    // it. The allowlist stays exhaustive so a future scoring-adjacent column
    // cannot be added here unnoticed.
    expect(Object.keys(updateCalls[0].values).sort()).toEqual([
      'session_mode',
      'student_answered_at',
      'student_selected_displayed_index',
      'student_time_spent_seconds',
    ]);
    expect(rpcSpy).not.toHaveBeenCalled();
    // Never any scoring/XP surface.
    const touched = updateCalls.map(c => c.table);
    for (const forbidden of ['quiz_sessions', 'quiz_responses', 'students', 'xp_transactions']) {
      expect(touched).not.toContain(forbidden);
    }
  });

  // ── INSTRUMENT: recorded atomically with the first answer ───────────────

  it('stamps the session instrument in the SAME first-write-wins UPDATE as the answer', async () => {
    await POST(makePost(SESSION, { ...body, mode: 'exam' }), makeCtx(SESSION));
    // One statement, not two. This coupling is what guarantees there is no
    // window in which a session is resumable but its instrument is unknown:
    // a session only becomes resumable once it has >= 1 persisted answer.
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].values.session_mode).toBe('exam');
    expect(updateCalls[0].filters).toEqual(
      expect.arrayContaining([
        { op: 'is', col: 'student_selected_displayed_index', val: null },
      ]),
    );
  });

  it('400 on an unrecognised mode rather than silently coercing it', async () => {
    const res = await POST(makePost(SESSION, { ...body, mode: 'timed' }), makeCtx(SESSION));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_mode');
    expect(updateCalls).toHaveLength(0);
  });

  it('an older client that sends no mode still persists its answer (and stamps nothing)', async () => {
    // Durability must not regress for a cached bundle. The session simply
    // resolves to `mode_unknown` at resume time — refused, never assumed.
    const { mode: _drop, ...noMode } = body;
    const res = await POST(makePost(SESSION, noMode), makeCtx(SESSION));
    expect(res.status).toBe(200);
    expect(updateCalls[0].values).not.toHaveProperty('session_mode');
    expect(updateCalls[0].values.student_selected_displayed_index).toBe(2);
  });
});

// ── GET: the resume payload ───────────────────────────────────────────────

describe('GET /api/quiz/session/[sessionId]/progress', () => {
  it('401 when unauthenticated', async () => {
    setUnauthorized();
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    expect(res.status).toBe(401);
  });

  it('403 when the session belongs to a different student', async () => {
    selectResults = { 'quiz_session_shuffles::student_id': [[{ student_id: 'someone-else' }]] };
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    expect(res.status).toBe(403);
  });

  it('returns a resumable payload with restored answers', async () => {
    setResumeReads();
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.resumable).toBe(true);
    expect(json.data.total_questions).toBe(2);
    expect(json.data.answered_count).toBe(1);
    expect(json.data.elapsed_seconds).toBe(15);
    expect(json.data.questions[0]).toMatchObject({
      question_id: Q1,
      answered: true,
      selected_displayed_index: 1,
      time_spent_seconds: 15,
    });
    expect(json.data.questions[1].answered).toBe(false);
  });

  it('SECURITY: never selects the answer key from either table', async () => {
    setResumeReads();
    await GET(makeGet(SESSION), makeCtx(SESSION));
    for (const call of selectCalls) {
      expect(call.columns).not.toContain('correct_answer_index');
      expect(call.columns).not.toContain('correct_answer_index_snapshot');
      expect(call.columns).not.toBe('*');
    }
  });

  it('SECURITY: the response body carries no correctness signal', async () => {
    setResumeReads();
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    const raw = await res.text();
    expect(raw).not.toMatch(/correct_answer_index/);
    expect(raw).not.toMatch(/is_correct/);
    expect(raw).not.toMatch(/"correct/);
  });

  it('scopes the snapshot read to the caller’s own student_id as well as the session', async () => {
    setResumeReads();
    await GET(makeGet(SESSION), makeCtx(SESSION));
    const snapshotRead = selectCalls.find(
      c => c.table === 'quiz_session_shuffles' && c.columns.includes('options_snapshot'),
    );
    expect(snapshotRead?.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', col: 'session_id', val: SESSION },
        { op: 'eq', col: 'student_id', val: STUDENT_ID },
      ]),
    );
  });

  it('NO DOUBLE SUBMISSION: refuses a session already graded under its idempotency key', async () => {
    setResumeReads({ graded: true });
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ resumable: false, reason: 'already_submitted' });

    // And it looked it up by (student_id, idempotency_key) — the only link
    // between a shuffle session and its graded quiz_sessions row.
    const gradedRead = selectCalls.find(c => c.table === 'quiz_sessions');
    expect(gradedRead?.filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', col: 'student_id', val: STUDENT_ID },
        { op: 'eq', col: 'idempotency_key', val: SESSION },
      ]),
    );
  });

  it('INTERLOCK: refuses to resume while ff_quiz_v2 (immediate correctness) is ON', async () => {
    setResumeReads();
    _flagImpl.mockResolvedValue(FLAG_ON);
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    const json = await res.json();
    expect(json.data).toEqual({ resumable: false, reason: 'blocked_immediate_feedback' });
    expect(_flagImpl).toHaveBeenCalledWith('ff_quiz_v2', expect.anything());
    // And it bailed BEFORE reading any snapshot content.
    expect(selectCalls.some(c => c.columns.includes('options_snapshot'))).toBe(false);
  });

  it.each([
    ['the flag service is unreachable', FLAG_UNAVAILABLE],
    ['the seeded flag row is missing', FLAG_MISSING_ROW],
  ])('INTERLOCK FAILS CLOSED when %s', async (_label, outcome) => {
    // The defect this pins: `isFeatureEnabled` returns `false` for a missing
    // flag, a malformed payload, a failed fetch or missing env — and `false`
    // HERE means ALLOW RESUME. An unreachable flag service therefore silently
    // re-opened the exact "answer, see it's wrong, refresh, retry" exploit the
    // interlock exists to prevent. Only a positive, successfully-read "off"
    // may permit resume.
    setResumeReads();
    _flagImpl.mockResolvedValue(outcome);
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    expect((await res.json()).data).toEqual({
      resumable: false,
      reason: 'blocked_immediate_feedback',
    });
  });

  it('INTERLOCK: scopes the flag read to the caller’s REAL roles, not a hardcoded "student"', async () => {
    _authorizeImpl.mockResolvedValue({
      authorized: true,
      userId: 'auth-user-1',
      studentId: STUDENT_ID,
      roles: ['teacher', 'student'],
      permissions: ['quiz.attempt'],
    });
    setResumeReads();
    await GET(makeGet(SESSION), makeCtx(SESSION));
    const rolesRead = _flagImpl.mock.calls.map(c => (c[1] as { role?: string }).role);
    // Every role the caller actually holds is evaluated; a role-scoped flag
    // cannot be mis-evaluated by guessing a single role for them.
    expect(rolesRead).toEqual(expect.arrayContaining(['teacher', 'student']));
  });

  // ── INSTRUMENT gates ────────────────────────────────────────────────────

  it('refuses an EXAM session — a timed test is taken in one sitting', async () => {
    setResumeReads({ mode: 'exam' });
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    const json = await res.json();
    expect(json.data).toEqual({ resumable: false, reason: 'exam_not_resumable' });
  });

  it('refuses a session whose instrument was never recorded, rather than assuming untimed', async () => {
    setResumeReads({ mode: null });
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    expect((await res.json()).data).toEqual({ resumable: false, reason: 'mode_unknown' });
  });

  it('a resumable payload carries the instrument it was actually started as', async () => {
    setResumeReads({ mode: 'practice' });
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    const json = await res.json();
    expect(json.data.resumable).toBe(true);
    // The runtime sets quizMode from THIS, not from a URL that carries no mode.
    expect(json.data.mode).toBe('practice');
  });

  it('refuses a session older than the 24h resume window', async () => {
    setResumeReads();
    const stale = {
      ...snapshotRow(Q1, true),
      created_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    };
    selectResults[SNAPSHOT_KEY] = [[stale]];
    const res = await GET(makeGet(SESSION), makeCtx(SESSION));
    expect((await res.json()).data).toEqual({ resumable: false, reason: 'expired' });
  });

  it('never writes anything and never calls an RPC', async () => {
    setResumeReads();
    await GET(makeGet(SESSION), makeCtx(SESSION));
    expect(updateCalls).toHaveLength(0);
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});
