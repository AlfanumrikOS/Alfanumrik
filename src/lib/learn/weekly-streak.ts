/**
 * Alfanumrik — Pedagogy v2 / Wave 2
 * Weekly streak state machine.
 *
 * The weekly streak (parallel to the existing daily streak at
 * students.streak_days) is intentionally forgiving: missing one or more
 * weeks does NOT immediately reset the count. Only after a hard gap
 * of more than MISS_TOLERANCE_WEEKS = 4 weeks does the streak reset.
 *
 * This insulates students from exam-week disruption — a Class 10 student
 * deep in board prep can skip a couple of weeks without losing their
 * weekly-dive streak. Rationale comes directly from spec §6
 * Principle 6 (no streak shame) and §11 Wave 2 success metrics
 * (≥35% of WAU produce a weekly artifact). A brittle streak counter
 * would burn the engagement signal it's supposed to capture.
 *
 * Pure function. ZERO IO, ZERO React.
 *
 * Spec: docs/superpowers/specs/2026-05-08-pedagogy-v2-three-speed-rhythm-design.md
 * Plan: docs/superpowers/plans/2026-05-09-pedagogy-v2-wave-2-weekly-dive.md
 */

/**
 * Maximum gap (in weeks) between two completions that still counts as a
 * continuing streak. With MISS_TOLERANCE_WEEKS = 4 and elapsed-weeks
 * counted as gap+1:
 *   - elapsed=1 (consecutive): increment
 *   - elapsed=2,3,4 (1, 2, 3 missed weeks): increment (tolerant)
 *   - elapsed≥5 (4+ missed weeks): RESET to 1
 *
 * The constant is exported so the test and any downstream surface that
 * communicates the rule to the student can read it.
 */
export const MISS_TOLERANCE_WEEKS = 4;

export interface WeeklyStreakState {
  count: number;
  /** ISO week 'YYYY-Www' of the most recent completion, or null if never completed. */
  lastIsoWeek: string | null;
}

// ─── ISO week → Monday-anchored UTC date (private helper) ──────────────────

function isoWeekToMondayUtc(isoWeek: string): Date {
  // 'YYYY-Www' → year + week number.
  const m = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`Invalid ISO week format: ${isoWeek}`);
  const isoYear = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);

  // ISO 8601 week 1 of year Y is the week containing 4 January.
  // Find the Monday of that week.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay(); // 1..7
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));

  // Add (week - 1) * 7 days.
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return target;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Return the integer number of weeks between two ISO-week strings.
 * Positive if `to` is later than `from`; zero for same week; negative if
 * `to` is earlier (callers in this module should only invoke with to ≥ from).
 */
export function weeksBetween(from: string, to: string): number {
  const fromMon = isoWeekToMondayUtc(from);
  const toMon = isoWeekToMondayUtc(to);
  const diffMs = toMon.getTime() - fromMon.getTime();
  return Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Apply a completion event for the given ISO week to the existing streak
 * state and return the new state. Pure: same input → same output, no IO.
 *
 * Cases:
 *   - lastIsoWeek === currentIsoWeek → idempotent (no change).
 *   - lastIsoWeek === null OR weeksBetween > MISS_TOLERANCE_WEEKS → reset to 1.
 *   - Otherwise → increment count by 1.
 *
 * Updates lastIsoWeek to currentIsoWeek in all non-idempotent cases.
 */
export function applyWeeklyCompletion(
  state: WeeklyStreakState,
  currentIsoWeek: string,
): WeeklyStreakState {
  if (state.lastIsoWeek === currentIsoWeek) {
    return state; // idempotent
  }

  if (state.lastIsoWeek === null) {
    return { count: 1, lastIsoWeek: currentIsoWeek };
  }

  const elapsed = weeksBetween(state.lastIsoWeek, currentIsoWeek);
  if (elapsed > MISS_TOLERANCE_WEEKS) {
    return { count: 1, lastIsoWeek: currentIsoWeek };
  }

  return { count: state.count + 1, lastIsoWeek: currentIsoWeek };
}
