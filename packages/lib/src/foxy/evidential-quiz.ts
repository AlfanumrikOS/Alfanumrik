// src/lib/foxy/evidential-quiz.ts
//
// PART B1 — evidential Foxy "Quiz me" serving + concept resolution.
//
// BINDING CONTRACT (assessment, "non-evidential by default"):
//   - A graded answer to a SERVER-ISSUED evidential item is the ONLY chat-side
//     path that moves mastery, and it does so through the EXISTING sanctioned
//     pipeline: tutor_commit_attempt RPC -> learner.concept_check_answered ->
//     conceptMasteryProjector. Identical to /api/tutor/answer.
//   - An MCQ that cannot be bound to a real chapter_concepts.id is NON-EVIDENTIAL
//     (it can be shown for practice but CANNOT move mastery — there is no
//     server-issued served-item row, so /api/foxy/quiz-answer will refuse it).
//   - A second "Quiz me" on the SAME (session, concept) yields a NON-evidential
//     item (the UNIQUE(session_id, concept_id) guard on foxy_served_items refuses
//     the second gradable serve).
//
// This module owns:
//   1. resolveLeadConceptId — map a turn's (subject, grade, chapter, optional
//      lead-concept title) to a chapter_concepts.id, deterministically. PURE over
//      its inputs except for the single chapter_concepts read it performs through
//      the supplied client. NO mastery writes, NO LLM.
//   2. serveEvidentialItem — INSERT a foxy_served_items row carrying the
//      server-held correct_index (the verification anchor) under the UNIQUE
//      guard. Returns the served-item id (evidential) OR a non-evidential reason.
//
// Owner: ai-engineer. Reviewed by: assessment (concept resolution + non-evidential
// contract), testing. P6: the served MCQ is the same oracle-gated block the route
// already validated. P13: no PII — IDs + question content only.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { FoxyMcqBlock } from '@alfanumrik/lib/foxy/schema';
import { parseFoxyChapterNumber } from '@alfanumrik/lib/foxy/chapter-parser';

/**
 * Minimal row shape we read from chapter_concepts to resolve + (optionally)
 * source a practice item.
 */
export interface ChapterConceptRow {
  id: string;
  title: string;
  concept_number: number | null;
  difficulty: number | null;
  practice_question: string | null;
  practice_options: unknown; // JSONB — string[] when populated
  practice_correct_index: number | null;
  practice_explanation: string | null;
}

const CHAPTER_CONCEPT_COLUMNS =
  'id, title, concept_number, difficulty, practice_question, practice_options, practice_correct_index, practice_explanation';

/**
 * Normalise a free-form `chapter` value (a number, "Chapter N", or a title) to a
 * positive chapter number, or null when no number can be extracted. Mirrors the
 * route's parseFoxyChapterNumber so resolution scopes the same way the prompt does.
 */
export function parseChapterNumber(chapter: string | null): number | null {
  return parseFoxyChapterNumber(chapter);
}

/** Lowercase + collapse whitespace for a forgiving title match. */
function normTitle(s: string): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface ResolveConceptInput {
  subject: string;
  grade: string;
  chapter: string | null;
  /**
   * The lead-concept TITLE the prompt led with (from selectLeadConcept), when
   * known. Used to prefer the matching chapter_concepts row. Optional — when
   * absent, resolution falls back to the first concept of the scoped chapter.
   */
  leadConceptTitle?: string | null;
}

/**
 * How an `ok: true` concept was chosen:
 *   - 'title_match'           — the supplied leadConceptTitle actually matched a
 *                               concept in the scoped chapter (exact, then substring).
 *   - 'first_concept_fallback'— no title match (or no title supplied), so the
 *                               FIRST concept of the chapter was used.
 *
 * The GRADED evidential-quiz path treats both the same (it anchors an item to
 * whatever concept resolves — see route.ts). This discriminator exists so the
 * OBSERVABILITY-only perception path can degrade to NULL on a fallback instead of
 * systematically over-representing each chapter's concept #1 in analytics.
 */
export type ConceptMatchKind = 'title_match' | 'first_concept_fallback';

export type ResolveConceptResult =
  | { ok: true; concept: ChapterConceptRow; match: ConceptMatchKind }
  | { ok: false; reason: 'no_chapter_scope' | 'no_concept_match' | 'lookup_failed' };

/**
 * Resolve a chapter_concepts.id for the current turn.
 *
 * Deterministic precedence:
 *   1. If a chapter number is resolvable and a leadConceptTitle is supplied,
 *      prefer the concept whose title matches (case/space-insensitive; exact
 *      first, then substring).
 *   2. Else, the FIRST concept (lowest concept_number) of the scoped chapter.
 *   3. If no chapter scope (no chapter number) we cannot anchor an evidential
 *      item to a single concept deterministically -> 'no_chapter_scope'
 *      (the caller serves a NON-evidential item).
 *
 * chapter_concepts.grade is stored as a bare CBSE string ("6".."12"); we filter
 * on the grade as-passed (the route already strips any "Grade " prefix). The
 * subject filter is case-insensitive on the subject code.
 */
export async function resolveLeadConceptId(
  client: Pick<SupabaseClient, 'from'>,
  input: ResolveConceptInput,
): Promise<ResolveConceptResult> {
  const chapterNumber = parseChapterNumber(input.chapter);
  if (chapterNumber === null) {
    return { ok: false, reason: 'no_chapter_scope' };
  }

  try {
    const { data, error } = await client
      .from('chapter_concepts')
      .select(CHAPTER_CONCEPT_COLUMNS)
      .ilike('subject', input.subject)
      .eq('grade', input.grade)
      .eq('chapter_number', chapterNumber)
      .order('concept_number', { ascending: true })
      .limit(50);

    if (error) return { ok: false, reason: 'lookup_failed' };
    const rows = (data ?? []) as ChapterConceptRow[];
    if (rows.length === 0) return { ok: false, reason: 'no_concept_match' };

    // (1) title match against the lead-concept title.
    const lead = input.leadConceptTitle ? normTitle(input.leadConceptTitle) : '';
    if (lead) {
      const exact = rows.find((r) => normTitle(r.title) === lead);
      if (exact) return { ok: true, concept: exact, match: 'title_match' };
      const partial = rows.find(
        (r) => normTitle(r.title).includes(lead) || lead.includes(normTitle(r.title)),
      );
      if (partial) return { ok: true, concept: partial, match: 'title_match' };
    }

    // (2) first concept of the chapter (deterministic by concept_number order).
    return { ok: true, concept: rows[0], match: 'first_concept_fallback' };
  } catch {
    return { ok: false, reason: 'lookup_failed' };
  }
}

/**
 * The question payload we snapshot into foxy_served_items.question_payload so the
 * grading flow can re-derive correctness for a synthetic item not in question_bank.
 * IDs + question content only (P13: no PII).
 */
export interface ServedQuestionPayload {
  stem: string;
  options: string[];
  /** 'mcq_block' = sourced from the oracle-gated Foxy MCQ; 'practice_item' = chapter_concepts. */
  source: 'mcq_block' | 'practice_item';
  bloom_level?: string;
  difficulty?: string;
}

/**
 * Build a served-question payload + correct index from an already-oracle-gated
 * Foxy MCQ block. The block is the verification source of truth — its
 * correct_answer_index becomes the SERVER-HELD answer key.
 */
export function payloadFromMcqBlock(mcq: FoxyMcqBlock): {
  payload: ServedQuestionPayload;
  correctIndex: number;
} {
  return {
    payload: {
      stem: mcq.stem,
      options: [...mcq.options],
      source: 'mcq_block',
      ...(mcq.bloom_level ? { bloom_level: mcq.bloom_level } : {}),
      ...(mcq.difficulty ? { difficulty: mcq.difficulty } : {}),
    },
    correctIndex: mcq.correct_answer_index,
  };
}

export type ServeResult =
  | { evidential: true; servedItemId: string; questionId: string }
  | {
      evidential: false;
      reason: 'duplicate_in_session' | 'insert_failed';
    };

export interface ServeEvidentialInput {
  sessionId: string;
  studentId: string;
  conceptId: string;
  payload: ServedQuestionPayload;
  correctIndex: number;
}

/**
 * INSERT a server-issued evidential served-item row. Enforces ONE evidential
 * item per (session, concept) via the table's UNIQUE constraint — a duplicate
 * (Postgres 23505) is NOT an error here, it is the documented "second Quiz me on
 * the same concept is non-evidential" contract. The caller MUST run as
 * service_role (server-issued insert; the correct_index answer key never goes
 * through a user JWT write).
 *
 * questionId is stable: `${conceptId}:evidential:v1`. It is what we forward to
 * tutor_commit_attempt at grade time so the concept-check event carries a stable
 * question id (parity with the tutor path's `${conceptId}:practice:v1`).
 */
export async function serveEvidentialItem(
  serviceClient: Pick<SupabaseClient, 'from'>,
  input: ServeEvidentialInput,
): Promise<ServeResult> {
  const questionId = `${input.conceptId}:evidential:v1`;
  const { data, error } = await serviceClient
    .from('foxy_served_items')
    .insert({
      session_id: input.sessionId,
      student_id: input.studentId,
      concept_id: input.conceptId,
      question_id: questionId,
      question_payload: input.payload,
      correct_index: input.correctIndex,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = UNIQUE(session_id, concept_id) violation: a gradable item was
    // already served for this concept in this session. The second one is
    // NON-evidential by contract (we do not move mastery twice off the same
    // concept in one session via Quiz me).
    if (error.code === '23505') {
      return { evidential: false, reason: 'duplicate_in_session' };
    }
    return { evidential: false, reason: 'insert_failed' };
  }

  return { evidential: true, servedItemId: (data as { id: string }).id, questionId };
}
