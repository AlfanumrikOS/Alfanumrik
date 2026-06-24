/**
 * GET /api/v1/leaderboard/class/[classId]?period=weekly&limit=20
 *
 * Class-scoped XP leaderboard. Returns the top N students in a class
 * ordered by XP earned in the given period (daily/weekly/monthly).
 *
 * Gating: ff_class_leaderboard_v1. Returns 404 when OFF.
 *
 * Authorization:
 *   - Students: must be an active member of the class (class_students).
 *   - Teachers: must teach the class (class_teachers).
 *   - 404 (not 403) on unauthorized access to avoid class-ID enumeration.
 *
 * Cache: 60s CDN s-maxage, 120s stale-while-revalidate — same posture as
 *        /api/v1/leaderboard (XP leaderboard is identical for all class members
 *        within the cache window; Vercel edge serves it without hitting Supabase).
 *
 * Response (200):
 *   {
 *     schemaVersion: 1,
 *     period: 'weekly' | 'daily' | 'monthly',
 *     classId: string,
 *     resolvedAt: ISO string,
 *     items: Array<{
 *       rank: number,
 *       student_id: string,
 *       name: string,
 *       grade: string,
 *       avatar_url: string | null,
 *       xp_total: number,
 *       xp_this_period: number,
 *       quizzes: number,
 *     }>
 *   }
 *
 * P13: email, phone, auth_user_id are NOT included in the response.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { authorizeRequest } from '@/lib/rbac';
import { isFeatureEnabled } from '@/lib/feature-flags';

const FLAG_NAME = 'ff_class_leaderboard_v1';
const VALID_PERIODS = ['daily', 'weekly', 'monthly'] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> },
) {
  // Next.js 16: dynamic route params are async
  const { classId } = await params;

  // Defense in depth: middleware blocks unauthenticated /api/v1/ requests,
  // but verify here too since this route exposes student names and XP.
  const auth = await authorizeRequest(request, 'leaderboard.view');
  if (!auth.authorized) return auth.errorResponse!;

  // Feature flag gate — return 404 when OFF so the feature is invisible
  // to clients before the operator enables it.
  const flagOn = await isFeatureEnabled(FLAG_NAME, {
    userId: auth.userId ?? undefined,
    role: auth.roles[0] ?? 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // ── Membership check ──────────────────────────────────────────────────────
  // Use 404 (not 403) to avoid class-ID enumeration by non-members.
  // Students: must be an active member of the class.
  // Teachers: must teach the class (class_teachers junction).
  // Admins / super_admins are not explicitly gated here — their
  // authorizeRequest already granted leaderboard.view at the RBAC level,
  // and class leaderboard data is not sensitive enough to warrant a stricter
  // admin gate. If that changes, add an admin bypass here.
  const supabaseAdmin = getSupabaseAdmin();

  const { data: membership } = await supabaseAdmin
    .from('class_students')
    .select('student_id')
    .eq('class_id', classId)
    .eq('student_id', auth.studentId ?? '')
    .eq('is_active', true)
    .maybeSingle();

  let authorized = !!membership;

  // If not a class member, check if the caller is a teacher of this class
  if (!authorized && auth.roles.includes('teacher')) {
    const { data: teaching } = await supabaseAdmin
      .from('class_teachers')
      .select('teacher_id')
      .eq('class_id', classId)
      .eq('teacher_id', auth.userId ?? '')
      .maybeSingle();
    authorized = !!teaching;
  }

  if (!authorized) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // ── Query parameters ──────────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);
  const rawPeriod = searchParams.get('period') || 'weekly';
  const period = VALID_PERIODS.includes(rawPeriod as (typeof VALID_PERIODS)[number])
    ? (rawPeriod as (typeof VALID_PERIODS)[number])
    : 'weekly';
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10) || 20, 50);

  // ── RPC call ──────────────────────────────────────────────────────────────
  try {
    const { data, error } = await supabaseAdmin.rpc('get_class_leaderboard', {
      p_class_id: classId,
      p_period: period,
      p_limit: limit,
    });

    if (error) {
      return NextResponse.json({ error: 'internal' }, { status: 500 });
    }

    return NextResponse.json(
      {
        schemaVersion: 1,
        period,
        classId,
        resolvedAt: new Date().toISOString(),
        // P13: do NOT include email, phone, or auth_user_id
        items: (data ?? []).map((row: {
          rank: number | bigint;
          student_id: string;
          name: string;
          grade: string;
          avatar_url: string | null;
          xp_total: number;
          xp_this_period: number;
          quizzes: number | bigint;
        }) => ({
          rank: Number(row.rank),
          student_id: row.student_id,
          name: row.name,
          grade: row.grade,
          avatar_url: row.avatar_url,
          xp_total: row.xp_total,
          xp_this_period: row.xp_this_period,
          quizzes: Number(row.quizzes),
        })),
      },
      {
        status: 200,
        headers: {
          // CDN caches for 60s, serves stale for 120s while revalidating.
          // Matches the posture of /api/v1/leaderboard.
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      },
    );
  } catch (err) {
    console.error('class leaderboard error:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
