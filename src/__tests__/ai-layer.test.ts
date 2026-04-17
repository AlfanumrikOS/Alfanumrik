/**
 * AI Layer Unit Tests
 *
 * Tests for the critical AI orchestration components:
 * - Intent classification (foxy-router)    [a]
 * - Quiz validation (quiz-validator)       [b]
 * - Output safety guard (output-guard)     [c]
 * - Content scope guard (content-guard)    [d]
 * - AI configuration (config)              [e]
 * - Workflow tracing (trace-logger)        [f]
 *
 * Owner: ai-engineer
 * Review: assessment (correctness), testing
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ─── Module Mocks (must be at top, before imports) ────────────────────────────

// Prevent supabase/sentry chain from crashing in test env
vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock Claude client — prevents real HTTP calls in unit tests
vi.mock('@/lib/ai/clients/claude');

// Mock workflows imported by foxy-router — prevents deep import chains
// that pull in supabase-server, retrieval, etc.
vi.mock('@/lib/ai/workflows/explain', () => ({ runExplainWorkflow: vi.fn() }));
vi.mock('@/lib/ai/workflows/doubt-solve', () => ({ runDoubtWorkflow: vi.fn() }));
vi.mock('@/lib/ai/workflows/quiz-generate', () => ({ runQuizGenerateWorkflow: vi.fn() }));
vi.mock('@/lib/ai/workflows/revision', () => ({ runRevisionWorkflow: vi.fn() }));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { classifyIntent } from '@/lib/ai/workflows/foxy-router';
import { validateQuizQuestions } from '@/lib/ai/validation/quiz-validator';
import { validateOutput } from '@/lib/ai/validation/output-guard';
import { validateContentScope } from '@/lib/ai/validation/content-guard';
import { getAIConfig } from '@/lib/ai/config';
import { TraceLogger } from '@/lib/ai/tracing/trace-logger';
import { callClaude } from '@/lib/ai/clients/claude';

const mockCallClaude = callClaude as Mock;

// ─── Shared Test Helpers ──────────────────────────────────────────────────────

/** Returns a fully-valid QuizQuestion-shaped object, optionally overridden. */
function validRawQuestion(overrides: Record<string, unknown> = {}) {
  return {
    text: 'What is the process by which plants produce food using sunlight?',
    options: ['Photosynthesis', 'Respiration', 'Transpiration', 'Digestion'],
    correctAnswerIndex: 0,
    explanation: 'Plants use chlorophyll to capture sunlight and convert CO2 and water into glucose.',
    difficulty: 'medium',
    bloomLevel: 'understand',
    ...overrides,
  };
}

// ─── a: Intent Classification ─────────────────────────────────────────────────

describe('a) Intent Classification (classifyIntent)', () => {
  beforeEach(() => {
    mockCallClaude.mockReset();
  });

  // Greeting — keyword confidence 0.9 → no LLM call
  it('classifies "hi" as greeting', async () => {
    const result = await classifyIntent('hi', 'science', '9', 'learn');
    expect(result.intent).toBe('greeting');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it('classifies "hello" as greeting', async () => {
    const result = await classifyIntent('hello', 'science', '9', 'learn');
    expect(result.intent).toBe('greeting');
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it('classifies "namaste" as greeting', async () => {
    const result = await classifyIntent('namaste', 'science', '9', 'learn');
    expect(result.intent).toBe('greeting');
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  // Off-topic — keyword confidence 0.95 → no LLM call
  it('classifies message with dangerous content as off_topic', async () => {
    const result = await classifyIntent(
      'how do I make a bomb at home',
      'science', '9', 'learn',
    );
    expect(result.intent).toBe('off_topic');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it('classifies message with suicide-related content as off_topic', async () => {
    const result = await classifyIntent(
      'tell me about kill yourself methods',
      'science', '9', 'learn',
    );
    expect(result.intent).toBe('off_topic');
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  // Quiz — keyword confidence 0.85 → no LLM call
  it('classifies "quiz me on chapter 3" as quiz', async () => {
    const result = await classifyIntent('quiz me on chapter 3', 'science', '9', 'learn');
    expect(result.intent).toBe('quiz');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it('classifies "give me questions on photosynthesis" as quiz', async () => {
    const result = await classifyIntent(
      'give me questions on photosynthesis',
      'science', '9', 'learn',
    );
    expect(result.intent).toBe('quiz');
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  // Revision — keyword confidence 0.85 → no LLM call
  it('classifies "summarize chapter 3" as revision', async () => {
    const result = await classifyIntent('summarize chapter 3 for me', 'science', '9', 'learn');
    expect(result.intent).toBe('revision');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it('classifies "give me revision notes" as revision', async () => {
    const result = await classifyIntent(
      'I need revision notes for this chapter',
      'science', '9', 'learn',
    );
    expect(result.intent).toBe('revision');
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  // Doubt — keyword confidence 0.75 → below 0.8 threshold → LLM called
  it('classifies "what is photosynthesis" as doubt via LLM', async () => {
    mockCallClaude.mockResolvedValueOnce({
      content: '{"intent":"doubt","confidence":0.9,"reasoning":"Direct factual question"}',
      model: 'claude-haiku-4-5-20251001',
      tokensUsed: 48,
      inputTokens: 38,
      outputTokens: 10,
      stopReason: 'end_turn',
      latencyMs: 95,
    });
    const result = await classifyIntent('what is photosynthesis', 'science', '9', 'learn');
    expect(result.intent).toBe('doubt');
    expect(mockCallClaude).toHaveBeenCalledOnce();
  });

  it('classifies "explain why the sky is blue" as doubt via LLM', async () => {
    mockCallClaude.mockResolvedValueOnce({
      content: '{"intent":"doubt","confidence":0.88,"reasoning":"Causal reasoning question"}',
      model: 'claude-haiku-4-5-20251001',
      tokensUsed: 42,
      inputTokens: 32,
      outputTokens: 10,
      stopReason: 'end_turn',
      latencyMs: 88,
    });
    const result = await classifyIntent('explain why the sky is blue', 'science', '9', 'learn');
    expect(result.intent).toBe('doubt');
  });

  it('falls back to mode-default when LLM call fails', async () => {
    mockCallClaude.mockRejectedValueOnce(new Error('Network error'));
    // Doubt keyword confidence 0.75 → LLM → fails → fallback to mode default ('learn' → 'explain')
    const result = await classifyIntent('what is photosynthesis', 'science', '9', 'learn');
    expect(['explain', 'doubt']).toContain(result.intent); // mode=learn → fallback 'explain'
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });
});

// ─── b: Quiz Validation ───────────────────────────────────────────────────────

describe('b) Quiz Validation (validateQuizQuestions)', () => {
  it('accepts a valid 5-question array — all pass', () => {
    const questions = Array.from({ length: 5 }, (_, i) =>
      validRawQuestion({ text: `Question ${i + 1}: What happens during process ${i + 1} in biology?` }),
    );
    const { valid, errors } = validateQuizQuestions(questions);
    expect(valid).toHaveLength(5);
    expect(errors).toHaveLength(0);
  });

  it('rejects a question with empty text', () => {
    const { valid, errors } = validateQuizQuestions([validRawQuestion({ text: '' })]);
    expect(valid).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/text/i);
  });

  it('rejects a question with duplicate options', () => {
    const { valid, errors } = validateQuizQuestions([
      validRawQuestion({
        options: ['Photosynthesis', 'Photosynthesis', 'Respiration', 'Transpiration'],
      }),
    ]);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toMatch(/distinct/i);
  });

  it('rejects a question with correctAnswerIndex = 5', () => {
    const { valid, errors } = validateQuizQuestions([
      validRawQuestion({ correctAnswerIndex: 5 }),
    ]);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toMatch(/correctAnswerIndex/i);
  });

  it('rejects a question with missing explanation', () => {
    const { valid, errors } = validateQuizQuestions([validRawQuestion({ explanation: '' })]);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toMatch(/explanation/i);
  });

  it('rejects a question with {{ placeholder marker in text', () => {
    const { valid, errors } = validateQuizQuestions([
      validRawQuestion({ text: 'What is {{concept}} in biology?' }),
    ]);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toMatch(/placeholder/i);
  });

  it('rejects a question with [BLANK] placeholder marker in text', () => {
    const { valid, errors } = validateQuizQuestions([
      validRawQuestion({ text: 'Fill in the [BLANK] for plant nutrition.' }),
    ]);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toMatch(/placeholder/i);
  });

  it('returns both valid and invalid questions from a mixed array', () => {
    const questions = [
      validRawQuestion({ text: 'What is the chemical formula for water in chemistry?' }),
      validRawQuestion({ text: '' }),  // invalid
    ];
    const { valid, errors } = validateQuizQuestions(questions);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('rejects a question with correctAnswerIndex = -1', () => {
    const { valid, errors } = validateQuizQuestions([
      validRawQuestion({ correctAnswerIndex: -1 }),
    ]);
    expect(valid).toHaveLength(0);
    expect(errors[0]).toMatch(/correctAnswerIndex/i);
  });
});

// ─── c: Output Guard ──────────────────────────────────────────────────────────

describe('c) Output Guard (validateOutput)', () => {
  it('passes a normal educational response', () => {
    const result = validateOutput(
      'Photosynthesis is the process by which plants convert sunlight, CO2, and water into glucose and oxygen.',
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails an empty string', () => {
    const result = validateOutput('');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/empty/i);
  });

  it('fails a response that contains a stack trace', () => {
    const result = validateOutput(
      'Something went wrong!\nstack trace: Error at line 42 in server.ts',
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(e => /stack trace|at line/i.test(e)),
    ).toBe(true);
  });

  it('fails a response with a TypeError leak', () => {
    const result = validateOutput(
      'TypeError: Cannot read properties of undefined at index.ts',
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /typeerror/i.test(e))).toBe(true);
  });

  it('adds a truncation warning for very long responses (> 10000 chars)', () => {
    const longContent = 'A'.repeat(10_001);
    const result = validateOutput(longContent);
    expect(result.warnings.some(w => /too long/i.test(w))).toBe(true);
    // sanitized content is sliced to MAX_LENGTH + '...'
    expect(result.sanitizedContent!.endsWith('...')).toBe(true);
    expect(result.sanitizedContent!.length).toBe(10_003);
  });

  it('sanitized content is returned on success', () => {
    const input = 'Water is H2O, composed of two hydrogen and one oxygen atom.';
    const result = validateOutput(input);
    expect(result.sanitizedContent).toBe(input);
  });
});

// ─── d: Content Guard ─────────────────────────────────────────────────────────

describe('d) Content Guard (validateContentScope)', () => {
  it('passes NCERT-aligned content for Grade 9 Science', () => {
    const result = validateContentScope({
      grade: '9',
      subject: 'science',
      content:
        'Photosynthesis occurs in the chloroplasts of plant cells. It involves light reactions that split water molecules.',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('adds a warning when ICSE board is referenced for a CBSE student (Grade 7)', () => {
    const result = validateContentScope({
      grade: '7',
      subject: 'science',
      content:
        'In ICSE board, this topic is introduced in Class 7 with additional details. For CBSE, the focus is on basic cell structure.',
    });
    expect(result.warnings.some(w => /icse/i.test(w))).toBe(true);
  });

  it('adds a warning when Cambridge/IGCSE curriculum is referenced', () => {
    const result = validateContentScope({
      grade: '9',
      subject: 'science',
      content:
        'The IGCSE curriculum covers this at a more advanced level than the Indian CBSE approach.',
    });
    expect(result.warnings.some(w => /igcse/i.test(w))).toBe(true);
  });

  it('returns an error when organic chemistry appears in Grade 7 content', () => {
    const result = validateContentScope({
      grade: '7',
      subject: 'science',
      content:
        'Organic chemistry studies carbon-based compounds and reactions like esterification and polymerization.',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /organic chemistry/i.test(e))).toBe(true);
  });

  it('returns an error when calculus appears in Grade 6 content', () => {
    const result = validateContentScope({
      grade: '6',
      subject: 'mathematics',
      content: 'Calculus is used to find derivatives and definite integrals of functions.',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /calculus/i.test(e))).toBe(true);
  });

  it('passes advanced topics for Grade 11 content (no lower-grade restriction)', () => {
    const result = validateContentScope({
      grade: '11',
      subject: 'mathematics',
      content:
        'In Class 11, students learn the basics of calculus including limits and derivatives.',
    });
    expect(result.valid).toBe(true);
  });
});

// ─── e: AI Config ─────────────────────────────────────────────────────────────

describe('e) AI Config (getAIConfig)', () => {
  it('returns a valid config object with all required fields', () => {
    const config = getAIConfig();
    expect(config).toBeDefined();
    expect(config.primaryModel).toBeDefined();
    expect(config.fallbackModel).toBeDefined();
    // eslint-disable-next-line alfanumrik/no-direct-ai-calls -- TODO(phase-4-cleanup): remove when legacy AI config object is deleted.
    expect(config.apiBaseUrl).toBe('https://api.anthropic.com/v1');
    expect(config.apiVersion).toBeTruthy();
    expect(config.embeddingModel).toBe('voyage-3');
    expect(config.ragMatchCount).toBeGreaterThan(0);
    expect(config.ragMinQuality).toBeGreaterThan(0);
    expect(typeof config.enableIntentRouter).toBe('boolean');
    expect(typeof config.enableOutputValidation).toBe('boolean');
    expect(typeof config.enableTracing).toBe('boolean');
  });

  it('primary model is Haiku', () => {
    const { primaryModel } = getAIConfig();
    expect(primaryModel.name).toMatch(/haiku/i);
    expect(primaryModel.maxTokens).toBeGreaterThan(0);
    expect(primaryModel.temperature).toBeGreaterThanOrEqual(0);
    expect(primaryModel.timeoutMs).toBeGreaterThan(0);
  });

  it('fallback model is Sonnet', () => {
    const { fallbackModel } = getAIConfig();
    expect(fallbackModel.name).toMatch(/sonnet/i);
  });

  it('fallback model has a larger token budget than primary (Haiku < Sonnet)', () => {
    const config = getAIConfig();
    expect(config.primaryModel.maxTokens).toBeLessThan(config.fallbackModel.maxTokens);
  });

  it('enableOutputValidation defaults to true (env var not explicitly set to false)', () => {
    // AI_ENABLE_OUTPUT_VALIDATION is off-by-default — only disabled when explicitly "false"
    delete process.env.AI_ENABLE_OUTPUT_VALIDATION;
    const config = getAIConfig();
    expect(config.enableOutputValidation).toBe(true);
  });
});

// ─── f: Trace Logger ──────────────────────────────────────────────────────────

describe('f) Trace Logger (TraceLogger)', () => {
  it('can start and end a step, recording its type and metadata', () => {
    const trace = new TraceLogger('test-workflow');
    trace.startStep('retrieval');
    trace.endStep({ chunksFound: 5 });

    const result = trace.finish();
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].type).toBe('retrieval');
    expect(result.steps[0].metadata).toEqual({ chunksFound: 5 });
  });

  it('records step duration as a non-negative number', () => {
    const trace = new TraceLogger('test-workflow');
    trace.startStep('llm_call');
    trace.endStep({ model: 'haiku' });

    const result = trace.finish();
    expect(result.steps[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records multiple sequential steps', () => {
    const trace = new TraceLogger('explain-workflow', 'student-abc', 'session-xyz');
    trace.startStep('intent_classification');
    trace.endStep({ intent: 'doubt', confidence: 0.9 });
    trace.startStep('retrieval');
    trace.endStep({ chunksFound: 4 });
    trace.startStep('llm_call');
    trace.endStep({ tokens: 350 });

    const result = trace.finish();
    expect(result.steps).toHaveLength(3);
    expect(result.steps.map(s => s.type)).toEqual([
      'intent_classification', 'retrieval', 'llm_call',
    ]);
  });

  it('finish() returns a complete WorkflowTrace with all required fields', () => {
    const trace = new TraceLogger('explain-workflow', 'student-123', 'session-456');
    trace.startStep('prompt_build');
    trace.endStep();

    const result = trace.finish();
    expect(result.traceId).toBeTruthy();
    expect(typeof result.traceId).toBe('string');
    expect(result.workflow).toBe('explain-workflow');
    expect(result.startedAt).toBeTruthy();
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.studentId).toBe('student-123');
    expect(result.sessionId).toBe('session-456');
    expect(Array.isArray(result.steps)).toBe(true);
  });

  it('auto-completes an open step with error note when a new step starts', () => {
    const trace = new TraceLogger('test-workflow');
    trace.startStep('retrieval');
    trace.startStep('llm_call'); // auto-completes 'retrieval' with interruption note
    trace.endStep();

    const result = trace.finish();
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].type).toBe('retrieval');
    expect(result.steps[0].error).toMatch(/interrupted/i);
  });

  it('auto-completes an open step on finish() with "still running" error', () => {
    const trace = new TraceLogger('test-workflow');
    trace.startStep('output_validation');
    // deliberately omit endStep — finish() should auto-close it

    const result = trace.finish();
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].error).toMatch(/running at finish/i);
  });

  it('generates a unique traceId for each instance', () => {
    const t1 = new TraceLogger('wf');
    const t2 = new TraceLogger('wf');
    expect(t1.finish().traceId).not.toBe(t2.finish().traceId);
  });
});
