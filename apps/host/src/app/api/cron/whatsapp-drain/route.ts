// src/app/api/cron/whatsapp-drain/route.ts
//
// WhatsApp inbound-event drain cron (Phase 2). The webhook's always-200
// posture (WABA quality-rating protection) means provider redelivery is NOT
// our retry mechanism — this cron is. Every minute (vercel.json) it claims
// stale 'pending' rows from whatsapp_inbound_events and re-processes them.
//
//   Phase 2 processors:
//     - intent 'link' → the SAME binding core the webhook uses
//       (apps/host/src/app/api/whatsapp/_lib/link-binding.ts). The cron
//       cannot TwiML-reply, so cron-path binds complete SILENTLY — the
//       success confirmation is deferred to Phase 3 (whatsapp-send path).
//       P13 note: the raw phone is never persisted in the event row, so a
//       FIRST-EVER bind on a phone with no existing live identity cannot
//       complete from the cron (outcome 'phone_unavailable' → 'failed');
//       the user resends LINK and the webhook handles it live.
//     - Phase 3: Daily-6 family intents (d6_start / d6_answer / subject_pick /
//       menu) route through the SAME processor the webhook's after() path uses
//       (apps/host/src/app/api/whatsapp/_lib/daily6.ts) when
//       ff_whatsapp_daily6 is ON — sends go via whatsapp-send with the
//       byte-exact internal caller 'whatsapp-drain-cron' (migration
//       20260801100600). Flag OFF (or flag read failure) → these rows keep
//       the no-processor bounce below, exactly as Phase 2.
//     - every other intent has NO processor yet: rows are bounced back to
//       'pending' with an incremented attempt count until attempts reach
//       MAX_ATTEMPTS, then marked 'failed' with last_error =
//       'no_processor_phase2' (later phases replace this branch with the
//       doubt/notebook processors).
//
// Claiming: RPC whatsapp_claim_inbound(p_id) → boolean (architect-owned;
// atomically flips pending→processing and increments attempts; false means
// another worker — or the webhook's inline path — already holds/handled the
// row). Rows where the claim returns false are skipped. This route also
// stamps attempts explicitly when re-queueing, so termination at MAX_ATTEMPTS
// does not depend on the RPC's internal increment.
//
// Security (P9, REG-118/REG-119 posture): fail-closed CRON_SECRET gate with a
// constant-time compare BEFORE any DB I/O — copied exactly from
// api/cron/adaptive-remediation/route.ts. Vercel cron invokes GET; POST is
// kept for manual ops triggers (same auth gate).
//
// P13: counts-only response { claimed, processed, failed } — no phones, no
// payloads, no message bodies. Logs carry row UUIDs and outcome labels only.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';
import { verifyCronAuth } from '@alfanumrik/lib/cron-auth';
import { processLinkBinding } from '../../whatsapp/_lib/link-binding';
import {
  DAILY6_PROCESSABLE_INTENTS,
  processDaily6Event,
  type Daily6Intent,
  type Daily6Outcome,
} from '../../whatsapp/_lib/daily6';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Batch bound (60s maxDuration budget; leftovers land on the next minute). */
const BATCH_SIZE = 25;
/** Only rows the webhook's inline path has clearly abandoned (> 45s old). */
const MIN_AGE_MS = 45_000;
/** Terminal attempt ceiling (matches the select filter attempts < 3). */
const MAX_ATTEMPTS = 3;

/** Generic 500 body — never echo err.message to the caller. */
const GENERIC_500_BODY = 'internal_error';

// ════════════════════════════════════════════════════════════════════════════
// AUTH — fail-closed, constant-time, BEFORE any DB I/O
// (shared @alfanumrik/lib/cron-auth gate: FIRST-PRESENT-WINS Bearer, else
//  x-cron-secret — a WRONG value in a higher-precedence carrier is NOT rescued
//  by a correct lower one. The legacy ?token= query carrier was removed
//  2026-08-03: secrets in query strings land in access logs.)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// DRAIN
// ════════════════════════════════════════════════════════════════════════════

interface PendingEventRow {
  id: string;
  intent: string | null;
  attempts: number;
  phone_hash: string;
  payload: Record<string, unknown> | null;
  created_at?: string;
}

/**
 * ff_whatsapp_daily6 gate for the drain path. Fail-safe: any flag-read
 * failure reads as OFF, so d6/menu rows keep the Phase-2 bounce behavior
 * (pending → failed at MAX_ATTEMPTS) instead of half-processing.
 */
async function daily6FlagEnabled(): Promise<boolean> {
  try {
    return await isFeatureEnabled('ff_whatsapp_daily6');
  } catch {
    return false;
  }
}

/** intent_args recorded by the webhook's classification (string map). */
function extractIntentArgs(payload: Record<string, unknown> | null): Record<string, string> {
  const args = (payload as { intent_args?: unknown } | null)?.intent_args;
  if (!args || typeof args !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

interface DrainCounts {
  claimed: number;
  processed: number;
  failed: number;
}

/** Best-effort status update — a failure here just re-surfaces the row later. */
async function setEventStatus(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('whatsapp_inbound_events')
      .update(fields)
      .eq('id', id);
    if (error) {
      logger.warn('whatsapp_drain: event status update failed', {
        eventId: id,
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn('whatsapp_drain: event status update threw', {
      eventId: id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function drain(): Promise<DrainCounts> {
  const counts: DrainCounts = { claimed: 0, processed: 0, failed: 0 };
  const cutoffIso = new Date(Date.now() - MIN_AGE_MS).toISOString();

  const { data: rows, error: selErr } = await supabaseAdmin
    .from('whatsapp_inbound_events')
    .select('id, intent, attempts, phone_hash, payload, created_at')
    .eq('status', 'pending')
    .lt('created_at', cutoffIso)
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (selErr) {
    throw new Error(`pending-event scan failed: ${selErr.message}`);
  }

  for (const row of (rows ?? []) as PendingEventRow[]) {
    // Atomic claim (pending→processing + attempts increment); false/error →
    // another worker holds it or it is no longer claimable — skip.
    const { data: claimedOk, error: claimErr } = await supabaseAdmin.rpc(
      'whatsapp_claim_inbound',
      { p_id: row.id },
    );
    if (claimErr) {
      logger.warn('whatsapp_drain: claim RPC failed; skipping row', {
        eventId: row.id,
        error: claimErr.message,
      });
      continue;
    }
    if (!claimedOk) continue;
    counts.claimed += 1;

    // Post-claim attempts as this route accounts them (independent of the
    // RPC's internal increment — see header).
    const attemptsAfterClaim = row.attempts + 1;
    const nowIso = new Date().toISOString();

    if (row.intent === 'link') {
      const payload = (row.payload ?? {}) as {
        intent_args?: { otp?: unknown };
      };
      const code =
        typeof payload.intent_args?.otp === 'string'
          ? payload.intent_args.otp
          : '';
      const result = await processLinkBinding({
        code,
        phoneHash: row.phone_hash,
        phoneE164: null, // P13: raw phone is never in the event row
        source: 'cron/whatsapp-drain',
      });
      // No reply from the cron path — Phase 3 sends via whatsapp-send.
      if (result.outcome === 'error') {
        if (attemptsAfterClaim >= MAX_ATTEMPTS) {
          await setEventStatus(row.id, {
            status: 'failed',
            last_error: 'link_processing_error',
            attempts: attemptsAfterClaim,
            processed_at: nowIso,
          });
          counts.failed += 1;
        } else {
          await setEventStatus(row.id, {
            status: 'pending',
            attempts: attemptsAfterClaim,
          });
        }
      } else if (result.outcome === 'phone_unavailable') {
        // Retrying cannot help — the raw phone only becomes recoverable via a
        // live webhook inbound (see header). Terminal.
        await setEventStatus(row.id, {
          status: 'failed',
          last_error: 'phone_unavailable_cron',
          attempts: attemptsAfterClaim,
          processed_at: nowIso,
        });
        counts.failed += 1;
      } else {
        // bound / invalid / ambiguous / locked / limit / rate_limited — all
        // deterministic, terminally handled (retrying cannot change any of
        // them; rate_limited in particular persists via
        // whatsapp_link_attempt_throttle until its own lockout elapses).
        await setEventStatus(row.id, {
          status: 'done',
          attempts: attemptsAfterClaim,
          processed_at: nowIso,
        });
        counts.processed += 1;
      }
      continue;
    }

    // Phase 3: Daily-6 family intents route through the shared processor
    // (sends carry the byte-exact internal caller 'whatsapp-drain-cron').
    // Flag OFF / flag-read failure → fall through to the no-processor bounce
    // below, preserving the Phase-2 posture exactly.
    if (row.intent && DAILY6_PROCESSABLE_INTENTS.has(row.intent) && (await daily6FlagEnabled())) {
      let outcome: Daily6Outcome = 'retry';
      try {
        const createdAtMs = row.created_at ? Date.parse(row.created_at) : NaN;
        outcome = await processDaily6Event({
          id: row.id,
          intent: row.intent as Daily6Intent,
          args: extractIntentArgs(row.payload),
          phoneHash: row.phone_hash,
          // Best-available arrival time (P3 timing source): the event row's
          // created_at (webhook receipt), falling back to now.
          receivedAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
          source: 'drain',
        });
      } catch (err) {
        // processDaily6Event never throws by contract — belt and braces.
        logger.error('whatsapp_drain: daily6 processor threw', {
          eventId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (outcome === 'done') {
        await setEventStatus(row.id, {
          status: 'done',
          attempts: attemptsAfterClaim,
          processed_at: nowIso,
        });
        counts.processed += 1;
      } else if (outcome === 'failed' || attemptsAfterClaim >= MAX_ATTEMPTS) {
        await setEventStatus(row.id, {
          status: 'failed',
          last_error: outcome === 'failed' ? 'daily6_terminal' : 'daily6_processing_error',
          attempts: attemptsAfterClaim,
          processed_at: nowIso,
        });
        counts.failed += 1;
      } else {
        await setEventStatus(row.id, {
          status: 'pending',
          attempts: attemptsAfterClaim,
        });
      }
      continue;
    }

    // No processor for this intent yet (doubt/notebook — later phases).
    if (attemptsAfterClaim >= MAX_ATTEMPTS) {
      await setEventStatus(row.id, {
        status: 'failed',
        last_error: 'no_processor_phase2',
        attempts: attemptsAfterClaim,
        processed_at: nowIso,
      });
      counts.failed += 1;
    } else {
      await setEventStatus(row.id, {
        status: 'pending',
        attempts: attemptsAfterClaim,
      });
    }
  }

  return counts;
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════════

async function handle(req: NextRequest): Promise<NextResponse> {
  // Fail-closed auth gate — BEFORE any DB I/O (REG-118/REG-119 posture).
  if (!verifyCronAuth(req).ok) {
    return NextResponse.json(
      { success: false, error: 'unauthorized' },
      { status: 401 },
    );
  }

  const startedAt = Date.now();
  try {
    const counts = await drain();

    // Job-health breadcrumb when the run did work — this cron fires every
    // minute and 1,440 no-op ops_events rows/day would be noise. But the
    // steady state of this queue is EMPTY, so claimed-only recording would
    // starve the liveness gate forever.
    // Heartbeat every 5th minute so the RCA-17 liveness gate (job-registry
    // alertThreshold) has a fresh last_success_at even when the queue is
    // empty (architect condition, 2026-07-30). Deterministic, zero extra
    // reads, ~288 rows/day instead of 1,440.
    const isHeartbeatMinute = new Date().getUTCMinutes() % 5 === 0;
    if (counts.claimed > 0 || isHeartbeatMinute) {
      await recordCronJobHealth({
        path: '/api/cron/whatsapp-drain',
        metric: 'ops.cron.whatsapp_drain.last_success_at',
        source: 'cron/whatsapp-drain',
        durationMs: Date.now() - startedAt,
        context: { ...counts },
      });
    }

    // P13: counts only — no phones, no payloads.
    return NextResponse.json({ success: true, data: counts });
  } catch (err) {
    logger.error('whatsapp_drain: unhandled', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: GENERIC_500_BODY },
      { status: 500 },
    );
  }
}

/** Vercel cron invokes GET. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

/** Manual ops trigger — same fail-closed gate. */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
