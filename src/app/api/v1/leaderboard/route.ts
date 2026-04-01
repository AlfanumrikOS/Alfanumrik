import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/v1/leaderboard?period=weekly&limit=20
 *
 * Server-side leaderboard with CDN caching.
 *
 * Why this exists:
 * The leaderboard is identical for ALL users. Having 50K clients each
 * query Supabase directly creates 50K identical queries per polling interval.
 * This API route lets Vercel Edge Cache serve the response, reducing
 * Supabase load to 1 query per cache interval.
 *
 * Cache: 60s CDN (s-maxage), 120s stale-while-revalidate
 * At 50K users with 5-min polling: 1 DB query/min instead of 10K/min
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'weekly';
  const limitStr = searchParams.get('limit') || '20';
  const limit = Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 50);

  const validPeriods = ['daily', 'weekly', 'monthly', 'all_time'];
  if (!validPeriods.includes(period)) {
    return NextResponse.json({ error: 'Invalid period' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Try RPC first (optimized server-side function)
    let leaderboard: unknown[] | null = null;
    try {
      const { data, error } = await supabase.rpc('get_leaderboard', {
        p_period: period,
        p_limit: limit,
      });
      if (!error && data) leaderboard = data;
    } catch {
      // RPC may not exist — fall through to direct query
    }

    // Fallback: direct query
    if (!leaderboard) {
      const since = new Date();
      if (period === 'daily') since.setDate(since.getDate() - 1);
      else if (period === 'monthly') since.setDate(since.getDate() - 30);
      else since.setDate(since.getDate() - 7); // weekly default

      const { data } = await supabase
        .from('students')
        .select('id, name, xp_total, streak_days, avatar_url, grade, school_name, city, board')
        .eq('is_active', true)
        .gte('last_active', since.toISOString())
        .order('xp_total', { ascending: false })
        .limit(limit);

      leaderboard = (data ?? []).map((s: Record<string, unknown>, i: number) => ({
        rank: i + 1,
        student_id: s.id,
        name: s.name,
        total_xp: (s.xp_total as number) ?? 0,
        streak: (s.streak_days as number) ?? 0,
        avatar_url: s.avatar_url,
        grade: s.grade,
        school: s.school_name,
        city: s.city,
        board: s.board,
      }));
    }

    return NextResponse.json(
      { data: leaderboard, period, cached_at: new Date().toISOString() },
      {
        status: 200,
        headers: {
          // CDN caches for 60s, serves stale for 120s while revalidating
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
          'Vercel-CDN-Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Leaderboard fetch failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
