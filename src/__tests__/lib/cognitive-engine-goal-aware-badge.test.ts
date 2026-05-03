/**
 * Tests for the goal-aware mastery DISPLAY badge wrapper added to
 * `src/lib/cognitive-engine.ts` in Phase 2 / Layer 4.
 *
 * Owner: assessment
 * Founder constraint: this test exists specifically to PROVE that:
 *   1. The legacy default (useGoalAwareSelection !== true) is byte-identical
 *      to the historical 0.8 / 0.4 thresholds.
 *   2. The goal-aware branch reads from goal-profile.ts via mastery-display.ts.
 *   3. NO existing exported function in cognitive-engine.ts had its behavior
 *      modified — only one new exported function was appended.
 *
 * The "no diff in legacy outputs" smoke test pins
 * `getHighestMasteredBloom` and `updateBloomMastery` (canonical existing
 * mastery-related exports) so that any accidental mutation in a future PR
 * trips a regression here.
 */

import { describe, it, expect } from 'vitest';
import {
  getMasteryDisplayBadge,
  getHighestMasteredBloom,
  updateBloomMastery,
  type BloomMastery,
} from '@/lib/cognitive-engine';

describe('getMasteryDisplayBadge — legacy default (flag OFF)', () => {
  it("returns 'mastered' at >= 0.8 with threshold 0.8 and isGoalAware=false", () => {
    const out = getMasteryDisplayBadge(0.8, null);
    expect(out).toEqual({ state: 'mastered', threshold: 0.8, isGoalAware: false });
  });

  it("returns 'developing' at 0.4 with threshold 0.8 and isGoalAware=false", () => {
    const out = getMasteryDisplayBadge(0.4, null);
    expect(out).toEqual({ state: 'developing', threshold: 0.8, isGoalAware: false });
  });

  it("returns 'building' below 0.4 with threshold 0.8 and isGoalAware=false", () => {
    const out = getMasteryDisplayBadge(0.39, null);
    expect(out).toEqual({ state: 'building', threshold: 0.8, isGoalAware: false });
  });

  it('IGNORES the goal argument when useGoalAwareSelection !== true', () => {
    // olympiad would normally use threshold 0.9; legacy must ignore it.
    const out = getMasteryDisplayBadge(0.85, 'olympiad');
    expect(out).toEqual({ state: 'mastered', threshold: 0.8, isGoalAware: false });
  });

  it('treats explicit useGoalAwareSelection: false as legacy', () => {
    const out = getMasteryDisplayBadge(0.85, 'olympiad', { useGoalAwareSelection: false });
    expect(out).toEqual({ state: 'mastered', threshold: 0.8, isGoalAware: false });
  });
});

describe('getMasteryDisplayBadge — goal-aware branch (flag ON)', () => {
  it('uses olympiad threshold 0.9 — 0.85 is now developing, not mastered', () => {
    const out = getMasteryDisplayBadge(0.85, 'olympiad', { useGoalAwareSelection: true });
    expect(out.threshold).toBe(0.9);
    expect(out.isGoalAware).toBe(true);
    expect(out.state).toBe('developing');
  });

  it("returns 'mastered' for olympiad at exactly 0.9", () => {
    const out = getMasteryDisplayBadge(0.9, 'olympiad', { useGoalAwareSelection: true });
    expect(out.state).toBe('mastered');
    expect(out.threshold).toBe(0.9);
    expect(out.isGoalAware).toBe(true);
  });

  it('uses improve_basics threshold 0.6 — 0.65 is mastered (would be developing in legacy)', () => {
    const out = getMasteryDisplayBadge(0.65, 'improve_basics', { useGoalAwareSelection: true });
    expect(out.threshold).toBe(0.6);
    expect(out.isGoalAware).toBe(true);
    expect(out.state).toBe('mastered');
  });

  it('falls back to legacy 0.8 threshold when flag is ON but goal is null', () => {
    const out = getMasteryDisplayBadge(0.8, null, { useGoalAwareSelection: true });
    expect(out.threshold).toBe(0.8);
    expect(out.isGoalAware).toBe(true);
    expect(out.state).toBe('mastered');
  });

  it('falls back to legacy 0.8 threshold when flag is ON but goal is undefined', () => {
    const out = getMasteryDisplayBadge(0.5, undefined, { useGoalAwareSelection: true });
    expect(out.threshold).toBe(0.8);
    expect(out.isGoalAware).toBe(true);
    expect(out.state).toBe('developing'); // 0.5 >= 0.4 (half of 0.8)
  });
});

describe('cognitive-engine — legacy mastery exports unchanged (no-diff smoke test)', () => {
  // These pinned outputs prove existing behavior was NOT modified.
  // If a future PR changes getHighestMasteredBloom or updateBloomMastery,
  // this test trips and the founder's "do not touch existing" guard catches it.

  it('getHighestMasteredBloom returns the highest level with mastery >= 0.7', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.9, attempts: 10, correct: 9 },
      { bloomLevel: 'understand', mastery: 0.8, attempts: 10, correct: 8 },
      { bloomLevel: 'apply', mastery: 0.7, attempts: 10, correct: 7 },
      { bloomLevel: 'analyze', mastery: 0.6, attempts: 10, correct: 6 }, // below 0.7
    ];
    expect(getHighestMasteredBloom(masteries)).toBe('apply');
  });

  it('getHighestMasteredBloom returns "remember" when nothing meets the 0.7 cutoff', () => {
    const masteries: BloomMastery[] = [
      { bloomLevel: 'remember', mastery: 0.5, attempts: 4, correct: 2 },
    ];
    expect(getHighestMasteredBloom(masteries)).toBe('remember');
  });

  it('updateBloomMastery applies the legacy 0.15 EMA weight on a correct answer', () => {
    const before: BloomMastery = {
      bloomLevel: 'apply',
      mastery: 0.5,
      attempts: 4,
      correct: 2,
    };
    const after = updateBloomMastery(before, true);
    // EMA with weight 0.15: new = 0.5 + 0.15 * (1 - 0.5) = 0.575
    expect(after.mastery).toBeCloseTo(0.575, 5);
    expect(after.attempts).toBe(5);
    expect(after.correct).toBe(3);
  });

  it('updateBloomMastery applies the legacy 0.15 EMA weight on an incorrect answer', () => {
    const before: BloomMastery = {
      bloomLevel: 'apply',
      mastery: 0.5,
      attempts: 4,
      correct: 2,
    };
    const after = updateBloomMastery(before, false);
    // EMA with weight 0.15: new = 0.5 + 0.15 * (0 - 0.5) = 0.425
    expect(after.mastery).toBeCloseTo(0.425, 5);
    expect(after.attempts).toBe(5);
    expect(after.correct).toBe(2);
  });
});
