import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

/**
 * Quiz Domain — unit tests
 *
 * Strategy:
 *   - Mock the Supabase client (functions.invoke + rpc + from().select)
 *   - Mock the logger to verify structured logs are emitted on failures
 *   - Test each source chain step: edge fn → RAG RPC → V2 RPC → direct query
 *   - Test submitQuizSession: RPC path, fallback path, both-fail path
 */

// ── Mock logger ───────────────────────────────────────────────────────────────
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ── Mock scoring ──────────────────────────────────────────────────────────────
vi.mock('@/lib/scoring', () => ({
  calculateScorePercent: vi.fn((correct: number, total: number) =>
    total === 0 ? 0 : Math.round((correct / total) * 100)
  ),
  calculateQuizXP: vi.fn((correct: number) => correct * 10),
}));

// ── Supabase mock ─────────────────────────────────────────────────────────────
// Three independently-controllable mock functions
const mockInvoke = vi.fn();
const mockRpc   = vi.fn();
const mockFrom  = vi.fn();

/**
 * Build a thenable chain proxy. The returned object:
 *   - Can be awaited directly (`await chain`)
 *   - Supports `.single()` and `.maybeSingle()` termination
 *   - Chains any other method call back to itself (for `.eq()`, `.select()`, etc.)
 *
 * CRITICAL: we create the Promise ONCE and bind `then`/`catch`/`finally` to it.
 * Accessing `.then` from a Proxy does NOT auto-bind `this` — must do it manually.
 */
function chain(result: unknown) {
  const p = Promise.resolve(result);
  const proxy = new Proxy({} as Record<string, unknown>, {
    get(_, prop: string) {
      if (prop === 'then')     return p.then.bind(p);
      if (prop === 'catch')    return p.catch.bind(p);
      if (prop === 'finally')  return p.finally.bind(p);
      if (prop === 'single')   return () => p;
      if (prop === 'maybeSingle') return () => p;
      return () => proxy;   // all chain methods (eq, select, limit…) return self
    },
  });
  return proxy;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
    rpc: (...args: unknown[]) => {
      const result = mockRpc(...args);
      return result instanceof Promise ? result : Promise.resolve(result);
    },
    from: (...args: unknown[]) => {
      const result = mockFrom(...args);
      return result;
    },
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'q1',
    question_text: overrides.question_text ?? 'What is the powerhouse of the cell?',
    options: overrides.options ?? ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'],
    correct_answer_index: overrides.correct_answer_index ?? 1,
    explanation: overrides.explanation ?? 'Mitochondria produce ATP via oxidative phosphorylation.',
    difficulty: overrides.difficulty ?? 2,
    bloom_level: 'remember',
    chapter_number: 1,
    question_type: 'mcq',
    ...overrides,
  };
}

function makeSubmissionInput(overrides: Record<string, unknown> = {}) {
  return {
    studentId: 'student-uuid-1',
    subject: 'science',
    grade: 8,
    topic: 'Cell Biology',
    chapter: 1,
    responses: [
      { question_id: 'q1', selected_index: 1, is_correct: true,  time_taken_seconds: 12 },
      { question_id: 'q2', selected_index: 0, is_correct: false, time_taken_seconds: 8  },
    ],
    timeTakenSeconds: 300,
    ...overrides,
  };
}

const baseInput = {
  subject: 'science',
  grade: 8,
  count: 5,
  difficultyMode: 'mixed' as const,
  chapterNumber: null,
  questionTypes: ['mcq'] as const,
  studentId: 'student-uuid-1',
  irtTheta: null,
};

// ── Module references (loaded lazily to ensure mocks are in place) ─────────────
let fetchQuizQuestions: (typeof import('@/lib/domains/quiz'))['fetchQuizQuestions'];
let submitQuizSession:  (typeof import('@/lib/domains/quiz'))['submitQuizSession'];
let logger: { warn: Mock; error: Mock; info: Mock };

beforeEach(async () => {
  vi.clearAllMocks();

  // Default: all three sources fail / return nothing
  mockInvoke.mockResolvedValue({ data: null, error: null });
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockFrom.mockReturnValue(chain({ data: [], error: null }));

  const mod = await import('@/lib/domains/quiz');
  fetchQuizQuestions = mod.fetchQuizQuestions;
  submitQuizSession  = mod.submitQuizSession;

  const logMod = await import('@/lib/logger');
  logger = logMod.logger as { warn: Mock; error: Mock; info: Mock };
});

// =============================================================================
// fetchQuizQuestions
// =============================================================================

describe('fetchQuizQuestions', () => {

  // ── Source 1: Edge Function ───────────────────────────────────────────────

  describe('source 1 — edge function', () => {
    it('returns ok source=edge_fn when edge function returns enough questions', async () => {
      const questions = Array.from({ length: 5 }, (_, i) =>
        makeQuestion({ id: `q${i}`, question_text: `What is concept number ${i + 1} in biology today?` })
      );
      mockInvoke.mockResolvedValue({ data: { questions }, error: null });

      const result = await fetchQuizQuestions(baseInput);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.source).toBe('edge_fn');
      expect(result.data.questions).toHaveLength(5);
    });

    it('logs warn and falls through when edge function returns partial questions', async () => {
      const questions = [
        makeQuestion({ id: 'q1', question_text: 'What is the function of chlorophyll in plants?' }),
        makeQuestion({ id: 'q2', question_text: 'What is the role of stomata in leaf biology?' }),
      ];
      mockInvoke.mockResolvedValue({ data: { questions }, error: null });
      // Source 2+3 return nothing; source 4 returns empty array
      mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC offline' } });
      mockFrom.mockReturnValue(chain({ data: [], error: null }));

      const result = await fetchQuizQuestions(baseInput);
      expect(logger.warn).toHaveBeenCalledWith(
        'quiz_domain_edge_fn_partial',
        expect.objectContaining({ requested: 5, received: 2 })
      );
      expect(result.ok).toBe(true); // falls through to direct_query
    });

    it('logs warn and falls through when edge function returns error', async () => {
      mockInvoke.mockResolvedValue({ data: null, error: { message: 'Edge function timeout' } });
      mockFrom.mockReturnValue(chain({ data: [], error: null }));

      await fetchQuizQuestions(baseInput);
      expect(logger.warn).toHaveBeenCalledWith(
        'quiz_domain_edge_fn_failed',
        expect.objectContaining({ error: 'Edge function timeout' })
      );
    });

    it('logs exception and falls through when edge function throws', async () => {
      mockInvoke.mockRejectedValue(new Error('Network failure'));
      mockFrom.mockReturnValue(chain({ data: [], error: null }));

      await fetchQuizQuestions(baseInput);
      expect(logger.warn).toHaveBeenCalledWith(
        'quiz_domain_edge_fn_exception',
        expect.objectContaining({ error: 'Network failure' })
      );
    });
  });

  // ── Source 2: RAG RPC ────────────────────────────────────────────────────

  describe('source 2 — RAG RPC', () => {
    beforeEach(() => {
      // Edge function fails
      mockInvoke.mockResolvedValue({ data: null, error: { message: 'Edge fn down' } });
    });

    it('returns ok source=rpc_rag when RAG RPC returns valid questions', async () => {
      const questions = Array.from({ length: 3 }, (_, i) =>
        makeQuestion({ id: `rq${i}`, question_text: `Describe the role of enzyme ${i + 1} in the digestive process.` })
      );
      // First rpc call = RAG RPC
      mockRpc.mockResolvedValueOnce({ data: questions, error: null });

      const result = await fetchQuizQuestions(baseInput);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.source).toBe('rpc_rag');
    });

    it('logs warn and falls through when RAG RPC errors', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'RAG RPC error' } });
      mockFrom.mockReturnValue(chain({ data: [], error: null }));

      await fetchQuizQuestions(baseInput);
      expect(logger.warn).toHaveBeenCalledWith(
        'quiz_domain_rpc_rag_failed',
        expect.objectContaining({ error: 'RAG RPC error' })
      );
    });
  });

  // ── Source 4: Direct query (last resort) ─────────────────────────────────

  describe('source 4 — direct query (all sources failed)', () => {
    beforeEach(() => {
      mockInvoke.mockResolvedValue({ data: null, error: { message: 'Edge fn down' } });
      mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC unavailable' } });
    });

    it('emits quiz_domain_fallback_direct_query warning', async () => {
      // First from() call = user_question_history (dedup); second = question_bank
      mockFrom
        .mockReturnValueOnce(chain({ data: [], error: null }))     // history
        .mockReturnValue(chain({ data: [], error: null }));          // bank

      await fetchQuizQuestions(baseInput);
      expect(logger.warn).toHaveBeenCalledWith(
        'quiz_domain_fallback_direct_query',
        expect.objectContaining({ allSourcesFailed: true, studentId: 'student-uuid-1' })
      );
    });

    it('returns fail with DB_ERROR when question_bank query fails', async () => {
      mockFrom
        .mockReturnValueOnce(chain({ data: [], error: null }))     // history (ok)
        .mockReturnValue(chain({ data: null, error: { message: 'DB connection refused' } }));

      const result = await fetchQuizQuestions(baseInput);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected fail');
      expect(result.code).toBe('DB_ERROR');
      expect(result.error).toContain('question_bank query failed');
    });

    it('returns ok source=direct_query with empty pool when no questions in bank', async () => {
      mockFrom
        .mockReturnValueOnce(chain({ data: [], error: null }))   // history
        .mockReturnValue(chain({ data: [], error: null }));        // bank (empty)

      const result = await fetchQuizQuestions(baseInput);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.source).toBe('direct_query');
      expect(result.data.questions).toHaveLength(0);
    });
  });

  // ── validateQuestions ─────────────────────────────────────────────────────

  describe('question validation — filtering rules', () => {
    it('rejects questions with placeholder text {{}}', async () => {
      const bad = makeQuestion({ id: 'bad', question_text: 'What is {{variable}} in this equation calculation?' });
      // 4 unique good questions + 1 bad → only 4 pass → partial (< 5) → falls through
      const goods = Array.from({ length: 4 }, (_, i) =>
        makeQuestion({ id: `g${i}`, question_text: `What is the role of process number ${i + 1} in aerobic respiration and ATP production?` })
      );
      mockInvoke.mockResolvedValue({ data: { questions: [bad, ...goods] }, error: null });
      mockFrom.mockReturnValue(chain({ data: [], error: null }));

      await fetchQuizQuestions(baseInput);
      // Edge fn had partial result (4 valid < 5 requested)
      expect(logger.warn).toHaveBeenCalledWith(
        'quiz_domain_edge_fn_partial',
        expect.objectContaining({ received: 4 })
      );
    });

    it('rejects duplicate questions (same text)', async () => {
      const q = makeQuestion({ question_text: 'What is the chemical formula for water molecule H2O?' });
      // 5 copies → dedup → 1 unique → partial → falls through
      mockInvoke.mockResolvedValue({
        data: { questions: Array.from({ length: 5 }, (_, i) => ({ ...q, id: `q${i}` })) },
        error: null,
      });
      mockFrom.mockReturnValue(chain({ data: [], error: null }));

      await fetchQuizQuestions(baseInput);
      expect(logger.warn).toHaveBeenCalledWith(
        'quiz_domain_edge_fn_partial',
        expect.objectContaining({ received: 1 }) // deduped to 1
      );
    });

    it('rejects questions where explanation is too short (< 20 chars)', async () => {
      const badQ = makeQuestion({
        question_text: 'What is the function of the mitochondria in aerobic respiration?',
        explanation: 'Too short.',  // < 20 chars
      });
      mockInvoke.mockResolvedValue({
        data: { questions: Array.from({ length: 5 }, (_, i) => ({ ...badQ, id: `q${i}` })) },
        error: null,
      });
      mockFrom.mockReturnValue(chain({ data: [], error: null }));

      await fetchQuizQuestions(baseInput);
      // All 5 questions filtered → 0 valid → partial → falls through
      expect(logger.warn).toHaveBeenCalledWith(
        'quiz_domain_edge_fn_partial',
        expect.objectContaining({ received: 0 })
      );
    });
  });
});

// =============================================================================
// submitQuizSession
// =============================================================================

describe('submitQuizSession', () => {

  // ── Path 1: RPC succeeds ─────────────────────────────────────────────────

  describe('RPC path (authoritative)', () => {
    it('returns ok with RPC data when submit_quiz_results succeeds', async () => {
      const rpcData = { session_id: 'sess-uuid-1', xp_earned: 40, score_percent: 80, correct_answers: 4, total_questions: 5 };
      mockRpc.mockResolvedValueOnce({ data: rpcData, error: null });

      const result = await submitQuizSession(makeSubmissionInput());
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.session_id).toBe('sess-uuid-1');
      expect(result.data.xp_earned).toBe(40);
    });

    it('does NOT call from() (fallback path) when RPC succeeds', async () => {
      mockRpc.mockResolvedValueOnce({ data: { session_id: 'x', xp_earned: 10 }, error: null });

      await submitQuizSession(makeSubmissionInput());
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('passes studentId from input to RPC — never generates its own', async () => {
      mockRpc.mockResolvedValueOnce({ data: { session_id: 'x', xp_earned: 10 }, error: null });
      await submitQuizSession(makeSubmissionInput({ studentId: 'specific-student-id' }));

      const call = mockRpc.mock.calls[0];
      expect(call[1]).toMatchObject({ p_student_id: 'specific-student-id' });
    });
  });

  // ── Path 2: RPC fails → fallback insert ─────────────────────────────────

  describe('fallback path (manual insert)', () => {
    beforeEach(() => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'RPC submit failed' } });
    });

    it('logs error when RPC fails', async () => {
      mockFrom.mockReturnValue(chain({ data: { id: 'sess-fallback-1' }, error: null }));
      await submitQuizSession(makeSubmissionInput());

      expect(logger.error).toHaveBeenCalledWith(
        'quiz_domain_submit_rpc_failed',
        expect.objectContaining({ studentId: 'student-uuid-1' })
      );
    });

    it('returns fail DB_ERROR when both RPC and session insert fail', async () => {
      mockFrom.mockReturnValue(chain({ data: null, error: { message: 'Connection refused' } }));

      const result = await submitQuizSession(makeSubmissionInput());
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected fail');
      expect(result.code).toBe('DB_ERROR');
      expect(result.error).toContain('Quiz submission failed');
    });

    it('logs session insert failure', async () => {
      mockFrom.mockReturnValue(chain({ data: null, error: { message: 'insert error' } }));
      await submitQuizSession(makeSubmissionInput());

      expect(logger.error).toHaveBeenCalledWith(
        'quiz_domain_submit_session_insert_failed',
        expect.objectContaining({ studentId: 'student-uuid-1' })
      );
    });
  });

  // ── Dual failure contract ────────────────────────────────────────────────

  describe('dual failure contract', () => {
    it('returns fail() — never throws — when RPC throws and insert fails', async () => {
      mockRpc.mockRejectedValueOnce(new Error('network timeout'));
      mockFrom.mockReturnValue(chain({ data: null, error: { message: 'also failed' } }));

      const result = await submitQuizSession(makeSubmissionInput());
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected fail');
      expect(result.code).toBe('DB_ERROR');
    });

    it('logs exception on RPC throw', async () => {
      mockRpc.mockRejectedValueOnce(new Error('Connection pool exhausted'));
      mockFrom.mockReturnValue(chain({ data: null, error: { message: 'fallback also down' } }));

      await submitQuizSession(makeSubmissionInput());
      expect(logger.error).toHaveBeenCalledWith(
        'quiz_domain_submit_rpc_exception',
        expect.objectContaining({ studentId: 'student-uuid-1' })
      );
    });
  });

  // ── XP safety ────────────────────────────────────────────────────────────

  describe('XP safety — no client-side XP upsert', () => {
    it('does not call from() (anon XP upsert removed) when RPC succeeds', async () => {
      mockRpc.mockResolvedValueOnce({ data: { session_id: 'x', xp_earned: 100 }, error: null });
      await submitQuizSession(makeSubmissionInput());
      expect(mockFrom).not.toHaveBeenCalled();
    });

    it('returns RPC xp_earned, not local calculation', async () => {
      mockRpc.mockResolvedValueOnce({ data: { session_id: 'x', xp_earned: 50 }, error: null });
      const result = await submitQuizSession(makeSubmissionInput());
      if (!result.ok) throw new Error('expected ok');
      expect(result.data.xp_earned).toBe(50);
    });
  });

  // ── Input edge cases ─────────────────────────────────────────────────────

  describe('input edge cases', () => {
    it('handles empty responses array without throwing', async () => {
      mockRpc.mockResolvedValueOnce({ data: { session_id: 'x', xp_earned: 0 }, error: null });
      const result = await submitQuizSession(makeSubmissionInput({ responses: [] }));
      expect(result.ok).toBe(true);
    });

    it('handles zero timeTakenSeconds without throwing', async () => {
      mockRpc.mockResolvedValueOnce({ data: { session_id: 'x', xp_earned: 0 }, error: null });
      const result = await submitQuizSession(makeSubmissionInput({ timeTakenSeconds: 0 }));
      expect(result.ok).toBe(true);
    });
  });
});
