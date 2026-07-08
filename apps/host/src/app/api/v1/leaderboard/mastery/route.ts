/**
 * GET /api/v1/leaderboard/mastery — peer ranking by mean BKT mastery.
 *
 * Phase 5 follow-on of ADR-001. The legacy /api/v1/leaderboard ranks by
 * raw XP, which rewards motion (login + activity). This endpoint ranks
 * by mean mastery across the chapters a learner has touched — rewarding
 * what they actually KNOW.
 *
 * Returns top N students for a grade (default 50) ordered by mean
 * mastery DESC, filtered to students with at least
 * MIN_CHAPTERS_REQUIRED chapters attempted (so a one-shot fluke doesn't
 * top the chart).
 *
 * Gating: ff_personalised_compete_v1. When OFF, 404s.
 *
 * Same CDN-cache pattern as the legacy /api/v1/leaderboard — 60s
 * s-maxage, 120s stale-while-revalidate. At 50K users with 5-min
 * client polling, this is 1 DB query per minute instead of 10K.
 *
 * Response (200):
 *   { schemaVersion: 1, period: 'mastery',
 *     resolvedAt: ISO,
 *     items: Array<{
 *       rank: number,
 *       student_id: string,
 *       name: string,
 *       grade: string,
 *       school: string | null,
 *       avatar_url: string | null,
 *       mean_mastery: number,        // 0..1
 *       chapters_counted: number,    // how many learner_mastery rows aggregated
 *     }>
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';

const FLAG_NAME = 'ff_personalised_compete_v1';
/** Floor on chapters_counted before a student appears on the board.
 *  Prevents a single high-mastery row from putting a freshly-onboarded
 *  student at the top. Tuned at 3 chapters (≈ 1 full subject of
 *  exposure) so the floor is meaningful but not exclusionary. */
const MIN_CHAPTERS_REQUIRED = 3;

interface LearnerMasteryRow {
  auth_user_id: string;
  mastery: number;
}

interface StudentMeta {
  id: string;
  auth_user_id: string;
  name: string;
  grade: string;
  school_name: string | null;
  avatar_url: string | null;
}

export interface MasteryLeaderboardItem {
  rank: number;
  student_id: string;
  name: string;
  grade: string;
  school: string | null;
  avatar_url: string | null;
  mean_mastery: number;
  chapters_counted: number;
}

export interface MasteryLeaderboardResponse {
  schemaVersion: 1;
  period: 'mastery';
  resolvedAt: string;
  items: MasteryLeaderboardItem[];
}

/**
 * Pure: aggregate learner_mastery rows into per-student mean + count.
 * Exported for testing — the route's only non-pure step is the two
 * Supabase reads that feed this helper.
 */
export function aggregateMastery(
  masteryRows: LearnerMasteryRow[],
  minChapters: number,
): Map<string, { mean: number; count: number }> {
  const acc = new Map<string, { sum: number; count: number }>();
  for (const r of masteryRows) {
    if (r.mastery == null || Number.isNaN(r.mastery)) continue;
    const existing = acc.get(r.auth_user_id);
    if (existing) {
      existing.sum += r.mastery;
      existing.count += 1;
    } else {
      acc.set(r.auth_user_id, { sum: r.mastery, count: 1 });
    }
  }
  const out = new Map<string, { mean: number; count: number }>();
  for (const [uid, { sum, count }] of acc) {
    if (count < minChapters) continue;
    out.set(uid, { mean: sum / count, count });
  }
  return out;
}

/**
 * Pure: join aggregated mastery against student rows and produce the
 * sorted leaderboard items.
 */
export function buildLeaderboardItems(
  aggregated: Map<string, { mean: number; count: number }>,
  students: StudentMeta[],
  limit: number,
): MasteryLeaderboardItem[] {
  const merged: Array<{
    student: StudentMeta;
    mean: number;
    count: number;
  }> = [];
  for (const s of students) {
    const agg = aggregated.get(s.auth_user_id);
    if (!agg) continue;
    merged.push({ student: s, mean: agg.mean, count: agg.count });
  }
  // Mastery DESC; tie-break by chapters_counted DESC (more data wins
  // when means are equal — more credible signal).
  merged.sort((a, b) => {
    if (a.mean !== b.mean) return b.mean - a.mean;
    return b.count - a.count;
  });
  return merged.slice(0, limit).map((m, i) => ({
    rank: i + 1,
    student_id: m.student.id,
    name: m.student.name,
    grade: m.student.grade,
    school: m.student.school_name,
    avatar_url: m.student.avatar_url,
    mean_mastery: m.mean,
    chapters_counted: m.count,
  }));
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'leaderboard.view');
  if (!auth.authorized) return auth.errorResponse!;

  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId: auth.userId ?? undefined,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const limitStr = searchParams.get('limit') || '50';
  const limit = Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 100);
  const gradeFilter = searchParams.get('grade'); // optional

  const supabase = getSupabaseAdmin();

  // Step 1: pull learner_mastery rows. Filter to attempts > 0 so
  // unexplored chapters don't drag the mean.
  let masteryQuery = supabase
    .from('learner_mastery')
    .select('auth_user_id, mastery')
    .gt('attempts', 0);
  // Capped read — 10000 chapter rows is plenty for top-50 across an
  // active grade cohort and bounds the worst-case payload.
  const { data: masteryRowsRaw, error: masteryErr } = await masteryQuery.limit(10000);
  if (masteryErr) {
    return NextResponse.json({ error: 'mastery_read_failed' }, { status: 500 });
  }
  const masteryRows = (masteryRowsRaw ?? []) as LearnerMasteryRow[];

  // Step 2: aggregate per student.
  const aggregated = aggregateMastery(masteryRows, MIN_CHAPTERS_REQUIRED);
  if (aggregated.size === 0) {
    return NextResponse.json(
      {
        schemaVersion: 1,
        period: 'mastery',
        resolvedAt: new Date().toISOString(),
        items: [],
      } satisfies MasteryLeaderboardResponse,
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      },
    );
  }

  // Step 3: pull student meta only for the auth_user_ids that survived
  // aggregation. Avoids reading the entire students table.
  const authIds = Array.from(aggregated.keys());
  let studentQuery = supabase
    .from('students')
    .select('id, auth_user_id, name, grade, school_name, avatar_url')
    .eq('is_active', true)
    .in('auth_user_id', authIds);
  if (gradeFilter) studentQuery = studentQuery.eq('grade', gradeFilter);
  const { data: studentsRaw, error: studentsErr } = await studentQuery;
  if (studentsErr) {
    return NextResponse.json({ error: 'students_read_failed' }, { status: 500 });
  }
  const students = (studentsRaw ?? []) as StudentMeta[];

  // Step 4: merge + sort + rank.
  const items = buildLeaderboardItems(aggregated, students, limit);

  const response: MasteryLeaderboardResponse = {
    schemaVersion: 1,
    period: 'mastery',
    resolvedAt: new Date().toISOString(),
    items,
  };

  return NextResponse.json(response, {
    status: 200,
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      'CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
    },
  });
}
