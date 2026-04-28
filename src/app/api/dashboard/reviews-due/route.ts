import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/dashboard/reviews-due — Spaced-repetition prompt counts for the
 * student dashboard (Phase 2.D of Foxy moat plan).
 *
 * Returns the number of concept_mastery rows whose next_review_date has come
 * due (<= today) and which the student has not already trivially mastered
 * (mastery_probability < 0.95). The dashboard surfaces this as a "you have N
 * reviews due — takes ~M minutes" CTA that links to /review?due_only=1.
 *
 * Permission: progress.view_own (the student's own learning state).
 *
 * Response shape:
 *   {
 *     dueCount: number,
 *     oldestDueDate: string | null,    // ISO YYYY-MM-DD, oldest pending review
 *     estimatedMinutes: number,         // floor 2 min, 30s/item
 *   }
 *
 * P13: log only counts, never topic IDs or names.
 */
export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'progress.view_own', {
      requireStudentId: true,
    });
    if (!auth.authorized) return auth.errorResponse!;

    const studentId = auth.studentId;
    if (!studentId) {
      return NextResponse.json(
        { success: false, error: 'No student context available' },
        { status: 400 }
      );
    }

    // Today's date in YYYY-MM-DD (concept_mastery.next_review_date is DATE).
    const today = new Date().toISOString().slice(0, 10);

    // Current academic year window. Indian CBSE academic year runs
    // April → March. We compute the start-of-year date and use it to bound
    // the query so older, archived mastery rows aren't surfaced.
    const now = new Date();
    const currentMonth = now.getUTCMonth(); // 0 = Jan, 3 = Apr
    const currentYear = now.getUTCFullYear();
    const academicYearStart = currentMonth >= 3
      ? `${currentYear}-04-01`
      : `${currentYear - 1}-04-01`;

    // Pull due rows. We deliberately select only the columns we need
    // (no topic IDs returned to the client) and order by next_review_date
    // ascending so we can read the oldest from the head of the result.
    const { data, error } = await supabaseAdmin
      .from('concept_mastery')
      .select('next_review_date, mastery_probability')
      .eq('student_id', studentId)
      .lte('next_review_date', today)
      .lt('mastery_probability', 0.95)
      .gte('next_review_date', academicYearStart)
      .order('next_review_date', { ascending: true });

    if (error) {
      logger.error('reviews_due_query_failed', {
        error: new Error(error.message),
        route: '/api/dashboard/reviews-due',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load reviews' },
        { status: 500 }
      );
    }

    const rows = data ?? [];
    const dueCount = rows.length;
    const oldestDueDate = dueCount > 0 ? (rows[0].next_review_date as string | null) : null;
    // 30s per review item, floor 2 min.
    const estimatedMinutes = Math.max(2, Math.ceil(dueCount * 0.5));

    // P13: log only counts. Never log topic IDs, titles, or mastery values.
    logger.info('reviews_due_served', {
      route: '/api/dashboard/reviews-due',
      dueCount,
      estimatedMinutes,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          dueCount,
          oldestDueDate,
          estimatedMinutes,
        },
      },
      {
        headers: {
          // Private cache: per-student data, must not be shared. 5-min TTL
          // matches the SWR refreshInterval on the dashboard component, so
          // a refocus within 5 minutes hits the browser cache.
          'Cache-Control': 'private, max-age=300',
        },
      }
    );
  } catch (err) {
    logger.error('reviews_due_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/dashboard/reviews-due',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
