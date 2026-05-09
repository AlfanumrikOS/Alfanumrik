import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';

/**
 * GET/POST /api/cron/payments-health
 *
 * Continuous self-health monitor for the Razorpay subscription pipeline.
 *
 * Why this exists
 * ───────────────
 * On 2026-05-09 a captured ₹699 payment for hridaankaushik307@gmail.com
 * never activated because two independent middleware/UX bugs combined
 * to drop both the verify call (401) AND the webhook (429 from the
 * general rate limiter, which Razorpay treats as terminal — no retry).
 * payment_webhook_events had been empty for ~2 weeks before anyone
 * noticed. This cron exists so a future regression in any layer
 * (webhook delivery, signature verification, rate limiter, RPC,
 * checkout flow) is detected within minutes, not after a customer
 * complains.
 *
 * What it checks
 * ──────────────
 * 1. Webhook silence
 *    payment_history has captured/pending rows in the last `STALE_HOURS`
 *    window, but payment_webhook_events received zero rows in that same
 *    window. This shape is the signature of "Razorpay says paid, our
 *    backend was never told" — exactly the 2026-05-09 incident.
 *
 * 2. Stuck pending payments
 *    Any payment_history row with status='pending' older than
 *    `STUCK_THRESHOLD_MIN`. Either the user abandoned checkout (benign)
 *    OR verify+webhook both failed (the failure mode we're guarding
 *    against). We surface both — ops decides.
 *
 * 3. Stuck pending subscriptions
 *    student_subscriptions with status='pending' AND `updated_at` older
 *    than `STUCK_THRESHOLD_MIN`. Same shape, different table.
 *
 * 4. Verify-route 401 spike
 *    Counts ops_events with source='verify/route.ts' and a 401 marker in
 *    the message in the last hour. Threshold: MAX_VERIFY_401_PER_HOUR.
 *
 * Output
 * ──────
 * On any anomaly: writes a `severity='critical'` row to ops_events for
 * the webhook_silence shape (most directly maps to the 2026-05-09
 * incident); 'error' for the others. Returns structured JSON so a future
 * alerting integration can read it directly.
 *
 * Safety properties
 * ─────────────────
 *   - Read-only against business tables. Writes only to ops_events.
 *   - CRON_SECRET-gated, same pattern as reconcile-payments.
 *   - Fails open on partial errors (one failed query does not skip the
 *     others) — better to alert on the working signals than to silence
 *     everything because of one transient timeout.
 *
 * Schedule (vercel.json): every 10 minutes. The webhook-silence shape
 * compounds slowly so 10-minute cadence is sufficient.
 */

export const runtime = 'nodejs';
export const maxDuration = 30;

const STALE_HOURS = 2;
const STUCK_THRESHOLD_MIN = 30;
const MAX_VERIFY_401_PER_HOUR = 3;

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

interface HealthCheck {
  name: string;
  ok: boolean;
  details: Record<string, unknown>;
}

async function checkWebhookSilence(): Promise<HealthCheck> {
  const admin = getSupabaseAdmin();
  const since = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000).toISOString();

  const [{ count: paymentCount }, { count: webhookCount }] = await Promise.all([
    admin.from('payment_history').select('*', { count: 'exact', head: true }).gte('created_at', since),
    admin.from('payment_webhook_events').select('*', { count: 'exact', head: true }).gte('received_at', since),
  ]);

  const ok = !((paymentCount ?? 0) > 0 && (webhookCount ?? 0) === 0);

  return {
    name: 'webhook_silence',
    ok,
    details: {
      window_hours: STALE_HOURS,
      payment_history_rows: paymentCount ?? 0,
      payment_webhook_events_rows: webhookCount ?? 0,
    },
  };
}

async function checkStuckPendingPayments(): Promise<HealthCheck> {
  const admin = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MIN * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('payment_history')
    .select('id, student_id, plan_code, amount, created_at, notes')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(50);

  if (error) {
    return { name: 'stuck_pending_payments', ok: false, details: { error: error.message } };
  }

  return {
    name: 'stuck_pending_payments',
    ok: (data?.length ?? 0) === 0,
    details: {
      threshold_minutes: STUCK_THRESHOLD_MIN,
      stuck_count: data?.length ?? 0,
      sample: (data ?? []).slice(0, 5).map(r => ({
        id: r.id,
        plan_code: r.plan_code,
        amount: r.amount,
        age_minutes: Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000),
        razorpay_subscription_id: (r.notes as { razorpay_subscription_id?: string } | null)?.razorpay_subscription_id ?? null,
      })),
    },
  };
}

async function checkStuckPendingSubscriptions(): Promise<HealthCheck> {
  const admin = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MIN * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('student_subscriptions')
    .select('id, student_id, plan_code, razorpay_subscription_id, updated_at')
    .eq('status', 'pending')
    .lt('updated_at', cutoff)
    .limit(50);

  if (error) {
    return { name: 'stuck_pending_subscriptions', ok: false, details: { error: error.message } };
  }

  return {
    name: 'stuck_pending_subscriptions',
    ok: (data?.length ?? 0) === 0,
    details: {
      threshold_minutes: STUCK_THRESHOLD_MIN,
      stuck_count: data?.length ?? 0,
      sample: (data ?? []).slice(0, 5).map(r => ({
        student_id: r.student_id,
        plan_code: r.plan_code,
        razorpay_subscription_id: r.razorpay_subscription_id,
        age_minutes: Math.round((Date.now() - new Date(r.updated_at).getTime()) / 60000),
      })),
    },
  };
}

async function checkVerify401Spike(): Promise<HealthCheck> {
  const admin = getSupabaseAdmin();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error } = await admin
    .from('ops_events')
    .select('*', { count: 'exact', head: true })
    .eq('category', 'payment')
    .eq('source', 'verify/route.ts')
    .gte('occurred_at', since)
    .ilike('message', '%401%');

  if (error) {
    return { name: 'verify_401_spike', ok: false, details: { error: error.message } };
  }

  return {
    name: 'verify_401_spike',
    ok: (count ?? 0) <= MAX_VERIFY_401_PER_HOUR,
    details: { window_hours: 1, threshold: MAX_VERIFY_401_PER_HOUR, count: count ?? 0 },
  };
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }

async function run(request: NextRequest) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const checks = await Promise.all([
    checkWebhookSilence().catch(e => ({ name: 'webhook_silence', ok: false, details: { error: String(e) } } as HealthCheck)),
    checkStuckPendingPayments().catch(e => ({ name: 'stuck_pending_payments', ok: false, details: { error: String(e) } } as HealthCheck)),
    checkStuckPendingSubscriptions().catch(e => ({ name: 'stuck_pending_subscriptions', ok: false, details: { error: String(e) } } as HealthCheck)),
    checkVerify401Spike().catch(e => ({ name: 'verify_401_spike', ok: false, details: { error: String(e) } } as HealthCheck)),
  ]);

  const failed = checks.filter(c => !c.ok);
  const allOk = failed.length === 0;

  if (!allOk) {
    for (const c of failed) {
      await logOpsEvent({
        category: 'payment',
        severity: c.name === 'webhook_silence' ? 'critical' : 'error',
        source: 'cron/payments-health',
        message: `payments_health_check_failed: ${c.name}`,
        context: c.details,
      });
    }
    logger.warn('payments-health: anomalies detected', {
      failed: failed.map(f => f.name), latency_ms: Date.now() - startedAt,
    });
  }

  return NextResponse.json({
    ok: allOk,
    checked_at: new Date().toISOString(),
    latency_ms: Date.now() - startedAt,
    checks,
  });
}
