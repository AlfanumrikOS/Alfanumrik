import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';
import { verifyCronAuth, unauthorizedResponse } from '@alfanumrik/lib/cron-auth';

/**
 * POST /api/cron/reconcile-payments
 *
 * P0-C launch fix. Vercel Cron entry that runs every 30 minutes.
 *
 * Detects "stuck" payments — payment_history shows status='captured' but the
 * student's subscription_plan does not match the paid plan_code — and fixes
 * them automatically. Mirrors the manual super-admin tool at
 * /api/super-admin/payment-ops/reconcile (POST { all: true }) but is
 * unattended and CRON_SECRET-gated.
 *
 * This closes the lost-webhook gap: if Razorpay's webhook lands but the
 * activation RPC fails AND the verify route also drops the activation, the
 * student would otherwise stay on the free plan despite a captured payment
 * until a human runs the runbook. Now we self-heal within ≤30 min.
 *
 * Auth: CRON_SECRET header.
 *
 * Idempotency: reconciliation routes through the same atomic activation RPC the
 * webhook uses (atomic_subscription_activation_locked — single transaction across
 * students.subscription_plan + student_subscriptions, with a per-student advisory
 * lock). Running twice on an already-reconciled payment is a no-op (the WHERE
 * filter skips it because subscription_plan now matches plan_code; and the RPC
 * upserts ON CONFLICT (student_id) so even a re-run is idempotent).
 *
 * Safety budget: this route runs every 30 min — we cap the per-invocation
 * batch at 100 stuck payments so a freak large backlog cannot blow past the
 * cron route timeout. If we ever see ≥100 in a single run, ops logs a
 * critical event and the next run picks up the rest.
 *
 * C2 fix (P11 — 2026-07-29): this cron previously had no recency bound and no
 * awareness of a LATER legitimate cancellation/expiry/downgrade, so it could
 * resurrect access for a student who had since cancelled or been downgraded —
 * fighting every other lifecycle cron forever, on every run, for the life of
 * the payment_history row. Two independent guards were added:
 *   1. Recency bound — only payments captured in the last RECENCY_WINDOW_MS
 *      are eligible. Reconciliation exists to catch a captured payment that
 *      failed to activate WITHIN MINUTES of capture, not to re-litigate
 *      months-old billing history.
 *   2. Terminal-state guard — if the student's student_subscriptions row
 *      reached a terminal status (cancelled/expired/halted/completed) AFTER
 *      the payment's created_at, the mismatch is not a lost activation, it is
 *      an intentional later lifecycle change; skip it.
 *   3. `reconciled_at` marker (migration 20260729120000) — once a payment is
 *      successfully reconciled it is stamped and permanently excluded from
 *      future scans, so it can never be resurrected again even within the
 *      recency window.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_RECONCILIATIONS_PER_RUN = 100;

// C2 (P11): only consider payments captured within the last 2 hours. This
// cron runs every 30 minutes specifically to catch a captured payment whose
// activation write dropped moments earlier — not to re-scan billing history.
// A 2h window comfortably covers missed runs / a brief outage while staying
// far short of "resurrect an old, since-cancelled subscription" territory.
const RECENCY_WINDOW_MS = 2 * 60 * 60 * 1000;

const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['cancelled', 'expired', 'halted', 'completed']);

interface StuckPayment {
  id: string;
  student_id: string;
  plan_code: string;
  billing_cycle: string;
  razorpay_payment_id: string;
  razorpay_order_id: string | null;
  created_at: string;
}

// ─── Auth ────────────────────────────────────────────────────────────────────
// Shared @alfanumrik/lib/cron-auth gate (Bearer / x-cron-secret, constant-time,
// fail-closed).

// ─── Reconciliation (mirrors super-admin/payment-ops/reconcile) ──────────────

async function findStuckPayments(): Promise<StuckPayment[]> {
  const admin = getSupabaseAdmin();
  const recencyCutoffIso = new Date(Date.now() - RECENCY_WINDOW_MS).toISOString();

  // C2 (P11): recency bound + exclude rows already stamped `reconciled_at`
  // (migration 20260729120000) so a payment can never be resurrected twice.
  const { data: capturedPayments, error: phError } = await admin
    .from('payment_history')
    .select('id, student_id, plan_code, billing_cycle, razorpay_payment_id, razorpay_order_id, created_at')
    .eq('status', 'captured')
    .is('reconciled_at', null)
    .gte('created_at', recencyCutoffIso)
    .order('created_at', { ascending: false })
    .limit(MAX_RECONCILIATIONS_PER_RUN * 5); // pull a little extra so we don't miss tail

  if (phError || !capturedPayments || capturedPayments.length === 0) return [];

  const studentIds = [...new Set(capturedPayments.map((p) => p.student_id))];
  const { data: students } = await admin
    .from('students')
    .select('id, subscription_plan')
    .in('id', studentIds);

  // C2 (P11): also pull each student's subscription lifecycle so we can skip
  // payments that were superseded by a LATER legitimate cancellation/expiry/
  // downgrade — resurrecting those would actively fight the cancellation cron.
  const { data: subs } = await admin
    .from('student_subscriptions')
    .select('student_id, status, cancelled_at, ended_at')
    .in('student_id', studentIds);

  const studentMap = new Map((students || []).map((s) => [s.id, s]));
  const subMap = new Map((subs || []).map((s) => [s.student_id, s]));

  return capturedPayments.filter((p) => {
    const student = studentMap.get(p.student_id);
    if (!student) return true; // student not found → also stuck (rare, but reconcile handles it)
    const currentPlan = student.subscription_plan;
    const looksStuck = !currentPlan || currentPlan === 'free' || currentPlan !== p.plan_code;
    if (!looksStuck) return false;

    // Terminal-state guard: if the student's subscription reached a terminal
    // status AFTER this payment was captured, the mismatch is an intentional
    // later lifecycle change (cancel/expire/halt/downgrade), not a lost
    // activation. Do not resurrect it.
    const sub = subMap.get(p.student_id);
    if (sub && TERMINAL_SUBSCRIPTION_STATUSES.has(sub.status)) {
      const terminalAt = sub.ended_at || sub.cancelled_at;
      if (terminalAt && new Date(terminalAt).getTime() > new Date(p.created_at).getTime()) {
        return false;
      }
      // No terminal timestamp recorded but status is already terminal — be
      // conservative and skip rather than fight a lifecycle we can't date.
      if (!terminalAt) return false;
    }

    return true;
  }) as StuckPayment[];
}

async function reconcileOne(payment: StuckPayment): Promise<{ studentId: string; ok: boolean; error?: string }> {
  const admin = getSupabaseAdmin();

  // PAY-3 (P11 atomicity): activate via the SAME single-transaction RPC the webhook
  // uses as its fallback (`atomic_subscription_activation`), instead of the previous
  // two independent writes (UPDATE students; then UPSERT student_subscriptions). The
  // old two-write shape could itself create the `students.subscription_plan` /
  // `student_subscriptions` split-brain this cron exists to REPAIR if the second
  // write failed after the first succeeded. The RPC upserts BOTH tables in one
  // transaction AND (via its `_locked` wrapper) takes the per-student advisory lock,
  // so it can no longer interleave with a concurrent webhook activation for the same
  // student. WHAT gets reconciled is unchanged (findStuckPayments is untouched); only
  // the write is now atomic. The RPC derives current_period_end from NOW() exactly as
  // the webhook's own activation does, so reconcile and webhook stay consistent.
  // p_razorpay_subscription_id is null here: this self-heal path activates from a
  // captured payment row and has no recurring-subscription id to carry.
  const { error: rpcErr } = await admin.rpc('atomic_subscription_activation_locked', {
    p_student_id: payment.student_id,
    p_plan_code: payment.plan_code,
    p_billing_cycle: payment.billing_cycle,
    p_razorpay_payment_id: payment.razorpay_payment_id,
    p_razorpay_subscription_id: null,
  });

  if (rpcErr) {
    return { studentId: payment.student_id, ok: false, error: `atomic_subscription_activation: ${rpcErr.message}` };
  }

  // C2 (P11): stamp reconciled_at so this exact payment_history row is never
  // re-scanned/re-processed again (see migration 20260729120000). Best-effort:
  // activation already succeeded above, so a failure here must not flip the
  // outcome to failed — just log it for visibility.
  const { error: markErr } = await admin
    .from('payment_history')
    .update({ reconciled_at: new Date().toISOString() })
    .eq('id', payment.id);
  if (markErr) {
    logger.warn('cron/reconcile-payments: failed to stamp reconciled_at (non-blocking)', {
      error: markErr.message, paymentId: payment.id,
    });
  }

  // Log ops event
  await logOpsEvent({
    category: 'payment',
    source: 'cron/reconcile-payments',
    severity: 'info',
    message: 'Auto reconciliation: subscription activated',
    subjectType: 'student',
    subjectId: payment.student_id,
    context: {
      payment_id: payment.id,
      razorpay_payment_id: payment.razorpay_payment_id,
      plan_code: payment.plan_code,
      billing_cycle: payment.billing_cycle,
      trigger: 'cron_30min',
    },
  });

  return { studentId: payment.student_id, ok: true };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!verifyCronAuth(request).ok) {
    return unauthorizedResponse();
  }

  const startTime = Date.now();

  try {
    const allStuck = await findStuckPayments();

    if (allStuck.length === 0) {
      await recordCronJobHealth({
        path: '/api/cron/reconcile-payments',
        metric: 'ops.cron.reconcile_payments.last_success_at',
        source: 'cron/reconcile-payments',
        durationMs: Date.now() - startTime,
        context: { total_stuck: 0, reconciled: 0 },
      });
      return NextResponse.json({
        success: true,
        data: { reconciled: 0, total_stuck: 0, duration_ms: Date.now() - startTime },
      });
    }

    if (allStuck.length >= MAX_RECONCILIATIONS_PER_RUN) {
      // Surface a critical event so ops sees there's a backlog larger than
      // one cron run can drain. The next run will pick up the rest.
      await logOpsEvent({
        category: 'payment',
        source: 'cron/reconcile-payments',
        severity: 'critical',
        message: 'Stuck-payment backlog exceeds per-run cap',
        context: {
          backlog_size: allStuck.length,
          per_run_cap: MAX_RECONCILIATIONS_PER_RUN,
        },
      });
    }

    const batch = allStuck.slice(0, MAX_RECONCILIATIONS_PER_RUN);
    const results: { studentId: string; ok: boolean; error?: string }[] = [];

    for (const payment of batch) {
      try {
        results.push(await reconcileOne(payment));
      } catch (err) {
        results.push({
          studentId: payment.student_id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    const durationMs = Date.now() - startTime;

    logger.info('cron/reconcile-payments: completed', {
      total_stuck: allStuck.length,
      attempted: batch.length,
      succeeded,
      failed,
      duration_ms: durationMs,
    });

    await recordCronJobHealth({
      path: '/api/cron/reconcile-payments',
      metric: 'ops.cron.reconcile_payments.last_success_at',
      source: 'cron/reconcile-payments',
      durationMs,
      context: { total_stuck: allStuck.length, attempted: batch.length, reconciled: succeeded, failed },
    });

    return NextResponse.json({
      success: failed === 0,
      data: {
        total_stuck: allStuck.length,
        attempted: batch.length,
        reconciled: succeeded,
        failed,
        duration_ms: durationMs,
      },
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    logger.error('cron/reconcile-payments: unexpected error', {
      error: err instanceof Error ? err : new Error(String(err)),
      duration_ms: durationMs,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Reconciliation cron error',
        duration_ms: durationMs,
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
