import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '@/lib/admin-auth';

// ─── Types ──────────────────────────────────────────────────────

interface SchoolHealth {
  id: string;
  name: string;
  slug: string | null;
  health_score: number;
  pipeline_status: 'lead' | 'trial' | 'active' | 'at_risk' | 'churned';
  engagement: number;
  seat_util: number;
  quiz_activity: number;
  recency: number;
  students_count: number;
  seats_purchased: number;
  last_activity: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeRecency(lastActivityDate: string | null): number {
  if (!lastActivityDate) return 0;
  const daysSince = (Date.now() - new Date(lastActivityDate).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 14) return 100;
  if (daysSince <= 30) return 50;
  return 0;
}

function derivePipelineStatus(
  healthScore: number,
  subscriptionStatus: string | null,
  studentsCount: number,
  daysSinceActivity: number | null,
): SchoolHealth['pipeline_status'] {
  // No subscription and no students -> lead
  if (!subscriptionStatus && studentsCount === 0) return 'lead';
  // Trial subscription
  if (subscriptionStatus === 'trial') return 'trial';
  // No activity in 30+ days -> churned
  if (daysSinceActivity !== null && daysSinceActivity > 30) return 'churned';
  // Health-based classification
  if (healthScore < 30) return 'churned';
  if (healthScore < 60) return 'at_risk';
  return 'active';
}

// ─── Route ──────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const schoolIdFilter = params.get('school_id');

    // 1. Fetch schools
    const schoolQuery = [
      'select=id,name,slug,is_active,created_at',
      'deleted_at=is.null',
      'order=name.asc',
    ];
    if (schoolIdFilter) {
      schoolQuery.push(`id=eq.${encodeURIComponent(schoolIdFilter)}`);
    }

    const schoolsRes = await fetch(
      supabaseAdminUrl('schools', schoolQuery.join('&')),
      { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
    );
    if (!schoolsRes.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch schools' },
        { status: schoolsRes.status },
      );
    }
    const schools: Array<{ id: string; name: string; slug: string | null; is_active: boolean }> = await schoolsRes.json();

    if (schools.length === 0) {
      return NextResponse.json({ success: true, data: { schools: [] } });
    }

    const schoolIds = schools.map(s => s.id);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // 2. Parallel data fetches for all schools
    const [studentsRes, activeStudentsRes, quizActivityRes, subscriptionsRes] = await Promise.all([
      // Total students per school
      fetch(
        supabaseAdminUrl('students', `select=id,school_id,last_active&school_id=in.(${schoolIds.join(',')})&is_active=eq.true`),
        { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
      ),
      // Students active in last 7 days
      fetch(
        supabaseAdminUrl('students', `select=id,school_id&school_id=in.(${schoolIds.join(',')})&is_active=eq.true&last_active=gte.${sevenDaysAgo}`),
        { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
      ),
      // Quiz sessions in last 7 days per school
      fetch(
        supabaseAdminUrl('quiz_sessions', `select=id,school_id,created_at&school_id=in.(${schoolIds.join(',')})&created_at=gte.${sevenDaysAgo}`),
        { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
      ),
      // School subscriptions
      fetch(
        supabaseAdminUrl('school_subscriptions', `select=school_id,plan,seats_purchased,status&school_id=in.(${schoolIds.join(',')})`),
        { method: 'GET', headers: supabaseAdminHeaders('return=representation') },
      ),
    ]);

    const [allStudents, activeStudents, quizSessions, subscriptions] = await Promise.all([
      studentsRes.ok ? studentsRes.json() : [],
      activeStudentsRes.ok ? activeStudentsRes.json() : [],
      quizActivityRes.ok ? quizActivityRes.json() : [],
      subscriptionsRes.ok ? subscriptionsRes.json() : [],
    ]);

    // 3. Index data by school_id
    const totalStudentsBySchool = new Map<string, number>();
    const lastActivityBySchool = new Map<string, string | null>();
    for (const s of allStudents) {
      totalStudentsBySchool.set(s.school_id, (totalStudentsBySchool.get(s.school_id) || 0) + 1);
      const current = lastActivityBySchool.get(s.school_id);
      if (s.last_active && (!current || s.last_active > current)) {
        lastActivityBySchool.set(s.school_id, s.last_active);
      }
    }

    const activeStudentsBySchool = new Map<string, number>();
    for (const s of activeStudents) {
      activeStudentsBySchool.set(s.school_id, (activeStudentsBySchool.get(s.school_id) || 0) + 1);
    }

    const quizCountBySchool = new Map<string, number>();
    const lastQuizBySchool = new Map<string, string | null>();
    for (const q of quizSessions) {
      if (!q.school_id) continue;
      quizCountBySchool.set(q.school_id, (quizCountBySchool.get(q.school_id) || 0) + 1);
      const current = lastQuizBySchool.get(q.school_id);
      if (q.created_at && (!current || q.created_at > current)) {
        lastQuizBySchool.set(q.school_id, q.created_at);
      }
    }

    const subBySchool = new Map<string, { seats_purchased: number; status: string }>();
    for (const sub of subscriptions) {
      subBySchool.set(sub.school_id, { seats_purchased: sub.seats_purchased, status: sub.status });
    }

    // 4. Compute health scores
    const results: SchoolHealth[] = schools.map(school => {
      const totalStudents = totalStudentsBySchool.get(school.id) || 0;
      const activeCount = activeStudentsBySchool.get(school.id) || 0;
      const quizCount = quizCountBySchool.get(school.id) || 0;
      const sub = subBySchool.get(school.id);
      const seatsPurchased = sub?.seats_purchased || 0;
      const subStatus = sub?.status || null;

      // Use the most recent of student last_active and quiz last created_at
      const lastStudentActivity = lastActivityBySchool.get(school.id) || null;
      const lastQuizActivity = lastQuizBySchool.get(school.id) || null;
      let lastActivity: string | null = null;
      if (lastStudentActivity && lastQuizActivity) {
        lastActivity = lastStudentActivity > lastQuizActivity ? lastStudentActivity : lastQuizActivity;
      } else {
        lastActivity = lastStudentActivity || lastQuizActivity;
      }

      // Engagement (30%): active_students / total_students in last 7 days
      const engagement = totalStudents > 0
        ? clamp(Math.round((activeCount / totalStudents) * 100), 0, 100)
        : 0;

      // Seat utilization (25%): total_students / seats_purchased
      const seatUtil = seatsPurchased > 0
        ? clamp(Math.round((totalStudents / seatsPurchased) * 100), 0, 100)
        : 0;

      // Quiz activity (25%): quizzes_this_week / (total_students * 2)
      const expectedQuizzes = totalStudents * 2;
      const quizActivity = expectedQuizzes > 0
        ? clamp(Math.round((quizCount / expectedQuizzes) * 100), 0, 100)
        : 0;

      // Recency (20%): based on days since last activity
      const recency = computeRecency(lastActivity);

      // Composite score
      const healthScore = Math.round(
        engagement * 0.30 +
        seatUtil * 0.25 +
        quizActivity * 0.25 +
        recency * 0.20,
      );

      // Days since last activity for pipeline status
      let daysSinceActivity: number | null = null;
      if (lastActivity) {
        daysSinceActivity = (now.getTime() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24);
      }

      const pipelineStatus = derivePipelineStatus(healthScore, subStatus, totalStudents, daysSinceActivity);

      return {
        id: school.id,
        name: school.name,
        slug: school.slug,
        health_score: healthScore,
        pipeline_status: pipelineStatus,
        engagement,
        seat_util: seatUtil,
        quiz_activity: quizActivity,
        recency,
        students_count: totalStudents,
        seats_purchased: seatsPurchased,
        last_activity: lastActivity,
      };
    });

    return NextResponse.json({ success: true, data: { schools: results } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
