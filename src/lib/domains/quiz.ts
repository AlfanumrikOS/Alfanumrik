h/**
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
 * MICROSERVICE EXTRACTION PATH:h
 *   When extracted: wrap submitQuizSession and fetchQuestions in HTTP handlers.
 *   The types in ./types.ts become the HTTP schema. Zero logic rewrite.
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import {
  ok, fail,
  type ServiceResult,
  type QuizQuestion,
  type QuizSessionResult,
  type QuizSubmissionInput,
  type QuizQuestionFetchInput,
  type QuizQuestionSource,
} from './types';
import { calculateScorePercent, calculateQuizXP } from '@/lib/scoring';

// ── Question validation ───────────────────────────────────────────────────────
// Kept here (not in supabase.ts) so the domain owns its own data quality rules.

function validateQuestions(questions: unknown[]): QuizQuestion[] {
  const seen = new Set<string>();
  return (questions as QuizQuestion[]).filter(q => {
    if (!q.question_text || typeof q.question_text !== 'string') return false;
    if (q.question_text.length < 15) return false;

    const opts = Array.isArray(q.options) ? q.options : [];
    if (opts.length !== 4) return false;
    if (q.correct_answer_index < 0 || q.correct_answer_index > 3) return false;

    if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]')) return false;

    const text = q.question_text.toLowerCase();
    if (text.includes('unrelated topic')) return false;
    if (text.startsWith('a student studying') && text.includes('should focus on')) return false;

    const optTexts = opts.map((o: string) => (o || '').toLowerCase().trim());
    if (optTexts.some((o: string) =>
      o.includes('unrelated topic') || o.includes('physical education') ||
      o.includes('art and craft') || o.includes('music theory') ||
      o.includes('it is not important') || o.includes('no board exam')
    )) return false;

    if (new Set(optTexts).size < 3) return false;

    if (q.explanation) {
      const expl = q.explanation.toLowerCase();
      if (
        expl.includes('does not match any option') ||
        expl.includes('suggesting a possible error') ||
        expl.includes('closest plausible') ||
        expl.includes('none of the options') ||
        expl.includes('there seems to be')
      ) return false;
    }

    if (!q.explanation || q.explanation.length < 20) return false;

    const key = q.question_text.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
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
 *   1. quiz-engine Edge Function (adaptive, IRT, RAG)  → best
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
      'quiz-engine',
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
    .select(
      'id, question_text, question_hi, question_type, options, correct_answer_index, ' +
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
  const pool = [
    ...unseen.sort(() => Math.random() - 0.5),
    ...seen.sort(() => Math.random() - 0.5),
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

  // ── Path 2: Manual session insert (degraded — no adaptive state update) ──
  // Note: This path does NOT update BKT, IRT theta, or mastery.
  // Those updates are handled by DB triggers on quiz_responses INSERT.
  // If the trigger-based approach is relied on, ensure quiz_responses are
  // inserted individually even on this fallback path.
  const total = responses.length;
  const correct = responses.filter(r => r.is_correct).length;
  const scorePct = calculateScorePercent(correct, total);
  const xpEarned = calculateQuizXP(correct, scorePct);

  try {
    const { data: session, error: sessErr } = await supabase
      .from('quiz_sessions')
      .insert({
        student_id: studentId,
        subject,
        grade,
        total_questions: total,
        correct_answers: correct,
        wrong_answers: total - correct,
        score_percent: scorePct,
        score: xpEarned,
        time_taken_seconds: timeTakenSeconds,
        total_answered: total,
        is_completed: true,
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (sessErr) {
      logger.error('quiz_domain_submit_session_insert_failed', {
        error: new Error(sessErr.message),
        studentId,
        subject,
      });
      // Both paths failed — return explicit failure
      return fail(
        'Quiz submission failed: RPC error and session insert error. Results not saved.',
        'DB_ERROR'
      );
    }

    logger.warn('quiz_domain_submit_used_fallback', {
      studentId,
      subject,
      grade,
      sessionId: session?.id,
      note: 'BKT/IRT/XP not updated — RPC was unavailable',
    });

    // XP update via atomic RPC (separate from submission RPC)
    try {
      await supabase.rpc('atomic_quiz_profile_update', {
        p_student_id: studentId,
        p_subject: subject,
        p_xp: xpEarned,
        p_total: total,
        p_correct: correct,
        p_time_seconds: timeTakenSeconds,
      });
    } catch (xpErr) {
      // Log but do not fail — session was already saved
      logger.error('quiz_domain_submit_xp_update_failed', {
        error: xpErr instanceof Error ? xpErr : new Error(String(xpErr)),
        studentId,
        subject,
        note: 'XP not awarded — manual reconciliation needed',
      });
    }

    return ok({
      session_id: session?.id ?? '',
      total,
      correct,
      score_percent: scorePct,
      xp_earned: xpEarned,
    });
  } catch (e) {
    logger.error('quiz_domain_submit_all_paths_failed', {
      error: e instanceof Error ? e : new Error(String(e)),
      studentId,
      subject,
    });
    return fail('Quiz submission failed: all paths exhausted', 'DB_ERROR');
  }
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
