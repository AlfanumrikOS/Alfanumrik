/**
 * Contract tests for GET /api/v2/quiz/questions.
 *
 * Pins: auth 401 + quiz.attempt(requireStudentId), param validation (400),
 * grade-mismatch (403), the questions RPC (select_quiz_questions_rag) reuse,
 * insufficient_questions_in_scope (422), envelope shape (schemaVersion 1,
 * questions[]), and P6 — correct_answer_index is NEVER returned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Subject governance always allows in these tests.
vi.mock('@/lib/subjects', () => ({
  validateSubjectWrite: vi.fn().mockResolvedValue({ ok: true }),
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';

let _student: { data: { id: string; grade: string } | null; error: unknown } = {
  data: { id: STUDENT_A, grade: '9' },
  error: null,
};
let _rpcResults: Record<string, { data: unknown; error: unknown }> = {};

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.single = () => Promise.resolve(_student);
      chain.maybeSingle = () => Promise.resolve(_student);
      return chain;
    },
    rpc: (name: string) => Promise.resolve(_rpcResults[name] ?? { data: [], error: null }),
  }),
}));

function setAuthorized() {
  _authorizeImpl.mockResolvedValue({
    authorized: true, userId: 'auth-user-1', studentId: STUDENT_A,
    roles: ['student'], permissions: ['quiz.attempt'],
  });
}

function url(params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  return new Request(`http://localhost/api/v2/quiz/questions?${q}`, { method: 'GET' });
}

function ragRow(extra: Record<string, unknown> = {}) {
  return {
    question_id: QUESTION_ID,
    question_text: 'What is 2+2?',
    question_hi: null,
    question_type: 'mcq',
    options: ['3', '4', '5', '6'],
    // The RPC's served shape may include this; the route MUST strip it (P6).
    correct_answer_index: 1,
    explanation: '2+2=4',
    explanation_hi: null,
    hint: null,
    difficulty: 2,
    bloom_level: 'remember',
    chapter_number: 3,
    ...extra,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let GET: any;
beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _student = { data: { id: STUDENT_A, grade: '9' }, error: null };
  _rpcResults = {};
  GET = (await import('@/app/api/v2/quiz/questions/route')).GET;
});

describe('GET /api/v2/quiz/questions', () => {
  it('returns 401 when unauthenticated', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false, userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    expect((await GET(url({ subject: 'math', grade: '9', count: '5' }))).status).toBe(401);
  });

  it('uses quiz.attempt with requireStudentId', async () => {
    _rpcResults['select_quiz_questions_rag'] = { data: [ragRow()], error: null };
    await GET(url({ subject: 'math', grade: '9', count: '5' }));
    expect(_authorizeImpl).toHaveBeenCalledWith(
      expect.anything(), 'quiz.attempt', expect.objectContaining({ requireStudentId: true }),
    );
  });

  it('returns 400 when subject/grade missing', async () => {
    const res = await GET(url({ count: '5' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid count', async () => {
    const res = await GET(url({ subject: 'math', grade: '9', count: '7' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when requested grade mismatches the profile grade', async () => {
    _student = { data: { id: STUDENT_A, grade: '10' }, error: null };
    const res = await GET(url({ subject: 'math', grade: '9', count: '5' }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('GRADE_MISMATCH');
  });

  it('returns questions WITHOUT correct_answer_index (P6)', async () => {
    _rpcResults['select_quiz_questions_rag'] = { data: [ragRow()], error: null };
    const res = await GET(url({ subject: 'math', grade: '9', count: '5' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.questions).toHaveLength(1);
    expect(body.data.questions[0].question_id).toBe(QUESTION_ID);
    expect(body.data.questions[0].options).toEqual(['3', '4', '5', '6']);
    // P6: the answer index must never reach the client.
    expect(body.data.questions[0]).not.toHaveProperty('correct_answer_index');
    expect(JSON.stringify(body)).not.toContain('correct_answer_index');
  });

  it('returns 422 insufficient_questions_in_scope when a chapter is set and too few rows', async () => {
    // Scope validates OK, but the RPC returns fewer in-chapter rows than requested.
    _rpcResults['validate_academic_scope'] = { data: { ok: true }, error: null };
    _rpcResults['select_quiz_questions_rag'] = { data: [ragRow({ chapter_number: 3 })], error: null };
    const res = await GET(url({ subject: 'math', grade: '9', count: '5', chapter: '3' }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('INSUFFICIENT_QUESTIONS_IN_SCOPE');
  });

  it('returns 422 invalid_academic_scope when scope RPC rejects the chapter', async () => {
    _rpcResults['validate_academic_scope'] = { data: { ok: false, reason: 'chapter_not_in_subject' }, error: null };
    const res = await GET(url({ subject: 'math', grade: '9', count: '5', chapter: '99' }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('INVALID_ACADEMIC_SCOPE');
  });
});
