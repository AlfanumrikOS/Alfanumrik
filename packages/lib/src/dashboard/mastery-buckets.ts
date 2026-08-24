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

/**
 * D3/A (assessment sign-off 2026-08-06) — the distinguishing signal that lets
 * the empty state attribute emptiness correctly:
 *
 * - `ok`           — RPC returned per-topic rows normally.
 * - `no_activity`  — the student's grade HAS curriculum, but no attempts yet
 *                    (or legacy pre-migration response with zero rows).
 * - `no_curriculum`— the student's grade has NO curriculum topics — a platform
 *                    coverage gap, never the student's inaction.
 * - `not_tracked`  — RPC failed / no data returned; nothing can be
 *                    distinguished, so the UI must not attribute emptiness to
 *                    the student.
 *
 * The backend owns emitting `no_curriculum` vs `no_activity` in the
 * get_mastery_overview response (response-shape change); `not_tracked` is a
 * client-side value used only when the RPC call itself fails.
 */
export type MasteryCoverage = 'ok' | 'no_activity' | 'no_curriculum' | 'not_tracked';

/** getMasteryOverview response — rows plus the coverage/availability signal. */
export interface MasteryOverviewResponse {
  rows: MasteryOverviewRow[];
  coverage: MasteryCoverage;
}

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

/**
 * Canonical CBSE subject display name → code map (from the `subjects` table
 * seed + common variants). Lowercased keys.
 */
export const SUBJECT_CODE_BY_NAME: Record<string, string> = {
  math: 'math',
  maths: 'math',
  mathematics: 'math',
  science: 'science',
  english: 'english',
  hindi: 'hindi',
  'social studies': 'social_studies',
  'social science': 'social_studies',
  sst: 'social_studies',
  socialstudies: 'social_studies',
  physics: 'physics',
  chemistry: 'chemistry',
  biology: 'biology',
  economics: 'economics',
  accountancy: 'accountancy',
  'business studies': 'business_studies',
  businessstudies: 'business_studies',
  history: 'history_sr',
  geography: 'geography',
  'political science': 'political_science',
  politicalscience: 'political_science',
  'computer science': 'computer_science',
  computerscience: 'computer_science',
  cs: 'computer_science',
  sanskrit: 'sanskrit',
  coding: 'coding',
  'informatics practices': 'informatics_practices',
};

/**
 * Resolve the canonical subject CODE for a display NAME (the value
 * get_mastery_overview returns in `subject` — the `subjects.name`, e.g.
 * "Social Studies"). The live per-student map (allowedSubjects name→code)
 * wins when it has an entry; otherwise the static SUBJECT_CODE_BY_NAME map
 * covers the canonical CBSE names + common aliases.
 *
 * Returns null when unknown so callers can OMIT the deep-link param instead
 * of sending garbage: Foxy validates ?subject= against real codes and falls
 * back to the first allowed subject on mismatch, so a bogus display-name
 * param silently redirects the student to the WRONG subject.
 */
export function subjectCodeForName(
  name: string | null | undefined,
  knownByDisplayName?: Record<string, string>,
): string | null {
  const trimmed = name?.trim();
  const normalized = trimmed?.toLowerCase();
  if (!normalized) return null;
  if (knownByDisplayName) {
    const exact = trimmed ? knownByDisplayName[trimmed] : undefined;
    if (exact) return exact;
    for (const [display, code] of Object.entries(knownByDisplayName)) {
      if (display.trim().toLowerCase() === normalized) return code;
    }
  }
  return SUBJECT_CODE_BY_NAME[normalized] ?? null;
}

/* ── Reachable-subject selector (defect #11) ──────────────────────────────────
 * Three dashboard surfaces used to answer "which subjects does this student
 * have?" three different ways, and only one of them filtered at all — with a
 * HARDCODED set of display NAMES (`['Mathematics','Science']`). That silently
 * dropped Physics / Chemistry / Biology, so every grade-11/12 student saw only
 * Mathematics.
 *
 * The authoritative answer already exists: GET /api/student/subjects, which is
 * derived from `grade_subject_map ⋈ subjects WHERE is_active` (grades 6-10 →
 * math + science; grades 11-12 → physics/chemistry/biology + math). These two
 * helpers let every surface key off that one list, by subject CODE, instead of
 * maintaining a second hardcoded list of names.
 */

/** The shape every caller already has from `useAllowedSubjects()`. */
export interface AllowedSubjectRef {
  code: string;
  name?: string | null;
}

/**
 * Build the display-name → canonical-code map `subjectCodeForName` consumes,
 * from the live allowed-subjects list. Same construction the Alfa OS dashboard
 * did inline; factored here so all three surfaces share one copy.
 */
export function subjectCodeMapFromAllowed(
  allowed: readonly AllowedSubjectRef[] | null | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of allowed ?? []) {
    if (s?.name && s.code) map[s.name] = s.code;
  }
  return map;
}

/**
 * Keep only the rows whose subject resolves to a code the student can actually
 * reach.
 *
 * FAIL-OPEN by design: when `allowed` is empty we return the rows untouched.
 * An empty list means "/api/student/subjects hasn't answered yet (or answered
 * degraded)", and hiding every subject in that window would blame the student
 * for a platform gap — showing one subject too many for a few hundred ms is
 * strictly less harmful than an all-empty mastery panel.
 *
 * A row whose subject NAME cannot be resolved to a code is also kept: the
 * unresolvable case is our mapping gap, not evidence the subject is unreachable.
 */
export function filterRowsToAllowedSubjects<T extends { subject?: string | null }>(
  rows: readonly T[],
  allowed: readonly AllowedSubjectRef[] | null | undefined,
): T[] {
  const list = allowed ?? [];
  if (list.length === 0) return [...rows];
  const codes = new Set(list.map((s) => s.code).filter(Boolean));
  const byName = subjectCodeMapFromAllowed(list);
  return rows.filter((row) => {
    const raw = row.subject?.trim();
    if (!raw) return false;
    // Rows may carry either the display NAME (get_mastery_overview) or the
    // CODE (student_learning_profiles / topic_mastery_rollup) — accept both.
    if (codes.has(raw)) return true;
    const code = subjectCodeForName(raw, byName);
    if (code === null) return true; // unresolvable ⇒ our gap, not theirs
    return codes.has(code);
  });
}
