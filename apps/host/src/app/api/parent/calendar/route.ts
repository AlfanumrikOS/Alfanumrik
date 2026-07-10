/**
 * GET /api/parent/calendar — aggregated upcoming calendar events for a linked child.
 *
 * Phase 2 portal remediation. Replaces the static board-exam-only view in
 * /parent/calendar with live, server-aggregated events drawn from:
 *   1. assignments      — due dates for the classes the child is enrolled in
 *   2. school_exams     — scheduled/active exams for the child's school + grade
 *   3. quiz_sessions    — the child's recent quiz activity (engagement markers)
 *
 * Board-exam countdowns (grade 10 / 12) stay client-side — they're static
 * national dates, not per-child data, so they don't belong in this query.
 *
 * Auth (defense in depth):
 *   1. authorizeRequest(request, 'child.view_progress') — RBAC gate (parent
 *      role holds this; student/teacher/admin can also pass).
 *   2. canAccessStudent(authUserId, student_id) — the single cross-role data
 *      boundary. For a parent this verifies an APPROVED/ACTIVE
 *      guardian_student_links row (status check lives inside canAccessStudent).
 *      No event data is returned on any deny path (P13).
 *
 * Query params:
 *   student_id   (required) — UUID of the child
 *   from         (optional) — ISO date; defaults to now. Lower bound (inclusive).
 *   horizon_days (optional) — integer 1..120; how far ahead to look. Default 60.
 *
 * Response contract (frontend Wave 2B):
 *   200 {
 *     success: true,
 *     data: {
 *       student_id: string,
 *       grade: string | null,        // P5: always a string
 *       range: { from: ISO, to: ISO },
 *       events: Array<{
 *         date: string,              // ISO timestamp the event occurs/is due
 *         type: 'assignment' | 'school_exam' | 'quiz_activity',
 *         title: string,
 *         subtitle?: string,         // subject / class / score, when available
 *         id?: string,               // source row id (assignments / school_exams)
 *       }>
 *     }
 *   }
 *   events are sorted ascending by date. quiz_activity events are in the PAST
 *   (engagement history); assignment / school_exam events are upcoming.
 *
 * P13: returns only the linked child's data. No other PII. No student-
 * identifying data is logged.
 */

import { NextResponse } from 'next/server';
import { authorizeRequest, canAccessStudent } from '@alfanumrik/lib/rbac';
import { getStudentById } from '@alfanumrik/lib/domains/identity';
import { logger } from '@alfanumrik/lib/logger';
import { isValidUUID } from '@alfanumrik/lib/sanitize';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const DEFAULT_HORIZON_DAYS = 60;
const MAX_HORIZON_DAYS = 120;
const MAX_EVENTS_PER_SOURCE = 50;

type CalendarEvent = {
  date: string;
  type: 'assignment' | 'school_exam' | 'quiz_activity';
  title: string;
  subtitle?: string;
  id?: string;
};

async function createRlsScopedCalendarClient(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  const authHeader = request.headers.get('Authorization');
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Calendar aggregation reads do not mutate auth cookies.
      },
    },
    ...(authHeader ? { global: { headers: { Authorization: authHeader } } } : {}),
  });
}

export async function GET(request: Request) {
  try {
    // ── 1. RBAC gate ─────────────────────────────────────────────────
    const auth = await authorizeRequest(request, 'child.view_progress');
    if (!auth.authorized) return auth.errorResponse!;

    // ── 2. Input validation ──────────────────────────────────────────
    const url = new URL(request.url);
    const studentId = url.searchParams.get('student_id') ?? '';
    if (!isValidUUID(studentId)) {
      return NextResponse.json(
        { success: false, error: 'Valid student_id is required' },
        { status: 400 },
      );
    }

    const fromParam = url.searchParams.get('from');
    const fromDate = fromParam ? new Date(fromParam) : new Date();
    const from = isNaN(fromDate.getTime()) ? new Date() : fromDate;

    const horizonRaw = parseInt(url.searchParams.get('horizon_days') ?? '', 10);
    const horizonDays =
      Number.isFinite(horizonRaw) && horizonRaw > 0
        ? Math.min(horizonRaw, MAX_HORIZON_DAYS)
        : DEFAULT_HORIZON_DAYS;
    const to = new Date(from.getTime() + horizonDays * 24 * 60 * 60 * 1000);

    const fromIso = from.toISOString();
    const toIso = to.toISOString();
    // Look back 30 days for quiz activity (engagement markers on the calendar).
    const activityFromIso = new Date(
      from.getTime() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // ── 3. Resource access boundary (the single data boundary) ───────
    const canAccess = await canAccessStudent(auth.userId!, studentId);
    if (!canAccess) {
      // No payload on any deny path (P13).
      return NextResponse.json(
        { success: false, error: 'You are not linked to this student' },
        { status: 403 },
      );
    }

    // ── 4. Resolve the child's school + grade ────────────────────────
    const studentRes = await getStudentById(studentId);
    if (!studentRes.ok || !studentRes.data) {
      return NextResponse.json(
        { success: false, error: 'Student not found' },
        { status: 404 },
      );
    }
    const student = studentRes.data;
    const grade = student.grade; // P5: string | null
    const schoolId = student.schoolId;

    const events: CalendarEvent[] = [];
    const calendarClient = await createRlsScopedCalendarClient(request);

    // ── 5a. Assignments due for the child's enrolled classes ─────────
    // Find active class enrollments, then assignments for those classes
    // with a due_date inside the window.
    const { data: enrollments, error: enrollErr } = await calendarClient
      .from('class_enrollments')
      .select('class_id')
      .eq('student_id', studentId)
      .eq('is_active', true);

    if (enrollErr) {
      logger.warn('parent_calendar_enrollments_failed', {
        route: 'parent/calendar',
        error: new Error(enrollErr.message),
      });
    }

    const classIds = (enrollments ?? [])
      .map((e) => e.class_id as string | null)
      .filter((c): c is string => Boolean(c));

    if (classIds.length > 0) {
      const { data: assignments, error: asgErr } = await calendarClient
        .from('assignments')
        .select('id, title, subject, due_date, status')
        .in('class_id', classIds)
        .eq('status', 'active')
        .not('due_date', 'is', null)
        .gte('due_date', fromIso)
        .lte('due_date', toIso)
        .order('due_date', { ascending: true })
        .limit(MAX_EVENTS_PER_SOURCE);

      if (asgErr) {
        logger.warn('parent_calendar_assignments_failed', {
          route: 'parent/calendar',
          error: new Error(asgErr.message),
        });
      }

      for (const a of assignments ?? []) {
        if (!a.due_date) continue;
        events.push({
          date: a.due_date as string,
          type: 'assignment',
          title: (a.title as string) ?? 'Assignment',
          subtitle: (a.subject as string) || undefined,
          id: a.id as string,
        });
      }
    }

    // ── 5b. School exams for the child's school + grade ──────────────
    if (schoolId && grade) {
      const { data: exams, error: examErr } = await calendarClient
        .from('school_exams')
        .select('id, title, subject, grade, start_time, status')
        .eq('school_id', schoolId)
        .eq('grade', grade)
        .in('status', ['scheduled', 'active'])
        .gte('start_time', fromIso)
        .lte('start_time', toIso)
        .order('start_time', { ascending: true })
        .limit(MAX_EVENTS_PER_SOURCE);

      if (examErr) {
        logger.warn('parent_calendar_exams_failed', {
          route: 'parent/calendar',
          error: new Error(examErr.message),
        });
      }

      for (const e of exams ?? []) {
        if (!e.start_time) continue;
        events.push({
          date: e.start_time as string,
          type: 'school_exam',
          title: (e.title as string) ?? 'School Exam',
          subtitle: (e.subject as string) || undefined,
          id: e.id as string,
        });
      }
    }

    // ── 5c. Recent quiz activity (engagement history) ────────────────
    const { data: quizzes, error: quizErr } = await calendarClient
      .from('quiz_sessions')
      .select('subject, score_percent, created_at, is_completed')
      .eq('student_id', studentId)
      .is('deleted_at', null)
      .gte('created_at', activityFromIso)
      .lte('created_at', toIso)
      .order('created_at', { ascending: false })
      .limit(MAX_EVENTS_PER_SOURCE);

    if (quizErr) {
      logger.warn('parent_calendar_quizzes_failed', {
        route: 'parent/calendar',
        error: new Error(quizErr.message),
      });
    }

    for (const q of quizzes ?? []) {
      if (!q.created_at) continue;
      const subj = (q.subject as string) || 'Quiz';
      const score =
        q.is_completed && typeof q.score_percent === 'number'
          ? `${Math.round(q.score_percent as number)}%`
          : undefined;
      events.push({
        date: q.created_at as string,
        type: 'quiz_activity',
        title: subj,
        subtitle: score,
      });
    }

    // ── 6. Sort all events ascending by date ─────────────────────────
    events.sort((a, b) => a.date.localeCompare(b.date));

    return NextResponse.json(
      {
        success: true,
        data: {
          student_id: studentId,
          grade, // P5: string | null
          range: { from: fromIso, to: toIso },
          events,
        },
      },
      {
        headers: {
          // Private, short-lived cache — calendar data is per-child PII.
          'Cache-Control': 'private, max-age=120, stale-while-revalidate=300',
        },
      },
    );
  } catch (err) {
    logger.error('parent_calendar_failed', {
      route: 'parent/calendar',
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
