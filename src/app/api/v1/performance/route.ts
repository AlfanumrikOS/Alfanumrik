import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit, canAccessStudent } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isValidUUID } from '@/lib/sanitize';
import { listConceptMasteryByStudent } from '@/lib/domains/practice';

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
    if (requestedStudentId && !isValidUUID(requestedStudentId)) {
      return NextResponse.json(
        { error: 'Invalid student_id format', code: 'BAD_REQUEST' },
        { status: 400 }
      );
    }
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

    // Fetch performance data in parallel.
    // concept_mastery slice goes through the practice domain (Phase 0e);
    // mapped back to snake_case so the wire format stays identical to clients.
    const [quizzes, masteryResult, velocity] = await Promise.all([
      supabaseAdmin
        .from('quiz_sessions')
        .select(
          'id, subject, score_percent, total_questions, correct_answers, completed_at'
        )
        .eq('student_id', targetStudentId)
        .order('completed_at', { ascending: false })
        .limit(20),
      listConceptMasteryByStudent(targetStudentId, { limit: 200 }),
      supabaseAdmin
        .from('learning_velocity')
        .select(
          'subject, weekly_mastery_rate, acceleration, predicted_mastery_date'
        )
        .eq('student_id', targetStudentId)
        .limit(50),
    ]);

    const masteryRows = masteryResult.ok
      ? masteryResult.data.map((m) => ({
          topic_id: m.topicId,
          mastery_probability: m.masteryProbability,
          consecutive_correct: m.consecutiveCorrect,
          updated_at: m.updatedAt,
        }))
      : [];

    logAudit(auth.userId, {
      action: 'view',
      resourceType: 'performance',
      resourceId: targetStudentId,
    });

    return NextResponse.json({
      student_id: targetStudentId,
      quizzes: quizzes.data || [],
      mastery: masteryRows,
      velocity: velocity.data || [],
    }, {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    logger.error('performance_view_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/v1/performance' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
