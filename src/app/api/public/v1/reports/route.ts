/**
 * GET /api/public/v1/reports — Public API v1 (Track A.6).
 * ============================================================================
 * Returns class/student PERFORMANCE SUMMARIES for the KEY's school. Scope:
 * `reports.read`.
 *
 * This endpoint returns AGGREGATE summaries appropriate for an institutional
 * integration — NEVER per-student PII. Two views (selected by `?view=`):
 *   - view=grade   (default) — per-grade rollup: active student count + avg XP.
 *   - view=class             — per-class rollup: enrolled count + avg XP.
 *
 * CONTRACT: authorizePublicApiKey FIRST → tenant from auth.schoolId (the KEY) →
 *   scope-gated → rate-limit headers attached → stable v1 shape → P13 (aggregates
 *   only; no student id/name/email is returned through this endpoint).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizePublicApiKey } from '@/lib/public-api/auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cap how many student rows we aggregate per request (cost guard). */
const AGG_ROW_CAP = 5000;

interface StudentAggRow {
  grade: string | null;
  xp_total: number | null;
  is_active: boolean | null;
}

function roundAvg(sum: number, n: number): number {
  return n > 0 ? Math.round(sum / n) : 0;
}

export async function GET(request: NextRequest) {
  const auth = await authorizePublicApiKey(request, 'reports.read');
  if (!auth.authorized) return auth.errorResponse!;

  const schoolId = auth.schoolId!; // tenant from the KEY only
  const headers = auth.rateLimitHeaders;

  try {
    const url = new URL(request.url);
    const view = (url.searchParams.get('view') ?? 'grade').toLowerCase();
    if (view !== 'grade' && view !== 'class') {
      return NextResponse.json(
        { success: false, error: 'Invalid view. Use "grade" or "class".' },
        { status: 400, headers },
      );
    }

    const supabase = getSupabaseAdmin();

    if (view === 'grade') {
      // Per-grade rollup: active count + average XP. Aggregated in-process from a
      // bounded read (P13: no per-student rows leave the server).
      const { data, error } = await supabase
        .from('students')
        .select('grade, xp_total, is_active')
        .eq('school_id', schoolId)
        .limit(AGG_ROW_CAP);

      if (error) {
        logger.error('public_api_reports_grade_failed', {
          error: new Error(error.message),
          route: '/api/public/v1/reports',
          schoolId,
        });
        return NextResponse.json(
          { success: false, error: 'Failed to build report' },
          { status: 500, headers },
        );
      }

      const byGrade = new Map<string, { active: number; total: number; xpSum: number }>();
      for (const row of (data ?? []) as StudentAggRow[]) {
        const g = row.grade ?? 'unknown';
        const bucket = byGrade.get(g) ?? { active: 0, total: 0, xpSum: 0 };
        bucket.total += 1;
        if (row.is_active) bucket.active += 1;
        bucket.xpSum += row.xp_total ?? 0;
        byGrade.set(g, bucket);
      }

      const summaries = Array.from(byGrade.entries())
        .map(([grade, b]) => ({
          grade, // P5: string
          total_students: b.total,
          active_students: b.active,
          avg_xp: roundAvg(b.xpSum, b.total),
        }))
        .sort((a, b) => a.grade.localeCompare(b.grade));

      return NextResponse.json(
        { success: true, data: { view: 'grade', summaries } },
        { headers },
      );
    }

    // view === 'class' — per-class enrolled count + avg XP, joined via class_students.
    const { data: classes, error: classesError } = await supabase
      .from('classes')
      .select('id, name, grade, section')
      .eq('school_id', schoolId)
      .is('deleted_at', null)
      .limit(500);

    if (classesError) {
      logger.error('public_api_reports_class_failed', {
        error: new Error(classesError.message),
        route: '/api/public/v1/reports',
        schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to build report' },
        { status: 500, headers },
      );
    }

    const classList = (classes ?? []) as Array<{
      id: string;
      name: string;
      grade: string | null;
      section: string | null;
    }>;

    // For each class: count enrolled + average XP. Done WITHOUT a fragile
    // embedded FK join: read the active enrollment student_ids per class, then
    // batch-read those students' xp scoped to THIS school (tenant safety — a
    // student_id that somehow points outside the school is excluded).
    const summaries = await Promise.all(
      classList.map(async (c) => {
        const { data: enrollRows } = await supabase
          .from('class_students')
          .select('student_id')
          .eq('class_id', c.id)
          .eq('is_active', true);

        const studentIds = Array.from(
          new Set(
            ((enrollRows ?? []) as Array<{ student_id: string | null }>)
              .map((r) => r.student_id)
              .filter((id): id is string => !!id),
          ),
        );

        let enrolled = 0;
        let active = 0;
        let xpSum = 0;

        if (studentIds.length > 0) {
          const { data: studentRows } = await supabase
            .from('students')
            .select('xp_total, is_active')
            .eq('school_id', schoolId) // tenant scope on the aggregate too
            .in('id', studentIds);

          for (const st of (studentRows ?? []) as StudentAggRow[]) {
            enrolled += 1;
            if (st.is_active) active += 1;
            xpSum += st.xp_total ?? 0;
          }
        }

        return {
          class_id: c.id,
          name: c.name,
          grade: c.grade, // P5: string
          section: c.section,
          enrolled_students: enrolled,
          active_students: active,
          avg_xp: roundAvg(xpSum, enrolled),
        };
      }),
    );

    return NextResponse.json(
      { success: true, data: { view: 'class', summaries } },
      { headers },
    );
  } catch (err) {
    logger.error('public_api_reports_get_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/public/v1/reports',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers },
    );
  }
}
