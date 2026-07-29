import type { Page, Route } from '@playwright/test';

/**
 * Deterministic quiz backend for browser-level P1/P2/P3 assertions.
 *
 * The quiz orchestrator (`apps/host/src/app/(student)/quiz/page.tsx`) reaches
 * the results screen through this chain:
 *
 *   GET  /api/student/subjects            → subject picker
 *   POST /functions/v1/quiz-generator     → candidate questions (rung 0 of
 *                                           quiz-assembler's fallback ladder)
 *   RPC  start_quiz_session               → server-owned shuffle snapshot
 *                                           (returning a session_id routes the
 *                                           submit through the CANONICAL v2 RPC)
 *   RPC  submit_quiz_results_v2           → authoritative score / XP / flags
 *
 * Every one of those is intercepted here, so the flow needs no live backend,
 * no seeded fixture student and no secret. What is being asserted is exactly
 * the P1/P2 contract that cannot be unit-tested: the browser must RENDER the
 * server-returned score and XP verbatim and must never recompute them.
 *
 * IMPORTANT ordering note: Playwright matches routes in REVERSE registration
 * order, so `installQuizBackend()` must be called BEFORE `mockStudentSession()`
 * — otherwise the catch-all `**\/rest/v1/**` handler below shadows the
 * `students` / `get_user_role` mocks and AuthContext never resolves.
 */

export interface MockQuestion {
  id: string;
  question_text: string;
  question_hi: null;
  question_type: 'mcq';
  options: string[];
  correct_answer_index: number;
  explanation: string;
  explanation_hi: null;
  hint: null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number;
  subject: string;
  grade: string;
  topic: string;
  is_active: boolean;
  verification_status: string;
}

/** Distinctive option labels so the answer loop can target a stable locator. */
export const OPTION_LABELS = ['E2E-ALPHA', 'E2E-BETA', 'E2E-GAMMA', 'E2E-DELTA'] as const;

/**
 * P6-valid MCQs: non-empty text with no template markers, four distinct
 * non-empty options, correct_answer_index in 0..3, and an explanation long
 * enough to clear quiz-assembler's `weak_explanation` gate (>= 20 chars).
 */
export function buildQuestions(count: number): MockQuestion[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e2e-q-${i + 1}`,
    question_text: `E2E question ${i + 1}: which option is the first one?`,
    question_hi: null,
    question_type: 'mcq' as const,
    options: [...OPTION_LABELS],
    correct_answer_index: 0,
    explanation: `The first option is always the correct one in this deterministic E2E fixture set.`,
    explanation_hi: null,
    hint: null,
    difficulty: 2,
    bloom_level: 'remember',
    chapter_number: 1,
    subject: 'science',
    grade: '9',
    topic: 'e2e',
    is_active: true,
    verification_status: 'verified',
  }));
}

export interface QuizBackendOptions {
  /** Questions served to the student. Defaults to 10. */
  questions?: MockQuestion[];
  /** Body returned by the authoritative submit RPC. */
  submitResult: Record<string, unknown>;
  /** HTTP status for the submit RPC (use 400/500 to exercise failure UI). */
  submitStatus?: number;
  /**
   * When false, `start_quiz_session` returns null-shaped data so the client
   * falls back to the legacy v1 submit path. Defaults to true (v2 path).
   */
  serverShuffle?: boolean;
}

/** Records which RPCs the page actually called — used for contract assertions. */
export interface QuizBackendRecorder {
  rpcCalls: string[];
  submitPayloads: Array<Record<string, unknown>>;
}

export async function installQuizBackend(
  page: Page,
  opts: QuizBackendOptions,
): Promise<QuizBackendRecorder> {
  const questions = opts.questions ?? buildQuestions(10);
  const serverShuffle = opts.serverShuffle ?? true;
  const recorder: QuizBackendRecorder = { rpcCalls: [], submitPayloads: [] };

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  // Broadest first (Playwright resolves last-registered first).
  await page.route('**/rest/v1/**', async (route) => {
    if (route.request().url().includes('/rpc/')) return route.fallback();
    return json(route, []);
  });

  await page.route('**/rest/v1/rpc/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() || '';
    recorder.rpcCalls.push(name);

    if (name === 'start_quiz_session') {
      if (!serverShuffle) return json(route, {});
      return json(route, {
        session_id: 'e2e-session-0001',
        // Server strips correct_answer_index and returns display order.
        questions: questions.map((q) => ({
          id: q.id,
          question_text: q.question_text,
          question_hi: null,
          question_type: q.question_type,
          options: q.options,
          explanation: q.explanation,
          explanation_hi: null,
          difficulty: q.difficulty,
          bloom_level: q.bloom_level,
          chapter_number: q.chapter_number,
        })),
      });
    }

    if (name === 'submit_quiz_results_v2' || name === 'submit_quiz_results') {
      const payload = route.request().postDataJSON() as Record<string, unknown> | null;
      if (payload) recorder.submitPayloads.push(payload);
      return json(route, opts.submitResult, opts.submitStatus ?? 200);
    }

    // Everything else the page touches opportunistically (dashboard snapshot,
    // feature flags, learner-state writers) resolves empty and fail-soft.
    return json(route, []);
  });

  await page.route('**/functions/v1/**', (route) => json(route, { questions }));

  await page.route('**/api/student/subjects', (route) =>
    json(route, {
      subjects: [
        { code: 'science', name: 'Science', nameHi: 'विज्ञान', icon: '🔬', isLocked: false, chapters: 5 },
      ],
    }),
  );

  return recorder;
}

/**
 * Drive QuizSetup → answer every question → land on the results screen.
 *
 * Practice mode is a three-click cycle per question:
 *   pick an option → "Submit Answer" → "Next Question →" / "See Results 🎯"
 * (Both English and Hindi labels are accepted so the helper survives an
 * AuthContext.isHi default flip — P7.)
 */
export async function runQuizToResults(
  page: Page,
  opts: { questionCount: number; answerLabel?: string },
): Promise<void> {
  await page.goto('/quiz');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /practice mode/i }).click();
  await page.getByRole('button', { name: /science/i }).first().click();
  await page.getByRole('button', { name: /start .*quiz/i }).click();

  const label = opts.answerLabel ?? OPTION_LABELS[0];
  const SUBMIT = /submit answer|जवाब जमा करो/i;
  const ADVANCE = /next question|see results|अगला सवाल|नतीजे देखो/i;

  for (let i = 0; i < opts.questionCount; i++) {
    const option = page.getByRole('button', { name: label, exact: false }).first();
    await option.waitFor({ state: 'visible', timeout: 30_000 });
    await option.click();

    const submit = page.getByRole('button', { name: SUBMIT });
    await submit.waitFor({ state: 'visible', timeout: 30_000 });
    await submit.click();

    const advance = page.getByRole('button', { name: ADVANCE });
    await advance.waitFor({ state: 'visible', timeout: 30_000 });
    await advance.click();
  }
}
