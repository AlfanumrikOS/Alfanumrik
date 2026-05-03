/**
 * Tests for src/lib/goals/goal-personas.ts
 *
 * Owner: assessment
 * Founder constraint: pure new test file. Validates the expanded Foxy persona
 * (Phase 1 of Goal-Adaptive Learning Layers) without modifying any existing
 * source.
 *
 * Coverage targets:
 *  - Every (goal × mode) pair returns a non-empty string ≤ 800 chars
 *  - buildExpandedGoalSection returns "" for unknown goal or unknown mode
 *  - Persona text contains a goal-specific keyword that proves it isn't a
 *    generic copy/paste (e.g. "marking scheme" for board_topper)
 *  - Wrapper output includes the section header for valid inputs
 */

import { describe, it, expect } from 'vitest';
import {
  buildExpandedPersona,
  buildExpandedGoalSection,
  type FoxyMode,
} from '@/lib/goals/goal-personas';
import type { GoalCode } from '@/lib/goals/goal-profile';

const GOALS: GoalCode[] = [
  'board_topper',
  'school_topper',
  'pass_comfortably',
  'competitive_exam',
  'olympiad',
  'improve_basics',
];

const MODES: FoxyMode[] = [
  'learn',
  'explain',
  'practice',
  'revise',
  'doubt',
  'homework',
];

const PAIRS: Array<[GoalCode, FoxyMode]> = GOALS.flatMap((g) =>
  MODES.map((m) => [g, m] as [GoalCode, FoxyMode]),
);

describe('buildExpandedPersona', () => {
  it.each(PAIRS)(
    '(%s × %s) returns non-empty string within 800 chars',
    (goal, mode) => {
      const out = buildExpandedPersona(goal, mode);
      expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBeLessThanOrEqual(800);
    },
  );

  it.each(PAIRS)('(%s × %s) covers all four persona dimensions', (goal, mode) => {
    const out = buildExpandedPersona(goal, mode);
    expect(out).toContain('Tone:');
    expect(out).toContain('Pacing:');
    expect(out).toContain('Challenge:');
    expect(out).toContain('Mistakes:');
  });

  it.each(MODES)('mode %s leaves a mode-specific marker in the prompt', (mode) => {
    const out = buildExpandedPersona('school_topper', mode);
    expect(out).toContain(`Mode emphasis (${mode})`);
  });

  // Goal-specific keyword fingerprints — proves the per-goal text is
  // distinct, not boilerplate. These are case-insensitive substring checks
  // against author-written persona literals.
  const FINGERPRINTS: Record<GoalCode, RegExp> = {
    improve_basics: /micro-step|prerequisite|patient/i,
    pass_comfortably: /board|high-frequency|reassuring/i,
    school_topper: /application|push|analy/i,
    board_topper: /marking[- ]scheme|examiner/i,
    competitive_exam: /jee|neet|shortcut|time/i,
    olympiad: /alternate solution|puzzle|socratic|productive struggle/i,
  };

  it.each(GOALS)('%s persona contains a goal-specific keyword', (goal) => {
    const out = buildExpandedPersona(goal, 'learn');
    expect(out).toMatch(FINGERPRINTS[goal]);
  });

  it('different goals produce different persona text', () => {
    const a = buildExpandedPersona('board_topper', 'learn');
    const b = buildExpandedPersona('improve_basics', 'learn');
    expect(a).not.toBe(b);
  });

  it('different modes produce different persona text for the same goal', () => {
    const a = buildExpandedPersona('school_topper', 'practice');
    const b = buildExpandedPersona('school_topper', 'revise');
    expect(a).not.toBe(b);
  });
});

describe('buildExpandedGoalSection (safe wrapper)', () => {
  it('returns "" for null goal', () => {
    expect(buildExpandedGoalSection(null, 'learn')).toBe('');
  });

  it('returns "" for undefined goal', () => {
    expect(buildExpandedGoalSection(undefined, 'learn')).toBe('');
  });

  it('returns "" for empty goal', () => {
    expect(buildExpandedGoalSection('', 'learn')).toBe('');
  });

  it('returns "" for unknown goal', () => {
    expect(buildExpandedGoalSection('not_a_goal', 'learn')).toBe('');
  });

  it('returns "" for unknown mode (even with a valid goal)', () => {
    expect(buildExpandedGoalSection('board_topper', 'not_a_mode')).toBe('');
  });

  it.each(PAIRS)(
    'returns wrapped section for known (%s × %s)',
    (goal, mode) => {
      const out = buildExpandedGoalSection(goal, mode);
      expect(out.length).toBeGreaterThan(0);
      expect(out).toContain("## Student's Academic Goal");
      expect(out).toContain(goal);
      expect(out.startsWith('\n')).toBe(true);
      expect(out.endsWith('\n')).toBe(true);
    },
  );

  it('section + 800-char block stays under a reasonable budget', () => {
    // The wrapped section adds a header (~80 chars) — full block should
    // remain well under 1KB so the system prompt stays cheap.
    const out = buildExpandedGoalSection('competitive_exam', 'practice');
    expect(out.length).toBeLessThan(1024);
  });

  it('never throws on garbage input', () => {
    expect(() =>
      // @ts-expect-error intentional bad input
      buildExpandedGoalSection(42, 'learn'),
    ).not.toThrow();
    expect(() =>
      // @ts-expect-error intentional bad input
      buildExpandedGoalSection('board_topper', null),
    ).not.toThrow();
  });
});
