// apps/host/src/app/api/cron/synthesis-delivery-monitor/route.ts
//
// Phase 8 item 8.4 — Monthly-Synthesis WhatsApp delivery monitor.
//
// Monthly Synthesis (ff_pedagogy_v2_monthly_synthesis, still OFF) delivers a
// ~300-word Claude-authored parent summary via the whatsapp-notify
// 'monthly_synthesis' template. Meta-side template approval is async — until
// approved, EVERY WhatsApp Cloud API call fails and the run's
// parent_share_status becomes 'failed'. Today nothing aggregates that, so a
// silent template-approval failure could mean 100% delivery failure undetected.
//
// This nightly monitor computes, over a trailing 24h window keyed on
// monthly_synthesis_runs.created_at (see WINDOW note below):
//   failure_rate_pct = failed / (sent + failed) * 100
//   opted_out_pct    = opted_out / terminal_total * 100   (informational)
// and emits ONE critical ops_events row when BOTH:
//   failure_rate_pct > FAILURE_RATE_ALERT_PCT (20)  AND
//   (sent + failed) >= MIN_ATTEMPTS_FOR_ALERT (5)
// The seeded alert_rules row 'Monthly synthesis delivery failing'
// (20260722102100) matches { category:'notifications',
// source:'cron/synthesis-delivery-monitor', min_severity:'critical' } and
// dispatches to the CEO-email channel.
//
// WINDOW note: monthly_synthesis_runs has no explicit "delivery attempted at"
// column — only created_at and (on success) parent_share_sent_at. Since the
// monthly builder creates the run and the share is attempted in the same
// monthly cadence burst, created_at is the honest available cohort key. This
// is a monitoring proxy, documented deliberately; adding a status-change
// timestamp is an architect-owned schema change out of scope here.
//
// Security (house pattern — flag-posture-canary / adaptive-remediation):
// fail-closed CRON_SECRET gate with a constant-time compare BEFORE any DB I/O.
// Counts-only response and ops_event; generic 500 on failure. NO PII, ever —
// the monitor reads only status + created_at, never summary text / phone /
// student name.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';
import { verifyCronAuth } from '@alfanumrik/lib/cron-auth';
import {
  computeRollup,
  WINDOW_HOURS,
  FAILURE_RATE_ALERT_PCT,
  MIN_ATTEMPTS_FOR_ALERT,
  type StatusRow,
} from './_lib/compute-rollup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Generic 500 body — never echo internal error details to the caller. */
const GENERIC_500_BODY = 'internal_error';

// ════════════════════════════════════════════════════════════════════════════
// AUTH — fail-closed, constant-time, BEFORE any DB I/O
// (shared @alfanumrik/lib/cron-auth gate: first-present-wins Bearer, else
//  x-cron-secret; the legacy ?token= query carrier was removed 2026-08-03)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// MONITOR
// (pure rollup logic lives in ./_lib/compute-rollup — a route module may export
//  ONLY HTTP handlers + route config, so it cannot live here)
// ════════════════════════════════════════════════════════════════════════════

async function runMonitor(startedAt: number): Promise<NextResponse> {
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  const { data, error } = await supabaseAdmin
    .from('monthly_synthesis_runs')
    .select('parent_share_status')
    .gte('created_at', cutoff);

  if (error) {
    logger.error('[synthesis-delivery-monitor] read failed', { error: error.message });
    return NextResponse.json({ error: GENERIC_500_BODY }, { status: 500 });
  }

  const rollup = computeRollup((data ?? []) as StatusRow[]);

  if (rollup.breached) {
    // Counts + rate only — no run ids, no student ids, no PII.
    await logOpsEvent({
      category: 'notifications',
      source: 'cron/synthesis-delivery-monitor',
      severity: 'critical',
      message: `Monthly synthesis WhatsApp delivery failing: ${rollup.failure_rate_pct}% of ${rollup.attempts} attempts failed in the last ${WINDOW_HOURS}h (threshold: >${FAILURE_RATE_ALERT_PCT}% over >=${MIN_ATTEMPTS_FOR_ALERT} attempts). Likely a Meta template-approval failure.`,
      context: {
        window_hours: WINDOW_HOURS,
        failure_rate_pct: rollup.failure_rate_pct,
        attempts: rollup.attempts,
        sent: rollup.sent,
        failed: rollup.failed,
      },
    });
  }

  // Job-health heartbeat on BOTH the clean path and the breach path — breach
  // detection IS a successful run. Only genuine 500s skip it. Fire-safe.
  await recordCronJobHealth({
    path: '/api/cron/synthesis-delivery-monitor',
    metric: 'ops.cron.synthesis_delivery_monitor.last_success_at',
    source: 'cron/synthesis-delivery-monitor',
    durationMs: Date.now() - startedAt,
    context: {
      attempts: rollup.attempts,
      failure_rate_pct: rollup.failure_rate_pct,
      breached: rollup.breached,
    },
  });

  return NextResponse.json({ success: true, ...rollup });
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  // Fail-closed auth BEFORE any DB I/O.
  if (!verifyCronAuth(request).ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return await runMonitor(startedAt);
  } catch (err) {
    logger.error('[synthesis-delivery-monitor] run failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: GENERIC_500_BODY }, { status: 500 });
  }
}

// Vercel cron invokes GET; POST kept for manual/ops triggering parity.
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
