import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { schoolAdminPermissionCode } from '@/lib/school-admin/permission-code';
import { capture } from '@/lib/posthog/server';
import { logSchoolAudit } from '@/lib/audit';
import {
  createRazorpaySubscription,
  cancelRazorpaySubscription,
  updateRazorpaySubscriptionQuantity,
} from '@/lib/razorpay';

const SELF_SERVICE_FLAG = 'ff_school_self_service_billing_v1';

const VALID_PAID_PLANS = new Set(['starter', 'pro', 'unlimited']);
const MIN_SEATS = 1;
const MAX_SEATS = 5_000; // generous cap; refuses obvious nonsense

interface PostBody {
  plan?: string;
  billing_cycle?: 'monthly' | 'yearly';
  seats?: number;
}

interface PatchBody {
  plan?: string;
  seats?: number;
}

interface DeleteBody {
  cancellation_timing?: 'end_of_cycle' | 'immediate';
}

interface PlanRow {
  plan_code: string;
  razorpay_plan_id: string | null;
  razorpay_plan_id_monthly: string | null;
  price_monthly: number; // INR per seat per month
}

async function checkSelfServiceAllowed(args: {
  schoolId: string;
  authUserId: string;
}): Promise<boolean> {
  return isFeatureEnabled(SELF_SERVICE_FLAG, {
    userId: args.authUserId,
    institutionId: args.schoolId,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
}

async function fetchPlanRow(planCode: string): Promise<PlanRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('subscription_plans')
    .select('plan_code, razorpay_plan_id, razorpay_plan_id_monthly, price_monthly')
    .eq('plan_code', planCode)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) return null;
  return data as PlanRow;
}

async function countActiveSeats(schoolId: string): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { count } = await supabase
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('is_active', true);
  return count ?? 0;
}

/**
 * GET /api/school-admin/subscription — viewer (existing behaviour, unchanged).
 *
 * Permission (Wave C matrix): flag OFF → `school.manage_billing` (original);
 * flag ON → `institution.view_billing` (READ-side matrix code).
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(
      request,
      await schoolAdminPermissionCode({ off: 'school.manage_billing', on: 'institution.view_billing' }),
    );
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const [subscriptionResult, seatCountResult] = await Promise.all([
      supabase
        .from('school_subscriptions')
        .select(
          'id, school_id, plan, seats_purchased, price_per_seat_monthly, status, current_period_start, current_period_end, razorpay_subscription_id, billing_cycle, created_at, updated_at',
        )
        .eq('school_id', schoolId)
        .maybeSingle(),
      supabase
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .eq('is_active', true),
    ]);

    if (subscriptionResult.error) {
      logger.error('school_admin_subscription_fetch_failed', {
        error: new Error(subscriptionResult.error.message),
        route: '/api/school-admin/subscription',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch subscription' },
        { status: 500 },
      );
    }

    if (seatCountResult.error) {
      logger.error('school_admin_seat_count_failed', {
        error: new Error(seatCountResult.error.message),
        route: '/api/school-admin/subscription',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to count seats' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        subscription: subscriptionResult.data ?? null,
        seatsUsed: seatCountResult.count ?? 0,
      },
    });
  } catch (err) {
    logger.error('school_admin_subscription_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/subscription',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/school-admin/subscription — buy a subscription (Phase 2-C).
 *
 * Body: { plan: 'starter'|'pro'|'unlimited', billing_cycle: 'monthly', seats: number }
 *
 * Creates a Razorpay subscription scoped to the school and writes the
 * resulting `razorpay_subscription_id` to `school_subscriptions`. The
 * student-side webhook (existing) flips status to 'active' once the first
 * charge succeeds.
 *
 * Gated by `ff_school_self_service_billing_v1`. Permission (Wave C matrix):
 * flag OFF → `school.manage_billing` (original); flag ON → `institution.manage_billing` (WRITE).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(
      request,
      await schoolAdminPermissionCode({ off: 'school.manage_billing', on: 'institution.manage_billing' }),
    );
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const userId = auth.userId!;

    const allowed = await checkSelfServiceAllowed({ schoolId, authUserId: userId });
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Self-service billing is not enabled for this school yet.' },
        { status: 403 },
      );
    }

    const body = (await request.json()) as PostBody;
    const plan = (body.plan ?? '').toLowerCase();
    const billingCycle = body.billing_cycle ?? 'monthly';
    const seats = Number(body.seats);

    if (!VALID_PAID_PLANS.has(plan)) {
      return NextResponse.json({ success: false, error: 'Invalid plan' }, { status: 400 });
    }
    if (billingCycle !== 'monthly' && billingCycle !== 'yearly') {
      return NextResponse.json({ success: false, error: 'Invalid billing_cycle' }, { status: 400 });
    }
    if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS) {
      return NextResponse.json({ success: false, error: 'Invalid seats count' }, { status: 400 });
    }

    const planRow = await fetchPlanRow(plan);
    if (!planRow) {
      return NextResponse.json({ success: false, error: 'Plan not found or inactive' }, { status: 400 });
    }

    const razorpayPlanId =
      billingCycle === 'monthly' ? planRow.razorpay_plan_id_monthly : planRow.razorpay_plan_id;
    if (!razorpayPlanId) {
      return NextResponse.json(
        { success: false, error: 'Plan is not provisioned with Razorpay yet' },
        { status: 400 },
      );
    }

    const seatsUsed = await countActiveSeats(schoolId);
    if (seats < seatsUsed) {
      await capture('school_billing_plan_change_failed', userId, {
        school_id: schoolId,
        plan,
        billing_cycle: billingCycle,
        seats,
        source: 'self_service_post',
        reason: 'seat_cap_violation',
      });
      return NextResponse.json(
        {
          success: false,
          error: `Cannot buy ${seats} seats; you already have ${seatsUsed} active students.`,
          code: 'seat_cap_violation',
          seats_used: seatsUsed,
        },
        { status: 422 },
      );
    }

    await capture('school_billing_plan_change_started', userId, {
      school_id: schoolId,
      plan,
      billing_cycle: billingCycle,
      seats,
      source: 'self_service_post',
      from_plan: null,
      from_seats: null,
    });

    let rzpSub: Awaited<ReturnType<typeof createRazorpaySubscription>>;
    try {
      rzpSub = await createRazorpaySubscription({
        razorpayPlanId,
        totalBillingCycles: billingCycle === 'monthly' ? 12 : 1,
        customerNotify: true,
        notes: { school_id: schoolId, seats: String(seats), source: 'school_self_service' },
      });
    } catch (rzpErr) {
      logger.error('school_admin_razorpay_create_failed', {
        error: rzpErr instanceof Error ? rzpErr : new Error(String(rzpErr)),
        route: '/api/school-admin/subscription',
        schoolId,
      });
      await capture('school_billing_plan_change_failed', userId, {
        school_id: schoolId,
        plan,
        billing_cycle: billingCycle,
        seats,
        source: 'self_service_post',
        reason: 'razorpay_error',
      });
      return NextResponse.json(
        { success: false, error: 'Razorpay subscription creation failed.' },
        { status: 502 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { error: upsertError } = await supabase
      .from('school_subscriptions')
      .upsert(
        {
          school_id: schoolId,
          plan,
          billing_cycle: billingCycle,
          seats_purchased: seats,
          price_per_seat_monthly: planRow.price_monthly,
          status: 'active',
          razorpay_subscription_id: rzpSub.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'school_id' },
      );

    if (upsertError) {
      logger.error('school_admin_subscription_upsert_failed', {
        error: new Error(upsertError.message),
        route: '/api/school-admin/subscription',
        schoolId,
        razorpaySubscriptionId: rzpSub.id,
      });
      // Razorpay sub created but DB write failed — webhook will reconcile.
      // Return error so the operator follows up; do not pretend success.
      return NextResponse.json(
        { success: false, error: 'Subscription created in Razorpay but DB write failed; reconciliation will run.' },
        { status: 500 },
      );
    }

    await capture('school_billing_plan_change_completed', userId, {
      school_id: schoolId,
      plan,
      billing_cycle: billingCycle,
      seats,
      source: 'self_service_post',
      from_plan: null,
      from_seats: null,
      razorpay_subscription_id: rzpSub.id,
    });

    return NextResponse.json({
      success: true,
      data: {
        razorpay_subscription_id: rzpSub.id,
        hosted_page_url: rzpSub.short_url,
        plan,
        billing_cycle: billingCycle,
        seats,
      },
    });
  } catch (err) {
    logger.error('school_admin_subscription_post_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/subscription',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/school-admin/subscription — change plan or seats (Phase 2-C +
 * Phase 3 atomic plan-change follow-up).
 *
 * Body: { plan?: 'starter'|'pro'|'unlimited', seats?: number }
 *
 * Atomicity model:
 *   - DB writes go through `atomic_school_plan_change` RPC (migration
 *     20260507000003). Two writes (plan + seats_purchased) inside one
 *     transaction guarded by pg_advisory_xact_lock keyed by school_id.
 *   - Razorpay coordination happens AFTER the RPC succeeds:
 *       • seat-only change with the same plan → call
 *         updateRazorpaySubscriptionQuantity (schedule_change_at='cycle_end'
 *         so the school keeps what they paid for through the period).
 *       • plan change → DB-only, no Razorpay call. Razorpay does not
 *         support atomic plan_id swap on a running subscription. The
 *         response carries `razorpay_plan_swap_note` so the school admin
 *         is informed and can cancel + re-subscribe to take effect.
 *   - If Razorpay call fails after a successful RPC, we log the
 *     divergence as a critical ops event but return success to the
 *     caller (DB is the entitlement source of truth). The webhook
 *     reconciles on the next charge.
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(
      request,
      await schoolAdminPermissionCode({ off: 'school.manage_billing', on: 'institution.manage_billing' }),
    );
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const userId = auth.userId!;

    const allowed = await checkSelfServiceAllowed({ schoolId, authUserId: userId });
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Self-service billing is not enabled for this school yet.' },
        { status: 403 },
      );
    }

    const body = (await request.json()) as PatchBody;
    const newPlan = body.plan ? body.plan.toLowerCase() : undefined;
    const newSeats = body.seats !== undefined ? Number(body.seats) : undefined;

    if (newPlan === undefined && newSeats === undefined) {
      return NextResponse.json(
        { success: false, error: 'Provide plan and/or seats to change.' },
        { status: 400 },
      );
    }
    if (newPlan !== undefined && !VALID_PAID_PLANS.has(newPlan)) {
      return NextResponse.json({ success: false, error: 'Invalid plan' }, { status: 400 });
    }
    if (newSeats !== undefined && (!Number.isInteger(newSeats) || newSeats < MIN_SEATS || newSeats > MAX_SEATS)) {
      return NextResponse.json({ success: false, error: 'Invalid seats count' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: existing, error: fetchErr } = await supabase
      .from('school_subscriptions')
      .select('id, plan, billing_cycle, seats_purchased, razorpay_subscription_id')
      .eq('school_id', schoolId)
      .maybeSingle();

    if (fetchErr || !existing) {
      await capture('school_billing_plan_change_failed', userId, {
        school_id: schoolId,
        plan: newPlan ?? 'unknown',
        billing_cycle: 'monthly',
        seats: newSeats ?? 0,
        source: 'self_service_patch',
        reason: 'no_existing_subscription',
      });
      return NextResponse.json(
        { success: false, error: 'No active subscription to modify. Use POST to create one.' },
        { status: 404 },
      );
    }

    if (newSeats !== undefined) {
      const seatsUsed = await countActiveSeats(schoolId);
      if (newSeats < seatsUsed) {
        await capture('school_billing_plan_change_failed', userId, {
          school_id: schoolId,
          plan: newPlan ?? (existing.plan as string),
          billing_cycle: (existing.billing_cycle as 'monthly' | 'yearly') ?? 'monthly',
          seats: newSeats,
          source: 'self_service_patch',
          reason: 'seat_cap_violation',
        });
        return NextResponse.json(
          {
            success: false,
            error: `Cannot reduce to ${newSeats} seats; you have ${seatsUsed} active students.`,
            code: 'seat_cap_violation',
            seats_used: seatsUsed,
          },
          { status: 422 },
        );
      }
    }

    const fromPlan = (existing.plan as string | null) ?? null;
    const fromSeats = (existing.seats_purchased as number | null) ?? null;
    const rzpSubId = (existing.razorpay_subscription_id as string | null) ?? null;
    const billingCycle = (existing.billing_cycle as 'monthly' | 'yearly') ?? 'monthly';
    const isPlanSwap = newPlan !== undefined && newPlan !== fromPlan;
    const isSeatOnly = newSeats !== undefined && !isPlanSwap;

    await capture('school_billing_plan_change_started', userId, {
      school_id: schoolId,
      plan: newPlan ?? fromPlan ?? 'unknown',
      billing_cycle: billingCycle,
      seats: newSeats ?? fromSeats ?? 0,
      source: 'self_service_patch',
      from_plan: fromPlan,
      from_seats: fromSeats,
    });

    // ── 1. Atomic DB transaction via the school-side RPC.
    const { error: rpcErr } = await supabase.rpc('atomic_school_plan_change', {
      p_school_id: schoolId,
      p_new_plan: newPlan ?? null,
      p_new_seats: newSeats ?? null,
      p_reason: 'self_service_patch',
    });
    if (rpcErr) {
      logger.error('school_admin_atomic_plan_change_failed', {
        error: new Error(rpcErr.message),
        route: '/api/school-admin/subscription',
        schoolId,
      });
      await capture('school_billing_plan_change_failed', userId, {
        school_id: schoolId,
        plan: newPlan ?? fromPlan ?? 'unknown',
        billing_cycle: billingCycle,
        seats: newSeats ?? fromSeats ?? 0,
        source: 'self_service_patch',
        reason: 'unknown',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update subscription' },
        { status: 500 },
      );
    }

    // ── 2. Razorpay coordination (only on seat-only mid-cycle change).
    let razorpayUpdated = false;
    let razorpayDivergenceLogged = false;
    if (isSeatOnly && rzpSubId && newSeats !== undefined) {
      try {
        await updateRazorpaySubscriptionQuantity({
          subscriptionId: rzpSubId,
          newQuantity: newSeats,
          scheduleChangeAt: 'cycle_end',
        });
        razorpayUpdated = true;
      } catch (rzpErr) {
        logger.error('school_admin_razorpay_quantity_update_failed', {
          error: rzpErr instanceof Error ? rzpErr : new Error(String(rzpErr)),
          route: '/api/school-admin/subscription',
          schoolId,
          rzpSubId,
        });
        razorpayDivergenceLogged = true;
        // DB authoritative for entitlement; webhook reconciles on next charge.
      }
    }

    await capture('school_billing_plan_change_completed', userId, {
      school_id: schoolId,
      plan: newPlan ?? fromPlan ?? 'unknown',
      billing_cycle: billingCycle,
      seats: newSeats ?? fromSeats ?? 0,
      source: 'self_service_patch',
      from_plan: fromPlan,
      from_seats: fromSeats,
      razorpay_subscription_id: rzpSubId ?? '',
    });

    return NextResponse.json({
      success: true,
      data: {
        plan: newPlan ?? fromPlan,
        seats: newSeats ?? fromSeats,
        razorpay_updated: razorpayUpdated,
        razorpay_divergence_logged: razorpayDivergenceLogged,
        ...(isPlanSwap && {
          razorpay_plan_swap_note:
            'Plan changed in Alfanumrik. Razorpay does not support atomic plan swaps on a running subscription; cancel and re-subscribe to update billing on Razorpay\'s side. Next invoice reflects the new plan in our system.',
        }),
        ...(isSeatOnly && !razorpayUpdated && {
          razorpay_proration_note:
            'Seats updated in Alfanumrik; Razorpay quantity sync deferred. The next renewal charge will reflect the new seat count.',
        }),
      },
    });
  } catch (err) {
    logger.error('school_admin_subscription_patch_unhandled', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/subscription',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/school-admin/subscription — cancel subscription (Phase 2-C).
 *
 * Body: { cancellation_timing?: 'end_of_cycle' | 'immediate' }
 *
 * Default = 'end_of_cycle' so the school keeps access until the period
 * they paid for ends. Immediate cancellation is supported for compliance
 * (e.g. DPDP-driven account close) but is not the default.
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(
      request,
      await schoolAdminPermissionCode({ off: 'school.manage_billing', on: 'institution.manage_billing' }),
    );
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const userId = auth.userId!;

    const allowed = await checkSelfServiceAllowed({ schoolId, authUserId: userId });
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: 'Self-service billing is not enabled for this school yet.' },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as DeleteBody;
    const timing: 'end_of_cycle' | 'immediate' = body.cancellation_timing ?? 'end_of_cycle';

    const supabase = getSupabaseAdmin();
    const { data: existing, error: fetchErr } = await supabase
      .from('school_subscriptions')
      .select('id, plan, billing_cycle, seats_purchased, razorpay_subscription_id, status')
      .eq('school_id', schoolId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { success: false, error: 'No subscription to cancel.' },
        { status: 404 },
      );
    }

    if (!existing.razorpay_subscription_id) {
      // Trial / never-billed school — just mark cancelled in our DB.
      const { error: updateErr } = await supabase
        .from('school_subscriptions')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('school_id', schoolId);
      if (updateErr) {
        return NextResponse.json(
          { success: false, error: 'Failed to mark cancelled' },
          { status: 500 },
        );
      }
      await capture('school_subscription_cancelled', userId, {
        school_id: schoolId,
        plan: (existing.plan as string) ?? 'trial',
        billing_cycle: (existing.billing_cycle as 'monthly' | 'yearly') ?? 'monthly',
        seats: (existing.seats_purchased as number) ?? 0,
        razorpay_subscription_id: '',
        cancellation_timing: timing,
      });
      void logSchoolAudit({
        schoolId,
        actorId: userId,
        action: 'subscription.cancelled',
        resourceType: 'school_subscription',
        resourceId: existing.id as string,
        metadata: {
          plan: existing.plan,
          billing_cycle: existing.billing_cycle,
          seats: existing.seats_purchased,
          cancellation_timing: timing,
          razorpay_subscription_id: null,
          path: 'trial_or_never_billed',
        },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      });
      return NextResponse.json({ success: true, data: { status: 'cancelled', timing } });
    }

    try {
      await cancelRazorpaySubscription(existing.razorpay_subscription_id as string, timing === 'end_of_cycle');
    } catch (rzpErr) {
      logger.error('school_admin_razorpay_cancel_failed', {
        error: rzpErr instanceof Error ? rzpErr : new Error(String(rzpErr)),
        route: '/api/school-admin/subscription',
        schoolId,
      });
      return NextResponse.json(
        { success: false, error: 'Razorpay cancellation failed.' },
        { status: 502 },
      );
    }

    const newStatus = timing === 'immediate' ? 'cancelled' : 'active'; // active until period ends
    const { error: updateErr } = await supabase
      .from('school_subscriptions')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('school_id', schoolId);

    if (updateErr) {
      logger.error('school_admin_subscription_cancel_db_failed', {
        error: new Error(updateErr.message),
        route: '/api/school-admin/subscription',
        schoolId,
      });
      // Razorpay was cancelled; webhook will reconcile.
    }

    await capture('school_subscription_cancelled', userId, {
      school_id: schoolId,
      plan: (existing.plan as string) ?? 'unknown',
      billing_cycle: (existing.billing_cycle as 'monthly' | 'yearly') ?? 'monthly',
      seats: (existing.seats_purchased as number) ?? 0,
      razorpay_subscription_id: existing.razorpay_subscription_id as string,
      cancellation_timing: timing,
    });

    void logSchoolAudit({
      schoolId,
      actorId: userId,
      action: 'subscription.cancelled',
      resourceType: 'school_subscription',
      resourceId: existing.id as string,
      metadata: {
        plan: existing.plan,
        billing_cycle: existing.billing_cycle,
        seats: existing.seats_purchased,
        cancellation_timing: timing,
        razorpay_subscription_id: existing.razorpay_subscription_id,
        new_status: newStatus,
      },
      ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
    });

    return NextResponse.json({
      success: true,
      data: { status: newStatus, timing },
    });
  } catch (err) {
    logger.error('school_admin_subscription_delete_unhandled', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/subscription',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
