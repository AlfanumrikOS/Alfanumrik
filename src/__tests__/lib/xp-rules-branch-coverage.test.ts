/**
 * xp-rules.ts — branch-coverage closeout test (P2 invariant defense)
 *
 * Why this file exists
 * --------------------
 * `vitest.config.ts:79` previously held the per-file branch threshold for
 * `src/lib/xp-rules.ts` at 75% with a TODO(assessment) note (line 74) to
 * restore it to 90% by adding tests for "the daily-cap clamp, perfect-score
 * combo, and streak-bonus edge cases." Coverage analysis on 2026-04-28
 * (commit on branch `test/xp-rules-branch-coverage`) showed:
 *
 *   xp-rules.ts | 100% stmts | 75% branches | 100% funcs | 100% lines
 *   Uncovered: line 120 — the `||` fallback in `getLevelName()`.
 *
 * The daily-cap clamp, perfect/high-score combos, and streak-bonus edges
 * the original TODO mentioned are already covered:
 *   - daily cap clamp:       src/__tests__/lib/xp-daily-cap.test.ts
 *   - high-score / perfect:  src/__tests__/xp-rules.test.ts (lines 85-103)
 *   - streak milestones:     XP_RULES constants are referenced in
 *                            src/__tests__/regression-academic-chain.test.ts
 *
 * The single residual gap is the unreachable-by-design fallback branch in
 * `getLevelName()`. This file pins it.
 *
 * P2 (XP economy) is the invariant being defended: every branch in the XP
 * surface must execute at least once so future drift (e.g. swapping a
 * `??` for `||`, or removing the early-return) is caught by the threshold.
 */

import { describe, it, expect } from 'vitest';
import { getLevelName, LEVEL_NAMES } from '@/lib/xp-rules';

describe('xp-rules.ts branch closeout — getLevelName() fallback (line 120)', () => {
  it('returns the LHS of `||` when LEVEL_NAMES[level] is defined (covers line 120 LHS)', () => {
    // Sanity: LHS branch is hit by every named level. We re-assert here to
    // make this file self-contained — if the names map is renamed or the
    // function rewritten, this test still pins the LHS path.
    for (let level = 1; level <= 9; level++) {
      expect(getLevelName(level)).toBe(LEVEL_NAMES[level]);
    }
  });

  it('returns "Level N" fallback when LEVEL_NAMES[level] is undefined (covers line 120 RHS)', () => {
    // The fallback `Level ${level}` branch is only reachable when the early
    // return `if (level >= 10)` is false AND LEVEL_NAMES[level] is undefined.
    // Names map covers 1..10, so level 0 and negative levels are the only
    // inputs that trip the RHS of the `||`.
    expect(getLevelName(0)).toBe('Level 0');
  });

  it('returns "Level N" for negative levels (RHS of ||, defensive)', () => {
    // Defensive: the function signature accepts any number. Negative inputs
    // should not crash and should produce a deterministic fallback string.
    expect(getLevelName(-1)).toBe('Level -1');
  });
});
