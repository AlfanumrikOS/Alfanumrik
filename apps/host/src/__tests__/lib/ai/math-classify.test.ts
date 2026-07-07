import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GUARD #1 — Foxy Math-Solve CLASSIFIER (Part 1C).
 *
 * `classifyMathSolve(message, subject, grade)` is the trigger for the 3-agent
 * math pipeline. It is the FIRST gate, so a false positive sends a conceptual
 * question into the SymPy-verified solver (wrong tool) and a false negative
 * just falls back to the grounded path (safe). The BINDING assessment contract
 * is therefore: be PRECISE on concrete solves, and FAIL OPEN (isMathSolve:
 * false) on anything conceptual, under-specified, a proof, or ambiguous (P12 —
 * the grounded path is always the safe default).
 *
 * Binding cases (verbatim from the assessment list):
 *   - "add 1/2 + 3/4"                  -> isMathSolve: true   (concrete operands + operator)
 *   - "explain how to add fractions"   -> false               (conceptual / how-to)
 *   - word problem with all quantities -> true                (concrete instance)
 *   - under-specified ("solve this triangle") -> false        (no concrete number)
 *   - "prove that ..."                 -> false               (proof, not a solve)
 *   - low-confidence / ambiguous       -> fail-open (false)
 *
 * Mocking strategy (testing-agent rule 2 — mock the Claude CLIENT, not the
 * business logic): the deterministic branches NEVER call Claude, so we assert
 * they resolve WITHOUT touching the mock. Only the ambiguous "compute verb but
 * no concrete number" branch reaches the LLM; we drive that mock per-test and
 * assert it fails open on error / non-true verdicts.
 */

const _callClaude = vi.fn();
vi.mock('@alfanumrik/lib/ai/clients/claude', () => ({
  callClaude: (...args: unknown[]) => _callClaude(...args),
}));

// The ambiguous LLM branch in classifyMathSolveWithLLM calls callReasoningModel
// (from reasoning-cascade), NOT callClaude directly. Mock it so tests are
// hermetic even when OPENAI_API_KEY is present in the local .env.local.
const _callReasoningModel = vi.fn();
vi.mock('@alfanumrik/lib/ai/clients/reasoning-cascade', () => ({
  callReasoningModel: (...args: unknown[]) => _callReasoningModel(...args),
}));

import { classifyMathSolve } from '@alfanumrik/lib/ai/workflows/foxy-router';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: if the LLM is reached at all and the test didn't set it up,
  // make it throw so any accidental reliance on Claude fails open (false)
  // rather than silently passing.
  _callClaude.mockRejectedValue(new Error('LLM should not be called for this case'));
  _callReasoningModel.mockRejectedValue(new Error('LLM should not be called for this case'));
});

describe('GUARD #1 — classifyMathSolve: deterministic POSITIVE (concrete solve)', () => {
  it('"add 1/2 + 3/4" → isMathSolve true (concrete fraction arithmetic, NO LLM call)', async () => {
    const r = await classifyMathSolve('add 1/2 + 3/4', 'math', '6');
    expect(r.isMathSolve).toBe(true);
    expect(_callClaude).not.toHaveBeenCalled();
  });

  it('a bare arithmetic expression "12 * 4" → true without an LLM round-trip', async () => {
    const r = await classifyMathSolve('12 * 4', 'math', '6');
    expect(r.isMathSolve).toBe(true);
    expect(_callClaude).not.toHaveBeenCalled();
  });

  it('an equation to solve "solve x^2 - 5x + 6 = 0" → true (equation signal)', async () => {
    const r = await classifyMathSolve('solve x^2 - 5x + 6 = 0', 'math', '10');
    expect(r.isMathSolve).toBe(true);
    expect(_callClaude).not.toHaveBeenCalled();
  });

  it('word problem with ALL quantities present → true (compute verb + concrete number)', async () => {
    const r = await classifyMathSolve(
      'A train travels 240 km in 4 hours. Find the average speed.',
      'physics',
      '9',
    );
    expect(r.isMathSolve).toBe(true);
    // Compute-verb + concrete-number is a deterministic positive — no LLM.
    expect(_callClaude).not.toHaveBeenCalled();
  });

  it('"calculate the area of a circle of radius 7" → true (compute verb + number)', async () => {
    const r = await classifyMathSolve('calculate the area of a circle of radius 7', 'math', '10');
    expect(r.isMathSolve).toBe(true);
    expect(_callClaude).not.toHaveBeenCalled();
  });
});

describe('GUARD #1 — classifyMathSolve: deterministic NEGATIVE (conceptual / proof / under-specified)', () => {
  it('"explain how to add fractions" → false (conceptual how-to dominates, NO LLM)', async () => {
    const r = await classifyMathSolve('explain how to add fractions', 'math', '6');
    expect(r.isMathSolve).toBe(false);
    expect(_callClaude).not.toHaveBeenCalled();
  });

  it('"what is a quadratic equation" → false (definition question)', async () => {
    const r = await classifyMathSolve('what is a quadratic equation', 'math', '10');
    expect(r.isMathSolve).toBe(false);
    expect(_callClaude).not.toHaveBeenCalled();
  });

  it('"prove that root 2 is irrational" → false (proof, not a single-value solve)', async () => {
    const r = await classifyMathSolve('prove that root 2 is irrational', 'math', '10');
    expect(r.isMathSolve).toBe(false);
    expect(_callClaude).not.toHaveBeenCalled();
  });

  it('under-specified "solve this triangle" → false (compute verb, NO concrete number, LLM fails open)', async () => {
    // This is the ONE branch that consults the LLM (compute verb + no number).
    // With the default mock REJECTING, it must fail open to false.
    const r = await classifyMathSolve('solve this triangle', 'math', '10');
    expect(r.isMathSolve).toBe(false);
  });

  it('a clearly non-STEM subject (english) never enters the pipeline even with numbers', async () => {
    const r = await classifyMathSolve('add 1/2 + 3/4', 'english', '8');
    expect(r.isMathSolve).toBe(false);
    expect(_callClaude).not.toHaveBeenCalled();
  });

  it('empty / whitespace message → false', async () => {
    expect((await classifyMathSolve('', 'math', '6')).isMathSolve).toBe(false);
    expect((await classifyMathSolve('   ', 'math', '6')).isMathSolve).toBe(false);
    expect(_callClaude).not.toHaveBeenCalled();
  });
});

describe('GUARD #1 — classifyMathSolve: ambiguous branch FAILS OPEN (P12 safe default)', () => {
  it('LLM error on the ambiguous branch → fail open (false)', async () => {
    _callReasoningModel.mockRejectedValueOnce(new Error('circuit open'));
    const r = await classifyMathSolve('solve this', 'math', '10');
    expect(r.isMathSolve).toBe(false);
  });

  it('LLM returns isMathSolve:false → false', async () => {
    _callReasoningModel.mockResolvedValueOnce({
      content: '{"isMathSolve": false}',
      model: 'gpt-4o-mini',
      tokensUsed: 10,
      tier: 'base',
    });
    const r = await classifyMathSolve('find the value', 'math', '10');
    expect(r.isMathSolve).toBe(false);
  });

  it('LLM returns malformed / non-JSON → fail open (false), never throws', async () => {
    _callReasoningModel.mockResolvedValueOnce({ content: 'not json at all', model: 'x', tokensUsed: 0, tier: 'base' });
    const r = await classifyMathSolve('compute it', 'math', '10');
    expect(r.isMathSolve).toBe(false);
  });

  it('LLM returns a non-boolean isMathSolve (e.g. "maybe") → false (only explicit true passes)', async () => {
    _callReasoningModel.mockResolvedValueOnce({
      content: '{"isMathSolve": "maybe"}',
      model: 'x',
      tokensUsed: 0,
      tier: 'base',
    });
    const r = await classifyMathSolve('solve it', 'math', '10');
    expect(r.isMathSolve).toBe(false);
  });

  it('LLM returns isMathSolve:true with a difficulty → true + carries the difficulty hint', async () => {
    _callReasoningModel.mockResolvedValueOnce({
      content: '{"isMathSolve": true, "topic": "quadratics", "difficulty": "medium"}',
      model: 'x',
      tokensUsed: 0,
      tier: 'base',
    });
    const r = await classifyMathSolve('solve the equation from before', 'math', '10');
    expect(r.isMathSolve).toBe(true);
    expect(r.difficulty).toBe('medium');
    expect(r.topic).toBe('quadratics');
  });

  it('classifyMathSolve NEVER throws on any input shape', async () => {
    _callReasoningModel.mockRejectedValue(new Error('boom'));
    await expect(classifyMathSolve('solve please', 'math', '10')).resolves.toBeDefined();
    await expect(classifyMathSolve('???', '', '')).resolves.toBeDefined();
  });
});
