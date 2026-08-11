/**
 * Quiz Domain — authoritative interface for quiz session management.
 *
 * This is the microservice boundary. All quiz data operations go through here.
 * No caller should touch quiz_sessions, quiz_responses, or user_question_history
 * directly.
 *
 * CONTRACT:
 *   - Every function returns ServiceResult<T> — no throws, no silent nulls
 *   - Fallbacks are explicit: each source is tried once, failure is logged
 *   - XP calculation never happens client-side; always via RPC
 *   - Submission is idempotent: duplicate session_id is a no-op, not an error
 *
 * MICROSERVICE EXTRACTION PATH:
 *   When extracted: wrap submitQuizSession and fetchQuestions in HTTP handlers.
 *   The types in ./types.ts become the HTTP schema. Zero logic rewrite.
 */

import { supabase } from '@alfanumrik/lib/supabase';
import { logger } from '@alfanumrik/lib/logger';
import {
  ok, fail,
  type ServiceResult,
  type QuizQuestion,
  type QuizSessionResult,
  type QuizSubmissionInput,
  type QuizQuestionFetchInput,
  type QuizQuestionSource,
} from './types';
import { validateQuestions as validateQuestionsP6 } from '@alfanumrik/lib/quiz/question-validation';
import { shuffle } from '@alfanumrik/lib/shuffle';

// ── Question validation ───────────────────────────────────────────────────────
// The domain-local fork that used to live here has been DELETED. P6 is a
// PRODUCT invariant, not a per-domain data-quality preference — one weaker copy
// anywhere means a student can be served a broken question from that path.
//
// Canonical gate: `packages/lib/src/quiz/question-validation.ts` (strict union
// of the three former copies — this copy gains the garbage-text patterns, the
// distinct-4-options rule and the explanation word-count floor it was missing).
//
// `allowNonMcq` is left at its default (false), preserving this path's existing
// posture: MCQ shape is required for every row regardless of question_type.
//
// `enforceBloomLevel` is ALSO left at its default (false) — a deliberate
// LOOSENING of this one copy. It was the only one of the three that checked
// bloom validity, and it is a SERVING path, so it must not drop an answerable
// question over a metadata tag: `question_bank.bloom_level` is nullable with no
// CHECK, and neither `select_quiz_questions_rag` nor `select_quiz_questions_v2`
// filters on it. See the option's TODO(assessment) for the flip condition.

// `keylessServing: true` (migration 20260814000017): every source below —
// the quiz-generator Edge Function, both serving RPCs, and the direct
// `question_bank` query — now withholds `correct_answer_index`, because the
// "index 0-3" half of P6 moved server-side into `question_bank_p6_valid`
// (a filter inside the RPCs, and a hard skip inside `start_quiz_session`).
// Without this flag the gate rejects every MCQ on `missing_answer_index`.
// A PRESENT-but-invalid index is still rejected exactly as before.
function validateQuestions(questions: unknown[]): QuizQuestion[] {
  return validateQuestionsP6(questions as QuizQuestion[], { keylessServing: true });
}

// ── Question fetch ────────────────────────────────────────────────────────────

/**
 * Fetch quiz questions with a declared source chain.
 *
 * Sources are tried in order. Each failure is LOGGED (not silently swallowed)
 * and the next source is tried. The response includes which source served
 * the questions — callers can log/alert when falling back.
 *
 * Source order:
 *   1. quiz-generator Edge Function (adaptive, IRT, RAG) → best
 *      (drift-report note 2026-07-13: this source previously named the
 *      `quiz-engine` function, which no longer exists in production — the
 *      invoke below was repointed to the canonical `quiz-generator`.)
 *   2. select_quiz_questions_rag RPC                      → good
 *   3. select_quiz_questions_v2 RPC                       → acceptable
 *   4. direct question_bank query                         → last resort
 */
export async function fetchQuizQuestions(
  input: QuizQuestionFetchInput
): Promise<ServiceResult<QuizQuestionSource>> {
  const diffMap: Record<string, number | null> = {
    easy: 1, medium: 2, hard: 3, mixed: null, progressive: null,
  };

  // ── Source 1: Edge Function (adaptive + RAG + IRT) ───────────────────────
  try {
    const { data: funcData, error: funcError } = await supabase.functions.invoke(
      'quiz-generator',
      {
        body: {
          student_id: input.studentId,
          subject: input.subject,
          grade: input.grade,
          count: input.count,
          difficulty: diffMap[input.difficultyMode] ?? null,
          chapter_number: input.chapterNumber,
          ability_estimate: input.irtTheta,
        },
      }
    );

    if (!funcError && funcData?.questions) {
      const questions = validateQuestions(
        Array.isArray(funcData.questions) ? funcData.questions : []
      );
      if (questions.length >= input.count) {
        return ok({ source: 'edge_fn', questions, count: questions.length });
      }
      // Partial result — log it, continue to next source for full count
      logger.warn('quiz_domain_edge_fn_partial', {
        requested: input.count,
        received: questions.length,
        subject: input.subject,
        grade: input.grade,
      });
    } else if (funcError) {
      logger.warn('quiz_domain_edge_fn_failed', {
        error: funcError.message,
        subject: input.subject,
        grade: input.grade,
      });
    }
  } catch (e) {
    logger.warn('quiz_domain_edge_fn_exception', {
      error: e instanceof Error ? e.message : String(e),
      subject: input.subject,
    });
  }

  // ── Source 2: RAG RPC ─────────────────────────────────────────────────────
  try {
    const { data, error } = await supabase.rpc('select_quiz_questions_rag', {
      p_student_id: input.studentId,
      p_subject: input.subject,
      p_grade: input.grade,
      p_chapter_number: input.chapterNumber,
      p_count: input.count,
      p_difficulty_mode: input.difficultyMode,
      p_question_types: input.questionTypes,
      p_query_embedding: null,
    });

    if (!error && data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      const questions = validateQuestions(Array.isArray(parsed) ? parsed : []);
      if (questions.length > 0) {
        return ok({ source: 'rpc_rag', questions, count: questions.length });
      }
    } else if (error) {
      logger.warn('quiz_domain_rpc_rag_failed', {
        error: error.message,
        subject: input.subject,
      });
    }
  } catch (e) {
    logger.warn('quiz_domain_rpc_rag_exception', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // ── Source 3: V2 RPC ──────────────────────────────────────────────────────
  try {
    const { data, error } = await supabase.rpc('select_quiz_questions_v2', {
      p_student_id: input.studentId,
      p_subject: input.subject,
      p_grade: input.grade,
      p_chapter_number: input.chapterNumber,
      p_count: input.count,
      p_difficulty_mode: input.difficultyMode,
      p_question_types: input.questionTypes,
    });

    if (!error && data) {
      const parsed = typeof data === 'string' ? JSON.parse(data) : data;
      const questions = validateQuestions(Array.isArray(parsed) ? parsed : []);
      if (questions.length > 0) {
        return ok({ source: 'rpc_v2', questions, count: questions.length });
      }
    } else if (error) {
      logger.warn('quiz_domain_rpc_v2_failed', {
        error: error.message,
        subject: input.subject,
      });
    }
  } catch (e) {
    logger.warn('quiz_domain_rpc_v2_exception', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // ── Source 4: Direct question_bank query (last resort) ───────────────────
  // This path is the degraded baseline. It bypasses adaptive logic entirely.
  // An alert should fire if this path is hit in production frequently.
  logger.warn('quiz_domain_fallback_direct_query', {
    subject: input.subject,
    grade: input.grade,
    studentId: input.studentId,
    allSourcesFailed: true,
  });

  const seenIds = new Set<string>();
  try {
    const { data: histData } = await supabase
      .from('user_question_history')
      .select('question_id')
      .eq('student_id', input.studentId)
      .eq('subject', input.subject)
      .eq('grade', input.grade)
      .limit(500);
    if (histData) histData.forEach(h => seenIds.add(h.question_id));
  } catch {
    // Best-effort dedup — proceed without it
  }

  const fetchLimit = Math.min(input.count * 4, 120);
  let query = supabase
    .from('question_bank')
    // KEYLESS (migration 20260814000017): `correct_answer_index` is deliberately
    // absent. The P6 "index 0-3" check it existed for now runs server-side.
    .select(
      'id, question_text, question_hi, question_type, options, ' +
      'explanation, explanation_hi, hint, difficulty, bloom_level, chapter_number'
    )
    .eq('subject', input.subject)
    .eq('grade', input.grade)
    .eq('is_active', true)
    .limit(fetchLimit);

  const diff = diffMap[input.difficultyMode];
  if (diff != null) query = query.eq('difficulty', diff);
  if (input.chapterNumber != null) query = query.eq('chapter_number', input.chapterNumber);

  const { data, error } = await query;
  if (error) {
    return fail(`question_bank query failed: ${error.message}`, 'DB_ERROR');
  }

  const validated = validateQuestions(data ?? []);
  const unseen = validated.filter(q => !seenIds.has(q.id));
  const seen   = validated.filter(q =>  seenIds.has(q.id));
  // Fisher-Yates via the canonical shuffle. The previous
  // `.sort(() => Math.random() - 0.5)` was a non-transitive comparator: it
  // barely permuted the rows, so this `.slice(0, count)` kept handing the
  // student whichever questions the query happened to return first.
  const pool = [
    ...shuffle(unseen),
    ...shuffle(seen),
  ].slice(0, input.count);

  return ok({ source: 'direct_query', questions: pool, count: pool.length });
}

// ── Quiz session submission ───────────────────────────────────────────────────

/**
 * Submit quiz results.
 *
 * CONTRACT:
 *   1. Try submit_quiz_results RPC — atomic, triggers BKT + IRT update
 *   2. If RPC fails: log the failure, attempt manual session insert
 *   3. XP is NEVER calculated client-side; it comes from the RPC
 *   4. If both paths fail: return fail() — do NOT silently return zeroed data
 *
 * What changed vs old supabase.ts:
 *   - Silent console.warn → structured logger.warn with context
 *   - Last-resort anon upsert of XP removed — too dangerous to run from client
 *   - Returns ServiceResult so callers can handle failure explicitly
 */
export async function submitQuizSession(
  input: QuizSubmissionInput
): Promise<ServiceResult<QuizSessionResult>> {
  const { studentId, subject, grade, topic, chapter, responses, timeTakenSeconds } = input;

  // ── Path 1: Authoritative RPC ─────────────────────────────────────────────
  try {
    const { data, error } = await supabase.rpc('submit_quiz_results', {
      p_student_id: studentId,
      p_subject: subject,
      p_grade: grade,
      p_topic: topic,
      p_chapter: chapter,
      p_responses: responses,
      p_time: timeTakenSeconds,
    });

    if (!error && data) {
      return ok(data as QuizSessionResult);
    }

    if (error) {
      logger.error('quiz_domain_submit_rpc_failed', {
        error: new Error(error.message),
        studentId,
        subject,
        grade,
      });
    }
  } catch (e) {
    logger.error('quiz_domain_submit_rpc_exception', {
      error: e instanceof Error ? e : new Error(String(e)),
      studentId,
      subject,
    });
  }

  // ── Path 2: REMOVED (audit M5, 2026-08-14) ──────────────────────────────
  // The old fallback did a NON-ATOMIC split-write: a manual `quiz_sessions`
  // INSERT followed by a SEPARATE `atomic_quiz_profile_update` RPC. If a
  // process died between the two, a session row existed with no XP/profile/
  // ledger write (authoritative-state loss). Quiz submission MUST be atomic
  // via a single RPC (product invariant P4). This module has zero production
  // callers (verified 2026-08-14), so the fallback is fail-closed: when the
  // authoritative RPC fails, return an explicit failure — never a partial,
  // unrecoverable write.
  return fail(
    'Quiz submission failed: scoring RPC unavailable. Results not saved.',
    'DB_ERROR'
  );
}

// ── IRT theta fetch ───────────────────────────────────────────────────────────

/**
 * Fetch student ability estimate for a subject.
 * Returns null if not yet calibrated (≤5 responses) — this is expected.
 */
export async function getStudentIrtTheta(
  studentId: string,
  subject: string
): Promise<ServiceResult<number | null>> {
  try {
    const { data, error } = await supabase
      .from('student_learning_profiles')
      .select('irt_theta')
      .eq('student_id', studentId)
      .eq('subject', subject)
      .maybeSingle();

    if (error) {
      return fail(`IRT theta fetch failed: ${error.message}`, 'DB_ERROR');
    }

    return ok((data?.irt_theta as number | null) ?? null);
  } catch (e) {
    return fail(
      `IRT theta fetch exception: ${e instanceof Error ? e.message : String(e)}`,
      'DB_ERROR'
    );
  }
}
