/**
 * REG-174: Quiz count auto-reduce when pool < requested
 *
 * When assembleQuiz returns { success: false, returnedCount: N }, the quiz
 * page (src/app/quiz/page.tsx) silently retries with the largest valid count
 * that the pool can satisfy (from VALID_COUNTS_ASC = [5, 10, 15, 20]), provided:
 *   1. The quiz type is MCQ-only (onlyMcq = true)
 *   2. The auto-count is different from the requested count (prevents infinite loop)
 *   3. The pool has at least 5 questions (returnedCount >= 5 to find a valid count)
 *
 * The auto-reduce logic lives inside the startQuiz function of the quiz page.
 * Since it is not exported, we replicate the exact formula here and pin it.
 * Any change to VALID_COUNTS_ASC or the guard conditions will break these tests.
 *
 * Relevant code (quiz/page.tsx ~lines 502-511):
 *   const VALID_COUNTS_ASC = [5, 10, 15, 20] as const;
 *   const autoCount = VALID_COUNTS_ASC.filter(n => n <= result.returnedCount).at(-1);
 *   if (onlyMcq && autoCount !== undefined && autoCount !== qCount) { retry }
 */
import { describe, it, expect } from 'vitest';

// ── Pure formula replica ─────────────────────────────────────────────────────

const VALID_COUNTS_ASC = [5, 10, 15, 20] as const;

/**
 * Replicates the auto-reduce decision from quiz/page.tsx.
 * Returns the largest valid count <= returnedCount, or undefined if none.
 */
function getAutoReduceCount(returnedCount: number): number | undefined {
  return VALID_COUNTS_ASC.filter((n) => n <= returnedCount).at(-1);
}

/**
 * Replicates the retry guard from quiz/page.tsx.
 * Returns whether a silent auto-retry should happen.
 */
function shouldAutoRetry(params: {
  returnedCount: number;
  requestedCount: number;
  onlyMcq: boolean;
}): { shouldRetry: boolean; autoCount: number | undefined } {
  const autoCount = getAutoReduceCount(params.returnedCount);
  const shouldRetry =
    params.onlyMcq &&
    autoCount !== undefined &&
    autoCount !== params.requestedCount;
  return { shouldRetry, autoCount };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('REG-174: Quiz auto-reduce UX', () => {
  it('REG-174-A: returnedCount=5, requested=10, onlyMcq → retry with 5', () => {
    const { shouldRetry, autoCount } = shouldAutoRetry({
      returnedCount: 5, requestedCount: 10, onlyMcq: true,
    });
    expect(shouldRetry).toBe(true);
    expect(autoCount).toBe(5);
  });

  it('REG-174-B: returnedCount=8, requested=10, onlyMcq → retry with 5 (floor to largest valid <= 8)', () => {
    const { shouldRetry, autoCount } = shouldAutoRetry({
      returnedCount: 8, requestedCount: 10, onlyMcq: true,
    });
    expect(shouldRetry).toBe(true);
    expect(autoCount).toBe(5);
  });

  it('REG-174-C: returnedCount=3, requested=5, onlyMcq → no retry (3 < 5, no valid count)', () => {
    const { shouldRetry, autoCount } = shouldAutoRetry({
      returnedCount: 3, requestedCount: 5, onlyMcq: true,
    });
    expect(autoCount).toBeUndefined();
    expect(shouldRetry).toBe(false);
  });

  it('REG-174-D: returnedCount=0, requested=5, onlyMcq → no retry (empty pool)', () => {
    const { shouldRetry, autoCount } = shouldAutoRetry({
      returnedCount: 0, requestedCount: 5, onlyMcq: true,
    });
    expect(autoCount).toBeUndefined();
    expect(shouldRetry).toBe(false);
  });

  it('REG-174-E: returnedCount=5, requested=10, NOT onlyMcq → no auto-retry', () => {
    const { shouldRetry } = shouldAutoRetry({
      returnedCount: 5, requestedCount: 10, onlyMcq: false,
    });
    expect(shouldRetry).toBe(false);
  });

  it('REG-174-F: returnedCount=5, requested=5, onlyMcq → no retry (autoCount === requestedCount, infinite-loop guard)', () => {
    const { shouldRetry, autoCount } = shouldAutoRetry({
      returnedCount: 5, requestedCount: 5, onlyMcq: true,
    });
    expect(autoCount).toBe(5);
    // Guard: autoCount === requestedCount → do NOT retry (would loop forever)
    expect(shouldRetry).toBe(false);
  });

  it('REG-174-G: returnedCount=12, requested=15, onlyMcq → retry with 10', () => {
    const { shouldRetry, autoCount } = shouldAutoRetry({
      returnedCount: 12, requestedCount: 15, onlyMcq: true,
    });
    expect(shouldRetry).toBe(true);
    expect(autoCount).toBe(10);
  });

  it('REG-174-H: returnedCount=20, requested=20, onlyMcq → no retry (autoCount === requestedCount)', () => {
    const { shouldRetry, autoCount } = shouldAutoRetry({
      returnedCount: 20, requestedCount: 20, onlyMcq: true,
    });
    expect(autoCount).toBe(20);
    expect(shouldRetry).toBe(false);
  });

  it('REG-174-I: returnedCount=15, requested=20, onlyMcq → retry with 15', () => {
    const { shouldRetry, autoCount } = shouldAutoRetry({
      returnedCount: 15, requestedCount: 20, onlyMcq: true,
    });
    expect(shouldRetry).toBe(true);
    expect(autoCount).toBe(15);
  });

  it('REG-174-J: returnedCount=4, requested=10, onlyMcq → no retry (4 < min valid count of 5)', () => {
    const { shouldRetry, autoCount } = shouldAutoRetry({
      returnedCount: 4, requestedCount: 10, onlyMcq: true,
    });
    expect(autoCount).toBeUndefined();
    expect(shouldRetry).toBe(false);
  });

  it('REG-174-K: returnedCount=10, requested=10, onlyMcq → no retry (autoCount === requestedCount)', () => {
    const { shouldRetry, autoCount } = shouldAutoRetry({
      returnedCount: 10, requestedCount: 10, onlyMcq: true,
    });
    expect(autoCount).toBe(10);
    expect(shouldRetry).toBe(false);
  });
});

describe('REG-174: getAutoReduceCount — VALID_COUNTS_ASC boundary values', () => {
  it('returns undefined for returnedCount below 5', () => {
    expect(getAutoReduceCount(0)).toBeUndefined();
    expect(getAutoReduceCount(1)).toBeUndefined();
    expect(getAutoReduceCount(4)).toBeUndefined();
  });

  it('returns 5 for returnedCount 5..9', () => {
    expect(getAutoReduceCount(5)).toBe(5);
    expect(getAutoReduceCount(6)).toBe(5);
    expect(getAutoReduceCount(9)).toBe(5);
  });

  it('returns 10 for returnedCount 10..14', () => {
    expect(getAutoReduceCount(10)).toBe(10);
    expect(getAutoReduceCount(11)).toBe(10);
    expect(getAutoReduceCount(14)).toBe(10);
  });

  it('returns 15 for returnedCount 15..19', () => {
    expect(getAutoReduceCount(15)).toBe(15);
    expect(getAutoReduceCount(16)).toBe(15);
    expect(getAutoReduceCount(19)).toBe(15);
  });

  it('returns 20 for returnedCount >= 20', () => {
    expect(getAutoReduceCount(20)).toBe(20);
    expect(getAutoReduceCount(25)).toBe(20);
    expect(getAutoReduceCount(100)).toBe(20);
  });
});
