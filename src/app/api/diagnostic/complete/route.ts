/**
 * POST /api/diagnostic/complete
 *
 * Records all diagnostic responses and calls the complete_diagnostic_session RPC
 * to compute weak/strong topics and recommended difficulty.
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
 * Response: { success: true, data: { session summary from RPC } }
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

    // 4. Resolve student and verify session ownership via admin client
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

    // 5. Verify the session belongs to this student
    const { data: session, error: sessionError } = await admin
      .from('diagnostic_sessions')
      .select('id, status')
      .eq('id', session_id)
      .eq('student_id', student.id)
      .single();

    if (sessionError || !session) {
      return NextResponse.json(
        { success: false, error: 'Diagnostic session not found.', code: 'SESSION_NOT_FOUND' },
        { status: 404 }
      );
    }

    if (session.status === 'completed') {
      return NextResponse.json(
        { success: false, error: 'This diagnostic session is already completed.', code: 'ALREADY_COMPLETED' },
        { status: 409 }
      );
    }

    // 6. Insert all responses into diagnostic_responses
    const responseRows = responses.map((r) => ({
      session_id,
      student_id: student.id,
      question_id: r.question_id,
      selected_answer_index: r.selected_answer_index,
      is_correct: r.is_correct,
      time_taken_seconds: r.time_taken_seconds,
      topic: r.topic ?? null,
      difficulty: r.difficulty,
      bloom_level: r.bloom_level,
    }));

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

    // 7. Call RPC to compute summary and mark session complete
    const { data: summary, error: rpcError } = await admin.rpc(
      'complete_diagnostic_session',
      { p_session_id: session_id }
    );

    if (rpcError) {
      logger.error('diagnostic_complete_rpc_failed', {
        error: new Error(rpcError.message),
        route: '/api/diagnostic/complete',
        studentId: student.id,
        session_id,
      });
      // Fallback: return a basic summary computed from the responses we have
      const correctCount = responses.filter((r) => r.is_correct).length;
      const total = responses.length;
      const scorePercent = Math.round((correctCount / total) * 100);
      return NextResponse.json({
        success: true,
        data: {
          session_id,
          score_percent: scorePercent,
          correct_answers: correctCount,
          total_questions: total,
          weak_topics: [],
          strong_topics: [],
          recommended_difficulty: scorePercent < 40 ? 'easy' : scorePercent < 70 ? 'medium' : 'hard',
          rpc_failed: true,
        },
      });
    }

    return NextResponse.json({ success: true, data: summary });
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
