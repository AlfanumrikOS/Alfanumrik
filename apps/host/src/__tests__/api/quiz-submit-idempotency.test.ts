/**
 * REG-62 — /api/quiz/submit idempotency at the wire (P4 atomic submission).
 *
 * Marking-Authenticity Wave 2 (2026-05-04) introduced
 * `src/app/api/quiz/submit/route.ts` as the server-side authoritative path
 * for grading a quiz. The route requires an `Idempotency-Key` header (UUID)
 * on every POST. The migration `20260504100200_quiz_idempotency_key.sql`
 * adds the matching unique partial index on `quiz_sessions.idempotency_key`
 * scoped per student.
 *
 * Contract under test:
 *   1. Missing Idempotency-Key header → 400.
 *   2. Invalid (non-UUID) Idempotency-Key → 400.
 *   3. Fresh submission → 200, `idempotent_replay: false`, posthog
 *      `quiz_graded` is captured exactly once.
 *   4. Concurrent retry race (RPC throws unique-violation) → route SELECTs
 *      the cached row and returns 200 with `idempotent_replay: true`. NO
 *      `quiz_graded` event is emitted on replay (prevents funnel double-count).
 *
 * Strategy: route-mock test in the same family as
 * dashboard-reviews-due.test.ts. We mock the supabase clients, posthog
 * server module, and rbac, then dynamically import the route handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── RBAC mock ───────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
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

// ── PostHog server mock ────────────────────────────────────────────────────
const posthogCaptureMock = vi.fn().mockResolvedValue(undefined);
// Partial mock: keep the REAL hashDistinctId (submit-side-effects imports it
// for the quiz_graded auth.uid stitch — Wave 2, commit 4e2288fa). A
// `() => ({ capture })` factory that omits it throws "No hashDistinctId export
// is defined on the mock" on every fresh-grade path.
vi.mock('@alfanumrik/lib/posthog/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/posthog/server')>();
  return { ...actual, capture: (...args: unknown[]) => posthogCaptureMock(...args) };
});

// ── Logger mock ────────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Ops events mock ─────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Feature flag mock ──────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}));

// ── Supabase admin mock — used for student lookup + cached row SELECT ──────
let _studentLookup: { data: { id: string } | null; error: null | { message: string } } = {
  data: { id: STUDENT_ID() }, error: null,
};
let _cachedSession: { data: any; error: null | { message: string } } = { data: null, error: null };

function STUDENT_ID() { return '11111111-1111-4111-8111-111111111111'; }
function SESSION_ID() { return '22222222-2222-4222-8222-222222222222'; }
function IDEMPOTENCY_KEY() { return '33333333-3333-4333-8333-333333333333'; }
function QUESTION_ID() { return '44444444-4444-4444-8444-444444444444'; }

function adminFromMock(table: string) {
  // students lookup: from('students').select('id').eq('auth_user_id', x).maybeSingle()
  // cached row: from('quiz_sessions').select(...).eq(student_id).eq(idempotency_key).maybeSingle()
  const chain: any = {};
  const methods = ['select', 'eq', 'lte', 'lt', 'gte', 'order', 'limit', 'in', 'is'];
  for (const m of methods) {
    chain[m] = (..._args: unknown[]) => chain;
  }
  chain.maybeSingle = () => Promise.resolve(table === 'students' ? _studentLookup : _cachedSession);
  chain.single = () => Promise.resolve(table === 'students' ? _studentLookup : _cachedSession);
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => adminFromMock(table),
  }),
}));

// ── Supabase server (JWT-bound) mock — calls submit_quiz_results_v2 RPC ────
type RpcResult = { data: any; error: any };
let _rpcResult: RpcResult = { data: null, error: null };
let _rpcThrow: Error | null = null;
const rpcSpy = vi.fn();

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => {
      rpcSpy(...args);
      if (_rpcThrow) throw _rpcThrow;
      return Promise.resolve(_rpcResult);
    },
  }),
}));

// ── Helpers ────────────────────────────────────────────────────────────────
function makeRequest(opts: {
  idempotencyKey?: string | null;
  body?: any;
} = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.idempotencyKey === undefined) {
    headers['idempotency-key'] = IDEMPOTENCY_KEY();
  } else if (opts.idempotencyKey !== null) {
    headers['idempotency-key'] = opts.idempotencyKey;
  }
  const body = opts.body ?? {
    sessionId: SESSION_ID(),
    studentId: STUDENT_ID(),
    responses: [
      { question_id: QUESTION_ID(), selected_option: 1, time_taken_seconds: 10 },
    ],
    totalTimeSeconds: 30,
  };
  return new Request('http://localhost/api/quiz/submit', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _studentLookup = { data: { id: STUDENT_ID() }, error: null };
  _cachedSession = { data: null, error: null };
  _rpcResult = { data: null, error: null };
  _rpcThrow = null;
  posthogCaptureMock.mockResolvedValue(undefined);
  const mod = await import('@/app/api/quiz/submit/route');
  POST = mod.POST;
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/quiz/submit — Idempotency-Key required (REG-62)', () => {
  it('returns 400 when Idempotency-Key header is missing', async () => {
    const res = await POST(makeRequest({ idempotencyKey: null }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('returns 400 when Idempotency-Key is not a UUID', async () => {
    const res = await POST(makeRequest({ idempotencyKey: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('POST /api/quiz/submit — fresh submission (REG-62)', () => {
  it('returns 200 with idempotent_replay=false and emits quiz_graded once', async () => {
    _rpcResult = {
      data: {
        session_id: SESSION_ID(),
        score_percent: 80,
        xp_earned: 100,
        correct: 8,
        total: 10,
        flagged: false,
        idempotent_replay: false,
      },
      error: null,
    };

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.idempotent_replay).toBe(false);
    expect(body.data.score_percent).toBe(80);
    expect(body.data.xp_earned).toBe(100);
    expect(body.data.marking_authenticity_path).toBe('oracle_v2');

    // quiz_graded must fire exactly once on a fresh submission.
    const gradedCalls = posthogCaptureMock.mock.calls.filter(
      (c: unknown[]) => c[0] === 'quiz_graded',
    );
    expect(gradedCalls).toHaveLength(1);
    // The 3rd arg is the properties payload.
    expect(gradedCalls[0][2]).toMatchObject({
      session_id: SESSION_ID(),
      score_percent: 80,
      xp_earned: 100,
      idempotent_replay: false,
    });
  });
});

describe('POST /api/quiz/submit — idempotent replay (REG-62)', () => {
  it('returns 200 with idempotent_replay=true and DOES NOT emit quiz_graded on a unique-violation race', async () => {
    // RPC fails with the migration's unique partial index name.
    _rpcResult = {
      data: null,
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "quiz_sessions_idempotency_key_uniq"',
      },
    };
    // Cached row already exists for this (student_id, idempotency_key).
    _cachedSession = {
      data: {
        id: SESSION_ID(),
        total_questions: 10,
        correct_answers: 8,
        score_percent: 80,
        score: 100,
      },
      error: null,
    };

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.idempotent_replay).toBe(true);
    expect(body.data.score_percent).toBe(80);
    expect(body.data.xp_earned).toBe(100);
    expect(body.data.session_id).toBe(SESSION_ID());

    // CRITICAL: quiz_graded MUST NOT fire on a replay (prevents funnel
    // double-count). Other events (passthrough) may fire — only assert
    // on quiz_graded.
    const gradedCalls = posthogCaptureMock.mock.calls.filter(
      (c: unknown[]) => c[0] === 'quiz_graded',
    );
    expect(gradedCalls).toHaveLength(0);
  });
});
