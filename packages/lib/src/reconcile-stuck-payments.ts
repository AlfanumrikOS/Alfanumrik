/**
 * ALFANUMRIK — Stuck-payment reconciliation (P11 payment integrity)
 *
 * Single source of truth for "payment_history shows status='captured' but
 * students.subscription_plan doesn't match plan_code" detection + repair.
 * DO NOT duplicate this logic anywhere — import from here.
 *
 * Extracted 2026-09-02 (P1-5 launch audit) from three independently-drifted
 * copies: apps/host/src/app/api/cron/reconcile-payments/route.ts (had the
 * safe filter), apps/host/src/app/api/super-admin/payment-ops/reconcile/
 * route.ts (did NOT — unbounded, two raw non-atomic writes instead of the
 * activation RPC), and .../payment-ops/stuck/route.ts (a third, separately
 * unbounded copy used only to preview). The super-admin tool could resurrect
 * a cancelled subscription or silently downgrade a student who had since
 * upgraded, because comparing EVERY historical captured payment against the
 * student's CURRENT plan flags any older, already-superseded payment as
 * "stuck" the moment a newer one changes the plan.
 *
 * This module closes that with a guard the cron version didn't have either
 * (it was only accidentally safe there, masked by a 2h recency window that
 * a human-triggered admin tool cannot rely on): `isLatestCapturedPayment`
 * — a captured payment is only eligible if it is that student's MOST
 * RECENT captured payment, full stop, independent of any time window. The
 * pre-existing terminal-state guard (don't resurrect a payment superseded
 * by a later cancellation/expiry/halt) is preserved unconditionally too.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface StuckPayment {
  id: string;
  student_id: string;
  plan_code: string;
  billing_cycle: string;
  razorpay_payment_id: string;
  razorpay_order_id: string | null;
  amount: number | null;
  created_at: string;
}

const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['cancelled', 'expired', 'halted', 'completed']);

export interface FindStuckPaymentsOptions {
  /** Only consider payments captured within this many ms of now. Omit for no bound (a human reviewing a specific case). */
  recencyWindowMs?: number;
  /** Cap on candidate rows pulled before filtering (not the final result size). */
  fetchLimit?: number;
}

/**
 * Finds captured payments whose plan does not match the student's current
 * plan AND is that student's most recent captured payment AND was not
 * superseded by a later terminal subscription-lifecycle event. Every
 * caller (cron, admin tool, admin preview) MUST use this — a private copy
 * of the filter is exactly the bug this module exists to close.
 */
export async function findStuckPayments(
  admin: SupabaseClient,
  opts: FindStuckPaymentsOptions = {},
): Promise<StuckPayment[]> {
  const { recencyWindowMs, fetchLimit = 500 } = opts;

  // Build all filters BEFORE order()/limit() — some callers' query-builder
  // mocks (and defensively, this keeps the real client's builder shape
  // conventional too) treat limit() as the terminal, Promise-resolving call;
  // appending a filter after it broke against one such mock in this repo's
  // test suite.
  let query = admin
    .from('payment_history')
    .select('id, student_id, plan_code, billing_cycle, razorpay_payment_id, razorpay_order_id, amount, created_at')
    .eq('status', 'captured')
    .is('reconciled_at', null);

  if (recencyWindowMs !== undefined) {
    query = query.gte('created_at', new Date(Date.now() - recencyWindowMs).toISOString());
  }

  query = query.order('created_at', { ascending: false }).limit(fetchLimit);

  const { data: candidates, error: phError } = await query;
  if (phError || !candidates || candidates.length === 0) return [];

  const studentIds = [...new Set(candidates.map((p) => p.student_id))];

  const [{ data: students }, { data: subs }, { data: allCaptured }] = await Promise.all([
    admin.from('students').select('id, subscription_plan').in('id', studentIds),
    admin.from('student_subscriptions').select('student_id, status, cancelled_at, ended_at').in('student_id', studentIds),
    // Latest-payment guard needs each student's TRUE most recent captured
    // payment, not just the recency-windowed candidate set — an older
    // candidate must lose to a newer captured payment even if that newer
    // one falls outside recencyWindowMs (or is itself already reconciled).
    admin
      .from('payment_history')
      .select('student_id, created_at')
      .eq('status', 'captured')
      .in('student_id', studentIds)
      .order('created_at', { ascending: false }),
  ]);

  const studentMap = new Map((students || []).map((s) => [s.id, s]));
  const subMap = new Map((subs || []).map((s) => [s.student_id, s]));

  const latestCapturedAtByStudent = new Map<string, string>();
  for (const row of allCaptured || []) {
    if (!latestCapturedAtByStudent.has(row.student_id)) {
      latestCapturedAtByStudent.set(row.student_id, row.created_at); // first hit wins: query is DESC
    }
  }

  return candidates.filter((p): p is StuckPayment => {
    // Superseded by a newer captured payment for the same student (upgrade,
    // renewal, or plan change) — never "fix" an old payment back over a
    // legitimate later one.
    const latestForStudent = latestCapturedAtByStudent.get(p.student_id);
    if (latestForStudent && latestForStudent !== p.created_at) return false;

    const student = studentMap.get(p.student_id);
    if (!student) return true; // student row missing entirely — genuinely stuck, reconcile handles it
    const currentPlan = student.subscription_plan;
    const looksStuck = !currentPlan || currentPlan === 'free' || currentPlan !== p.plan_code;
    if (!looksStuck) return false;

    // Terminal-state guard: a later cancellation/expiry/halt/completion is
    // an intentional lifecycle change, not a lost activation — never
    // resurrect it.
    const sub = subMap.get(p.student_id);
    if (sub && TERMINAL_SUBSCRIPTION_STATUSES.has(sub.status)) {
      const terminalAt = sub.ended_at || sub.cancelled_at;
      if (terminalAt && new Date(terminalAt).getTime() > new Date(p.created_at).getTime()) return false;
      if (!terminalAt) return false; // terminal but undated — conservative skip
    }

    return true;
  });
}

export interface ReconcileResult {
  studentId: string;
  ok: boolean;
  error?: string;
}

/**
 * Activates a single stuck payment via the SAME atomic, per-student-locked
 * RPC the Razorpay webhook uses (single transaction across students +
 * student_subscriptions, ON CONFLICT-safe, cannot interleave with a
 * concurrent webhook activation for the same student) — never raw
 * independent UPDATE/UPSERT calls, which is how the split-brain this
 * mechanism exists to repair could itself be created if the second write
 * failed after the first succeeded. Stamps `reconciled_at` so this exact
 * payment_history row is permanently excluded from future scans by ANY
 * caller.
 *
 * No ops_event/audit logging here — callers log with their own source
 * (cron vs. admin tool) and, for the admin tool, the acting admin's audit
 * trail.
 */
export async function reconcileStuckPayment(
  admin: SupabaseClient,
  payment: StuckPayment,
): Promise<ReconcileResult> {
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

  const { error: markErr } = await admin
    .from('payment_history')
    .update({ reconciled_at: new Date().toISOString() })
    .eq('id', payment.id);
  if (markErr) {
    // Activation already succeeded — a failure to stamp is non-blocking but
    // means this row can be re-scanned; the RPC itself is idempotent
    // (ON CONFLICT (student_id)) so a re-run is harmless, just redundant.
    return { studentId: payment.student_id, ok: true, error: `reconciled_at stamp failed (non-blocking): ${markErr.message}` };
  }

  return { studentId: payment.student_id, ok: true };
}
