/**
 * /api/cron/account-purge — DPDP 30-day purge sweep (Wave 2 D7 follow-up #1).
 *
 * Schedule: vercel.json → 0 4 * * * (04:00 UTC daily, off-peak for India).
 *
 * Auth: CRON_SECRET via constant-time compare. Same pattern as
 *       /api/cron/irt-calibrate and /api/cron/daily-cron.
 *
 * Behaviour:
 *   1. Selects every account_deletion_log row where status IN ('requested','cooling_off')
 *      AND cooling_off_ends_at <= NOW() — i.e. the 30-day window has elapsed.
 *   2. For each row: invokes the `account-purge` Supabase Edge Function with
 *      { account_id, account_role, deletion_log_id }. The Edge Function does
 *      the actual hard-delete + payment FK anonymisation + auth.users delete.
 *   3. The Edge Function is responsible for updating the log row's status to
 *      'purged' (success) or 'failed' (with error_text) — this route does NOT
 *      mutate the log table directly. That keeps the contract simple: the cron
 *      is a fan-out trigger, not a data mutator.
 *   4. Best-effort: a failure on one row does not abort the loop. The function
 *      returns a per-row outcome summary so the Vercel Cron log captures any
 *      partial failures for ops follow-up.
 *
 * Edge Function contract (REQUIRED, owned by follow-up task):
 *   POST {SUPABASE_URL}/functions/v1/account-purge
 *   Headers: Authorization: Bearer <SERVICE_ROLE_KEY>, x-cron-secret: <CRON_SECRET>
 *   Body: { account_id: UUID, account_role: 'student'|'teacher'|'parent', deletion_log_id: UUID }
 *   Expected response:
 *     200 { success: true, purged_categories: {...} } — log updated to 'purged' by the function
 *     422 { success: false, error: '...' }            — log updated to 'failed' by the function
 *     5xx                                             — transient; log left as-is, retried tomorrow
 *
 * Idempotency: safe to run twice. The Edge Function is idempotent (it checks
 * the log row's status before doing work and short-circuits if status is
 * already 'purged' or 'cancelled_by_user'). The cron query also re-filters
 * out any rows that have flipped to a terminal state since the last run.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ─── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const auth = req.headers.get('authorization') ?? '';
  const xCronSecret = req.headers.get('x-cron-secret') ?? '';
  const provided = auth.startsWith('Bearer ')
    ? auth.slice('Bearer '.length)
    : xCronSecret;

  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ─── Per-row dispatch ────────────────────────────────────────────────────────

interface PurgeRow {
  id: string;
  account_id: string;
  account_role: 'student' | 'teacher' | 'parent';
}

interface DispatchResult {
  deletion_log_id: string;
  status: 'invoked' | 'edge_5xx' | 'edge_4xx' | 'network_error';
  http_status?: number;
  error?: string;
}

async function invokeEdgePurge(
  edgeUrl: string,
  serviceKey: string,
  cronSecret: string,
  row: PurgeRow,
): Promise<DispatchResult> {
  try {
    const res = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'x-cron-secret': cronSecret,
      },
      body: JSON.stringify({
        account_id: row.account_id,
        account_role: row.account_role,
        deletion_log_id: row.id,
      }),
      // Each invocation is one record — generous but bounded so a hung function
      // can't eat the whole 60s cron budget.
      signal: AbortSignal.timeout(20_000),
    });

    if (res.ok) {
      return { deletion_log_id: row.id, status: 'invoked', http_status: res.status };
    }
    if (res.status >= 500) {
      return { deletion_log_id: row.id, status: 'edge_5xx', http_status: res.status };
    }
    return { deletion_log_id: row.id, status: 'edge_4xx', http_status: res.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { deletion_log_id: row.id, status: 'network_error', error: message };
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cronSecret = process.env.CRON_SECRET;

  if (!supabaseUrl || !serviceKey || !cronSecret) {
    logger.error('cron/account-purge: missing env', {
      route: '/api/cron/account-purge',
    });
    return NextResponse.json(
      { success: false, error: 'Server not configured' },
      { status: 503 },
    );
  }

  const startedAt = Date.now();

  // Hard cap on rows per run so a sudden pile-up can't blow the 60s budget.
  // Anything left over rolls into tomorrow's run.
  const BATCH_LIMIT = 100;

  const { data: dueRows, error: queryError } = await supabaseAdmin
    .from('account_deletion_log')
    .select('id, account_id, account_role')
    .in('status', ['requested', 'cooling_off'])
    .lte('cooling_off_ends_at', new Date().toISOString())
    .order('cooling_off_ends_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (queryError) {
    logger.error('cron/account-purge: query failed', {
      route: '/api/cron/account-purge',
      error: new Error(queryError.message),
    });
    return NextResponse.json(
      { success: false, error: 'Query failed' },
      { status: 500 },
    );
  }

  const rows = (dueRows ?? []) as PurgeRow[];

  if (rows.length === 0) {
    logger.info('cron/account-purge: nothing due', {
      route: '/api/cron/account-purge',
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json({
      success: true,
      data: { processed: 0, results: [] },
    });
  }

  const edgeUrl = `${supabaseUrl}/functions/v1/account-purge`;

  // Sequential — these are infrequent and the Edge Function does heavy
  // per-row work (PII delete + payment FK rewrite + auth.users.delete).
  // Parallel would risk Supabase connection-pool starvation.
  const results: DispatchResult[] = [];
  for (const row of rows) {
    results.push(await invokeEdgePurge(edgeUrl, serviceKey, cronSecret, row));
  }

  const summary = {
    invoked: results.filter((r) => r.status === 'invoked').length,
    edge_5xx: results.filter((r) => r.status === 'edge_5xx').length,
    edge_4xx: results.filter((r) => r.status === 'edge_4xx').length,
    network_error: results.filter((r) => r.status === 'network_error').length,
  };

  logger.info('cron/account-purge: complete', {
    route: '/api/cron/account-purge',
    duration_ms: Date.now() - startedAt,
    processed: rows.length,
    ...summary,
  });

  // 207-style outcome: if every row failed, surface 502 so Vercel's cron log
  // shows the failure clearly. Partial successes still return 200.
  const allFailed = summary.invoked === 0 && rows.length > 0;
  return NextResponse.json(
    {
      success: !allFailed,
      data: {
        processed: rows.length,
        summary,
        results,
      },
    },
    { status: allFailed ? 502 : 200 },
  );
}

export const GET = handle;
export const POST = handle;
