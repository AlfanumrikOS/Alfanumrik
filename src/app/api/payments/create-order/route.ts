import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabase as globalSupabase } from '@/lib/supabase-client';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { capture as posthogCapture } from '@/lib/posthog/server';
import { paymentSubscribeSchema, validateBody } from '@/lib/validation';
import { authorizeRequest } from '@/lib/rbac';
import { computeGst, gstToRazorpayNotes, supplierStateCode } from '@/lib/gst';
import { isFeatureEnabled, PAYMENT_FLAGS } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';
import {
  resolveEffectiveEntitlementForUser,
  isRedundantPurchase,
} from '@/lib/entitlements/effective-plan';
import { CONSUMER_PRICING_PAISA, type ConsumerPlanCode } from '@/lib/pricing';

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

// P11: payment endpoints are the highest-blast-radius write surface.
// We share validateBody / paymentSubscribeSchema with the
// payments/verify route so plan_code + billing_cycle stay constrained
// to the same enum literals everywhere in the payment lifecycle.

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll().map(c => ({ name: c.name, value: c.value }));
        },
        setAll() {},
      },
    });

    // Try cookie-based auth first, fall back to Bearer token
    let user = (await supabase.auth.getUser()).data.user;
    if (!user) {
      // Fallback: use Authorization header (client passes access token directly)
      const authHeader = request.headers.get('Authorization');
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        user = (await globalSupabase.auth.getUser(token)).data.user;
      }
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Gap 2 defense-in-depth (P11): RBAC permission gate on top of getUser().
    // authorizeRequest() resolves identity from the SAME Bearer header / Supabase
    // session cookie sources used above, so a legitimately logged-in student with
    // the 'payments.subscribe' grant passes; super_admin/admin bypass automatically.
    // The getUser() block above is retained — it supplies order metadata (user.id,
    // user.email). This guard is ADDED before any Razorpay order creation.
    const auth = await authorizeRequest(request, 'payments.subscribe');
    if (!auth.authorized) return auth.errorResponse!;

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const validation = validateBody(paymentSubscribeSchema, rawBody);
    if (!validation.success) return validation.error;
    const { plan_code, billing_cycle } = validation.data;

    // ─── Track A.5: redundant-purchase guard (B2C ↔ B2B coexistence) ───
    // If the student is already covered by their SCHOOL's plan at a tier >= the
    // requested plan, this order adds NO entitlement → never charge. Return a
    // STRUCTURED 409 (NOT a hard 403/500) so the client renders "covered by your
    // school" and skips checkout. A request that EXCEEDS the school tier is a
    // genuine upgrade and falls through to order creation normally. B2C-only
    // students (no school) are never blocked here. Fail-OPEN on resolve error.
    try {
      const resolved = await resolveEffectiveEntitlementForUser(user.id);
      if (resolved) {
        const verdict = isRedundantPurchase(resolved.entitlement, plan_code);
        if (verdict.redundant) {
          return NextResponse.json({
            success: false,
            already_covered: true,
            covered_by_school: true,
            school_plan: verdict.schoolPlan,
            error: 'Your school already provides this plan or higher.',
          }, { status: 409 });
        }
      }
    } catch (covErr) {
      logger.warn('create-order: coverage guard skipped (resolve error)', {
        error: covErr instanceof Error ? covErr.message : String(covErr),
      });
    }

    // Get plan from DB
    const razorpayKey = process.env.RAZORPAY_KEY_ID;
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!razorpayKey || !razorpaySecret) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 });
    }

    // Plan pricing (in paisa — Razorpay uses smallest currency unit).
    //
    // PAY-2 Layer 1 (amount-preserving de-dup): this route previously held an
    // INLINE paisa literal (starter 29900/239900, pro 69900/559900, unlimited
    // 149900/1199900). That literal was a byte-identical mirror of
    // `CONSUMER_PRICING_PAISA` (= plans.ts PRICING × 100) in `@/lib/pricing`.
    // We now import the shared constant so create-order (the MOBILE checkout
    // path) can no longer drift from plans.ts. No amount changed — the charged
    // paisa values are byte-identical to the prior inline literal.
    //
    // ✅  PAY-2 RESOLVED (value-only convergence, customer-favorable): the code
    // `unlimited` price was converged DOWN to the DB-canonical ₹1099/₹8799 set by
    // migration 20260505155126. plans.ts PRICING.unlimited is now {monthly:1099,
    // yearly:8799}; CONSUMER_PRICING_PAISA derives ×100 (→ 109900/879900 paisa),
    // so this route (the MOBILE checkout path) now charges the SAME amount the DB
    // holds and that payments/verify records in payment_history. The prior
    // gateway(₹1499)-vs-ledger(₹1099) mismatch is closed; the change only ever
    // LOWERED the charge (never overcharges). No signature/atomicity/auth logic
    // touched. FUTURE HARDENING (deferred, not a blocker): have create-order read
    // `subscription_plans` at runtime so code can never re-diverge — gated on
    // folding the subscription_plans seed into the migration chain first (the
    // baseline is schema-only; a runtime DB read would otherwise break fresh
    // CI/staging/DR DBs). Until then the code constant (== DB) stays the source.
    const pricingByCycle = CONSUMER_PRICING_PAISA[plan_code as ConsumerPlanCode];
    if (!pricingByCycle) {
      // Defensive: paymentSubscribeSchema already constrains plan_code to the
      // enum and CONSUMER_PRICING_PAISA carries the same keys, but guard so an
      // unknown plan_code can never reach the Razorpay order body.
      return NextResponse.json({ error: 'Plan not available' }, { status: 400 });
    }
    const taxablePaisa = pricingByCycle[billing_cycle as 'monthly' | 'yearly'];

    // ─── Track A.3: per-state GST on the B2C order ───
    // The listed plan price is the TAXABLE (pre-GST) value. We compute the GST
    // split via the single compute_gst RPC and charge the TAX-INCLUSIVE total.
    // place_of_supply (buyer state) may be supplied by the client at checkout;
    // absent it, compute_gst conservatively treats the sale as inter-state (IGST).
    // The GST breakdown rides in `notes` so the webhook/verify can reconcile.
    const placeOfSupply =
      typeof (rawBody as { place_of_supply?: unknown })?.place_of_supply === 'string'
        ? ((rawBody as { place_of_supply: string }).place_of_supply.trim() || null)
        : null;
    const supplierState = supplierStateCode();
    const taxableRupees = taxablePaisa / 100;

    let amount = taxablePaisa; // default: bare taxable (pre-A.3 behavior, also the GST-OFF behavior)
    let gstNotes: Record<string, string> = {};
    // GST-metadata notes (supplier_state_code, place_of_supply) are themselves a
    // Track A.3 addition; when the flag is OFF they must NOT ride on the order so
    // the order payload is byte-for-byte the pre-A.3 shape.
    let gstMetaNotes: Record<string, string> = {};

    // ─── Launch-safety gate (P11): GST charging is OFF until ff_gst_invoicing_v1 ───
    // When the flag is OFF (default) or its check errors, we charge the bare
    // taxable amount with NO GST side effects — byte-for-byte the pre-Track-A.3
    // behavior. compute_gst is NOT called for charging, and no GST notes ride
    // on the order. The gate is fail-closed to NO-GST and never blocks the sale.
    if (await gstChargingEnabled()) {
      gstMetaNotes = {
        supplier_state_code: supplierState,
        place_of_supply: placeOfSupply ?? '',
      };
      const gst = await computeGst(supabaseAdmin, taxableRupees, placeOfSupply, '9992', supplierState);
      if (gst) {
        // Charge the tax-inclusive total, converted to paisa at the Razorpay boundary.
        amount = Math.round(Number(gst.total_payable) * 100);
        gstNotes = gstToRazorpayNotes(gst);
      } else {
        // GST RPC unavailable (e.g. tax_config not yet seeded). Do NOT block the
        // sale — charge the listed taxable amount and log for reconciliation.
        logger.warn('create-order: compute_gst unavailable — charging bare taxable amount', {
          plan_code, billing_cycle,
        });
      }
    }

    // Create Razorpay order
    const authString = Buffer.from(`${razorpayKey}:${razorpaySecret}`).toString('base64');
    const orderRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${authString}`,
      },
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt: `${user.id.substring(0, 8)}_${plan_code}_${Date.now().toString(36)}`,
        notes: {
          user_id: user.id,
          plan_code,
          billing_cycle,
          email: user.email,
          ...gstMetaNotes,
          ...gstNotes,
        },
      }),
    });

    if (!orderRes.ok) {
      const err = await orderRes.text();
      console.error('Razorpay order creation failed:', orderRes.status, err);
      console.error('Razorpay key used:', razorpayKey?.substring(0, 12) + '...');
      return NextResponse.json({ error: 'Payment gateway error. Please try again.' }, { status: 502 });
    }

    const order = await orderRes.json();

    // PostHog: payment_initiated. Distinct id is the auth user id (Supabase
    // UUID). Server-side telemetry is acceptable per posthog/server.ts —
    // logger redacts PII before any further egress. $insert_id keyed on
    // order_id so accidental double-clicks dedup at PostHog ingest.
    void posthogCapture(
      'payment_initiated',
      user.id,
      {
        amount,
        currency: 'INR',
        plan: plan_code,
        billing_cycle: billing_cycle as 'monthly' | 'yearly',
        order_id: order.id,
      },
      `payment_initiated:${order.id}`,
    ).catch(() => { /* swallow — telemetry never blocks payment flow */ });

    return NextResponse.json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key: razorpayKey,
      plan_code,
      billing_cycle,
    });
  } catch (err) {
    console.error('Create order error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
