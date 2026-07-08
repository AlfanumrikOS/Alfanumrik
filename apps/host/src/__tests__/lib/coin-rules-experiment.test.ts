/**
 * STEM Lab — Experiment Coin Rewards (Tier 1)
 *
 * Pins the coin rewards added for the STEM Lab engagement plan.
 *
 * Why these tests exist:
 * - P2 (XP/Coin Economy): every coin value lives ONLY in coin-rules.ts.
 *   Migration `20260504200000_stem_lab_engagement_tier1.sql` literal-copies
 *   these numbers into the `complete_experiment()` SQL RPC. If TS and SQL
 *   drift, learners get inconsistent rewards depending on whether the path
 *   ran client-side or DB-side. This file is the TS half of that parity pin
 *   (the SQL half is enforced by the migration's own assertions and by the
 *   REG-48-style drift detector pattern).
 * - Defensive against accidental rename: each new key is asserted by name.
 * - Anti-grind invariant: experiment_daily_cap must always be >= the maximum
 *   reward a perfect first-of-day guided experiment can pay out, otherwise
 *   the cap would silently swallow legitimate earnings.
 * - Streak monotonicity: lab streak rewards must strictly increase with
 *   length so longer commitment is always more rewarding than shorter.
 */

import { describe, it, expect } from 'vitest';
import { COIN_REWARDS } from '@alfanumrik/lib/coin-rules';

describe('COIN_REWARDS — STEM Lab Tier 1 (experiment + viva + lab streaks)', () => {
  describe('exact value regression pins (P2 — keep TS == SQL)', () => {
    it('experiment_complete = 20', () => {
      expect(COIN_REWARDS.experiment_complete).toBe(20);
    });

    it('guided_experiment_complete = 40', () => {
      expect(COIN_REWARDS.guided_experiment_complete).toBe(40);
    });

    it('viva_perfect_bonus = 25', () => {
      expect(COIN_REWARDS.viva_perfect_bonus).toBe(25);
    });

    it('first_experiment_of_day = 10', () => {
      expect(COIN_REWARDS.first_experiment_of_day).toBe(10);
    });

    it('experiment_subject_streak_5 = 50', () => {
      expect(COIN_REWARDS.experiment_subject_streak_5).toBe(50);
    });

    it('experiment_daily_cap = 100', () => {
      expect(COIN_REWARDS.experiment_daily_cap).toBe(100);
    });

    it('lab_streak_3_day = 15', () => {
      expect(COIN_REWARDS.lab_streak_3_day).toBe(15);
    });

    it('lab_streak_7_day = 40', () => {
      expect(COIN_REWARDS.lab_streak_7_day).toBe(40);
    });

    it('lab_streak_30_day = 150', () => {
      expect(COIN_REWARDS.lab_streak_30_day).toBe(150);
    });
  });

  describe('key presence (defends against rename)', () => {
    const expectedKeys = [
      'experiment_complete',
      'guided_experiment_complete',
      'viva_perfect_bonus',
      'first_experiment_of_day',
      'experiment_subject_streak_5',
      'experiment_daily_cap',
      'lab_streak_3_day',
      'lab_streak_7_day',
      'lab_streak_30_day',
    ] as const;

    for (const key of expectedKeys) {
      it(`COIN_REWARDS.${key} is defined`, () => {
        expect(COIN_REWARDS[key]).toBeDefined();
        expect(typeof COIN_REWARDS[key]).toBe('number');
      });
    }
  });

  describe('anti-grind invariant', () => {
    it('experiment_daily_cap >= guided + viva_perfect + first_of_day (perfect first-of-day always pays in full)', () => {
      const perfectFirstOfDay =
        COIN_REWARDS.guided_experiment_complete +
        COIN_REWARDS.viva_perfect_bonus +
        COIN_REWARDS.first_experiment_of_day;

      expect(COIN_REWARDS.experiment_daily_cap).toBeGreaterThanOrEqual(
        perfectFirstOfDay
      );
    });
  });

  describe('lab streak monotonicity (longer streak = more coins)', () => {
    it('lab_streak_30_day > lab_streak_7_day > lab_streak_3_day', () => {
      expect(COIN_REWARDS.lab_streak_30_day).toBeGreaterThan(
        COIN_REWARDS.lab_streak_7_day
      );
      expect(COIN_REWARDS.lab_streak_7_day).toBeGreaterThan(
        COIN_REWARDS.lab_streak_3_day
      );
    });
  });
});
