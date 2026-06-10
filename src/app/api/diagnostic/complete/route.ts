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
 *     is_correct: boolean,
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
 *     weak_topics, strong_topics, recommended_difficulty
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

interface DiagnosticResponseItem {
  question_id: string;
  selected_answer_index: number;
  is_correct: boolean;
  time_taken_seconds: number;
  topic: string | null;
  difficulty: number;
  bloom_level: string;
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

    // 6. Best-effort lookup of question content from question_bank so the
    //    NOT NULL diagnostic_responses.question_text column can be filled.
    //    Failure here must not block the student's results — fall back to ''.
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

    const responseRows = responses.map((r, idx) => {
      const bank = bankById.get(r.question_id);
      const timeSeconds = Number(r.time_taken_seconds);
      return {
        assessment_id: session_id,
        student_id: student.id,
        question_number: idx + 1,
        concept_code: typeof r.topic === 'string' && r.topic ? r.topic : 'unknown',
        layer: 1,
        question_text: bank?.question_text ?? '',
        options: bank?.options ?? null,
        correct_index: bank?.correct_answer_index ?? null,
        student_index: Number.isInteger(r.selected_answer_index)
          ? r.selected_answer_index
          : null,
        is_correct: r.is_correct === true,
        response_time_ms: Number.isFinite(timeSeconds)
          ? Math.max(0, Math.round(timeSeconds * 1000))
          : null,
      };
    });

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
    //    P1: score_percent = Math.round((correct / total) * 100)
    const totalQuestions = responses.length;
    const correctCount = responses.filter((r) => r.is_correct === true).length;
    const scorePercent = Math.round((correctCount / totalQuestions) * 100);
    const actualTimeSeconds = Math.max(
      0,
      Math.round(
        responses.reduce((sum, r) => {
          const t = Number(r.time_taken_seconds);
          return sum + (Number.isFinite(t) ? t : 0);
        }, 0)
      )
    );
    const recommendedDifficulty =
      scorePercent < 40 ? 'easy' : scorePercent < 70 ? 'medium' : 'hard';

    const { error: updateError } = await admin
      .from('diagnostic_assessments')
      .update({
        is_completed: true,
        completed_at: new Date().toISOString(),
        total_questions: totalQuestions,
        correct_answers: correctCount,
        raw_score_pct: scorePercent,
        actual_time_seconds: actualTimeSeconds,
        next_path: { recommended_difficulty: recommendedDifficulty },
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
