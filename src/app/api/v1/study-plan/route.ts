import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/v1/study-plan — View active study plan for the authenticated student
 * Permission: study_plan.view
 */
export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'study_plan.view', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;

    const { data, error } = await supabaseAdmin
      .from('study_plans')
      .select('*, study_plan_tasks(*)')
      .eq('student_id', auth.studentId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    logAudit(auth.userId, {
      action: 'view',
      resourceType: 'study_plan',
      resourceId: data?.id,
    });

    if (error) {
      return NextResponse.json(
        { error: 'No study plan found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data });
  } catch (err) {
    logger.error('study_plan_view_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/v1/study-plan' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
