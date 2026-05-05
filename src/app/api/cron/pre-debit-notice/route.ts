/**
 * POST /api/cron/pre-debit-notice
 *
 * Wave 2 D7.3 — RBI e-mandate compliance cron.
 *
 * Every 6 hours, scans active auto-renewing subscriptions whose next charge
 * falls in the [+24h, +48h] window and POSTs each to the
 * `send-pre-debit-notice` Edge Function. The Edge Function dedups via the
 * unique index on metadata->>'idempotency_key' (migration
 * 20260505130000_pre_debit_notice_events.sql), so 4 cron-runs/day cannot
 * send 4 duplicate notices for the same charge.
 *
 * Why 6 hours: the RBI minimum is 24h. With a 6-hour cron we always have at
 * least 24h of warning even if one tick fails — the next tick still lands in
 * the [+24h, +48h] window. With a 24h cron, a single missed tick would
 * silently miss notices; non-compliant.
 *
 * Why [+24h, +48h]: lower bound = RBI minimum. Upper bound = 6h cron tick
 * × 4 = 24h, so subscriptions due "anywhere in the next day" are caught
 * exactly once per charge. Together with the DB idempotency key this gives
 * us "exactly once" delivery semantics across 4 ticks.
 *
 * Auth: CRON_SECRET (constant-time check). Same pattern as
 * src/app/api/cron/daily-cron/route.ts.
 *
 * Scope: subscriptions with auto_renew=true and status in ('active','past_due')
 * — past_due included because the Razorpay retry-cycle fires at 7d/14d intervals
 * and each retry also needs RBI notice.
 *
 * Failure isolation: per-subscription Edge Function failures are logged but
 * MUST NOT crash the batch. If 100 subscriptions are due and 1 fails, the
 * other 99 still get notified.
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_PER_RUN = 200; // safety cap; alert if exceeded

interface DueSubscription {
  id: string;
  student_id: string;
  plan_id: string;
  plan_code: string;
  billing_cycle: string;
  amount_paid: number | null;
  next_billing_at: string;
  razorpay_subscription_id: string | null;
}

// ─── Auth ────────────────────────────────────────────────────────────────────
function verifyCronSecret(req: NextRequest): boolean {
  const secret =
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || !secret || secret.length !== expected.length) return false;
  let m = 0;
  for (let i = 0; i < secret.length; i++) m |= secret.charCodeAt(i) ^ expected.charCodeAt(i);
  return m === 0;
}

// ─── Edge Function call (HTTP, not RPC — Edge runs separately) ───────────────
async function invokeSendPreDebitNotice(
  supabaseUrl: string,
  cronSecret: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: unknown; error?: string }> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-pre-debit-notice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': cronSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const startedMs = Date.now();

  if (!verifyCronSecret(request)) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cronSecret = process.env.CRON_SECRET;
  if (!supabaseUrl || !cronSecret) {
    logger.error('cron.pre-debit-notice.misconfigured', { has_url: !!supabaseUrl, has_secret: !!cronSecret });
    return NextResponse.json({ success: false, error: 'server_not_configured' }, { status: 503 });
  }

  // Window: [+24h, +48h] — inclusive of lower, exclusive of upper.
  const now = new Date();
  const lowerBound = new Date(now.getTime() + 24 * 3_600_000).toISOString();
  const upperBound = new Date(now.getTime() + 48 * 3_600_000).toISOString();

  // Pull due subscriptions (auto-renew, healthy, charge in window).
  // We deliberately accept past_due because RBI requires notice on EVERY
  // attempted debit — including retries during the grace period.
  const { data: dueSubs, error: dueErr } = await supabaseAdmin
    .from('student_subscriptions')
    .select('id, student_id, plan_id, plan_code, billing_cycle, amount_paid, next_billing_at, razorpay_subscription_id')
    .eq('auto_renew', true)
    .in('status', ['active', 'past_due'])
    .gte('next_billing_at', lowerBound)
    .lt('next_billing_at', upperBound)
    .order('next_billing_at', { ascending: true })
    .limit(MAX_PER_RUN);

  if (dueErr) {
    logger.error('cron.pre-debit-notice.fetch_failed', { error: dueErr.message });
    return NextResponse.json({ success: false, error: 'fetch_failed', detail: dueErr.message }, { status: 500 });
  }

  const subs = (dueSubs ?? []) as DueSubscription[];
  if (subs.length === 0) {
    logger.info('cron.pre-debit-notice.no_due', { window_lower: lowerBound, window_upper: upperBound });
    return NextResponse.json({
      success: true,
      data: { sent: 0, skipped: 0, failed: 0, total: 0, duration_ms: Date.now() - startedMs },
    });
  }

  // Pull plan names + student email/phone in batches (avoid N+1).
  const planIds = [...new Set(subs.map((s) => s.plan_id).filter(Boolean))];
  const studentIds = [...new Set(subs.map((s) => s.student_id))];

  const [{ data: plans }, { data: students }] = await Promise.all([
    supabaseAdmin.from('subscription_plans').select('id, plan_code, name, price_monthly, price_yearly').in('id', planIds),
    supabaseAdmin.from('students').select('id, email, phone').in('id', studentIds),
  ]);

  const planMap = new Map((plans ?? []).map((p) => [p.id as string, p]));
  const studentMap = new Map((students ?? []).map((s) => [s.id as string, s]));

  // Pre-flight: skip subscriptions whose pre_debit_notice_sent already exists.
  // The Edge Function also checks this (defense in depth) but doing it here
  // saves an HTTP hop per duplicate.
  const candidateKeys = subs.map((s) => `pre_debit_${s.id}_${(s.next_billing_at ?? '').slice(0, 10)}`);
  const { data: alreadySent } = await supabaseAdmin
    .from('subscription_events')
    .select('metadata')
    .eq('event_type', 'pre_debit_notice_sent')
    .in('subscription_id', subs.map((s) => s.id));
  const sentKeys = new Set(
    (alreadySent ?? [])
      .map((r) => (r.metadata as { idempotency_key?: string } | null)?.idempotency_key)
      .filter((k): k is string => typeof k === 'string'),
  );
  void candidateKeys; // candidateKeys retained for future dedup-by-array optimisation

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const failures: { subscription_id: string; reason: string }[] = [];

  for (const sub of subs) {
    const idemKey = `pre_debit_${sub.id}_${(sub.next_billing_at ?? '').slice(0, 10)}`;
    if (sentKeys.has(idemKey)) { skipped += 1; continue; }

    const plan = planMap.get(sub.plan_id);
    const student = studentMap.get(sub.student_id);
    if (!student?.email) {
      // No email = cannot deliver = MUST NOT auto-charge per RBI. Log so ops sees.
      failed += 1;
      failures.push({ subscription_id: sub.id, reason: 'student_has_no_email' });
      logger.warn('cron.pre-debit-notice.no_email', { subscription_id: sub.id });
      continue;
    }

    const amountInr = sub.amount_paid && sub.amount_paid > 0
      ? Math.round(sub.amount_paid)
      : (sub.billing_cycle === 'yearly' ? (plan?.price_yearly ?? 0) : (plan?.price_monthly ?? 0));

    if (amountInr <= 0) {
      // Defensive — free plans should not have auto_renew=true, but guard anyway.
      skipped += 1;
      logger.warn('cron.pre-debit-notice.zero_amount', { subscription_id: sub.id, plan_code: sub.plan_code });
      continue;
    }

    const result = await invokeSendPreDebitNotice(supabaseUrl, cronSecret, {
      subscription_id: sub.id,
      student_id: sub.student_id,
      amount_inr: amountInr,
      charge_date_iso: sub.next_billing_at,
      plan_name: plan?.name ?? sub.plan_code,
      plan_code: sub.plan_code,
      billing_cycle: sub.billing_cycle,
      customer_email: student.email,
      customer_phone: student.phone ?? undefined,
      razorpay_subscription_id: sub.razorpay_subscription_id ?? undefined,
    });

    if (result.ok) {
      // Edge returns 200 for both fresh-send and already-sent; both count as success.
      const body = (result.body ?? {}) as { already_sent?: boolean };
      if (body.already_sent) skipped += 1; else sent += 1;
    } else {
      failed += 1;
      failures.push({
        subscription_id: sub.id,
        reason: result.error ?? `edge_${result.status}`,
      });
    }
  }

  const durationMs = Date.now() - startedMs;
  logger.info('cron.pre-debit-notice.completed', {
    total: subs.length,
    sent,
    skipped,
    failed,
    duration_ms: durationMs,
    window_lower: lowerBound,
    window_upper: upperBound,
  });

  if (subs.length >= MAX_PER_RUN) {
    logger.warn('cron.pre-debit-notice.batch_cap_hit', { cap: MAX_PER_RUN, window_lower: lowerBound, window_upper: upperBound });
  }

  return NextResponse.json({
    success: failed === 0,
    data: {
      total: subs.length,
      sent,
      skipped,
      failed,
      failures: failures.slice(0, 10), // cap to avoid huge response bodies
      duration_ms: durationMs,
    },
  });
}
