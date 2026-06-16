import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { schoolAdminPermissionCode } from '@/lib/school-admin/permission-code';
import { capture } from '@/lib/posthog/server';
import { logSchoolAudit } from '@/lib/audit';
import { isDemoSchool } from '@/lib/demo/is-demo-school';
import {
  createRazorpaySubscription,
  cancelRazorpaySubscription,
  updateRazorpaySubscriptionQuantity,
} from '@/lib/razorpay';

const SELF_SERVICE_FLAG = 'ff_school_self_service_billing_v1';

const VALID_PAID_PLANS = new Set(['starter', 'pro', 'unlimited']);
const MIN_SEATS = 1;
const MAX_SEATS = 5_000; // generous cap; refuses obvious nonsense

type SchoolBillingCycle = 'monthly' | 'quarterly' | 'yearly';

interface PostBody {
  plan?: string;
  billing_cycle?: SchoolBillingCycle;
  seats?: number;
}

/**
 * Compute a comp entitlement's period-end from a start instant and cycle.
 * monthly → +1 month, quarterly → +3 months. (Yearly never reaches the comp
 * path — POST still rejects yearly for self-service.)
 */
function compPeriodEnd(start: Date, cycle: SchoolBillingCycle): string {
  const end = new Date(start);
  const months = cycle === 'quarterly' ? 3 : 1;
  end.setMonth(end.getMonth() + months);
  return end.toISOString();
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
  razorpay_plan_id_quarterly: string | null;
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
    .select('plan_code, razorpay_plan_id, razorpay_plan_id_monthly, razorpay_plan_id_quarterly, price_monthly')
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
    if (billingCycle !== 'monthly' && billingCycle !== 'quarterly' && billingCycle !== 'yearly') {
      return NextResponse.json({ success: false, error: 'Invalid billing_cycle' }, { status: 400 });
    }
    // FIX 6.3 (HIGH): Self-service v1 supports monthly recurring subscriptions
    // only. A 'yearly' plan must be a one-time Razorpay Order (total_count=1),
    // but the webhook's school branch only matches recurring
    // subscription.activated/charged events — a yearly subscription created
    // here would never be activated, leaving the school stuck on 'trial' with a
    // live Razorpay sub it can't reconcile. Reject cleanly until the Order path
    // ships.
    // TODO(backend, follow-up): implement the yearly self-service path via a
    // one-time Razorpay Order + payment.captured webhook handling, mirroring the
    // student yearly flow. Until then annual plans are sales-assisted only.
    if (billingCycle === 'yearly') {
      return NextResponse.json(
        {
          success: false,
          error: 'yearly_not_supported',
          code: 'yearly_not_supported',
          // Bilingual-safe note: annual plans go through sales, not self-service.
          message:
            'Annual (yearly) plans are not available via self-service yet. Please contact our sales team to set up an annual plan. वार्षिक प्लान अभी सेल्फ-सर्विस में उपलब्ध नहीं है; कृपया वार्षिक प्लान के लिए हमारी सेल्स टीम से संपर्क करें।',
        },
        { status: 400 },
      );
    }
    if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS) {
      return NextResponse.json({ success: false, error: 'Invalid seats count' }, { status: 400 });
    }

    const planRow = await fetchPlanRow(plan);
    if (!planRow) {
      return NextResponse.json({ success: false, error: 'Plan not found or inactive' }, { status: 400 });
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

    // ── DEMO COMP PATH (P11 sanctioned exception — strictly server-gated) ──
    // BEFORE any Razorpay coordination: if this is a DEMO school
    // (schools.is_demo = true, resolved from the server-side auth.schoolId — NEVER
    // request body), grant a complimentary 'active' entitlement and skip Razorpay
    // entirely. The predicate's only input is the authenticated school id, so a
    // real school can never reach this branch even by forging a body field. On
    // any error isDemoSchool() fails closed (returns false) → the real,
    // payment-gated Razorpay path below runs instead.
    if (await isDemoSchool(schoolId)) {
      const supabaseDemo = getSupabaseAdmin();
      const now = new Date();
      const periodEnd = compPeriodEnd(now, billingCycle);

      // In-place update by school_id → idempotent (re-running just re-stamps the
      // same row). No Razorpay sub id (comp = no charge). status='active' is the
      // sanctioned comp grant.
      const compFields = {
        plan,
        billing_cycle: billingCycle,
        seats_purchased: seats,
        price_per_seat_monthly: planRow.price_monthly,
        status: 'active' as const,
        is_demo: true,
        razorpay_subscription_id: null,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd,
        updated_at: now.toISOString(),
      };

      const { data: compStamped, error: compStampErr } = await supabaseDemo
        .from('school_subscriptions')
        .update(compFields)
        .eq('school_id', schoolId)
        .select('id')
        .maybeSingle();

      if (compStampErr) {
        logger.error('school_admin_comp_stamp_failed', {
          error: new Error(compStampErr.message),
          route: '/api/school-admin/subscription',
          schoolId,
        });
        return NextResponse.json(
          { success: false, error: 'Failed to grant comp entitlement.' },
          { status: 500 },
        );
      }

      // Defensive insert if no provisioned row exists (data drift).
      if (!compStamped) {
        const { error: compInsertErr } = await supabaseDemo
          .from('school_subscriptions')
          .insert({ school_id: schoolId, ...compFields });
        if (compInsertErr) {
          logger.error('school_admin_comp_insert_failed', {
            error: new Error(compInsertErr.message),
            route: '/api/school-admin/subscription',
            schoolId,
          });
          return NextResponse.json(
            { success: false, error: 'Failed to grant comp entitlement.' },
            { status: 500 },
          );
        }
      }

      await capture('school_billing_plan_change_completed', userId, {
        school_id: schoolId,
        plan,
        billing_cycle: billingCycle,
        seats,
        source: 'self_service_post_comp',
        from_plan: null,
        from_seats: null,
        razorpay_subscription_id: '',
      });

      // Metadata-only audit (no PII) — comp grant is a security-relevant event.
      void logSchoolAudit({
        schoolId,
        actorId: userId,
        action: 'subscription.comp_granted',
        resourceType: 'school_subscription',
        metadata: {
          plan,
          seats,
          billing_cycle: billingCycle,
          period_end: periodEnd,
          is_demo: true,
          razorpay_subscription_id: null,
        },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      });

      return NextResponse.json({
        success: true,
        comp: true,
        data: {
          plan,
          billing_cycle: billingCycle,
          seats,
          status: 'active',
          current_period_end: periodEnd,
          is_demo: true,
          razorpay_subscription_id: null,
        },
      });
    }

    // ── P11 plan-ID selection + NULL-GUARD (REAL path only) ──
    // Reached ONLY by non-demo schools (the demo comp branch above returns
    // first and never touches Razorpay). Select the Razorpay plan id strictly
    // by the requested cycle. We NEVER fall back from one cycle's id to
    // another: a quarterly request that fell back to the monthly plan id would
    // charge monthly while the DB records quarterly — a split-brain billing
    // state (P11). So each cycle is guarded independently and, when its id is
    // missing, we 400 with a distinct code.
    let razorpayPlanId: string | null;
    if (billingCycle === 'monthly') {
      razorpayPlanId = planRow.razorpay_plan_id_monthly;
    } else {
      // billingCycle === 'quarterly' (yearly already rejected above)
      razorpayPlanId = planRow.razorpay_plan_id_quarterly;
    }
    if (!razorpayPlanId) {
      // Mirror the monthly null-guard; explicit code so the operator knows the
      // quarterly plan still needs provisioning via /api/payments/setup-plans.
      return NextResponse.json(
        {
          success: false,
          error: 'plan_not_provisioned',
          code: 'plan_not_provisioned',
          message:
            billingCycle === 'quarterly'
              ? 'This plan is not provisioned for quarterly billing yet. Please contact support. यह प्लान अभी तिमाही बिलिंग के लिए सेट नहीं है; कृपया सपोर्ट से संपर्क करें।'
              : 'Plan is not provisioned with Razorpay yet.',
        },
        { status: 400 },
      );
    }

    let rzpSub: Awaited<ReturnType<typeof createRazorpaySubscription>>;
    try {
      rzpSub = await createRazorpaySubscription({
        razorpayPlanId,
        totalBillingCycles: billingCycle === 'monthly' ? 12 : 4,
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

    // FIX 6.1 (P11) + 6.2 (runtime): Stamp the EXISTING provisioned row
    // (every school gets a status='trial' school_subscriptions row at
    // provisioning — school-provisioning.ts). We do NOT upsert with
    // onConflict:'school_id' — there is no unique constraint on school_id
    // (only the pkey on id), so that path raised 42P10 and failed 100% of the
    // time, orphaning the just-created Razorpay subscription.
    //
    // We also do NOT set status:'active' here. Granting plan access before a
    // signature-verified payment violates P11. The row keeps its pre-payment
    // 'trial' status; the signature-verified webhook
    // (handleSchoolSubscriptionEvent) flips it to 'active' on
    // subscription.activated/charged. The webhook matches the school via
    // notes.school_id (stamped on the Razorpay sub below) and then looks the
    // row up by .eq('school_id', schoolId) — so stamping THIS row by school_id
    // is exactly what the webhook will find and activate.
    const stampFields = {
      plan,
      billing_cycle: billingCycle,
      seats_purchased: seats,
      price_per_seat_monthly: planRow.price_monthly,
      // status intentionally left as the pre-payment 'trial' — webhook activates.
      razorpay_subscription_id: rzpSub.id,
      updated_at: new Date().toISOString(),
    };

    // Update the existing provisioned row in place.
    const { data: stamped, error: stampError } = await supabase
      .from('school_subscriptions')
      .update(stampFields)
      .eq('school_id', schoolId)
      .select('id')
      .maybeSingle();

    if (stampError) {
      logger.error('school_admin_subscription_stamp_failed', {
        error: new Error(stampError.message),
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

    // Defensive: if no provisioned row exists (data drift — provisioning
    // skipped the insert), create one WITHOUT the bad onConflict, still in the
    // pre-payment 'trial' state. The webhook keys on school_id, so this row is
    // matchable just like the provisioned one.
    if (!stamped) {
      const { error: insertError } = await supabase
        .from('school_subscriptions')
        .insert({
          school_id: schoolId,
          status: 'trial', // pre-payment; webhook flips to 'active'
          ...stampFields,
        });
      if (insertError) {
        logger.error('school_admin_subscription_insert_failed', {
          error: new Error(insertError.message),
          route: '/api/school-admin/subscription',
          schoolId,
          razorpaySubscriptionId: rzpSub.id,
        });
        return NextResponse.json(
          { success: false, error: 'Subscription created in Razorpay but DB write failed; reconciliation will run.' },
          { status: 500 },
        );
      }
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
          billing_cycle: (existing.billing_cycle as 'monthly' | 'quarterly' | 'yearly') ?? 'monthly',
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
    const billingCycle = (existing.billing_cycle as 'monthly' | 'quarterly' | 'yearly') ?? 'monthly';
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

    // ── DEMO COMP PATH (P11 sanctioned exception — server-gated) ──
    // BEFORE any Razorpay coordination: a demo school's comp entitlement carries
    // no Razorpay subscription (razorpay_subscription_id = null), so there is
    // nothing to coordinate. The DB change already landed atomically via the RPC
    // above. We branch on the SERVER-resolved auth.schoolId (never request body),
    // so a real school can never reach this branch. Fails closed → real path runs.
    if (await isDemoSchool(schoolId)) {
      await capture('school_billing_plan_change_completed', userId, {
        school_id: schoolId,
        plan: newPlan ?? fromPlan ?? 'unknown',
        billing_cycle: billingCycle,
        seats: newSeats ?? fromSeats ?? 0,
        source: 'self_service_patch_comp',
        from_plan: fromPlan,
        from_seats: fromSeats,
        razorpay_subscription_id: '',
      });

      void logSchoolAudit({
        schoolId,
        actorId: userId,
        action: 'subscription.comp_granted',
        resourceType: 'school_subscription',
        resourceId: (existing.id as string) ?? undefined,
        metadata: {
          plan: newPlan ?? fromPlan,
          seats: newSeats ?? fromSeats,
          billing_cycle: billingCycle,
          is_demo: true,
          razorpay_subscription_id: null,
          path: 'patch',
        },
        ipAddress: request.headers.get('x-forwarded-for') ?? undefined,
      });

      return NextResponse.json({
        success: true,
        comp: true,
        data: {
          plan: newPlan ?? fromPlan,
          seats: newSeats ?? fromSeats,
          billing_cycle: billingCycle,
          is_demo: true,
          razorpay_subscription_id: null,
        },
      });
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
        billing_cycle: (existing.billing_cycle as 'monthly' | 'quarterly' | 'yearly') ?? 'monthly',
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
