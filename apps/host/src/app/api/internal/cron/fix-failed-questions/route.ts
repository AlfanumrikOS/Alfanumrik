/**
 * Cron entry for the QB fix-failed-questions agent.
 *
 * Auth: x-cron-secret header OR Authorization: Bearer <CRON_SECRET>
 * (matches the daily-cron pattern; Vercel Cron sends Bearer auth via GET).
 *
 * Method: BOTH GET and POST are accepted. Vercel Cron triggers GET; manual
 * curl invocations from ops scripts use POST. Both delegate to handleSweep().
 *
 * Spec: docs/superpowers/specs/2026-05-10-qb-qa-fix-failed-questions-design.md §4.3
 */

import { NextResponse, type NextRequest } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { decideFixBatchSize, isPeakHourIST } from '@alfanumrik/lib/qb-fixer/batch';
import { claimFailedBatch } from '@alfanumrik/lib/qb-fixer/claim';
import { logSweepComplete } from '@alfanumrik/lib/qb-fixer/ops-event';
import { runFixFailedQuestions } from '@alfanumrik/lib/ai/agents/agents/fix-failed-questions';
import type { SweepResult } from '@alfanumrik/lib/qb-fixer/types';

export const runtime = 'nodejs';

const THROTTLE_THRESHOLD = 100;

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function verifyCronSecret(request: NextRequest): boolean {
  const cronSecret =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || !cronSecret) return false;
  return constantTimeEqual(cronSecret, expected);
}

async function lastMinuteRunCount(): Promise<number> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data, error, count } = await supabaseAdmin
    .from('agent_runs')
    .select('id', { count: 'exact', head: false })
    .eq('agent_name', 'fix-failed-questions')
    .gte('started_at', since);
  if (error) {
    logger.warn('lastMinuteRunCount failed', { error: error.message });
    return 0;
  }
  return count ?? data?.length ?? 0;
}

async function handleSweep(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sweepId = `sweep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const t0 = Date.now();

  const peak = isPeakHourIST(new Date());
  const lastMinCount = await lastMinuteRunCount();
  const throttled = lastMinCount > THROTTLE_THRESHOLD;
  const batchSize = decideFixBatchSize({ peak, throttled });

  const rows = await claimFailedBatch({
    batchSize,
    claimedBy: sweepId,
    ttlSeconds: 600,
  });

  const result: SweepResult = {
    claimed: rows.length,
    verified: 0,
    marked_unfixable: 0,
    still_failed: 0,
    budget_exceeded: 0,
    errors: 0,
    duration_ms: 0,
  };

  for (const row of rows) {
    try {
      const r = await runFixFailedQuestions({ question_id: row.id, sweep_id: sweepId });
      if (r.status === 'success') result.verified += 1;
    } catch (err) {
      if (err instanceof Error && err.name === 'BudgetExceeded') {
        result.budget_exceeded += 1;
      } else {
        result.errors += 1;
        logger.warn('runFixFailedQuestions threw', {
          questionId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  result.duration_ms = Date.now() - t0;
  await logSweepComplete(result, sweepId);

  return NextResponse.json({ sweep_id: sweepId, ...result });
}

// Vercel Cron triggers GET requests with `Authorization: Bearer <CRON_SECRET>`.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleSweep(request);
}

// Manual ops invocations may POST with `x-cron-secret: <CRON_SECRET>` header.
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleSweep(request);
}
