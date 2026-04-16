import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/school-admin/analytics
 *
 * Returns dashboard stats for the school admin's school.
 * Permission: institution.view_analytics
 *
 * Response shape:
 * {
 *   success: true,
 *   data: {
 *     totalStudents, activeStudents, activeToday, totalTeachers,
 *     totalClasses, quizzesThisWeek, avgScore,
 *     seatsPurchased, seatsUsed, plan
 *   }
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'institution.view_analytics');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    // Run all queries in parallel, all scoped to schoolId
    const [
      studentsResult,
      activeStudentsResult,
      activeTodayResult,
      teachersResult,
      classesResult,
      quizzesResult,
      subscriptionResult,
    ] = await Promise.all([
      // Total students
      supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId),

      // Active students (is_active = true)
      supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .eq('is_active', true),

      // Active today (last_active within today)
      supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .gte('last_active', new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),

      // Total teachers
      supabase
        .from('teachers')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .eq('is_active', true),

      // Total classes
      supabase
        .from('classes')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId),

      // Quizzes this week (score_percent for avg)
      supabase
        .from('quiz_sessions')
        .select('score_percent')
        .eq('school_id', schoolId)
        .gte('created_at', getStartOfWeek().toISOString()),

      // School subscription
      supabase
        .from('school_subscriptions')
        .select('plan, seats_purchased, status')
        .eq('school_id', schoolId)
        .maybeSingle(),
    ]);

    // Calculate avg score from this week's quizzes
    const quizzes = quizzesResult.data ?? [];
    const quizzesThisWeek = quizzes.length;
    const avgScore =
      quizzesThisWeek > 0
        ? Math.round(
            quizzes.reduce((sum, q) => sum + (q.score_percent ?? 0), 0) /
              quizzesThisWeek
          )
        : 0;

    // Seats used = active students count
    const seatsUsed = activeStudentsResult.count ?? 0;
    const subscription = subscriptionResult.data;

    return NextResponse.json({
      success: true,
      data: {
        totalStudents: studentsResult.count ?? 0,
        activeStudents: activeStudentsResult.count ?? 0,
        activeToday: activeTodayResult.count ?? 0,
        totalTeachers: teachersResult.count ?? 0,
        totalClasses: classesResult.count ?? 0,
        quizzesThisWeek,
        avgScore,
        seatsPurchased: subscription?.seats_purchased ?? 0,
        seatsUsed,
        plan: subscription?.plan ?? 'free',
      },
    });
  } catch (err) {
    logger.error('school_admin_analytics_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/analytics',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/** Returns the start of the current ISO week (Monday 00:00:00) */
function getStartOfWeek(): Date {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
