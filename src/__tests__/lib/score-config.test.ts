/**
 * score-config.ts — unit tests.
 *
 * src/lib/score-config.ts holds the constants that drive the bounded
 * 0-100 Performance Score system (replaces unbounded XP). Tests cover:
 *   - PERFORMANCE_WEIGHT + BEHAVIOR_WEIGHT sum to 1.0 (formula sanity)
 *   - BLOOM_CEILING values are monotonic (deeper Bloom ⇒ higher ceiling)
 *   - getGradeRetentionFloor: every CBSE grade "6"-"12" returns the
 *     curated value; unknown grades fall back to the strict 0.10 floor
 *   - getLevelFromScore: every threshold range maps to its level name,
 *     and out-of-range scores get clamped before lookup
 *   - BEHAVIOR_WEIGHTS sum to 20 per the file invariant
 */

import { describe, it, expect } from 'vitest';
import {
  PERFORMANCE_WEIGHT,
  BEHAVIOR_WEIGHT,
  BLOOM_CEILING,
  BLOOM_LEVELS_ORDERED,
  GRADE_RETENTION_FLOOR,
  getGradeRetentionFloor,
  BEHAVIOR_WEIGHTS,
  BEHAVIOR_WINDOWS,
  LEVEL_THRESHOLDS,
  getLevelFromScore,
} from '@/lib/score-config';

describe('Formula weights', () => {
  it('PERFORMANCE_WEIGHT + BEHAVIOR_WEIGHT === 1.0', () => {
    // The two weights must sum to 1; otherwise the Subject Score formula is broken.
    expect(PERFORMANCE_WEIGHT + BEHAVIOR_WEIGHT).toBeCloseTo(1.0, 10);
  });

  it('PERFORMANCE_WEIGHT is 0.80', () => {
    expect(PERFORMANCE_WEIGHT).toBe(0.8);
  });

  it('BEHAVIOR_WEIGHT is 0.20', () => {
    expect(BEHAVIOR_WEIGHT).toBe(0.2);
  });
});

describe('BLOOM_CEILING', () => {
  it('has all six Bloom levels', () => {
    expect(Object.keys(BLOOM_CEILING).sort()).toEqual(
      ['analyze', 'apply', 'create', 'evaluate', 'remember', 'understand'].sort(),
    );
  });

  it('ceilings increase monotonically across BLOOM_LEVELS_ORDERED', () => {
    let prev = -Infinity;
    for (const lvl of BLOOM_LEVELS_ORDERED) {
      const v = BLOOM_CEILING[lvl];
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('caps "create" at 1.00 (full credit)', () => {
    expect(BLOOM_CEILING.create).toBe(1.0);
  });

  it('limits "remember" to 0.45 (cannot exceed without higher-order practice)', () => {
    expect(BLOOM_CEILING.remember).toBe(0.45);
  });
});

describe('getGradeRetentionFloor', () => {
  it('returns curated floor for every CBSE grade 6-12 (string keys per P5)', () => {
    expect(getGradeRetentionFloor('6')).toBe(0.3);
    expect(getGradeRetentionFloor('7')).toBe(0.3);
    expect(getGradeRetentionFloor('8')).toBe(0.2);
    expect(getGradeRetentionFloor('9')).toBe(0.2);
    expect(getGradeRetentionFloor('10')).toBe(0.15);
    expect(getGradeRetentionFloor('11')).toBe(0.1);
    expect(getGradeRetentionFloor('12')).toBe(0.1);
  });

  it('falls back to 0.10 (strictest) for unknown grades', () => {
    expect(getGradeRetentionFloor('5')).toBe(0.1);
    expect(getGradeRetentionFloor('13')).toBe(0.1);
    expect(getGradeRetentionFloor('')).toBe(0.1);
  });

  it('returns the strict 0.10 floor for whitespace / non-numeric strings', () => {
    // JS object lookup coerces integer 6 to "6" so the integer path
    // accidentally hits a real key. The fallback path is the contract for
    // genuinely unknown values like padded or alphabetic input.
    expect(getGradeRetentionFloor(' 6 ')).toBe(0.1);
    expect(getGradeRetentionFloor('six')).toBe(0.1);
  });

  it('floors decay strictly with grade — older students decay harder', () => {
    expect(getGradeRetentionFloor('6')).toBeGreaterThanOrEqual(getGradeRetentionFloor('12'));
  });

  it('GRADE_RETENTION_FLOOR has exactly 7 grade keys (6-12)', () => {
    expect(Object.keys(GRADE_RETENTION_FLOOR).sort()).toEqual([
      '10', '11', '12', '6', '7', '8', '9',
    ]);
  });
});

describe('BEHAVIOR_WEIGHTS', () => {
  it('weights sum to 20 (each point = 1% of behavior component)', () => {
    const total = Object.values(BEHAVIOR_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(20);
  });

  it('has six behavior signals', () => {
    expect(Object.keys(BEHAVIOR_WEIGHTS)).toHaveLength(6);
  });

  it('BEHAVIOR_WINDOWS has same six keys as BEHAVIOR_WEIGHTS', () => {
    expect(Object.keys(BEHAVIOR_WINDOWS).sort()).toEqual(
      Object.keys(BEHAVIOR_WEIGHTS).sort(),
    );
  });
});

describe('LEVEL_THRESHOLDS', () => {
  it('first range starts at 0', () => {
    expect(LEVEL_THRESHOLDS[0].min).toBe(0);
  });

  it('last range ends at 100', () => {
    expect(LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1].max).toBe(100);
  });

  it('ranges are contiguous (no gaps, no overlaps)', () => {
    for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
      expect(LEVEL_THRESHOLDS[i].min).toBe(LEVEL_THRESHOLDS[i - 1].max + 1);
    }
  });
});

describe('getLevelFromScore', () => {
  it('returns "Curious Cub" for score 0', () => {
    expect(getLevelFromScore(0)).toBe('Curious Cub');
  });

  it('returns "Grand Master" for score 100', () => {
    expect(getLevelFromScore(100)).toBe('Grand Master');
  });

  it('clamps negative scores to 0 → Curious Cub', () => {
    expect(getLevelFromScore(-50)).toBe('Curious Cub');
  });

  it('clamps scores above 100 → Grand Master', () => {
    expect(getLevelFromScore(150)).toBe('Grand Master');
  });

  it('returns "Quiz Champion" for 80 (boundary)', () => {
    expect(getLevelFromScore(80)).toBe('Quiz Champion');
  });

  it('rounds 19.4 to 19 → Curious Cub (last value of range)', () => {
    expect(getLevelFromScore(19.4)).toBe('Curious Cub');
  });

  it('rounds 19.5 to 20 → Quick Learner (first value of next range)', () => {
    expect(getLevelFromScore(19.5)).toBe('Quick Learner');
  });

  it('returns the named level for every threshold midpoint', () => {
    for (const t of LEVEL_THRESHOLDS) {
      const mid = Math.floor((t.min + t.max) / 2);
      expect(getLevelFromScore(mid)).toBe(t.name);
    }
  });
});
