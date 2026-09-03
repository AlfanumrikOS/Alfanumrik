import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';
import { verifyCronAuth, unauthorizedResponse } from '@alfanumrik/lib/cron-auth';

/**
 * POST /api/cron/expire-abandoned-checkouts
 *
 * P11 payment-integrity fix (2026-09-02 launch audit, P2-5 follow-up).
 *
 * Calls the `expire_abandoned_checkout_attempts` RPC (added in migration
 * 20260903090000_expire_abandoned_checkout_attempts.sql), which finds
 * checkout attempts that never completed — `payment_history` rows still
 * 'pending' with no `razorpay_payment_id` ever attached, and
 * `student_subscriptions` rows still 'pending' — after a conservative
 * 72-hour window, and moves them to a terminal status ('failed' /
 * 'cancelled').
 *
 * Why this exists: nothing else in this codebase ever closes out an
 * abandoned checkout attempt. `cron/expired-subscriptions` only handles
 * ALREADY-active subscriptions lapsing; `cron/reconcile-payments` handles
 * the opposite direction (a captured payment whose student record wasn't
 * updated). Without this, an abandoned 'pending' row sits forever and
 * `cron/payments-health` (which alerts on any pending row older than 30
 * minutes, by design — that check exists to catch a REAL pipeline
 * failure within minutes) re-alerts on it indefinitely. One such
 * abandoned row generated 4,727 ops_events error rows over 46 days before
 * this was found and fixed.
 *
 * We do not modify check_expired_subscriptions, payments-health, or
 * reconcile-payments — this route is a new, single-purpose scheduler,
 * matching the existing convention (see expired-subscriptions/route.ts).
 *
 * Auth: CRON_SECRET header (shared @alfanumrik/lib/cron-auth gate).
 *
 * Idempotency: the RPC's WHERE filters mean re-running on already-handled
 * rows is a no-op — a row can only match while status='pending', and this
 * RPC is the only thing that ever moves it out of 'pending' without a
 * genuine capture/activation.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

// ─── Handler ─────────────────────────────────────────────────────────────────
// Auth: shared @alfanumrik/lib/cron-auth gate (Bearer / x-cron-secret,
// constant-time, fail-closed).

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request).ok) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();
  const admin = getSupabaseAdmin();

  try {
    const { data, error } = await admin.rpc('expire_abandoned_checkout_attempts');

    const durationMs = Date.now() - startTime;

    if (error) {
      logger.error('cron/expire-abandoned-checkouts: RPC failed', {
        error: new Error(error.message),
        duration_ms: durationMs,
      });
      await logOpsEvent({
        category: 'payment',
        source: 'cron/expire-abandoned-checkouts',
        severity: 'error',
        message: 'expire_abandoned_checkout_attempts RPC failed',
        context: { rpc_error: error.message, duration_ms: durationMs },
      });
      return NextResponse.json(
        { success: false, error: error.message, duration_ms: durationMs },
        { status: 500 },
      );
    }

    // RPC returns jsonb { payments_expired, subscriptions_expired, checked_at }
    const result = (data ?? {}) as {
      payments_expired?: number;
      subscriptions_expired?: number;
      checked_at?: string;
    };

    logger.info('cron/expire-abandoned-checkouts: completed', {
      payments_expired: result.payments_expired ?? 0,
      subscriptions_expired: result.subscriptions_expired ?? 0,
      duration_ms: durationMs,
    });

    // If we expired anything, surface an info ops event so the super-admin
    // dashboard can see the lifecycle activity.
    const expiredRows = (result.payments_expired ?? 0) + (result.subscriptions_expired ?? 0);
    if (expiredRows > 0) {
      await logOpsEvent({
        category: 'payment',
        source: 'cron/expire-abandoned-checkouts',
        severity: 'info',
        message: 'Abandoned checkout attempts expired',
        context: {
          payments_expired: result.payments_expired ?? 0,
          subscriptions_expired: result.subscriptions_expired ?? 0,
          duration_ms: durationMs,
        },
      });
    }

    await recordCronJobHealth({
      path: '/api/cron/expire-abandoned-checkouts',
      metric: 'ops.cron.expire_abandoned_checkouts.last_success_at',
      source: 'cron/expire-abandoned-checkouts',
      durationMs,
      context: {
        payments_expired: result.payments_expired ?? 0,
        subscriptions_expired: result.subscriptions_expired ?? 0,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        payments_expired: result.payments_expired ?? 0,
        subscriptions_expired: result.subscriptions_expired ?? 0,
        checked_at: result.checked_at ?? new Date().toISOString(),
        duration_ms: durationMs,
      },
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error('cron/expire-abandoned-checkouts: unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      duration_ms: durationMs,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Expire abandoned checkouts cron error',
        duration_ms: durationMs,
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
