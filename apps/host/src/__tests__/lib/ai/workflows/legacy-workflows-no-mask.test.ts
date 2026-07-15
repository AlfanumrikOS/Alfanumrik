/**
 * Phase 0.1 (P12) — legacy Foxy workflows no longer mask student-facing text.
 *
 * The three legacy/fallback intent-router workflows (explain, revision,
 * doubt-solve) used to assign `validateOutput().sanitizedContent` — the `***`
 * bare-substring mask — back to the student-facing `response`. This pinned the
 * fixed behaviour end-to-end at the workflow boundary (the value that flows into
 * `persistLegacyFoxyResponse`):
 *   • SAFE model text  → served ORIGINAL and unmodified (curriculum survives).
 *   • UNSAFE model text → replaced with the clean bilingual SAFE_ABSTAIN_MESSAGE
 *     (never the raw unsafe text, never a `***`-masked string).
 *
 * Only the workflow deps are mocked; output-guard + output-screen run for real
 * (they are the units under test).
 *
 * Owner: ai-engineer. Enforces: P12 (AI Safety). Reviewer: assessment, testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SAFE_ABSTAIN_MESSAGE } from '@alfanumrik/lib/ai/validation/output-guard';

// ─── Claude — content controlled per test ───────────────────────────────────
const callClaudeMock = vi.fn();
vi.mock('@alfanumrik/lib/ai/clients/claude', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
}));

// ─── Retrieval — empty pass-through ─────────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/retrieval/ncert-retriever', () => ({
  retrieveNcertChunks: vi.fn().mockResolvedValue({
    chunks: [],
    contextText: '',
    error: null,
  }),
}));

// ─── System prompt builder — stub ───────────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/prompts/foxy-system', () => ({
  buildFoxySystemPrompt: vi.fn(() => 'STUB_SYSTEM_PROMPT'),
}));

// ─── Cognitive context — no DB ──────────────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/workflows/context-loader', () => ({
  loadWorkflowCognitiveContext: vi.fn().mockResolvedValue({
    loSkills: [],
    misconceptions: [],
  }),
}));

// ─── Config — validation ON, tracing OFF ────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/config', () => ({
  getAIConfig: () => ({ enableOutputValidation: true, enableTracing: false }),
}));

// ─── Trace logger — silent sink ─────────────────────────────────────────────
vi.mock('@alfanumrik/lib/ai/tracing/trace-logger', () => {
  class TraceLogger {
    constructor(_w: string, _s?: string, _sess?: string) {}
    startStep(_t: string): void {}
    endStep(_m?: Record<string, unknown>, _e?: string): void {}
    finish() {
      return {
        traceId: 'trace-stub',
        workflow: 'legacy',
        startedAt: '2026-07-14T00:00:00.000Z',
        totalDurationMs: 0,
        steps: [],
      };
    }
  }
  return { TraceLogger, logTrace: vi.fn() };
});

function claudeReturns(content: string) {
  callClaudeMock.mockResolvedValue({
    content,
    model: 'claude-haiku-test',
    tokensUsed: 42,
    inputTokens: 21,
    outputTokens: 21,
    stopReason: 'end_turn',
    latencyMs: 10,
  });
}

const BASE_PARAMS = {
  subject: 'science',
  grade: '9',
  board: 'CBSE',
  chapter: 'Reproduction',
  mode: 'learn',
  history: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
  studentId: 'student-uuid-1',
  sessionId: 'session-uuid-1',
};

// Safe curriculum text loaded with BLOCKLIST-substring collisions:
//   'sex' ⊂ sexual, 'ass' ⊂ class/mass/passage/assess/assertion, 'hell' ⊂ shell.
const SAFE_CURRICULUM_TEXT =
  'In sexual reproduction, pollen fertilises the ovule. ' +
  'In a class of 40 students, the mass of each object was measured. ' +
  'The outermost shell holds the valence electrons. ' +
  'Read the passage and assess the assertion carefully.';

const UNSAFE_TEXT = 'This is fucking wrong, you should kill yourself.';

const WORKFLOWS: Array<[string, string, () => Promise<any>]> = [
  ['explain', 'explain', () => import('@alfanumrik/lib/ai/workflows/explain').then((m) => m.runExplainWorkflow)],
  ['revision', 'revise', () => import('@alfanumrik/lib/ai/workflows/revision').then((m) => m.runRevisionWorkflow)],
  ['doubt-solve', 'doubt', () => import('@alfanumrik/lib/ai/workflows/doubt-solve').then((m) => m.runDoubtWorkflow)],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('legacy workflows — SAFE model text is served ORIGINAL (unmasked)', () => {
  it.each(WORKFLOWS)('%s returns the original curriculum text verbatim', async (_name, mode, loadFn) => {
    claudeReturns(SAFE_CURRICULUM_TEXT);
    const run = await loadFn();
    const result = await run('Explain reproduction in plants.', { ...BASE_PARAMS, mode });
    // No masking: the exact model text is returned.
    expect(result.response).toBe(SAFE_CURRICULUM_TEXT);
    expect(result.response).not.toContain('***');
    // Curriculum words survive verbatim.
    expect(result.response).toContain('sexual reproduction');
    expect(result.response).toContain('class');
    expect(result.response).toContain('passage');
    expect(result.response).toContain('shell');
  });
});

describe('legacy workflows — UNSAFE model text becomes the safe-abstain message', () => {
  it.each(WORKFLOWS)('%s replaces unsafe output with SAFE_ABSTAIN_MESSAGE', async (_name, mode, loadFn) => {
    claudeReturns(UNSAFE_TEXT);
    const run = await loadFn();
    const result = await run('trick prompt', { ...BASE_PARAMS, mode });
    // Never the raw unsafe text.
    expect(result.response).not.toContain('kill yourself');
    expect(result.response).not.toContain('fucking');
    // Never a masked variant either — the clean bilingual fallback is served.
    expect(result.response).not.toContain('***');
    expect(result.response).toBe(SAFE_ABSTAIN_MESSAGE);
  });
});
