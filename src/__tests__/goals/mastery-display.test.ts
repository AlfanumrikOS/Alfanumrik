/**
 * Tests for src/lib/goals/mastery-display.ts
 *
 * Owner: assessment
 * Founder constraint: pure new test file. Validates Phase 2 / Layer 4 helpers
 * (goal-aware mastery DISPLAY thresholds) without any side effects, IO, or
 * modification of existing source.
 *
 * Coverage targets:
 *  - Each of the 6 goals returns the expected display threshold + readiness target pct
 *  - Unknown / null / undefined goal returns 0.8 / 80 (legacy defaults)
 *  - classifyMasteryForDisplay returns 'mastered' at threshold,
 *    'developing' at half-threshold, 'building' below
 */

import { describe, it, expect } from 'vitest';
import {
  getDisplayMasteryThreshold,
  getReadinessTargetPct,
  classifyMasteryForDisplay,
} from '@/lib/goals/mastery-display';
import { GOAL_PROFILES, type GoalCode } from '@/lib/goals/goal-profile';

const ALL_GOALS: GoalCode[] = [
  'improve_basics',
  'pass_comfortably',
  'school_topper',
  'board_topper',
  'competitive_exam',
  'olympiad',
];

const EXPECTED_READINESS: Record<GoalCode, number> = {
  improve_basics: 60,
  pass_comfortably: 70,
  school_topper: 80,
  board_topper: 85,
  competitive_exam: 85,
  olympiad: 90,
};

describe('getDisplayMasteryThreshold', () => {
  it.each(ALL_GOALS)('returns goal.masteryThreshold for %s', (code) => {
    expect(getDisplayMasteryThreshold(code)).toBe(GOAL_PROFILES[code].masteryThreshold);
  });

  it('returns 0.8 (legacy) for null', () => {
    expect(getDisplayMasteryThreshold(null)).toBe(0.8);
  });

  it('returns 0.8 (legacy) for undefined', () => {
    expect(getDisplayMasteryThreshold(undefined)).toBe(0.8);
  });

  it('returns 0.8 (legacy) for an unknown goal code', () => {
    expect(getDisplayMasteryThreshold('not_a_goal' as unknown as GoalCode)).toBe(0.8);
  });

  it('returns 0.8 (legacy) for empty string', () => {
    expect(getDisplayMasteryThreshold('' as unknown as GoalCode)).toBe(0.8);
  });
});

describe('getReadinessTargetPct', () => {
  it.each(ALL_GOALS)('returns the authored readiness pct for %s', (code) => {
    expect(getReadinessTargetPct(code)).toBe(EXPECTED_READINESS[code]);
  });

  it('returns 80 (legacy) for null', () => {
    expect(getReadinessTargetPct(null)).toBe(80);
  });

  it('returns 80 (legacy) for undefined', () => {
    expect(getReadinessTargetPct(undefined)).toBe(80);
  });

  it('returns 80 (legacy) for an unknown goal', () => {
    expect(getReadinessTargetPct('not_a_goal' as unknown as GoalCode)).toBe(80);
  });
});

describe('classifyMasteryForDisplay — three-state classifier', () => {
  // Use olympiad (threshold = 0.9) for a clean, large half-threshold (0.45)
  const OLYMPIAD: GoalCode = 'olympiad';

  it("returns 'mastered' exactly at the threshold", () => {
    expect(classifyMasteryForDisplay(0.9, OLYMPIAD)).toBe('mastered');
  });

  it("returns 'mastered' above the threshold", () => {
    expect(classifyMasteryForDisplay(0.95, OLYMPIAD)).toBe('mastered');
  });

  it("returns 'developing' exactly at half the threshold", () => {
    expect(classifyMasteryForDisplay(0.45, OLYMPIAD)).toBe('developing');
  });

  it("returns 'developing' between half-threshold and threshold", () => {
    expect(classifyMasteryForDisplay(0.7, OLYMPIAD)).toBe('developing');
  });

  it("returns 'building' just below half the threshold", () => {
    expect(classifyMasteryForDisplay(0.44, OLYMPIAD)).toBe('building');
  });

  it("returns 'building' at zero", () => {
    expect(classifyMasteryForDisplay(0, OLYMPIAD)).toBe('building');
  });

  it("returns 'building' for NaN (no false-mastered)", () => {
    expect(classifyMasteryForDisplay(Number.NaN, OLYMPIAD)).toBe('building');
  });

  it('uses legacy 0.8 / 0.4 thresholds when goal is null', () => {
    expect(classifyMasteryForDisplay(0.8, null)).toBe('mastered');
    expect(classifyMasteryForDisplay(0.4, null)).toBe('developing');
    expect(classifyMasteryForDisplay(0.39, null)).toBe('building');
  });

  it('uses legacy 0.8 / 0.4 thresholds when goal is undefined', () => {
    expect(classifyMasteryForDisplay(0.8, undefined)).toBe('mastered');
    expect(classifyMasteryForDisplay(0.4, undefined)).toBe('developing');
    expect(classifyMasteryForDisplay(0.39, undefined)).toBe('building');
  });

  it.each(ALL_GOALS)('uses goal-specific threshold for %s', (code) => {
    const t = GOAL_PROFILES[code].masteryThreshold;
    expect(classifyMasteryForDisplay(t, code)).toBe('mastered');
    expect(classifyMasteryForDisplay(t * 0.5, code)).toBe('developing');
    expect(classifyMasteryForDisplay(t * 0.5 - 1e-9, code)).toBe('building');
  });
});
