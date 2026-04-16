import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * Authenticate an incoming request using a school API key.
 *
 * Expects: Authorization: Bearer sk_school_...
 * Verifies: SHA-256 hash matches, key is active, not expired.
 * Returns school_id + key permissions on success, null on failure.
 */
async function authenticateApiKey(
  request: NextRequest
): Promise<{ schoolId: string; keyId: string; permissions: string[] } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer sk_school_')) return null;

  const key = authHeader.replace('Bearer ', '');

  // SHA-256 hash the provided key (Edge-compatible)
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(key));
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const supabase = getSupabaseAdmin();

  const { data } = await supabase
    .from('school_api_keys')
    .select('id, school_id, permissions, expires_at')
    .eq('key_hash', keyHash)
    .eq('is_active', true)
    .single();

  if (!data) return null;

  // Check expiration
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Update last_used_at (fire and forget)
  supabase
    .from('school_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return {
    schoolId: data.school_id,
    keyId: data.id,
    permissions: data.permissions ?? [],
  };
}

/**
 * GET /api/v1/school/reports — Public API for school reports (ERP integration)
 *
 * Auth: API key with 'reports.read' permission
 * Query params:
 *   ?type=overview|student_summary
 *
 * overview: total_students, active_students, avg_score, quizzes_this_month
 * student_summary: per-student avg_score, total_quizzes, last_active
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateApiKey(request);

    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Invalid or expired API key' },
        { status: 401 }
      );
    }

    // Check permission
    if (!auth.permissions.includes('reports.read')) {
      return NextResponse.json(
        { success: false, error: 'API key does not have reports.read permission' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const reportType = searchParams.get('type') || 'overview';

    if (!['overview', 'student_summary'].includes(reportType)) {
      return NextResponse.json(
        { success: false, error: 'Invalid report type. Must be "overview" or "student_summary".' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();

    if (reportType === 'overview') {
      return await handleOverviewReport(supabase, auth.schoolId, auth.keyId);
    }

    // student_summary
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    return await handleStudentSummaryReport(supabase, auth.schoolId, auth.keyId, page, limit);
  } catch (err) {
    logger.error('public_school_reports_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v1/school/reports',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Overview report: aggregate school stats
 */
async function handleOverviewReport(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  keyId: string
): Promise<NextResponse> {
  try {
    // Total students
    const { count: totalStudents, error: countErr } = await supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId);

    if (countErr) throw countErr;

    // Active students (active in last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { count: activeStudents, error: activeErr } = await supabase
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', schoolId)
      .gte('last_active', sevenDaysAgo.toISOString());

    if (activeErr) throw activeErr;

    // Get student IDs for this school, then query quiz_results
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    let avgScore = 0;
    let quizzesThisMonth = 0;

    // Fetch student IDs for the school
    const { data: schoolStudents, error: studentIdsErr } = await supabase
      .from('students')
      .select('id')
      .eq('school_id', schoolId);

    if (!studentIdsErr && schoolStudents && schoolStudents.length > 0) {
      const studentIds = schoolStudents.map((s: { id: string }) => s.id);

      const { data: quizStats, error: quizErr } = await supabase
        .from('quiz_results')
        .select('score_percent, student_id')
        .in('student_id', studentIds)
        .gte('created_at', firstOfMonth.toISOString());

      if (!quizErr && quizStats) {
        quizzesThisMonth = quizStats.length;
        if (quizzesThisMonth > 0) {
          const totalScore = quizStats.reduce(
            (sum: number, r: { score_percent: number }) => sum + (r.score_percent ?? 0),
            0
          );
          avgScore = Math.round(totalScore / quizzesThisMonth);
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        report_type: 'overview',
        generated_at: new Date().toISOString(),
        total_students: totalStudents ?? 0,
        active_students: activeStudents ?? 0,
        avg_score: avgScore,
        quizzes_this_month: quizzesThisMonth,
      },
    });
  } catch (err) {
    logger.error('public_school_reports_overview_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v1/school/reports',
      schoolId,
      keyId,
    });
    return NextResponse.json(
      { success: false, error: 'Failed to generate overview report' },
      { status: 500 }
    );
  }
}

/**
 * Student summary report: per-student stats
 */
async function handleStudentSummaryReport(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
  keyId: string,
  page: number,
  limit: number
): Promise<NextResponse> {
  try {
    const offset = (page - 1) * limit;

    // Get students for this school
    const { data: students, error: studentsErr, count } = await supabase
      .from('students')
      .select('id, name, grade, is_active, xp_total, last_active', { count: 'exact' })
      .eq('school_id', schoolId)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (studentsErr) throw studentsErr;

    if (!students || students.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          report_type: 'student_summary',
          generated_at: new Date().toISOString(),
          students: [],
          pagination: {
            page,
            limit,
            total: count ?? 0,
            total_pages: count ? Math.ceil(count / limit) : 0,
          },
        },
      });
    }

    // Get quiz result aggregates for these students
    const studentIds = students.map((s: { id: string }) => s.id);

    const { data: quizAggs, error: quizErr } = await supabase
      .from('quiz_results')
      .select('student_id, score_percent')
      .in('student_id', studentIds);

    // Build per-student aggregate map
    const studentQuizMap = new Map<string, { totalScore: number; count: number }>();
    if (!quizErr && quizAggs) {
      for (const r of quizAggs) {
        const existing = studentQuizMap.get(r.student_id);
        if (existing) {
          existing.totalScore += r.score_percent ?? 0;
          existing.count += 1;
        } else {
          studentQuizMap.set(r.student_id, {
            totalScore: r.score_percent ?? 0,
            count: 1,
          });
        }
      }
    }

    // P5: grade is always a string in response
    const summaries = students.map((s: { id: string; name: string; grade: string; is_active: boolean; xp_total: number; last_active: string | null }) => {
      const quiz = studentQuizMap.get(s.id);
      return {
        id: s.id,
        name: s.name,
        grade: String(s.grade), // P5: ensure grade is string
        is_active: s.is_active,
        avg_score: quiz ? Math.round(quiz.totalScore / quiz.count) : 0,
        total_quizzes: quiz?.count ?? 0,
        xp_total: s.xp_total ?? 0,
        last_active: s.last_active,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        report_type: 'student_summary',
        generated_at: new Date().toISOString(),
        students: summaries,
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: count ? Math.ceil(count / limit) : 0,
        },
      },
    });
  } catch (err) {
    logger.error('public_school_reports_student_summary_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v1/school/reports',
      schoolId,
      keyId,
    });
    return NextResponse.json(
      { success: false, error: 'Failed to generate student summary report' },
      { status: 500 }
    );
  }
}
