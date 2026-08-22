/**
 * ALFANUMRIK — Guaranteed Count Quiz Assembler (recovery-mode tightened)
 *
 * Hard rules (NEVER relaxed):
 *   - Subject + grade must match
 *   - **Chapter must match when caller specified one** (recovery-mode change)
 *   - MCQ must have 4 valid options + correct index 0-3
 *   - Question text must be non-empty, no template markers
 *   - Final count MUST equal requested count (or explicit failure)
 *
 * Soft rules (relax in order):
 *   Rung 1: Allow previously seen questions (drop dedup)
 *   Rung 2: Relax difficulty targeting (any difficulty)
 *   ★ Rung 3 was previously: relax chapter filter. REMOVED — silently swapping
 *     the chapter the student picked is a quiz-integrity violation. If a
 *     specific chapter is short, the assembler now returns success: false with
 *     `returnedCount` and the UI surfaces a structured "try another chapter or
 *     all chapters" affordance.
 *
 * If count still can't be met after Rungs 0-2: explicit failure with
 * `success: false`, never a silent partial quiz, never a wrong-chapter quiz.
 */

import { getQuizQuestionsV2, supabase } from '@alfanumrik/lib/supabase';
import { logger } from '@alfanumrik/lib/logger';
import { validateQuestion as validateQuestionP6 } from '@alfanumrik/lib/quiz/question-validation';

// ── Types ──────────────────────────────────────────────────────

export interface AssembleQuizParams {
  subject: string;
  grade: string;            // P5: always string "6"-"12"
  requestedCount: number;   // must be 5, 10, 15, or 20
  difficulty: string;       // 'easy' | 'medium' | 'hard' | 'mixed' | 'progressive'
  chapter?: number | null;
  questionTypes: string[];  // e.g. ['mcq']
  mode: string;             // 'practice' | 'cognitive' | 'exam'
  /**
   * Previous-year-question board paper to prefer, e.g. 2019.
   *
   * Inherited from the retired `/pyq` runtime (Phase 5 track A). That page ran
   * its OWN question loop — it read `question_bank.correct_answer_index` in the
   * browser, graded there, and wrote NOTHING to the database. It is now a
   * launcher into this assembler, so a PYQ attempt gets the server shuffle
   * snapshot, anti-cheat, and the atomic submit like any other quiz.
   *
   * The only thing that was worth keeping from it is this selector: PYQ rows
   * are tagged with the paper year in `question_bank.tags`. When set, RUNG 0P
   * below prefers those rows; anything it cannot fill comes from the normal
   * ladder — which is exactly the "fall back to generic rows for this subject"
   * behaviour the old page had, except the shortfall is now logged instead of
   * being silently relabelled as that year's paper.
   */
  pyqYear?: number | null;
}

export interface AssembleQuizResult {
  success: boolean;
  questions: any[];
  requestedCount: number;
  returnedCount: number;
  fallbackRung: number;     // 0 = ideal, 1-3 = relaxed, -1 = failed
  stats: {
    primaryFetched: number;
    validAfterFilter: number;
    duplicatesRemoved: number;
    fallbackFetched: number;
    finalCount: number;
    /**
     * How many of the FINAL served questions actually carry the requested PYQ
     * year tag. 0 when no year was requested. Strictly an observability figure:
     * the retired /pyq page labelled a generic question-bank pull as "<year>"
     * with only a small badge to say otherwise, so the shortfall is now
     * measurable in `quiz_assembled` instead of invisible.
     */
    pyqYearMatched: number;
  };
}

/** `question_bank` columns the PYQ preferred-fetch needs — same projection the
 *  direct-query fallback inside `getQuizQuestionsV2` uses, so rows from either
 *  path are shape-identical downstream. */
// KEYLESS (migration 20260814000023): `correct_answer_index` is deliberately
// absent. It was here only so the P6 gate below could check "index 0-3"; that
// check now runs SERVER-side (`public.question_bank_p6_valid` filters the
// serving RPCs and `start_quiz_session` skips any row that fails it, and every
// PYQ row reaches the student through `start_quiz_session`). Re-adding it would
// re-open a browser read of the ~12.8k-row answer key.
const PYQ_COLUMNS =
  'id, question_text, question_hi, question_type, options, ' +
  'explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number, tags';

// ── Question Validation (P6) ───────────────────────────────────
// The local fork that used to live here has been DELETED. It was the weakest
// of three divergent copies while also being the one on the live quiz path:
// it had no `== null` guard on correct_answer_index, accepted only 3 distinct
// options, had no bloom_level check, and had no explanation word-count floor.
//
// The single canonical P6 gate now lives in
// `packages/lib/src/quiz/question-validation.ts` and is the strict union of all
// three former copies. `allowNonMcq: true` preserves this path's deliberate
// 2026-05-09 behaviour of letting short/long-answer question types through the
// MCQ-shape checks (every QUALITY check still applies to them identically).
//
// `enforceBloomLevel` is left OFF (its default). This is a SERVING path: a NULL
// or variant `bloom_level` degrades a mastery heatmap, but rejecting the row
// removes an answerable question from the student and can empty a chapter.
// `question_bank.bloom_level` is nullable with no CHECK and no live path has
// ever filtered on it. See the option's TODO(assessment) for the flip condition.
//
// Re-exported so existing importers of `validateQuestion` from this module keep
// resolving; new code should import from the canonical module directly.

//
// `keylessServing: true` (migration 20260814000023): this is THE live serving
// path, and no source it draws from returns `correct_answer_index` any more —
// the quiz-generator Edge Function, `select_quiz_questions_rag`,
// `select_quiz_questions_v2`, the v1 direct-query fallback and RUNG 0P above
// all withhold it, because the "index 0-3" half of P6 moved into
// `public.question_bank_p6_valid` server-side. Without this flag every MCQ is
// rejected on `missing_answer_index` and `assembleQuiz` returns zero questions.
// Every other P6 check is unchanged, and a PRESENT-but-invalid index is still
// rejected.
export function validateQuestion(q: any): { valid: boolean; reason?: string } {
  return validateQuestionP6(q, { allowNonMcq: true, keylessServing: true });
}

// ── Deduplication ──────────────────────────────────────────────

function deduplicateQuestions(questions: any[]): { unique: any[]; removedCount: number } {
  const seen = new Set<string>();
  const unique: any[] = [];
  let removedCount = 0;

  for (const q of questions) {
    // Deduplicate by ID first, fall back to text-based key
    const key = q.id || q.question_text?.trim().toLowerCase().slice(0, 80);
    if (!key || seen.has(key)) {
      removedCount++;
      continue;
    }
    seen.add(key);
    unique.push(q);
  }

  return { unique, removedCount };
}

// ── Main Assembler ─────────────────────────────────────────────

export async function assembleQuiz(params: AssembleQuizParams): Promise<AssembleQuizResult> {
  const { subject, grade, requestedCount, difficulty, chapter, questionTypes, mode, pyqYear } = params;

  const stats = {
    primaryFetched: 0,
    validAfterFilter: 0,
    duplicatesRemoved: 0,
    fallbackFetched: 0,
    finalCount: 0,
    pyqYearMatched: 0,
  };

  let allQuestions: any[] = [];
  let fallbackRung = 0;

  // === RUNG 0P: PYQ year-tagged preferred fetch (only when a year is asked for) ===
  // Runs BEFORE the normal ideal fetch so board-paper rows lead the pool. It is
  // additive and fail-soft: any error, or a year with no tagged rows, leaves
  // `allQuestions` untouched and RUNG 0 supplies the whole quiz. `is_active` is
  // filtered here (the retired /pyq page did not, so it could serve a retired
  // question), and every row still goes through the same P6 gate below.
  if (pyqYear != null) {
    try {
      let pyqQuery = supabase
        .from('question_bank')
        .select(PYQ_COLUMNS)
        .eq('subject', subject)
        .eq('grade', grade)              // P5: grade is a STRING throughout
        .eq('is_active', true)
        .contains('tags', [String(pyqYear)])
        .limit(requestedCount * 2);
      if (chapter != null) pyqQuery = pyqQuery.eq('chapter_number', chapter);
      const { data, error } = await pyqQuery;
      if (error) throw error;
      if (Array.isArray(data) && data.length > 0) {
        allQuestions.push(...data);
      }
    } catch (e) {
      logger.warn('quiz_assembler_pyq_fetch_failed', {
        error: e instanceof Error ? e.message : String(e),
        subject, grade, pyqYear,
      });
    }
  }

  // === RUNG 0: Ideal fetch (all soft rules active) ===
  // Uses getQuizQuestionsV2 which tries: quiz-generator Edge Function →
  // select_quiz_questions_rag RPC → select_quiz_questions_v2 RPC → direct query
  try {
    const data = await getQuizQuestionsV2(
      subject, grade, requestedCount, difficulty, chapter ?? null, questionTypes
    );
    if (Array.isArray(data) && data.length > 0) {
      allQuestions.push(...data);
    }
  } catch (e) {
    logger.warn('quiz_assembler_rung0_failed', {
      error: e instanceof Error ? e.message : String(e),
      subject, grade, requestedCount,
    });
  }

  stats.primaryFetched = allQuestions.length;

  // Validate and deduplicate
  const { unique: dedupedQuestions, removedCount: dupCount } = deduplicateQuestions(allQuestions);
  stats.duplicatesRemoved = dupCount;

  // Filter by quality gate (P6)
  const validQuestions: any[] = [];
  for (const q of dedupedQuestions) {
    const { valid, reason } = validateQuestion(q);
    if (valid) {
      validQuestions.push(q);
    } else {
      logger.warn('quiz_assembler_invalid_question', {
        questionId: q.id, reason, subject, grade,
      });
    }
  }
  allQuestions = validQuestions;
  stats.validAfterFilter = allQuestions.length;

  // === FALLBACK LADDER: fill deficit ===
  let deficit = requestedCount - allQuestions.length;

  // RUNG 1: Fetch extra with relaxed count (request more than needed)
  // getQuizQuestionsV2 already handles seen-question dedup internally,
  // so requesting more with a higher count might get past the dedup limit
  if (deficit > 0) {
    fallbackRung = 1;
    try {
      // Request 2x deficit to account for validation/dedup losses
      const extra = await getQuizQuestionsV2(
        subject, grade, deficit * 2 + 5, 'mixed', chapter ?? null, questionTypes
      );
      if (Array.isArray(extra) && extra.length > 0) {
        const existingIds = new Set(allQuestions.map(q => q.id || q.question_text?.slice(0, 80)));
        for (const q of extra) {
          if (allQuestions.length >= requestedCount) break;
          const key = q.id || q.question_text?.trim().toLowerCase().slice(0, 80);
          if (existingIds.has(key)) continue;
          const { valid } = validateQuestion(q);
          if (valid) {
            allQuestions.push(q);
            existingIds.add(key);
            stats.fallbackFetched++;
          }
        }
      }
    } catch (e) {
      logger.warn('quiz_assembler_rung1_failed', {
        error: e instanceof Error ? e.message : String(e),
        subject, grade, deficit,
      });
    }
    deficit = requestedCount - allQuestions.length;
  }

  // RUNG 2: Relax difficulty (any difficulty level)
  if (deficit > 0) {
    fallbackRung = 2;
    try {
      const anyDiff = await getQuizQuestionsV2(
        subject, grade, deficit * 2 + 10, 'mixed', chapter ?? null, questionTypes
      );
      if (Array.isArray(anyDiff) && anyDiff.length > 0) {
        const existingIds = new Set(allQuestions.map(q => q.id || q.question_text?.trim().toLowerCase().slice(0, 80)));
        for (const q of anyDiff) {
          if (allQuestions.length >= requestedCount) break;
          const key = q.id || q.question_text?.trim().toLowerCase().slice(0, 80);
          if (existingIds.has(key)) continue;
          const { valid } = validateQuestion(q);
          if (valid) {
            allQuestions.push(q);
            existingIds.add(key);
            stats.fallbackFetched++;
          }
        }
      }
    } catch (e) {
      logger.warn('quiz_assembler_rung2_failed', {
        error: e instanceof Error ? e.message : String(e),
        subject, grade, deficit,
      });
    }
    deficit = requestedCount - allQuestions.length;
  }

  // RUNG 3 REMOVED (recovery-mode):
  // Previously this rung relaxed the chapter filter and silently pulled
  // questions from any chapter in the subject. That violated quiz-integrity
  // contract: a student who picked Chapter 5 could end up answering Chapter 9
  // questions while the UI claimed it was a Chapter 5 quiz. Now: if the
  // chapter is specified and we can't fill the count, we fail loudly.
  // Surface chapter-deficit explicitly so the UI can render a structured
  // "try another chapter or pick all chapters" affordance.

  // Hard scope guard: if a chapter was specified, drop ANY question that
  // doesn't match. This is defence-in-depth against an upstream RPC that
  // broadens silently. Combined with the API route's chapter filter on the
  // final response, the chapter contract is enforced at three layers.
  if (chapter != null) {
    const before = allQuestions.length;
    allQuestions = allQuestions.filter(q =>
      typeof q.chapter_number === 'number' && q.chapter_number === chapter
    );
    if (allQuestions.length < before) {
      logger.warn('quiz_assembler_dropped_cross_chapter_questions', {
        subject, grade, chapter, dropped: before - allQuestions.length,
      });
    }
  }

  // Final trim to exact count (in case we overfetched)
  allQuestions = allQuestions.slice(0, requestedCount);
  stats.finalCount = allQuestions.length;

  // How much of what the student is about to see is genuinely that year's
  // board paper. Counted on the FINAL set, after the trim, so it describes
  // what was served rather than what was fetched.
  if (pyqYear != null) {
    const tag = String(pyqYear);
    stats.pyqYearMatched = allQuestions.filter(
      q => Array.isArray(q.tags) && q.tags.map(String).includes(tag),
    ).length;
  }

  // Log observability event
  const severity = allQuestions.length < requestedCount ? 'warn' : 'info';
  const logMethod = severity === 'warn' ? 'warn' : 'info';
  logger[logMethod]('quiz_assembled', {
    subject, grade, requestedCount,
    returnedCount: allQuestions.length,
    fallbackRung,
    chapter: chapter ?? 'all',
    mode,
    pyqYear: pyqYear ?? null,
    ...stats,
  });

  return {
    success: allQuestions.length === requestedCount,
    questions: allQuestions,
    requestedCount,
    returnedCount: allQuestions.length,
    fallbackRung: allQuestions.length < requestedCount ? -1 : fallbackRung,
    stats,
  };
}