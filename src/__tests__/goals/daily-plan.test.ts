/**
 * Tests for src/lib/goals/daily-plan.ts
 *
 * Verifies per-goal plan composition, bilingual P7 compliance, ±15% minutes
 * tolerance, deterministic clock injection, and the empty-shape contract for
 * null/unknown goals.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDailyPlan,
  buildDailyPlanByCode,
  type DailyPlan,
  type DailyPlanItemKind,
} from '@/lib/goals/daily-plan';
import { GOAL_PROFILES, type GoalCode } from '@/lib/goals/goal-profile';

const ALL_GOALS: GoalCode[] = [
  'improve_basics',
  'pass_comfortably',
  'school_topper',
  'board_topper',
  'competitive_exam',
  'olympiad',
];

const DEVANAGARI_RE = /[ऀ-ॿ]/;
const ALLOWED_KINDS: ReadonlyArray<DailyPlanItemKind> = [
  'pyq',
  'concept',
  'practice',
  'challenge',
  'review',
  'reflection',
];

describe('buildDailyPlan / buildDailyPlanByCode', () => {
  describe('per-goal plan composition (matches authored spec)', () => {
    it.each(ALL_GOALS)('builds a non-empty plan for %s', (code) => {
      const profile = GOAL_PROFILES[code];
      const plan = buildDailyPlan(profile);
      expect(plan.goal).toBe(code);
      expect(plan.items.length).toBeGreaterThan(0);
      expect(plan.totalMinutes).toBe(
        plan.items.reduce((sum, it) => sum + it.estimatedMinutes, 0),
      );
    });

    it('improve_basics → 2 items totalling 10 min', () => {
      const plan = buildDailyPlan(GOAL_PROFILES.improve_basics);
      expect(plan.items.length).toBe(2);
      expect(plan.totalMinutes).toBe(10);
      expect(plan.items.map((i) => i.kind)).toEqual(['concept', 'review']);
    });

    it('pass_comfortably → 3 items totalling 20 min', () => {
      const plan = buildDailyPlan(GOAL_PROFILES.pass_comfortably);
      expect(plan.items.length).toBe(3);
      expect(plan.totalMinutes).toBe(20);
      expect(plan.items.map((i) => i.kind)).toEqual([
        'concept',
        'practice',
        'review',
      ]);
    });

    it('school_topper → 3 items totalling 30 min', () => {
      const plan = buildDailyPlan(GOAL_PROFILES.school_topper);
      expect(plan.items.length).toBe(3);
      expect(plan.totalMinutes).toBe(30);
    });

    it('board_topper → 4 items totalling 45 min, includes pyq + reflection', () => {
      const plan = buildDailyPlan(GOAL_PROFILES.board_topper);
      expect(plan.items.length).toBe(4);
      expect(plan.totalMinutes).toBe(45);
      expect(plan.items.map((i) => i.kind)).toEqual([
        'pyq',
        'practice',
        'review',
        'reflection',
      ]);
    });

    it('competitive_exam → 4 items totalling 60 min', () => {
      const plan = buildDailyPlan(GOAL_PROFILES.competitive_exam);
      expect(plan.items.length).toBe(4);
      expect(plan.totalMinutes).toBe(60);
    });

    it('olympiad → 4 items totalling 60 min, includes challenge + reflection', () => {
      const plan = buildDailyPlan(GOAL_PROFILES.olympiad);
      expect(plan.items.length).toBe(4);
      expect(plan.totalMinutes).toBe(60);
      expect(plan.items.map((i) => i.kind)).toContain('challenge');
      expect(plan.items.map((i) => i.kind)).toContain('reflection');
    });
  });

  describe('±15% minutes tolerance vs dailyTargetMinutes', () => {
    it.each(ALL_GOALS)('%s totalMinutes within ±15%% of dailyTargetMinutes', (code) => {
      const profile = GOAL_PROFILES[code];
      const plan = buildDailyPlan(profile);
      const target = profile.dailyTargetMinutes;
      const lower = target * 0.85;
      const upper = target * 1.15;
      expect(plan.totalMinutes).toBeGreaterThanOrEqual(lower);
      expect(plan.totalMinutes).toBeLessThanOrEqual(upper);
    });
  });

  describe('P7 bilingual + content rules', () => {
    it.each(ALL_GOALS)('%s: every item has non-empty en + hi labels', (code) => {
      const plan = buildDailyPlan(GOAL_PROFILES[code]);
      for (const item of plan.items) {
        expect(item.titleEn.length).toBeGreaterThan(0);
        expect(item.titleHi.length).toBeGreaterThan(0);
      }
    });

    it.each(ALL_GOALS)('%s: first item titleHi uses Devanagari script', (code) => {
      const plan = buildDailyPlan(GOAL_PROFILES[code]);
      expect(plan.items[0].titleHi).toMatch(DEVANAGARI_RE);
    });

    it.each(ALL_GOALS)('%s: every item kind is one of the allowed enum values', (code) => {
      const plan = buildDailyPlan(GOAL_PROFILES[code]);
      for (const item of plan.items) {
        expect(ALLOWED_KINDS).toContain(item.kind);
      }
    });

    it.each(ALL_GOALS)('%s: every rationale contains the goal code', (code) => {
      const plan = buildDailyPlan(GOAL_PROFILES[code]);
      for (const item of plan.items) {
        expect(item.rationale).toContain(`goal=${code}`);
        expect(item.rationale).toContain(`kind=${item.kind}`);
      }
    });
  });

  describe('buildDailyPlanByCode — null/unknown handling', () => {
    it('null returns empty shape', () => {
      const plan = buildDailyPlanByCode(null);
      expect(plan).toEqual<Partial<DailyPlan>>({
        goal: null,
        totalMinutes: 0,
        items: [],
        generatedAt: expect.any(String),
      });
    });

    it('undefined returns empty shape', () => {
      const plan = buildDailyPlanByCode(undefined);
      expect(plan.goal).toBeNull();
      expect(plan.items).toEqual([]);
      expect(plan.totalMinutes).toBe(0);
    });

    it('unknown goal code returns empty shape (no throw)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plan = buildDailyPlanByCode('not_a_real_goal' as any);
      expect(plan.goal).toBeNull();
      expect(plan.items).toEqual([]);
    });

    it('valid goal code returns the same shape as buildDailyPlan(profile)', () => {
      const fixed = new Date('2026-05-03T12:00:00.000Z');
      const a = buildDailyPlanByCode('board_topper', { now: () => fixed });
      const b = buildDailyPlan(GOAL_PROFILES.board_topper, { now: () => fixed });
      expect(a).toEqual(b);
    });
  });

  describe('clock injection (test seam)', () => {
    it('honors opts.now for generatedAt', () => {
      const fixed = new Date('2026-01-15T08:30:00.000Z');
      const plan = buildDailyPlan(GOAL_PROFILES.board_topper, {
        now: () => fixed,
      });
      expect(plan.generatedAt).toBe('2026-01-15T08:30:00.000Z');
    });

    it('two builds with the same fixed clock are identical', () => {
      const fixed = new Date('2026-01-15T08:30:00.000Z');
      const a = buildDailyPlan(GOAL_PROFILES.olympiad, { now: () => fixed });
      const b = buildDailyPlan(GOAL_PROFILES.olympiad, { now: () => fixed });
      expect(a).toEqual(b);
    });

    it('without opts.now uses real time (ISO format)', () => {
      const plan = buildDailyPlan(GOAL_PROFILES.school_topper);
      expect(plan.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
