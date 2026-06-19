/**
 * /api/cron/daily — Vercel Cron Job endpoint
 *
 * Runs nightly at 00:30 IST (19:00 UTC).
 * Triggered by Vercel Cron (vercel.json → crons[]).
 *
 * Responsibilities:
 *   1. Invoke the Supabase `daily-cron` Edge Function (BKT, IRT, leaderboard, notifications)
 *   2. Record a platform_health_snapshot via RPC
 *
 * Security: protected by CRON_SECRET header check.
 * This endpoint must NOT be publicly callable without the secret.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logDeprecatedRouteHit, withDeprecationHeaders } from '@/lib/api-route-ownership';

const CRON_SECRET  = process.env.CRON_SECRET ?? '';
const SB_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SB_SERVICE   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const runtime = 'nodejs'; // daily-cron needs longer timeout than Edge allows

export async function GET(request: NextRequest) {
  logDeprecatedRouteHit({
    workflow: 'cron',
    route: '/api/cron/daily',
    canonicalRoute: '/api/cron/daily-cron',
    compatibilityType: 'deprecated',
    removalCondition: 'Remove after production telemetry shows zero hits for 30 days and one full release.',
  });

  // ── Auth: Vercel passes CRON_SECRET as Authorization header ──────────────────
  const authHeader = request.headers.get('authorization');
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  // ── 1. Invoke Supabase daily-cron Edge Function ───────────────────────────────
  try {
    const cronRes = await fetch(`${SB_URL}/functions/v1/daily-cron`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SB_SERVICE}`,
      },
      body: JSON.stringify({ triggered_by: 'vercel-cron' }),
    });
    results.daily_cron_status = cronRes.status;
    if (cronRes.ok) {
      results.daily_cron = await cronRes.json();
    } else {
      results.daily_cron_error = await cronRes.text();
    }
  } catch (err) {
    results.daily_cron_error = err instanceof Error ? err.message : String(err);
  }

  // ── 2. Record platform health snapshot ────────────────────────────────────────
  try {
    const admin = supabaseAdmin;
    const { data, error } = await admin.rpc('record_platform_health_snapshot');
    if (error) {
      results.snapshot_error = error.message;
    } else {
      results.snapshot_id = data;
    }
  } catch (err) {
    results.snapshot_error = err instanceof Error ? err.message : String(err);
  }

  return withDeprecationHeaders(
    NextResponse.json({
      ok: true,
      ts: new Date().toISOString(),
      ...results,
    }),
    { canonicalRoute: '/api/cron/daily-cron', compatibilityType: 'deprecated' },
  );
}
