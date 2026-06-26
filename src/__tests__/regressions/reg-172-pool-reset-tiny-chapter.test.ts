/**
 * REG-172: select_quiz_questions_rag pool-reset suppressed for tiny chapters
 *
 * The 80% pool-reset previously fired whenever seen/total >= 0.80, which
 * caused an infinite cycle for chapters with <= 5 questions (5/5 = 100%).
 * Migration 20260625000200 adds MIN_POOL_FOR_RESET = 10: reset only fires
 * when total_pool >= 10 AND seen/total >= 0.80.
 *
 * Deterministic, no DB. Catalogued as REG-172 in .claude/regression-catalog.md.
 */
import { describe, it, expect } from 'vitest';

// ── Pool-reset decision replica ───────────────────────────────────────────────

const MIN_POOL_FOR_RESET = 10;

/**
 * Replicates the pool-reset decision from migration 20260625000200.
 * Returns true if the DELETE should fire (history should be reset).
 * Old guard: totalPool > 0 && seenCount / totalPool >= 0.80
 * New guard: totalPool >= MIN_POOL_FOR_RESET && seenCount / totalPool >= 0.80
 */
function shouldResetPool(totalPool: number, seenCount: number): boolean {
  return totalPool >= MIN_POOL_FOR_RESET && seenCount / totalPool >= 0.80;
}

/** The old (broken) guard that caused the infinite loop for tiny chapters. */
function oldShouldResetPool(totalPool: number, seenCount: number): boolean {
  return totalPool > 0 && seenCount / totalPool >= 0.80;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('REG-172: pool-reset guard for thin chapters', () => {
  it('REG-172-A: pool=5, seen=5 (100%) → reset suppressed (pool < 10)', () => {
    expect(shouldResetPool(5, 5)).toBe(false);
  });

  it('REG-172-B: pool=10, seen=8 (80%) → reset fires (exactly at threshold)', () => {
    expect(shouldResetPool(10, 8)).toBe(true);
  });

  it('REG-172-C: pool=15, seen=11 (73%) → reset does NOT fire (below 80%)', () => {
    expect(shouldResetPool(15, 11)).toBe(false);
  });

  it('REG-172-D: pool=10, seen=9 (90%) → reset fires', () => {
    expect(shouldResetPool(10, 9)).toBe(true);
  });

  it('REG-172-E: pool=9, seen=9 (100%) → reset suppressed (pool < 10)', () => {
    expect(shouldResetPool(9, 9)).toBe(false);
  });

  it('REG-172-F: pool=3, seen=3 (100%) → reset suppressed (tiny chapter, pool < 10)', () => {
    expect(shouldResetPool(3, 3)).toBe(false);
  });

  it('REG-172-G: pool=0, seen=0 → reset suppressed (empty chapter)', () => {
    expect(shouldResetPool(0, 0)).toBe(false);
  });

  it('REG-172-boundary: pool=10, seen=7 (70%) → reset does NOT fire (below 80%)', () => {
    expect(shouldResetPool(10, 7)).toBe(false);
  });

  it('REG-172-boundary: pool=10, seen=10 (100%) → reset fires (pool >= 10 AND >= 80%)', () => {
    expect(shouldResetPool(10, 10)).toBe(true);
  });

  it('REG-172-boundary: pool=11, seen=9 (81.8%) → reset fires', () => {
    expect(shouldResetPool(11, 9)).toBe(true);
  });

  it('REG-172-regression: old guard (> 0) would fire on pool=5, triggering infinite cycle', () => {
    // Pool=5, seen=5 (100%): old guard fires → reset → pool=5, seen=0 → next quiz
    // fetches all 5 → seen=5 again → infinite loop.
    expect(oldShouldResetPool(5, 5)).toBe(true);   // old: fires → infinite cycle
    expect(shouldResetPool(5, 5)).toBe(false);       // new: suppressed
  });

  it('REG-172-regression: old guard (> 0) would fire on pool=3', () => {
    expect(oldShouldResetPool(3, 3)).toBe(true);   // old: fires
    expect(shouldResetPool(3, 3)).toBe(false);      // new: suppressed
  });

  it('REG-172-regression: both guards agree for large pools at 80%+', () => {
    // For pool >= 10 at >= 80%, both should agree the reset fires.
    expect(oldShouldResetPool(20, 16)).toBe(true);
    expect(shouldResetPool(20, 16)).toBe(true);
  });

  it('REG-172-large pool: pool=50, seen=40 (80%) → reset fires normally', () => {
    expect(shouldResetPool(50, 40)).toBe(true);
  });
});
