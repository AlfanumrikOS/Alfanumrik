// apps/host/src/__tests__/lib/ai/workflows/quiz-generate-anti-fake-render.test.ts
//
// REG-248 (workflow half) — the quiz-generate workflow NEVER surfaces a bare
// "Generated N quiz questions." claim. Either it renders the ACTUAL validated
// questions AS the student-facing `response` (AC1), or — when 0 questions survive
// P6 validation — it returns the graceful bilingual fallback.
//
//   • A validated multi-question set renders real questions (bilingual header,
//     4 lettered options each, an inline "Answers / उत्तर" key) and the rendered
//     text passes the unconditional anti-fake backstop (claimOnly === false) —
//     i.e. the render is genuinely real-question-shaped, never a claim.
//   • The n===1 degraded path renders SINGULAR grammar (assessment's fix:
//     "Here is 1 practice question … attempt it … answer below").
//   • 0 survivors → `response` is exactly QUIZ_CLAIM_FALLBACK_TEXT.
//
// The private `renderQuizQuestionsText` is exercised through its only caller,
// `runQuizGenerateWorkflow`, with Claude/retrieval/prompt/trace mocked and the
// REAL `validateQuizQuestions` (P6 gate) left running.
//
// Owner: ai-engineer. Reviewers: assessment (grammar/render correctness),
// testing (this file).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QUIZ_CLAIM_FALLBACK_TEXT, stripFakeQuizClaim } from '@alfanumrik/lib/foxy/anti-fake-quiz-claim';

// ─── Feature flag mock — goal-aware selection OFF (legacy DEFAULT_* path) ─────
const _isFeatureEnabled = vi.fn().mockResolvedValue(false);
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── Logger — silent ─────────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Prompt builder — stub ───────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/prompts/quiz-gen', () => ({
  buildQuizGenPrompt: vi.fn(() => 'STUB_SYSTEM_PROMPT'),
}));

// ─── Retrieval — empty pass-through ──────────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/retrieval/ncert-retriever', () => ({
  retrieveNcertChunks: vi.fn().mockResolvedValue({ chunks: [], contextText: '', error: null }),
}));

// ─── Claude — content controlled per test ────────────────────────────────────
const callClaudeMock = vi.fn();
vi.mock('@alfanumrik/lib/ai/clients/claude', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
}));

// ─── Trace logger — silent sink ──────────────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/tracing/trace-logger', () => {
  class TraceLogger {
    constructor(_w: string, _s?: string, _sess?: string) {}
    startStep(_t: string): void {}
    endStep(_m?: Record<string, unknown>, _e?: string): void {}
    finish() {
      return {
        traceId: 'trace-stub',
        workflow: 'quiz-generate',
        startedAt: '2026-07-15T00:00:00.000Z',
        totalDurationMs: 0,
        steps: [],
      };
    }
  }
  return { TraceLogger, logTrace: vi.fn() };
});

function claudeReturnsJson(questions: unknown[]) {
  callClaudeMock.mockResolvedValue({
    content: JSON.stringify(questions),
    model: 'claude-haiku-test',
    tokensUsed: 100,
    inputTokens: 50,
    outputTokens: 50,
    stopReason: 'end_turn',
    latencyMs: 25,
  });
}

function validQuestion(n: number) {
  return {
    text: `Question ${n}: which organelle is the powerhouse of the cell?`,
    options: [`Nucleus ${n}`, `Mitochondria ${n}`, `Ribosome ${n}`, `Golgi ${n}`],
    correctAnswerIndex: 1,
    explanation: 'Mitochondria produce ATP, so it is called the powerhouse of the cell.',
    difficulty: 'easy',
    bloomLevel: 'understand',
  };
}

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    subject: 'science',
    grade: '9',
    board: 'CBSE',
    chapter: 'The Cell',
    mode: 'quiz',
    history: [],
    studentId: 'student-uuid-1',
    sessionId: 'session-uuid-1',
    ...overrides,
  } as Parameters<
    typeof import('@alfanumrik/lib/ai/workflows/quiz-generate').runQuizGenerateWorkflow
  >[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  _isFeatureEnabled.mockResolvedValue(false);
});

describe('runQuizGenerateWorkflow — renders REAL questions, never a bare "Generated N" claim', () => {
  it('a validated multi-question set renders real questions with lettered options + an answer key', async () => {
    claudeReturnsJson([validQuestion(1), validQuestion(2), validQuestion(3), validQuestion(4)]);

    const { runQuizGenerateWorkflow } = await import('@alfanumrik/lib/ai/workflows/quiz-generate');
    const result = await runQuizGenerateWorkflow('the cell', makeParams());

    // 4 survived P6 validation and are surfaced IN the response string.
    expect(result.metadata.questionsValid).toBe(4);
    expect(result.metadata.questions).toHaveLength(4);

    // Real rendered shape: bilingual plural header, lettered options, answer key.
    expect(result.response).toContain('Here are 4 practice questions');
    expect(result.response).toContain('(4 अभ्यास प्रश्न');
    expect(result.response).toContain('A)');
    expect(result.response).toContain('B)');
    expect(result.response).toContain('C)');
    expect(result.response).toContain('D)');
    expect(result.response).toContain('Answers / उत्तर:');

    // It is NOT a bare meta-claim — the actual question text is present …
    expect(result.response).toContain('powerhouse of the cell');
    // … and the whole render passes the unconditional anti-fake backstop:
    // real question content means the strip is a no-op.
    expect(stripFakeQuizClaim(result.response).claimOnly).toBe(false);
    expect(result.response).not.toBe(QUIZ_CLAIM_FALLBACK_TEXT);
  });

  it('the n===1 degraded path renders SINGULAR grammar (assessment fix)', async () => {
    // Two questions from Claude, but one fails P6 (only 3 options) → exactly 1
    // survives → the singular-grammar branch is exercised.
    claudeReturnsJson([
      validQuestion(1),
      { ...validQuestion(2), options: ['only', 'three', 'options'] },
    ]);

    const { runQuizGenerateWorkflow } = await import('@alfanumrik/lib/ai/workflows/quiz-generate');
    const result = await runQuizGenerateWorkflow('the cell', makeParams());

    expect(result.metadata.questionsValid).toBe(1);
    // Singular grammar — "is 1 practice question", "attempt it", "answer below".
    expect(result.response).toContain('Here is 1 practice question');
    expect(result.response).toContain('attempt it');
    expect(result.response).toContain('check the answer below');
    expect(result.response).not.toContain('practice questions'); // no plural leak
    expect(result.response).toContain('(1 अभ्यास प्रश्न');
    // Still real (has the 4 lettered options) → backstop is a no-op.
    expect(stripFakeQuizClaim(result.response).claimOnly).toBe(false);
  });

  it('0 survivors → response is exactly the bilingual fallback (never a claim)', async () => {
    // Every question fails P6 (3 options each) → 0 valid → fallback.
    claudeReturnsJson([
      { ...validQuestion(1), options: ['a', 'b', 'c'] },
      { ...validQuestion(2), options: ['a', 'b', 'c'] },
    ]);

    const { runQuizGenerateWorkflow } = await import('@alfanumrik/lib/ai/workflows/quiz-generate');
    const result = await runQuizGenerateWorkflow('the cell', makeParams());

    expect(result.metadata.questionsValid).toBe(0);
    expect(result.response).toBe(QUIZ_CLAIM_FALLBACK_TEXT);
    // metadata.questions is empty — nothing was hidden there either.
    expect(result.metadata.questions).toHaveLength(0);
    expect((result.metadata.validationErrors as string[]).length).toBeGreaterThan(0);
  });
});
