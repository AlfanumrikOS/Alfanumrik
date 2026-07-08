/**
 * src/lib/tutor/resolve-next-concept.ts — the Adaptive Tutor picker.
 *
 * Phase 0 contract:
 *   • Input: all concepts in the student's grade (sorted) + their mastery
 *     rows + an optional "current chapter" hint.
 *   • Output: the next concept to teach, or a terminal signal.
 *
 * Decision rule (in order):
 *   1. If `currentChapterHint` points at a chapter with at least one
 *      un-mastered concept, return its lowest-concept_number unmastered.
 *   2. Otherwise scan `conceptsInGrade` in sorted order; return the first
 *      whose mastery_mean is below MASTERY_THRESHOLD OR has no mastery row.
 *   3. If every concept is mastered, return 'grade_complete'.
 *   4. If the input has zero concepts, return 'no_content'.
 *
 * Pure. No I/O. No randomness. Same input → same output, for stable tests
 * and reproducible bug reports.
 *
 * Phase 1 will extend with:
 *   • Decay-driven re-surfacing (current_retention < 0.7 → bump to front)
 *   • Prerequisite enforcement (skip a concept whose prereqs aren't mastered)
 *   • Cross-subject balancing (don't drown a student in one subject)
 * Those live in the same function so the API layer never changes.
 */

import {
  MASTERY_THRESHOLD,
  type ResolverInput,
  type TutorConceptRow,
  type TutorNextResponse,
} from './types';

/**
 * Pure: pick the next concept for a student given their full grade-scoped
 * concept list and mastery state.
 */
export function resolveNextConcept(input: ResolverInput): TutorNextResponse {
  const { conceptsInGrade, masteryRows, currentChapterHint } = input;

  // ── 4. No content for this grade ────────────────────────────────────
  if (conceptsInGrade.length === 0) {
    return {
      status: 'no_content',
      reason: 'no_concepts_for_grade',
      progress: { mastered: 0, total: 0 },
    };
  }

  // Build a (concept_id → mastery_mean) lookup for O(1) checks below.
  // Treat missing rows AND null/undefined mean as "not mastered".
  const masteryByConceptId = new Map<string, number>();
  for (const m of masteryRows) {
    if (m.mastery_mean != null && Number.isFinite(m.mastery_mean)) {
      masteryByConceptId.set(m.concept_id, m.mastery_mean);
    }
  }

  const isMastered = (c: TutorConceptRow): boolean => {
    const m = masteryByConceptId.get(c.id);
    return m != null && m >= MASTERY_THRESHOLD;
  };

  const masteredCount = conceptsInGrade.filter(isMastered).length;
  const total = conceptsInGrade.length;
  const progress = { mastered: masteredCount, total };

  // ── 1. Current-chapter continuation ─────────────────────────────────
  if (currentChapterHint) {
    const inChapter = conceptsInGrade.filter(
      c =>
        c.subject === currentChapterHint.subject &&
        c.chapter_number === currentChapterHint.chapter_number,
    );
    const firstUnmasteredInChapter = inChapter.find(c => !isMastered(c));
    if (firstUnmasteredInChapter) {
      return {
        status: 'next_concept',
        concept: firstUnmasteredInChapter,
        reason: 'first_unmastered_in_subject_order',
        progress,
      };
    }
    // Chapter fully mastered → fall through to the grade-wide scan.
  }

  // ── 2. Grade-wide scan ──────────────────────────────────────────────
  const firstUnmastered = conceptsInGrade.find(c => !isMastered(c));
  if (firstUnmastered) {
    return {
      status: 'next_concept',
      concept: firstUnmastered,
      reason: 'first_unmastered_in_subject_order',
      progress,
    };
  }

  // ── 3. Everything mastered ──────────────────────────────────────────
  return {
    status: 'grade_complete',
    reason: 'no_unmastered_concepts',
    progress,
  };
}
