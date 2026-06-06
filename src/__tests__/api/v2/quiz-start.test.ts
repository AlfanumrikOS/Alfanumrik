/**
 * Contract tests for POST /api/v2/quiz/start.
 *
 * Pins: auth 401 + quiz.attempt, JWT/body studentId 403 mismatch, body Zod
 * validation (400), start_quiz_session called verbatim, server-shuffled
 * envelope shape (schemaVersion 1, session_id, options_displayed; NO
 * shuffle_map / correct index), RPC null/failure → 503.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@/lib/rbac', () => ({ authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a) }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const STUDENT_B = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

let _studentLookup: { data: { id: string } | null } = { data: { id: STUDENT_A } };
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve(_studentLookup);
      return chain;
    },
  }),
}));

let _rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
const rpcSpy = vi.fn();
vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => {
      rpcSpy(...args);
      return Promise.resolve(_rpcResult);
    },
  }),
}));

function setAuthorized(userId = 'auth-user-1') {
  _authorizeImpl.mockResolvedValue({
    authorized: true, userId, studentId: null, roles: ['student'], permissions: ['quiz.attempt'],
  });
}

function makeRequest(body?: Record<string, unknown>) {
  return new Request('http://localhost/api/v2/quiz/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? { studentId: STUDENT_A, questionIds: [QUESTION_ID] }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;
beforeEach(async () => {
  vi.clearAllMocks();
  setAuthorized();
  _studentLookup = { data: { id: STUDENT_A } };
  _rpcResult = { data: null, error: null };
  POST = (await import('@/app/api/v2/quiz/start/route')).POST;
});

describe('POST /api/v2/quiz/start', () => {
  it('returns 401 when unauthenticated', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false, userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    expect((await POST(makeRequest())).status).toBe(401);
  });

  it('uses the quiz.attempt permission code', async () => {
    _rpcResult = { data: { session_id: SESSION_ID, questions: [] }, error: null };
    await POST(makeRequest());
    expect(_authorizeImpl).toHaveBeenCalledWith(expect.anything(), 'quiz.attempt');
  });

  it('returns 400 on invalid body (empty questionIds)', async () => {
    const res = await POST(makeRequest({ studentId: STUDENT_A, questionIds: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('returns 403 when body studentId mismatches the JWT student', async () => {
    const res = await POST(makeRequest({ studentId: STUDENT_B, questionIds: [QUESTION_ID] }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('STUDENT_ID_MISMATCH');
  });

  it('returns 403 when no student profile is linked', async () => {
    _studentLookup = { data: null };
    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('NO_STUDENT_PROFILE');
  });

  it('calls start_quiz_session verbatim and returns the shuffled envelope', async () => {
    _rpcResult = {
      data: {
        session_id: SESSION_ID,
        questions: [
          {
            question_id: QUESTION_ID,
            question_text: 'Q',
            question_hi: null,
            question_type: 'mcq',
            options_displayed: ['a', 'b', 'c', 'd'],
            explanation: null,
            explanation_hi: null,
            hint: null,
            difficulty: 2,
            bloom_level: 'remember',
            chapter_number: 3,
          },
        ],
      },
      error: null,
    };
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(rpcSpy).toHaveBeenCalledWith('start_quiz_session', {
      p_student_id: STUDENT_A,
      p_question_ids: [QUESTION_ID],
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.session_id).toBe(SESSION_ID);
    expect(body.data.questions[0].options_displayed).toEqual(['a', 'b', 'c', 'd']);
    // shuffle_map / correct index are NEVER returned (P6).
    expect(JSON.stringify(body)).not.toContain('shuffle_map');
    expect(JSON.stringify(body)).not.toContain('correct_answer_index');
  });

  it('returns 503 when start_quiz_session returns null', async () => {
    _rpcResult = { data: null, error: null };
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('START_SESSION_FAILED');
  });

  it('returns 503 when start_quiz_session errors', async () => {
    _rpcResult = { data: null, error: { message: 'rpc down' } };
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
  });
});
