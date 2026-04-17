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

import { getQuizQuestionsV2 } from '@/lib/supabase';
import { logger } from '@/lib/logger';

// ── Types ──────────────────────────────────────────────────────

export interface AssembleQuizParams {
  subject: string;
  grade: string;            // P5: always string "6"-"12"
  requestedCount: number;   // must be 5, 10, 15, or 20
  difficulty: string;       // 'easy' | 'medium' | 'hard' | 'mixed' | 'progressive'
  chapter?: number | null;
  questionTypes: string[];  // e.g. ['mcq']
  mode: string;             // 'practice' | 'cognitive' | 'exam'
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
  };
}

// ── Question Validation (P6) ───────────────────────────────────
// Mirrors the validateQuestions() function in supabase.ts, but returns
// a reason string for observability instead of silently filtering.

export function validateQuestion(q: any): { valid: boolean; reason?: string } {
  if (!q) return { valid: false, reason: 'null_question' };

  // Question text checks
  if (!q.question_text || typeof q.question_text !== 'string')
    return { valid: false, reason: 'empty_text' };
  if (q.question_text.length < 15)
    return { valid: false, reason: 'text_too_short' };
  if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]'))
    return { valid: false, reason: 'template_marker' };

  // Template/garbage text patterns
  const text = q.question_text.toLowerCase();
  if (text.includes('unrelated topic')) return { valid: false, reason: 'garbage_text' };
  if (text.startsWith('a student studying') && text.includes('should focus on'))
    return { valid: false, reason: 'garbage_text' };
  if (text.startsWith('which of the following best describes the main topic'))
    return { valid: false, reason: 'garbage_text' };
  if (text.startsWith('why is') && text.includes('important for grade'))
    return { valid: false, reason: 'garbage_text' };
  if (text.startsWith('the chapter') && text.includes('most closely related to which area'))
    return { valid: false, reason: 'garbage_text' };
  if (text.startsWith('what is the primary purpose of studying'))
    return { valid: false, reason: 'garbage_text' };

  // MCQ option validation
  const opts = Array.isArray(q.options) ? q.options : [];
  if (opts.length !== 4)
    return { valid: false, reason: `${opts.length}_options` };
  if (opts.some((o: any) => !o || String(o).trim() === ''))
    return { valid: false, reason: 'empty_option' };
  if (q.correct_answer_index < 0 || q.correct_answer_index > 3)
    return { valid: false, reason: 'bad_answer_index' };

  // Garbage option patterns
  const optTexts = opts.map((o: string) => (o || '').toLowerCase().trim());
  if (optTexts.some((o: string) =>
    o.includes('unrelated topic') || o.includes('physical education') ||
    o.includes('art and craft') || o.includes('music theory') ||
    o.includes('it is not important') || o.includes('no board exam')
  )) return { valid: false, reason: 'garbage_option' };

  // At least 3 distinct options
  if (new Set(optTexts).size < 3)
    return { valid: false, reason: 'duplicate_options' };

  // Explanation quality
  if (!q.explanation || q.explanation.length < 20)
    return { valid: false, reason: 'weak_explanation' };

  const expl = q.explanation.toLowerCase();
  if (expl.includes('does not match any option') ||
      expl.includes('suggesting a possible error') ||
      expl.includes('assuming a typo') ||
      expl.includes('not listed') ||
      expl.includes('however, the correct') ||
      expl.includes('this is incorrect') ||
      expl.includes('none of the options') ||
      expl.includes('there seems to be') ||
      expl.includes('closest plausible'))
    return { valid: false, reason: 'unreliable_explanation' };

  return { valid: true };
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
  const { subject, grade, requestedCount, difficulty, chapter, questionTypes, mode } = params;

  const stats = {
    primaryFetched: 0,
    validAfterFilter: 0,
    duplicatesRemoved: 0,
    fallbackFetched: 0,
    finalCount: 0,
  };

  let allQuestions: any[] = [];
  let fallbackRung = 0;

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

  // Log observability event
  const severity = allQuestions.length < requestedCount ? 'warn' : 'info';
  const logMethod = severity === 'warn' ? 'warn' : 'info';
  logger[logMethod]('quiz_assembled', {
    subject, grade, requestedCount,
    returnedCount: allQuestions.length,
    fallbackRung,
    chapter: chapter ?? 'all',
    mode,
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