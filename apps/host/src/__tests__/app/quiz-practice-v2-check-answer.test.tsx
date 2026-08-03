/**
 * Screen "07 Practice" (`ff_quiz_v2`) — immediate per-question feedback via
 * check_quiz_answer() (migration 20260802130000_check_quiz_answer_rpc.sql).
 *
 * Pins the orchestrator wiring in
 * `apps/host/src/app/(student)/quiz/page.tsx` (confirmAnswerPracticeV2 +
 * the PracticeRunner render branch), NOT PracticeRunner's own presentational
 * behavior (that's a pure props-in component, safe to reason about by
 * reading `packages/ui/src/quiz/v2/PracticeRunner.tsx` directly).
 *
 * Four things this file pins, per the frontend task brief:
 *   (a) checkQuizAnswer() is called AT MOST ONCE per question.
 *   (b) A second confirm for an already-answered question is a pure no-op
 *       client-side (the synchronous ref-guard), even when two click events
 *       are dispatched in the same React batch before any re-render — i.e.
 *       BEFORE the `disabled` attribute would have had a chance to protect
 *       the button. This is the PRIMARY "no retry after reveal" enforcement
 *       point (the RPC's own replay-lock is defense-in-depth only).
 *   (c) The final submitQuizResults() call is byte-identical in shape and
 *       cadence to the legacy path: called exactly ONCE, at the end, with
 *       the full p_responses-equivalent array (same positional args,
 *       same session id, same call site — nothing about the RPC in this
 *       migration ever substitutes for it).
 *   (d) When checkQuizAnswer() resolves to `null` (RPC failure / offline),
 *       the UI degrades gracefully to a neutral "answer saved" state
 *       instead of blocking the quiz, and the quiz still completes through
 *       the SAME final submit path.
 *
 * Mocking style follows the established v2-flag-gate pattern (see
 * `src/__tests__/me/me-page-flag-gate.test.tsx`): mock only the data/router
 * layer and the OTHER v2 screens (QuizResults/ResultSummary/
 * MisconceptionExplainer/QuizSetup/FeedbackOverlay/WrittenAnswerInput),
 * leave `next/dynamic` itself real (Vitest's module graph honors the
 * `@alfanumrik/ui/*` mocks even through a dynamic `import()`), and leave
 * PracticeRunner itself UNMOCKED so this test exercises the real
 * presentational component too.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';

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

// ─── Mocks ──────────────────────────────────────────────────────────────

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
  hint: null,
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

const mockStartQuizSession = vi.fn().mockResolvedValue({
  session_id: 'sess-1',
  questions: [
    { question_id: 'q1', options_displayed: ['1', '2', '3', '4'] },
    { question_id: 'q2', options_displayed: ['Mumbai', 'Delhi', 'Chennai', 'Kolkata'] },
  ],
});
const mockCheckQuizAnswer = vi.fn();
const mockSubmitQuizResults = vi.fn().mockResolvedValue({
  total: 2,
  correct: 1,
  score_percent: 50,
  xp_earned: 10,
  session_id: 'sess-1',
});
const mockSaveQuestionResponses = vi.fn().mockResolvedValue(undefined);
const mockSaveCognitiveMetrics = vi.fn().mockResolvedValue(undefined);
const mockUpdateChapterProgress = vi.fn().mockResolvedValue(undefined);

vi.mock('@alfanumrik/lib/supabase', () => ({
  startQuizSession: (...args: unknown[]) => mockStartQuizSession(...args),
  checkQuizAnswer: (...args: unknown[]) => mockCheckQuizAnswer(...args),
  submitQuizResults: (...args: unknown[]) => mockSubmitQuizResults(...args),
  saveQuestionResponses: (...args: unknown[]) => mockSaveQuestionResponses(...args),
  saveCognitiveMetrics: (...args: unknown[]) => mockSaveCognitiveMetrics(...args),
  updateChapterProgress: (...args: unknown[]) => mockUpdateChapterProgress(...args),
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) })),
    })),
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
}));

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
  classifyError: () => 'careless',
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

// ─── Test setup ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  authState.isHi = false;
  authState.isLoading = false;
  authState.isLoggedIn = true;
  authState.student = { id: 'student-1', name: 'Asha', grade: '9' };
  featureFlags.ff_quiz_v2 = true;
  featureFlags.ff_quiz_result_v2 = false;
  mockStartQuizSession.mockResolvedValue({
    session_id: 'sess-1',
    questions: [
      { question_id: 'q1', options_displayed: ['1', '2', '3', '4'] },
      { question_id: 'q2', options_displayed: ['Mumbai', 'Delhi', 'Chennai', 'Kolkata'] },
    ],
  });
  mockSubmitQuizResults.mockResolvedValue({
    total: 2, correct: 1, score_percent: 50, xp_earned: 10, session_id: 'sess-1',
  });
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
  // Wait for the practice-v2 runner to mount for question 1.
  return screen.findByTestId('practice-runner-v2');
}

async function answerCurrentQuestion(optionIdx: number) {
  const optBtn = await screen.findByTestId(`practice-runner-v2-option-${optionIdx}`);
  await act(async () => {
    optBtn.click();
  });
  const confirmBtn = await screen.findByTestId('practice-runner-v2-confirm');
  await act(async () => {
    confirmBtn.click();
  });
}

async function goToNextQuestion() {
  const nextBtn = await screen.findByTestId('practice-runner-v2-next');
  await act(async () => {
    nextBtn.click();
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('Quiz page — Practice v2 (ff_quiz_v2) immediate per-question feedback', () => {
  it('(a) calls checkQuizAnswer exactly once per question across a 2-question quiz', async () => {
    mockCheckQuizAnswer
      .mockResolvedValueOnce({
        question_id: 'q1', is_correct: true, correct_displayed_index: 3,
        explanation: 'Two plus two equals four.', explanation_hi: null, already_answered: false,
      })
      .mockResolvedValueOnce({
        question_id: 'q2', is_correct: false, correct_displayed_index: 1,
        explanation: 'Delhi is the national capital of India.', explanation_hi: null, already_answered: false,
      });

    await renderQuizAndStart();
    await answerCurrentQuestion(3); // correct answer for Q1
    await waitFor(() => expect(mockCheckQuizAnswer).toHaveBeenCalledTimes(1));
    expect(mockCheckQuizAnswer).toHaveBeenNthCalledWith(1, 'sess-1', 'q1', 3, expect.any(Number));

    await goToNextQuestion();
    await screen.findByTestId('practice-runner-v2-option-0'); // Q2 rendered

    await answerCurrentQuestion(2); // wrong answer for Q2 (correct is index 1)
    await waitFor(() => expect(mockCheckQuizAnswer).toHaveBeenCalledTimes(2));
    expect(mockCheckQuizAnswer).toHaveBeenNthCalledWith(2, 'sess-1', 'q2', 2, expect.any(Number));

    // Never called a third time, even after the quiz completes.
    await goToNextQuestion();
    await waitFor(() => expect(mockSubmitQuizResults).toHaveBeenCalledTimes(1));
    expect(mockCheckQuizAnswer).toHaveBeenCalledTimes(2);
  });

  it('(b) a second confirm for an already-answered question is a no-op — even two synchronous click events before any re-render only trigger ONE checkQuizAnswer call', async () => {
    mockCheckQuizAnswer.mockResolvedValue({
      question_id: 'q1', is_correct: true, correct_displayed_index: 3,
      explanation: 'Two plus two equals four.', explanation_hi: null, already_answered: false,
    });

    await renderQuizAndStart();
    const optBtn = await screen.findByTestId('practice-runner-v2-option-3');
    await act(async () => { optBtn.click(); });

    const confirmBtn = await screen.findByTestId('practice-runner-v2-confirm');
    // Dispatch TWO click events inside a single act() batch — simulates a
    // double-tap / duplicate event firing BEFORE React has a chance to
    // re-render and flip `disabled` on the confirm control. This is
    // precisely the race the synchronous ref-guard in
    // confirmAnswerPracticeV2 (quiz/page.tsx) exists to close.
    act(() => {
      confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await waitFor(() => expect(mockCheckQuizAnswer).toHaveBeenCalled());
    // Give any stray microtask a chance to fire before asserting the ceiling.
    await new Promise((r) => setTimeout(r, 10));
    expect(mockCheckQuizAnswer).toHaveBeenCalledTimes(1);

    // Complete the quiz and confirm exactly 2 responses were recorded (not
    // 3) — proving the second confirm never pushed a duplicate response.
    await goToNextQuestion();
    await answerCurrentQuestion(1);
    await waitFor(() => expect(mockCheckQuizAnswer).toHaveBeenCalledTimes(2));
    await goToNextQuestion();
    await waitFor(() => expect(mockSubmitQuizResults).toHaveBeenCalledTimes(1));
    const responses = mockSubmitQuizResults.mock.calls[0][5];
    expect(responses).toHaveLength(2);
    expect(responses.map((r: { question_id: string }) => r.question_id)).toEqual(['q1', 'q2']);
  });

  it('(c) the final submitQuizResults call is unchanged in shape/cadence: called exactly once, with the full responses array and the same positional args as the legacy path', async () => {
    mockCheckQuizAnswer
      .mockResolvedValueOnce({
        question_id: 'q1', is_correct: true, correct_displayed_index: 3,
        explanation: 'Two plus two equals four.', explanation_hi: null, already_answered: false,
      })
      .mockResolvedValueOnce({
        question_id: 'q2', is_correct: true, correct_displayed_index: 1,
        explanation: 'Delhi is the national capital of India.', explanation_hi: null, already_answered: false,
      });

    await renderQuizAndStart();
    await answerCurrentQuestion(3);
    await waitFor(() => expect(mockCheckQuizAnswer).toHaveBeenCalledTimes(1));
    await goToNextQuestion();
    await answerCurrentQuestion(1);
    await waitFor(() => expect(mockCheckQuizAnswer).toHaveBeenCalledTimes(2));
    await goToNextQuestion();

    await waitFor(() => expect(mockSubmitQuizResults).toHaveBeenCalledTimes(1));
    const args = mockSubmitQuizResults.mock.calls[0];
    // submitQuizResults(studentId, subject, grade, topic, chapter, responses, timer, sessionId)
    expect(args[0]).toBe('student-1');
    expect(args[1]).toBe('science');
    expect(args[2]).toBe('9');
    expect(args[3]).toBe('Science');
    expect(args[4]).toBe(1);
    expect(Array.isArray(args[5])).toBe(true);
    expect(args[5]).toHaveLength(2);
    expect(args[5].map((r: { question_id: string }) => r.question_id)).toEqual(['q1', 'q2']);
    expect(typeof args[6]).toBe('number');
    expect(args[7]).toBe('sess-1');

    // Results screen (legacy — ff_quiz_result_v2 is off) mounts once, exactly
    // as it always has; the new RPC never substitutes for this path.
    await screen.findByTestId('legacy-quiz-results-stub');
    expect(mockSubmitQuizResults).toHaveBeenCalledTimes(1);
  });

  it('(d) gracefully degrades when checkQuizAnswer returns null: shows the neutral saved state, still lets the student proceed, and still completes the SAME final submit', async () => {
    mockCheckQuizAnswer
      .mockResolvedValueOnce(null) // Q1: RPC failure / offline
      .mockResolvedValueOnce({
        question_id: 'q2', is_correct: true, correct_displayed_index: 1,
        explanation: 'Delhi is the national capital of India.', explanation_hi: null, already_answered: false,
      });

    await renderQuizAndStart();
    await answerCurrentQuestion(3);
    await waitFor(() => expect(mockCheckQuizAnswer).toHaveBeenCalledTimes(1));

    // Neutral degrade panel, not a hang and not a (wrongly) colored verdict.
    await screen.findByTestId('practice-runner-v2-degraded');
    expect(screen.queryByTestId('practice-runner-v2-verdict')).not.toBeInTheDocument();

    // The student can still proceed — the "Next" control is not blocked by
    // the degraded state.
    await goToNextQuestion();
    await answerCurrentQuestion(1);
    await waitFor(() => expect(mockCheckQuizAnswer).toHaveBeenCalledTimes(2));
    await screen.findByTestId('practice-runner-v2-verdict'); // Q2 got a real verdict

    await goToNextQuestion();
    await waitFor(() => expect(mockSubmitQuizResults).toHaveBeenCalledTimes(1));
    // Final submit is completely unaffected by the degrade — same shape,
    // same 2 responses, same session id.
    const args = mockSubmitQuizResults.mock.calls[0];
    expect(args[5]).toHaveLength(2);
    expect(args[7]).toBe('sess-1');
  });
});
