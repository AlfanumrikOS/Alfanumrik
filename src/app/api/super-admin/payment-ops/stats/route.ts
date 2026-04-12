import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/super-admin/payment-ops/stats
 *
 * Returns payment operations health metrics:
 * - stuckCount: number of captured payments not reflected in student plan
 * - failureCount24h: payment-related error/critical ops_events in last 24h
 * - activationTiming: median/p95/max seconds between payment capture and subscription activation
 */

/** Compute percentile from a sorted array of numbers. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    // Run all three queries in parallel
    const [stuckResult, failureResult, timingResult] = await Promise.all([
      // 1. Stuck count: captured payments where student plan doesn't match
      getStuckCount(),
      // 2. Failure count: payment-category error/critical events in last 24h
      getFailureCount24h(),
      // 3. Activation timing: delta between payment and subscription activation
      getActivationTiming(),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        stuckCount: stuckResult,
        failureCount24h: failureResult,
        activationTiming: timingResult,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

/** Count stuck payments (captured but student plan mismatched). */
async function getStuckCount(): Promise<number> {
  const { data: capturedPayments, error: phError } = await supabaseAdmin
    .from('payment_history')
    .select('student_id, plan_code')
    .eq('status', 'captured');

  if (phError || !capturedPayments || capturedPayments.length === 0) {
    return 0;
  }

  const studentIds = [...new Set(capturedPayments.map((p) => p.student_id))];
  const { data: students } = await supabaseAdmin
    .from('students')
    .select('id, subscription_plan')
    .in('id', studentIds);

  const studentMap = new Map((students || []).map((s) => [s.id, s]));

  return capturedPayments.filter((p) => {
    const student = studentMap.get(p.student_id);
    if (!student) return true;
    const currentPlan = student.subscription_plan;
    return !currentPlan || currentPlan === 'free' || currentPlan !== p.plan_code;
  }).length;
}

/** Count payment-related error/critical events in the last 24 hours. */
async function getFailureCount24h(): Promise<number> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabaseAdmin
    .from('ops_events')
    .select('id', { count: 'exact', head: true })
    .eq('category', 'payment')
    .in('severity', ['error', 'critical'])
    .gte('occurred_at', since24h);

  if (error) {
    console.warn('[payment-ops/stats] ops_events query failed:', error.message);
    return -1; // signal query failure
  }

  return count ?? 0;
}

/**
 * Compute activation timing statistics.
 *
 * For the last 20 captured payments, compares payment_history.created_at
 * with student_subscriptions.updated_at to measure activation delay.
 * Filters out outliers (> 1 hour) before computing statistics.
 */
async function getActivationTiming(): Promise<{
  median: number;
  p95: number;
  max: number;
  sampleSize: number;
}> {
  const defaultResult = { median: 0, p95: 0, max: 0, sampleSize: 0 };

  // Get last 20 captured payments
  const { data: recentPayments, error: phError } = await supabaseAdmin
    .from('payment_history')
    .select('student_id, created_at')
    .eq('status', 'captured')
    .order('created_at', { ascending: false })
    .limit(20);

  if (phError || !recentPayments || recentPayments.length === 0) {
    return defaultResult;
  }

  const studentIds = [...new Set(recentPayments.map((p) => p.student_id))];

  // Get the corresponding subscription records
  const { data: subscriptions, error: subError } = await supabaseAdmin
    .from('student_subscriptions')
    .select('student_id, updated_at')
    .in('student_id', studentIds);

  if (subError || !subscriptions || subscriptions.length === 0) {
    return defaultResult;
  }

  const subMap = new Map(subscriptions.map((s) => [s.student_id, s]));

  // Compute time deltas in seconds
  const deltas: number[] = [];
  for (const payment of recentPayments) {
    const sub = subMap.get(payment.student_id);
    if (!sub || !sub.updated_at) continue;

    const paymentTime = new Date(payment.created_at).getTime();
    const activationTime = new Date(sub.updated_at).getTime();
    const deltaSeconds = (activationTime - paymentTime) / 1000;

    // Only include non-negative deltas within 1 hour (filter outliers)
    if (deltaSeconds >= 0 && deltaSeconds <= 3600) {
      deltas.push(Math.round(deltaSeconds * 10) / 10); // round to 1 decimal
    }
  }

  if (deltas.length === 0) {
    return defaultResult;
  }

  // Sort for percentile calculations
  deltas.sort((a, b) => a - b);

  return {
    median: percentile(deltas, 50),
    p95: percentile(deltas, 95),
    max: deltas[deltas.length - 1],
    sampleSize: deltas.length,
  };
}