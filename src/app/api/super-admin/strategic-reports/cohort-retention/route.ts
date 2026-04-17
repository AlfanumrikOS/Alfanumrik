import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/strategic-reports/cohort-retention
 *
 * Computes cohort retention: groups students by signup week/month,
 * then checks how many had quiz activity in each subsequent period.
 *
 * Query params:
 *   interval — "weekly" (default) or "monthly"
 *   periods  — number of periods to show (default 12)
 */

interface CohortRow {
  cohortStart: string;
  cohortEnd: string;
  totalStudents: number;
  retention: { period: number; active: number; percent: number }[];
}

function truncateToWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  // Monday-based week start
  const diff = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function truncateToMonth(date: Date): Date {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addWeeks(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d;
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const interval = searchParams.get('interval') === 'monthly' ? 'monthly' : 'weekly';
    const periods = Math.min(Math.max(parseInt(searchParams.get('periods') || '12', 10) || 12, 1), 52);

    // Fetch all active students with created_at
    const { data: students, error: studentsErr } = await supabaseAdmin
      .from('students')
      .select('id, created_at')
      .eq('is_active', true);

    if (studentsErr) {
      return NextResponse.json({ error: 'Failed to fetch students', detail: studentsErr.message }, { status: 500 });
    }
    if (!students || students.length === 0) {
      return NextResponse.json({ interval, cohorts: [] });
    }

    // Fetch all quiz sessions (just student_id and created_at for efficiency)
    const { data: sessions, error: sessionsErr } = await supabaseAdmin
      .from('quiz_sessions')
      .select('student_id, created_at');

    if (sessionsErr) {
      return NextResponse.json({ error: 'Failed to fetch quiz sessions', detail: sessionsErr.message }, { status: 500 });
    }

    const truncate = interval === 'weekly' ? truncateToWeek : truncateToMonth;
    const addPeriod = interval === 'weekly' ? addWeeks : addMonths;

    // Group students by signup cohort
    const cohortMap = new Map<string, { students: Set<string>; start: Date }>();

    for (const s of students) {
      const signupDate = new Date(s.created_at);
      const cohortStart = truncate(signupDate);
      const key = formatDate(cohortStart);
      if (!cohortMap.has(key)) {
        cohortMap.set(key, { students: new Set(), start: cohortStart });
      }
      cohortMap.get(key)!.students.add(s.id);
    }

    // Build index: for each student, which periods did they have quiz activity?
    const studentActivityPeriods = new Map<string, Set<string>>();
    for (const sess of sessions || []) {
      const actDate = new Date(sess.created_at);
      const periodKey = formatDate(truncate(actDate));
      if (!studentActivityPeriods.has(sess.student_id)) {
        studentActivityPeriods.set(sess.student_id, new Set());
      }
      studentActivityPeriods.get(sess.student_id)!.add(periodKey);
    }

    // Build cohort retention data
    const sortedCohortKeys = Array.from(cohortMap.keys()).sort();

    // Limit to most recent `periods` cohorts
    const recentKeys = sortedCohortKeys.slice(-periods);

    const cohorts: CohortRow[] = recentKeys.map(key => {
      const cohort = cohortMap.get(key)!;
      const cohortStart = cohort.start;
      const cohortEnd = addPeriod(cohortStart, 1);
      const studentIds = Array.from(cohort.students);
      const totalStudents = studentIds.length;

      // How many periods since this cohort until now?
      const now = new Date();
      const maxPeriods = Math.min(periods, (() => {
        let count = 0;
        let cursor = new Date(cohortStart);
        while (cursor < now && count < periods) {
          cursor = addPeriod(cohortStart, count + 1);
          count++;
        }
        return count;
      })());

      const retention: { period: number; active: number; percent: number }[] = [];

      for (let p = 0; p < maxPeriods; p++) {
        const periodStart = addPeriod(cohortStart, p);
        const periodKey = formatDate(truncate(periodStart));

        let activeCount = 0;
        for (const sid of studentIds) {
          const activitySet = studentActivityPeriods.get(sid);
          if (activitySet && activitySet.has(periodKey)) {
            activeCount++;
          }
        }

        retention.push({
          period: p,
          active: activeCount,
          percent: totalStudents > 0 ? Math.round((activeCount / totalStudents) * 100) : 0,
        });
      }

      return {
        cohortStart: formatDate(cohortStart),
        cohortEnd: formatDate(cohortEnd),
        totalStudents,
        retention,
      };
    });

    return NextResponse.json({ interval, cohorts });
  } catch (err) {
    return NextResponse.json(
      { error: 'Internal error computing cohort retention', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
