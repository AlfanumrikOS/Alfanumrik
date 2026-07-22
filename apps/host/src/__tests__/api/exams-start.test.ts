/**
 * /api/exams/papers/[id]/start — POST route tests (Phase 2.2 remediation).
 *
 * Pins: auth gate, UUID validation, 404 for unknown paper, 400 for
 * non-cbse_board papers (this route is cbse_board-only), 403 when no
 * student profile, 200 with attempt_id + questions on success, 200 with an
 * empty questions array + truthy attempt_id for the content_insufficient
 * case (matches the frontend's NotReadyCard contract — see
 * apps/host/src/app/(student)/exams/mock/[paperId]/page.tsx), 500 when the
 * RPC errors.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface MockState {
  exam_papers: Array<Record<string, unknown>>;
  rpcImpl:
    | ((name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)
    | null;
}

const state: MockState = { exam_papers: [], rpcImpl: null };

function resetState() {
  state.exam_papers = [];
  state.rpcImpl = null;
}

function buildChain(table: keyof MockState | string) {
  const filters: Array<{ col: string; val: unknown }> = [];

  const exec = () => {
    const src = (state[table as keyof MockState] as Array<Record<string, unknown>>) ?? [];
    const rows = src.filter((r) => filters.every((f) => r[f.col] === f.val));
    return Promise.resolve({ data: rows, error: null });
  };

  const chain: {
    select: (cols: string) => typeof chain;
    eq: (col: string, val: unknown) => typeof chain;
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  } = {
    select(_c) { return chain; },
    eq(col, val) { filters.push({ col, val }); return chain; },
    maybeSingle() {
      return exec().then((r) => {
        const rows = (r.data as unknown[] | null) ?? [];
        return { data: (rows as unknown[])[0] ?? null, error: r.error };
      });
    },
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

const CBSE_PAPER_ID = '11111111-1111-4111-a111-111111111111';
const JEE_PAPER_ID = '22222222-2222-4222-a222-222222222222';
const MISSING_ID = '99999999-9999-4999-a999-999999999999';

function makeReq(id: string): Request {
  return new Request(`http://localhost/api/exams/papers/${id}/start`, {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt' },
  });
}
const makeCtx = (id: string) => ({ params: Promise.resolve({ id }) });

function seedPapers() {
  state.exam_papers = [
    { id: CBSE_PAPER_ID, exam_family: 'cbse_board', grade: '10', subject_scope: ['math'], is_active: true },
    { id: JEE_PAPER_ID, exam_family: 'jee_main', grade: null, subject_scope: ['physics'], is_active: true },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let startPOST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  resetState();
  const mod = await import('@/app/api/exams/papers/[id]/start/route');
  startPOST = mod.POST;
});

describe('POST /api/exams/papers/[id]/start', () => {
  it('returns 401 when unauthenticated', async () => {
    setUnauthorized();
    const res = await startPOST(makeReq(CBSE_PAPER_ID), makeCtx(CBSE_PAPER_ID));
    expect(res.status).toBe(401);
  });

  it('rejects non-UUID id with 400', async () => {
    setAuthorized();
    const res = await startPOST(makeReq('not-a-uuid'), makeCtx('not-a-uuid'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_paper_id');
  });

  it('returns 404 for unknown paper id', async () => {
    setAuthorized();
    const res = await startPOST(makeReq(MISSING_ID), makeCtx(MISSING_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('paper_not_found');
  });

  it('returns 400 paper_not_cbse_board for a non-cbse_board paper', async () => {
    setAuthorized();
    seedPapers();
    const res = await startPOST(makeReq(JEE_PAPER_ID), makeCtx(JEE_PAPER_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('paper_not_cbse_board');
  });

  it('returns 403 student_profile_required when no student profile', async () => {
    setAuthorized({ studentId: null });
    seedPapers();
    const res = await startPOST(makeReq(CBSE_PAPER_ID), makeCtx(CBSE_PAPER_ID));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('student_profile_required');
  });

  it('returns 200 with attempt_id + questions on a successful assembly', async () => {
    setAuthorized();
    seedPapers();
    state.rpcImpl = () => Promise.resolve({
      data: {
        attempt_id: '55555555-5555-4555-a555-555555555555',
        questions: [
          { question_id: 'q1', section: 'A', marks: 1, order: 1, text: 'Q1', options: ['a', 'b', 'c', 'd'] },
        ],
      },
      error: null,
    });
    const res = await startPOST(makeReq(CBSE_PAPER_ID), makeCtx(CBSE_PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempt_id).toBe('55555555-5555-4555-a555-555555555555');
    expect(body.questions).toHaveLength(1);
  });

  it('returns 200 with an empty questions array (truthy attempt_id) when content is insufficient', async () => {
    setAuthorized();
    seedPapers();
    state.rpcImpl = () => Promise.resolve({
      data: {
        attempt_id: 'aaaaaaaa-0000-4000-a000-000000000000',
        questions: [],
        content_insufficient: true,
        deficient_sections: [{ section: 'E', required: 3, filled: 0 }],
      },
      error: null,
    });
    const res = await startPOST(makeReq(CBSE_PAPER_ID), makeCtx(CBSE_PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Frontend's contract: attempt_id must be truthy AND questions must be
    // an array for `adaptStartQuestions([]).length === 0` to trigger
    // NotReadyCard instead of the generic StartErrorCard.
    expect(body.attempt_id).toBeTruthy();
    expect(Array.isArray(body.questions)).toBe(true);
    expect(body.questions).toHaveLength(0);
  });

  it('returns 500 start_failed when the RPC errors', async () => {
    setAuthorized();
    seedPapers();
    state.rpcImpl = () => Promise.resolve({ data: null, error: { message: 'boom' } });
    const res = await startPOST(makeReq(CBSE_PAPER_ID), makeCtx(CBSE_PAPER_ID));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('start_failed');
  });

  it('rejects non-POST methods with 405', async () => {
    const mod = await import('@/app/api/exams/papers/[id]/start/route');
    const res = await mod.GET();
    expect(res.status).toBe(405);
  });
});

/**
 * Static-source contract canary for the `start_mock_test_attempt` RPC
 * (assessment REJECTION fix, 2026-07-21): the RPC's SQL is the actual
 * source of question selection — it cannot be exercised from these
 * route-level tests since `supabaseAdmin.rpc` is mocked above. This proves
 * the source_type isolation directly against the migration text: every one
 * of the 3 fallback-ladder SELECT steps (exact difficulty, +/-1, any
 * difficulty) must scope to the CBSE-board-appropriate source_type
 * allow-list, and none may admit a competition-tier value
 * (jee_archive/neet_archive/olympiad/pyq), even on step 3 ("any
 * difficulty") which is precisely the step that silently served
 * competition content before this fix.
 */
describe('start_mock_test_attempt RPC — source_type isolation (static contract)', () => {
  const migrationPath = resolve(
    __dirname, '..', '..', '..', '..', '..',
    'supabase', 'migrations', '20260722097000_start_mock_test_attempt_rpc.sql',
  );
  const migrationSql = readFileSync(migrationPath, 'utf8');

  const BOARD_SOURCE_TYPES = [
    'ncert_intext', 'ncert_exercise', 'ncert_example',
    'cbse_style', 'board_paper', 'practice',
  ];
  const COMPETITION_SOURCE_TYPES = ['jee_archive', 'neet_archive', 'olympiad', 'pyq'];

  // Extract the plpgsql function body once so we only inspect executable
  // SQL, not the prose header comment (which legitimately names the
  // competition source_types it excludes).
  const fnBody = (() => {
    const start = migrationSql.indexOf('AS $$');
    const end = migrationSql.indexOf('\n$$;');
    if (start < 0 || end < 0) {
      throw new Error('Could not isolate start_mock_test_attempt function body for static analysis');
    }
    return migrationSql.slice(start, end);
  })();

  const selectBlocks = fnBody
    .split(/SELECT id FROM public\.question_bank/)
    .slice(1); // first split chunk is pre-amble before the first SELECT

  it('has exactly 3 question_bank SELECT steps (the fallback ladder)', () => {
    expect(selectBlocks).toHaveLength(3);
  });

  it('scopes every fallback-ladder SELECT to the CBSE-board source_type allow-list', () => {
    const expectedFilter =
      "source_type = ANY (ARRAY['ncert_intext','ncert_exercise','ncert_example','cbse_style','board_paper','practice'])";
    selectBlocks.forEach((block, i) => {
      // Only inspect up to the next LOOP/ORDER BY boundary so we scope the
      // assertion to this step's own WHERE clause.
      const clause = block.split('ORDER BY')[0];
      expect(clause, `fallback step ${i + 1} WHERE clause`).toContain(expectedFilter);
    });
  });

  it('never admits a competition-tier source_type on any fallback step, including step 3 ("any difficulty")', () => {
    selectBlocks.forEach((block, i) => {
      const clause = block.split('ORDER BY')[0];
      COMPETITION_SOURCE_TYPES.forEach((competitionType) => {
        expect(clause, `fallback step ${i + 1} must not reference ${competitionType}`).not.toContain(competitionType);
      });
    });
  });

  it('the board source_type allow-list contains only known CBSE-board-appropriate values', () => {
    // Guards against a future edit accidentally widening the allow-list
    // in the migration to include a competition-tier value.
    const arrayLiteralMatches = fnBody.match(
      /source_type = ANY \(ARRAY\[([^\]]+)\]\)/g,
    );
    expect(arrayLiteralMatches?.length).toBe(3);
    arrayLiteralMatches?.forEach((literal) => {
      COMPETITION_SOURCE_TYPES.forEach((competitionType) => {
        expect(literal).not.toContain(competitionType);
      });
      BOARD_SOURCE_TYPES.forEach((boardType) => {
        expect(literal).toContain(boardType);
      });
    });
  });
});
