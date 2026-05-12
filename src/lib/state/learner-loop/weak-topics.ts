/**
 * src/lib/state/learner-loop/weak-topics.ts — pure "weakest topics first"
 * helper. Phase 5 of ADR-001.
 *
 * Used by:
 *   - GET /api/learner/weak-topics (this PR's endpoint)
 *   - A future PR's Concept Chain node selector (personalised daily
 *     challenges drawn from the learner's weak set)
 *   - A future PR's leaderboard mastery-percentile tab
 *
 * Why a separate module: the resolver's `weakestChapter()` returns ONE
 * chapter (the absolute weakest). Compete + leaderboard want the
 * full sorted list with rich metadata per row (subject, chapter,
 * attempts, last-touched). This module is that list builder.
 *
 * Pure. No I/O. Operates on a StudentState snapshot — same input the
 * resolver uses so /api/learner/weak-topics and /api/learner/next
 * never disagree about which topics are weak.
 */

import type { StudentState } from '../student-state';

export interface WeakTopic {
  subjectCode: string;
  chapterNumber: number;
  mastery: number;
  attempts: number;
  lastUpdatedAt: string | null;
}

export interface WeakTopicsOptions {
  /** Maximum number of topics to return. Defaults to 10 — past this
   *  is Compete-noise. */
  limit?: number;
  /** Upper-bound on mastery for a topic to be considered "weak". Topics
   *  at or above this threshold are filtered out. Defaults to 0.6
   *  (matches the resolver's REVISE_MIN_MASTERY floor — anything above
   *  is "strong enough" to be a revise candidate, not a weak topic). */
  weakBelow?: number;
  /** Minimum attempts on a topic before it counts. Defaults to 1 — a
   *  topic the learner has never touched can't be a "weak" topic for
   *  Compete purposes (it's an "unexplored" topic, a different bucket). */
  minAttempts?: number;
}

/**
 * Return weak topics for a learner, sorted by mastery ASC (weakest
 * first). Pure: same StudentState in → same output.
 *
 * A "weak" topic has:
 *   - mastery in [0, weakBelow) (strictly below the threshold)
 *   - at least minAttempts prior attempts (not unexplored)
 *
 * Topics where mastery is null are skipped — that's "unexplored", not
 * "weak". A future PR may surface unexplored topics separately for the
 * curiosity-driven content discovery loop.
 */
export function weakTopicsForStudent(
  state: StudentState,
  options: WeakTopicsOptions = {},
): WeakTopic[] {
  const limit = options.limit ?? 10;
  const weakBelow = options.weakBelow ?? 0.6;
  const minAttempts = options.minAttempts ?? 1;

  const out: WeakTopic[] = [];
  for (const subject of state.mastery) {
    for (const chapter of subject.chapters) {
      if (chapter.mastery === null) continue;
      if (chapter.mastery >= weakBelow) continue;
      if (chapter.attempts < minAttempts) continue;
      out.push({
        subjectCode: subject.subjectCode,
        chapterNumber: chapter.chapterNumber,
        mastery: chapter.mastery,
        attempts: chapter.attempts,
        lastUpdatedAt: chapter.lastUpdatedAt,
      });
    }
  }
  // Weakest first; tie-break by most attempts DESC (more data = more
  // confidence the learner truly struggles here, not a one-shot fluke).
  out.sort((a, b) => {
    if (a.mastery !== b.mastery) return a.mastery - b.mastery;
    return b.attempts - a.attempts;
  });
  return out.slice(0, limit);
}
