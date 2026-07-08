/**
 * Wiring tests for getQuizQuestionsV2 + mergeAdaptiveFront (src/lib/supabase.ts)
 * and the assembleQuiz top-up contract (src/lib/quiz-assembler.ts).
 *
 * Phase 2 — the adaptive live selector is a CANDIDATE PROVIDER layered IN FRONT
 * of the existing fallback ladder, never a hard filter. These tests pin the
 * three BLOCKING assessment assertions that live at the wiring layer:
 *
 *   3. (BLOCKING) Count always met — assembleQuiz returns EXACTLY count for
 *      modes × counts; a selector-partial result (k < count) is topped up by
 *      the ladder to exactly count with no duplicate IDs.
 *   4. (BLOCKING) Cold-start — student with no concept_mastery → selector
 *      returns [] → the final quiz length == count (ladder served), valid P6.
 *   5. (BLOCKING) Flag-OFF byte-identical — with ff_adaptive_live_selection_v1
 *      OFF, getQuizQuestionsV2 output AND call sequence are identical to the
 *      pre-Phase-2 baseline, and NO concept_mastery selector query is issued.
 *
 * Strategy: mock the supabase singleton (controls resolveStudentId, irt_theta,
 * feature_flags, the quiz-generator Edge Function, and the RPC ladder) and mock
 * selectAdaptiveQuestions so we can (a) assert whether it was called at all and
 * (b) inject a known candidate set when the flag is ON. assembleQuiz is tested
 * against a mocked getQuizQuestionsV2 so the top-up ladder is exercised in
 * isolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock: structured logger (no console noise, no PII path) ──────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Mock: the adaptive selector (spy on calls + inject candidates) ───────────
const selectAdaptiveQuestionsMock = vi.fn();
vi.mock('@alfanumrik/lib/adaptive/select-adaptive-questions', () => ({
  selectAdaptiveQuestions: (...args: unknown[]) => selectAdaptiveQuestionsMock(...args),
}));

// ── Mock: isFeatureEnabled (fisher_info activation gate reads) ───────────────
// getQuizQuestionsV2 evaluates ff_irt_question_selection per-student through
// isFeatureEnabled (rollout-aware) before handing allowFisherInfo to the
// selector. Partial mock: everything else in the feature-flags barrel (flag-name
// registries etc.) stays real.
const isFeatureEnabledMock = vi.fn();
vi.mock('@alfanumrik/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/feature-flags')>();
  return {
    ...actual,
    isFeatureEnabled: (...args: unknown[]) => isFeatureEnabledMock(...args),
  };
});

// ── Mock: supabase singleton ─────────────────────────────────────────────────
// A configurable fake covering every surface getQuizQuestionsV2 touches:
//   auth.getUser()                              → resolveStudentId
//   from('students')...single()                 → resolveStudentId
//   from('student_learning_profiles')...maybeSingle() → irt_theta
//   from('feature_flags').select()              → getFeatureFlags (awaitable)
//   functions.invoke('quiz-generator')          → primary edge path
//   rpc('select_quiz_questions_rag' | '..._v2')  → fallback ladder
const fromCalls: string[] = [];
const rpcCalls: string[] = [];
const invokeCalls: Array<{ name: string; body: unknown }> = [];

const state: {
  flagEnabled: boolean;
  irtTheta: number | null;
  edgeQuestions: any[] | null;
  edgeError: boolean;
  ragQuestions: any[] | null;
} = {
  flagEnabled: false,
  irtTheta: 0.5,
  edgeQuestions: null,
  edgeError: false,
  ragQuestions: null,
};

function questionRows(n: number, prefix = 'edge'): any[] {
  return Array.from({ length: n }).map((_, i) => ({
    id: `${prefix}-${i}`,
    question_text: `Edge question ${prefix} ${i} with enough length to pass P6.`,
    options: ['A', 'B', 'C', 'D'],
    correct_answer_index: 1,
    explanation: 'A sufficiently long explanation to satisfy the P6 gate here.',
    bloom_level: 'understand',
    chapter_number: 5,
    subject: 'math',
    grade: '7',
  }));
}

function makeFromBuilder(table: string) {
  fromCalls.push(table);
  const builder: any = {};
  const ret = () => builder;
  builder.select = ret;
  builder.eq = ret;
  builder.lt = ret;
  builder.in = ret;
  builder.not = ret;
  builder.order = ret;
  builder.limit = ret;

  builder.single = () => {
    if (table === 'students') return Promise.resolve({ data: { id: 'student-1' }, error: null });
    return Promise.resolve({ data: null, error: null });
  };
  builder.maybeSingle = () => {
    if (table === 'student_learning_profiles')
      return Promise.resolve({ data: { irt_theta: state.irtTheta }, error: null });
    return Promise.resolve({ data: null, error: null });
  };

  // feature_flags is awaited directly off the select() chain (no terminal).
  if (table === 'feature_flags') {
    const flagRows = [
      {
        flag_name: 'ff_adaptive_live_selection_v1',
        is_enabled: state.flagEnabled,
        target_roles: null,
        target_environments: null,
        target_institutions: null,
      },
    ];
    builder.select = () => Promise.resolve({ data: flagRows, error: null });
  }

  return builder;
}

vi.mock('@alfanumrik/lib/supabase-client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'auth-1' } }, error: null }) },
    from: (table: string) => makeFromBuilder(table),
    rpc: (name: string) => {
      rpcCalls.push(name);
      if (name === 'select_quiz_questions_rag') {
        return Promise.resolve({ data: state.ragQuestions, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    functions: {
      invoke: (name: string, opts: { body: unknown }) => {
        invokeCalls.push({ name, body: opts?.body });
        if (state.edgeError) return Promise.resolve({ data: null, error: { message: 'edge down' } });
        return Promise.resolve({
          data: state.edgeQuestions ? { questions: state.edgeQuestions } : { questions: [] },
          error: null,
        });
      },
    },
  },
  supabaseUrl: 'http://localhost',
  supabaseAnonKey: 'anon',
}));

// Import AFTER mocks are registered.
import { getQuizQuestionsV2 } from '@alfanumrik/lib/supabase';

function resetState() {
  fromCalls.length = 0;
  rpcCalls.length = 0;
  invokeCalls.length = 0;
  state.flagEnabled = false;
  state.irtTheta = 0.5;
  state.edgeQuestions = null;
  state.edgeError = false;
  state.ragQuestions = null;
  selectAdaptiveQuestionsMock.mockReset();
  selectAdaptiveQuestionsMock.mockResolvedValue({ questions: [], weakTopicsTargeted: 0 });
  isFeatureEnabledMock.mockReset();
  isFeatureEnabledMock.mockResolvedValue(false); // ff_irt_question_selection default OFF (fail-closed)
}

beforeEach(resetState);

// ─────────────────────────────────────────────────────────────────────────────
// Assertion 5 (BLOCKING): Flag-OFF byte-identical + NO selector query
// ─────────────────────────────────────────────────────────────────────────────

describe('getQuizQuestionsV2 — assertion 5 (BLOCKING) flag-OFF byte-identical', () => {
  it('flag OFF: selector is NEVER invoked and edge output passes through unchanged', async () => {
    state.flagEnabled = false;
    state.edgeQuestions = questionRows(10, 'edge');

    const out = await getQuizQuestionsV2('math', '7', 10, 'mixed', null, ['mcq']);

    // Selector never called → no concept_mastery query path entered at all.
    expect(selectAdaptiveQuestionsMock).not.toHaveBeenCalled();
    // Output is byte-identical to the raw edge questions (same ids, same order).
    expect(out.map((q: any) => q.id)).toEqual(state.edgeQuestions.map((q: any) => q.id));
    expect(out).toHaveLength(10);
  });

  it('flag OFF: the edge body is exactly the pre-Phase-2 contract', async () => {
    state.flagEnabled = false;
    state.irtTheta = 0.5;
    state.edgeQuestions = questionRows(10, 'edge');

    await getQuizQuestionsV2('math', '7', 10, 'mixed', null, ['mcq']);

    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0].name).toBe('quiz-generator');
    expect(invokeCalls[0].body).toMatchObject({
      student_id: 'student-1',
      subject: 'math',
      grade: '7',
      count: 10,
      chapter_number: null,
      ability_estimate: 0.5,
    });
  });

  it('chapter-scoped request never invokes the selector even when flag is ON', async () => {
    state.flagEnabled = true;
    state.edgeQuestions = questionRows(10, 'edge');

    await getQuizQuestionsV2('math', '7', 10, 'mixed', 5 /* chapter */, ['mcq']);

    // Phase-2 restricts the provider to chapter-less requests.
    expect(selectAdaptiveQuestionsMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Assertion 4 (BLOCKING): Cold-start → selector [] → full quiz from ladder
// ─────────────────────────────────────────────────────────────────────────────

describe('getQuizQuestionsV2 — assertion 4 (BLOCKING) cold-start', () => {
  it('flag ON but selector returns [] → output identical to ladder, full count', async () => {
    state.flagEnabled = true;
    state.edgeQuestions = questionRows(10, 'edge');
    selectAdaptiveQuestionsMock.mockResolvedValue({ questions: [], weakTopicsTargeted: 0 });

    const out = await getQuizQuestionsV2('math', '7', 10, 'mixed', null, ['mcq']);

    // Selector WAS consulted (flag on, chapterless) but returned cold-start [].
    expect(selectAdaptiveQuestionsMock).toHaveBeenCalledTimes(1);
    // mergeAdaptiveFront([]) → ladder unchanged: byte-identical to flag-OFF.
    expect(out.map((q: any) => q.id)).toEqual(state.edgeQuestions.map((q: any) => q.id));
    expect(out).toHaveLength(10);
  });

  it('selector returns weakTopicsTargeted=0 → candidates ignored (treated as cold-start)', async () => {
    state.flagEnabled = true;
    state.edgeQuestions = questionRows(10, 'edge');
    // Defensive: even if questions present but no weak topics, wiring drops them.
    selectAdaptiveQuestionsMock.mockResolvedValue({
      questions: [{ id: 'stray', question_text: 'x', options: ['A', 'B', 'C', 'D'], correct_answer_index: 0 }],
      weakTopicsTargeted: 0,
    });

    const out = await getQuizQuestionsV2('math', '7', 10, 'mixed', null, ['mcq']);
    expect(out.some((q: any) => q.id === 'stray')).toBe(false);
    expect(out.map((q: any) => q.id)).toEqual(state.edgeQuestions.map((q: any) => q.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fisher_info ACTIVATION gate — ff_irt_question_selection wiring (OEF ramp)
//
// The repaired IRT calibrator will begin populating irt_a/irt_b/calibration_n
// on live items. IRT-scored serving must require a deliberate flag ramp:
// getQuizQuestionsV2 evaluates ff_irt_question_selection per-student (rollout-
// aware, deterministic by studentId) and passes allowFisherInfo to the
// selector. Fail-closed on every failure path.
// ─────────────────────────────────────────────────────────────────────────────

describe('getQuizQuestionsV2 — fisher_info activation gate (ff_irt_question_selection)', () => {
  it('IRT flag OFF: selector receives allowFisherInfo: false (calibrated items keep proxy ranking)', async () => {
    state.flagEnabled = true; // adaptive live selection ON for the cohort
    state.edgeQuestions = questionRows(10, 'edge');
    isFeatureEnabledMock.mockResolvedValue(false);

    await getQuizQuestionsV2('math', '7', 10, 'mixed', null, ['mcq']);

    expect(selectAdaptiveQuestionsMock).toHaveBeenCalledTimes(1);
    expect(selectAdaptiveQuestionsMock.mock.calls[0][1]).toMatchObject({
      allowFisherInfo: false,
    });
  });

  it('IRT flag ON for this student: allowFisherInfo: true, evaluated per-student for rollout determinism', async () => {
    state.flagEnabled = true;
    state.edgeQuestions = questionRows(10, 'edge');
    isFeatureEnabledMock.mockResolvedValue(true);

    await getQuizQuestionsV2('math', '7', 10, 'mixed', null, ['mcq']);

    expect(selectAdaptiveQuestionsMock).toHaveBeenCalledTimes(1);
    expect(selectAdaptiveQuestionsMock.mock.calls[0][1]).toMatchObject({
      allowFisherInfo: true,
    });
    // Rollout semantics: the flag MUST be evaluated with the student's id so
    // percentage ramps hash deterministically per student (and with the
    // student role for role scoping).
    expect(isFeatureEnabledMock).toHaveBeenCalledWith(
      'ff_irt_question_selection',
      expect.objectContaining({ userId: 'student-1', role: 'student' }),
    );
  });

  it('flag read FAILURE: fail-closed to allowFisherInfo: false — selection still runs, quiz unharmed', async () => {
    state.flagEnabled = true;
    state.edgeQuestions = questionRows(10, 'edge');
    isFeatureEnabledMock.mockRejectedValue(new Error('flags service down'));

    const out = await getQuizQuestionsV2('math', '7', 10, 'mixed', null, ['mcq']);

    // The adaptive provider is NOT skipped — only the fisher gate closes.
    expect(selectAdaptiveQuestionsMock).toHaveBeenCalledTimes(1);
    expect(selectAdaptiveQuestionsMock.mock.calls[0][1]).toMatchObject({
      allowFisherInfo: false,
    });
    expect(out).toHaveLength(10);
  });

  it('adaptive live-selection flag OFF: the IRT flag is never even evaluated', async () => {
    state.flagEnabled = false;
    state.edgeQuestions = questionRows(10, 'edge');

    await getQuizQuestionsV2('math', '7', 10, 'mixed', null, ['mcq']);

    expect(selectAdaptiveQuestionsMock).not.toHaveBeenCalled();
    expect(isFeatureEnabledMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mergeAdaptiveFront behaviour (assertion 3 substrate + dedupe)
// ─────────────────────────────────────────────────────────────────────────────

describe('getQuizQuestionsV2 — mergeAdaptiveFront prepends + dedupes', () => {
  it('flag ON with candidates: adaptive rows lead, ladder fills, deduped by id', async () => {
    state.flagEnabled = true;
    // Edge returns 10 incl. one whose id collides with an adaptive candidate.
    state.edgeQuestions = questionRows(10, 'edge');
    const adaptive = [
      { id: 'adapt-1', question_text: 'Adaptive weak-topic Q1 long enough.', options: ['A', 'B', 'C', 'D'], correct_answer_index: 0, chapter_number: 5, subject: 'math', grade: '7' },
      { id: 'edge-0', question_text: 'Duplicate of edge-0 by id.', options: ['A', 'B', 'C', 'D'], correct_answer_index: 0, chapter_number: 5, subject: 'math', grade: '7' },
    ];
    selectAdaptiveQuestionsMock.mockResolvedValue({ questions: adaptive, weakTopicsTargeted: 1 });

    const out = await getQuizQuestionsV2('math', '7', 10, 'mixed', null, ['mcq']);

    // adapt-1 leads; edge-0 appears exactly once (id dedupe); order preserved.
    expect(out[0].id).toBe('adapt-1');
    const ids = out.map((q: any) => q.id);
    expect(ids.filter((id: string) => id === 'edge-0')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate IDs at all
  });

  it('dedupes by question_text for id-less rows (id-then-text key)', async () => {
    state.flagEnabled = true;
    const sharedText = 'A shared id-less question text long enough for P6 here.';
    // Both the ladder row and an adaptive candidate are id-less and share text.
    // mergeAdaptiveFront computes one key per row (id if present, else text), so
    // two id-less same-text rows collapse to one.
    state.edgeQuestions = [
      { question_text: sharedText, options: ['A', 'B', 'C', 'D'], correct_answer_index: 0, chapter_number: 5, subject: 'math', grade: '7' },
      ...questionRows(9, 'edge'),
    ];
    const adaptive = [
      { question_text: sharedText, options: ['A', 'B', 'C', 'D'], correct_answer_index: 0, chapter_number: 5, subject: 'math', grade: '7' },
    ];
    selectAdaptiveQuestionsMock.mockResolvedValue({ questions: adaptive, weakTopicsTargeted: 1 });

    const out = await getQuizQuestionsV2('math', '7', 10, 'mixed', null, ['mcq']);
    const textMatches = out.filter(
      (q: any) => q.question_text.trim().toLowerCase().slice(0, 80) === sharedText.trim().toLowerCase().slice(0, 80),
    );
    expect(textMatches).toHaveLength(1); // text-key dedupe collapsed the id-less dup
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Assertion 3 (BLOCKING): Count always met — assembleQuiz tops up via ladder
// ─────────────────────────────────────────────────────────────────────────────

describe('assembleQuiz — assertion 3 (BLOCKING) count always met', () => {
  // assembleQuiz pulls from getQuizQuestionsV2; mock it directly so we exercise
  // the top-up ladder (Rung 0 → Rung 1 → Rung 2) and the exact-count trim.
  const getQuizQuestionsV2Mock = vi.fn();

  beforeEach(() => {
    getQuizQuestionsV2Mock.mockReset();
    vi.doMock('@alfanumrik/lib/supabase', () => ({
      getQuizQuestionsV2: (...a: unknown[]) => getQuizQuestionsV2Mock(...a),
    }));
  });

  function validRows(n: number, prefix: string): any[] {
    return Array.from({ length: n }).map((_, i) => ({
      id: `${prefix}-${i}`,
      question_text: `Assemble ${prefix} question ${i} long enough for the P6 gate.`,
      question_type: 'mcq',
      options: ['Opt A', 'Opt B', 'Opt C', 'Opt D'],
      correct_answer_index: i % 4,
      explanation: 'An explanation long enough to satisfy the P6 quality gate.',
      bloom_level: 'understand',
      chapter_number: null,
      subject: 'math',
      grade: '7',
    }));
  }

  const MODES = ['easy', 'medium', 'hard', 'mixed', 'progressive'];
  const COUNTS = [5, 10, 30];

  for (const mode of MODES) {
    for (const count of COUNTS) {
      it(`mode=${mode} count=${count}: full pool → exactly ${count}`, async () => {
        const { assembleQuiz } = await import('@alfanumrik/lib/quiz-assembler');
        // Rung 0 alone returns the full count.
        getQuizQuestionsV2Mock.mockResolvedValue(validRows(count, 'r0'));

        const res = await assembleQuiz({
          subject: 'math',
          grade: '7',
          requestedCount: count,
          difficulty: mode,
          chapter: null,
          questionTypes: ['mcq'],
          mode: 'practice',
        });

        expect(res.returnedCount).toBe(count);
        expect(res.questions).toHaveLength(count);
        expect(res.success).toBe(true);
        const ids = res.questions.map((q: any) => q.id);
        expect(new Set(ids).size).toBe(ids.length); // no dup IDs
      });
    }
  }

  it('selector-partial (k < count): ladder tops up to exactly count, no dup IDs', async () => {
    const { assembleQuiz } = await import('@alfanumrik/lib/quiz-assembler');
    const count = 10;
    // Rung 0 returns only 4 (k < count). Rungs 1/2 supply the rest, with one
    // id-colliding row that must be deduped, not double-counted.
    getQuizQuestionsV2Mock
      .mockResolvedValueOnce(validRows(4, 'r0')) // Rung 0: partial
      .mockResolvedValueOnce([...validRows(8, 'r1'), { ...validRows(1, 'r0')[0] }]) // Rung 1: top-up + collision
      .mockResolvedValueOnce(validRows(10, 'r2')); // Rung 2 (if still short)

    const res = await assembleQuiz({
      subject: 'math',
      grade: '7',
      requestedCount: count,
      difficulty: 'mixed',
      chapter: null,
      questionTypes: ['mcq'],
      mode: 'practice',
    });

    expect(res.returnedCount).toBe(count);
    expect(res.questions).toHaveLength(count);
    const ids = res.questions.map((q: any) => q.id);
    expect(new Set(ids).size).toBe(ids.length); // top-up never introduces a dup
  });

  it('cold-start path: ladder-only pool still fills the exact count (P6 valid)', async () => {
    const { assembleQuiz } = await import('@alfanumrik/lib/quiz-assembler');
    const count = 10;
    // No adaptive lead (cold-start); ladder alone serves the full count.
    getQuizQuestionsV2Mock.mockResolvedValue(validRows(count, 'ladder'));

    const res = await assembleQuiz({
      subject: 'math',
      grade: '7',
      requestedCount: count,
      difficulty: 'mixed',
      chapter: null,
      questionTypes: ['mcq'],
      mode: 'practice',
    });

    expect(res.questions).toHaveLength(count);
    expect(res.success).toBe(true);
    // Every served row passes the P6 shape the assembler enforces.
    for (const q of res.questions) {
      expect(q.options).toHaveLength(4);
      expect(q.correct_answer_index).toBeGreaterThanOrEqual(0);
      expect(q.correct_answer_index).toBeLessThanOrEqual(3);
      expect(q.question_text.length).toBeGreaterThanOrEqual(15);
      expect(q.explanation.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('over-fetch is trimmed to exactly count', async () => {
    const { assembleQuiz } = await import('@alfanumrik/lib/quiz-assembler');
    const count = 5;
    getQuizQuestionsV2Mock.mockResolvedValue(validRows(20, 'over')); // Rung 0 over-fetch

    const res = await assembleQuiz({
      subject: 'math',
      grade: '7',
      requestedCount: count,
      difficulty: 'mixed',
      chapter: null,
      questionTypes: ['mcq'],
      mode: 'practice',
    });

    expect(res.questions).toHaveLength(count);
    expect(res.returnedCount).toBe(count);
  });
});
