/**
 * mastery-band — the single canonical exam-readiness band for a
 * concept_mastery row, for STUDENT-facing surfaces that ask "how ready is
 * this student for an exam covering this topic?" (Wave B exam-schedule;
 * any future surface asking the same question should import this too,
 * rather than growing a new one).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────
 * The Wave-B exam-schedule handoff's route-local `bandFor()` invented a
 * genuinely new, 6th, uncoordinated mastery classification (thresholds
 * 0.85 / 0.6 on `concept_mastery.mastery_probability` →
 * exam_ready/getting_it/shaky/new). Five other classification schemes
 * already carve up mastery for different surfaces, and none of them match:
 *
 *   1. dashboard/mastery-band-labels.ts (`bandForValue`) — operates on
 *      ACCURACY % (correct/total), not mastery_probability, by explicit
 *      design (assessment condition C1). Wrong variable for this route,
 *      which only has mastery_probability cheaply in hand.
 *   2. teacher/heat-scale.ts (`heatBand`) — the one real precedent on the
 *      SAME variable (mastery_probability from concept_mastery), but it is
 *      documented as "the SINGLE SOURCE OF TRUTH for mastery color across
 *      the Atlas TEACHER surfaces": 5 bands, teacher-analytics tone
 *      ("critical", "weak") that is not appropriate for a student reading
 *      about their own knowledge, and a band COUNT that does not line up
 *      with the already-designed 4-value exam-schedule vocabulary without
 *      an arbitrary, undocumented merge.
 *   3. ui/progress/SubjectMasteryCard.tsx `classifyMastery()` — inline,
 *      unshared, accuracy%-based. Not a canonical export at all.
 *   4. cognitive-engine.ts ZPD constants (MASTERY_BUILDING_MAX /
 *      MASTERY_SECURE_MIN / MASTERY_ZPD_CEILING) — internal algorithm
 *      ceilings (Bloom-level gating, ZPD targeting), not a display band.
 *   5. goals/mastery-display.ts (`classifyMasteryForDisplay`) — operates on
 *      the right variable, but answers a different question: "has this
 *      concept been mastered relative to MY chosen goal", a goal-relative
 *      content-progression semantic, not "am I ready for an upcoming exam
 *      on this chapter."
 *   6. compute_chapter_readiness / compute_subject_readiness RPCs — the
 *      closest FRAMING match (literally "exam-ready" vocabulary), but the
 *      WRONG pipeline: they read `concept_mastery_score` joined to
 *      `chapter_concepts` (keyed by grade + subject TEXT code +
 *      chapter_number + concept slug) — a genuinely different mastery
 *      representation than `concept_mastery` joined to `curriculum_topics`
 *      (keyed by topic_id uuid) that the exam-schedule route actually reads
 *      (`student_exam_entry_topics.topic_id` is a hard FK to
 *      `curriculum_topics.id` — migration 20260802090100). There is no FK
 *      or join between the two pipelines; routing through them risks the
 *      exact silent chapter-drift these bands exist to prevent, now as a
 *      genuine DATA divergence, not just a labelling one. They also do not
 *      batch the way this route needs: `compute_chapter_readiness` is one
 *      chapter per call, and `compute_subject_readiness` is one *subject*
 *      per call returning chapter-level rows — the route needs bands for
 *      an arbitrary set of topic_ids that can span many subjects in a
 *      single request, which today only a single
 *      `.from('concept_mastery').select(...).in('topic_id', ids)` query
 *      (already what the route runs) can do in one round trip.
 *
 * ── THE FIX ──────────────────────────────────────────────────────────────
 * Don't invent a 7th set of cutoffs either. `concept_mastery` already
 * carries an engine-computed categorical band — `mastery_level` — written
 * by the live BKT post-quiz RPC (`update_learner_state_post_quiz`,
 * migration 20260623000100_fix_post_quiz_canonical_mastery.sql) and already
 * surfaced to the student today on the Progress/Atlas dashboard via
 * `get_mastery_overview()` → packages/lib/src/dashboard/mastery-buckets.ts.
 * This module is a pure RELABEL of that existing, canonical, already-live
 * value for the exam-readiness framing. It introduces no new mastery
 * computation on its primary path.
 *
 * mastery_level → ExamReadinessBand:
 *   mastered                        (>= 0.95)   → exam_ready
 *   proficient      (0.70 <= p < 0.95)           → getting_it  (0.70 is
 *     cognitive-engine.ts's own exported MASTERY_SECURE_MIN — the
 *     assessment-owned "secure" line, reused here rather than re-hardcoded)
 *   developing | beginner            (p < 0.70) → shaky
 *   not_started / no row                        → new
 *
 * ── BATCHING ─────────────────────────────────────────────────────────────
 * O(1) extra cost. The caller already runs one
 * `.from('concept_mastery').select(...).in('topic_id', ids)` query; this
 * just needs `mastery_level` added to that select list and this function
 * applied per row in JS. No new round trip, no new query shape.
 *
 * ── FALLBACK ─────────────────────────────────────────────────────────────
 * If a row is missing `mastery_level` (defensive only — the column is
 * NOT-NULL-effective via its table default and is written on every BKT
 * update) this falls back to classifying the raw `mastery_probability`
 * with the SAME cutoffs the live engine's own CASE uses — mirrored, never
 * reinvented. `MASTERY_MASTERED_MIN` below is not exported from
 * cognitive-engine.ts today (only MASTERY_BUILDING_MAX / MASTERY_SECURE_MIN
 * are); it is named here so the one place it would need to be re-synced
 * from — the migration's CASE — is unambiguous.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────
 * This answers exactly one question — exam-readiness band for a
 * concept_mastery row, for a student-facing surface — and is not a
 * replacement for heat-scale.ts (teacher color), mastery-band-labels.ts
 * (accuracy% dashboard ring), or mastery-display.ts (goal-relative content
 * progression). Each keeps its own scope; this fills the one genuine gap
 * among the six surveyed schemes above.
 */

import { MASTERY_SECURE_MIN } from '@alfanumrik/lib/cognitive-engine';

/** Matches `concept_mastery.mastery_level` exactly (migration 20260623000100). */
export type ConceptMasteryLevel = 'not_started' | 'beginner' | 'developing' | 'proficient' | 'mastered';

/** Student-facing exam-readiness band (already-designed, CEO-reviewed vocabulary). */
export type ExamReadinessBand = 'exam_ready' | 'getting_it' | 'shaky' | 'new';

/**
 * Mirrors the 'mastered' cutoff in the live BKT writer's `mastery_level`
 * CASE (migration 20260623000100_fix_post_quiz_canonical_mastery.sql). Used
 * only by the defensive fallback below — the primary path never computes a
 * threshold, it relabels the already-written `mastery_level`.
 */
const MASTERY_MASTERED_MIN = 0.95;

const KNOWN_LEVELS: ReadonlySet<string> = new Set<ConceptMasteryLevel>([
  'not_started',
  'beginner',
  'developing',
  'proficient',
  'mastered',
]);

/** Minimal shape this needs from a concept_mastery row (or an absent one). */
export interface MasteryBandInput {
  mastery_level?: string | null;
  mastery_probability?: number | null;
}

/**
 * The single canonical exam-readiness band for a concept_mastery row.
 * Pure, total, never throws — missing/unrecognised input degrades to 'new'
 * rather than blocking the caller's response.
 */
export function resolveExamReadinessBand(row: MasteryBandInput | null | undefined): ExamReadinessBand {
  const level = row?.mastery_level;
  if (typeof level === 'string' && KNOWN_LEVELS.has(level)) {
    switch (level as ConceptMasteryLevel) {
      case 'mastered':
        return 'exam_ready';
      case 'proficient':
        return 'getting_it';
      case 'developing':
      case 'beginner':
        return 'shaky';
      case 'not_started':
      default:
        return 'new';
    }
  }

  // Defensive fallback only (see file header) — mirrors, does not reinvent,
  // the live engine's own mastery_level CASE thresholds.
  const p = row?.mastery_probability;
  if (typeof p !== 'number' || !Number.isFinite(p)) return 'new';
  if (p >= MASTERY_MASTERED_MIN) return 'exam_ready';
  if (p >= MASTERY_SECURE_MIN) return 'getting_it';
  return 'shaky';
}
