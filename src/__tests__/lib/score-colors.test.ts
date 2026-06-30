import { describe, it, expect } from 'vitest';
import { getScoreColor } from '@/lib/score-colors';
import { getScoreColor as getScoreColorReExport } from '@/components/score/ScoreCard';

/**
 * Pins the shared Performance-Score color bands (Alfa Momentum Wave 4b de-dup).
 *
 * `getScoreColor` was extracted into `src/lib/score-colors.ts` as the SINGLE
 * source of truth, consumed by ScoreCard, ScoreHero, and the leaderboard page.
 * This test locks:
 *   1. The four band THRESHOLDS (90 / 75 / 50 / 35) — byte-identical to the
 *      pre-extraction helpers (presentation-preserving refactor).
 *   2. The boundary behaviour at each threshold (>= is inclusive).
 *   3. That the returned values are CSS-var design tokens, NOT 6-digit brand
 *      hex (the Wave 4b token migration that lets the colors track the theme).
 *   4. The back-compat re-export from `@/components/score/ScoreCard` is the
 *      exact same function (ScoreHero historically imported it from there).
 */

const PURPLE = 'var(--purple)';     // exceptional   (>= 90)
const GREEN = 'var(--green)';       // proficient    (>= 75)
const GOLD = 'var(--gold)';         // developing    (>= 50)
const WARM = 'var(--accent-warm)';  // needs work    (>= 35)
const RED = 'var(--red)';           // at risk       (< 35)

describe('getScoreColor — band thresholds (single source of truth)', () => {
  it.each([
    // [score, expected token, band label]
    [100, PURPLE, 'perfect → exceptional'],
    [90, PURPLE, 'lower bound of exceptional (inclusive)'],
    [89, GREEN, 'just below 90 → proficient'],
    [75, GREEN, 'lower bound of proficient (inclusive)'],
    [74, GOLD, 'just below 75 → developing'],
    [50, GOLD, 'lower bound of developing (inclusive)'],
    [49, WARM, 'just below 50 → needs work'],
    [35, WARM, 'lower bound of needs work (inclusive)'],
    [34, RED, 'just below 35 → at risk'],
    [0, RED, 'zero → at risk'],
  ])('score %i returns %s (%s)', (score, expected) => {
    expect(getScoreColor(score)).toBe(expected);
  });

  it('returns CSS-var tokens, never 6-digit brand hex, across the full 0–100 range', () => {
    const SIX_DIGIT_HEX = /#[0-9a-fA-F]{6}\b/;
    for (let s = 0; s <= 100; s++) {
      const color = getScoreColor(s);
      expect(color).toMatch(/^var\(--[a-z-]+\)$/);
      expect(color).not.toMatch(SIX_DIGIT_HEX);
    }
  });

  it('only ever yields one of the five band tokens', () => {
    const allowed = new Set([PURPLE, GREEN, GOLD, WARM, RED]);
    for (let s = 0; s <= 100; s++) {
      expect(allowed.has(getScoreColor(s))).toBe(true);
    }
  });

  it('is monotonic by band — color only improves as score rises (never regresses)', () => {
    // Rank bands worst→best; the produced band index must be non-decreasing.
    const rank = [RED, WARM, GOLD, GREEN, PURPLE];
    let last = -1;
    for (let s = 0; s <= 100; s++) {
      const idx = rank.indexOf(getScoreColor(s));
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });
});

describe('getScoreColor — back-compat re-export', () => {
  it('@/components/score/ScoreCard re-exports the identical function', () => {
    expect(getScoreColorReExport).toBe(getScoreColor);
  });

  it('the re-export produces identical band results', () => {
    for (const s of [0, 34, 35, 49, 50, 74, 75, 89, 90, 100]) {
      expect(getScoreColorReExport(s)).toBe(getScoreColor(s));
    }
  });
});
