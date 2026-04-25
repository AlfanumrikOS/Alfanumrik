import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

/**
 * POST /api/cron/daily-cron
 *
 * P0-C launch fix. Vercel Cron entry that proxies to the daily-cron Supabase
 * Edge Function (supabase/functions/daily-cron/index.ts) which handles:
 *   - Streak resets for students who missed yesterday
 *   - Leaderboard recalculation per grade
 *   - Parent digest notifications
 *   - Task queue cleanup (7d completed, 30d failed)
 *   - Platform health snapshot
 *   - ML retrain trigger (when ≥100 new responses)
 *   - Performance score nightly recalculation
 *   - Daily challenge generation
 *   - Challenge streak management (with mercy days)
 *
 * Schedule: 02:30 UTC daily (08:00 IST). Stays clear of school-operations
 * which runs at 02:00 UTC.
 *
 * Auth: CRON_SECRET header (Vercel Cron sets it via cron config). The Edge
 * Function then re-checks the same secret independently.
 *
 * Why a Next.js proxy instead of relying solely on the existing pg_cron job
 * (20260404000002_pg_cron_daily.sql)?
 *   - pg_cron requires `app.cron_secret` to be set on the database, which
 *     several environments don't ship with by default. Vercel Cron pulls
 *     CRON_SECRET from Vercel env vars, which is already part of our deploy
 *     contract.
 *   - Belt-and-braces: if pg_cron is paused (Supabase free tier on a hobby
 *     project, or a regional Postgres incident), Vercel Cron still fires.
 *     Idempotency guards inside daily-cron mean a double-run is safe — the
 *     UPSERTs collapse to no-ops on the second pass.
 */

export const runtime = 'nodejs';
export const maxDuration = 300; // daily-cron can take up to ~5 min on cold caches

// ─── Auth ────────────────────────────────────────────────────────────────────

function verifyCronSecret(request: NextRequest): boolean {
  const cronSecret =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || !cronSecret) return false;
  // Constant-time comparison to prevent timing attacks
  if (cronSecret.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < cronSecret.length; i++) {
    mismatch |= cronSecret.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  const startTime = Date.now();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cronSecret = process.env.CRON_SECRET;

  if (!supabaseUrl || !cronSecret) {
    logger.error('cron/daily-cron: missing env (NEXT_PUBLIC_SUPABASE_URL or CRON_SECRET)');
    return NextResponse.json(
      { success: false, error: 'Server not configured' },
      { status: 503 },
    );
  }

  try {
    const targetUrl = `${supabaseUrl}/functions/v1/daily-cron`;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': cronSecret,
      },
      body: '{}',
      // Edge Function can run up to ~5 min — give it the full budget.
      signal: AbortSignal.timeout(290_000),
    });

    const text = await response.text();
    let payload: unknown = null;
    try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 500) }; }

    const durationMs = Date.now() - startTime;
    logger.info('cron/daily-cron: edge function returned', {
      status: response.status,
      duration_ms: durationMs,
    });

    // Surface Edge Function status. 207 = partial success (some steps failed,
    // some succeeded) — we propagate that through unchanged so the Vercel Cron
    // log shows accurate health.
    return NextResponse.json(
      {
        success: response.ok,
        edge_status: response.status,
        edge_response: payload,
        duration_ms: durationMs,
      },
      { status: response.ok ? 200 : 502 },
    );
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error('cron/daily-cron: invocation failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      duration_ms: durationMs,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Edge function invocation failed',
        duration_ms: durationMs,
      },
      { status: 502 },
    );
  }
}
