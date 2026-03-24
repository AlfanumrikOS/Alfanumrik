import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit, canAccessStudent } from '@/lib/rbac';
import { createClient } from '@supabase/supabase-js';

function getDb() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '');
}

/**
 * GET /api/v1/performance — View performance data
 * Permission: progress.view_own
 *
 * Students see their own performance. Teachers/parents can pass
 * ?student_id=xxx to view a linked student's performance.
 */
export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'progress.view_own');
    if (!auth.authorized) return auth.errorResponse!;

    const url = new URL(request.url);
    let targetStudentId = auth.studentId;

    // If a specific student_id is requested, verify access
    const requestedStudentId = url.searchParams.get('student_id');
    if (requestedStudentId && requestedStudentId !== auth.studentId) {
      if (!auth.userId) {
        return NextResponse.json(
          { error: 'Access denied' },
          { status: 403 }
        );
      }
      const hasAccess = await canAccessStudent(auth.userId, requestedStudentId);
      if (!hasAccess) {
        return NextResponse.json(
          { error: 'Access denied to this student' },
          { status: 403 }
        );
      }
      targetStudentId = requestedStudentId;
    }

    if (!targetStudentId) {
      return NextResponse.json(
        { error: 'No student context available' },
        { status: 400 }
      );
    }

    // Fetch performance data in parallel
    const [quizzes, mastery, velocity] = await Promise.all([
      getDb()
        .from('quiz_sessions')
        .select(
          'id, subject, score_percent, total_questions, correct_answers, completed_at'
        )
        .eq('student_id', targetStudentId)
        .order('completed_at', { ascending: false })
        .limit(20),
      getDb()
        .from('concept_mastery')
        .select(
          'topic_id, mastery_probability, consecutive_correct, updated_at'
        )
        .eq('student_id', targetStudentId),
      getDb()
        .from('learning_velocity')
        .select(
          'subject, weekly_mastery_rate, acceleration, predicted_mastery_date'
        )
        .eq('student_id', targetStudentId),
    ]);

    logAudit(auth.userId, {
      action: 'view',
      resourceType: 'performance',
      resourceId: targetStudentId,
    });

    return NextResponse.json({
      student_id: targetStudentId,
      quizzes: quizzes.data || [],
      mastery: mastery.data || [],
      velocity: velocity.data || [],
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
