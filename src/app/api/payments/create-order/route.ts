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

    // Get plan from DB
    const razorpayKey = process.env.RAZORPAY_KEY_ID;
    const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!razorpayKey || !razorpaySecret) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 });
    }

    // Plan pricing (in paisa — Razorpay uses smallest currency unit)
    const PRICING: Record<string, { monthly: number; yearly: number }> = {
      starter:   { monthly: 29900,   yearly: 239900 },   // ₹299/mo, ₹2399/yr
      pro:       { monthly: 69900,   yearly: 559900 },   // ₹699/mo, ₹5599/yr
      unlimited: { monthly: 149900,  yearly: 1199900 },  // ₹1499/mo, ₹11999/yr
    };

    const taxablePaisa = PRICING[plan_code][billing_cycle as 'monthly' | 'yearly'];

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
