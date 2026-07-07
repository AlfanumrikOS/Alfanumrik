/**
 * mastery-buckets — pure helpers that re-present (not re-compute) the output
 * of the existing `get_mastery_overview` RPC for the Alfa OS redesign.
 *
 * The RPC returns one row per curriculum topic with the shape:
 *   {
 *     topic_id, title, title_hi, chapter_number, difficulty_level,
 *     subject, subject_icon, mastery_level, mastery_probability, attempts,
 *     correct_attempts, consecutive_correct, next_review_at, due_for_review
 *   }
 * where mastery_level ∈ { not_started, beginner, developing, proficient, mastered }.
 *
 * These helpers ONLY classify those engine-decided values into the three
 * student-facing buckets and the four roadmap node states. No mastery formula
 * lives here — assessment owns that. This is frontend presentation only.
 */

import { calculateScorePercent } from '@alfanumrik/lib/scoring';

export interface MasteryOverviewRow {
  topic_id: string;
  title: string | null;
  title_hi?: string | null;
  chapter_number?: number | null;
  subject?: string | null;
  subject_icon?: string | null;
  mastery_level: string;
  mastery_probability: number | null;
  /** Questions attempted for this topic (from the RPC's `attempts`). */
  attempts?: number | null;
  /** Questions answered correctly (from the RPC's `correct_attempts`). */
  correct_attempts?: number | null;
  due_for_review?: boolean | null;
  next_review_at?: string | null;
}

export type MasteryBucket = 'mastered' | 'learning' | 'needs-revision';

/** Roadmap node states used by SkillTree / RoadmapNode. */
export type RoadmapStatus = 'mastered' | 'learning' | 'needs-revision' | 'locked';

/**
 * Bucket a single overview row. `due_for_review` (engine-decided spaced-
 * repetition signal) takes precedence — a topic that is due is surfaced as
 * "needs revision" regardless of its standing level, because that's the
 * action the student should take next. Otherwise `mastered` maps to Mastered
 * and any started-but-not-mastered level maps to Learning. `not_started`
 * topics are excluded from the three-bucket snapshot (they're "locked"/future
 * in the roadmap, not part of the started-work tally).
 */
export function bucketForRow(row: MasteryOverviewRow): MasteryBucket | null {
  if (row.due_for_review) return 'needs-revision';
  if (row.mastery_level === 'mastered') return 'mastered';
  if (row.mastery_level === 'not_started') return null;
  // beginner | developing | proficient → still actively learning
  return 'learning';
}

export interface BucketCounts {
  mastered: number;
  learning: number;
  needsRevision: number;
}

/** Tally the three student-facing buckets across all rows. */
export function countBuckets(rows: MasteryOverviewRow[]): BucketCounts {
  const counts: BucketCounts = { mastered: 0, learning: 0, needsRevision: 0 };
  for (const row of rows) {
    const b = bucketForRow(row);
    if (b === 'mastered') counts.mastered += 1;
    else if (b === 'learning') counts.learning += 1;
    else if (b === 'needs-revision') counts.needsRevision += 1;
  }
  return counts;
}

/** Map a row to a roadmap node state (includes the `locked`/not-started case). */
export function roadmapStatusForRow(row: MasteryOverviewRow): RoadmapStatus {
  if (row.due_for_review) return 'needs-revision';
  if (row.mastery_level === 'mastered') return 'mastered';
  if (row.mastery_level === 'not_started') return 'locked';
  return 'learning';
}

/** Mastery percentage 0–100 from the engine's 0–1 probability (BKT). */
export function masteryPercent(row: MasteryOverviewRow): number {
  const p = typeof row.mastery_probability === 'number' ? row.mastery_probability : 0;
  return Math.round(Math.min(1, Math.max(0, p)) * 100);
}

/**
 * Per-topic ACCURACY % (0–100), the P1-canonical
 * `Math.round((correct / total) * 100)` computed from the RPC's
 * `correct_attempts` / `attempts`. This is the number the student reads on a
 * dashboard MasteryRing so it reconciles with quiz results (assessment C1) —
 * NOT `masteryPercent()`, which is the BKT probability used only for bucketing
 * and roadmap-node fill.
 */
export function accuracyPercent(row: MasteryOverviewRow): number {
  return calculateScorePercent(row.correct_attempts ?? 0, row.attempts ?? 0);
}

/**
 * Aggregate ACCURACY % across rows: `round((Σcorrect / Σattempts) * 100)`
 * via the same P1-canonical helper. Rows with no attempts contribute nothing.
 */
export function aggregateAccuracyPercent(rows: MasteryOverviewRow[]): number {
  let correct = 0;
  let attempts = 0;
  for (const r of rows) {
    correct += r.correct_attempts ?? 0;
    attempts += r.attempts ?? 0;
  }
  return calculateScorePercent(correct, attempts);
}

/**
 * Group overview rows by subject, preserving first-seen order. Returns an
 * array of { subject, icon, rows } so SubjectRoadmaps can render one skill
 * tree per subject.
 */
export interface SubjectGroup {
  subject: string;
  icon: string;
  rows: MasteryOverviewRow[];
}

export function groupBySubject(rows: MasteryOverviewRow[]): SubjectGroup[] {
  const order: string[] = [];
  const map = new Map<string, SubjectGroup>();
  for (const row of rows) {
    const subject = row.subject || 'General';
    if (!map.has(subject)) {
      order.push(subject);
      map.set(subject, { subject, icon: row.subject_icon || '📘', rows: [] });
    }
    map.get(subject)!.rows.push(row);
  }
  return order.map((s) => map.get(s)!);
}

/**
 * Pick the single weakest STARTED topic — the topic the student is actively
 * learning with the lowest mastery, or the most overdue review. Used by the
 * Foxy MasteryAwareness nudge. Returns null when there's nothing actionable.
 */
export function weakestStartedTopic(rows: MasteryOverviewRow[]): MasteryOverviewRow | null {
  const candidates = rows.filter(
    (r) => r.mastery_level !== 'not_started' && r.mastery_level !== 'mastered',
  );
  if (candidates.length === 0) {
    // Fall back to anything due for review.
    const due = rows.filter((r) => r.due_for_review);
    if (due.length === 0) return null;
    return due[0];
  }
  return candidates.reduce((lowest, cur) =>
    masteryPercent(cur) < masteryPercent(lowest) ? cur : lowest,
  );
}
