import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeRequest } from '@/lib/rbac';
import { cancelRazorpaySubscription } from '@/lib/razorpay';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';
import { paymentCancelSchema, validateBody } from '@/lib/validation';
import { listChildrenForGuardian } from '@/lib/domains/relationship';

/**
 * Cancel Subscription Endpoint (P11)
 *
 * Cancels auto-renew. For end-of-cycle cancels, access continues until
 * current_period_end. For immediate cancels, downgrades to free.
 *
 * P11 invariants enforced here:
 *   1. SPLIT-BRAIN GUARD — both immediate and scheduled paths route through
 *      the `atomic_cancel_subscription` RPC. The RPC updates both
 *      student_subscriptions and students inside ONE transaction with a
 *      row-level lock, so a partial-write split-brain (status=cancelled but
 *      subscription_plan='pro') is impossible. Replaces the prior
 *      two-statement UPDATE pair (lines ~88-103 of the original file).
 *
 *   2. RAZORPAY FAILURE GUARD — if Razorpay's cancel API fails (network
 *      blip, 5xx, etc.), we DO NOT proceed with the local downgrade.
 *      Razorpay would otherwise keep auto-charging the user while our DB
 *      shows them as cancelled. Instead we:
 *        a. Log the failure to subscription_events with type
 *           'failed_razorpay_cancel' and the error payload.
 *        b. Enqueue a retry task in task_queue (queue='razorpay_cancel_retry').
 *        c. Return HTTP 502 so the client knows the cancellation failed
 *           at the payment provider; subscription remains active.
 *
 *   3. WEBHOOK CONTENTION — the RPC takes SELECT ... FOR UPDATE on the
 *      subscription row, serializing us against any concurrent
 *      `subscription.cancelled` webhook (which goes through
 *      atomic_downgrade_subscription, also using FOR UPDATE on the same row).
 *      Idempotency: the RPC returns 'already_terminal' if the sub is
 *      already cancelled/expired/halted, so a webhook-then-API race lands
 *      a clean no-op instead of a double-write.
 */
export async function POST(request: NextRequest) {
  try {
    // RBAC: enforce authentication + role gate. Cancel is available to
    // students (own subscription) and parents/guardians (child's subscription).
    // We resolve identity here; downstream ownership checks enforce the
    // student-ownership or guardian-child relationship.
    const auth = await authorizeRequest(request);
    if (!auth.authorized) return auth.errorResponse!;
    const ALLOWED_ROLES: string[] = ['student', 'parent'];
    if (!auth.roles.some(r => ALLOWED_ROLES.includes(r))) {
      return NextResponse.json({ error: 'Forbidden', code: 'ROLE_NOT_ALLOWED' }, { status: 403 });
    }
    // authorizeRequest guarantees userId is non-null when authorized === true,
    // but guard defensively in case of future refactors.
    if (!auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.json();
    const validation = validateBody(paymentCancelSchema, rawBody);
    if (!validation.success) return validation.error;
    const { immediate = false, reason = null } = validation.data;

    // Optional body.student_id lets a verified guardian cancel a child's
    // subscription. Ownership is enforced via listChildrenForGuardian before
    // any DB write touches that student. UUID format is validated by Zod.
    const requestedStudentId = validation.data.student_id ?? null;

    const admin = supabaseAdmin;

    // Resolve which student's subscription we're cancelling.
    //   Self-cancel (student is the caller)  → look up students.auth_user_id = auth.userId
    //   Guardian-cancel (parent on behalf)   → body.student_id MUST be in the
    //     caller's linked-children set (listChildrenForGuardian). Cross-guardian
    //     attempts get the same 404 as "not your child" — no enumeration.
    let resolvedStudentId: string | null = null;

    if (requestedStudentId) {
      const childrenRes = await listChildrenForGuardian(auth.userId!);
      if (childrenRes.ok) {
        // ChildSummary.studentId — see src/lib/domains/types.ts:647-657
        const matches = childrenRes.data.some(
          (c) => c.studentId === requestedStudentId,
        );
        if (matches) {
          resolvedStudentId = requestedStudentId;
        }
      }
    } else {
      const { data: selfStudentRow } = await admin
        .from('students')
        .select('id')
        .eq('auth_user_id', auth.userId!)
        .single();
      if (selfStudentRow) {
        resolvedStudentId = selfStudentRow.id as string;
      }
    }

    if (!resolvedStudentId) {
      return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    }
    const studentRow: { id: string } = { id: resolvedStudentId };

    const { data: sub } = await admin
      .from('student_subscriptions')
      .select('id, status, plan_code, razorpay_subscription_id, current_period_end, auto_renew')
      .eq('student_id', studentRow.id)
      .single();

    if (!sub || sub.status === 'cancelled' || sub.status === 'expired' || sub.status === 'halted' || sub.plan_code === 'free') {
      return NextResponse.json({ success: false, error: 'No active subscription to cancel' }, { status: 400 });
    }

    // ── Razorpay-side cancel FIRST. If this fails, we MUST NOT downgrade
    //    the local DB — otherwise Razorpay keeps auto-charging the user
    //    while our DB shows them as cancelled.
    if (sub.razorpay_subscription_id) {
      try {
        await cancelRazorpaySubscription(sub.razorpay_subscription_id, !immediate);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Razorpay cancel failed — NOT downgrading locally', {
          error: err instanceof Error ? err : new Error(errorMessage),
          studentId: studentRow.id,
          subscriptionId: sub.id,
        });

        // 1. Persist a forensic audit row so support/ops can reconcile.
        await admin.from('subscription_events').insert({
          student_id: studentRow.id,
          subscription_id: sub.id,
          event_type: 'failed_razorpay_cancel',
          plan_code: sub.plan_code,
          status_before: sub.status,
          status_after: sub.status,
          razorpay_subscription_id: sub.razorpay_subscription_id,
          metadata: {
            error: errorMessage,
            immediate,
            reason,
            attempted_at: new Date().toISOString(),
          },
        });

        // 2. Enqueue a retry on the existing task_queue. Cancellation is
        //    idempotent at Razorpay's end (cancelling an already-cancelled
        //    subscription returns the cancelled state), so retries are safe.
        await admin.from('task_queue').insert({
          queue_name: 'razorpay_cancel_retry',
          payload: {
            student_id: studentRow.id,
            subscription_id: sub.id,
            razorpay_subscription_id: sub.razorpay_subscription_id,
            cancel_at_cycle_end: !immediate,
            reason,
            original_error: errorMessage,
          },
          max_attempts: 5,
        });

        // 3. Surface to ops dashboards.
        await logOpsEvent({
          category: 'payment',
          severity: 'critical',
          source: 'cancel/route.ts',
          subjectType: 'student',
          subjectId: studentRow.id,
          message: 'razorpay_cancel_api_failed',
          context: {
            razorpay_subscription_id: sub.razorpay_subscription_id,
            plan_code: sub.plan_code,
            immediate,
            error: errorMessage,
          },
        });

        // 4. 502 Bad Gateway — the upstream payment provider failed. Do
        //    NOT proceed with local downgrade. Subscription stays active.
        return NextResponse.json({
          success: false,
          error: 'Cancellation failed at payment provider; we will retry. Your subscription remains active.',
          status: 'razorpay_cancel_pending_retry',
        }, { status: 502 });
      }
    }

    // ── Atomic local cancel via RPC. Single transaction, FOR UPDATE row
    //    lock. Returns the outcome so we can shape the response without
    //    a second read.
    const { data: rpcResult, error: rpcError } = await admin.rpc('atomic_cancel_subscription', {
      p_student_id: studentRow.id,
      p_immediate: immediate,
      p_reason: reason,
    });

    if (rpcError) {
      logger.error('atomic_cancel_subscription RPC failed', {
        error: new Error(rpcError.message),
        studentId: studentRow.id,
        subscriptionId: sub.id,
      });

      // Razorpay cancel already succeeded. The DB write failed. This is a
      // P11 reconciliation case — flag for ops, return 503 so the client
      // can retry; the next retry will idempotently no-op at Razorpay
      // (already cancelled) and try the DB write again.
      await logOpsEvent({
        category: 'payment',
        severity: 'critical',
        source: 'cancel/route.ts',
        subjectType: 'student',
        subjectId: studentRow.id,
        message: 'cancel_db_write_failed_after_razorpay_succeeded',
        context: {
          razorpay_subscription_id: sub.razorpay_subscription_id,
          plan_code: sub.plan_code,
          immediate,
          rpc_error: rpcError.message,
        },
      });

      return NextResponse.json({
        success: false,
        error: 'Cancellation succeeded at payment provider but our records are catching up. Please refresh in a moment.',
        status: 'reconciliation_required',
      }, { status: 503 });
    }

    // RPC returns `[{ outcome, plan_code_before, status_before }]`
    const outcome = Array.isArray(rpcResult) && rpcResult.length > 0
      ? (rpcResult[0] as { outcome: string }).outcome
      : 'unknown';

    // Audit-trail event — non-blocking.
    await admin.from('subscription_events').insert({
      student_id: studentRow.id,
      subscription_id: sub.id,
      event_type: immediate ? 'cancelled_immediately' : 'cancel_scheduled',
      plan_code: sub.plan_code,
      status_before: sub.status,
      status_after: immediate ? 'cancelled' : sub.status,
      razorpay_subscription_id: sub.razorpay_subscription_id,
      metadata: { reason, outcome, access_until: sub.current_period_end },
    });

    if (immediate) {
      return NextResponse.json({
        success: true,
        status: 'cancelled',
        message: 'Subscription cancelled. You have been downgraded to the free plan.',
      });
    }

    return NextResponse.json({
      success: true,
      status: 'cancel_scheduled',
      access_until: sub.current_period_end,
      message: `Auto-renewal cancelled. You'll keep access until ${new Date(sub.current_period_end).toLocaleDateString('en-IN')}.`,
    });
  } catch (err) {
    logger.error('Cancel error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Cancellation failed' }, { status: 500 });
  }
}
