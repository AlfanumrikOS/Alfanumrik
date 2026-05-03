/**
 * Tests for src/lib/goals/quiz-params.ts
 *
 * Owner: assessment
 * Founder constraint: pure new test file. Validates Phase 2 / Layer 2
 * (goal-aware quiz parameter selection) without any side effects, IO,
 * or modification of existing source.
 *
 * Coverage targets:
 *  - Each of the 6 goals returns the expected count, difficulty, bloomLevel
 *  - Hint nudges: recent perfect score → +1 difficulty, recent <40% → -1, neutral → no nudge
 *  - requestedCount override respected when in [1, 20]; ignored otherwise
 *  - rationale string contains goal code, count, difficulty, bloom, source list
 *  - sourceTags is read-only — caller cannot mutate the frozen profile array
 */

import { describe, it, expect } from 'vitest';
import {
  pickQuizParams,
  pickQuizParamsByCode,
  type DifficultyLevel,
  type BloomLevelLabel,
} from '@/lib/goals/quiz-params';
import { resolveGoalProfile, type GoalCode } from '@/lib/goals/goal-profile';

// Authored expected values per the rule table in the brief.
// count = clamp(round(dailyTargetMinutes/3), 5, 15)
// difficulty = clamp(round(1*easy + 3*medium + 5*hard), 1, 5)
// bloom = round((min+max)/2) → label
const EXPECTED: Record<
  GoalCode,
  { count: number; difficulty: DifficultyLevel; bloom: BloomLevelLabel }
> = {
  improve_basics:   { count: 5,  difficulty: 2, bloom: 'understand' }, // 10/3=3→clamp 5; mix 1.9→2; band 1-3→2
  pass_comfortably: { count: 7,  difficulty: 3, bloom: 'apply' },      // 20/3=7;       mix 2.5→3; band 1-4→2.5→3
  school_topper:    { count: 10, difficulty: 3, bloom: 'apply' },      // 30/3=10;      mix 2.8→3; band 1-5→3
  board_topper:     { count: 15, difficulty: 3, bloom: 'analyze' },    // 45/3=15;      mix 3.3→3; band 2-6→4
  competitive_exam: { count: 15, difficulty: 4, bloom: 'evaluate' },   // 60/3=20→clamp 15; mix 3.8→4; band 3-6→4.5→5
  olympiad:         { count: 15, difficulty: 4, bloom: 'evaluate' },   // 60/3=20→clamp 15; mix 4.3→4; band 4-6→5
};

const ALL_GOALS = Object.keys(EXPECTED) as GoalCode[];

describe('pickQuizParams — per-goal defaults', () => {
  it.each(ALL_GOALS)('returns expected count/difficulty/bloom for %s', (code) => {
    const profile = resolveGoalProfile(code)!;
    const params = pickQuizParams(profile);
    const want = EXPECTED[code];
    expect(params.count).toBe(want.count);
    expect(params.difficulty).toBe(want.difficulty);
    expect(params.bloomLevel).toBe(want.bloom);
  });

  it.each(ALL_GOALS)('passes through profile.sourcePriority verbatim for %s', (code) => {
    const profile = resolveGoalProfile(code)!;
    const params = pickQuizParams(profile);
    expect(Array.from(params.sourceTags)).toEqual(Array.from(profile.sourcePriority));
  });
});

describe('pickQuizParams — accuracy nudges', () => {
  it('nudges difficulty +1 when recent accuracy >= 0.8', () => {
    const profile = resolveGoalProfile('school_topper')!; // base difficulty = 3
    const params = pickQuizParams(profile, { recentCorrect: 8, recentTotal: 10 }); // 0.8 exactly
    expect(params.difficulty).toBe(4);
    expect(params.rationale).toContain('nudged+1');
  });

  it('nudges difficulty -1 when recent accuracy < 0.4', () => {
    const profile = resolveGoalProfile('school_topper')!; // base difficulty = 3
    const params = pickQuizParams(profile, { recentCorrect: 3, recentTotal: 10 }); // 0.30
    expect(params.difficulty).toBe(2);
    expect(params.rationale).toContain('nudged-1');
  });

  it('does not nudge when accuracy is in the neutral band [0.4, 0.8)', () => {
    const profile = resolveGoalProfile('school_topper')!; // base difficulty = 3
    const params = pickQuizParams(profile, { recentCorrect: 5, recentTotal: 10 }); // 0.50
    expect(params.difficulty).toBe(3);
    expect(params.rationale).toContain('midmix=');
  });

  it('caps the +1 nudge at 5 (olympiad already at 4 → 5)', () => {
    const profile = resolveGoalProfile('olympiad')!; // base difficulty = 4
    const params = pickQuizParams(profile, { recentCorrect: 9, recentTotal: 10 }); // 0.90
    expect(params.difficulty).toBe(5);
  });

  it('floors the -1 nudge at 1 (improve_basics already at 2 → 1)', () => {
    const profile = resolveGoalProfile('improve_basics')!; // base difficulty = 2
    const params = pickQuizParams(profile, { recentCorrect: 1, recentTotal: 10 }); // 0.10
    expect(params.difficulty).toBe(1);
  });

  it('ignores hints when recentTotal is 0 or missing', () => {
    const profile = resolveGoalProfile('school_topper')!;
    const params = pickQuizParams(profile, { recentCorrect: 5, recentTotal: 0 });
    expect(params.difficulty).toBe(3);
    expect(params.rationale).toContain('midmix=');
  });
});

describe('pickQuizParams — requestedCount override', () => {
  it('respects requestedCount when in range', () => {
    const profile = resolveGoalProfile('school_topper')!; // base count = 10
    const params = pickQuizParams(profile, { requestedCount: 8 });
    expect(params.count).toBe(8);
    expect(params.rationale).toContain('count=8(requested)');
  });

  it('respects requestedCount = 1 (lower bound)', () => {
    const profile = resolveGoalProfile('improve_basics')!;
    const params = pickQuizParams(profile, { requestedCount: 1 });
    expect(params.count).toBe(1);
  });

  it('respects requestedCount = 20 (upper bound)', () => {
    const profile = resolveGoalProfile('improve_basics')!;
    const params = pickQuizParams(profile, { requestedCount: 20 });
    expect(params.count).toBe(20);
  });

  it('ignores requestedCount = 0 (out of range, falls back to base)', () => {
    const profile = resolveGoalProfile('school_topper')!; // base = 10
    const params = pickQuizParams(profile, { requestedCount: 0 });
    expect(params.count).toBe(10);
    expect(params.rationale).toContain('count=10(base)');
  });

  it('ignores negative requestedCount (falls back to base)', () => {
    const profile = resolveGoalProfile('school_topper')!; // base = 10
    const params = pickQuizParams(profile, { requestedCount: -5 });
    expect(params.count).toBe(10);
    expect(params.rationale).toContain('(base)');
  });

  it('ignores requestedCount > 20 (falls back to base)', () => {
    const profile = resolveGoalProfile('school_topper')!; // base = 10
    const params = pickQuizParams(profile, { requestedCount: 25 });
    expect(params.count).toBe(10);
    expect(params.rationale).toContain('(base)');
  });

  it('ignores non-integer requestedCount (falls back to base)', () => {
    const profile = resolveGoalProfile('school_topper')!;
    const params = pickQuizParams(profile, { requestedCount: 7.5 });
    expect(params.count).toBe(10);
  });
});

describe('pickQuizParams — rationale string', () => {
  it('contains goal code, count, difficulty, bloom level, and source list', () => {
    const profile = resolveGoalProfile('board_topper')!;
    const params = pickQuizParams(profile);
    expect(params.rationale).toContain('goal=board_topper');
    expect(params.rationale).toContain('count=15');
    expect(params.rationale).toContain('difficulty=3');
    expect(params.rationale).toContain('bloom=analyze');
    // sourcePriority for board_topper = ['pyq', 'ncert', 'curated']
    expect(params.rationale).toContain('sources=pyq,ncert,curated');
  });

  it('reports midband index in bloom segment', () => {
    const profile = resolveGoalProfile('competitive_exam')!; // band 3-6 → mid 5
    const params = pickQuizParams(profile);
    expect(params.rationale).toContain('bloom=evaluate(midband=5)');
  });
});

describe('pickQuizParams — sourceTags immutability', () => {
  it('returns a reference to the frozen profile.sourcePriority (mutation throws in strict mode)', () => {
    const profile = resolveGoalProfile('olympiad')!;
    const params = pickQuizParams(profile);
    // The underlying array is frozen by deepFreeze in goal-profile.ts.
    // Attempting to push should throw in strict mode (vitest runs strict).
    expect(() => {
      (params.sourceTags as unknown as string[]).push('curated');
    }).toThrow(TypeError);
  });

  it('returns a reference to the frozen profile.sourcePriority (assignment throws)', () => {
    const profile = resolveGoalProfile('olympiad')!;
    const params = pickQuizParams(profile);
    expect(() => {
      (params.sourceTags as unknown as string[])[0] = 'mutated';
    }).toThrow(TypeError);
  });
});

describe('pickQuizParamsByCode — convenience wrapper', () => {
  it('resolves the code and returns the same params as pickQuizParams', () => {
    const viaCode = pickQuizParamsByCode('school_topper');
    const viaProfile = pickQuizParams(resolveGoalProfile('school_topper')!);
    expect(viaCode).toEqual(viaProfile);
  });

  it('passes hints through to pickQuizParams', () => {
    const viaCode = pickQuizParamsByCode('school_topper', { requestedCount: 6 });
    expect(viaCode.count).toBe(6);
  });

  it('throws for an unknown goal code (programmer-bug guard)', () => {
    expect(() =>
      pickQuizParamsByCode('not_a_goal' as unknown as GoalCode),
    ).toThrow(/unknown goal code/i);
  });
});
