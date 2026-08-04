/**
 * Foxy North-Star Phase 0 — quiz page wiring (F2 / F4 / F8).
 *
 * Renders the REAL quiz page (apps/host/src/app/(student)/quiz/page.tsx),
 * mocking only the data layer — same style as
 * quiz-practice-v2-check-answer.test.tsx.
 *
 * Pins:
 *   F8 — every submitted response carries `hint_level` (0-3), captured AT
 *        ANSWER TIME (question answered after revealing 1 hint → 1; question
 *        answered with no hints → 0).
 *   F4 — classifyError receives the REAL per-topic mastery (5th arg) from
 *        the batched quiz-start lookup when a concept_mastery row exists,
 *        and the explicit 0.5 fallback when it doesn't. (The old code
 *        hardcoded 0.5 always.)
 *   F2 — a /quiz?mode=srs session grades each served card exactly once via
 *        the EXISTING POST /api/learner/review/grade endpoint after submit,
 *        using the server-truth is_correct and the {0,3,4,5} quality set.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';

// ─── Mutable mock state ───────────────────────────────────────────────────

const authState = {
  isHi: false,
  isLoading: false,
  isLoggedIn: true,
  activeRole: 'student' as const,
  student: { id: 'student-1', name: 'Asha', grade: '9' },
  refreshSnapshot: vi.fn(),
};

const featureFlags = {
  ff_quiz_v2: true,
  ff_quiz_result_v2: false,
};

// Rows served by the mocked supabase client, keyed by table.
const tableData: Record<string, unknown[]> = {};

// classifyError spy — captures every call's args (F4 pin reads the 5th).
const classifyErrorCalls: unknown[][] = [];

// ─── Mocks ────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => ({ data: featureFlags, isLoading: false }),
  invalidateDashboard: vi.fn(),
}));

vi.mock('@alfanumrik/lib/quiz/v2/use-next-task', () => ({
  useNextTask: () => ({ href: '/today', labelEn: 'Next task', labelHi: 'अगला काम' }),
}));

vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({
    unlocked: [{ code: 'science', name: 'Science', icon: '🔬', color: '#16A34A', isLocked: false }],
    locked: [],
    subjects: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@alfanumrik/lib/api/auth-header', () => ({
  authHeader: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alfanumrik/lib/analytics', () => ({
  track: vi.fn(),
}));

const Q1 = {
  id: 'q1',
  question_text: 'What is 2+2?',
  question_hi: null,
  question_type: 'mcq',
  options: ['1', '2', '3', '4'],
  correct_answer_index: 3,
  explanation: 'Two plus two equals four.',
  explanation_hi: null,
  hint: 'Count on your fingers.',
  difficulty: 1,
  bloom_level: 'remember',
  chapter_number: 1,
};

const Q2 = {
  id: 'q2',
  question_text: 'What is the capital of India?',
  question_hi: null,
  question_type: 'mcq',
  options: ['Mumbai', 'Delhi', 'Chennai', 'Kolkata'],
  correct_answer_index: 1,
  explanation: 'Delhi is the national capital of India.',
  explanation_hi: null,
  hint: null,
  difficulty: 1,
  bloom_level: 'remember',
  chapter_number: 1,
};

vi.mock('@alfanumrik/lib/quiz-assembler', () => ({
  assembleQuiz: vi.fn().mockResolvedValue({ success: true, questions: [Q1, Q2], returnedCount: 2 }),
}));

const mockStartQuizSession = vi.fn();
const mockCheckQuizAnswer = vi.fn();
const mockSubmitQuizResults = vi.fn();
const mockSaveQuestionResponses = vi.fn().mockResolvedValue(undefined);
const mockSaveCognitiveMetrics = vi.fn().mockResolvedValue(undefined);
const mockUpdateChapterProgress = vi.fn().mockResolvedValue(undefined);

vi.mock('@alfanumrik/lib/supabase', () => {
  function makeChain(table: string) {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'not', 'lte', 'order', 'limit']) {
      chain[m] = vi.fn(() => chain);
    }
    (chain as Record<string, unknown>).insert = vi.fn().mockResolvedValue({ data: null, error: null });
    (chain as Record<string, unknown>).maybeSingle = vi.fn(async () => ({
      data: (tableData[table] ?? [])[0] ?? null,
      error: null,
    }));
    (chain as { then: unknown }).then = (resolve: (r: unknown) => unknown) =>
      Promise.resolve({ data: tableData[table] ?? [], error: null }).then(resolve);
    return chain;
  }
  return {
    startQuizSession: (...args: unknown[]) => mockStartQuizSession(...args),
    checkQuizAnswer: (...args: unknown[]) => mockCheckQuizAnswer(...args),
    submitQuizResults: (...args: unknown[]) => mockSubmitQuizResults(...args),
    saveQuestionResponses: (...args: unknown[]) => mockSaveQuestionResponses(...args),
    saveCognitiveMetrics: (...args: unknown[]) => mockSaveCognitiveMetrics(...args),
    updateChapterProgress: (...args: unknown[]) => mockUpdateChapterProgress(...args),
    supabase: {
      from: vi.fn((table: string) => makeChain(table)),
      auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
    },
  };
});

vi.mock('@alfanumrik/lib/feedback-engine', () => ({
  createFeedbackState: () => ({}),
  onCorrectAnswer: () => ({ sound: 'correct', foxyLine: { en: 'Nice!', hi: 'बढ़िया!' } }),
  onWrongAnswer: () => ({ sound: 'wrong', foxyLine: { en: 'Try again', hi: 'फिर कोशिश करो' } }),
  onSessionComplete: () => ({ sound: 'complete', foxyLine: { en: 'Done', hi: 'हो गया' } }),
  getNearCompletionNudge: () => null,
  playFeedbackSound: vi.fn(),
}));

vi.mock('@alfanumrik/lib/cognitive-engine', () => ({
  BLOOM_CONFIG: { remember: { icon: '🧠', label: 'Remember', labelHi: 'याद', color: '#7C3AED' } },
  FATIGUE_EASE_OFF_THRESHOLD: 0.4,
  initialCognitiveLoad: () => ({
    fatigueScore: 0, shouldPause: false, shouldEaseOff: false, shouldPushHarder: false,
    consecutiveErrors: 0, consecutiveCorrect: 0,
  }),
  updateCognitiveLoad: (state: unknown) => state,
  getReflectionPrompt: () => null,
  classifyError: (...args: unknown[]) => {
    classifyErrorCalls.push(args);
    return 'careless';
  },
}));

vi.mock('@alfanumrik/ui/math/MathRenderer', () => ({
  default: ({ content }: { content: string }) => content,
}));

vi.mock('@alfanumrik/ui/quiz/QuizSetup', () => ({
  default: ({ onStart }: { onStart: (opts: Record<string, unknown>) => void }) => (
    <button
      data-testid="quiz-setup-stub-start"
      onClick={() =>
        onStart({
          subject: 'science',
          quizMode: 'practice',
          questionCount: 2,
          difficulty: null,
          chapterNumber: null,
          questionTypes: ['mcq'],
        })
      }
    >
      Start
    </button>
  ),
}));

vi.mock('@alfanumrik/ui/quiz/FeedbackOverlay', () => ({ default: () => null }));
vi.mock('@alfanumrik/ui/quiz/ncert/WrittenAnswerInput', () => ({ default: () => null }));
vi.mock('@alfanumrik/ui/quiz/MisconceptionExplainer', () => ({ default: () => null }));
vi.mock('@alfanumrik/ui/quiz/QuizResults', () => ({
  default: () => <div data-testid="legacy-quiz-results-stub" />,
}));
vi.mock('@alfanumrik/ui/quiz/v2/ResultSummary', () => ({
  default: () => <div data-testid="result-summary-v2-stub" />,
}));

// ─── Test setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  classifyErrorCalls.length = 0;
  for (const k of Object.keys(tableData)) delete tableData[k];
  authState.isHi = false;
  authState.isLoading = false;
  authState.isLoggedIn = true;
  authState.student = { id: 'student-1', name: 'Asha', grade: '9' };
  featureFlags.ff_quiz_v2 = true;
  featureFlags.ff_quiz_result_v2 = false;
  window.history.pushState({}, '', '/quiz'); // no deep link by default
  mockStartQuizSession.mockResolvedValue({
    session_id: 'sess-1',
    questions: [
      { question_id: 'q1', options_displayed: ['1', '2', '3', '4'] },
      { question_id: 'q2', options_displayed: ['Mumbai', 'Delhi', 'Chennai', 'Kolkata'] },
    ],
  });
  mockCheckQuizAnswer.mockResolvedValue(null);
  mockSubmitQuizResults.mockResolvedValue({
    total: 2, correct: 1, score_percent: 50, xp_earned: 10, session_id: 'sess-1',
  });
  // F4 data: q1's topic HAS a mastery row (0.62); q2's does not (→ 0.5 fallback).
  tableData['question_bank'] = [
    { ...Q1, topic_id: 't1' },
    { ...Q2, topic_id: 't2' },
  ];
  tableData['concept_mastery'] = [{ topic_id: 't1', mastery_probability: 0.62 }];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderQuizAndStart() {
  const { default: QuizPage } = await import('@/app/(student)/quiz/page');
  render(<QuizPage />);
  const startBtn = await screen.findByTestId('quiz-setup-stub-start');
  await act(async () => {
    startBtn.click();
  });
  return screen.findByTestId('practice-runner-v2');
}

async function answerCurrentQuestion(optionIdx: number) {
  const optBtn = await screen.findByTestId(`practice-runner-v2-option-${optionIdx}`);
  await act(async () => { optBtn.click(); });
  const confirmBtn = await screen.findByTestId('practice-runner-v2-confirm');
  await act(async () => { confirmBtn.click(); });
}

async function goToNextQuestion() {
  const nextBtn = await screen.findByTestId('practice-runner-v2-next');
  await act(async () => { nextBtn.click(); });
}

// ─── F8 + F4 ──────────────────────────────────────────────────────────────

describe('Quiz page — F8 hint_level in the submit payload', () => {
  it('every response carries hint_level captured at answer time (1 after a hint, 0 without)', async () => {
    await renderQuizAndStart();

    // Q1: reveal one hint, then answer.
    const hintBtn = await screen.findByTestId('practice-runner-v2-hint');
    await act(async () => { hintBtn.click(); });
    await answerCurrentQuestion(3);
    await goToNextQuestion();
    await screen.findByTestId('practice-runner-v2-option-0'); // Q2 rendered

    // Q2: no hint.
    await answerCurrentQuestion(1);
    await goToNextQuestion();

    await waitFor(() => expect(mockSubmitQuizResults).toHaveBeenCalledTimes(1));
    const responses = mockSubmitQuizResults.mock.calls[0][5] as Array<{
      question_id: string;
      hint_level?: number;
    }>;
    expect(responses).toHaveLength(2);
    expect(responses[0].question_id).toBe('q1');
    expect(responses[0].hint_level).toBe(1); // hint revealed before answering
    expect(responses[1].question_id).toBe('q2');
    expect(responses[1].hint_level).toBe(0); // answered clean
    // Contract shape: always present, always 0-3.
    for (const r of responses) {
      expect(typeof r.hint_level).toBe('number');
      expect(r.hint_level).toBeGreaterThanOrEqual(0);
      expect(r.hint_level).toBeLessThanOrEqual(3);
    }
  });
});

describe('Quiz page — F4 classifyError receives real topic mastery', () => {
  it('passes the concept_mastery probability for topics that have one, 0.5 only as fallback', async () => {
    await renderQuizAndStart();
    await answerCurrentQuestion(3); // q1 — topic t1 has mastery 0.62
    await goToNextQuestion();
    await screen.findByTestId('practice-runner-v2-option-0');
    await answerCurrentQuestion(1); // q2 — topic t2 has NO mastery row
    await goToNextQuestion();
    await waitFor(() => expect(mockSubmitQuizResults).toHaveBeenCalledTimes(1));

    expect(classifyErrorCalls).toHaveLength(2);
    // 5th positional arg = studentMastery.
    expect(classifyErrorCalls[0][4]).toBe(0.62); // real mastery — NOT the old constant
    expect(classifyErrorCalls[1][4]).toBe(0.5);  // explicit no-row fallback
  });
});

// ─── F2: SRS grade loop (/quiz?mode=srs) ──────────────────────────────────

describe('Quiz page — F2 SRS grade loop closes after submit', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/quiz?mode=srs');
    // One due card backing q1.
    tableData['spaced_repetition_cards'] = [
      { id: 'card-1', source_id: 'q1', subject: 'science' },
    ];
    tableData['question_bank'] = [{ ...Q1, topic_id: 't1' }];
    tableData['concept_mastery'] = [];
    mockStartQuizSession.mockResolvedValue({
      session_id: 'sess-srs',
      questions: [{ question_id: 'q1', options_displayed: ['1', '2', '3', '4'] }],
    });
    mockSubmitQuizResults.mockResolvedValue({
      total: 1, correct: 1, score_percent: 100, xp_earned: 10, session_id: 'sess-srs',
      questions: [{ question_id: 'q1', is_correct: true }],
    });
  });

  it('POSTs the card grade to /api/learner/review/grade with server-truth correctness (quality 5, fast correct)', async () => {
    const { default: QuizPage } = await import('@/app/(student)/quiz/page');
    render(<QuizPage />);

    // Deep link auto-starts the SRS review (mode stays 'cognitive' → legacy JSX).
    const optionSpan = await screen.findByText('4');
    await act(async () => {
      fireEvent.click(optionSpan.closest('button')!);
    });
    const submitBtn = await screen.findByText(/Submit Answer/);
    await act(async () => {
      fireEvent.click(submitBtn.closest('button') ?? submitBtn);
    });
    const seeResults = await screen.findByText(/See Results/);
    await act(async () => {
      fireEvent.click(seeResults.closest('button') ?? seeResults);
    });

    await waitFor(() => expect(mockSubmitQuizResults).toHaveBeenCalledTimes(1));
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => {
      const gradeCalls = fetchMock.mock.calls.filter(
        (c: unknown[]) => String(c[0]) === '/api/learner/review/grade',
      );
      expect(gradeCalls).toHaveLength(1);
      const init = gradeCalls[0][1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('same-origin');
      // Server said is_correct=true, time_spent ~0s → quality 5.
      expect(JSON.parse(String(init.body))).toEqual({ cardId: 'card-1', quality: 5 });
    });
  });
});
