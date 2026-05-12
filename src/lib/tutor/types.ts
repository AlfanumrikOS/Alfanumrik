/**
 * src/lib/tutor/types.ts — Adaptive Tutor (ADR-004) Phase 0 types.
 *
 * The Tutor decides the next *concept* to teach the student. A concept is
 * one row in `public.chapter_concepts`. Mastery is read from
 * `public.concept_mastery` (concept_id-keyed BKT projection).
 *
 * Phase 0 keeps the picker simple — strict sequential order within
 * (grade, subject, chapter, concept_number), skipping concepts the student
 * has already mastered, falling forward across subjects when one subject is
 * exhausted. Phase 1+ adds prerequisite-aware graph traversal from
 * `public.concept_graph` and decay-driven re-surfacing.
 *
 * Pure types here — no I/O.
 *
 * Spec: docs/superpowers/specs/2026-05-12-adaptive-tutor-phase-0.md
 */

/** A concept-mastery row from `public.concept_mastery`. */
export interface ConceptMasteryRow {
  /** FK to chapter_concepts.id */
  concept_id: string;
  /** BKT posterior mean in [0,1]. Mastery threshold: MASTERY_THRESHOLD. */
  mastery_mean: number | null;
  /** Last time the student interacted with this concept. */
  last_practiced_at: string | null;
}

/** A concept row pulled from `public.chapter_concepts`. Only the fields the
 *  resolver needs to make a decision and the API needs to render. */
export interface TutorConceptRow {
  id: string;
  grade: string;
  subject: string;
  chapter_number: number;
  chapter_title: string | null;
  concept_number: number;
  title: string | null;
  title_hi: string | null;
  explanation: string | null;
  explanation_hi: string | null;
  example_content: string | null;
  example_content_hi: string | null;
  key_formula: string | null;
  practice_question: string | null;
  practice_options: unknown;             // jsonb — validated by the API layer
  practice_correct_index: number | null;
  practice_explanation: string | null;
  practice_explanation_hi: string | null;
  difficulty: number | null;
  bloom_level: string | null;
  estimated_minutes: number | null;
}

/** What `/api/tutor/next` returns. The shape the `/tutor` page consumes. */
export interface TutorNextResponse {
  /** Where the resolver landed. */
  status: 'next_concept' | 'grade_complete' | 'no_content';
  /** Present iff status='next_concept'. */
  concept?: TutorConceptRow;
  /** How the resolver picked this concept — telemetry + debug. */
  reason?:
    | 'first_unmastered_in_subject_order'
    | 'no_unmastered_concepts'
    | 'no_concepts_for_grade';
  /** For the progress strip on /tutor: how many concepts the student has
   *  mastered in this grade, total active concepts in this grade. */
  progress?: { mastered: number; total: number };
}

/** Pure-resolver inputs. The API layer marshals these from Supabase reads. */
export interface ResolverInput {
  /** All active concept rows for the student's grade, pre-sorted by
   *  (subject ASC, chapter_number ASC, concept_number ASC). */
  conceptsInGrade: TutorConceptRow[];
  /** All mastery rows for this student (any grade). The resolver filters by
   *  concept_id intersection with `conceptsInGrade`. */
  masteryRows: ConceptMasteryRow[];
  /** Optional override: if the student is *currently* mid-chapter, the
   *  resolver prefers continuing that chapter when there's still un-mastered
   *  content there. Phase 0 honors this if provided; Phase 1+ infers from
   *  recent state events. */
  currentChapterHint?: { subject: string; chapter_number: number } | null;
}

/**
 * Mastery threshold above which a concept is considered "done" for picking
 * purposes. Calibrated to BKT posterior mean; tighten in Phase 1 once we
 * collect interaction data. 0.85 follows the AI-tutor literature consensus
 * (Corbett & Anderson 1995 → KAtchwork ITS).
 */
export const MASTERY_THRESHOLD = 0.85;
