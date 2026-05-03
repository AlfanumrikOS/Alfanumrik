/**
 * Tests for src/lib/goals/scorecard-sentence.ts
 *
 * Owner: assessment
 * Founder constraint: pure new test file. Validates the goal-aware scorecard
 * sentence (Phase 1 of Goal-Adaptive Learning Layers) without modifying any
 * existing source.
 *
 * Coverage targets:
 *  - Every goal returns both en + hi non-empty
 *  - tone matches GOAL_PROFILES[goal].scorecardTone
 *  - score% appears in the string for goals that need it (everyone except
 *    improve_basics, which leads with the count)
 *  - Function is pure (does not mutate input, does not recompute score/XP)
 *  - isHi flag does NOT swap which language lives in en/hi (en stays English,
 *    hi stays Hindi — flag is reserved for callers' active-language logic)
 */

import { describe, it, expect } from 'vitest';
import { buildScorecardSentence } from '@/lib/goals/scorecard-sentence';
import { GOAL_PROFILES, type GoalCode } from '@/lib/goals/goal-profile';

const GOALS: GoalCode[] = [
  'board_topper',
  'school_topper',
  'pass_comfortably',
  'competitive_exam',
  'olympiad',
  'improve_basics',
];

describe('buildScorecardSentence — output shape', () => {
  it.each(GOALS)('%s returns both en and hi non-empty', (goal) => {
    const out = buildScorecardSentence({
      goal,
      correct: 7,
      total: 10,
      scorePercent: 70,
      xpEarned: 90,
      isHi: false,
    });
    expect(out.en.length).toBeGreaterThan(0);
    expect(out.hi.length).toBeGreaterThan(0);
  });

  it.each(GOALS)('%s tone matches GOAL_PROFILES.scorecardTone', (goal) => {
    const out = buildScorecardSentence({
      goal,
      correct: 7,
      total: 10,
      scorePercent: 70,
      xpEarned: 90,
      isHi: false,
    });
    expect(out.tone).toBe(GOAL_PROFILES[goal].scorecardTone);
  });

  it.each(GOALS)('%s hi field uses Devanagari script', (goal) => {
    const out = buildScorecardSentence({
      goal,
      correct: 7,
      total: 10,
      scorePercent: 70,
      xpEarned: 90,
      isHi: false,
    });
    const devanagari = /[ऀ-ॿ]/;
    expect(devanagari.test(out.hi)).toBe(true);
  });
});

describe('buildScorecardSentence — score% inclusion', () => {
  // Every goal except improve_basics must surface the score%.
  const SCORE_GOALS: GoalCode[] = [
    'pass_comfortably',
    'school_topper',
    'board_topper',
    'competitive_exam',
    'olympiad',
  ];

  it.each(SCORE_GOALS)('%s includes scorePercent in en and hi', (goal) => {
    const out = buildScorecardSentence({
      goal,
      correct: 7,
      total: 10,
      scorePercent: 70,
      xpEarned: 90,
      isHi: false,
    });
    expect(out.en).toContain('70%');
    expect(out.hi).toContain('70%');
  });

  it('improve_basics leads with correct/total rather than score%', () => {
    const out = buildScorecardSentence({
      goal: 'improve_basics',
      correct: 4,
      total: 5,
      scorePercent: 80,
      xpEarned: 60,
      isHi: false,
    });
    expect(out.en).toContain('4/5');
    expect(out.hi).toContain('4/5');
    // Score% is intentionally NOT in the improve_basics sentence per spec.
    expect(out.en).not.toContain('80%');
  });

  it('renders 100% correctly when scorePercent is 100', () => {
    const out = buildScorecardSentence({
      goal: 'board_topper',
      correct: 10,
      total: 10,
      scorePercent: 100,
      xpEarned: 170,
      isHi: false,
    });
    expect(out.en).toContain('100%');
  });

  it('renders 0% correctly when scorePercent is 0', () => {
    const out = buildScorecardSentence({
      goal: 'school_topper',
      correct: 0,
      total: 10,
      scorePercent: 0,
      xpEarned: 0,
      isHi: false,
    });
    expect(out.en).toContain('0%');
  });
});

describe('buildScorecardSentence — goal-specific phrasing', () => {
  it('board_topper mentions PYQ + marking-scheme awareness', () => {
    const out = buildScorecardSentence({
      goal: 'board_topper',
      correct: 8,
      total: 10,
      scorePercent: 80,
      xpEarned: 100,
      isHi: false,
    });
    expect(out.en).toMatch(/PYQ/);
    expect(out.en.toLowerCase()).toContain('marking-scheme');
  });

  it('competitive_exam mentions JEE/NEET pace', () => {
    const out = buildScorecardSentence({
      goal: 'competitive_exam',
      correct: 8,
      total: 10,
      scorePercent: 80,
      xpEarned: 100,
      isHi: false,
    });
    expect(out.en).toMatch(/JEE|NEET/);
  });

  it('olympiad mentions alternate solution path', () => {
    const out = buildScorecardSentence({
      goal: 'olympiad',
      correct: 5,
      total: 10,
      scorePercent: 50,
      xpEarned: 50,
      isHi: false,
    });
    expect(out.en.toLowerCase()).toContain('alternate solution');
  });

  it('improve_basics carries an encouraging "you\'re getting it" line', () => {
    const out = buildScorecardSentence({
      goal: 'improve_basics',
      correct: 3,
      total: 5,
      scorePercent: 60,
      xpEarned: 30,
      isHi: false,
    });
    expect(out.en.toLowerCase()).toContain("you're getting it");
  });
});

describe('buildScorecardSentence — purity & isHi flag', () => {
  it('does not mutate the input object', () => {
    const input = {
      goal: 'school_topper' as GoalCode,
      correct: 7,
      total: 10,
      scorePercent: 70,
      xpEarned: 90,
      isHi: false,
    };
    const snapshot = JSON.stringify(input);
    buildScorecardSentence(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('isHi=true does NOT swap which language lives in en/hi', () => {
    // Spec: en/hi slots are stable; the flag is reserved for the caller to
    // decide which one to display first. Nothing in the returned object
    // should change between isHi=true and isHi=false.
    const a = buildScorecardSentence({
      goal: 'pass_comfortably',
      correct: 7,
      total: 10,
      scorePercent: 70,
      xpEarned: 90,
      isHi: false,
    });
    const b = buildScorecardSentence({
      goal: 'pass_comfortably',
      correct: 7,
      total: 10,
      scorePercent: 70,
      xpEarned: 90,
      isHi: true,
    });
    expect(b.en).toBe(a.en);
    expect(b.hi).toBe(a.hi);
    expect(b.tone).toBe(a.tone);
  });

  it('does not recompute score from correct/total (P1 — uses caller value)', () => {
    // If the function recomputed Math.round((correct/total)*100) it would get
    // 70. We pass an inconsistent scorePercent (99) on purpose — the output
    // must reflect the caller's value (99), not a recomputed one.
    const out = buildScorecardSentence({
      goal: 'school_topper',
      correct: 7,
      total: 10,
      scorePercent: 99,
      xpEarned: 90,
      isHi: false,
    });
    expect(out.en).toContain('99%');
    expect(out.en).not.toContain('70%');
  });
});
