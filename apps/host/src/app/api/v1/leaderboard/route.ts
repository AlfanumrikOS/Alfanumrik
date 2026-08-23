import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logger } from '@alfanumrik/lib/logger';

/**
 * GET /api/v1/leaderboard?period=weekly&limit=20
 *
 * Server-side XP leaderboard with CDN caching. THE authoritative peer board.
 *
 * Why this exists:
 * The leaderboard is identical for ALL users. Having 50K clients each
 * query Supabase directly creates 50K identical queries per polling interval.
 * This API route lets Vercel Edge Cache serve the response, reducing
 * Supabase load to 1 query per cache interval.
 *
 * Cache: 60s CDN (s-maxage), 120s stale-while-revalidate
 * At 50K users with 5-min polling: 1 DB query/min instead of 10K/min
 *
 * ── RANKED BY XP, AND ONLY BY XP ──────────────────────────────────────────
 * `ranked_by: 'xp'` is emitted so the client can label the board honestly and
 * can never claim a ranking basis the server did not produce.
 *
 * The leaderboard page used to fetch `performance_scores` / `score_history`
 * cross-student FROM THE BROWSER and re-sort this board by the result. Those
 * tables are own-row-only under RLS, so the anon-key read returned exactly one
 * row — the caller's — every peer sorted to `-1`, and the caller was awarded
 * rank #1 with a gold medal under a "Top 10 by Performance Score" header.
 *
 * That enrichment is deliberately NOT reimplemented here:
 *   1. A peer's Performance Score is an ATTAINMENT judgement of a minor.
 *      The accepted peer-visible norm on this surface is the `get_leaderboard`
 *      output — effort/activity metrics only (name, grade, total_xp, sessions,
 *      streak, rank). P13 keeps attainment inside the student / linked parent /
 *      assigned teacher / admin boundary.
 *   2. A sanctioned cross-student attainment board already exists at
 *      `/api/v1/leaderboard/mastery`, gated by `ff_personalised_compete_v1`.
 *      Re-adding attainment here would ship an UNGATED duplicate of a
 *      deliberately flag-gated surface.
 *   3. This response is `public` CDN-cached — anything in it is shared with
 *      every caller for 60s, so it can never carry caller-specific data.
 *
 * The caller's OWN Performance Score is served (privately, own-data only) by
 * `GET /api/v1/leaderboard/me`.
 *
 * P13 field whitelist — peers see exactly the `get_leaderboard` norm:
 *   rank, student_id, name, grade, total_xp, sessions, streak
 * No school, city, board, avatar_url, email, or phone. (The pre-existing
 * fallback branch leaked school/city/board — institution + location of a minor
 * on a PUBLICLY cached response — which the RPC never emitted. Narrowed.)
 *
 * ── A FAILED READ IS NOT AN EMPTY BOARD ───────────────────────────────────
 * Two rungs answer this route: the `get_leaderboard` RPC, then a direct query
 * fallback. The rule is the same for both and follows only from whether a rung
 * remains below:
 *
 *   RPC rung fails      → SWALLOWED, fall through. The fallback can still
 *                         produce a truthful board, so the caller loses
 *                         nothing. (This is also how a not-yet-migrated
 *                         environment, where the function does not exist, is
 *                         absorbed.)
 *   fallback rung fails → SURFACED as HTTP 500. Nothing is left to answer with,
 *                         and `data: []` here is a CLAIM — "nobody has earned
 *                         XP this period" — that a failed read cannot establish.
 *                         `useLeaderboard` throws on !ok, so the page renders
 *                         LoadFailure + Retry instead of "No rankings yet".
 *
 * Only the SUCCESS branches are indistinguishable to the client (that is the
 * privacy property: the fallback must not be detectable as a side-channel).
 * Success and failure are emphatically distinguishable, by status code.
 *
 * ── ERROR RESPONSES ARE NEVER CACHED ──────────────────────────────────────
 * The 200 is `public, s-maxage=60` — a SHARED CDN entry serving every student.
 * A cached 5xx would therefore break the board for the whole cohort for the
 * cache window (and `stale-while-revalidate=120` would extend it). Every
 * non-200 exit goes through `errorResponse()`, which stamps `no-store` on all
 * three cache-control channels. See the note there.
 */

/** Peer-visible leaderboard row. This shape is the whole contract. */
interface LeaderboardRow {
  rank: number;
  student_id: string;
  name: string | null;
  grade: string | null;
  total_xp: number;
  sessions: number;
  streak: number;
}

/** Raw `get_leaderboard` jsonb element. */
interface RpcRow {
  rank?: number | string;
  student_id?: string;
  name?: string | null;
  grade?: string | number | null;
  total_xp?: number | string;
  sessions?: number | string;
  streak?: number | string;
}

const ROUTE = '/api/v1/leaderboard';

/**
 * Non-cacheable error exit.
 *
 * WHY ALL THREE HEADERS. The success path is `public, s-maxage=60,
 * stale-while-revalidate=120`, i.e. one shared CDN entry for every student. On
 * Vercel the precedence is `Vercel-CDN-Cache-Control` > `CDN-Cache-Control` >
 * `Cache-Control`, and each layer falls back to the next when unset — so
 * setting only `Cache-Control` would leave a proxy free to honour a
 * stale/shared directive from elsewhere. All three are pinned to `no-store` so
 * no layer can retain a 4xx/5xx and poison the board for the cache window.
 *
 * Omitting the headers entirely is NOT equivalent: an uncached-by-default
 * response is a property of the current platform config, not of this route.
 * `no-store` is the property this route actually depends on, so it is stated.
 *
 * P13: `code` is a fixed, caller-independent token. Never a driver/Postgres
 * message (which can echo row values), never anything derived from the caller.
 */
function errorResponse(code: string, status: number): NextResponse {
  return NextResponse.json(
    { error: code },
    {
      status,
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'CDN-Cache-Control': 'no-store',
        'Vercel-CDN-Cache-Control': 'no-store',
      },
    },
  );
}

function toInt(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** P13 whitelist projection. Anything not listed here never leaves the server. */
function projectRow(row: RpcRow, index: number): LeaderboardRow {
  return {
    rank: toInt(row.rank, index + 1),
    student_id: String(row.student_id ?? ''),
    name: row.name ?? null,
    // P5: grades are strings ("6".."12"), never integers.
    grade: row.grade == null ? null : String(row.grade),
    total_xp: toInt(row.total_xp),
    sessions: toInt(row.sessions),
    streak: toInt(row.streak),
  };
}

export async function GET(request: NextRequest) {
  // Defense in depth: middleware blocks unauthenticated /api/v1/ requests,
  // but verify here too since this route exposes peer display names.
  const auth = await authorizeRequest(request, 'leaderboard.view');
  if (!auth.authorized) return auth.errorResponse!;

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'weekly';
  const limitStr = searchParams.get('limit') || '20';
  const limit = Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 50);

  const validPeriods = ['daily', 'weekly', 'monthly', 'all_time'];
  if (!validPeriods.includes(period)) {
    return errorResponse('Invalid period', 400);
  }

  try {
    const supabase = getSupabaseAdmin();

    // Rung 1 — the RPC (optimized server-side function). `get_leaderboard` is
    // SECURITY DEFINER and already applies HAVING SUM(xp_earned) > 0, so a
    // student with no activity in the period is absent by design.
    //
    // A failure here is swallowed ON PURPOSE: rung 2 below can still answer
    // truthfully, so the caller is not shown a degraded board. That tolerance
    // is bounded by the existence of that rung — it does NOT extend to rung 2.
    let rows: LeaderboardRow[] | null = null;
    try {
      const { data, error } = await supabase.rpc('get_leaderboard', {
        p_period: period,
        p_limit: limit,
      });
      if (!error && Array.isArray(data)) {
        rows = (data as RpcRow[]).map(projectRow);
      }
    } catch {
      // RPC may not exist — fall through to direct query
    }

    // Rung 2 — direct query. Projects to the SAME whitelist as the RPC path, so
    // the two SUCCESS branches are indistinguishable to the client (and the
    // fallback cannot become a privacy side-channel). Its FAILURE is not
    // absorbed: there is no rung 3, and `[]` would assert an empty board.
    if (!rows) {
      const since = new Date();
      if (period === 'daily') since.setDate(since.getDate() - 1);
      else if (period === 'monthly') since.setDate(since.getDate() - 30);
      else if (period === 'all_time') since.setFullYear(2020, 0, 1);
      else since.setDate(since.getDate() - 7); // weekly default

      const { data, error } = await supabase
        .from('students')
        .select('id, name, xp_total, streak_days, grade')
        .eq('is_active', true)
        .gte('last_active', since.toISOString())
        .gt('xp_total', 0) // mirrors the RPC's HAVING SUM(xp_earned) > 0
        .order('xp_total', { ascending: false })
        .limit(limit);

      // Last rung down. Surface it — `data: []` with a 200 would render as
      // "No rankings yet", a claim about the world this read never established.
      if (error) {
        logger.error('leaderboard_fallback_read_failed', {
          route: ROUTE,
          period,
          error: new Error(error.message),
        });
        return errorResponse('leaderboard_read_failed', 500);
      }

      rows = (data ?? []).map((s: Record<string, unknown>, i: number) => ({
        rank: i + 1,
        student_id: String(s.id ?? ''),
        name: (s.name as string | null) ?? null,
        grade: s.grade == null ? null : String(s.grade),
        total_xp: toInt(s.xp_total),
        // The fallback has no per-period session aggregate; 0 is honest here.
        sessions: 0,
        streak: toInt(s.streak_days),
      }));
    }

    return NextResponse.json(
      {
        data: rows,
        period,
        // Honest ranking basis. The client MUST label the board from this and
        // must not re-sort by anything the server did not rank on.
        ranked_by: 'xp' as const,
        cached_at: new Date().toISOString(),
      },
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
    // The thrown message goes to the (PII-redacting) logger, never to the body:
    // a driver/Postgres message can echo row values, and this body was until
    // now a `public`-cacheable one.
    logger.error('leaderboard_failed', {
      route: ROUTE,
      period,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return errorResponse('leaderboard_read_failed', 500);
  }
}
