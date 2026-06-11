import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/revision/overview — Spaced-repetition Revision Center overview for
 * the authenticated student. Read-only aggregation over concept_mastery.
 *
 * Buckets the student's due / soon-due review items into overdue, dueToday,
 * and upcoming (today+1 .. today+7), mirroring the scoping of the sibling
 * /api/dashboard/reviews-due route:
 *   - same auth (progress.view_own, requireStudentId), same student-id source
 *   - same mastery_probability < 0.95 filter ("not trivially mastered")
 *   - same academic-year lower bound so archived rows aren't surfaced
 *   - same private, per-student 5-min cache
 *
 * No RPC, no schema, no writes. A single read on concept_mastery (with the
 * topic title + subject embedded via existing FKs) is bucketed in JS.
 *
 * Permission: progress.view_own (the student's own learning state).
 *
 * Item = {
 *   topicId, title, titleHi, subject,
 *   dueDate: 'YYYY-MM-DD', daysOverdue, masteryProbability
 * }
 *
 * Response shape:
 *   {
 *     overdue:  { count, items: Item[] },
 *     dueToday: { count, items: Item[] },
 *     upcoming: { count, byDay: [{ date, count }], items: Item[] },
 *     estimatedMinutes,
 *     subjects: [{ subject, dueCount }],
 *   }
 *
 * P5: grades are strings (not used as a filter here; the academic-year bound
 *     and per-student scoping handle relevance). P13: log only counts, never
 *     topic IDs, titles, subjects, or mastery values.
 */

const UPCOMING_DAYS = 7;
const ITEM_CAP = 50;
// Match /api/dashboard/reviews-due heuristic family: ~30s per item there.
// Revision Center estimate covers the actionable now-set (overdue + dueToday)
// at 1.5 min/item, floor 2 min — the figure the UI shows as "takes ~M min".
const MINUTES_PER_ITEM = 1.5;

interface ConceptMasteryRow {
  topic_id: string;
  next_review_date: string | null;
  mastery_probability: number | null;
  curriculum_topics: {
    title: string | null;
    title_hi: string | null;
    subjects: {
      code: string | null;
    } | null;
  } | null;
}

interface RevisionItem {
  topicId: string;
  title: string;
  titleHi: string | null;
  subject: string;
  dueDate: string;
  daysOverdue: number;
  masteryProbability: number;
}

/** Whole-day difference (a - b) for two YYYY-MM-DD date strings, UTC. */
function dayDiff(a: string, b: string): number {
  const msPerDay = 86_400_000;
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / msPerDay);
}

/** Add `n` whole days to a YYYY-MM-DD date string, returning YYYY-MM-DD (UTC). */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

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
    const upcomingEnd = addDays(today, UPCOMING_DAYS);

    // Current academic year window. Indian CBSE academic year runs
    // April → March. Same lower bound as /api/dashboard/reviews-due so older,
    // archived mastery rows aren't surfaced.
    const now = new Date();
    const currentMonth = now.getUTCMonth(); // 0 = Jan, 3 = Apr
    const currentYear = now.getUTCFullYear();
    const academicYearStart = currentMonth >= 3
      ? `${currentYear}-04-01`
      : `${currentYear - 1}-04-01`;

    // Single read: everything from academic-year start through today+7, not
    // trivially mastered. Title + subject embedded via existing FKs
    // (concept_mastery.topic_id → curriculum_topics.id → subjects.id). No PII.
    const { data, error } = await supabaseAdmin
      .from('concept_mastery')
      .select(
        'topic_id, next_review_date, mastery_probability, curriculum_topics!inner(title, title_hi, subjects!inner(code))'
      )
      .eq('student_id', studentId)
      .lt('mastery_probability', 0.95)
      .gte('next_review_date', academicYearStart)
      .lte('next_review_date', upcomingEnd)
      .order('next_review_date', { ascending: true });

    if (error) {
      logger.error('revision_overview_query_failed', {
        error: new Error(error.message),
        route: '/api/revision/overview',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load revision overview' },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as unknown as ConceptMasteryRow[];

    const overdueItems: RevisionItem[] = [];
    const dueTodayItems: RevisionItem[] = [];
    const upcomingItems: RevisionItem[] = [];
    const upcomingByDay = new Map<string, number>();
    const subjectDueCount = new Map<string, number>();

    for (const row of rows) {
      const dueDate = row.next_review_date;
      if (!dueDate) continue;

      const topic = row.curriculum_topics;
      const subject = topic?.subjects?.code ?? 'unknown';
      const diff = dayDiff(today, dueDate); // positive ⇒ overdue

      const item: RevisionItem = {
        topicId: row.topic_id,
        title: topic?.title ?? '',
        titleHi: topic?.title_hi ?? null,
        subject,
        dueDate,
        daysOverdue: Math.max(0, diff),
        masteryProbability: row.mastery_probability ?? 0,
      };

      if (diff > 0) {
        // overdue: next_review_date < today
        if (overdueItems.length < ITEM_CAP) overdueItems.push(item);
        subjectDueCount.set(subject, (subjectDueCount.get(subject) ?? 0) + 1);
      } else if (diff === 0) {
        // dueToday: next_review_date == today
        if (dueTodayItems.length < ITEM_CAP) dueTodayItems.push(item);
        subjectDueCount.set(subject, (subjectDueCount.get(subject) ?? 0) + 1);
      } else {
        // upcoming: today < next_review_date <= today+7
        if (upcomingItems.length < ITEM_CAP) upcomingItems.push(item);
        upcomingByDay.set(dueDate, (upcomingByDay.get(dueDate) ?? 0) + 1);
      }
    }

    // byDay: one entry per day in (today, today+7], ascending, including zeros.
    const byDay: { date: string; count: number }[] = [];
    for (let d = 1; d <= UPCOMING_DAYS; d++) {
      const date = addDays(today, d);
      byDay.push({ date, count: upcomingByDay.get(date) ?? 0 });
    }

    // estimatedMinutes covers the actionable now-set (overdue + dueToday).
    const actionableCount = overdueItems.length + dueTodayItems.length;
    const estimatedMinutes = Math.max(2, Math.ceil(actionableCount * MINUTES_PER_ITEM));

    const subjects = Array.from(subjectDueCount.entries())
      .map(([subject, dueCount]) => ({ subject, dueCount }))
      .sort((a, b) => b.dueCount - a.dueCount);

    // P13: log only counts. Never log topic IDs, titles, subjects, or mastery.
    logger.info('revision_overview_served', {
      route: '/api/revision/overview',
      overdueCount: overdueItems.length,
      dueTodayCount: dueTodayItems.length,
      upcomingCount: upcomingItems.length,
      estimatedMinutes,
    });

    return NextResponse.json(
      {
        overdue: { count: overdueItems.length, items: overdueItems },
        dueToday: { count: dueTodayItems.length, items: dueTodayItems },
        upcoming: { count: upcomingItems.length, byDay, items: upcomingItems },
        estimatedMinutes,
        subjects,
      },
      {
        headers: {
          // Private cache: per-student data, must not be shared. 5-min TTL
          // matches the sibling /api/dashboard/reviews-due route.
          'Cache-Control': 'private, max-age=300',
        },
      }
    );
  } catch (err) {
    logger.error('revision_overview_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/revision/overview',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
