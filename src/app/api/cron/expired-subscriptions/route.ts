import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';

/**
 * POST /api/cron/expired-subscriptions
 *
 * P0-C launch fix. Vercel Cron entry that runs every 6 hours.
 *
 * Calls the `check_expired_subscriptions` RPC (added in
 * 20260425160000_p0_launch_kill_switches_and_expiry_rpc.sql) which:
 *   1. Finds active subscriptions whose current_period_end has elapsed
 *      (lost charge or expired event from Razorpay) → marks past_due with
 *      a 3-day grace period via mark_subscription_past_due.
 *   2. Finds past_due subscriptions whose grace_period_end has elapsed →
 *      halts them via halt_subscription (downgrades access).
 *
 * Both helpers come from migration 20260328160000_recurring_billing.sql and
 * are SECURITY DEFINER. We do not modify them — this route is purely a
 * scheduler for the existing logic.
 *
 * Auth: CRON_SECRET header.
 *
 * Idempotency: the RPC's WHERE filters mean re-running on already-handled
 * subscriptions is a no-op. Status transitions are one-way (active →
 * past_due → halted) within a single billing cycle.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

// ─── Auth ────────────────────────────────────────────────────────────────────

function verifyCronSecret(request: NextRequest): boolean {
  const cronSecret =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || !cronSecret) return false;
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
  const admin = getSupabaseAdmin();

  try {
    const { data, error } = await admin.rpc('check_expired_subscriptions');

    const durationMs = Date.now() - startTime;

    if (error) {
      logger.error('cron/expired-subscriptions: RPC failed', {
        error: new Error(error.message),
        duration_ms: durationMs,
      });
      await logOpsEvent({
        category: 'payment',
        source: 'cron/expired-subscriptions',
        severity: 'error',
        message: 'check_expired_subscriptions RPC failed',
        context: { rpc_error: error.message, duration_ms: durationMs },
      });
      return NextResponse.json(
        { success: false, error: error.message, duration_ms: durationMs },
        { status: 500 },
      );
    }

    // RPC returns jsonb { marked_past_due, halted, checked_at }
    const result = (data ?? {}) as {
      marked_past_due?: number;
      halted?: number;
      checked_at?: string;
    };

    logger.info('cron/expired-subscriptions: completed', {
      marked_past_due: result.marked_past_due ?? 0,
      halted: result.halted ?? 0,
      duration_ms: durationMs,
    });

    // If we marked OR halted anything, surface an info ops event so the
    // super-admin dashboard can see subscription-lifecycle activity.
    const movedRows = (result.marked_past_due ?? 0) + (result.halted ?? 0);
    if (movedRows > 0) {
      await logOpsEvent({
        category: 'payment',
        source: 'cron/expired-subscriptions',
        severity: 'info',
        message: 'Subscription lifecycle transitions',
        context: {
          marked_past_due: result.marked_past_due ?? 0,
          halted: result.halted ?? 0,
          duration_ms: durationMs,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        marked_past_due: result.marked_past_due ?? 0,
        halted: result.halted ?? 0,
        checked_at: result.checked_at ?? new Date().toISOString(),
        duration_ms: durationMs,
      },
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error('cron/expired-subscriptions: unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      duration_ms: durationMs,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Expired subscriptions cron error',
        duration_ms: durationMs,
      },
      { status: 500 },
    );
  }
}
