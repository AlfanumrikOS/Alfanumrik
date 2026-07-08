/**
 * GET /api/teacher/lab-leaderboard
 *
 * Returns a STEM Lab activity rollup for every student linked to the
 * authenticated teacher's classes (Tier 3 R11).
 *
 * Data sources:
 *   - public.v_class_lab_leaderboard  (per-student rollup; created in
 *       supabase/migrations/20260504200100_stem_lab_badges.sql)
 *   - public.experiment_observations  (last-7-day windowed counts for the
 *       weekly podium and the "active this week" KPI)
 *
 * Auth:
 *   authorizeRequest(request, 'class.manage') — the canonical teacher gate
 *   used by other /api/teacher/* routes (see src/app/api/teacher/subjects).
 *   Underlying view + table RLS additionally enforces row-level visibility,
 *   but RBAC + service-role membership filtering is the primary boundary.
 *
 * Privacy (P13):
 *   `students.name` is normalized server-side to "First L." (first token +
 *   first letter of last token) before leaving the server. We never return
 *   email, phone, or full last name.
 *
 * Response envelope:
 *   { success: true, students: [...], weekly_top_3: [...], class_totals: {...} }
 *   { success: false, error: string }
 *
 * Owner: backend (per ops). Reviewers: frontend, ops, assessment, testing.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

// ─── Types ────────────────────────────────────────────────────────
type LeaderboardRow = {
  student_id: string;
  full_name: string;
  grade: string;
  lab_streak: number;
  total_experiments: number;
  total_guided: number;
  avg_viva_pct: number | null;
  gold: number;
  silver: number;
  bronze: number;
};

type WeeklyRow = LeaderboardRow & { week_experiments: number };

type ClassTotals = {
  students: number;
  active_this_week: number;
  total_experiments_this_week: number;
};

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * P13: convert "Riya Mehta Singh" → "Riya S." — first token + first letter
 * of last token. Empty / single-token names degrade gracefully.
 */
function privacySafeName(raw: string | null | undefined): string {
  if (!raw) return 'Student';
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 'Student';
  if (tokens.length === 1) return tokens[0];
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const initial = last.charAt(0).toUpperCase();
  return `${first} ${initial}.`;
}

function err(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// ─── Route ────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // 1. AuthZ — canonical teacher gate (P9)
  const auth = await authorizeRequest(request, 'class.manage');
  if (!auth.authorized) {
    return auth.errorResponse as unknown as NextResponse;
  }

  try {
    // 2. Resolve teacher row from auth_user_id
    const { data: teacher, error: teacherErr } = await supabaseAdmin
      .from('teachers')
      .select('id')
      .eq('auth_user_id', auth.userId!)
      .maybeSingle();

    if (teacherErr) {
      logger.error('lab_leaderboard_teacher_lookup_failed', {
        error: new Error(teacherErr.message),
        route: 'teacher/lab-leaderboard',
      });
      return err('Failed to load teacher profile', 500);
    }
    if (!teacher) {
      return err('Teacher account not found', 404);
    }

    // 3. Resolve class IDs the teacher owns (active assignments only)
    const { data: classRows, error: classErr } = await supabaseAdmin
      .from('class_teachers')
      .select('class_id')
      .eq('teacher_id', teacher.id)
      .eq('is_active', true);

    if (classErr) {
      logger.error('lab_leaderboard_class_lookup_failed', {
        error: new Error(classErr.message),
        route: 'teacher/lab-leaderboard',
      });
      return err('Failed to resolve teacher classes', 500);
    }

    const classIds = (classRows ?? [])
      .map((r) => r.class_id as string | null)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (classIds.length === 0) {
      // Empty state — no classes assigned to this teacher.
      return NextResponse.json({
        success: true,
        students: [] as LeaderboardRow[],
        weekly_top_3: [] as WeeklyRow[],
        class_totals: { students: 0, active_this_week: 0, total_experiments_this_week: 0 },
      });
    }

    // 4. Resolve student IDs in those classes (active enrollments only)
    //    Migration note: class_enrollments is the Phase-2 canonical join table
    //    (class_students is being deprecated). See src/app/api/v1/exam/create.
    const { data: enrollRows, error: enrollErr } = await supabaseAdmin
      .from('class_enrollments')
      .select('student_id')
      .in('class_id', classIds)
      .eq('is_active', true);

    if (enrollErr) {
      logger.error('lab_leaderboard_enrollment_lookup_failed', {
        error: new Error(enrollErr.message),
        route: 'teacher/lab-leaderboard',
      });
      return err('Failed to resolve class enrollments', 500);
    }

    // Dedupe — a student could be enrolled in two classes for the same teacher.
    const studentIds = Array.from(
      new Set(
        (enrollRows ?? [])
          .map((r) => r.student_id as string | null)
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      ),
    );

    if (studentIds.length === 0) {
      return NextResponse.json({
        success: true,
        students: [] as LeaderboardRow[],
        weekly_top_3: [] as WeeklyRow[],
        class_totals: { students: 0, active_this_week: 0, total_experiments_this_week: 0 },
      });
    }

    // 5. Pull the per-student rollup from v_class_lab_leaderboard
    const { data: leaderRows, error: leaderErr } = await supabaseAdmin
      .from('v_class_lab_leaderboard')
      .select(
        'student_id, full_name, grade, lab_streak, total_experiments, total_guided, avg_viva_pct, gold_badges, silver_badges, bronze_badges',
      )
      .in('student_id', studentIds);

    if (leaderErr) {
      logger.error('lab_leaderboard_view_query_failed', {
        error: new Error(leaderErr.message),
        route: 'teacher/lab-leaderboard',
      });
      return err('Failed to load leaderboard', 500);
    }

    // 6. Pull last-7-day experiment counts per student (for podium + KPI)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: weekRows, error: weekErr } = await supabaseAdmin
      .from('experiment_observations')
      .select('student_id')
      .in('student_id', studentIds)
      .gte('created_at', sevenDaysAgo);

    if (weekErr) {
      logger.error('lab_leaderboard_weekly_query_failed', {
        error: new Error(weekErr.message),
        route: 'teacher/lab-leaderboard',
      });
      return err('Failed to load weekly activity', 500);
    }

    // Aggregate weekly counts in JS — Supabase doesn't expose group-by directly.
    const weeklyCounts = new Map<string, number>();
    for (const row of weekRows ?? []) {
      const sid = row.student_id as string;
      weeklyCounts.set(sid, (weeklyCounts.get(sid) ?? 0) + 1);
    }
    const totalExperimentsThisWeek = (weekRows ?? []).length;
    const activeThisWeek = weeklyCounts.size;

    // 7. Shape rows + apply privacy filter (P13)
    const students: LeaderboardRow[] = (leaderRows ?? []).map((r: any) => ({
      student_id: r.student_id as string,
      full_name: privacySafeName(r.full_name as string | null),
      grade: String(r.grade ?? ''), // P5: grade is TEXT
      lab_streak: Number(r.lab_streak ?? 0),
      total_experiments: Number(r.total_experiments ?? 0),
      total_guided: Number(r.total_guided ?? 0),
      avg_viva_pct: r.avg_viva_pct == null ? null : Number(r.avg_viva_pct),
      gold: Number(r.gold_badges ?? 0),
      silver: Number(r.silver_badges ?? 0),
      bronze: Number(r.bronze_badges ?? 0),
    }));

    // 8. Weekly top 3 — join weekly counts onto the rollup, sort desc, take 3
    const weeklyTop3: WeeklyRow[] = students
      .map((s) => ({ ...s, week_experiments: weeklyCounts.get(s.student_id) ?? 0 }))
      .filter((s) => s.week_experiments > 0)
      .sort((a, b) => b.week_experiments - a.week_experiments)
      .slice(0, 3);

    // 9. Default sort: total_experiments desc (UI may re-sort client-side)
    students.sort((a, b) => b.total_experiments - a.total_experiments);

    const classTotals: ClassTotals = {
      students: studentIds.length,
      active_this_week: activeThisWeek,
      total_experiments_this_week: totalExperimentsThisWeek,
    };

    return NextResponse.json({
      success: true,
      students,
      weekly_top_3: weeklyTop3,
      class_totals: classTotals,
    });
  } catch (e) {
    logger.error('lab_leaderboard_unexpected_error', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: 'teacher/lab-leaderboard',
    });
    return err('Internal server error', 500);
  }
}
