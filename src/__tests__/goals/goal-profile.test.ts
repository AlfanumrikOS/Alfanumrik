/**
 * Tests for src/lib/goals/goal-profile.ts
 *
 * Owner: assessment
 * Founder constraint: pure new test file. Validates the Goal Profile Resolver
 * (Phase 0 of Goal-Adaptive Learning Layers) without modifying any existing
 * source.
 *
 * Coverage targets:
 *  - Every GoalCode loads with all required fields
 *  - difficultyMix sums to 1.0 (within ±1e-9) for every profile
 *  - bloomBand.min ≤ bloomBand.max for every profile
 *  - resolveGoalProfile returns null for null / undefined / empty / unknown
 *  - isKnownGoalCode discriminates correctly
 *  - GOAL_PROFILES is frozen at runtime (mutation throws in strict mode)
 *  - Bilingual labels and dashboard callouts are non-empty
 */

import { describe, it, expect } from 'vitest';
import {
  GOAL_PROFILES,
  resolveGoalProfile,
  isKnownGoalCode,
  type GoalCode,
} from '@/lib/goals/goal-profile';

const ALL_GOALS: GoalCode[] = [
  'board_topper',
  'school_topper',
  'pass_comfortably',
  'competitive_exam',
  'olympiad',
  'improve_basics',
];

describe('GOAL_PROFILES table', () => {
  it.each(ALL_GOALS)('loads profile for %s with all required fields', (code) => {
    const p = GOAL_PROFILES[code];
    expect(p).toBeDefined();
    expect(p.code).toBe(code);
    expect(p.labelEn.length).toBeGreaterThan(0);
    expect(p.labelHi.length).toBeGreaterThan(0);
    expect(p.dashboardCalloutEn.length).toBeGreaterThan(0);
    expect(p.dashboardCalloutHi.length).toBeGreaterThan(0);
    expect(p.sourcePriority.length).toBeGreaterThan(0);
    expect(p.dailyTargetMinutes).toBeGreaterThan(0);
  });

  it.each(ALL_GOALS)('difficultyMix for %s sums to 1.0 within 1e-9', (code) => {
    const { easy, medium, hard } = GOAL_PROFILES[code].difficultyMix;
    const sum = easy + medium + hard;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it.each(ALL_GOALS)('difficultyMix probabilities for %s are in [0,1]', (code) => {
    const { easy, medium, hard } = GOAL_PROFILES[code].difficultyMix;
    for (const v of [easy, medium, hard]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it.each(ALL_GOALS)('bloomBand for %s satisfies min <= max and 1..6', (code) => {
    const { min, max } = GOAL_PROFILES[code].bloomBand;
    expect(min).toBeGreaterThanOrEqual(1);
    expect(min).toBeLessThanOrEqual(6);
    expect(max).toBeGreaterThanOrEqual(1);
    expect(max).toBeLessThanOrEqual(6);
    expect(min).toBeLessThanOrEqual(max);
  });

  it.each(ALL_GOALS)('masteryThreshold for %s is in (0, 1]', (code) => {
    const t = GOAL_PROFILES[code].masteryThreshold;
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(1);
  });

  // Spot-check a few persona-table values to catch regressions in the literal table.
  it('improve_basics has mastery 0.6 and 10-minute daily target', () => {
    const p = GOAL_PROFILES.improve_basics;
    expect(p.masteryThreshold).toBe(0.6);
    expect(p.dailyTargetMinutes).toBe(10);
    expect(p.pacePolicy).toBe('patient');
  });

  it('board_topper has mastery 0.85 and examiner tone', () => {
    const p = GOAL_PROFILES.board_topper;
    expect(p.masteryThreshold).toBe(0.85);
    expect(p.dailyTargetMinutes).toBe(45);
    expect(p.scorecardTone).toBe('examiner');
    expect(p.sourcePriority[0]).toBe('pyq');
  });

  it('competitive_exam prioritizes JEE archive first', () => {
    const p = GOAL_PROFILES.competitive_exam;
    expect(p.sourcePriority[0]).toBe('jee_archive');
    expect(p.sourcePriority).toContain('neet_archive');
    expect(p.bloomBand.min).toBe(3);
  });

  it('olympiad has 0.7 hard share and selective pace', () => {
    const p = GOAL_PROFILES.olympiad;
    expect(p.difficultyMix.hard).toBe(0.7);
    expect(p.pacePolicy).toBe('selective');
    expect(p.masteryThreshold).toBe(0.9);
  });

  it('Hindi labels use Devanagari script', () => {
    // Devanagari Unicode range U+0900 to U+097F.
    const devanagari = /[ऀ-ॿ]/;
    for (const code of ALL_GOALS) {
      const p = GOAL_PROFILES[code];
      expect(devanagari.test(p.labelHi)).toBe(true);
      expect(devanagari.test(p.dashboardCalloutHi)).toBe(true);
    }
  });
});

describe('GOAL_PROFILES is frozen at runtime', () => {
  it('Object.isFrozen returns true on the table', () => {
    expect(Object.isFrozen(GOAL_PROFILES)).toBe(true);
  });

  it('Object.isFrozen returns true on each profile', () => {
    for (const code of ALL_GOALS) {
      expect(Object.isFrozen(GOAL_PROFILES[code])).toBe(true);
    }
  });

  it('Object.isFrozen returns true on nested difficultyMix and bloomBand', () => {
    for (const code of ALL_GOALS) {
      expect(Object.isFrozen(GOAL_PROFILES[code].difficultyMix)).toBe(true);
      expect(Object.isFrozen(GOAL_PROFILES[code].bloomBand)).toBe(true);
      expect(Object.isFrozen(GOAL_PROFILES[code].sourcePriority)).toBe(true);
    }
  });

  it('mutation attempt throws in strict mode (test files are strict)', () => {
    // Vitest test modules are ES modules → strict mode → assignment to a
    // frozen property throws TypeError. Cast to mutable shape so the assignment
    // type-checks; the runtime freeze is what we are asserting.
    expect(() => {
      (GOAL_PROFILES.improve_basics as { masteryThreshold: number }).masteryThreshold = 0.99;
    }).toThrow(TypeError);
  });
});

describe('resolveGoalProfile', () => {
  it.each(ALL_GOALS)('returns the profile for known code %s', (code) => {
    const p = resolveGoalProfile(code);
    expect(p).not.toBeNull();
    expect(p?.code).toBe(code);
  });

  it('returns null for null', () => {
    expect(resolveGoalProfile(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(resolveGoalProfile(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(resolveGoalProfile('')).toBeNull();
  });

  it('returns null for unknown string', () => {
    expect(resolveGoalProfile('not_a_real_goal')).toBeNull();
  });

  it('returns null for nearly-correct strings (no fuzzy match)', () => {
    expect(resolveGoalProfile('Board_Topper')).toBeNull();
    expect(resolveGoalProfile('boardtopper')).toBeNull();
    expect(resolveGoalProfile(' board_topper ')).toBeNull();
  });

  it('never throws on bad input', () => {
    // @ts-expect-error intentional bad input
    expect(() => resolveGoalProfile(42)).not.toThrow();
    // @ts-expect-error intentional bad input
    expect(() => resolveGoalProfile({})).not.toThrow();
    // @ts-expect-error intentional bad input
    expect(() => resolveGoalProfile([])).not.toThrow();
  });
});

describe('isKnownGoalCode', () => {
  it.each(ALL_GOALS)('returns true for known code %s', (code) => {
    expect(isKnownGoalCode(code)).toBe(true);
  });

  it('returns false for unknown / empty / null / undefined', () => {
    expect(isKnownGoalCode('not_a_real_goal')).toBe(false);
    expect(isKnownGoalCode('')).toBe(false);
    expect(isKnownGoalCode(null)).toBe(false);
    expect(isKnownGoalCode(undefined)).toBe(false);
  });

  it('returns false for non-string types', () => {
    expect(isKnownGoalCode(42)).toBe(false);
    expect(isKnownGoalCode({})).toBe(false);
    expect(isKnownGoalCode([])).toBe(false);
    expect(isKnownGoalCode(true)).toBe(false);
  });

  it('discriminates type so downstream code can use the value as GoalCode', () => {
    const value: unknown = 'board_topper';
    if (isKnownGoalCode(value)) {
      // Type-narrowing check: `value` should be GoalCode here.
      const p = GOAL_PROFILES[value];
      expect(p.code).toBe('board_topper');
    } else {
      throw new Error('expected isKnownGoalCode to narrow');
    }
  });
});
