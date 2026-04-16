import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../../lib/admin-auth';

// ── helpers ──────────────────────────────────────────────────────────

async function countRows(table: string, filter?: string): Promise<number> {
  try {
    const params = `select=id&limit=0${filter ? `&${filter}` : ''}`;
    const res = await fetch(supabaseAdminUrl(table, params), {
      method: 'HEAD',
      headers: supabaseAdminHeaders(),
    });
    const range = res.headers.get('content-range');
    return range ? parseInt(range.split('/')[1]) || 0 : 0;
  } catch { return 0; }
}

async function safeJson<T>(res: Response): Promise<T[]> {
  try { const d = await res.json(); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

async function supabaseRest(table: string, params: string = '') {
  return fetch(supabaseAdminUrl(table, params), {
    headers: supabaseAdminHeaders('count=exact'),
  });
}

// ── GET /api/super-admin/analytics-v2/b2b ─────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const now = new Date();
    const since30d = new Date(now.getTime() - 30 * 86400000).toISOString();
    const since60d = new Date(now.getTime() - 60 * 86400000).toISOString();
    const since21d = new Date(now.getTime() - 21 * 86400000).toISOString();
    const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthStart = lastMonth.toISOString();
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

    // ── Parallel data fetches ──
    const [
      schoolsRes,
      studentsRes,
      quizSessions30dRes,
      schoolSubsRes,
      schoolsThisMonthCount,
      schoolsLastMonthCount,
      studentsThisMonthCount,
      studentsLastMonthCount,
      quizSessions21dRes,
    ] = await Promise.all([
      // All active schools
      supabaseRest('schools', 'select=id,name,code,city,state,board,school_type,subscription_plan,is_active,max_students,created_at&deleted_at=is.null&order=created_at.desc&limit=1000'),
      // All students with school_id
      supabaseRest('students', 'select=id,school_id,name,grade,created_at&is_demo=eq.false&limit=50000'),
      // Quiz sessions last 30 days
      supabaseRest('quiz_sessions', `select=student_id,score_percent,created_at&created_at=gte.${since30d}&limit=100000`),
      // School subscriptions (if table exists; graceful fallback)
      supabaseRest('school_subscriptions', 'select=id,school_id,plan_code,status,seats,price_per_seat,current_period_start,current_period_end&limit=5000').catch(() => null),
      // Schools created this month
      countRows('schools', `created_at=gte.${thisMonthStart}&deleted_at=is.null`),
      // Schools created last month
      countRows('schools', `created_at=gte.${lastMonthStart}&created_at=lte.${lastMonthEnd}&deleted_at=is.null`),
      // Students created this month
      countRows('students', `created_at=gte.${thisMonthStart}&is_demo=eq.false`),
      // Students created last month
      countRows('students', `created_at=gte.${lastMonthStart}&created_at=lte.${lastMonthEnd}&is_demo=eq.false`),
      // Quiz sessions last 21 days for churn detection (3 weeks)
      supabaseRest('quiz_sessions', `select=student_id,created_at&created_at=gte.${since21d}&limit=100000`),
    ]);

    const schools = await safeJson<{
      id: string; name: string; code: string; city?: string; state?: string;
      board?: string; school_type?: string; subscription_plan?: string;
      is_active?: boolean; max_students?: number; created_at: string;
    }>(schoolsRes);

    const students = await safeJson<{
      id: string; school_id: string | null; name: string; grade: string; created_at: string;
    }>(studentsRes);

    const quizSessions30d = await safeJson<{
      student_id: string; score_percent: number; created_at: string;
    }>(quizSessions30dRes);

    // School subscriptions (may not exist)
    let schoolSubs: {
      id: string; school_id: string; plan_code: string; status: string;
      seats: number; price_per_seat: number;
      current_period_start: string; current_period_end: string;
    }[] = [];
    if (schoolSubsRes && schoolSubsRes.ok) {
      schoolSubs = await safeJson(schoolSubsRes);
    }

    const quizSessions21d = await safeJson<{
      student_id: string; created_at: string;
    }>(quizSessions21dRes);

    // ── Build indexes ──
    const studentsBySchool = new Map<string, string[]>();
    for (const s of students) {
      if (!s.school_id) continue;
      if (!studentsBySchool.has(s.school_id)) studentsBySchool.set(s.school_id, []);
      studentsBySchool.get(s.school_id)!.push(s.id);
    }

    const quizByStudent = new Map<string, { count: number; totalScore: number }>();
    for (const q of quizSessions30d) {
      const prev = quizByStudent.get(q.student_id) || { count: 0, totalScore: 0 };
      prev.count++;
      prev.totalScore += q.score_percent ?? 0;
      quizByStudent.set(q.student_id, prev);
    }

    const subBySchool = new Map<string, typeof schoolSubs[0]>();
    for (const sub of schoolSubs) {
      if (sub.status === 'active') subBySchool.set(sub.school_id, sub);
    }

    // ── Per-school metrics ──
    const schoolMetrics = schools.map(school => {
      const schoolStudentIds = studentsBySchool.get(school.id) || [];
      const enrolledStudents = schoolStudentIds.length;

      let totalQuizzes = 0;
      let totalScore = 0;
      let activeStudents = 0;
      for (const sid of schoolStudentIds) {
        const q = quizByStudent.get(sid);
        if (q) {
          totalQuizzes += q.count;
          totalScore += q.totalScore;
          activeStudents++;
        }
      }

      const avgScore = totalQuizzes > 0 ? Math.round(totalScore / totalQuizzes) : 0;
      const engagementRate = enrolledStudents > 0
        ? Math.round((activeStudents / enrolledStudents) * 100)
        : 0;
      const quizCompletion = totalQuizzes;

      const sub = subBySchool.get(school.id);
      const seatUtilization = school.max_students && school.max_students > 0
        ? Math.round((enrolledStudents / school.max_students) * 100)
        : 0;
      const monthlyRevenue = sub ? (sub.seats || 0) * (sub.price_per_seat || 0) : 0;

      // Health score: weighted engagement + score + utilization
      const healthScore = Math.round(
        engagementRate * 0.4 + Math.min(avgScore, 100) * 0.3 + Math.min(seatUtilization, 100) * 0.3
      );

      return {
        id: school.id,
        name: school.name,
        code: school.code || '',
        city: school.city || '',
        state: school.state || '',
        board: school.board || '',
        is_active: school.is_active !== false,
        subscription_plan: school.subscription_plan || 'free',
        enrolled_students: enrolledStudents,
        max_students: school.max_students || 0,
        active_students: activeStudents,
        engagement_rate: engagementRate,
        avg_score: avgScore,
        quiz_completion: quizCompletion,
        seat_utilization: seatUtilization,
        monthly_revenue: monthlyRevenue,
        health_score: healthScore,
        created_at: school.created_at,
      };
    });

    // ── Revenue aggregates ──
    const totalMRR = schoolMetrics.reduce((sum, s) => sum + s.monthly_revenue, 0);
    const totalARR = totalMRR * 12;
    const totalSeats = schools.reduce((sum, s) => sum + (s.max_students || 0), 0);
    const totalEnrolled = schoolMetrics.reduce((sum, s) => sum + s.enrolled_students, 0);
    const avgRevenuePerStudent = totalEnrolled > 0 ? Math.round(totalMRR / totalEnrolled) : 0;

    // ── Growth metrics ──
    const schoolGrowthRate = schoolsLastMonthCount > 0
      ? Math.round(((schoolsThisMonthCount - schoolsLastMonthCount) / schoolsLastMonthCount) * 100)
      : schoolsThisMonthCount > 0 ? 100 : 0;
    const studentGrowthRate = studentsLastMonthCount > 0
      ? Math.round(((studentsThisMonthCount - studentsLastMonthCount) / studentsLastMonthCount) * 100)
      : studentsThisMonthCount > 0 ? 100 : 0;

    // ── Cohort analysis: schools grouped by creation month ──
    const cohortMap = new Map<string, number>();
    for (const school of schools) {
      const monthKey = school.created_at?.slice(0, 7) || 'unknown'; // YYYY-MM
      cohortMap.set(monthKey, (cohortMap.get(monthKey) || 0) + 1);
    }
    const cohorts = Array.from(cohortMap.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12); // last 12 months

    // ── Churn signals: schools with declining engagement over 3 weeks ──
    // Split 21-day window into 3 weeks and compare per-school activity
    const week1Start = new Date(now.getTime() - 21 * 86400000);
    const week2Start = new Date(now.getTime() - 14 * 86400000);
    const week3Start = new Date(now.getTime() - 7 * 86400000);

    const weeklyActivity = new Map<string, [number, number, number]>(); // school_id -> [w1, w2, w3]
    const studentSchoolMap = new Map<string, string>();
    for (const s of students) {
      if (s.school_id) studentSchoolMap.set(s.id, s.school_id);
    }

    for (const q of quizSessions21d) {
      const schoolId = studentSchoolMap.get(q.student_id);
      if (!schoolId) continue;
      const ts = new Date(q.created_at).getTime();
      const prev = weeklyActivity.get(schoolId) || [0, 0, 0];
      if (ts >= week3Start.getTime()) prev[2]++;
      else if (ts >= week2Start.getTime()) prev[1]++;
      else if (ts >= week1Start.getTime()) prev[0]++;
      weeklyActivity.set(schoolId, prev);
    }

    const churnRisks: {
      school_id: string; school_name: string;
      week1_activity: number; week2_activity: number; week3_activity: number;
      decline_pct: number;
    }[] = [];

    for (const [schoolId, [w1, w2, w3]] of weeklyActivity) {
      // Flag if week-over-week decline for 3 consecutive weeks
      if (w1 > 0 && w2 < w1 && w3 < w2) {
        const declinePct = Math.round(((w1 - w3) / w1) * 100);
        const school = schools.find(s => s.id === schoolId);
        if (school) {
          churnRisks.push({
            school_id: schoolId,
            school_name: school.name,
            week1_activity: w1,
            week2_activity: w2,
            week3_activity: w3,
            decline_pct: declinePct,
          });
        }
      }
    }
    churnRisks.sort((a, b) => b.decline_pct - a.decline_pct);

    return NextResponse.json({
      success: true,
      data: {
        // Revenue summary
        revenue: {
          mrr: totalMRR,
          arr: totalARR,
          avg_revenue_per_student: avgRevenuePerStudent,
          total_seats: totalSeats,
          total_enrolled: totalEnrolled,
        },
        // Growth
        growth: {
          schools_this_month: schoolsThisMonthCount,
          schools_last_month: schoolsLastMonthCount,
          school_growth_rate: schoolGrowthRate,
          students_this_month: studentsThisMonthCount,
          students_last_month: studentsLastMonthCount,
          student_growth_rate: studentGrowthRate,
        },
        // Per-school comparison
        schools: schoolMetrics,
        // Cohort
        cohorts,
        // Churn risk
        churn_risks: churnRisks.slice(0, 20),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
