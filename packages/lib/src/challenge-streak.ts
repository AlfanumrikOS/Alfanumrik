/**
 * ALFANUMRIK -- Daily Challenge Streak Logic
 *
 * Pure functions for managing daily challenge streaks:
 * - Streak progression (consecutive day tracking)
 * - Mercy day system (grade-dependent, weekly reset)
 * - Milestone detection (badges at 7, 30, 100 days)
 * - Streak visibility rules
 *
 * All functions are pure (no side effects, no DB calls).
 * Configuration constants come from challenge-config.ts.
 * Grades are always strings per P5.
 */

import {
  STREAK_MILESTONES,
  STREAK_VISIBILITY_THRESHOLD,
  getMercyDaysForGrade,
  type StreakMilestone,
} from './challenge-config';

// ---- Types ----

/** Complete streak state for a student. */
export interface StreakState {
  /** Current consecutive challenge streak. */
  currentStreak: number;
  /** All-time best streak. */
  bestStreak: number;
  /** ISO date string of last completed challenge, or null if never. */
  lastChallengeDate: string | null;
  /** Number of mercy days used in the current week. */
  mercyDaysUsedThisWeek: number;
  /** ISO date string of the Monday that starts the current mercy week, or null. */
  mercyWeekStart: string | null;
  /** Array of earned badge IDs. */
  badges: string[];
}

// ---- Internal Helpers ----

/**
 * Format a Date as a local YYYY-MM-DD string (timezone-safe).
 */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Calculate the number of calendar days between two date strings.
 * Returns positive if todayStr is after lastDateStr.
 * Uses UTC parsing to avoid timezone drift.
 */
function dayDifference(lastDateStr: string, todayStr: string): number {
  // Parse as UTC to get consistent calendar-day arithmetic
  const last = Date.UTC(
    parseInt(lastDateStr.slice(0, 4)),
    parseInt(lastDateStr.slice(5, 7)) - 1,
    parseInt(lastDateStr.slice(8, 10))
  );
  const today = Date.UTC(
    parseInt(todayStr.slice(0, 4)),
    parseInt(todayStr.slice(5, 7)) - 1,
    parseInt(todayStr.slice(8, 10))
  );
  return Math.round((today - last) / (1000 * 60 * 60 * 24));
}

/**
 * Get the Monday of the week containing the given date string.
 * Uses ISO week (Monday = start of week).
 * Returns a local YYYY-MM-DD string (timezone-safe).
 */
function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00'); // noon to avoid DST edge cases
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setDate(d.getDate() - diff);
  return formatLocalDate(d);
}

// ---- Streak Processing ----

/**
 * Processes a daily challenge completion and returns the updated streak state.
 *
 * Rules:
 * - Same day: no change
 * - Consecutive day (diff=1): increment streak
 * - Missed 1 day (diff=2): use mercy if available, otherwise break streak
 * - Missed 2+ days (diff>=3): break streak (reset to 1)
 * - First ever challenge: set streak to 1
 * - Updates bestStreak if currentStreak exceeds it
 * - Resets mercy counter on new week (Monday-based)
 *
 * @param state Current streak state
 * @param todayStr ISO date string for today (e.g., "2026-04-16")
 * @param grade Student's grade as string ("6" through "12") per P5
 * @returns Updated StreakState
 */
export function processStreakDay(state: StreakState, todayStr: string, grade: string): StreakState {
  const newState: StreakState = { ...state, badges: [...state.badges] };

  // First ever challenge
  if (!state.lastChallengeDate) {
    newState.currentStreak = 1;
    newState.bestStreak = Math.max(state.bestStreak, 1);
    newState.lastChallengeDate = todayStr;
    newState.mercyWeekStart = getMondayOfWeek(todayStr);
    return newState;
  }

  const diff = dayDifference(state.lastChallengeDate, todayStr);

  // Same day -- no change
  if (diff === 0) {
    return newState;
  }

  // Reset mercy counter if we're in a new week
  const currentMonday = getMondayOfWeek(todayStr);
  if (state.mercyWeekStart !== currentMonday) {
    newState.mercyDaysUsedThisWeek = 0;
    newState.mercyWeekStart = currentMonday;
  }

  if (diff === 1) {
    // Consecutive day -- simple increment
    newState.currentStreak = state.currentStreak + 1;
  } else if (diff === 2) {
    // Missed exactly 1 day -- check mercy eligibility
    if (checkMercyEligibility(newState.mercyDaysUsedThisWeek, 1, grade)) {
      newState.currentStreak = state.currentStreak + 1;
      newState.mercyDaysUsedThisWeek += 1;
    } else {
      // Mercy not available -- streak breaks
      newState.currentStreak = 1;
    }
  } else {
    // Missed 2+ days (diff >= 3) -- streak breaks
    newState.currentStreak = 1;
  }

  newState.lastChallengeDate = todayStr;
  newState.bestStreak = Math.max(newState.bestStreak, newState.currentStreak);

  return newState;
}

// ---- Mercy Eligibility ----

/**
 * Checks whether a mercy day can be used.
 *
 * @param mercyUsedThisWeek Number of mercy days already used this week
 * @param daysMissed Number of days missed (must be exactly 1 for mercy to apply)
 * @param grade Student's grade as string per P5
 * @returns true if mercy can be used
 */
export function checkMercyEligibility(
  mercyUsedThisWeek: number,
  daysMissed: number,
  grade: string
): boolean {
  // Mercy only applies to exactly 1 missed day
  if (daysMissed !== 1) return false;

  const allowedMercyDays = getMercyDaysForGrade(grade);
  return mercyUsedThisWeek < allowedMercyDays;
}

// ---- Milestone Detection ----

/**
 * Detects newly crossed streak milestones.
 * Returns milestones that were crossed (previousStreak < threshold <= newStreak)
 * and are not already in the student's badge list.
 *
 * @param previousStreak Streak before the current update
 * @param newStreak Streak after the current update
 * @param existingBadges Array of badge IDs already earned
 * @returns Array of newly earned StreakMilestone objects
 */
export function detectMilestones(
  previousStreak: number,
  newStreak: number,
  existingBadges: string[]
): StreakMilestone[] {
  const existingSet = new Set(existingBadges);

  return STREAK_MILESTONES.filter(milestone => {
    // Milestone must be newly crossed: was below before, now at or above
    const wasBelowBefore = previousStreak < milestone.days;
    const isAtOrAboveNow = newStreak >= milestone.days;
    const notAlreadyEarned = !existingSet.has(milestone.badgeId);

    return wasBelowBefore && isAtOrAboveNow && notAlreadyEarned;
  });
}

// ---- Streak Visibility ----

/**
 * Returns whether the streak should be displayed to the student.
 * Streaks below the threshold are not shown (avoids "1-day streak" clutter).
 *
 * @param streak Current streak count
 * @returns true if the streak should be shown in the UI
 */
export function shouldShowStreak(streak: number): boolean {
  return streak >= STREAK_VISIBILITY_THRESHOLD;
}
