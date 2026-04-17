import { describe, it, expect } from 'vitest';
import {
  BLOOM_CEILING,
  BLOOM_LEVELS_ORDERED,
  GRADE_RETENTION_FLOOR,
  BEHAVIOR_WEIGHTS,
  PERFORMANCE_WEIGHT,
  BEHAVIOR_WEIGHT,
  LEVEL_THRESHOLDS,
  getLevelFromScore,
  getGradeRetentionFloor,
  type BloomLevel,
} from '@/lib/score-config';

// ─── BLOOM_CEILING ──────────────────────────────────────────────

describe('BLOOM_CEILING', () => {
  it('has values in ascending order from remember to create', () => {
    const ordered: BloomLevel[] = [
      'remember',
      'understand',
      'apply',
      'analyze',
      'evaluate',
      'create',
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(BLOOM_CEILING[ordered[i]]).toBeGreaterThan(
        BLOOM_CEILING[ordered[i - 1]]
      );
    }
  });

  it('has minimum value of 0.45 (remember)', () => {
    expect(BLOOM_CEILING.remember).toBe(0.45);
  });

  it('has maximum value of 1.00 (create)', () => {
    expect(BLOOM_CEILING.create).toBe(1.0);
  });

  it('has all values in the range [0.45, 1.00]', () => {
    for (const level of BLOOM_LEVELS_ORDERED) {
      expect(BLOOM_CEILING[level]).toBeGreaterThanOrEqual(0.45);
      expect(BLOOM_CEILING[level]).toBeLessThanOrEqual(1.0);
    }
  });

  it('has exactly 6 entries matching BLOOM_LEVELS_ORDERED', () => {
    expect(Object.keys(BLOOM_CEILING)).toHaveLength(6);
    for (const level of BLOOM_LEVELS_ORDERED) {
      expect(BLOOM_CEILING[level]).toBeDefined();
    }
  });
});

// ─── GRADE_RETENTION_FLOOR ──────────────────────────────────────

describe('GRADE_RETENTION_FLOOR', () => {
  it('has entries for grades "6" through "12" (P5: string keys)', () => {
    const expectedGrades = ['6', '7', '8', '9', '10', '11', '12'];
    for (const grade of expectedGrades) {
      expect(GRADE_RETENTION_FLOOR[grade]).toBeDefined();
    }
  });

  it('uses string keys, not integer keys', () => {
    // Integer key 6 should not exist -- only string "6"
    expect(GRADE_RETENTION_FLOOR['6']).toBeDefined();
    // Ensure it has exactly the expected string keys
    const keys = Object.keys(GRADE_RETENTION_FLOOR);
    for (const key of keys) {
      expect(typeof key).toBe('string');
      expect(key).toMatch(/^\d+$/);
    }
  });

  it('has younger grades (lower numbers) with higher or equal floors', () => {
    // Grade 6 floor >= Grade 7 floor >= ... >= Grade 12 floor
    const grades = ['6', '7', '8', '9', '10', '11', '12'];
    for (let i = 1; i < grades.length; i++) {
      expect(GRADE_RETENTION_FLOOR[grades[i]]).toBeLessThanOrEqual(
        GRADE_RETENTION_FLOOR[grades[i - 1]]
      );
    }
  });

  it('has grade "6" with the highest floor (0.30)', () => {
    expect(GRADE_RETENTION_FLOOR['6']).toBe(0.3);
  });

  it('has grade "12" with the lowest floor (0.10)', () => {
    expect(GRADE_RETENTION_FLOOR['12']).toBe(0.1);
  });

  it('has all values between 0.10 and 0.30', () => {
    for (const grade of ['6', '7', '8', '9', '10', '11', '12']) {
      expect(GRADE_RETENTION_FLOOR[grade]).toBeGreaterThanOrEqual(0.1);
      expect(GRADE_RETENTION_FLOOR[grade]).toBeLessThanOrEqual(0.3);
    }
  });
});

// ─── BEHAVIOR_WEIGHTS ───────────────────────────────────────────

describe('BEHAVIOR_WEIGHTS', () => {
  it('has weights summing to exactly 20', () => {
    const sum = Object.values(BEHAVIOR_WEIGHTS).reduce(
      (acc, w) => acc + w,
      0
    );
    expect(sum).toBe(20);
  });

  it('has all 6 behavioral signals defined', () => {
    const expectedSignals = [
      'consistency',
      'challenge',
      'revision',
      'persistence',
      'breadth',
      'velocity',
    ];
    for (const signal of expectedSignals) {
      expect(
        BEHAVIOR_WEIGHTS[signal as keyof typeof BEHAVIOR_WEIGHTS]
      ).toBeDefined();
    }
  });

  it('has all positive integer weights', () => {
    for (const w of Object.values(BEHAVIOR_WEIGHTS)) {
      expect(w).toBeGreaterThan(0);
      expect(Number.isInteger(w)).toBe(true);
    }
  });
});

// ─── Formula Weights ────────────────────────────────────────────

describe('Formula Weights', () => {
  it('PERFORMANCE_WEIGHT + BEHAVIOR_WEIGHT === 1.0', () => {
    expect(PERFORMANCE_WEIGHT + BEHAVIOR_WEIGHT).toBe(1.0);
  });

  it('PERFORMANCE_WEIGHT is 0.80', () => {
    expect(PERFORMANCE_WEIGHT).toBe(0.8);
  });

  it('BEHAVIOR_WEIGHT is 0.20', () => {
    expect(BEHAVIOR_WEIGHT).toBe(0.2);
  });
});

// ─── LEVEL_THRESHOLDS ───────────────────────────────────────────

describe('LEVEL_THRESHOLDS', () => {
  it('has no gaps or overlaps -- every integer 0-100 maps to exactly one level', () => {
    for (let score = 0; score <= 100; score++) {
      const matches = LEVEL_THRESHOLDS.filter(
        (t) => score >= t.min && score <= t.max
      );
      expect(matches).toHaveLength(1);
    }
  });

  it('starts at 0 and ends at 100', () => {
    const sortedByMin = [...LEVEL_THRESHOLDS].sort(
      (a, b) => a.min - b.min
    );
    expect(sortedByMin[0].min).toBe(0);
    expect(sortedByMin[sortedByMin.length - 1].max).toBe(100);
  });

  it('has contiguous ranges (each min = previous max + 1)', () => {
    const sorted = [...LEVEL_THRESHOLDS].sort((a, b) => a.min - b.min);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBe(sorted[i - 1].max + 1);
    }
  });

  it('every threshold has a non-empty name', () => {
    for (const t of LEVEL_THRESHOLDS) {
      expect(t.name.length).toBeGreaterThan(0);
    }
  });
});

// ─── getLevelFromScore ──────────────────────────────────────────

describe('getLevelFromScore', () => {
  it('returns "Curious Cub" for score 0', () => {
    expect(getLevelFromScore(0)).toBe('Curious Cub');
  });

  it('returns "Curious Cub" for score 19 (upper boundary)', () => {
    expect(getLevelFromScore(19)).toBe('Curious Cub');
  });

  it('returns "Quick Learner" for score 20 (lower boundary)', () => {
    expect(getLevelFromScore(20)).toBe('Quick Learner');
  });

  it('returns "Quick Learner" for score 34 (upper boundary)', () => {
    expect(getLevelFromScore(34)).toBe('Quick Learner');
  });

  it('returns "Rising Star" for score 35', () => {
    expect(getLevelFromScore(35)).toBe('Rising Star');
  });

  it('returns "Rising Star" for score 49', () => {
    expect(getLevelFromScore(49)).toBe('Rising Star');
  });

  it('returns "Knowledge Seeker" for score 50', () => {
    expect(getLevelFromScore(50)).toBe('Knowledge Seeker');
  });

  it('returns "Knowledge Seeker" for score 64', () => {
    expect(getLevelFromScore(64)).toBe('Knowledge Seeker');
  });

  it('returns "Smart Fox" for score 65', () => {
    expect(getLevelFromScore(65)).toBe('Smart Fox');
  });

  it('returns "Smart Fox" for score 74', () => {
    expect(getLevelFromScore(74)).toBe('Smart Fox');
  });

  it('returns "Quiz Champion" for score 75', () => {
    expect(getLevelFromScore(75)).toBe('Quiz Champion');
  });

  it('returns "Quiz Champion" for score 84', () => {
    expect(getLevelFromScore(84)).toBe('Quiz Champion');
  });

  it('returns "Study Master" for score 85', () => {
    expect(getLevelFromScore(85)).toBe('Study Master');
  });

  it('returns "Study Master" for score 89', () => {
    expect(getLevelFromScore(89)).toBe('Study Master');
  });

  it('returns "Brain Ninja" for score 90', () => {
    expect(getLevelFromScore(90)).toBe('Brain Ninja');
  });

  it('returns "Brain Ninja" for score 94', () => {
    expect(getLevelFromScore(94)).toBe('Brain Ninja');
  });

  it('returns "Scholar Fox" for score 95', () => {
    expect(getLevelFromScore(95)).toBe('Scholar Fox');
  });

  it('returns "Scholar Fox" for score 97', () => {
    expect(getLevelFromScore(97)).toBe('Scholar Fox');
  });

  it('returns "Grand Master" for score 98', () => {
    expect(getLevelFromScore(98)).toBe('Grand Master');
  });

  it('returns "Grand Master" for score 100', () => {
    expect(getLevelFromScore(100)).toBe('Grand Master');
  });

  // Clamping tests
  it('clamps negative scores to 0 and returns "Curious Cub"', () => {
    expect(getLevelFromScore(-10)).toBe('Curious Cub');
    expect(getLevelFromScore(-1)).toBe('Curious Cub');
  });

  it('clamps scores above 100 to 100 and returns "Grand Master"', () => {
    expect(getLevelFromScore(101)).toBe('Grand Master');
    expect(getLevelFromScore(200)).toBe('Grand Master');
  });

  // Fractional score tests (rounds)
  it('rounds fractional scores -- 19.4 rounds to 19 (Curious Cub)', () => {
    expect(getLevelFromScore(19.4)).toBe('Curious Cub');
  });

  it('rounds fractional scores -- 19.5 rounds to 20 (Quick Learner)', () => {
    expect(getLevelFromScore(19.5)).toBe('Quick Learner');
  });

  it('rounds fractional scores -- 97.6 rounds to 98 (Grand Master)', () => {
    expect(getLevelFromScore(97.6)).toBe('Grand Master');
  });

  it('rounds fractional scores -- 97.4 rounds to 97 (Scholar Fox)', () => {
    expect(getLevelFromScore(97.4)).toBe('Scholar Fox');
  });
});

// ─── getGradeRetentionFloor ─────────────────────────────────────

describe('getGradeRetentionFloor', () => {
  it('returns 0.30 for grade "6"', () => {
    expect(getGradeRetentionFloor('6')).toBe(0.3);
  });

  it('returns 0.30 for grade "7"', () => {
    expect(getGradeRetentionFloor('7')).toBe(0.3);
  });

  it('returns 0.20 for grade "8"', () => {
    expect(getGradeRetentionFloor('8')).toBe(0.2);
  });

  it('returns 0.20 for grade "9"', () => {
    expect(getGradeRetentionFloor('9')).toBe(0.2);
  });

  it('returns 0.15 for grade "10"', () => {
    expect(getGradeRetentionFloor('10')).toBe(0.15);
  });

  it('returns 0.10 for grade "11"', () => {
    expect(getGradeRetentionFloor('11')).toBe(0.1);
  });

  it('returns 0.10 for grade "12"', () => {
    expect(getGradeRetentionFloor('12')).toBe(0.1);
  });

  it('returns 0.10 fallback for unknown grade "5"', () => {
    expect(getGradeRetentionFloor('5')).toBe(0.1);
  });

  it('returns 0.10 fallback for unknown grade "13"', () => {
    expect(getGradeRetentionFloor('13')).toBe(0.1);
  });

  it('returns 0.10 fallback for empty string', () => {
    expect(getGradeRetentionFloor('')).toBe(0.1);
  });

  it('returns 0.10 fallback for non-numeric string', () => {
    expect(getGradeRetentionFloor('abc')).toBe(0.1);
  });
});
