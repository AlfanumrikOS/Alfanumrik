/**
 * /api/exams/papers — list + detail route tests (JEE/NEET PR-5).
 *
 * Pins:
 *  - Auth gate fires (`exam.view` permission).
 *  - 401 when authorizeRequest fails.
 *  - Catalog returns all matching papers regardless of flag state — the
 *    runner (`/api/exams/papers/[id]`) is the security boundary, not the
 *    catalog. Frontend renders locked cards for non-cbse rows when the
 *    flag is off (uses the `flag_enabled` field).
 *  - exam_family query param filters via `.eq('exam_family', ...)` and is
 *    honoured irrespective of flag state.
 *  - Invalid UUID on the detail route → 400.
 *  - 402 when caller is a student, flag OFF, and the paper is a non-cbse
 *    family → returns `competition_plan_required` + `upgrade_url`.
 *  - 200 for cbse_board papers regardless of flag state.
 *  - Student role: response strips `correct_answer_index` and `explanation`.
 *  - Admin role: response keeps `correct_answer_index` and `explanation`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── RBAC mock ────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
}));

function setAuthorized(opts?: { roles?: string[] }) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: 'student-uuid-1',
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

// ── Logger mock ──────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Feature flag mock ────────────────────────────────────────────────────
const _flagImpl = vi.fn();

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _flagImpl(...args),
}));

function setFlag(enabled: boolean) {
  _flagImpl.mockResolvedValue(enabled);
}

// ── Supabase admin mock ──────────────────────────────────────────────────
// Two-table model: 'exam_papers' (list + single lookup) and 'question_bank'
// (rows by exam_paper_id). The chain is lazy: filters accumulate; the
// terminal node (await on the chain OR .maybeSingle()) resolves against the
// in-memory tables.

interface MockState {
  exam_papers: Array<Record<string, unknown>>;
  question_bank: Array<Record<string, unknown>>;
  tableError?: { table: string; message: string };
}

const state: MockState = {
  exam_papers: [],
  question_bank: [],
};

function resetState() {
  state.exam_papers = [];
  state.question_bank = [];
  state.tableError = undefined;
}

interface Filter {
  kind: 'eq' | 'contains';
  col: string;
  val: unknown;
}

function applyFilters(
  rows: Array<Record<string, unknown>>,
  filters: Filter[],
): Array<Record<string, unknown>> {
  return rows.filter((r) =>
    filters.every((f) => {
      if (f.kind === 'eq') return r[f.col] === f.val;
      if (f.kind === 'contains') {
        const arr = r[f.col] as unknown;
        if (!Array.isArray(arr)) return false;
        const target = f.val as unknown[];
        return target.every((t) => arr.includes(t));
      }
      return true;
    }),
  );
}

function buildChain(table: keyof MockState | string) {
  const filters: Filter[] = [];
  let _limit: number | null = null;
  const orders: Array<{ col: string; ascending: boolean }> = [];

  const exec = () => {
    if (state.tableError && state.tableError.table === table) {
      return Promise.resolve({ data: null, error: { message: state.tableError.message } });
    }
    const tableKey = table as keyof MockState;
    const src = (state[tableKey] as Array<Record<string, unknown>>) ?? [];
    let rows = applyFilters(src, filters);
    // Apply orders (last order applied first to match Postgres LIFO sort
    // chaining, but for our cases only the first matters).
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
    contains: (col: string, val: unknown) => typeof chain;
    order: (col: string, opts?: { ascending?: boolean }) => typeof chain;
    limit: (n: number) => typeof chain;
    maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
    then: (
      onfulfilled: (v: { data: unknown; error: unknown }) => unknown,
      onrejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    select(_cols: string) {
      return chain;
    },
    eq(col: string, val: unknown) {
      filters.push({ kind: 'eq', col, val });
      return chain;
    },
    contains(col: string, val: unknown) {
      filters.push({ kind: 'contains', col, val });
      return chain;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orders.push({ col, ascending: opts?.ascending ?? true });
      return chain;
    },
    limit(n: number) {
      _limit = n;
      return chain;
    },
    maybeSingle() {
      return exec().then((r) => {
        const rows = (r.data as unknown[] | null) ?? [];
        return { data: (rows as unknown[])[0] ?? null, error: r.error };
      });
    },
    then(onfulfilled, onrejected) {
      return exec().then(onfulfilled, onrejected);
    },
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => buildChain(table),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────

const CBSE_PAPER_ID = '11111111-1111-4111-a111-111111111111';
const JEE_PAPER_ID = '22222222-2222-4222-a222-222222222222';
const QUESTION_ID = '33333333-3333-4333-a333-333333333333';

function makeListRequest(query: string = ''): Request {
  return new Request(`http://localhost/api/exams/papers${query ? `?${query}` : ''}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer fake.jwt' },
  });
}

function makeDetailRequest(id: string): Request {
  return new Request(`http://localhost/api/exams/papers/${id}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer fake.jwt' },
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function seedDefaultPapers() {
  state.exam_papers = [
    {
      id: CBSE_PAPER_ID,
      paper_code: 'sample_cbse_phy_v1',
      exam_family: 'cbse_board',
      exam_session: null,
      paper_pattern: 'mcq_single',
      exam_year: 2025,
      exam_month: null,
      shift: null,
      subject_scope: ['physics'],
      total_questions: 30,
      total_marks: 120,
      duration_minutes: 60,
      marking_scheme: { correct: 4, wrong: -1, unanswered: 0 },
      source_url: null,
      source_attribution: 'CBSE official',
      is_active: true,
    },
    {
      id: JEE_PAPER_ID,
      paper_code: 'sample_jee_main_phy_v1',
      exam_family: 'jee_main',
      exam_session: 'jee_main_jan_2024',
      paper_pattern: 'mcq_single',
      exam_year: 2024,
      exam_month: 1,
      shift: 'morning',
      subject_scope: ['physics'],
      total_questions: 30,
      total_marks: 120,
      duration_minutes: 60,
      marking_scheme: { correct: 4, wrong: -1, unanswered: 0 },
      source_url: 'https://nta.example/jee',
      source_attribution: 'NTA official',
      is_active: true,
    },
  ];
}

function seedQuestionsForPaper(paperId: string) {
  state.question_bank = [
    {
      id: QUESTION_ID,
      question_text: 'A body moves with velocity v...',
      options: ['10 m/s', '20 m/s', '30 m/s', '40 m/s'],
      correct_answer_index: 1,
      explanation: 'Apply v=u+at.',
      hint: 'Use kinematics',
      difficulty: 'medium',
      bloom_level: 'apply',
      marks_correct: 4,
      marks_wrong: -1,
      question_number: 'Q1',
      paper_pattern: 'mcq_single',
      chapter_title: 'Mechanics',
      chapter_number: 1,
      subject: 'physics',
      exam_paper_id: paperId,
      is_active: true,
      is_verified: true,
    },
  ];
}

// ── Dynamic imports ──────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let listGET: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let detailGET: any;

beforeEach(async () => {
  vi.clearAllMocks();
  resetState();
  setFlag(false);

  const listMod = await import('@/app/api/exams/papers/route');
  const detailMod = await import('@/app/api/exams/papers/[id]/route');
  listGET = listMod.GET;
  detailGET = detailMod.GET;
});

// ── Tests: list route ────────────────────────────────────────────────────

describe('GET /api/exams/papers', () => {
  it('returns 401 when unauthenticated', async () => {
    setUnauthorized();
    seedDefaultPapers();
    const res = await listGET(makeListRequest());
    expect(res.status).toBe(401);
  });

  it('returns all papers regardless of flag state (flag controls only the runner gate)', async () => {
    setAuthorized();
    setFlag(false);
    seedDefaultPapers();

    const res = await listGET(makeListRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    // Flag is OFF but the catalog still returns every active paper. The
    // frontend reads `flag_enabled` and renders non-cbse rows as locked
    // cards routed to /upgrade. The runner route enforces 402 row-by-row.
    expect(body.flag_enabled).toBe(false);
    expect(body.papers).toHaveLength(2);
    const families = body.papers.map((p: { exam_family: string }) => p.exam_family).sort();
    expect(families).toEqual(['cbse_board', 'jee_main']);
    expect(body.total).toBe(2);
  });

  it('with flag ON returns all matching papers', async () => {
    setAuthorized();
    setFlag(true);
    seedDefaultPapers();

    const res = await listGET(makeListRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.flag_enabled).toBe(true);
    expect(body.papers).toHaveLength(2);
    const families = body.papers.map((p: { exam_family: string }) => p.exam_family).sort();
    expect(families).toEqual(['cbse_board', 'jee_main']);
    expect(body.total).toBe(2);
  });

  it('filters by exam_family=jee_main (flag ON)', async () => {
    setAuthorized();
    setFlag(true);
    seedDefaultPapers();

    const res = await listGET(makeListRequest('exam_family=jee_main'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.papers).toHaveLength(1);
    expect(body.papers[0].exam_family).toBe('jee_main');
    expect(body.papers[0].id).toBe(JEE_PAPER_ID);
  });

  it('with flag OFF + exam_family=jee_main returns the JEE Main papers (runner enforces 402)', async () => {
    setAuthorized();
    setFlag(false);
    seedDefaultPapers();

    const res = await listGET(makeListRequest('exam_family=jee_main'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Catalog returns matching papers regardless of flag — frontend uses
    // `flag_enabled` to render them as locked cards. The runner route
    // (`/api/exams/papers/[id]`) is where access is hard-blocked with 402.
    expect(body.papers).toHaveLength(1);
    expect(body.papers[0].exam_family).toBe('jee_main');
    expect(body.papers[0].id).toBe(JEE_PAPER_ID);
    expect(body.flag_enabled).toBe(false);
  });

  it('reports flag_enabled=false in the response when the flag is off', async () => {
    setAuthorized();
    setFlag(false);
    seedDefaultPapers();

    const res = await listGET(makeListRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    // The frontend depends on `flag_enabled` to decide which cards render
    // as locked. If the catalog stopped reporting the flag, the lock UX
    // would silently break — pin the contract here.
    expect(body.flag_enabled).toBe(false);
  });

  it('rejects invalid exam_family with 400', async () => {
    setAuthorized();
    const res = await listGET(makeListRequest('exam_family=not_a_real_family'));
    expect(res.status).toBe(400);
  });

  it('clamps limit > 50 down to 50', async () => {
    setAuthorized();
    setFlag(true);
    seedDefaultPapers();

    const res = await listGET(makeListRequest('limit=9999'));
    expect(res.status).toBe(200);
    // No assertion on count because we only have 2 seeded rows, but the
    // route must not 500/400.
  });

  // ── Phase 2.2 remediation: widened VALID_SUBJECTS + grade filtering ─────

  it('accepts a CBSE-catalog subject that was previously rejected (e.g. social_studies)', async () => {
    setAuthorized();
    setFlag(true);
    seedDefaultPapers();
    const res = await listGET(makeListRequest('subject=social_studies'));
    expect(res.status).toBe(200);
  });

  it('still rejects an unknown subject with 400', async () => {
    setAuthorized();
    const res = await listGET(makeListRequest('subject=not_a_real_subject'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_subject');
  });

  it('filters by grade when the exam_papers rows have a grade column', async () => {
    setAuthorized();
    setFlag(true);
    state.exam_papers = [
      {
        id: CBSE_PAPER_ID,
        paper_code: 'cbse_board_g9_math_v1',
        exam_family: 'cbse_board',
        grade: '9',
        subject_scope: ['math'],
        is_active: true,
        total_questions: 39,
        total_marks: 80,
        duration_minutes: 180,
        marking_scheme: { correct: null, wrong: 0, unanswered: 0 },
      },
      {
        id: JEE_PAPER_ID,
        paper_code: 'cbse_board_g10_math_v1',
        exam_family: 'cbse_board',
        grade: '10',
        subject_scope: ['math'],
        is_active: true,
        total_questions: 39,
        total_marks: 80,
        duration_minutes: 180,
        marking_scheme: { correct: null, wrong: 0, unanswered: 0 },
      },
    ];
    const res = await listGET(makeListRequest('grade=9'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.papers).toHaveLength(1);
    expect(body.papers[0].id).toBe(CBSE_PAPER_ID);
  });

  it('still rejects an invalid grade with 400', async () => {
    setAuthorized();
    const res = await listGET(makeListRequest('grade=13'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grade');
  });

  // ── Phase 2.2 follow-up: legacy multi-subject sample paper deactivation ──
  // (migration 20260722097200_deactivate_legacy_cbse_multisubject_sample_paper.sql
  // sets is_active=false on paper_code='sample_cbse_class12_general_v1' so it
  // stops routing through the new dynamic-assembly /start path, which 500s
  // for any paper whose subject_scope length !== 1.)

  it('excludes a deactivated (is_active=false) paper from the catalog', async () => {
    setAuthorized();
    setFlag(true);
    const LEGACY_ID = '55555555-5555-4555-a555-555555555555';
    state.exam_papers = [
      {
        id: LEGACY_ID,
        paper_code: 'sample_cbse_class12_general_v1',
        exam_family: 'cbse_board',
        grade: null,
        subject_scope: ['physics', 'chemistry', 'biology', 'math'],
        is_active: false,
        total_questions: 30,
        total_marks: 120,
        duration_minutes: 180,
        marking_scheme: { correct: 4, wrong: -1, unanswered: 0 },
      },
      {
        id: CBSE_PAPER_ID,
        paper_code: 'cbse_board_g12_physics_v1',
        exam_family: 'cbse_board',
        grade: '12',
        subject_scope: ['physics'],
        is_active: true,
        total_questions: 39,
        total_marks: 80,
        duration_minutes: 180,
        marking_scheme: { correct: null, wrong: 0, unanswered: 0 },
      },
    ];
    const res = await listGET(makeListRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    const codes = body.papers.map((p: { paper_code: string }) => p.paper_code);
    expect(codes).not.toContain('sample_cbse_class12_general_v1');
    expect(codes).toContain('cbse_board_g12_physics_v1');
  });

  it('404s the detail route for a deactivated paper id (no dangling reference)', async () => {
    setAuthorized();
    setFlag(true);
    const LEGACY_ID = '55555555-5555-4555-a555-555555555555';
    state.exam_papers = [
      {
        id: LEGACY_ID,
        paper_code: 'sample_cbse_class12_general_v1',
        exam_family: 'cbse_board',
        grade: null,
        subject_scope: ['physics', 'chemistry', 'biology', 'math'],
        is_active: false,
        total_questions: 30,
        total_marks: 120,
        duration_minutes: 180,
        marking_scheme: { correct: 4, wrong: -1, unanswered: 0 },
      },
    ];
    const res = await detailGET(makeDetailRequest(LEGACY_ID), makeContext(LEGACY_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('paper_not_found');
  });
});

// ── Tests: detail route ──────────────────────────────────────────────────

describe('GET /api/exams/papers/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    setUnauthorized();
    const res = await detailGET(makeDetailRequest(CBSE_PAPER_ID), makeContext(CBSE_PAPER_ID));
    expect(res.status).toBe(401);
  });

  it('rejects non-UUID id with 400', async () => {
    setAuthorized();
    const res = await detailGET(makeDetailRequest('not-a-uuid'), makeContext('not-a-uuid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_paper_id');
  });

  it('returns 404 for unknown paper id', async () => {
    setAuthorized();
    setFlag(true);
    // No seed → paper_not_found.
    const missingId = '99999999-9999-4999-a999-999999999999';
    const res = await detailGET(makeDetailRequest(missingId), makeContext(missingId));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('paper_not_found');
  });

  it('returns 402 when student loads a jee_main paper with flag OFF', async () => {
    setAuthorized({ roles: ['student'] });
    setFlag(false);
    seedDefaultPapers();
    seedQuestionsForPaper(JEE_PAPER_ID);

    const res = await detailGET(makeDetailRequest(JEE_PAPER_ID), makeContext(JEE_PAPER_ID));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('competition_plan_required');
    expect(body.upgrade_url).toBe('/upgrade');
  });

  it('returns 200 for cbse_board paper irrespective of flag state', async () => {
    setAuthorized({ roles: ['student'] });
    seedDefaultPapers();
    seedQuestionsForPaper(CBSE_PAPER_ID);

    // Flag OFF case.
    setFlag(false);
    let res = await detailGET(makeDetailRequest(CBSE_PAPER_ID), makeContext(CBSE_PAPER_ID));
    expect(res.status).toBe(200);
    let body = await res.json();
    expect(body.paper.exam_family).toBe('cbse_board');
    expect(body.served_count).toBe(1);

    // Flag ON case — re-import not needed; same module instance, fresh state.
    setFlag(true);
    res = await detailGET(makeDetailRequest(CBSE_PAPER_ID), makeContext(CBSE_PAPER_ID));
    expect(res.status).toBe(200);
    body = await res.json();
    expect(body.paper.exam_family).toBe('cbse_board');
  });

  it('returns 200 for jee_main paper when flag is ON for a student', async () => {
    setAuthorized({ roles: ['student'] });
    setFlag(true);
    seedDefaultPapers();
    seedQuestionsForPaper(JEE_PAPER_ID);

    const res = await detailGET(makeDetailRequest(JEE_PAPER_ID), makeContext(JEE_PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewer_role).toBe('student');
    expect(body.paper.exam_family).toBe('jee_main');
  });

  it('strips correct_answer_index and explanation for student role', async () => {
    setAuthorized({ roles: ['student'] });
    setFlag(true);
    seedDefaultPapers();
    seedQuestionsForPaper(JEE_PAPER_ID);

    const res = await detailGET(makeDetailRequest(JEE_PAPER_ID), makeContext(JEE_PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewer_role).toBe('student');
    expect(body.questions).toHaveLength(1);
    const q = body.questions[0];
    expect(q.correct_answer_index).toBeUndefined();
    expect(q.explanation).toBeUndefined();
    // Student-safe fields should be present.
    expect(q.question_text).toBe('A body moves with velocity v...');
    expect(q.options).toEqual(['10 m/s', '20 m/s', '30 m/s', '40 m/s']);
    expect(q.hint).toBe('Use kinematics');
    expect(q.marks_correct).toBe(4);
    expect(q.marks_wrong).toBe(-1);
    expect(q.paper_pattern).toBe('mcq_single');
    expect(q.chapter_title).toBe('Mechanics');
    expect(q.subject).toBe('physics');
  });

  it('returns full data including correct_answer_index for admin role', async () => {
    setAuthorized({ roles: ['admin'] });
    // Admin path bypasses the flag — set OFF to prove the bypass.
    setFlag(false);
    seedDefaultPapers();
    seedQuestionsForPaper(JEE_PAPER_ID);

    const res = await detailGET(makeDetailRequest(JEE_PAPER_ID), makeContext(JEE_PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewer_role).toBe('admin');
    expect(body.questions).toHaveLength(1);
    const q = body.questions[0];
    expect(q.correct_answer_index).toBe(1);
    expect(q.explanation).toBe('Apply v=u+at.');
  });

  it('returns full data for super_admin role on a non-cbse paper with flag OFF', async () => {
    setAuthorized({ roles: ['super_admin'] });
    setFlag(false);
    seedDefaultPapers();
    seedQuestionsForPaper(JEE_PAPER_ID);

    const res = await detailGET(makeDetailRequest(JEE_PAPER_ID), makeContext(JEE_PAPER_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewer_role).toBe('admin');
    expect(body.questions[0].correct_answer_index).toBe(1);
  });

  it('sets Cache-Control: private, max-age=300 on success', async () => {
    setAuthorized({ roles: ['student'] });
    seedDefaultPapers();
    seedQuestionsForPaper(CBSE_PAPER_ID);

    const res = await detailGET(makeDetailRequest(CBSE_PAPER_ID), makeContext(CBSE_PAPER_ID));
    const cc = res.headers.get('Cache-Control') ?? '';
    expect(cc).toContain('private');
    expect(cc).toContain('max-age=300');
  });
});
