import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { getGuardianByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { listChildrenForGuardian } from '@alfanumrik/lib/domains/relationship';
import { logger } from '@alfanumrik/lib/logger';

/**
 * GET /api/parent/billing — billing surface for a parent (Phase C.4).
 *
 * Returns:
 *   {
 *     children: ChildBilling[],          // each linked child with their subscription
 *     payment_history: PaymentInvoice[], // up to 12 most-recent invoices across all linked children
 *     summary: {                         // roll-up across all children
 *       total_active_subscriptions: number,
 *       total_monthly_spend_inr: number,
 *       any_in_grace: boolean,
 *       any_cancel_scheduled: boolean,
 *     },
 *   }
 *
 * Permission: 'child.view_progress' — parents may only see billing tied to
 * their own linked children. Ownership is enforced by `listChildrenForGuardian`,
 * which filters by guardian_id resolved from auth.userId. A parent cannot
 * query another parent's billing because (a) they only see their own
 * guardian record, and (b) we only return invoices keyed to student_ids
 * from that guardian's links — never raw subscription rows by id.
 *
 * Schema note: alfanumrik bills *per-student*, not per-parent. There is no
 * "family plan" row today — each linked child has their own
 * student_subscriptions record. The parent surface aggregates across children.
 * If a future PR introduces a true parent-level plan, this endpoint will
 * grow a `parent_subscription` field alongside `children[]`; the contract
 * here keeps that door open without forcing a migration.
 */
export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'child.view_progress');
    if (!auth.authorized) return auth.errorResponse!;

    // ── Resolve guardian (parent) record from auth.userId ──
    const guardianResult = await getGuardianByAuthUserId(auth.userId!);
    if (!guardianResult.ok || !guardianResult.data) {
      return NextResponse.json(
        { success: false, error: 'No parent profile found' },
        { status: 403 }
      );
    }
    const guardian = guardianResult.data;

    // ── List children linked to this guardian (ownership-scoped) ──
    const childrenResult = await listChildrenForGuardian(auth.userId!);
    if (!childrenResult.ok) {
      return NextResponse.json(
        { success: false, error: 'Failed to load children' },
        { status: 500 }
      );
    }
    const children = childrenResult.data;

    // ── Zero-state: free-tier parent with no linked children ──
    // We still return 200 with empty arrays so the page renders the
    // "Link a child to manage their subscription" empty state instead
    // of erroring out.
    if (children.length === 0) {
      logAudit(auth.userId!, {
        action: 'view',
        resourceType: 'parent_billing',
        resourceId: guardian.id,
        details: { children_linked: 0 },
      });
      return NextResponse.json({
        success: true,
        data: {
          children: [],
          payment_history: [],
          summary: {
            total_active_subscriptions: 0,
            total_monthly_spend_inr: 0,
            any_in_grace: false,
            any_cancel_scheduled: false,
          },
        },
      });
    }

    const studentIds = children.map((c) => c.studentId);

    // ── Row shapes (typed locally; Supabase's generic-select inference
    //    is too loose to carry these through the rest of the function). ─
    type SubRow = {
      id: string;
      student_id: string;
      plan_code: string | null;
      status: string | null;
      billing_cycle: string | null;
      auto_renew: boolean | null;
      current_period_start: string | null;
      current_period_end: string | null;
      next_billing_at: string | null;
      grace_period_end: string | null;
      cancelled_at: string | null;
      cancel_reason: string | null;
      amount_paid: number | null;
      razorpay_subscription_id: string | null;
    };
    type PlanRow = {
      plan_code: string;
      name: string | null;
      price_monthly: number | null;
      price_yearly: number | null;
    };
    type PaymentRow = {
      id: string;
      student_id: string;
      amount: number | null;
      currency: string | null;
      status: string | null;
      plan_code: string | null;
      billing_cycle: string | null;
      razorpay_payment_id: string | null;
      razorpay_order_id: string | null;
      created_at: string | null;
    };

    // ── Fetch all subscriptions for these students in one round-trip ──
    const subsResult = await supabaseAdmin
      .from('student_subscriptions')
      .select(
        'id, student_id, plan_code, status, billing_cycle, auto_renew, ' +
          'current_period_start, current_period_end, next_billing_at, ' +
          'grace_period_end, cancelled_at, cancel_reason, amount_paid, ' +
          'razorpay_subscription_id'
      )
      .in('student_id', studentIds);

    if (subsResult.error) {
      logger.error('parent_billing_subs_fetch_failed', {
        error: new Error(subsResult.error.message),
        guardianId: guardian.id,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load subscriptions' },
        { status: 500 }
      );
    }
    const subscriptionRows = (subsResult.data ?? []) as unknown as SubRow[];

    // ── Fetch all active plan rows referenced by these subs in one trip ──
    const planCodes = Array.from(
      new Set(subscriptionRows.map((s) => s.plan_code).filter((c): c is string => !!c))
    );
    let plansByCode: Record<string, { name: string; price_monthly: number; price_yearly: number }> = {};
    if (planCodes.length > 0) {
      const planResult = await supabaseAdmin
        .from('subscription_plans')
        .select('plan_code, name, price_monthly, price_yearly')
        .in('plan_code', planCodes);

      if (planResult.error) {
        logger.warn('parent_billing_plans_fetch_failed', {
          error: planResult.error.message,
          guardianId: guardian.id,
        });
      } else {
        const planRows = (planResult.data ?? []) as unknown as PlanRow[];
        plansByCode = Object.fromEntries(
          planRows.map((p) => [
            p.plan_code,
            {
              name: p.name ?? p.plan_code,
              price_monthly: p.price_monthly ?? 0,
              price_yearly: p.price_yearly ?? 0,
            },
          ])
        );
      }
    }

    // ── Compose per-child billing rows ──
    const subsByStudentId = new Map<string, SubRow>();
    for (const s of subscriptionRows) {
      subsByStudentId.set(s.student_id, s);
    }

    let totalActive = 0;
    let totalMonthlySpend = 0;
    let anyInGrace = false;
    let anyCancelScheduled = false;

    const childrenBilling = children.map((child) => {
      const sub = subsByStudentId.get(child.studentId);

      if (!sub || sub.plan_code === 'free' || !sub.plan_code) {
        return {
          student_id: child.studentId,
          student_name: child.name,
          grade: child.grade,
          plan_code: 'free',
          plan_name: 'Explorer',
          status: 'active',
          billing_cycle: null,
          auto_renew: false,
          current_period_end: null,
          next_billing_at: null,
          price_inr: 0,
          is_in_grace: false,
          is_cancel_scheduled: false,
          razorpay_subscription_id: null,
        };
      }

      const plan = plansByCode[sub.plan_code];
      const isInGrace =
        sub.status === 'past_due' &&
        sub.grace_period_end != null &&
        new Date() < new Date(sub.grace_period_end as string);

      // A "cancel-scheduled" sub is active+cancelled_at set. Pending subs
      // may have stale cancelled_at from a previous generation — ignore.
      const isCancelScheduled = sub.status === 'active' && sub.cancelled_at != null;
      const isPending = sub.status === 'pending';

      const priceInr =
        sub.billing_cycle === 'yearly'
          ? (plan?.price_yearly ?? 0)
          : (plan?.price_monthly ?? 0);

      if (sub.status === 'active' && sub.plan_code !== 'free') {
        totalActive += 1;
        if (sub.billing_cycle === 'yearly') {
          totalMonthlySpend += Math.round(priceInr / 12);
        } else {
          totalMonthlySpend += priceInr;
        }
      }
      if (isInGrace) anyInGrace = true;
      if (isCancelScheduled) anyCancelScheduled = true;

      return {
        student_id: child.studentId,
        student_name: child.name,
        grade: child.grade,
        plan_code: sub.plan_code,
        plan_name: plan?.name ?? sub.plan_code,
        status: sub.status,
        billing_cycle: sub.billing_cycle,
        auto_renew: sub.auto_renew ?? false,
        current_period_end: isPending ? null : sub.current_period_end,
        next_billing_at: isPending ? null : sub.next_billing_at,
        price_inr: priceInr,
        is_in_grace: isInGrace,
        is_cancel_scheduled: isCancelScheduled,
        razorpay_subscription_id: sub.razorpay_subscription_id ?? null,
      };
    });

    // ── Payment history (last 12 invoices across all children) ──
    const payResult = await supabaseAdmin
      .from('payment_history')
      .select(
        'id, student_id, amount, currency, status, plan_code, billing_cycle, ' +
          'razorpay_payment_id, razorpay_order_id, created_at'
      )
      .in('student_id', studentIds)
      .order('created_at', { ascending: false })
      .limit(12);

    if (payResult.error) {
      logger.warn('parent_billing_payments_fetch_failed', {
        error: payResult.error.message,
        guardianId: guardian.id,
      });
    }
    const paymentRows = (payResult.data ?? []) as unknown as PaymentRow[];

    const childNameById = new Map(children.map((c) => [c.studentId, c.name]));
    const paymentHistory = paymentRows.map((p) => ({
      id: p.id,
      student_id: p.student_id,
      student_name: childNameById.get(p.student_id) ?? null,
      amount_inr: p.amount,
      currency: p.currency ?? 'INR',
      status: p.status,
      plan_code: p.plan_code,
      billing_cycle: p.billing_cycle,
      razorpay_payment_id: p.razorpay_payment_id,
      razorpay_order_id: p.razorpay_order_id,
      created_at: p.created_at,
    }));

    logAudit(auth.userId!, {
      action: 'view',
      resourceType: 'parent_billing',
      resourceId: guardian.id,
      details: {
        children_linked: children.length,
        active_subs: totalActive,
        invoices_returned: paymentHistory.length,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        children: childrenBilling,
        payment_history: paymentHistory,
        summary: {
          total_active_subscriptions: totalActive,
          total_monthly_spend_inr: totalMonthlySpend,
          any_in_grace: anyInGrace,
          any_cancel_scheduled: anyCancelScheduled,
        },
      },
    });
  } catch (err) {
    logger.error('parent_billing_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/parent/billing',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
