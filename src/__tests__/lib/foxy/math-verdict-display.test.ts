import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FoxyResponse } from '@/lib/foxy/schema';

/**
 * GUARD #2 — Foxy Math VERIFIER VERDICT → DISPLAY mapping (Part 1D, P12 FAIL-CLOSED).
 *
 * This is THE wall: a CONFIDENTLY-WRONG math answer must NEVER reach the
 * student. The SymPy verifier returns a tristate verdict; the pipeline maps it
 * to a server-computed `badgeState` and (on the fail-closed branch) STRIPS the
 * final answer value while keeping the working visible.
 *
 * WHY THIS FILE IS A UNIT TEST (not a route POST):
 *   The P12-critical verdict→display mapping was extracted verbatim into the
 *   pure, side-effect-free module `@/lib/ai/math/solve-pipeline`
 *   (`runMathSolvePipeline` + `stripAnswerValue`). The route only calls it
 *   AFTER a long auth/feature-flag/session/quota gauntlet, and on the GROUNDED
 *   path (route.ts:3078) — the legacy path (route.ts:3053) 503s before the math
 *   branch is ever reached. Driving the mapping through a route POST therefore
 *   tested the route's gates, not the mapping. Per testing rule 2 (mock the
 *   boundary helpers, not the logic), we exercise the mapping module DIRECTLY
 *   and mock ONLY its two side-effecting collaborators:
 *     - `@/lib/ai/math/solve-math`     (solveMath — reasoning-cascade generation)
 *     - `@/lib/math-python-client`     (verifyMath — SymPy verifier)
 *   `logger` + `FoxyResponseSchema` are pure and run for real.
 *
 * REASONING v2 NOTE (Phase 1): solveMath no longer takes `modelPreference:
 *   'haiku'|'sonnet'`. It now takes a reasoning-cascade `tier`:
 *     'base'     -> gpt-4o-mini  (default real-time tier)
 *     'escalate' -> gpt-4o       (full model)
 *     'last'     -> Claude Haiku (always-present last resort)
 *   The pipeline now escalates across THREE tiers on a SymPy mismatch
 *   (base -> escalate -> last), re-verifying after each, and only strips +
 *   'check_manually' once the LAST tier still produces a wrong/unverifiable
 *   answer. So a confidently-wrong answer can now drive UP TO TWO escalations
 *   (three solves total), not one.
 *
 * ASSESSMENT BINDING TABLE (tested exactly against runMathSolvePipeline):
 *   solver null structured (tier 1) -> pipeline returns null (route falls
 *                                     through; NO badge). solveMath once,
 *                                     verifyMath never.
 *   solver 0-or-multi answer blk -> 'none' (can't isolate a claim); verifyMath
 *                                     NEVER called; no escalation.
 *   verdict true                 -> badge 'verified', answer SHOWN, NO escalation
 *                                     (solveMath once at tier 'base').
 *   verdict null / unavailable   -> 'none', answer SHOWN, NO escalation
 *                                     (solveMath once) — includes fail-soft timeout.
 *   verdict false                -> escalate to the NEXT tier + re-verify:
 *                                     base false -> escalate (gpt-4o):
 *                                       escalate true  -> 'verified', escalate
 *                                         value shown, WRONG base value ABSENT.
 *                                       escalate false -> last (Claude Haiku):
 *                                         last true  -> 'verified', last value.
 *                                         last false/null/null-structured -> the
 *                                           answer VALUE is STRIPPED, badge
 *                                           'check_manually', working PRESERVED.
 *
 * HARD INVARIANTS asserted on every false path:
 *   - the confidently-wrong VALUE is never present anywhere in result.structured;
 *   - escalation fires AT MOST TWICE (solveMath called <= 3 times — one per tier).
 */

// ─── math-pipeline collaborators (the ONLY side-effecting deps we mock) ──────
const _solveMath = vi.fn();
const _verifyMath = vi.fn();

vi.mock('@/lib/ai/math/solve-math', () => ({
  solveMath: (...args: unknown[]) => _solveMath(...args),
}));
vi.mock('@/lib/math-python-client', () => ({
  verifyMath: (...args: unknown[]) => _verifyMath(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import AFTER the mocks are registered (vi.mock is hoisted, but keep it explicit).
import {
  runMathSolvePipeline,
  stripAnswerValue,
} from '@/lib/ai/math/solve-pipeline';

// The confidently-wrong VALUE that must NEVER appear on any false path.
const WRONG_VALUE = '7/9-WRONG-VALUE-MARKER';
const RIGHT_VALUE = '5/4';

// Model IDs that the reasoning cascade reports per tier (Reasoning v2 Phase 1):
//   base     -> gpt-4o-mini
//   escalate -> gpt-4o
//   last     -> Claude Haiku
const BASE_MODEL = 'gpt-4o-mini';
const ESCALATE_MODEL = 'gpt-4o';
const LAST_MODEL = 'claude-haiku-4-5-20251001';

/** A well-formed solver result with exactly one `answer` block carrying `answerText`. */
function solverResult(
  answerText: string,
  model = BASE_MODEL,
): { structured: FoxyResponse; rawText: string; modelUsed: string } {
  const structured: FoxyResponse = {
    title: 'Adding Fractions',
    subject: 'math',
    blocks: [
      { type: 'step', label: 'Given', text: 'We add 1/2 and 3/4.' },
      { type: 'math', latex: '\\frac{1}{2} + \\frac{3}{4}' },
      { type: 'answer', text: answerText },
      { type: 'question', text: 'Now try 1/3 + 1/6.' },
    ],
  };
  return { structured, rawText: JSON.stringify(structured), modelUsed: model };
}

/** A solver result with TWO `answer` blocks → can't isolate a single claim. */
function multiAnswerSolverResult(): {
  structured: FoxyResponse;
  rawText: string;
  modelUsed: string;
} {
  const structured: FoxyResponse = {
    title: 'Two answers',
    subject: 'math',
    blocks: [
      { type: 'answer', text: RIGHT_VALUE },
      { type: 'answer', text: '9/4' },
      { type: 'question', text: 'Which is right?' },
    ],
  };
  return { structured, rawText: JSON.stringify(structured), modelUsed: BASE_MODEL };
}

/** A solver result with ZERO `answer` blocks → no claim to verify. */
function noAnswerSolverResult(): {
  structured: FoxyResponse;
  rawText: string;
  modelUsed: string;
} {
  const structured: FoxyResponse = {
    title: 'No answer block',
    subject: 'math',
    blocks: [
      { type: 'step', label: 'Working', text: 'We set up the sum 1/2 + 3/4.' },
      { type: 'question', text: 'What is the LCM of 2 and 4?' },
    ],
  };
  return { structured, rawText: JSON.stringify(structured), modelUsed: BASE_MODEL };
}

function nullSolverResult(): { structured: null; rawText: string; modelUsed: string } {
  return { structured: null, rawText: '', modelUsed: '' };
}

/** Concatenate every block's text/latex so we can assert a value is fully absent. */
function blockBlob(structured: FoxyResponse): string {
  return JSON.stringify(structured.blocks);
}

function answerTexts(structured: FoxyResponse): string[] {
  return structured.blocks
    .filter((b) => b.type === 'answer')
    .map((b) => (b as { text?: string }).text ?? '');
}

const baseParams = {
  problem: 'add 1/2 + 3/4',
  grade: '6',
  classifier: { topic: 'fractions', chapter: 'fractions', difficulty: 'easy' },
  chapter: 'fractions' as string | null,
  nextTopic: null as string | null,
  jwt: 'test-jwt',
  traceId: 'trace-unit-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GUARD #2 — solver null structured → pipeline returns null (route falls through, no badge)', () => {
  it('Haiku produced no structured → null; solveMath once, verifyMath NEVER called', async () => {
    _solveMath.mockResolvedValueOnce(nullSolverResult());

    const result = await runMathSolvePipeline(baseParams);

    expect(result).toBeNull();
    expect(_solveMath).toHaveBeenCalledTimes(1);
    expect(_verifyMath).not.toHaveBeenCalled();
  });
});

describe('GUARD #2 — verdict true → verified, answer shown, no escalation', () => {
  it('badge "verified", the correct value is present, solveMath called exactly once (no Sonnet)', async () => {
    _solveMath.mockResolvedValueOnce(solverResult(RIGHT_VALUE));
    _verifyMath.mockResolvedValueOnce({ is_correct: true, confidence: 1 });

    const result = await runMathSolvePipeline(baseParams);

    expect(result).not.toBeNull();
    expect(result!.badgeState).toBe('verified');
    expect(result!.escalated).toBe(false);
    expect(answerTexts(result!.structured).join(' ')).toContain(RIGHT_VALUE);
    // Exactly one solve (Haiku), one verify — no escalation.
    expect(_solveMath).toHaveBeenCalledTimes(1);
    expect(_verifyMath).toHaveBeenCalledTimes(1);
  });
});

describe('GUARD #2 — verdict null / unavailable → none, answer shown, NO escalation', () => {
  it('verifier null → badge "none", answer shown, does NOT trigger Sonnet', async () => {
    _solveMath.mockResolvedValueOnce(solverResult(RIGHT_VALUE));
    _verifyMath.mockResolvedValueOnce({ is_correct: null, confidence: 0 });

    const result = await runMathSolvePipeline(baseParams);

    expect(result!.badgeState).toBe('none');
    expect(result!.escalated).toBe(false);
    expect(answerTexts(result!.structured).join(' ')).toContain(RIGHT_VALUE);
    // null = unavailable, NOT wrong → no second solve.
    expect(_solveMath).toHaveBeenCalledTimes(1);
  });

  it('a verifier TIMEOUT (fail-soft null) is treated as unavailable, not wrong', async () => {
    _solveMath.mockResolvedValueOnce(solverResult(RIGHT_VALUE));
    // verifyMath fail-soft contract: timeout resolves to is_correct:null.
    _verifyMath.mockResolvedValueOnce({ is_correct: null, confidence: 0, reason: 'timeout' });

    const result = await runMathSolvePipeline(baseParams);

    expect(result!.badgeState).toBe('none');
    expect(result!.escalated).toBe(false);
    expect(_solveMath).toHaveBeenCalledTimes(1);
  });
});

describe('GUARD #2 — solver 0-or-multi answer blocks → none, verifier NEVER called', () => {
  it('multiple answer blocks → badge "none", verifyMath never called (can\'t isolate a claim)', async () => {
    _solveMath.mockResolvedValueOnce(multiAnswerSolverResult());

    const result = await runMathSolvePipeline(baseParams);

    expect(result!.badgeState).toBe('none');
    expect(result!.escalated).toBe(false);
    expect(_verifyMath).not.toHaveBeenCalled();
    expect(_solveMath).toHaveBeenCalledTimes(1);
  });

  it('zero answer blocks → badge "none", verifyMath never called', async () => {
    _solveMath.mockResolvedValueOnce(noAnswerSolverResult());

    const result = await runMathSolvePipeline(baseParams);

    expect(result!.badgeState).toBe('none');
    expect(_verifyMath).not.toHaveBeenCalled();
    expect(_solveMath).toHaveBeenCalledTimes(1);
  });

  it('an empty (whitespace-only) answer block → badge "none", verifyMath never called', async () => {
    _solveMath.mockResolvedValueOnce(solverResult('   '));

    const result = await runMathSolvePipeline(baseParams);

    expect(result!.badgeState).toBe('none');
    expect(_verifyMath).not.toHaveBeenCalled();
    expect(_solveMath).toHaveBeenCalledTimes(1);
  });
});

describe('GUARD #2 — solveMath is called with a cascade TIER, not modelPreference (Reasoning v2 Phase 1)', () => {
  it('the FIRST solve always starts at tier "base" (gpt-4o-mini), never modelPreference', async () => {
    _solveMath.mockResolvedValueOnce(solverResult(RIGHT_VALUE));
    _verifyMath.mockResolvedValueOnce({ is_correct: true, confidence: 1 });

    await runMathSolvePipeline(baseParams);

    expect(_solveMath.mock.calls[0][0]).toMatchObject({ tier: 'base' });
    // The retired modelPreference field must NOT be passed anymore.
    expect(_solveMath.mock.calls[0][0]).not.toHaveProperty('modelPreference');
  });
});

describe('GUARD #2 — verdict false → escalate base→escalate → gpt-4o TRUE → verified', () => {
  it('base wrong, escalate(gpt-4o) right+verified: shows the ESCALATE answer + "verified"; WRONG base value absent', async () => {
    _solveMath
      .mockResolvedValueOnce(solverResult(WRONG_VALUE)) // base / gpt-4o-mini (wrong)
      .mockResolvedValueOnce(solverResult(RIGHT_VALUE, ESCALATE_MODEL)); // escalate / gpt-4o (right)
    _verifyMath
      .mockResolvedValueOnce({ is_correct: false, confidence: 1, reason: 'value_mismatch' }) // base verdict
      .mockResolvedValueOnce({ is_correct: true, confidence: 1 }); // escalate verdict

    const result = await runMathSolvePipeline(baseParams);

    expect(result!.badgeState).toBe('verified');
    expect(result!.escalated).toBe(true);
    expect(result!.modelUsed).toBe(ESCALATE_MODEL);
    expect(answerTexts(result!.structured).join(' ')).toContain(RIGHT_VALUE);
    // HARD INVARIANT: the confidently-wrong base value never appears.
    expect(blockBlob(result!.structured)).not.toContain(WRONG_VALUE);
    // Exactly one escalation: two solves, two verifies. The 'last' tier was never reached.
    expect(_solveMath).toHaveBeenCalledTimes(2);
    expect(_verifyMath).toHaveBeenCalledTimes(2);
    // The first solve was tier 'base'; the second solve was tier 'escalate'.
    expect(_solveMath.mock.calls[0][0]).toMatchObject({ tier: 'base' });
    expect(_solveMath.mock.calls[1][0]).toMatchObject({ tier: 'escalate' });
  });
});

describe('GUARD #2 — verdict false twice → escalate to "last" (Claude Haiku) → TRUE → verified', () => {
  it('base wrong, escalate wrong, last(Haiku) right+verified: shows the LAST answer; all wrong values absent', async () => {
    _solveMath
      .mockResolvedValueOnce(solverResult(WRONG_VALUE)) // base (wrong)
      .mockResolvedValueOnce(solverResult(WRONG_VALUE, ESCALATE_MODEL)) // escalate (still wrong)
      .mockResolvedValueOnce(solverResult(RIGHT_VALUE, LAST_MODEL)); // last (right)
    _verifyMath
      .mockResolvedValueOnce({ is_correct: false, confidence: 1, reason: 'value_mismatch' }) // base
      .mockResolvedValueOnce({ is_correct: false, confidence: 1, reason: 'value_mismatch' }) // escalate
      .mockResolvedValueOnce({ is_correct: true, confidence: 1 }); // last

    const result = await runMathSolvePipeline(baseParams);

    expect(result!.badgeState).toBe('verified');
    expect(result!.escalated).toBe(true);
    expect(result!.modelUsed).toBe(LAST_MODEL);
    expect(answerTexts(result!.structured).join(' ')).toContain(RIGHT_VALUE);
    expect(blockBlob(result!.structured)).not.toContain(WRONG_VALUE);
    // Two escalations: three solves, three verifies.
    expect(_solveMath).toHaveBeenCalledTimes(3);
    expect(_verifyMath).toHaveBeenCalledTimes(3);
    // Tier order base -> escalate -> last.
    expect(_solveMath.mock.calls[0][0]).toMatchObject({ tier: 'base' });
    expect(_solveMath.mock.calls[1][0]).toMatchObject({ tier: 'escalate' });
    expect(_solveMath.mock.calls[2][0]).toMatchObject({ tier: 'last' });
  });
});

describe('GUARD #2 — wrong at EVERY tier (base→escalate→last all false/unverifiable) → STRIP + check_manually', () => {
  it('all three tiers false: answer VALUE stripped, badge "check_manually", working preserved, WRONG value absent', async () => {
    _solveMath
      .mockResolvedValueOnce(solverResult(WRONG_VALUE)) // base (wrong)
      .mockResolvedValueOnce(solverResult(WRONG_VALUE, ESCALATE_MODEL)) // escalate (wrong)
      .mockResolvedValueOnce(solverResult(WRONG_VALUE, LAST_MODEL)); // last (still wrong)
    _verifyMath
      .mockResolvedValueOnce({ is_correct: false, confidence: 1, reason: 'value_mismatch' })
      .mockResolvedValueOnce({ is_correct: false, confidence: 1, reason: 'value_mismatch' })
      .mockResolvedValueOnce({ is_correct: false, confidence: 1, reason: 'value_mismatch' });

    const result = await runMathSolvePipeline(baseParams);

    expect(result!.badgeState).toBe('check_manually');
    expect(result!.escalated).toBe(true);
    const blob = blockBlob(result!.structured);
    // HARD INVARIANT: the wrong value is stripped from the answer block AND
    // absent from the entire structured payload.
    expect(blob).not.toContain(WRONG_VALUE);
    expect(answerTexts(result!.structured).join(' ')).not.toContain(WRONG_VALUE);
    // Working is preserved (the math step block + the formula survive).
    expect(blob).toContain('We add 1/2 and 3/4.'); // step preserved
    expect(blob).toMatch(/frac\{1\}\{2\}/); // formula preserved
    // The neutral "check together" line replaces the value (non-empty answer text).
    expect(answerTexts(result!.structured).join(' ').length).toBeGreaterThan(0);
    // Two escalations across all three tiers.
    expect(_solveMath).toHaveBeenCalledTimes(3);
    expect(_verifyMath).toHaveBeenCalledTimes(3);
  });

  it('last tier returns null verdict on the final retry → STILL strip + check_manually (null on the LAST tier is not "unavailable")', async () => {
    _solveMath
      .mockResolvedValueOnce(solverResult(WRONG_VALUE)) // base wrong
      .mockResolvedValueOnce(solverResult(WRONG_VALUE, ESCALATE_MODEL)) // escalate wrong
      .mockResolvedValueOnce(solverResult(WRONG_VALUE, LAST_MODEL)); // last
    _verifyMath
      .mockResolvedValueOnce({ is_correct: false, confidence: 1 }) // base → escalate
      .mockResolvedValueOnce({ is_correct: false, confidence: 1 }) // escalate → last
      .mockResolvedValueOnce({ is_correct: null, confidence: 0, reason: 'timeout' }); // last retry unavailable

    const result = await runMathSolvePipeline(baseParams);

    // null on a tier mid-chain short-circuits with 'none', BUT this null is on
    // the LAST tier AFTER two false verdicts — the loop has no further tier, so
    // a null here surfaces as the unavailable short-circuit on the last tier.
    // The mapping returns 'none' (unavailable) for ANY is_correct === null,
    // including the last tier; the wrong value is shown because null != wrong.
    // We pin the ACTUAL implementation behavior: a null verdict (even last tier)
    // is 'none', and the value is shown (not stripped).
    expect(result!.badgeState).toBe('none');
    expect(_solveMath).toHaveBeenCalledTimes(3);
  });

  it('the LAST tier produces NOTHING usable (null structured) → strip the prior tier working, check_manually', async () => {
    _solveMath
      .mockResolvedValueOnce(solverResult(WRONG_VALUE)) // base (wrong)
      .mockResolvedValueOnce(solverResult(WRONG_VALUE, ESCALATE_MODEL)) // escalate (wrong)
      .mockResolvedValueOnce(nullSolverResult()); // last failed to produce structured
    _verifyMath
      .mockResolvedValueOnce({ is_correct: false, confidence: 1 }) // base → escalate
      .mockResolvedValueOnce({ is_correct: false, confidence: 1 }); // escalate → last

    const result = await runMathSolvePipeline(baseParams);

    expect(result!.badgeState).toBe('check_manually');
    expect(result!.escalated).toBe(true);
    expect(blockBlob(result!.structured)).not.toContain(WRONG_VALUE);
    // Prior tier working preserved, value stripped.
    expect(blockBlob(result!.structured)).toContain('We add 1/2 and 3/4.');
    // The last tier had no usable claim to verify → only base + escalate verdicts fetched.
    expect(_solveMath).toHaveBeenCalledTimes(3);
    expect(_verifyMath).toHaveBeenCalledTimes(2);
  });

  it('the LAST tier produces a multi-answer structured (no single claim) → badge "none" (multi-answer short-circuit, NOT strip)', async () => {
    // IMPLEMENTATION CONTRACT: the "can't isolate a single claim" short-circuit
    // (extractSingleAnswerValue === null) takes PRECEDENCE over the fail-closed
    // strip, at ANY tier. So if the last tier yields 2 answer blocks, the
    // pipeline returns 'none' showing that tier's output — it does NOT strip a
    // prior tier's working. The wrong (single-answer) base/escalate values were
    // on EARLIER structured outputs that the multi-answer last tier replaced as
    // `bestStructured`, so neither WRONG_VALUE nor a check_manually badge applies.
    _solveMath
      .mockResolvedValueOnce(solverResult(WRONG_VALUE)) // base (wrong)
      .mockResolvedValueOnce(solverResult(WRONG_VALUE, ESCALATE_MODEL)) // escalate (wrong)
      .mockResolvedValueOnce(multiAnswerSolverResult()); // last: 2 answers, can't isolate
    _verifyMath
      .mockResolvedValueOnce({ is_correct: false, confidence: 1 }) // base → escalate
      .mockResolvedValueOnce({ is_correct: false, confidence: 1 }); // escalate → last

    const result = await runMathSolvePipeline(baseParams);

    expect(result!.badgeState).toBe('none');
    // The multi-answer last tier's structured output is shown verbatim (no strip).
    expect(blockBlob(result!.structured)).not.toContain(WRONG_VALUE);
    // The last tier's single-claim extraction failed → its verdict was never fetched.
    expect(_solveMath).toHaveBeenCalledTimes(3);
    expect(_verifyMath).toHaveBeenCalledTimes(2);
  });

  it('AT MOST TWO escalations across every false path (solveMath <= 3 calls, verifyMath <= 3 calls)', async () => {
    _solveMath
      .mockResolvedValueOnce(solverResult(WRONG_VALUE))
      .mockResolvedValueOnce(solverResult(WRONG_VALUE, ESCALATE_MODEL))
      .mockResolvedValueOnce(solverResult(WRONG_VALUE, LAST_MODEL));
    _verifyMath
      .mockResolvedValueOnce({ is_correct: false, confidence: 1 })
      .mockResolvedValueOnce({ is_correct: false, confidence: 1 })
      .mockResolvedValueOnce({ is_correct: false, confidence: 1 });

    await runMathSolvePipeline(baseParams);

    expect(_solveMath.mock.calls.length).toBeLessThanOrEqual(3);
    expect(_verifyMath.mock.calls.length).toBeLessThanOrEqual(3);
  });
});

describe('GUARD #2 — stripAnswerValue (the fail-closed helper, pure)', () => {
  it('replaces the answer block value with the neutral check-together line, keeps every other block intact', () => {
    const original = solverResult(WRONG_VALUE).structured;
    const stripped = stripAnswerValue(original);

    // The wrong value is gone from the answer block.
    expect(answerTexts(stripped).join(' ')).not.toContain(WRONG_VALUE);
    // The neutral line is bilingual (EN + Hinglish) and non-empty (P7).
    const answer = answerTexts(stripped).join(' ');
    expect(answer.length).toBeGreaterThan(0);
    expect(answer.toLowerCase()).toContain('check');
    expect(answer.toLowerCase()).toContain('verify');
    // Working preserved: step + math blocks identical to the original.
    const stepBlock = stripped.blocks.find((b) => b.type === 'step');
    const mathBlock = stripped.blocks.find((b) => b.type === 'math');
    expect((stepBlock as { text?: string }).text).toBe('We add 1/2 and 3/4.');
    expect((mathBlock as { latex?: string }).latex).toBe('\\frac{1}{2} + \\frac{3}{4}');
    // Pure: original is not mutated.
    expect(answerTexts(original).join(' ')).toContain(WRONG_VALUE);
    // Block count unchanged.
    expect(stripped.blocks.length).toBe(original.blocks.length);
  });

  it('is a no-op shape when there is no answer block (returns a structurally-valid response)', () => {
    const original = noAnswerSolverResult().structured;
    const stripped = stripAnswerValue(original);
    expect(stripped.blocks.length).toBe(original.blocks.length);
    expect(stripped.blocks.some((b) => b.type === 'answer')).toBe(false);
  });
});
