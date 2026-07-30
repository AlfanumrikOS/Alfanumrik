/**
 * POST /api/diagnostic/complete
 *
 * Records all diagnostic responses into diagnostic_responses and marks the
 * diagnostic_assessments row complete, computing the summary server-side.
 *
 * Note: `session_id` in the request/response is the diagnostic_assessments.id
 * UUID — the name is kept for backward compatibility with the /diagnostic
 * page contract.
 *
 * Request body:
 * {
 *   session_id: string,
 *   responses: Array<{
 *     question_id: string,
 *     selected_answer_index: number,
 *     is_correct?: boolean,     // ACCEPTED FOR WIRE-COMPAT, NEVER READ — see C1
 *     time_taken_seconds: number,
 *     topic: string | null,
 *     difficulty: number,
 *     bloom_level: string,
 *   }>
 * }
 *
 * Response: {
 *   success: true,
 *   data: {
 *     session_id, score_percent, correct_answers, total_questions,
 *     weak_topics, strong_topics, recommended_difficulty, placement_confidence
 *   }
 * }
 *
 * Correctness contract — spec
 * `docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md` §7A:
 *
 *  - C1: correctness is ALWAYS re-derived server-side from
 *    `question_bank.correct_answer_index`. The client-sent `is_correct` is
 *    never read — not for `diagnostic_responses.is_correct`, and not for the
 *    `score_percent` numerator. A missing bank row scores as incorrect and is
 *    logged as `diagnostic_answer_unresolvable`.
 *  - C2: a speed-run (< 3s average per question) still stores and scores
 *    normally (the diagnostic is XP-neutral, there is nothing to reject), but
 *    the placement output is forced to 'medium' and flagged
 *    `placement_confidence: 'low'`. This is a placement-validity rule, not an
 *    anti-cheat change — P3's three checks live on the XP-bearing quiz path
 *    and are neither removed nor weakened here.
 *  - P1 is unchanged: `score_percent = Math.round((correct / total) * 100)`
 *    over the SERVER-derived correct count, at every form length.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { calculateScorePercent } from '@alfanumrik/lib/scoring';
import { DIAGNOSTIC_PLACEMENT_THRESHOLDS } from '@alfanumrik/lib/diagnostic/placement';

interface DiagnosticResponseItem {
  question_id: string;
  selected_answer_index: number;
  /**
   * C1: accepted on the wire for backward compatibility with shipped clients
   * (web + any older mobile build) but DELIBERATELY NEVER READ. Correctness is
   * re-derived from `question_bank.correct_answer_index` below. Do not
   * reintroduce a read of this field.
   */
  is_correct?: boolean;
  time_taken_seconds: number;
  topic: string | null;
  difficulty: number;
  bloom_level: string;
}

/**
 * §7.5a boundaries live in `@alfanumrik/lib/diagnostic/placement` — the SAME
 * export the client results screen reads (via `apps/host/src/app/diagnostic/
 * copy.ts`'s `RESULT_THRESHOLDS`), so server placement and client encouragement
 * cannot drift apart.
 *
 * They are DELIBERATELY not re-exported from this route module: a Next.js 16
 * App Router `route.ts` may export only handlers + the fixed segment-config
 * keys, and a stray `export const` here fails `next build`. Import the lib
 * module directly (tests included).
 */

/** C2 — below this average seconds-per-question the placement signal is noise. */
const MIN_AVG_SECONDS_PER_QUESTION = 3;

function placementFromScore(scorePercent: number): 'easy' | 'medium' | 'hard' {
  if (scorePercent < DIAGNOSTIC_PLACEMENT_THRESHOLDS.medium) return 'easy';
  if (scorePercent < DIAGNOSTIC_PLACEMENT_THRESHOLDS.hard) return 'medium';
  return 'hard';
}

export async function POST(request: NextRequest) {
  try {
    // 1. Authorize — requires 'diagnostic.complete' permission (P9: RBAC enforcement)
    const auth = await authorizeRequest(request, 'diagnostic.complete');
    if (!auth.authorized) return auth.errorResponse!;
    const userId = auth.userId!;

    // 2. Parse body
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', code: 'INVALID_BODY' },
        { status: 400 }
      );
    }

    const { session_id, responses } = body as {
      session_id?: string;
      responses?: DiagnosticResponseItem[];
    };

    // 3. Validate required fields
    if (!session_id || typeof session_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'session_id is required.', code: 'MISSING_SESSION_ID' },
        { status: 400 }
      );
    }

    if (!Array.isArray(responses) || responses.length === 0) {
      return NextResponse.json(
        { success: false, error: 'responses array is required and must not be empty.', code: 'MISSING_RESPONSES' },
        { status: 400 }
      );
    }

    // 4. Resolve student and verify assessment ownership via admin client
    const admin = getSupabaseAdmin();

    const { data: student, error: studentError } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', userId)
      .single();

    if (studentError || !student) {
      return NextResponse.json(
        { success: false, error: 'Student profile not found.', code: 'NO_STUDENT' },
        { status: 404 }
      );
    }

    // 5. Verify the assessment belongs to this student
    const { data: session, error: sessionError } = await admin
      .from('diagnostic_assessments')
      .select('id, is_completed')
      .eq('id', session_id)
      .eq('student_id', student.id)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { success: false, error: 'Diagnostic session not found.', code: 'SESSION_NOT_FOUND' },
        { status: 404 }
      );
    }

    if (session.is_completed === true) {
      return NextResponse.json(
        { success: false, error: 'This diagnostic session is already completed.', code: 'ALREADY_COMPLETED' },
        { status: 409 }
      );
    }

    // 6. Look up the authoritative question rows. This serves two purposes:
    //    (a) filling the NOT NULL diagnostic_responses.question_text column, and
    //    (b) C1 — supplying `correct_answer_index`, the ONLY source of truth for
    //        correctness. The client's `is_correct` is never consulted.
    const questionIds = Array.from(
      new Set(
        responses
          .map((r) => r.question_id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    type BankRow = {
      id: string;
      question_text: string;
      options: unknown;
      correct_answer_index: number | null;
    };
    const bankById = new Map<string, BankRow>();

    if (questionIds.length > 0) {
      const { data: bankRows, error: bankError } = await admin
        .from('question_bank')
        .select('id, question_text, options, correct_answer_index')
        .in('id', questionIds);

      if (bankError) {
        logger.warn('diagnostic_question_lookup_failed', {
          route: '/api/diagnostic/complete',
          studentId: student.id,
          session_id,
          error: bankError.message,
        });
      } else {
        for (const row of (bankRows ?? []) as BankRow[]) {
          bankById.set(row.id, row);
        }
      }
    }

    // 7. Replace any prior responses for this assessment (makes a retry after
    //    a partial failure safe — there is no unique constraint to upsert on),
    //    then insert all responses into diagnostic_responses.
    const { error: deleteError } = await admin
      .from('diagnostic_responses')
      .delete()
      .eq('assessment_id', session_id);

    if (deleteError) {
      logger.warn('diagnostic_responses_cleanup_failed', {
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
        error: deleteError.message,
      });
      // Continue — on a first attempt there is nothing to delete anyway.
    }

    // C1: re-derive correctness for every response. `r.is_correct` is not read
    // anywhere in this function — the only inputs are the student's submitted
    // index and the bank row's `correct_answer_index`.
    let unresolvableCount = 0;

    const responseRows = responses.map((r, idx) => {
      const bank = bankById.get(r.question_id);
      const timeSeconds = Number(r.time_taken_seconds);
      const studentIndex = Number.isInteger(r.selected_answer_index)
        ? r.selected_answer_index
        : null;
      const correctIndex =
        typeof bank?.correct_answer_index === 'number' ? bank.correct_answer_index : null;

      // A missing bank row (deleted/renamed question, or a forged question_id)
      // resolves to incorrect — never to the client's claim.
      const serverIsCorrect =
        correctIndex !== null && studentIndex !== null && studentIndex === correctIndex;
      if (correctIndex === null) unresolvableCount++;

      return {
        assessment_id: session_id,
        student_id: student.id,
        question_number: idx + 1,
        concept_code: typeof r.topic === 'string' && r.topic ? r.topic : 'unknown',
        layer: 1,
        question_text: bank?.question_text ?? '',
        options: bank?.options ?? null,
        correct_index: correctIndex,
        student_index: studentIndex,
        is_correct: serverIsCorrect,
        response_time_ms: Number.isFinite(timeSeconds)
          ? Math.max(0, Math.round(timeSeconds * 1000))
          : null,
      };
    });

    if (unresolvableCount > 0) {
      logger.warn('diagnostic_answer_unresolvable', {
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
        unresolvable: unresolvableCount,
        total: responseRows.length,
      });
    }

    const { error: insertError } = await admin
      .from('diagnostic_responses')
      .insert(responseRows);

    if (insertError) {
      logger.error('diagnostic_insert_responses_failed', {
        error: new Error(insertError.message),
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to save responses. Please try again.', code: 'INSERT_ERROR' },
        { status: 500 }
      );
    }

    // 8. Compute summary server-side and mark the assessment complete.
    //    P1: score_percent = Math.round((correct / total) * 100) — computed over
    //    the SERVER-derived correctness in `responseRows`, never over the client
    //    payload (C1).
    const totalQuestions = responseRows.length;
    const correctCount = responseRows.filter((r) => r.is_correct === true).length;
    const scorePercent = calculateScorePercent(correctCount, totalQuestions);
    const actualTimeSeconds = Math.max(
      0,
      Math.round(
        responses.reduce((sum, r) => {
          const t = Number(r.time_taken_seconds);
          return sum + (Number.isFinite(t) ? t : 0);
        }, 0)
      )
    );

    // §7.5a — recalibrated 50 / 80 boundaries.
    let recommendedDifficulty = placementFromScore(scorePercent);

    // C2 — a speed-run produces a meaningless theta. Score and responses are
    // still stored and shown (XP-neutral surface, nothing to reject), but the
    // platform must not act on the placement.
    const avgSecondsPerQuestion =
      totalQuestions > 0 ? actualTimeSeconds / totalQuestions : 0;
    const placementConfidence: 'low' | 'normal' =
      avgSecondsPerQuestion < MIN_AVG_SECONDS_PER_QUESTION ? 'low' : 'normal';
    if (placementConfidence === 'low') {
      recommendedDifficulty = 'medium';
      logger.info('diagnostic_placement_low_confidence', {
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
        avgSecondsPerQuestion: Math.round(avgSecondsPerQuestion * 100) / 100,
        totalQuestions,
      });
    }

    const { error: updateError } = await admin
      .from('diagnostic_assessments')
      .update({
        is_completed: true,
        completed_at: new Date().toISOString(),
        total_questions: totalQuestions,
        correct_answers: correctCount,
        raw_score_pct: scorePercent,
        actual_time_seconds: actualTimeSeconds,
        next_path: {
          recommended_difficulty: recommendedDifficulty,
          placement_confidence: placementConfidence,
        },
      })
      .eq('id', session_id)
      .eq('student_id', student.id);

    if (updateError) {
      // Responses are saved; do not fail the student's submission over the
      // summary write. The assessment stays incomplete, and step 7's
      // delete-then-insert makes a later retry safe.
      logger.error('diagnostic_complete_update_failed', {
        error: new Error(updateError.message),
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
      });
    }

    // Topic-level weak/strong analysis is intentionally empty for now: the
    // client sends topic_id UUIDs (not display names), and the previous
    // implementation's live behavior was the empty-array fallback. The page
    // renders its "analysis not available" empty state for empty arrays.
    return NextResponse.json({
      success: true,
      data: {
        session_id,
        score_percent: scorePercent,
        correct_answers: correctCount,
        total_questions: totalQuestions,
        weak_topics: [],
        strong_topics: [],
        recommended_difficulty: recommendedDifficulty,
        placement_confidence: placementConfidence,
      },
    });
  } catch (err) {
    logger.error('diagnostic_complete_unexpected', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/diagnostic/complete',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
