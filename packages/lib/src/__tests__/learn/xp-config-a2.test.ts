/**
 * A2 XP additions pins (Foxy North-Star Phase 3; CEO approval A2 2026-08-05).
 *
 * P2 invariant surface — these constants exist ONLY in xp-config.ts and the
 * approved values/caps are pinned here. Economy shape: the full A2 package
 * caps at 71 XP/day vs the 200 XP/day quiz cap — retention/recovery are
 * accents, not the economy. Changing ANY value below requires fresh user
 * (CEO) approval per the P1-P13 approval gate.
 */

import { describe, it, expect } from 'vitest';
import { XP_RULES } from '../../xp-config';

describe('A2 XP additions — approved values', () => {
  it('review_graded: 2 XP, capped at 20/day (10 rewarded reviews)', () => {
    expect(XP_RULES.review_graded_xp).toBe(2);
    expect(XP_RULES.review_graded_daily_cap).toBe(20);
  });

  it('remediation_recovered: 8 XP, capped at 16/day (2 recoveries)', () => {
    expect(XP_RULES.remediation_recovered_xp).toBe(8);
    expect(XP_RULES.remediation_recovered_daily_cap).toBe(16);
  });

  it('unhinted_mastery: 2 XP bonus, capped at 30/day (15 unhinted corrects)', () => {
    expect(XP_RULES.unhinted_mastery_bonus).toBe(2);
    expect(XP_RULES.unhinted_mastery_daily_cap).toBe(30);
  });

  it('thoughtful_question: 5 XP, capped at 5/day (exactly one — un-grindable)', () => {
    expect(XP_RULES.thoughtful_question_xp).toBe(5);
    expect(XP_RULES.thoughtful_question_daily_cap).toBe(5);
  });
});

describe('A2 XP additions — economy shape', () => {
  it('package daily-cap sum is <= 71 XP (accents, not the economy)', () => {
    const sum =
      XP_RULES.review_graded_daily_cap +
      XP_RULES.remediation_recovered_daily_cap +
      XP_RULES.unhinted_mastery_daily_cap +
      XP_RULES.thoughtful_question_daily_cap;
    expect(sum).toBe(71);
    expect(sum).toBeLessThanOrEqual(71);
    expect(sum).toBeLessThan(XP_RULES.quiz_daily_cap); // 71 < 200
  });

  it('each per-award value divides cleanly into its cap (whole rewarded events)', () => {
    expect(XP_RULES.review_graded_daily_cap % XP_RULES.review_graded_xp).toBe(0);
    expect(XP_RULES.remediation_recovered_daily_cap % XP_RULES.remediation_recovered_xp).toBe(0);
    expect(XP_RULES.unhinted_mastery_daily_cap % XP_RULES.unhinted_mastery_bonus).toBe(0);
    expect(XP_RULES.thoughtful_question_daily_cap % XP_RULES.thoughtful_question_xp).toBe(0);
  });

  it('does not disturb the P2 quiz economy or the U9 zero-presence rules', () => {
    expect(XP_RULES.quiz_per_correct).toBe(10);
    expect(XP_RULES.quiz_high_score_bonus).toBe(20);
    expect(XP_RULES.quiz_perfect_bonus).toBe(50);
    expect(XP_RULES.quiz_daily_cap).toBe(200);
    expect(XP_RULES.foxy_chat).toBe(0); // no XP for raw chat (U9)
    expect(XP_RULES.streak_daily).toBe(0); // no XP for login presence (U9)
  });
});
