/**
 * /api/exams/papers/[id]/submit — POST route tests (JEE/NEET PR-6).
 *
 * Pins: auth gate, UUID validation, empty + oversized responses[],
 * cbse_board free-tier path, 402 competition gate, jee_main with flag on,
 * RPC error → 500, idempotent replay short-circuit, review[] enrichment
 * (is_correct + revealed correct_answer_index), admin flag-gate bypass.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── RBAC mock ────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorized(opts?: { roles?: string[]; studentId?: string | null }) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: opts?.studentId === undefined ? 'student-uuid-1' : opts.studentId,
    roles: opts?.roles ?? ['student'],
    permissions: ['exam.view'],
  });
}

function setUnauthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'AUTH_REQUIRED', code: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

// ── Logger + feature flag mocks ─────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const _flagImpl = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _flagImpl(...args),
}));
const setFlag = (enabled: boolean) => _flagImpl.mockResolvedValue(enabled);

// ── Supabase admin mock (chain + rpc) ───────────────────────────────────

interface MockState {
  exam_papers: Array<Record<string, unknown>>;
  question_bank: Array<Record<string, unknown>>;
  mock_test_attempts: Array<Record<string, unknown>>;
  rpcImpl:
    | ((name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
    | null;
}

const state: MockState = {
  exam_papers: [],
  question_bank: [],
  mock_test_attempts: [],
  rpcImpl: null,
};

function resetState() {
  state.exam_papers = [];
  state.question_bank = [];
  state.mock_test_attempts = [];
  state.rpcImpl = null;
}

interface Filter { kind: 'eq' | 'gte'; col: string; val: unknown }

function applyFilters(rows: Array<Record<string, unknown>>, filters: Filter[]) {
  return rows.filter((r) =>
    filters.every((f) => {
      if (f.kind === 'eq') return r[f.col] === f.val;
      const a = r[f.col];
      const b = f.val;
      if (typeof a === 'string' && typeof b === 'string') return a >= b;
      if (typeof a === 'number' && typeof b === 'number') return a >= b;
      return false;
    }),
  );
}

function buildChain(table: keyof MockState | string) {
  const filters: Filter[] = [];
  let _limit: number | null = null;
  const orders: Array<{ col: string; ascending: boolean }> = [];

  const exec = () => {
    const src = (state[table as keyof MockState] as Array<Record<string, unknown>>) ?? [];
    let rows = applyFilters(src, filters);
    for (const o of orders) {
      rows = [...rows].sort((a, b) => {
        const av = a[o.col] as number | string;
        const bv = b[o.col] as number | string;
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * (o.ascending ? 1 : -1);
      });
    }
    if (_limit !== null) rows = rows.slice(0, _limit);
    return Promise.resolve({ data: rows, error: null });
  };

  const chain: {
    select: (cols: string) => typeof chain;
    eq: (col: string, val: unknown) => typeof chain;
    gte: (col: string, val: unknown) => typeof chain;
    order: (col: string, opts?: { ascending?: boolean }) => typeof chain;
    limit: (n: number) => typeof chain;
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
    then: (
      onfulfilled: (v: { data: unknown; error: unknown }) => unknown,
      onrejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    select(_c) { return chain; },
    eq(col, val) { filters.push({ kind: 'eq', col, val }); return chain; },
    gte(col, val) { filters.push({ kind: 'gte', col, val }); return chain; },
    order(col, opts) { orders.push({ col, ascending: opts?.ascending ?? true }); return chain; },
    limit(n) { _limit = n; return chain; },
    maybeSingle() {
      return exec().then((r) => {
        const rows = (r.data as unknown[] | null) ?? [];
        return { data: (rows as unknown[])[0] ?? null, error: r.error };
      });
    },
    then(onfulfilled, onrejected) { return exec().then(onfulfilled, onrejected); },
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => buildChain(table),
    rpc: (name: string, args: Record<string, unknown>) =>
      state.rpcImpl
        ? state.rpcImpl(name, args)
        : Promise.resolve({ data: null, error: { message: 'rpc_not_configured' } }),
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────

const CBSE_PAPER_ID = '11111111-1111-4111-a111-111111111111';
const JEE_PAPER_ID = '22222222-2222-4222-a222-222222222222';
const QA_ID = '33333333-3333-4333-a333-333333333333';
const QB_ID = '44444444-4444-4444-a444-444444444444';
const MISSING_PAPER_ID = '99999999-9999-4999-a999-999999999999';

function makeReq(id: string, body: unknown): Request {
  return new Request(`http://localhost/api/exams/papers/${id}/submit`, {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const makeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

function seedPapers() {
  state.exam_papers = [
    { id: CBSE_PAPER_ID, exam_family: 'cbse_board', is_active: true },
    { id: JEE_PAPER_ID, exam_family: 'jee_main', is_active: true },
  ];
}

function mkQ(id: string, text: string, opts: string[], correct: number, expl: string, ch: string, paperId: string) {
  return {
    id, question_text: text, options: opts, correct_answer_index: correct,
    explanation: expl, hint: null, chapter_title: ch, paper_pattern: 'mcq_single',
    marks_correct: 4, marks_wrong: -1, exam_paper_id: paperId, is_active: true,
  };
}

function seedQuestions(paperId: string) {
  state.question_bank = [
    mkQ(QA_ID, 'A body moves with velocity v...', ['10', '20', '30', '40'], 1, 'Apply v=u+at.', 'Mechanics', paperId),
    mkQ(QB_ID, "Ohm's law states...", ['V=IR', 'V=I/R', 'V=I+R', 'V=I-R'], 0, 'V equals I times R.', 'Electricity', paperId),
  ];
}

function rpcSuccess(paperId: string) {
  state.rpcImpl = () => Promise.resolve({
    data: {
      attempt_id: '55555555-5555-4555-a555-555555555555', paper_id: paperId,
      total_questions: 2, attempted_count: 2, correct_count: 1, wrong_count: 1,
      skipped_count: 0, raw_score: 3, max_score: 8, score_percent: 37.5,
      xp_earned: 10, submitted_at: '2026-05-19T12:00:00.000Z', time_taken_seconds: 1234,
    },
    error: null,
  });
}

const defaultBody = () => ({
  responses: [
    { question_id: QA_ID, response_index: 1, time_taken_seconds: 30 },
    { question_id: QB_ID, response_index: 3, time_taken_seconds: 25 },
  ],
  time_taken_seconds: 1234,
  client_metadata: { user_agent: 'jest' },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let submitPOST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  resetState();
  setFlag(false);
  const mod = await import('@/app/api/exams/papers/[id]/submit/route');
  submitPOST = mod.POST;
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/exams/papers/[id]/submit', () => {
  it('returns 401 when unauthenticated', async () => {
    setUnauthorized();
    const res = await submitPOST(makeReq(CBSE_PAPER_ID, defaultBody()), makeCtx(CBSE_PAPER_ID));
    expect(res.status).toBe(401);
  });

  it('rejects non-UUID id with 400', async () => {
    setAuthorized();
    const res = await submitPOST(makeReq('not-a-uuid', defaultBody()), makeCtx('not-a-uuid'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_paper_id');
  });

  it('rejects empty responses array with 400', async () => {
    setAuthorized();
    seedPapers();
    const res = await submitPOST(
      makeReq(CBSE_PAPER_ID, { responses: [], time_taken_seconds: 100 }),
      makeCtx(CBSE_PAPER_ID),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_responses');
  });

  it('rejects responses.length > 500 with 400', async () => {
    setAuthorized();
    seedPapers();
    const overflow = Array.from({ length: 501 }, () => ({
      question_id: QA_ID,
      response_index: 0,
    }));
    const res = await submitPOST(
      makeReq(CBSE_PAPER_ID, { responses: overflow, time_taken_seconds: 100 }),
      makeCtx(CBSE_PAPER_ID),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_responses');
  });

  it('returns 402 for student on jee_main when flag OFF', async () => {
    setAuthorized({ roles: ['student'] });
    setFlag(false);
    seedPapers();
    seedQuestions(JEE_PAPER_ID);
    const res = await submitPOST(makeReq(JEE_PAPER_ID, defaultBody()), makeCtx(JEE_PAPER_ID));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('competition_plan_required');
    expect(body.upgrade_url).toBe('/upgrade');
  });

  it('returns 200 for cbse_board paper regardless of flag state', async () => {
    setAuthorized({ roles: ['student'] });
    setFlag(false);
    seedPapers();
    seedQuestions(CBSE_PAPER_ID);
    rpcSuccess(CBSE_PAPER_ID);
    const res = await submitPOST(makeReq(CBSE_PAPER_ID, defaultBody()), makeCtx(CBSE_PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempt_id).toBe('55555555-5555-4555-a555-555555555555');
    expect(body.paper_id).toBe(CBSE_PAPER_ID);
    expect(body.summary.score_percent).toBe(37.5);
    expect(body.summary.xp_earned).toBe(10);
    expect(Array.isArray(body.review)).toBe(true);
    expect(body.review).toHaveLength(2);
  });

  it('returns 200 for jee_main when flag is ON', async () => {
    setAuthorized({ roles: ['student'] });
    setFlag(true);
    seedPapers();
    seedQuestions(JEE_PAPER_ID);
    rpcSuccess(JEE_PAPER_ID);
    const res = await submitPOST(makeReq(JEE_PAPER_ID, defaultBody()), makeCtx(JEE_PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paper_id).toBe(JEE_PAPER_ID);
    expect(body.summary.total_questions).toBe(2);
  });

  it('returns 500 with submission_failed when the RPC errors', async () => {
    setAuthorized({ roles: ['student'] });
    setFlag(false);
    seedPapers();
    seedQuestions(CBSE_PAPER_ID);
    state.rpcImpl = () =>
      Promise.resolve({ data: null, error: { message: 'simulated_rpc_failure' } });
    const res = await submitPOST(makeReq(CBSE_PAPER_ID, defaultBody()), makeCtx(CBSE_PAPER_ID));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('submission_failed');
  });

  it('returns 404 for unknown paper id', async () => {
    setAuthorized({ roles: ['student'] });
    const res = await submitPOST(
      makeReq(MISSING_PAPER_ID, defaultBody()),
      makeCtx(MISSING_PAPER_ID),
    );
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('paper_not_found');
  });

  it('double-submit within 60s returns the existing attempt (idempotency)', async () => {
    setAuthorized({ roles: ['student'] });
    setFlag(false);
    seedPapers();
    seedQuestions(CBSE_PAPER_ID);
    state.mock_test_attempts = [{
      id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
      student_id: 'student-uuid-1', paper_id: CBSE_PAPER_ID, status: 'submitted',
      submitted_at: new Date(Date.now() - 5_000).toISOString(),
      total_questions: 2, attempted_count: 2, correct_count: 2, wrong_count: 0,
      skipped_count: 0, raw_score: 8, max_score: 8, score_percent: 100,
      xp_earned: 25, time_taken_seconds: 900,
    }];
    // If the RPC fires, the test must fail — proves short-circuit.
    state.rpcImpl = () =>
      Promise.resolve({ data: null, error: { message: 'RPC must not run on replay' } });
    const res = await submitPOST(makeReq(CBSE_PAPER_ID, defaultBody()), makeCtx(CBSE_PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempt_id).toBe('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
    expect(body.summary.score_percent).toBe(100);
    expect(body.summary.xp_earned).toBe(25);
  });

  it('response includes review[] with is_correct + revealed correct_answer_index', async () => {
    setAuthorized({ roles: ['student'] });
    setFlag(false);
    seedPapers();
    seedQuestions(CBSE_PAPER_ID);
    rpcSuccess(CBSE_PAPER_ID);
    const res = await submitPOST(makeReq(CBSE_PAPER_ID, defaultBody()), makeCtx(CBSE_PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Q_A response_index=1, correct=1 → is_correct true (+4).
    // Q_B response_index=3, correct=0 → is_correct false (-1).
    const ra = body.review.find((r: { question_id: string }) => r.question_id === QA_ID);
    const rb = body.review.find((r: { question_id: string }) => r.question_id === QB_ID);
    expect(ra.is_correct).toBe(true);
    expect(ra.correct_answer_index).toBe(1);
    expect(ra.explanation).toBe('Apply v=u+at.');
    expect(ra.chapter_title).toBe('Mechanics');
    expect(ra.marks_awarded).toBe(4);
    expect(rb.is_correct).toBe(false);
    expect(rb.correct_answer_index).toBe(0);
    expect(rb.marks_awarded).toBe(-1);
  });

  it('admin role bypasses the flag gate on a jee_main paper', async () => {
    // Admin still needs a studentId for the RPC; stub one so we prove the
    // flag-gate bypass without tripping student_profile_required.
    setAuthorized({ roles: ['admin'], studentId: 'admin-as-student-uuid' });
    setFlag(false); // off — proves the bypass
    seedPapers();
    seedQuestions(JEE_PAPER_ID);
    rpcSuccess(JEE_PAPER_ID);
    const res = await submitPOST(makeReq(JEE_PAPER_ID, defaultBody()), makeCtx(JEE_PAPER_ID));
    expect(res.status).toBe(200);
    expect((await res.json()).paper_id).toBe(JEE_PAPER_ID);
  });
});
