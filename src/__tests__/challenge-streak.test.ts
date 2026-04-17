import { describe, it, expect } from 'vitest';
import {
  processStreakDay,
  checkMercyEligibility,
  detectMilestones,
  shouldShowStreak,
  type StreakState,
} from '@/lib/challenge-streak';
import { STREAK_MILESTONES, STREAK_VISIBILITY_THRESHOLD } from '@/lib/challenge-config';

/**
 * Challenge Streak Logic Tests
 *
 * Tests streak progression, mercy day preservation,
 * milestone detection, and visibility rules.
 */

// ---- Test Helpers ----

function makeBaseState(overrides: Partial<StreakState> = {}): StreakState {
  return {
    currentStreak: 0,
    bestStreak: 0,
    lastChallengeDate: null,
    mercyDaysUsedThisWeek: 0,
    mercyWeekStart: null,
    badges: [],
    ...overrides,
  };
}

/**
 * Returns a date string N days after the given base date string.
 */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// ---- processStreakDay ----

describe('processStreakDay', () => {
  it('first ever challenge sets streak to 1', () => {
    const state = makeBaseState();
    const result = processStreakDay(state, '2026-04-16', '9');
    expect(result.currentStreak).toBe(1);
    expect(result.lastChallengeDate).toBe('2026-04-16');
  });

  it('consecutive day increments streak', () => {
    const state = makeBaseState({
      currentStreak: 5,
      bestStreak: 5,
      lastChallengeDate: '2026-04-15',
    });
    const result = processStreakDay(state, '2026-04-16', '9');
    expect(result.currentStreak).toBe(6);
    expect(result.lastChallengeDate).toBe('2026-04-16');
  });

  it('same day does not change streak', () => {
    const state = makeBaseState({
      currentStreak: 5,
      bestStreak: 10,
      lastChallengeDate: '2026-04-16',
    });
    const result = processStreakDay(state, '2026-04-16', '9');
    expect(result.currentStreak).toBe(5);
    expect(result.bestStreak).toBe(10);
  });

  it('missed 1 day (diff=2) uses mercy for grade "6" (has 2 mercy days)', () => {
    const state = makeBaseState({
      currentStreak: 10,
      bestStreak: 10,
      lastChallengeDate: '2026-04-14', // 2 days ago
    });
    const result = processStreakDay(state, '2026-04-16', '6');
    // Grade 6 has 2 mercy days, 0 used this week, should preserve streak
    expect(result.currentStreak).toBe(11);
    expect(result.mercyDaysUsedThisWeek).toBe(1);
  });

  it('missed 1 day (diff=2) uses mercy for grade "9" (has 1 mercy day)', () => {
    const state = makeBaseState({
      currentStreak: 10,
      bestStreak: 10,
      lastChallengeDate: '2026-04-14',
    });
    const result = processStreakDay(state, '2026-04-16', '9');
    expect(result.currentStreak).toBe(11);
    expect(result.mercyDaysUsedThisWeek).toBe(1);
  });

  it('missed 1 day breaks streak when mercy exhausted for grade "9"', () => {
    const state = makeBaseState({
      currentStreak: 10,
      bestStreak: 15,
      lastChallengeDate: '2026-04-14',
      mercyDaysUsedThisWeek: 1, // already used 1, grade 9 only gets 1
      mercyWeekStart: '2026-04-13', // same week
    });
    const result = processStreakDay(state, '2026-04-16', '9');
    expect(result.currentStreak).toBe(1);
    expect(result.bestStreak).toBe(15); // best preserved
  });

  it('missed 1 day does NOT break streak when grade "6" has mercy left (2 total)', () => {
    const state = makeBaseState({
      currentStreak: 10,
      bestStreak: 10,
      lastChallengeDate: '2026-04-14',
      mercyDaysUsedThisWeek: 1, // used 1, grade 6 gets 2
      mercyWeekStart: '2026-04-13',
    });
    const result = processStreakDay(state, '2026-04-16', '6');
    expect(result.currentStreak).toBe(11);
    expect(result.mercyDaysUsedThisWeek).toBe(2);
  });

  it('missed 2+ days (diff >= 3) always breaks streak', () => {
    const state = makeBaseState({
      currentStreak: 20,
      bestStreak: 20,
      lastChallengeDate: '2026-04-13', // 3 days ago
    });
    const result = processStreakDay(state, '2026-04-16', '6');
    expect(result.currentStreak).toBe(1);
    expect(result.bestStreak).toBe(20); // preserved
  });

  it('updates bestStreak when current exceeds it', () => {
    const state = makeBaseState({
      currentStreak: 9,
      bestStreak: 9,
      lastChallengeDate: '2026-04-15',
    });
    const result = processStreakDay(state, '2026-04-16', '9');
    expect(result.currentStreak).toBe(10);
    expect(result.bestStreak).toBe(10);
  });

  it('does not lower bestStreak when streak breaks', () => {
    const state = makeBaseState({
      currentStreak: 5,
      bestStreak: 50,
      lastChallengeDate: '2026-04-10', // 6 days ago
    });
    const result = processStreakDay(state, '2026-04-16', '9');
    expect(result.currentStreak).toBe(1);
    expect(result.bestStreak).toBe(50);
  });

  it('resets mercy counter on new week (Monday-based)', () => {
    // mercyWeekStart is a Monday (2026-04-06), today is next Monday (2026-04-13)
    const state = makeBaseState({
      currentStreak: 5,
      bestStreak: 5,
      lastChallengeDate: '2026-04-12', // Saturday
      mercyDaysUsedThisWeek: 1,
      mercyWeekStart: '2026-04-06', // Previous Monday
    });
    // 2026-04-13 is a Monday (new week)
    const result = processStreakDay(state, '2026-04-13', '9');
    expect(result.mercyDaysUsedThisWeek).toBe(0);
    expect(result.currentStreak).toBe(6);
  });
});

// ---- checkMercyEligibility ----

describe('checkMercyEligibility', () => {
  it('returns true when mercy is available for grade "6" (2 mercy days, 0 used)', () => {
    expect(checkMercyEligibility(0, 1, '6')).toBe(true);
  });

  it('returns true when grade "6" has 1 mercy used (1 < 2 allowed)', () => {
    expect(checkMercyEligibility(1, 1, '6')).toBe(true);
  });

  it('returns false when grade "6" has 2 mercy used (2 >= 2 allowed)', () => {
    expect(checkMercyEligibility(2, 1, '6')).toBe(false);
  });

  it('returns true when grade "9" has 0 mercy used (0 < 1 allowed)', () => {
    expect(checkMercyEligibility(0, 1, '9')).toBe(true);
  });

  it('returns false when grade "9" has 1 mercy used (1 >= 1 allowed)', () => {
    expect(checkMercyEligibility(1, 1, '9')).toBe(false);
  });

  it('returns false when more than 1 day was missed', () => {
    expect(checkMercyEligibility(0, 2, '6')).toBe(false);
  });

  it('returns false when 0 days were missed', () => {
    expect(checkMercyEligibility(0, 0, '6')).toBe(false);
  });
});

// ---- detectMilestones ----

describe('detectMilestones', () => {
  it('detects 7-day milestone when crossing from 6 to 7', () => {
    const milestones = detectMilestones(6, 7, []);
    expect(milestones).toHaveLength(1);
    expect(milestones[0].badgeId).toBe('bronze_7');
    expect(milestones[0].days).toBe(7);
  });

  it('detects 30-day milestone when crossing from 29 to 30', () => {
    const milestones = detectMilestones(29, 30, []);
    expect(milestones).toHaveLength(1);
    expect(milestones[0].badgeId).toBe('silver_30');
  });

  it('detects 100-day milestone when crossing from 99 to 100', () => {
    const milestones = detectMilestones(99, 100, []);
    expect(milestones).toHaveLength(1);
    expect(milestones[0].badgeId).toBe('gold_100');
  });

  it('detects multiple milestones when jumping (e.g., 6 to 31)', () => {
    // This scenario is unusual but possible with restored streaks
    const milestones = detectMilestones(6, 31, []);
    expect(milestones).toHaveLength(2);
    const badgeIds = milestones.map(m => m.badgeId);
    expect(badgeIds).toContain('bronze_7');
    expect(badgeIds).toContain('silver_30');
  });

  it('does not re-award existing badges', () => {
    const milestones = detectMilestones(6, 7, ['bronze_7']);
    expect(milestones).toHaveLength(0);
  });

  it('returns empty when no milestones are crossed', () => {
    const milestones = detectMilestones(3, 4, []);
    expect(milestones).toHaveLength(0);
  });

  it('returns empty when streak decreases', () => {
    const milestones = detectMilestones(10, 1, []);
    expect(milestones).toHaveLength(0);
  });

  it('does not detect milestone when already at milestone value', () => {
    // previousStreak = 7, newStreak = 7 -- no crossing
    const milestones = detectMilestones(7, 7, []);
    expect(milestones).toHaveLength(0);
  });
});

// ---- shouldShowStreak ----

describe('shouldShowStreak', () => {
  it('returns false for streak of 0', () => {
    expect(shouldShowStreak(0)).toBe(false);
  });

  it('returns false for streak of 1', () => {
    expect(shouldShowStreak(1)).toBe(false);
  });

  it('returns false for streak of 2', () => {
    expect(shouldShowStreak(2)).toBe(false);
  });

  it('returns true for streak of 3 (equals threshold)', () => {
    expect(shouldShowStreak(3)).toBe(true);
  });

  it('returns true for streak of 100', () => {
    expect(shouldShowStreak(100)).toBe(true);
  });

  it('threshold matches STREAK_VISIBILITY_THRESHOLD constant', () => {
    expect(shouldShowStreak(STREAK_VISIBILITY_THRESHOLD)).toBe(true);
    expect(shouldShowStreak(STREAK_VISIBILITY_THRESHOLD - 1)).toBe(false);
  });
});
