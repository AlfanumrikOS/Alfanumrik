/**
 * GET /api/v2/student/leaderboard — XP leaderboard (mobile + web).
 *
 * Thin read. Reuses the SAME get_leaderboard RPC the web /leaderboard page uses
 * (via getLeaderboard in src/lib/domains/profile.ts → supabase.rpc('get_leaderboard')).
 * The RPC's period switch maps weekly/monthly/all (its ELSE branch = all-time),
 * so we forward the period verbatim — no new query logic.
 *
 * P13: the response carries ONLY the fields the existing leaderboard exposes
 * (rank, name, grade, total_xp, streak, school, city) — no emails/phones.
 *
 * Auth: progress.view_own (a student-scoped read permission).
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { logger } from '@/lib/logger';
import { v2Success, v2Error } from '@/lib/api/v2/envelope';

const LIMIT = 50;

interface RpcLeaderboardRow {
  rank?: number;
  student_id?: string;
  name?: string | null;
  total_xp?: number;
  streak?: number;
  avatar_url?: string | null;
  grade?: string | number | null;
  school?: string | null;
  school_name?: string | null;
  city?: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, 'progress.view_own');
    if (!auth.authorized) return auth.errorResponse!;

    const url = new URL(request.url);
    const periodParam = url.searchParams.get('period') ?? 'weekly';
    const scopeParam = url.searchParams.get('scope') ?? 'global';

    const period = (['weekly', 'monthly', 'all'] as const).includes(periodParam as never)
      ? (periodParam as 'weekly' | 'monthly' | 'all')
      : 'weekly';
    const scope = (['school', 'global'] as const).includes(scopeParam as never)
      ? (scopeParam as 'school' | 'global')
      : 'global';

    // Same RPC as the web leaderboard. Forward the period verbatim.
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('get_leaderboard', {
      p_period: period,
      p_limit: LIMIT,
    });

    if (error) {
      logger.warn('v2_student_leaderboard_rpc_failed', { error: error.message, period });
      return v2Error('Failed to load leaderboard', 500, 'INTERNAL_ERROR');
    }

    const rows: RpcLeaderboardRow[] = Array.isArray(data) ? data : [];
    const entries = rows.map((s, i) => ({
      rank: typeof s.rank === 'number' ? s.rank : i + 1,
      student_id: s.student_id ?? '',
      name: s.name ?? null,
      total_xp: s.total_xp ?? 0,
      streak: s.streak ?? 0,
      avatar_url: s.avatar_url ?? null,
      grade: s.grade == null ? null : String(s.grade),
      school: s.school ?? s.school_name ?? null,
      city: s.city ?? null,
    }));

    return v2Success({
      schemaVersion: 1 as const,
      period,
      scope,
      entries,
    });
  } catch (err) {
    logger.error('v2_student_leaderboard_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/v2/student/leaderboard',
    });
    return v2Error('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
