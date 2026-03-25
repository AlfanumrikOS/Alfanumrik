import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/child/:id/progress — View child's learning progress
 * Permission: child.view_progress
 * Resource check: parent must be linked to this child.
 *
 * Returns quiz history, concept mastery, and learning velocity.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: childId } = await params;

    const auth = await authorizeRequest(request, 'child.view_progress', {
      resourceCheck: { type: 'student', id: childId },
    });
    if (!auth.authorized) return auth.errorResponse!;

    // Fetch progress data in parallel
    const [quizzes, mastery, velocity, studyPlan] = await Promise.all([
      supabaseAdmin
        .from('quiz_sessions')
        .select(
          'id, subject, score_percent, total_questions, correct_answers, completed_at'
        )
        .eq('student_id', childId)
        .order('completed_at', { ascending: false })
        .limit(20),
      supabaseAdmin
        .from('concept_mastery')
        .select(
          'topic_id, mastery_probability, consecutive_correct, updated_at'
        )
        .eq('student_id', childId),
      supabaseAdmin
        .from('learning_velocity')
        .select(
          'subject, weekly_mastery_rate, acceleration, predicted_mastery_date'
        )
        .eq('student_id', childId),
      supabaseAdmin
        .from('study_plans')
        .select('id, plan_name, is_active, created_at')
        .eq('student_id', childId)
        .eq('is_active', true)
        .limit(1)
        .single(),
    ]);

    logAudit(auth.userId, {
      action: 'view',
      resourceType: 'child_progress',
      resourceId: childId,
    });

    return NextResponse.json({
      student_id: childId,
      quizzes: quizzes.data || [],
      mastery: mastery.data || [],
      velocity: velocity.data || [],
      active_study_plan: studyPlan.data || null,
    });
  } catch (err) {
    logger.error('child_progress_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/v1/child/[id]/progress' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
