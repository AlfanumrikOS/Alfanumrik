import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { supabase as globalSupabase } from '@alfanumrik/lib/supabase-client';
import { createRazorpaySubscription, createRazorpayOrder } from '@alfanumrik/lib/razorpay';
import { logger } from '@alfanumrik/lib/logger';
import { paymentSubscribeSchema, validateBody } from '@alfanumrik/lib/validation';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { computeGst, gstToRazorpayNotes, supplierStateCode } from '@alfanumrik/lib/gst';
import { isFeatureEnabled, PAYMENT_FLAGS } from '@alfanumrik/lib/feature-flags';
import {
  resolveEffectiveEntitlement,
  isRedundantPurchase,
} from '@alfanumrik/lib/entitlements/effective-plan';

/**
 * Fail-CLOSED GST gate (Track A.3 launch-safety).
 *
 * Returns true ONLY when ff_gst_invoicing_v1 resolves explicitly enabled.
 * `isFeatureEnabled` already returns false for an absent/disabled/0%-rollout
 * flag and for a malformed flags payload; this wrapper additionally treats ANY
 * thrown error as OFF so an indeterminate flag state can NEVER charge GST.
 * Never over-charge on uncertainty; never let the gate fail the sale.
 */
async function gstChargingEnabled(): Promise<boolean> {
  try {
    return await isFeatureEnabled(PAYMENT_FLAGS.GST_INVOICING_V1);
  } catch {
    return false; // fail-closed to NO-GST
  }
}

/**
 * Subscribe Endpoint
 *
 * Creates a Razorpay Subscription (for monthly recurring) or
 * a Razorpay Order (for yearly one-time) based on billing_cycle.
 *
 * P11 fix (2026-04-14):
 * - For monthly: we now atomically write a pending payment_history row AND
 *   upsert student_subscriptions with the razorpay_subscription_id BEFORE
 *   returning to the client. This lets the webhook resolve the student later
 *   via notes.student_id OR student_subscriptions.razorpay_subscription_id.
 * - Razorpay notes now include student_id (canonical) in addition to user_id.
 * - plan_code is canonicalized so pending and active rows always agree.
 *
 * Client sends: { plan_code, billing_cycle }
 * Client NEVER sends amount.
 */

/** Strip billing-cycle suffix and map legacy aliases to canonical plan code.
 *  Keep in sync with the same helper in the webhook route. */
function canonicalizePlan(raw: string): string {
  return raw
    .replace(/_(monthly|yearly)$/, '')
    .replace(/^ultimate$/, 'unlimited')
    .replace(/^basic$/, 'starter')
    .replace(/^premium$/, 'pro');
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey || !serviceKey) {
      return NextResponse.json({ error: 'Payment system not configured' }, { status: 503 });
    }

    // Auth
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() { return request.cookies.getAll().map(c => ({ name: c.name, value: c.value })); },
        setAll() {},
      },
    });

    let user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        user = (await globalSupabase.auth.getUser(token)).data.user;
      }
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // PAY-1 / Gap 2 defense-in-depth (P9/P11): RBAC permission gate on top of
    // getUser(). `subscribe` is the LIVE order/subscription creator (its siblings
    // create-order + verify already carry this gate); add the same one here so a
    // non-student authenticated principal cannot reach the Razorpay creation path.
    // authorizeRequest() resolves identity from the SAME Bearer header / Supabase
    // session cookie sources used above; a legitimately logged-in student with the
    // 'payments.subscribe' grant passes, super_admin/admin bypass automatically.
    // This DENIES (403) BEFORE any Razorpay object is created and removes none of
    // the downstream checks. The getUser() block is retained — it supplies the
    // user.id / user.email metadata used below.
    const auth = await authorizeRequest(request, 'payments.subscribe');
    if (!auth.authorized) return auth.errorResponse!;

    const rawBody = await request.json();
    const validation = validateBody(paymentSubscribeSchema, rawBody);
    if (!validation.success) return validation.error;
    const { plan_code: rawPlan, billing_cycle } = validation.data;

    // Zod allows 'free' as a valid plan_code, but subscribing to free is not permitted
    if (rawPlan === 'free') {
      return NextResponse.json({ error: 'Cannot subscribe to the free plan' }, { status: 400 });
    }

    // Canonicalize plan_code BEFORE any DB write so pending & active rows match.
    const plan_code = canonicalizePlan(rawPlan);

    const admin = supabaseAdmin;

    // Look up plan from DB
    const { data: plan, error: planErr } = await admin
      .from('subscription_plans')
      .select('id, plan_code, name, price_monthly, price_yearly, razorpay_plan_id_monthly, is_active')
      .eq('plan_code', plan_code)
      .eq('is_active', true)
      .single();

    if (planErr || !plan) {
      return NextResponse.json({ error: 'Plan not available' }, { status: 400 });
    }

    // Check for existing active subscription to prevent duplicates
    const { data: studentRow } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', user.id)
      .single();

    // PAY-8 (P11): never mint a Razorpay subscription/order for a principal with no
    // billable student row. Resolve the student now (auth_user_id, then email
    // fallback — mirrors the verify route at verify/route.ts) and short-circuit with
    // a clean 409 BEFORE any Razorpay object is created if none resolves. This
    // produces NO Razorpay side effect and no orphan object. For a legitimate
    // student `resolvedStudentId === studentRow.id`, so behavior is unchanged.
    let resolvedStudentId: string | undefined = studentRow?.id;
    if (!resolvedStudentId && user.email) {
      const { data: byEmail } = await admin
        .from('students')
        .select('id')
        .eq('email', user.email)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      resolvedStudentId = byEmail?.id;
    }
    if (!resolvedStudentId) {
      return NextResponse.json({
        error: 'No student profile found for this account. Please complete onboarding before subscribing.',
      }, { status: 409 });
    }

    if (studentRow) {
      const { data: existingSub } = await admin
        .from('student_subscriptions')
        .select('id, status, razorpay_subscription_id, plan_code, billing_cycle')
        .eq('student_id', studentRow.id)
        .single();

      // If already on same plan+cycle with active recurring, return early
      if (existingSub?.status === 'active' &&
          existingSub.plan_code === plan_code &&
          existingSub.billing_cycle === billing_cycle &&
          existingSub.razorpay_subscription_id) {
        return NextResponse.json({
          error: 'You already have an active subscription to this plan',
        }, { status: 409 });
      }

      // ─── Track A.5: redundant-purchase guard (B2C ↔ B2B coexistence) ───
      // If the student is already covered by their SCHOOL's plan at a tier >=
      // the requested plan, this purchase adds NO entitlement → never charge.
      // Return a STRUCTURED 409 (NOT a hard 403/500) so the client renders
      // "covered by your school" and skips checkout. A request that EXCEEDS the
      // school tier is a genuine upgrade and falls through to checkout normally.
      // Students with no school (B2C-only) are never blocked here.
      try {
        const eff = await resolveEffectiveEntitlement(studentRow.id);
        const verdict = isRedundantPurchase(eff, plan_code);
        if (verdict.redundant) {
          return NextResponse.json({
            success: false,
            already_covered: true,
            covered_by_school: true,
            school_plan: verdict.schoolPlan,
            error: 'Your school already provides this plan or higher.',
          }, { status: 409 });
        }
      } catch (covErr) {
        // Fail-OPEN on a coverage-resolve error: never block a legitimate sale
        // because the coverage check was unavailable (the guard is an
        // anti-redundancy convenience, not a payment-integrity gate).
        logger.warn('subscribe: coverage guard skipped (resolve error)', {
          error: covErr instanceof Error ? covErr.message : String(covErr),
        });
      }
    }

    const razorpayKeyId = process.env.RAZORPAY_KEY_ID;

    // ─── Track A.3: per-state GST ───
    // The plan price is the TAXABLE (pre-GST) value. Compute the split via the
    // single compute_gst RPC. For the YEARLY one-time order we charge the
    // tax-inclusive total; for the MONTHLY recurring subscription the charge is
    // fixed by razorpay_plan_id_monthly, so we carry the GST breakdown in notes
    // for the webhook to reconcile (a tax-inclusive recurring plan is a separate
    // plan-provisioning change, tracked for finance go-live). place_of_supply is
    // optional at checkout; absent it, compute_gst treats the sale as IGST.
    const placeOfSupply =
      typeof (rawBody as { place_of_supply?: unknown })?.place_of_supply === 'string'
        ? ((rawBody as { place_of_supply: string }).place_of_supply.trim() || null)
        : null;
    const supplierState = supplierStateCode();
    const taxableForCycle =
      billing_cycle === 'yearly' ? plan.price_yearly : plan.price_monthly;

    // ─── Launch-safety gate (P11): GST charging is OFF until ff_gst_invoicing_v1 ───
    // When the flag is OFF (default) or its check errors, `gst` stays null and no
    // GST notes / GST-metadata notes ride on the Razorpay subscription or order —
    // byte-for-byte the pre-Track-A.3 behavior. The yearly order then charges the
    // bare taxable price (plan.price_yearly), and the monthly recurring charge is
    // unchanged (it was always fixed by razorpay_plan_id_monthly). Fail-closed to
    // NO-GST; never blocks the sale.
    const gstOn = await gstChargingEnabled();
    const gst = gstOn
      ? await computeGst(admin, taxableForCycle, placeOfSupply, '9992', supplierState)
      : null;
    const gstNotes = gst ? gstToRazorpayNotes(gst) : {};
    // GST-metadata notes (supplier_state_code, place_of_supply) are themselves a
    // Track A.3 addition; when the flag is OFF they must NOT ride on the
    // subscription/order so the Razorpay notes are byte-for-byte the pre-A.3 shape.
    const gstMetaNotes: Record<string, string> = gstOn
      ? { supplier_state_code: supplierState, place_of_supply: placeOfSupply ?? '' }
      : {};
    if (gstOn && !gst) {
      logger.warn('subscribe: compute_gst unavailable — proceeding without GST notes', {
        plan_code, billing_cycle,
      });
    }

    // ─── Monthly: Create Razorpay Subscription (recurring) ───
    if (billing_cycle === 'monthly') {
      if (!plan.razorpay_plan_id_monthly) {
        return NextResponse.json({
          error: 'Monthly recurring billing is being set up. Please try again shortly.',
        }, { status: 503 });
      }

      // 1. Create the Razorpay subscription first. We put BOTH student_id
      //    (resolved via the RPC below) and user_id in notes for belt-and-suspenders
      //    resolution in the webhook. student_id is canonical; user_id kept for
      //    backward compat with older webhook code paths.
      //
      //    student_id was already resolved above (auth_user_id → email fallback)
      //    and the PAY-8 guard guarantees it is present, so notes.student_id is
      //    always a real student id here.
      const subscription = await createRazorpaySubscription({
        razorpayPlanId: plan.razorpay_plan_id_monthly,
        totalBillingCycles: 12,
        customerNotify: false,
        notes: {
          // Canonical resolution key — read by webhook first.
          student_id: resolvedStudentId,
          // Legacy keys (still read as fallbacks).
          user_id: user.id,
          plan_code,
          billing_cycle: 'monthly',
          // Track A.3 (flag-gated): GST breakdown for webhook reconciliation
          // (codes + money only, no PII). supplier/place carried so the split is
          // reproducible. Both spreads are empty when ff_gst_invoicing_v1 is OFF.
          ...gstMetaNotes,
          ...gstNotes,
        },
      });

      // 2. Atomically write pending payment_history + upsert student_subscriptions
      //    with razorpay_subscription_id persisted. If this fails, DO NOT return
      //    200 — client will retry and we'll create a fresh Razorpay sub + row.
      //    The orphan Razorpay sub will be cleaned up by reconcile_stuck_subscriptions.
      const { error: rpcErr } = await admin.rpc('create_pending_subscription', {
        p_auth_user_id: user.id,
        p_email: user.email ?? '',
        p_plan_code: plan_code,
        p_billing_cycle: 'monthly',
        p_razorpay_subscription_id: subscription.id,
        p_razorpay_plan_id: plan.razorpay_plan_id_monthly,
        p_amount_inr: plan.price_monthly,
      });

      if (rpcErr) {
        logger.error('subscribe: create_pending_subscription RPC failed', {
          error: rpcErr.message,
          razorpay_subscription_id: subscription.id,
        });
        await logOpsEvent({
          category: 'payment',
          severity: 'error',
          source: 'subscribe/route.ts',
          message: 'create_pending_subscription RPC failed',
          context: {
            rz_sub_id: subscription.id,
            plan_code,
            billing_cycle: 'monthly',
            error: rpcErr.message,
          },
        });
        return NextResponse.json({
          error: 'Subscription creation failed. Your card has not been charged. Please try again.',
        }, { status: 503 });
      }

      return NextResponse.json({
        success: true,
        data: {
          type: 'subscription',
          subscription_id: subscription.id,
          key: razorpayKeyId,
          plan_code,
          billing_cycle: 'monthly',
          price_inr: plan.price_monthly,
        },
      });
    }

    // ─── Yearly: Create Razorpay Order (one-time) ────────────
    // Yearly path is unchanged: verify route writes the payment_history row
    // after Razorpay signature verification succeeds.
    // Charge the TAX-INCLUSIVE total for the yearly one-time order. If the GST
    // RPC was unavailable, fall back to the bare taxable price (sale not blocked).
    const yearlyChargeInr = gst ? Number(gst.total_payable) : plan.price_yearly;
    const order = await createRazorpayOrder({
      amountInr: yearlyChargeInr,
      receipt: `${user.id.substring(0, 8)}_${plan_code}_${Date.now().toString(36)}`,
      notes: {
        student_id: resolvedStudentId,
        user_id: user.id,
        plan_code,
        billing_cycle: 'yearly',
        // Track A.3 (flag-gated): empty spreads when ff_gst_invoicing_v1 is OFF,
        // so the order notes are byte-for-byte the pre-A.3 shape.
        ...gstMetaNotes,
        ...gstNotes,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        type: 'order',
        order_id: order.id,
        amount: order.amount, // paisa — tax-inclusive; required by Razorpay checkout widget
        price_inr: plan.price_yearly,        // pre-GST taxable price (display)
        total_payable_inr: yearlyChargeInr,  // tax-inclusive amount actually charged
        currency: order.currency,
        key: razorpayKeyId,
        plan_code,
        billing_cycle: 'yearly',
      },
    });
  } catch (err) {
    logger.error('Subscribe error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Payment initialization failed' }, { status: 500 });
  }
}
