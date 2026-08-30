import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { supabase as globalSupabase } from '@alfanumrik/lib/supabase-client';
import crypto from 'crypto';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { paymentVerifySchema, validateBody } from '@alfanumrik/lib/validation';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { computeGst, gstSubscriptionColumns, supplierStateCode } from '@alfanumrik/lib/gst';
import { isFeatureEnabled, PAYMENT_FLAGS } from '@alfanumrik/lib/feature-flags';
import { getRazorpayOrder, getRazorpaySubscription } from '@alfanumrik/lib/razorpay';
import { checkApiRateLimit } from '@alfanumrik/lib/api-rate-limit';

/** Strip billing-cycle suffix and map legacy aliases to canonical plan code.
 *  Keep in sync with the same helper in subscribe/route.ts and webhook/route.ts. */
function canonicalizePlan(raw: string): string {
  return raw
    .replace(/_(monthly|yearly)$/, '')
    .replace(/^ultimate$/, 'unlimited')
    .replace(/^basic$/, 'starter')
    .replace(/^premium$/, 'pro');
}

/**
 * Fail-CLOSED GST gate (Track A.3 launch-safety).
 *
 * Returns true ONLY when ff_gst_invoicing_v1 resolves explicitly enabled.
 * `isFeatureEnabled` already returns false for an absent/disabled/0%-rollout
 * flag and for a malformed flags payload; this wrapper additionally treats ANY
 * thrown error as OFF so an indeterminate flag state can NEVER stamp GST columns.
 * Never act on uncertainty; the gate is post-entitlement and never affects the sale.
 */
async function gstChargingEnabled(): Promise<boolean> {
  try {
    return await isFeatureEnabled(PAYMENT_FLAGS.GST_INVOICING_V1);
  } catch {
    return false; // fail-closed to NO-GST
  }
}

/**
 * Payment Verification Route
 *
 * Called by the client after Razorpay checkout succeeds.
 * 1. Verifies HMAC signature (proves payment is genuine)
 * 2. Records payment in payment_history (idempotent)
 * 3. Activates subscription via RPC (idempotent)
 * 4. Returns success ONLY if entitlement is actually granted
 *
 * NEVER returns success:true if subscription activation failed.
 */

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey || !serviceKey) {
      logger.error('verify: MISSING ENV VARS', { hasServiceKey: !!serviceKey, hasUrl: !!supabaseUrl });
      return NextResponse.json({ error: 'Payment system not configured. Please contact support.' }, { status: 503 });
    }

    // RBAC permission gate (P11): authorize first, then get user for metadata.
    const auth = await authorizeRequest(request, 'payments.subscribe');
    if (!auth.authorized) return auth.errorResponse!;

    // Anti-abuse: cap verify-spam per authenticated user (retry storms against
    // the Razorpay API). Higher than create-order/subscribe since a legitimate
    // checkout can retry verification a few times on transient failure.
    const rateCheck = await checkApiRateLimit(`payments:${auth.userId}`, 20, 60 * 60 * 1000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.max(0, rateCheck.resetAt - Math.ceil(Date.now() / 1000))),
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }

    // Get user email for Razorpay metadata (auth.userId already available).
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

    const rawBody = await request.json();
    const validation = validateBody(paymentVerifySchema, rawBody);
    if (!validation.success) return validation.error;
    const {
      razorpay_order_id, razorpay_payment_id, razorpay_signature,
      razorpay_subscription_id,
      // C1 (P11 CRITICAL): these are CLIENT-SUPPLIED and are used ONLY for
      // pre-fetch logging / the kill-switch context below. They MUST NOT be
      // used to grant entitlement — the HMAC signature only proves
      // order_id|payment_id (or subscription_id|payment_id) pairing, not
      // which plan was actually paid for. The authoritative plan_code /
      // billing_cycle are re-derived below from Razorpay's own server-set
      // order/subscription `notes` (see clientPlanCode / clientBillingCycle
      // usage — renamed defensively so no code path below can accidentally
      // read the client body as the source of truth).
      plan_code: clientPlanCode, billing_cycle: clientBillingCycle, type,
      place_of_supply,
    } = validation.data;
    // Reassigned below to the AUTHORITATIVE value read back from Razorpay's
    // own notes. Declared here (not const) so the rest of this route can
    // keep using the familiar `plan_code` / `billing_cycle` names.
    let plan_code: string = clientPlanCode;
    let billing_cycle: string = clientBillingCycle;

    // Verify Razorpay HMAC signature
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!razorpaySecret) {
      logger.error('verify: MISSING RAZORPAY_KEY_SECRET env var');
      return NextResponse.json({ error: 'Payment system not configured. Please contact support.' }, { status: 503 });
    }

    // Subscription verification: HMAC of subscription_id|payment_id
    // Order verification: HMAC of order_id|payment_id
    const signaturePayload = type === 'subscription'
      ? `${razorpay_subscription_id}|${razorpay_payment_id}`
      : `${razorpay_order_id}|${razorpay_payment_id}`;

    const expectedSignature = crypto
      .createHmac('sha256', razorpaySecret)
      .update(signaturePayload)
      .digest('hex');

    // Use timing-safe comparison to prevent timing attacks on signature verification
    const sigBuffer = Buffer.from(razorpay_signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return NextResponse.json({ error: 'Invalid payment signature' }, { status: 401 });
    }

    // Use Supabase admin client (service_role) for all DB operations
    const admin = supabaseAdmin;

    // ── Global kill switch (razorpay_payments) ──
    // Seeded by 20260425160000_p0_launch_kill_switches_and_expiry_rpc.sql
    // with default true. Flip OFF during a payment incident — we 503 here
    // BEFORE any DB write so the client retries (the verify route is called
    // by checkout.js after Razorpay redirects back). The student keeps
    // their captured payment; the webhook will reconcile when the switch
    // is flipped back on, OR the /api/cron/reconcile-payments cron picks it
    // up within 30 minutes.
    //
    // Read fails OPEN (treated as enabled) — a Supabase blip should never
    // become a payment-verify outage.
    let killSwitchEnabled = true;
    try {
      const { data: flag } = await admin
        .from('feature_flags')
        .select('is_enabled')
        .eq('flag_name', 'razorpay_payments')
        .maybeSingle();
      killSwitchEnabled = flag?.is_enabled ?? true;
    } catch { /* fail open */ }

    if (!killSwitchEnabled) {
      logger.warn('verify: razorpay_payments kill-switch active — returning 503');
      // M5: await so the write is not dropped by an early serverless return.
      await logOpsEvent({
        category: 'payment',
        source: 'verify/route.ts',
        severity: 'critical',
        message: 'razorpay_payments_kill_switch_active',
        context: { user_id: user.id, plan_code: clientPlanCode },
      });
      return new NextResponse(
        JSON.stringify({
          success: false,
          error: 'Payment processing is temporarily paused. Your payment is safe — please retry shortly.',
          status: 'kill_switch_active',
        }),
        { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } },
      );
    }

    // Look up student ID — try auth_user_id first, then check if multiple records exist.
    // Resolved BEFORE the duplicate-protection check below so that check can
    // enforce payment↔account ownership (C1).
    let studentId: string | undefined;
    const { data: studentRow, error: studentErr } = await admin
      .from('students')
      .select('id')
      .eq('auth_user_id', user.id)
      .limit(1)
      .maybeSingle();

    studentId = studentRow?.id;

    // If not found, log details for debugging
    if (!studentId) {
      logger.error('verify: student not found for auth_user_id', { authUserId: user.id, error: studentErr?.message });

      // Fallback: try finding by email (handles cases where auth_user_id changed after re-signup)
      if (user.email) {
        const { data: emailRow } = await admin
          .from('students')
          .select('id')
          .eq('email', user.email)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (emailRow) {
          studentId = emailRow.id;
          // Fix the stale auth_user_id
          await admin.from('students').update({ auth_user_id: user.id }).eq('id', studentId);
          logger.warn('verify: found student by email, fixed auth_user_id', { studentId });
        }
      }
    }

    if (!studentId) {
      logger.error('verify: student not found by auth_user_id or email', { authUserId: user.id });
      // Do NOT return success:true — no entitlement was granted (P11).
      // The webhook will handle activation when it arrives.
      return NextResponse.json({
        success: false,
        error: 'Payment verified but account setup is completing. Your plan will activate within a few minutes.',
        payment_id: razorpay_payment_id,
        status: 'activation_pending',
      }, { status: 202 });
    }

    // Duplicate protection — if already processed, return success ONLY if the
    // captured payment belongs to THIS student (C1). Without this check, an
    // authenticated user who learns another user's genuine
    // order_id|payment_id|signature tuple could replay it against their own
    // session and receive a misleading `success:true` response.
    const { data: existing } = await admin
      .from('payment_history')
      .select('id, status, student_id, plan_code')
      .eq('razorpay_payment_id', razorpay_payment_id)
      .limit(1);

    if (existing && existing.length > 0 && existing[0].status === 'captured') {
      if (existing[0].student_id !== studentId) {
        logger.error('verify: captured payment belongs to a different student — rejecting', {
          paymentId: razorpay_payment_id, requestingStudentId: studentId, ownerStudentId: existing[0].student_id,
        });
        await logOpsEvent({
          category: 'payment',
          source: 'verify/route.ts',
          severity: 'critical',
          message: 'verify_cross_account_payment_reuse_blocked',
          subjectType: 'student',
          subjectId: studentId,
          context: { payment_id: razorpay_payment_id, owner_student_id: existing[0].student_id },
        });
        return NextResponse.json({ error: 'This payment is not associated with your account.' }, { status: 403 });
      }
      return NextResponse.json({ success: true, plan: existing[0].plan_code, note: 'already_processed' });
    }

    // ─── C1 (P11 CRITICAL) — authoritative plan_code/billing_cycle/binding ───
    //
    // The HMAC signature verified above only proves that order_id|payment_id
    // (or subscription_id|payment_id) are a genuine Razorpay-issued pair — it
    // says NOTHING about which plan was purchased. plan_code/billing_cycle in
    // the request body are client-supplied and MUST NOT be trusted for
    // entitlement: a client could pay for `starter` and then re-POST the
    // genuine signature tuple claiming `plan_code: 'unlimited'`.
    //
    // Fix: read back the order/subscription's own `notes` from Razorpay —
    // these were written ONLY by our server (create-order / subscribe routes)
    // at creation time, authenticated with our API secret. The client cannot
    // alter them. This also carries `notes.student_id` (or legacy
    // `notes.user_id`), which we cross-check against the authenticated
    // caller so payment A can never be attached to account B.
    let notesPlanCode: string | undefined;
    let notesBillingCycle: string | undefined;
    let notesStudentId: string | undefined;
    let notesUserId: string | undefined;
    try {
      if (type === 'subscription' && razorpay_subscription_id) {
        const sub = await getRazorpaySubscription(razorpay_subscription_id);
        notesPlanCode = sub.notes?.plan_code;
        notesBillingCycle = sub.notes?.billing_cycle;
        notesStudentId = sub.notes?.student_id;
        notesUserId = sub.notes?.user_id;
      } else if (razorpay_order_id) {
        const order = await getRazorpayOrder(razorpay_order_id);
        notesPlanCode = order.notes?.plan_code;
        notesBillingCycle = order.notes?.billing_cycle;
        notesStudentId = order.notes?.student_id;
        notesUserId = order.notes?.user_id;
      }
    } catch (notesFetchErr) {
      logger.error('verify: Razorpay order/subscription notes fetch failed', {
        error: notesFetchErr instanceof Error ? notesFetchErr.message : String(notesFetchErr),
        razorpayOrderId: razorpay_order_id, razorpaySubscriptionId: razorpay_subscription_id,
      });
    }

    if (!notesPlanCode || !notesBillingCycle) {
      // Cannot establish what was actually purchased from an authoritative
      // source — do NOT fall back to the client-supplied plan_code/billing_cycle
      // (that is exactly the C1 hole). Fail closed; the webhook (which reads
      // the SAME Razorpay-set notes independently) will activate shortly.
      logger.error('verify: could not resolve authoritative plan_code/billing_cycle from Razorpay notes', {
        razorpayOrderId: razorpay_order_id, razorpaySubscriptionId: razorpay_subscription_id, type,
      });
      await logOpsEvent({
        category: 'payment',
        source: 'verify/route.ts',
        severity: 'critical',
        message: 'verify_authoritative_notes_missing',
        subjectType: 'student',
        subjectId: studentId,
        context: {
          payment_id: razorpay_payment_id,
          razorpay_order_id: razorpay_order_id ?? null,
          razorpay_subscription_id: razorpay_subscription_id ?? null,
          type: type ?? null,
        },
      });
      return NextResponse.json({
        success: false,
        error: 'Payment received but plan details are being confirmed. Your plan will activate within a few minutes.',
        payment_id: razorpay_payment_id,
        status: 'activation_pending',
      }, { status: 202 });
    }

    plan_code = canonicalizePlan(notesPlanCode);
    billing_cycle = notesBillingCycle === 'yearly' ? 'yearly' : 'monthly';

    // Cross-account binding check: the order/subscription must have been
    // created FOR this authenticated caller. notes.student_id is canonical;
    // notes.user_id (legacy) is the fallback.
    const notesBoundToCaller =
      (notesStudentId && notesStudentId === studentId) ||
      (!notesStudentId && notesUserId && notesUserId === user.id);
    if (!notesBoundToCaller) {
      logger.error('verify: order/subscription notes do not belong to the authenticated caller — rejecting', {
        studentId, authUserId: user.id, notesStudentId, notesUserId,
      });
      await logOpsEvent({
        category: 'payment',
        source: 'verify/route.ts',
        severity: 'critical',
        message: 'verify_cross_account_binding_mismatch',
        subjectType: 'student',
        subjectId: studentId,
        context: {
          payment_id: razorpay_payment_id,
          notes_student_id: notesStudentId ?? null,
          notes_user_id: notesUserId ?? null,
        },
      });
      return NextResponse.json({ error: 'This payment is not associated with your account.' }, { status: 403 });
    }

    // Get amount from subscription_plans (source of truth)
    const { data: planRow, error: planError } = await admin
      .from('subscription_plans')
      .select('price_monthly, price_yearly')
      .eq('plan_code', plan_code)
      .maybeSingle();

    if (planError) {
      logger.error('verify: subscription_plans lookup failed', { error: planError.message, plan_code });
      return NextResponse.json({ error: 'Plan lookup failed' }, { status: 500 });
    }
    if (!planRow) {
      logger.error('verify: unknown plan_code', { plan_code });
      return NextResponse.json({ error: `Unknown plan: ${plan_code}` }, { status: 400 });
    }

    const priceRupees = billing_cycle === 'yearly' ? planRow.price_yearly : planRow.price_monthly;

    // Record payment — ignore duplicate constraint (webhook may have already inserted)
    const { error: insertErr } = await admin.from('payment_history').insert({
      student_id: studentId,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      plan_code,
      billing_cycle,
      currency: 'INR',
      amount: priceRupees, // store in rupees (INR)
      status: 'captured',
      payment_method: 'razorpay',
    });
    if (insertErr && !insertErr.message.includes('duplicate')) {
      logger.error('verify: payment_history insert failed', { error: insertErr.message });
    }

    // Activate subscription via RPC — this is the critical step
    const { error: rpcError } = await admin.rpc('activate_subscription_locked', {
      p_auth_user_id: user.id,
      p_plan_code: plan_code,
      p_billing_cycle: billing_cycle,
      p_razorpay_payment_id: razorpay_payment_id,
      p_razorpay_order_id: razorpay_order_id,
      p_razorpay_subscription_id: razorpay_subscription_id || null,
    });

    if (rpcError) {
      logger.error('verify: activate_subscription RPC failed', { error: rpcError.message });
      // Do NOT fall back to patching students table alone — that creates split-brain
      // where students.subscription_plan says 'pro' but student_subscriptions is stale.
      // Instead, rely on the webhook for activation and tell the user to wait.
      logger.error('verify: RECONCILIATION REQUIRED', { paymentId: razorpay_payment_id, authUserId: user.id, planCode: plan_code });

      // M5: await so the write is not dropped by an early serverless return.
      await logOpsEvent({
        category: 'payment',
        source: 'verify/route.ts',
        severity: 'warning',
        message: 'Payment verify returned 503 — RPC failed, reconciliation required',
        subjectType: 'student',
        subjectId: studentId,
        context: { payment_id: razorpay_payment_id, plan_code, rpc_error: rpcError.message },
      });

      return NextResponse.json({
        success: false,
        error: 'Payment received but access update is in progress. Your payment is safe — your plan will activate shortly.',
        payment_id: razorpay_payment_id,
        status: 'reconciliation_required',
      }, { status: 503 });
    }

    // Verify the update actually took effect by reading back
    const { data: verify } = await admin
      .from('students')
      .select('subscription_plan')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (verify?.subscription_plan !== plan_code) {
      logger.error('verify: post-update check failed', { expected: plan_code, got: verify?.subscription_plan });
      return NextResponse.json({
        error: 'Payment received but access update is being confirmed. Please refresh the page.',
        payment_id: razorpay_payment_id,
        status: 'pending_confirmation',
      }, { status: 202 });
    }

    // ─── Track A.3: persist the GST breakdown on student_subscriptions ───
    // Entitlement is already granted (the critical P11 path above is untouched).
    // We re-derive the SAME GST split via the single compute_gst RPC (the plan
    // price is the taxable value) and stamp it onto the just-activated
    // subscription row in ONE UPDATE statement (atomic). The buyer place-of-supply
    // comes from the checkout body; absent it, compute_gst treats the sale as IGST.
    //
    // This persist is best-effort for the RESPONSE: a GST-stamp failure must NOT
    // flip a successful, paid, entitlement-granted activation into an error
    // (the money + access already landed). We log for reconciliation instead.
    //
    // ─── Launch-safety gate (P11): GST stamping is OFF until ff_gst_invoicing_v1 ───
    // When the flag is OFF (default) or its check errors, we do NOT call
    // compute_gst and do NOT stamp any GST columns on student_subscriptions —
    // byte-for-byte the pre-Track-A.3 behavior (the row keeps NULL GST columns).
    // This block is entirely post-entitlement, so it can never affect the sale.
    try {
      if (await gstChargingEnabled()) {
        const supplierState = supplierStateCode();
        const taxableRupees = billing_cycle === 'yearly' ? planRow.price_yearly : planRow.price_monthly;
        const gst = await computeGst(admin, taxableRupees, place_of_supply ?? null, '9992', supplierState);
        if (gst) {
          const { error: gstErr } = await admin
            .from('student_subscriptions')
            .update(gstSubscriptionColumns(gst, { supplierState, placeOfSupply: place_of_supply ?? null }))
            .eq('student_id', studentId)
            .eq('plan_code', plan_code);
          if (gstErr) {
            logger.warn('verify: GST column stamp failed (entitlement already granted)', { error: gstErr.message });
          }
        } else {
          logger.warn('verify: compute_gst unavailable — subscription GST columns left null');
        }
      }
    } catch (gstEx) {
      logger.warn('verify: GST persist threw (non-blocking)', {
        error: gstEx instanceof Error ? gstEx.message : String(gstEx),
      });
    }

    return NextResponse.json({ success: true, plan: plan_code });
  } catch (err) {
    logger.error('Verify payment error', { error: err instanceof Error ? err : new Error(String(err)) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
