// src/app/api/cron/adaptive-loops-monitor/route.ts
//
// Adaptive-loops creation-rate + escalation + heartbeat monitor (Master Action
// Plan Phase 8, item 8.1). This is the monitoring gate that MUST be live before
// any adaptive-loop flag (A/B/C/D) is flipped in production — before it, the
// only way to see the loops' operational health was the ad-hoc SQL in
// docs/runbooks/adaptive-program-rollout.md §7 that a human ran by hand.
//
// Runs nightly, AFTER the adaptive-remediation nightly run. Each run:
//   1. Reads the aggregate-only health snapshot via the get_adaptive_loops_health
//      RPC (P13 — counts/ratios only; no student id ever leaves the DB).
//   2. Emits ONE ops_events row per detected condition (ceiling violation /
//      escalation storm / missed heartbeat), each with its own category+source
//      so a distinct seeded alert_rule targets it and routes to the CEO email:
//        - ceiling violation   → category 'adaptive_ceiling_violation'  (critical)
//        - escalation storm     → category 'adaptive_escalation_storm'   (error)
//        - missed heartbeat     → category 'adaptive_cron_stale'         (critical)
//      All three carry source 'cron/adaptive-loops-monitor'. Thresholds are
//      SOURCED from the runbook — see _lib/evaluate-alerts.ts.
//   3. Records its OWN job-health heartbeat (the monitor is itself observable).
//   4. Returns the aggregate snapshot + which alerts fired (aggregate-only body).
//
// NOT flag-gated: monitoring must work while the loop flags are still OFF (that
// is the whole point of a gate) — the RPC reports honestly whether or not any
// loop is enabled.
//
// Security: fail-closed CRON_SECRET gate with a constant-time compare BEFORE
// any DB I/O (shared @alfanumrik/lib/cron-auth gate). Accepts Bearer or
// x-cron-secret; the legacy ?token= query carrier was removed 2026-08-03
// (secrets in query strings land in access logs).
//
// P13: the response body and every ops_events row carry aggregate counts /
// ratios / timestamps only — never a student id, subject/chapter target, or
// PII-shaped value.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';
import { verifyCronAuth } from '@alfanumrik/lib/cron-auth';
import {
  evaluateAdaptiveLoopsAlerts,
  type AdaptiveLoopsHealth,
} from './_lib/evaluate-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Generic 500 body — never echo internal error details to the caller. */
const GENERIC_500_BODY = 'internal_error';

/** Monitor scan windows. 24h rolling for daily-new; 30d for escalation share. */
const WINDOW_HOURS = 24;
const STORM_DAYS = 30;

// ════════════════════════════════════════════════════════════════════════════
// AUTH — fail-closed, constant-time, BEFORE any DB I/O
// (house pattern: api/cron/adaptive-remediation, api/cron/flag-posture-canary)
// ════════════════════════════════════════════════════════════════════════════

// Shared @alfanumrik/lib/cron-auth gate. Carrier precedence is
// FIRST-PRESENT-WINS (Bearer, else x-cron-secret); exactly ONE candidate is
// compared once — a WRONG value in a higher-precedence carrier is NOT rescued
// by a correct lower one.

// ════════════════════════════════════════════════════════════════════════════
// MONITOR
// ════════════════════════════════════════════════════════════════════════════

async function runMonitor(startedAt: number): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin.rpc('get_adaptive_loops_health', {
    p_window_hours: WINDOW_HOURS,
    p_storm_days: STORM_DAYS,
  });

  if (error) {
    logger.error('[adaptive-loops-monitor] get_adaptive_loops_health failed', {
      error: error.message,
    });
    return NextResponse.json({ error: GENERIC_500_BODY }, { status: 500 });
  }

  const health = (data ?? null) as AdaptiveLoopsHealth | null;
  if (!health) {
    logger.error('[adaptive-loops-monitor] RPC returned no health snapshot', {});
    return NextResponse.json({ error: GENERIC_500_BODY }, { status: 500 });
  }

  const alerts = evaluateAdaptiveLoopsAlerts(health);

  // Emit ONE ops_events row per fired condition. logOpsEvent awaits
  // error/critical writes (guaranteed delivery) and redacts context; every
  // context here is aggregate-only already.
  for (const alert of alerts) {
    await logOpsEvent({
      category: alert.category,
      source: 'cron/adaptive-loops-monitor',
      severity: alert.severity,
      message: alert.message,
      context: { ...alert.context, monitor_generated_at: health.generated_at },
    });
  }

  // The monitor is itself observable (item 8.2 posture). This heartbeat is
  // category 'job_health' severity 'info' — it can never trip the alert rules
  // above (they require error/critical).
  await recordCronJobHealth({
    path: '/api/cron/adaptive-loops-monitor',
    metric: 'ops.cron.adaptive_loops_monitor.last_success_at',
    source: 'cron/adaptive-loops-monitor',
    durationMs: Date.now() - startedAt,
    context: { alerts_fired: alerts.length },
  });

  logger.info('[adaptive-loops-monitor] run complete', {
    alerts_fired: alerts.length,
    alert_kinds: alerts.map((a) => a.kind),
    durationMs: Date.now() - startedAt,
  });

  // Aggregate-only response body: the RPC snapshot + which alerts fired.
  return NextResponse.json({
    success: true,
    data: {
      health,
      alerts_fired: alerts.map((a) => ({
        kind: a.kind,
        category: a.category,
        severity: a.severity,
      })),
    },
  });
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
    logger.error('[adaptive-loops-monitor] run failed', {
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
