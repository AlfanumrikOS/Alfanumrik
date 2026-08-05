/**
 * GET /api/v1/leaderboard/me — Phase 5 (Foxy North-Star), lane U10.
 *
 * The caller's OWN leaderboard band (percentile + rank + neighbours) for the
 * requested period. Distinct from `/api/v1/leaderboard` (which is the Top-N
 * public leaderboard and untouched by this lane).
 *
 * Auth: `authorizeRequest(request, 'leaderboard.view')`. The caller's own
 * `students.id` is resolved from `auth.uid()` — a `?student_id` query param is
 * IGNORED even when present (P13: never trust a client-supplied identity for
 * an "own" endpoint).
 *
 * Response: `{ success: true, data: { period, rank, percentile, xp, band,
 * neighbours[] } }`. The `band` label is UI convenience only — the raw
 * `percentile` is authoritative.
 *
 * Cache: `Cache-Control: private, max-age=300` (5 minutes, per-caller —
 * NEVER `public` because the response is caller-specific).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const ROUTE = '/api/v1/leaderboard/me';
const VALID_PERIODS = new Set(['daily', 'weekly', 'monthly', 'all_time']);

export const dynamic = 'force-dynamic';

interface PercentileRow {
  student_id: string;
  rank: number;
  total: number;
  percentile: number;
  xp: number;
  band: string | null;
  neighbours: Array<{ rank: number; name: string; xp: number; delta: number }> | null;
}

function bandFromPercentile(p: number): 'top_1' | 'top_10' | 'top_25' | 'middle' | 'bottom_25' {
  if (p >= 99) return 'top_1';
  if (p >= 90) return 'top_10';
  if (p >= 75) return 'top_25';
  if (p >= 25) return 'middle';
  return 'bottom_25';
}

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'leaderboard.view');
  if (!auth.authorized) return auth.errorResponse!;

  const authUserId = auth.userId!;
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'weekly';
  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json(
      { success: false, error: 'Invalid period' },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();

  // 1. Resolve caller's OWN students.id from auth.uid(). Never trust a body /
  //    query student_id here.
  const { data: studentRow, error: studentErr } = await admin
    .from('students')
    .select('id')
    .eq('auth_user_id', authUserId)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (studentErr) {
    logger.error('leaderboard_me_student_lookup_failed', {
      route: ROUTE,
      error: new Error(studentErr.message),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to resolve caller' },
      { status: 500 },
    );
  }
  if (!studentRow) {
    // Auth user has a role but no active student row — return an empty band
    // rather than 404 so the UI can render "no ranking yet" gracefully.
    return NextResponse.json(
      {
        success: true,
        data: {
          period,
          rank: null,
          percentile: null,
          xp: 0,
          band: null,
          neighbours: [],
        },
      },
      { status: 200, headers: { 'Cache-Control': 'private, max-age=300' } },
    );
  }

  // 2. Call the percentile RPC. Fail-soft to an empty band when the RPC is
  //    absent (older env) OR errors — the endpoint must never 500 the
  //    dashboard just because leaderboard data is stale.
  let percentile: PercentileRow | null = null;
  try {
    const { data, error } = await admin.rpc('get_leaderboard_percentile', {
      p_student_id: studentRow.id,
      p_period: period,
    });
    if (!error && data) {
      // RPC may return a row or an array-of-one — normalize.
      percentile = Array.isArray(data) ? (data[0] ?? null) : (data as PercentileRow);
    }
  } catch (err) {
    logger.warn('leaderboard_me_rpc_failed', {
      route: ROUTE,
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }

  const body = percentile
    ? {
        period,
        rank: percentile.rank ?? null,
        percentile: percentile.percentile ?? null,
        xp: percentile.xp ?? 0,
        band:
          percentile.band ??
          (percentile.percentile != null ? bandFromPercentile(percentile.percentile) : null),
        neighbours: percentile.neighbours ?? [],
      }
    : {
        period,
        rank: null,
        percentile: null,
        xp: 0,
        band: null,
        neighbours: [],
      };

  return NextResponse.json(
    { success: true, data: body },
    {
      status: 200,
      headers: {
        // Per-caller (private) — this response is NEVER shareable across users.
        'Cache-Control': 'private, max-age=300',
      },
    },
  );
}
