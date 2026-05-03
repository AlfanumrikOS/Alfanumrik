/**
 * Phase 2: Goal-Adaptive quiz-generate workflow plumbing.
 *
 * Pins the contract that `ff_goal_aware_selection` is consulted on every
 * quiz-generate workflow invocation and that, when the flag is OFF (or the
 * student's goal is null/unknown), `buildQuizGenPrompt` is called with the
 * legacy DEFAULT_* constants — preserving byte-identical output vs. today.
 *
 * When the flag is ON and a known GoalCode is present, the prompt is built
 * with the count/difficulty/bloom picked by `pickQuizParams` for that goal.
 *
 * Owner: ai-engineer (assessment reviews correctness)
 *
 * P12 (AI Safety): the flag never bypasses validation — every question still
 *   flows through `validateQuizQuestions`. P13 (Data Privacy): the new
 *   `quiz-generate.params_chosen` log line carries `studentId: 'present' |
 *   'absent'` rather than the raw UUID.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage } from '@/lib/ai/types';

// ─── Feature flag mock — controlled per test ────────────────────────────────
const _isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => _isFeatureEnabled(...args),
}));

// ─── Logger spy ─────────────────────────────────────────────────────────────
const loggerInfo = vi.fn();
const loggerWarn = vi.fn();
const loggerError = vi.fn();
vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...args: unknown[]) => loggerInfo(...args),
    warn: (...args: unknown[]) => loggerWarn(...args),
    error: (...args: unknown[]) => loggerError(...args),
    debug: vi.fn(),
  },
}));

// ─── Prompt builder spy — capture every arg ─────────────────────────────────
const buildQuizGenPromptSpy = vi.fn((..._args: unknown[]) => 'STUB_SYSTEM_PROMPT');
vi.mock('@/lib/ai/prompts/quiz-gen', () => ({
  buildQuizGenPrompt: (...args: unknown[]) => buildQuizGenPromptSpy(...args),
}));

// ─── Retrieval — empty pass-through ─────────────────────────────────────────
vi.mock('@/lib/ai/retrieval/ncert-retriever', () => ({
  retrieveNcertChunks: vi.fn().mockResolvedValue({
    chunks: [],
    contextText: '',
    error: null,
  }),
}));

// ─── Claude — deterministic JSON-array stub ─────────────────────────────────
const STUB_QUESTIONS_JSON = JSON.stringify([
  {
    text: 'What is photosynthesis?',
    options: [
      'A process plants use to make food from sunlight',
      'A process animals use to digest food',
      'A type of cellular respiration',
      'A reaction that releases oxygen only',
    ],
    correctAnswerIndex: 0,
    explanation: 'Photosynthesis converts light energy into chemical energy in plants.',
    difficulty: 'medium',
    bloomLevel: 'understand',
  },
  {
    text: 'Which gas is released during photosynthesis?',
    options: ['Carbon dioxide', 'Oxygen', 'Nitrogen', 'Hydrogen'],
    correctAnswerIndex: 1,
    explanation: 'Oxygen is the byproduct of photosynthesis.',
    difficulty: 'easy',
    bloomLevel: 'remember',
  },
  {
    text: 'Where in the plant cell does photosynthesis occur?',
    options: ['Mitochondria', 'Nucleus', 'Chloroplast', 'Ribosome'],
    correctAnswerIndex: 2,
    explanation: 'Chloroplasts contain chlorophyll which absorbs light.',
    difficulty: 'medium',
    bloomLevel: 'understand',
  },
  {
    text: 'Chlorophyll is mainly which colour?',
    options: ['Red', 'Blue', 'Green', 'Yellow'],
    correctAnswerIndex: 2,
    explanation: 'Chlorophyll absorbs red and blue light and reflects green.',
    difficulty: 'easy',
    bloomLevel: 'remember',
  },
]);

vi.mock('@/lib/ai/clients/claude', () => ({
  callClaude: vi.fn().mockResolvedValue({
    content: STUB_QUESTIONS_JSON,
    model: 'claude-haiku-test',
    tokensUsed: 100,
    inputTokens: 50,
    outputTokens: 50,
    stopReason: 'end_turn',
    latencyMs: 25,
  }),
}));

// ─── Trace logger — silence the I/O sink ────────────────────────────────────
vi.mock('@/lib/ai/tracing/trace-logger', () => {
  class TraceLogger {
    private steps: unknown[] = [];
    constructor(_workflow: string, _studentId?: string, _sessionId?: string) {}
    startStep(_type: string): void {}
    endStep(_metadata?: Record<string, unknown>, _error?: string): void {}
    finish() {
      return {
        traceId: 'trace-stub-1',
        workflow: 'quiz-generate',
        startedAt: '2026-05-03T00:00:00.000Z',
        totalDurationMs: 0,
        steps: this.steps,
      };
    }
  }
  return {
    TraceLogger,
    logTrace: vi.fn(),
  };
});

// ─── Helpers ────────────────────────────────────────────────────────────────
function setFlag(value: boolean) {
  _isFeatureEnabled.mockImplementation((flag: string) => {
    if (flag === 'ff_goal_aware_selection') return Promise.resolve(value);
    return Promise.resolve(false);
  });
}

function makeParams(overrides: Record<string, unknown> = {}) {
  const history: ChatMessage[] = [];
  return {
    subject: 'science',
    grade: '7',
    board: 'CBSE',
    chapter: 'Photosynthesis',
    mode: 'quiz',
    history,
    studentId: 'student-uuid-1',
    sessionId: 'session-uuid-1',
    ...overrides,
  } as Parameters<
    typeof import('@/lib/ai/workflows/quiz-generate').runQuizGenerateWorkflow
  >[1];
}

interface CapturedPromptArgs {
  count: number;
  difficulty: number;
  bloomLevel: string;
  grade: string;
  subject: string;
  chapter: string;
  topic: string;
}

function lastPromptArgs(): CapturedPromptArgs {
  if (buildQuizGenPromptSpy.mock.calls.length === 0) {
    throw new Error('buildQuizGenPrompt was not called');
  }
  const lastCall = buildQuizGenPromptSpy.mock.calls[
    buildQuizGenPromptSpy.mock.calls.length - 1
  ] as unknown[];
  return lastCall[0] as CapturedPromptArgs;
}

function findParamsChosenLog(): { call: unknown[]; payload: Record<string, unknown> } | null {
  const call = loggerInfo.mock.calls.find(
    (c: unknown[]) => c[0] === 'quiz-generate.params_chosen',
  );
  if (!call) return null;
  return { call, payload: call[1] as Record<string, unknown> };
}

// ─── Common setup ───────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  // Tracing on by default in config; the mocked TraceLogger absorbs the call.
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('runQuizGenerateWorkflow — ff_goal_aware_selection plumbing', () => {
  describe('Test 1: flag OFF — byte-identical to legacy', () => {
    it('calls buildQuizGenPrompt with count=5, difficulty=3, bloomLevel=understand', async () => {
      setFlag(false);

      const { runQuizGenerateWorkflow } = await import(
        '@/lib/ai/workflows/quiz-generate'
      );
      const result = await runQuizGenerateWorkflow(
        'photosynthesis',
        makeParams({ academicGoal: 'board_topper' }),
      );

      // Flag was consulted exactly once with the documented context shape.
      const flagCalls = _isFeatureEnabled.mock.calls.filter(
        (c: unknown[]) => c[0] === 'ff_goal_aware_selection',
      );
      expect(flagCalls.length).toBe(1);
      const ctx = flagCalls[0][1] as Record<string, unknown>;
      expect(ctx.role).toBe('student');
      expect(ctx.userId).toBe('student-uuid-1');

      // Prompt builder received the legacy DEFAULT_* constants.
      const args = lastPromptArgs();
      expect(args.count).toBe(5);
      expect(args.difficulty).toBe(3);
      expect(args.bloomLevel).toBe('understand');

      // Metadata reflects "flag off" state.
      expect(result.metadata.useGoalAwareSelection).toBe(false);
      expect(result.metadata.goalCode).toBeNull();
      expect(result.metadata.quizParamsRationale).toBeNull();
      expect(result.metadata.questionsRequested).toBe(5);
    });
  });

  describe('Test 2: flag ON + board_topper', () => {
    it('calls buildQuizGenPrompt with count=15, difficulty=3, bloomLevel=analyze', async () => {
      setFlag(true);

      const { runQuizGenerateWorkflow } = await import(
        '@/lib/ai/workflows/quiz-generate'
      );
      const result = await runQuizGenerateWorkflow(
        'newton third law',
        makeParams({ academicGoal: 'board_topper' }),
      );

      const args = lastPromptArgs();
      expect(args.count).toBe(15);
      expect(args.difficulty).toBe(3);
      expect(args.bloomLevel).toBe('analyze');

      expect(result.metadata.useGoalAwareSelection).toBe(true);
      expect(result.metadata.goalCode).toBe('board_topper');
      expect(typeof result.metadata.quizParamsRationale).toBe('string');
      expect(result.metadata.quizParamsRationale as string).toContain('board_topper');
      expect((result.metadata.quizParamsRationale as string).length).toBeGreaterThan(0);
    });
  });

  describe('Test 3: flag ON + olympiad', () => {
    it('calls buildQuizGenPrompt with count=15, difficulty=4, bloomLevel=evaluate', async () => {
      setFlag(true);

      const { runQuizGenerateWorkflow } = await import(
        '@/lib/ai/workflows/quiz-generate'
      );
      const result = await runQuizGenerateWorkflow(
        'inequalities',
        makeParams({ academicGoal: 'olympiad' }),
      );

      const args = lastPromptArgs();
      expect(args.count).toBe(15);
      expect(args.difficulty).toBe(4);
      expect(args.bloomLevel).toBe('evaluate');

      expect(result.metadata.useGoalAwareSelection).toBe(true);
      expect(result.metadata.goalCode).toBe('olympiad');
      expect(result.metadata.quizParamsRationale as string).toContain('olympiad');
    });
  });

  describe('Test 4: flag ON + improve_basics', () => {
    it('calls buildQuizGenPrompt with count=5, difficulty=2, bloomLevel=understand', async () => {
      setFlag(true);

      const { runQuizGenerateWorkflow } = await import(
        '@/lib/ai/workflows/quiz-generate'
      );
      const result = await runQuizGenerateWorkflow(
        'fractions',
        makeParams({ academicGoal: 'improve_basics' }),
      );

      const args = lastPromptArgs();
      expect(args.count).toBe(5);
      expect(args.difficulty).toBe(2);
      expect(args.bloomLevel).toBe('understand');

      expect(result.metadata.useGoalAwareSelection).toBe(true);
      expect(result.metadata.goalCode).toBe('improve_basics');
    });
  });

  describe('Test 5: flag ON + academicGoal=null — legacy defaults preserved', () => {
    it('falls back to legacy DEFAULT_* constants when goal is null', async () => {
      setFlag(true);

      const { runQuizGenerateWorkflow } = await import(
        '@/lib/ai/workflows/quiz-generate'
      );
      const result = await runQuizGenerateWorkflow(
        'roots of polynomials',
        makeParams({ academicGoal: null }),
      );

      const args = lastPromptArgs();
      expect(args.count).toBe(5);
      expect(args.difficulty).toBe(3);
      expect(args.bloomLevel).toBe('understand');

      expect(result.metadata.useGoalAwareSelection).toBe(true);
      expect(result.metadata.goalCode).toBeNull();
      expect(result.metadata.quizParamsRationale).toBeNull();
    });
  });

  describe('Test 6: flag ON + unknown goal code — graceful fallback', () => {
    it('falls back to legacy DEFAULT_* constants when goal is unknown', async () => {
      setFlag(true);

      const { runQuizGenerateWorkflow } = await import(
        '@/lib/ai/workflows/quiz-generate'
      );
      const result = await runQuizGenerateWorkflow(
        'gravitation',
        makeParams({ academicGoal: 'unknown_goal_code' }),
      );

      const args = lastPromptArgs();
      expect(args.count).toBe(5);
      expect(args.difficulty).toBe(3);
      expect(args.bloomLevel).toBe('understand');

      expect(result.metadata.useGoalAwareSelection).toBe(true);
      // Unknown code resolves to null profile → goalCode stays null.
      expect(result.metadata.goalCode).toBeNull();
      expect(result.metadata.quizParamsRationale).toBeNull();
    });
  });

  describe('Test 7: structured params_chosen log fires once with PII-free payload', () => {
    it('logs exactly once per invocation with the expected shape', async () => {
      setFlag(true);

      const { runQuizGenerateWorkflow } = await import(
        '@/lib/ai/workflows/quiz-generate'
      );
      await runQuizGenerateWorkflow(
        'algebra',
        makeParams({ academicGoal: 'board_topper' }),
      );

      const paramsChosenLogs = loggerInfo.mock.calls.filter(
        (c: unknown[]) => c[0] === 'quiz-generate.params_chosen',
      );
      expect(paramsChosenLogs.length).toBe(1);

      const found = findParamsChosenLog();
      expect(found).not.toBeNull();
      const payload = found!.payload;

      // Required fields present with the right shape.
      expect(payload.studentId).toBe('present');
      expect(payload.useGoalAwareSelection).toBe(true);
      expect(payload.goalCode).toBe('board_topper');
      expect(payload.count).toBe(15);
      expect(payload.difficulty).toBe(3);
      expect(payload.bloom).toBe('analyze');
      expect(typeof payload.rationale).toBe('string');
      expect((payload.rationale as string).length).toBeGreaterThan(0);

      // No PII may leak into this log line.
      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('phone');
      expect(payload).not.toHaveProperty('name');
      // The raw UUID MUST NOT appear — we send the presence sentinel only.
      expect(payload.studentId).not.toBe('student-uuid-1');
    });

    it('logs studentId=absent when no studentId is provided', async () => {
      setFlag(false);

      const { runQuizGenerateWorkflow } = await import(
        '@/lib/ai/workflows/quiz-generate'
      );
      await runQuizGenerateWorkflow(
        'circles',
        makeParams({ studentId: undefined }),
      );

      const found = findParamsChosenLog();
      expect(found).not.toBeNull();
      expect(found!.payload.studentId).toBe('absent');
      // legacy_defaults rationale string is the documented fallback.
      expect(found!.payload.rationale).toBe('legacy_defaults');
    });
  });
});
