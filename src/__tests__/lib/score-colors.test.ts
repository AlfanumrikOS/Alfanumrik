import { describe, it, expect } from 'vitest';
import { getScoreColor, getQuizScoreColor } from '@/lib/score-colors';
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

/**
 * Pins the quiz-percentage 3-tier color bands (Alfa Momentum Wave 6).
 *
 * `getQuizScoreColor(pct)` was added to `src/lib/score-colors.ts` and now backs
 * all three quiz-%/mastery-% color sites in `src/app/parent/reports/page.tsx`
 * (recentScore tile, quiz-history rows, Overall Mastery ring). It is a SEPARATE,
 * coarser mapping from the 5-tier Performance-Score `getScoreColor` above:
 *   raw quiz %  →  >= 80 green / >= 50 gold / else red   (3 bands)
 *   perf score  →  90 purple / 75 green / 50 gold / 35 warm / else red (5 bands)
 * This test locks:
 *   1. The two band THRESHOLDS (80 / 50), boundary-inclusive (>=).
 *   2. The returned values are CSS-var design tokens, NOT brand hex.
 *   3. The two helpers stay DISTINCT (different bands at the same input).
 */
describe('getQuizScoreColor — 3-tier quiz-% bands', () => {
  const GREEN = 'var(--green)';
  const GOLD = 'var(--gold)';
  const RED = 'var(--red)';

  it.each([
    // [pct, expected token, label]
    [100, GREEN, 'perfect → green'],
    [80, GREEN, 'lower bound of green (inclusive boundary)'],
    [79, GOLD, 'just below 80 → gold'],
    [50, GOLD, 'lower bound of gold (inclusive boundary)'],
    [49, RED, 'just below 50 → red'],
    [0, RED, 'zero → red'],
  ])('pct %i returns %s (%s)', (pct, expected) => {
    expect(getQuizScoreColor(pct)).toBe(expected);
  });

  it('only ever yields one of the three quiz-band tokens across 0–100', () => {
    const allowed = new Set([GREEN, GOLD, RED]);
    for (let p = 0; p <= 100; p++) {
      expect(allowed.has(getQuizScoreColor(p))).toBe(true);
    }
  });

  it('returns CSS-var tokens, never 6-digit brand hex, across 0–100', () => {
    const SIX_DIGIT_HEX = /#[0-9a-fA-F]{6}\b/;
    for (let p = 0; p <= 100; p++) {
      const color = getQuizScoreColor(p);
      expect(color).toMatch(/^var\(--[a-z-]+\)$/);
      expect(color).not.toMatch(SIX_DIGIT_HEX);
    }
  });

  it('is monotonic by band — color only improves as pct rises (never regresses)', () => {
    const rank = [RED, GOLD, GREEN];
    let last = -1;
    for (let p = 0; p <= 100; p++) {
      const idx = rank.indexOf(getQuizScoreColor(p));
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });
});

describe('getQuizScoreColor vs getScoreColor — distinct helpers', () => {
  it('the two helpers are different functions', () => {
    expect(getQuizScoreColor).not.toBe(getScoreColor);
  });

  it('disagree where the band granularity differs (3-tier vs 5-tier)', () => {
    // At 90: quiz → green (>=80); perf → purple (>=90). Distinct.
    expect(getQuizScoreColor(90)).toBe('var(--green)');
    expect(getScoreColor(90)).toBe('var(--purple)');

    // At 40: quiz → red (<50); perf → needs-work warm (>=35). Distinct.
    expect(getQuizScoreColor(40)).toBe('var(--red)');
    expect(getScoreColor(40)).toBe('var(--accent-warm)');

    // At 79: quiz → gold (<80); perf → green (>=75). Distinct.
    expect(getQuizScoreColor(79)).toBe('var(--gold)');
    expect(getScoreColor(79)).toBe('var(--green)');
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
