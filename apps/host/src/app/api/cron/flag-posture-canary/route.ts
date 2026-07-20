// src/app/api/cron/flag-posture-canary/route.ts
//
// Flag-posture drift canary (guardrail after the 2026-07-20 console
// bulk-enable incident — 49 protected-OFF flags re-armed, restored by
// migration 20260720130000_restore_approved_flag_posture.sql).
//
// Nightly checks against the CEO-approved posture pinned in
// packages/lib/src/flags/protected-flags.ts:
//   1. Every EXPECTED_OFF_FLAGS row (the 52 block-(ii) flags +
//      ff_irt_question_selection) must read is_enabled=false AND
//      rollout_percentage=0.
//   2. ff_atomic_subscription_activation (P11 payment kill-switch) must read
//      is_enabled=true — a missing row is also drift.
//   3. The two MoL shadow flags must have metadata->>'enabled' != 'true'
//      (the metadata jsonb envelope is their real control surface).
//
// On drift: ops_events row (severity 'error', flag names + current state
// only — no PII), an audit_logs row (metadata only), and a JSON body
// { drift: [...], count }. Clean run: { drift: [], count: 0 }.
//
// Job-health heartbeat (ops review condition 1): every successful run writes
// ops.cron.flag_posture_canary.last_success_at via recordCronJobHealth — on
// BOTH the clean path and the drift path (drift detection IS a successful
// run; the canary did its job). Only genuine 500s skip the heartbeat.
//
// Security (house pattern — copied from api/cron/adaptive-remediation):
// fail-closed CRON_SECRET gate with a constant-time compare BEFORE any DB
// I/O. Counts-only/state-only response posture; generic 500 on failure.
//
// REVIEW CHAIN NOTE (P14): registering this route in vercel.json crons is a
// deployment-config change — architect must review (vercel.json cannot carry
// comments, so the note lives here). Schedule chosen: 25 3 * * * (03:25 UTC,
// off-peak IST early morning; avoids the :00/:10/:15/:20/:30/:40/:45/:50
// minutes used by the */10, */15 and */30 crons and every existing fixed
// daily slot).

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { auditLog } from '@alfanumrik/lib/audit';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';
import { EXPECTED_OFF_FLAGS } from '@alfanumrik/lib/flags/protected-flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Generic 500 body — never echo internal error details to the caller. */
const GENERIC_500_BODY = 'internal_error';

/** P11 kill-switch: approved posture is is_enabled=TRUE (rollout ignored). */
const MUST_BE_ENABLED_FLAG = 'ff_atomic_subscription_activation';

/** MoL shadow flags: paused via the metadata jsonb envelope ({enabled}). */
const MOL_METADATA_PAUSED_FLAGS = [
  'ff_grounded_answer_mol_shadow_v1',
  'ff_mol_shadow_text_capture_v1',
] as const;

// ════════════════════════════════════════════════════════════════════════════
// AUTH — fail-closed, constant-time, BEFORE any DB I/O
// (house pattern: api/cron/adaptive-remediation/route.ts)
// ════════════════════════════════════════════════════════════════════════════

function constantTimeMatch(provided: string, secret: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Carrier precedence is FIRST-PRESENT-WINS: exactly ONE candidate is selected
 * (Bearer, else x-cron-secret, else ?token=) and compared once. A WRONG value
 * in a higher-precedence carrier is NOT rescued by a correct lower one.
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed on missing configuration

  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  const headerSecret = req.headers.get('x-cron-secret') ?? '';
  const token = req.nextUrl.searchParams.get('token') ?? '';

  const provided = bearer || headerSecret || token;
  if (!provided) return false;
  return constantTimeMatch(provided, secret);
}

// ════════════════════════════════════════════════════════════════════════════
// CANARY
// ════════════════════════════════════════════════════════════════════════════

interface FlagRow {
  flag_name: string;
  is_enabled: boolean;
  rollout_percentage: number | null;
  metadata: Record<string, unknown> | null;
}

/** Drift entry: flag name + current state ONLY (no PII, no operator identity). */
interface DriftEntry {
  flag_name: string;
  expected: string;
  is_enabled?: boolean;
  rollout_percentage?: number | null;
  metadata_enabled?: string | null;
  state?: 'missing';
}

function computeDrift(rows: FlagRow[]): DriftEntry[] {
  const byName = new Map(rows.map(r => [r.flag_name, r]));
  const drift: DriftEntry[] = [];

  // 1. Every expected-OFF flag present must be fully OFF. Absence is NOT drift
  //    (some names are unseeded on non-prod environments).
  for (const name of EXPECTED_OFF_FLAGS) {
    const row = byName.get(name);
    if (!row) continue;
    if (row.is_enabled !== false || (row.rollout_percentage ?? 0) !== 0) {
      drift.push({
        flag_name: name,
        expected: 'is_enabled=false, rollout_percentage=0',
        is_enabled: row.is_enabled,
        rollout_percentage: row.rollout_percentage,
      });
    }
  }

  // 2. The P11 kill-switch must exist and be enabled.
  const killSwitch = byName.get(MUST_BE_ENABLED_FLAG);
  if (!killSwitch) {
    drift.push({ flag_name: MUST_BE_ENABLED_FLAG, expected: 'is_enabled=true', state: 'missing' });
  } else if (killSwitch.is_enabled !== true) {
    drift.push({
      flag_name: MUST_BE_ENABLED_FLAG,
      expected: 'is_enabled=true',
      is_enabled: killSwitch.is_enabled,
      rollout_percentage: killSwitch.rollout_percentage,
    });
  }

  // 3. MoL shadow flags: metadata->>'enabled' must NOT be 'true'.
  for (const name of MOL_METADATA_PAUSED_FLAGS) {
    const row = byName.get(name);
    if (!row) continue;
    const metaEnabled = row.metadata == null ? null : String((row.metadata as Record<string, unknown>).enabled ?? '');
    if (metaEnabled === 'true') {
      drift.push({
        flag_name: name,
        expected: "metadata->>'enabled' != 'true'",
        metadata_enabled: metaEnabled,
      });
    }
  }

  return drift;
}

async function runCanary(startedAt: number): Promise<NextResponse> {
  const watched = [...new Set([...EXPECTED_OFF_FLAGS, MUST_BE_ENABLED_FLAG, ...MOL_METADATA_PAUSED_FLAGS])];

  const { data, error } = await supabaseAdmin
    .from('feature_flags')
    .select('flag_name,is_enabled,rollout_percentage,metadata')
    .in('flag_name', watched);

  if (error) {
    logger.error('[flag-posture-canary] feature_flags read failed', { error: error.message });
    return NextResponse.json({ error: GENERIC_500_BODY }, { status: 500 });
  }

  const drift = computeDrift((data ?? []) as FlagRow[]);

  if (drift.length > 0) {
    // Ops event + audit row: flag names + current state only — no PII.
    await logOpsEvent({
      category: 'deploy',
      source: 'cron/flag-posture-canary',
      severity: 'error',
      message: `Feature-flag posture drift: ${drift.length} flag(s) deviate from the CEO-approved posture (20260720110000/20260720130000)`,
      context: { count: drift.length, drift },
    });
    await auditLog({
      actor_id: null,
      actor_role: 'system',
      action: 'feature_flag.posture_drift_detected',
      target_entity: 'feature_flags',
      status: 'failure',
      metadata: { count: drift.length, drift },
    });
  }

  // Job-health heartbeat (house pattern: api/cron/streak-guardian). Written on
  // BOTH the clean path and the drift path — drift detection IS a successful
  // run (the canary succeeded at its job). Only genuine 500s skip it. The
  // helper is fire-safe (never throws) and writes category 'job_health'
  // severity 'info', so the heartbeat can never trip the 'deploy'/'error'
  // drift alert rule.
  await recordCronJobHealth({
    path: '/api/cron/flag-posture-canary',
    metric: 'ops.cron.flag_posture_canary.last_success_at',
    source: 'cron/flag-posture-canary',
    durationMs: Date.now() - startedAt,
    context: { count: drift.length, drift_detected: drift.length > 0 },
  });

  return NextResponse.json({ drift, count: drift.length });
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  // Fail-closed auth BEFORE any DB I/O.
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return await runCanary(startedAt);
  } catch (err) {
    logger.error('[flag-posture-canary] run failed', {
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
