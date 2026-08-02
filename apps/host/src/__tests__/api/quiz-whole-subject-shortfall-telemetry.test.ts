/**
 * GET /api/quiz?action=questions — whole-subject shortfall telemetry.
 *
 * Spec: docs/superpowers/specs/2026-08-02-quiz-rag-verification-gate-correctness.md
 * §3.6 — flagged to backend by migration
 * `20260802100000_select_quiz_questions_rag_verification_gate.sql`:
 *
 *   "/api/quiz GET and /api/v2/quiz/questions GET have no insufficient-count
 *   guard when `chapter` is omitted. [...] After this fix, an enabled pair
 *   with a thin verified pool in some difficulty/type slice could, for the
 *   first time, silently return fewer questions than requested with no
 *   warning to the student and no telemetry to ops [...] Recommend to
 *   backend: add a length-check + ops_events emission (not a hard reject —
 *   a smaller-than-requested whole-subject quiz can be legitimate for
 *   reasons unrelated to verification)."
 *
 * This pins the fix: the whole-subject (no `chapter`) path now emits
 * `logOpsEvent({ category: 'grounding.quiz_serving', ... })` — the SAME
 * category the RPC's own §3.5 telemetry uses, so ops has one unified signal
 * — whenever the RPC returns fewer rows than `count`, WITHOUT changing the
 * response contract (still `{ success: true, questions }` with the short
 * set). The pre-existing chapter-scoped `insufficient_questions_in_scope`
 * 422 contract is untouched and must not also fire this new telemetry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const AUTH_USER_ID = 'auth-user-1';
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';

// ── RBAC mock ────────────────────────────────────────────────────────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => _authorizeImpl(...args),
  logAudit: vi.fn(),
}));
function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: AUTH_USER_ID,
    studentId: STUDENT_ID,
    roles: ['student'],
    permissions: ['quiz.attempt'],
  });
}

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@alfanumrik/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));

// ── ops-events mock — the thing this test file exists to pin ───────────────
const _logOpsEventImpl = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...args: unknown[]) => _logOpsEventImpl(...args),
}));

// ── students table + RPC mock (mirrors quiz-active-student-gate.test.ts) ───
interface FakeStudent {
  id: string;
  auth_user_id: string;
  grade: string;
  is_active: boolean;
  deleted_at: string | null;
}
function activeStudent(): FakeStudent {
  return { id: STUDENT_ID, auth_user_id: AUTH_USER_ID, grade: '9', is_active: true, deleted_at: null };
}
let _student: FakeStudent | null = null;

function studentsChain() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
  };
  const resolve = () =>
    _student ? { data: _student, error: null } : { data: null, error: { message: 'not found' } };
  chain.single = () => Promise.resolve(resolve());
  chain.maybeSingle = () => Promise.resolve(resolve());
  return chain;
}

let _rpcResults: Record<string, { data: unknown; error: unknown }> = {};
const adminClient = {
  from: (table: string) => {
    if (table === 'students') return studentsChain();
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

// ── Fixtures ────────────────────────────────────────────────────────────
function ragRow(overrides: Record<string, unknown> = {}) {
  return {
    id: `q-${Math.random().toString(36).slice(2)}`,
    question_text: 'Sample question text?',
    question_hi: null,
    question_type: 'mcq',
    question_type_v2: 'mcq',
    options: ['a', 'b', 'c', 'd'],
    correct_answer_index: 1,
    explanation: 'because',
    explanation_hi: null,
    hint: null,
    difficulty: 2,
    bloom_level: 'remember',
    chapter_number: 3,
    ...overrides,
  };
}
function rows(n: number, chapter = 3) {
  return Array.from({ length: n }, (_, i) => ragRow({ id: `q-${i}`, chapter_number: chapter }));
}

function getRequest(qs: string) {
  return new Request(`http://localhost/api/quiz?${qs}`, {
    headers: { Authorization: 'Bearer valid' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuthorized();
  _student = activeStudent();
  _rpcResults = {};
});

describe('GET /api/quiz?action=questions — whole-subject shortfall telemetry (spec §3.6)', () => {
  it('emits grounding.quiz_serving telemetry when chapter is omitted and the RPC returns fewer rows than requested', async () => {
    _rpcResults['select_quiz_questions_rag'] = { data: rows(3), error: null }; // 3 < 5 requested

    const { GET } = await import('@/app/api/quiz/route');
    const res = await GET(getRequest('action=questions&subject=math&grade=9&count=5') as any);

    expect(res.status).toBe(200);
    const body = await res.json();
    // Not a hard reject — the short set is still returned as a success.
    expect(body.success).toBe(true);
    expect(body.questions).toHaveLength(3);

    expect(_logOpsEventImpl).toHaveBeenCalledTimes(1);
    expect(_logOpsEventImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'grounding.quiz_serving',
        severity: 'warning',
        source: 'api/quiz/route.ts',
        message: 'quiz_questions_below_requested_count',
        subjectType: 'quiz_verification_pair',
        subjectId: '9::math',
        context: expect.objectContaining({
          grade: '9',
          subject: 'math',
          chapter_number: null,
          difficulty_mode: 'mixed',
          requested_count: 5,
          returned_count: 3,
        }),
      }),
    );
  });

  it('does NOT emit telemetry when chapter is omitted and the RPC meets the requested count', async () => {
    _rpcResults['select_quiz_questions_rag'] = { data: rows(5), error: null };

    const { GET } = await import('@/app/api/quiz/route');
    const res = await GET(getRequest('action=questions&subject=math&grade=9&count=5') as any);

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(_logOpsEventImpl).not.toHaveBeenCalled();
  });

  it('does NOT double-signal on the pre-existing chapter-scoped 422 path', async () => {
    // Chapter specified: only 2 in-chapter rows for a request of 5 -> the
    // existing insufficient_questions_in_scope 422 contract, unchanged by
    // this fix. The new whole-subject telemetry must not also fire here.
    _rpcResults['select_quiz_questions_rag'] = { data: rows(2, 3), error: null };

    const { GET } = await import('@/app/api/quiz/route');
    const res = await GET(
      getRequest('action=questions&subject=math&grade=9&count=5&chapter=3') as any,
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('insufficient_questions_in_scope');
    expect(body.available).toBe(2);
    expect(body.requested).toBe(5);
    expect(_logOpsEventImpl).not.toHaveBeenCalled();
  });

  it('does NOT emit telemetry when the RPC errors (existing 500 path unchanged)', async () => {
    _rpcResults['select_quiz_questions_rag'] = { data: null, error: { message: 'boom' } };

    const { GET } = await import('@/app/api/quiz/route');
    const res = await GET(getRequest('action=questions&subject=math&grade=9&count=5') as any);

    expect(res.status).toBe(500);
    expect(_logOpsEventImpl).not.toHaveBeenCalled();
  });
});
