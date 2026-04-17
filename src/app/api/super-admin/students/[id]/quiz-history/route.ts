import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, isValidUUID } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  validateImpersonationSession,
  recordPageView,
} from '../../_lib/validate-session';

// GET /api/super-admin/students/[id]/quiz-history — quiz history for Live View
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  // Require active impersonation session
  const valid = await validateImpersonationSession(auth.adminId, studentId);
  if (!valid) {
    return NextResponse.json(
      { error: 'No active impersonation session' },
      { status: 403 }
    );
  }

  try {
    const url = new URL(request.url);
    const quizId = url.searchParams.get('quizId');

    // Fetch quiz sessions
    const { data: sessions, error } = await supabaseAdmin
      .from('quiz_sessions')
      .select(
        'id, subject, grade, topic_title, total_questions, correct_answers, wrong_answers, score_percent, time_taken_seconds, difficulty_level, is_completed, completed_at, created_at'
      )
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })
      .limit(30);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If a specific quizId is requested, fetch individual responses
    let responses: unknown[] = [];
    if (quizId && isValidUUID(quizId)) {
      // Try quiz_responses first (core schema), then question_responses (v2 cognitive)
      const { data: coreResponses } = await supabaseAdmin
        .from('quiz_responses')
        .select(
          'id, question_id, question_text, options, correct_answer_index, student_answer_index, student_answer_text, is_correct, time_taken_seconds, explanation, bloom_level, difficulty, created_at'
        )
        .eq('quiz_session_id', quizId)
        .order('created_at', { ascending: true });

      if (coreResponses && coreResponses.length > 0) {
        responses = coreResponses;
      } else {
        // Fallback to question_responses (v2 cognitive engine)
        const { data: cogResponses } = await supabaseAdmin
          .from('question_responses')
          .select(
            'id, question_id, selected_answer, is_correct, response_time_seconds, bloom_level_attempted, error_type, created_at'
          )
          .eq('quiz_session_id', quizId)
          .order('created_at', { ascending: true });

        responses = cogResponses || [];
      }
    }

    // Fire-and-forget page view tracking
    recordPageView(auth.adminId, studentId, 'quiz-history');

    return NextResponse.json({
      sessions: sessions || [],
      responses,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
