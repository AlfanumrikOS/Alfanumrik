import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';

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
 * Idempotency: the underlying reconciliation logic is the same upserts that
 * the webhook would have done (students.subscription_plan + student_subscriptions).
 * Running twice on an already-reconciled payment is a no-op (the WHERE filter
 * skips it because subscription_plan now matches plan_code).
 *
 * Safety budget: this route runs every 30 min — we cap the per-invocation
 * batch at 100 stuck payments so a freak large backlog cannot blow past the
 * cron route timeout. If we ever see ≥100 in a single run, ops logs a
 * critical event and the next run picks up the rest.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_RECONCILIATIONS_PER_RUN = 100;

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

// ─── Reconciliation (mirrors super-admin/payment-ops/reconcile) ──────────────

function computeExpiry(paymentCreatedAt: string, billingCycle: string): string {
  const base = new Date(paymentCreatedAt);
  const days = billingCycle === 'yearly' ? 365 : 30;
  base.setDate(base.getDate() + days);
  return base.toISOString();
}

async function findStuckPayments(): Promise<StuckPayment[]> {
  const admin = getSupabaseAdmin();
  const { data: capturedPayments, error: phError } = await admin
    .from('payment_history')
    .select('id, student_id, plan_code, billing_cycle, razorpay_payment_id, razorpay_order_id, created_at')
    .eq('status', 'captured')
    .order('created_at', { ascending: false })
    .limit(MAX_RECONCILIATIONS_PER_RUN * 5); // pull a little extra so we don't miss tail

  if (phError || !capturedPayments || capturedPayments.length === 0) return [];

  const studentIds = [...new Set(capturedPayments.map((p) => p.student_id))];
  const { data: students } = await admin
    .from('students')
    .select('id, subscription_plan')
    .in('id', studentIds);

  const studentMap = new Map((students || []).map((s) => [s.id, s]));

  return capturedPayments.filter((p) => {
    const student = studentMap.get(p.student_id);
    if (!student) return true; // student not found → also stuck (rare, but reconcile handles it)
    const currentPlan = student.subscription_plan;
    return !currentPlan || currentPlan === 'free' || currentPlan !== p.plan_code;
  }) as StuckPayment[];
}

async function reconcileOne(payment: StuckPayment): Promise<{ studentId: string; ok: boolean; error?: string }> {
  const admin = getSupabaseAdmin();
  const expiry = computeExpiry(payment.created_at, payment.billing_cycle);

  // 1. Update students table
  const { error: studentErr } = await admin
    .from('students')
    .update({
      subscription_plan: payment.plan_code,
      subscription_expiry: expiry,
    })
    .eq('id', payment.student_id);

  if (studentErr) {
    return { studentId: payment.student_id, ok: false, error: `students: ${studentErr.message}` };
  }

  // 2. Look up plan_id
  const { data: planRow } = await admin
    .from('subscription_plans')
    .select('id')
    .eq('plan_code', payment.plan_code)
    .limit(1)
    .maybeSingle();

  // 3. Upsert student_subscriptions
  const { error: subErr } = await admin
    .from('student_subscriptions')
    .upsert(
      {
        student_id: payment.student_id,
        plan_id: planRow?.id ?? null,
        plan_code: payment.plan_code,
        status: 'active',
        billing_cycle: payment.billing_cycle,
        current_period_start: payment.created_at,
        current_period_end: expiry,
        razorpay_payment_id: payment.razorpay_payment_id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'student_id' },
    );

  if (subErr) {
    return { studentId: payment.student_id, ok: false, error: `student_subscriptions: ${subErr.message}` };
  }

  // 4. Log ops event
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
      expiry,
      trigger: 'cron_30min',
    },
  });

  return { studentId: payment.student_id, ok: true };
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

  try {
    const allStuck = await findStuckPayments();

    if (allStuck.length === 0) {
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
