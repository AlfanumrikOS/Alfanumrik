import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { cacheFetchAsync, CACHE_TTL } from '@/lib/cache';

/**
 * GET /api/dashboard/reviews-due — Spaced-repetition prompt counts for the
 * student dashboard (Phase 2.D of Foxy moat plan).
 *
 * Returns the number of concept_mastery rows whose next_review_at has come
 * due (<= now()) and which the student has not already trivially mastered
 * (mastery_probability < 0.95). The dashboard surfaces this as a "you have N
 * reviews due — takes ~M minutes" CTA that links to /review?due_only=1.
 *
 * Due-schedule source of truth: `concept_mastery.next_review_at` (timestamptz),
 * written by the live SM-2 in update_learner_state_post_quiz on every quiz.
 * Do NOT read `next_review_date` — that DATE column is a deprecated ghost
 * (default CURRENT_DATE + 1, never updated by any function/cron/app code), so
 * it marks every touched concept "due" one day after first attempt, forever.
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

    // Today's date in YYYY-MM-DD (UTC) — used only for the per-day cache key.
    const today = new Date().toISOString().slice(0, 10);

    // XC-3 Phase 2 (batch 2): this read runs through the RLS-respecting server
    // client (cookie-scoped to the calling student via authorizeRequest's own
    // auth), NOT the RLS-bypassing service-role admin client. RLS is therefore
    // a real second line of defense behind authorizeRequest. The single read
    // below is a student-OWN row set admitted by an existing SELECT policy:
    //   - concept_mastery : concept_mastery_own
    //                       (student_id = get_my_student_id())
    // studentId is auth.studentId from authorizeRequest → SELECT id FROM
    // students WHERE auth_user_id = authUserId; always the caller's own id,
    // never arbitrary. For the active OWNER, get_my_student_id() resolves the
    // SAME id, so the result is byte-identical to the admin-client version.
    // Fail-CLOSED: if RLS hides the rows (cross-user / unauthenticated session)
    // the count degrades to 0 — no other student's review state can leak.
    // See docs/superpowers/plans/2026-07-02-xc3-systemic-rls-defense-in-depth.md §4.
    const supabase = await createSupabaseServerClient();

    // Phase 5 perf: this read-only count fires on dashboard mount (alongside the
    // other aggregate calls) and on every SWR refocus. Collapse repeat reads
    // within a 30s window with a SERVER-SIDE cache keyed by student_id + `today`
    // (the date bounds the query, so it belongs in the key). The key includes
    // student_id so students NEVER collide (P13: per-student data must never be
    // shared). This is a server cache, NOT a CDN/`s-maxage` header — Vercel's
    // edge does not vary by auth, so a public cache would leak one student's
    // review state to another. The existing `private` browser cache is retained.
    const result = await cacheFetchAsync(
      `dashboard:reviews-due:${studentId}:${today}`,
      CACHE_TTL.USER,
      async () => {
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
        // (no topic IDs returned to the client) and order by next_review_at
        // ascending so we can read the oldest from the head of the result.
        //
        // Due = next_review_at <= now(). `next_review_at` (timestamptz) is the
        // REAL SM-2 schedule, written by update_learner_state_post_quiz on
        // every quiz. The sibling `next_review_date` DATE column is a
        // deprecated ghost — never written by any function, cron, or app code;
        // its CURRENT_DATE + 1 default made every touched concept look "due"
        // one day after first attempt, forever. Do not repoint back to it.
        // Rows with NULL next_review_at (never scheduled) are correctly
        // excluded by the lte filter.
        const nowIso = new Date().toISOString();
        const { data, error } = await supabase
          .from('concept_mastery')
          .select('next_review_at, mastery_probability')
          .eq('student_id', studentId)
          .lte('next_review_at', nowIso)
          .lt('mastery_probability', 0.95)
          .gte('next_review_at', academicYearStart)
          .order('next_review_at', { ascending: true });

        if (error) {
          // Throw so the failure is NOT cached — the catch below maps to a 500.
          throw new Error(error.message);
        }

        const rows = data ?? [];
        const dueCount = rows.length;
        // Contract: oldestDueDate stays ISO YYYY-MM-DD (date part of the
        // timestamptz, UTC) — same shape consumers already parse.
        const oldestDueDate =
          dueCount > 0 && rows[0].next_review_at
            ? (rows[0].next_review_at as string).slice(0, 10)
            : null;
        // 30s per review item, floor 2 min.
        const estimatedMinutes = Math.max(2, Math.ceil(dueCount * 0.5));
        return { dueCount, oldestDueDate, estimatedMinutes };
      },
    );

    // P13: log only counts. Never log topic IDs, titles, or mastery values.
    logger.info('reviews_due_served', {
      route: '/api/dashboard/reviews-due',
      dueCount: result.dueCount,
      estimatedMinutes: result.estimatedMinutes,
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
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
