/**
 * QUIZ-ACTIVE — regression tests for the suspended/soft-deleted student gate
 * on the quiz start and submit paths.
 *
 * Finding: docs/audit/2026-07-02-validation/10-security-audit.md
 * "QUIZ-ACTIVE: src/app/api/quiz/route.ts missing is_active/account_status check"
 *
 * Prior to the fix, `resolveStudent()` in `src/app/api/quiz/route.ts` (used by
 * both GET and POST) and the students lookup in
 * `src/app/api/quiz/submit/route.ts` looked up the student by `id` or
 * `auth_user_id` with NO `.eq('is_active', true)` / `.is('deleted_at', null)`
 * filter. A super-admin-suspended or soft-deleted student with a still-valid
 * JWT could keep starting and submitting quizzes (and earning XP), fully
 * bypassing the suspension.
 *
 * Fix: every students lookup branch in both routes now chains
 * `.eq('is_active', true).is('deleted_at', null)`. These tests pin the gate
 * against regression using argument-sensitive mocks that only resolve a
 * students row when BOTH conditions are satisfied — mirroring real Postgres
 * filtering behavior and the house pattern from the synthesis/rhythm
 * hardening.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const AUTH_USER_ID = 'auth-user-1';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';

// ── RBAC mock (shared across both routes) ───────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: vi.fn(),
}));

function setAuthorized(opts: { studentId?: string | null } = {}) {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: opts.studentId ?? null,
    roles: ['student'],
    permissions: ['quiz.attempt'],
  });
}

// ── Soft-fail-friendly collaborator mocks ───────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@alfanumrik/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@alfanumrik/lib/posthog/server', () => ({
  capture: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}));

// ── Argument-sensitive `students` table mock ────────────────────────────────
// Mirrors real Postgres filtering: a row is only returned when every applied
// .eq()/.is() filter on the chain actually matches the fixture. This is the
// house pattern used for the synthesis/rhythm hardening — reused here so a
// future regression that drops the `is_active`/`deleted_at` filter (or
// stubs the mock unconditionally) is caught by these tests failing loudly.
interface FakeStudent {
  id: string;
  auth_user_id: string;
  grade: string;
  is_active: boolean;
  deleted_at: string | null;
}

let _student: FakeStudent | null = null;

function studentsChain() {
  const filters: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return chain;
    },
    is: (col: string, val: unknown) => {
      filters[col] = val;
      return chain;
    },
  };
  const resolve = () => {
    if (!_student) return { data: null, error: { message: 'not found' } };
    for (const [col, val] of Object.entries(filters)) {
      if (col === 'deleted_at') {
        // .is('deleted_at', null) must exclude soft-deleted rows.
        if (val === null && _student.deleted_at !== null) {
          return { data: null, error: { message: 'not found' } };
        }
        continue;
      }
      if ((_student as unknown as Record<string, unknown>)[col] !== val) {
        return { data: null, error: { message: 'not found' } };
      }
    }
    return { data: _student, error: null };
  };
  chain.single = () => Promise.resolve(resolve());
  chain.maybeSingle = () => Promise.resolve(resolve());
  return chain;
}

// ── RPC mock — only what's needed to reach 200 on the active-student path ──
let _rpcResults: Record<string, { data: unknown; error: unknown }> = {};

const adminClient = {
  from: (table: string) => {
    if (table === 'students') return studentsChain();
    // Any other table touched incidentally: harmless not-found chain.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) chain[m] = () => chain;
    chain.single = () => Promise.resolve({ data: null, error: { message: 'not found' } });
    chain.maybeSingle = () => Promise.resolve({ data: null, error: { message: 'not found' } });
    return chain;
  },
  rpc: (name: string) =>
    Promise.resolve(_rpcResults[name] ?? { data: null, error: { message: `unmocked rpc ${name}` } }),
};

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: adminClient,
  getSupabaseAdmin: () => adminClient,
}));

// ── Supabase server (JWT-bound) mock — used by /api/quiz/submit's RPC call ─
let _submitRpcResult: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    rpc: (..._args: unknown[]) => Promise.resolve(_submitRpcResult),
  }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────
function activeStudent(): FakeStudent {
  return { id: STUDENT_ID, auth_user_id: AUTH_USER_ID, grade: '10', is_active: true, deleted_at: null };
}
function suspendedStudent(): FakeStudent {
  return { ...activeStudent(), is_active: false };
}
function softDeletedStudent(): FakeStudent {
  // A soft-deleted row may still carry is_active=true — deleted_at alone
  // must be sufficient to deny.
  return { ...activeStudent(), is_active: true, deleted_at: '2026-06-30T00:00:00Z' };
}

function makeGetRequest(qs: string) {
  return new Request(`http://localhost/api/quiz?${qs}`, {
    headers: { Authorization: 'Bearer valid' },
  });
}
function makePostRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuthorized();
  _student = null;
  _rpcResults = {};
  _submitRpcResult = { data: null, error: null };
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/quiz?action=questions — resolveStudent's fallback branch
// (auth.studentId not resolved, looked up by auth_user_id).
// ═══════════════════════════════════════════════════════════════════════════
describe('QUIZ-ACTIVE: GET /api/quiz?action=questions (start) — auth_user_id lookup branch', () => {
  it('REGRESSION denies a suspended student (is_active=false), not a 200', async () => {
    setAuthorized({ studentId: null });
    _student = suspendedStudent();

    const { GET } = await import('@/app/api/quiz/route');
    const res = await GET(makeGetRequest('action=questions&subject=math&grade=10') as any);

    expect(res.status).not.toBe(200);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('No student profile found for this account.');
  });

  it('REGRESSION denies a soft-deleted student (deleted_at set, is_active=true), not a 200', async () => {
    setAuthorized({ studentId: null });
    _student = softDeletedStudent();

    const { GET } = await import('@/app/api/quiz/route');
    const res = await GET(makeGetRequest('action=questions&subject=math&grade=10') as any);

    expect(res.status).not.toBe(200);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('No student profile found for this account.');
  });

  it('does not false-positive: an active student (is_active=true, deleted_at=null) still succeeds', async () => {
    setAuthorized({ studentId: null });
    _student = activeStudent();
    // validate_academic_scope soft-fails (RPC "unavailable") -> allowed through.
    _rpcResults['select_quiz_questions_rag'] = { data: [], error: null };

    const { GET } = await import('@/app/api/quiz/route');
    const res = await GET(makeGetRequest('action=questions&subject=math&grade=10') as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/quiz (generate-exam / "start") — resolveStudent's primary branch
// (auth.studentId already resolved by authorizeRequest, looked up by id).
// ═══════════════════════════════════════════════════════════════════════════
describe('QUIZ-ACTIVE: POST /api/quiz (generate-exam, start) — id lookup branch', () => {
  it('REGRESSION denies a suspended student (is_active=false), not a 200', async () => {
    setAuthorized({ studentId: STUDENT_ID });
    _student = suspendedStudent();

    const { POST } = await import('@/app/api/quiz/route');
    const res = await POST(
      makePostRequest('http://localhost/api/quiz', {
        action: 'generate-exam',
        subject: 'math',
        grade: '10',
      }) as any,
    );

    expect(res.status).not.toBe(200);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('No student profile found for this account.');
  });

  it('REGRESSION denies a soft-deleted student (deleted_at set, is_active=true), not a 200', async () => {
    setAuthorized({ studentId: STUDENT_ID });
    _student = softDeletedStudent();

    const { POST } = await import('@/app/api/quiz/route');
    const res = await POST(
      makePostRequest('http://localhost/api/quiz', {
        action: 'generate-exam',
        subject: 'math',
        grade: '10',
      }) as any,
    );

    expect(res.status).not.toBe(200);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('No student profile found for this account.');
  });

  it('does not false-positive: an active student (is_active=true, deleted_at=null) still succeeds', async () => {
    setAuthorized({ studentId: STUDENT_ID });
    _student = activeStudent();
    _rpcResults['generate_exam_paper'] = { data: { paper_id: 'p1' }, error: null };

    const { POST } = await import('@/app/api/quiz/route');
    const res = await POST(
      makePostRequest('http://localhost/api/quiz', {
        action: 'generate-exam',
        subject: 'math',
        grade: '10',
      }) as any,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/quiz/submit
// ═══════════════════════════════════════════════════════════════════════════
describe('QUIZ-ACTIVE: POST /api/quiz/submit', () => {
  function submitRequest(studentId: string) {
    return makePostRequest(
      'http://localhost/api/quiz/submit',
      {
        sessionId: SESSION_ID,
        studentId,
        responses: [{ question_id: QUESTION_ID, selected_option: 0, time_taken_seconds: 5 }],
        totalTimeSeconds: 30,
      },
      { 'idempotency-key': IDEMPOTENCY_KEY },
    );
  }

  it('REGRESSION denies a suspended student (is_active=false), not a 200', async () => {
    setAuthorized({ studentId: null });
    _student = suspendedStudent();

    const { POST } = await import('@/app/api/quiz/submit/route');
    const res = await POST(submitRequest(STUDENT_ID) as any);

    expect(res.status).not.toBe(200);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('NO_STUDENT_PROFILE');
  });

  it('REGRESSION denies a soft-deleted student (deleted_at set, is_active=true), not a 200', async () => {
    setAuthorized({ studentId: null });
    _student = softDeletedStudent();

    const { POST } = await import('@/app/api/quiz/submit/route');
    const res = await POST(submitRequest(STUDENT_ID) as any);

    expect(res.status).not.toBe(200);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('NO_STUDENT_PROFILE');
  });

  it('does not false-positive: an active student (is_active=true, deleted_at=null) still succeeds', async () => {
    setAuthorized({ studentId: null });
    _student = activeStudent();
    _submitRpcResult = {
      data: {
        session_id: SESSION_ID,
        score_percent: 100,
        xp_earned: 170,
        correct: 1,
        total: 1,
        flagged: false,
        idempotent_replay: false,
      },
      error: null,
    };

    const { POST } = await import('@/app/api/quiz/submit/route');
    const res = await POST(submitRequest(STUDENT_ID) as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.score_percent).toBe(100);
  });
});
