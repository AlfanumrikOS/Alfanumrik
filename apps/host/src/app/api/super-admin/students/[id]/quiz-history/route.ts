import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, isValidUUID } from '@alfanumrik/lib/admin-auth';
import { auditPiiReadThrottled } from '@alfanumrik/lib/admin-audit-throttle';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import {
  validateImpersonationSession,
  recordPageView,
} from '../../_lib/validate-session';

// GET /api/super-admin/students/[id]/quiz-history — quiz history for Live View
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Phase G.1: admin level. Phase G.5: throttled audit.
  const auth = await authorizeAdmin(request, 'admin');
  if (!auth.authorized) return auth.response;

  const { id: studentId } = await params;
  if (!isValidUUID(studentId)) {
    return NextResponse.json({ error: 'Invalid student ID' }, { status: 400 });
  }

  const ipAddress = request.headers.get('x-forwarded-for') || undefined;
  auditPiiReadThrottled(auth, 'student_quiz_history.read', 'student', studentId, undefined, ipAddress);

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
      // Source: quiz_responses — the table the atomic server-side submit path
      // writes (P4). A second read of the legacy `question_responses` table
      // used to sit here as a "v2 cognitive" fallback; that table has ZERO
      // rows in production (its only writer was a client-side fire-and-forget
      // insert, now removed), so the fallback could only ever return [] while
      // costing an extra round trip on every empty session. Removed
      // 2026-08-24. Do not reintroduce it.
      const { data: coreResponses } = await supabaseAdmin
        .from('quiz_responses')
        .select(
          'id, question_id, question_text, options, correct_answer_index, student_answer_index, student_answer_text, is_correct, time_taken_seconds, explanation, bloom_level, difficulty, error_type, created_at'
        )
        .eq('quiz_session_id', quizId)
        .order('created_at', { ascending: true });

      responses = coreResponses || [];
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
