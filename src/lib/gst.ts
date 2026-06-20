/**
 * ALFANUMRIK — GST computation helper (server-side)
 *
 * Track A.3 — per-state GST (India) billing. Thin TypeScript wrapper around the
 * single reusable `public.compute_gst()` Postgres RPC (migration
 * 20260621000300_track_a_per_state_gst_billing.sql). ALL GST arithmetic lives in
 * the RPC — this module never re-derives a rate, split, or rounding. It only:
 *   1. invokes the RPC with the right state inputs, and
 *   2. shapes the result for (a) persistence on student_subscriptions /
 *      school_invoices and (b) Razorpay order `notes` (string-only map).
 *
 * Money is numeric(_,2) end to end — we keep the RPC's numeric values and never
 * coerce through float-prone paths. Razorpay charges in PAISA, so the only
 * unit conversion (rupees → paisa) happens at the Razorpay boundary in the
 * payment routes, using `Math.round(rupees * 100)`.
 *
 * Server-only: requires the service-role client (compute_gst is SECURITY
 * DEFINER reading admin-only tax_config / supplier_gstins). Never import in
 * client code.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Default education-services SAC. Overridable per call. */
export const DEFAULT_SAC_CODE = '9992';

/**
 * The issuing Alfanumrik SUPPLIER state for B2C student subscriptions.
 * Configurable, NOT hardcoded into business logic — resolves the per-state
 * GSTIN via the RPC. Defaults to MH but is env-overridable for multi-state ops.
 */
export function supplierStateCode(): string {
  return (
    process.env.ALFANUMRIK_SUPPLIER_STATE_CODE ||
    process.env.ALFANUMRIK_STATE_CODE ||
    'MH'
  );
}

/** Shape returned by the public.compute_gst() RPC (jsonb). */
export interface ComputeGstResult {
  taxable_amount: number;
  sac: string;
  rate: number;
  is_exempt: boolean;
  intra_state: boolean;
  cgst: number;
  sgst: number;
  igst: number;
  total_tax: number;
  total_payable: number;
  supplier_gstin: string | null;
}

/**
 * Compute the GST breakdown for a taxable rupee amount via the compute_gst RPC.
 *
 * @param admin            service-role Supabase client (RLS-bypassing; the RPC
 *                         reads admin-only config tables).
 * @param taxableRupees    pre-GST taxable value in rupees (numeric, >= 0).
 * @param recipientState   buyer place-of-supply state code (may be null/empty
 *                         for a B2C buyer with no captured state → the RPC
 *                         conservatively treats it as inter-state / IGST).
 * @param sac              SAC code (defaults to 9992 education services).
 * @param supplierState    issuing supplier state (defaults to supplierStateCode()).
 *
 * Returns the typed RPC result, or null if the RPC failed (caller decides
 * whether to fall back to the bare taxable amount — see note in payment routes).
 */
export async function computeGst(
  admin: SupabaseClient,
  taxableRupees: number,
  recipientState: string | null | undefined,
  sac: string = DEFAULT_SAC_CODE,
  supplierState: string = supplierStateCode(),
): Promise<ComputeGstResult | null> {
  const { data, error } = await admin.rpc('compute_gst', {
    p_taxable_amount: taxableRupees,
    p_supplier_state: supplierState,
    p_recipient_state: recipientState ?? null,
    p_sac: sac,
  });
  if (error || !data) return null;
  return data as ComputeGstResult;
}

/**
 * Flatten a GST result into the Razorpay order `notes` map (string values only —
 * Razorpay coerces notes to strings and caps each at 256 chars). The webhook /
 * verify path reads these back to reconcile the tax split with what was charged.
 *
 * Contains ONLY money + tax codes — no PII (P13). `supplier_gstin` is a business
 * registration number, not personal data.
 */
export function gstToRazorpayNotes(gst: ComputeGstResult): Record<string, string> {
  return {
    gst_sac: gst.sac,
    gst_rate: String(gst.rate),
    gst_is_exempt: String(gst.is_exempt),
    gst_intra_state: String(gst.intra_state),
    gst_taxable_inr: String(gst.taxable_amount),
    gst_cgst_inr: String(gst.cgst),
    gst_sgst_inr: String(gst.sgst),
    gst_igst_inr: String(gst.igst),
    gst_total_tax_inr: String(gst.total_tax),
    gst_total_payable_inr: String(gst.total_payable),
    gst_supplier_gstin: gst.supplier_gstin ?? '',
  };
}

/**
 * The column payload to persist on `student_subscriptions` (B2C) for a GST
 * result. All numeric(12,2) rupee columns; `place_of_supply` is the captured
 * buyer state. Caller spreads this into the subscription upsert so the GST
 * split is written ATOMICALLY with the row (P11).
 *
 * NOTE on units (architect caveat): the existing `amount_paid` column is INTEGER
 * (legacy B2C unit) and is NOT touched here. These `*_inr` columns are the
 * numeric rupee values straight from compute_gst.
 */
export function gstSubscriptionColumns(
  gst: ComputeGstResult,
  opts: { supplierState: string; placeOfSupply: string | null | undefined },
): Record<string, unknown> {
  return {
    sac: gst.sac,
    gst_rate: gst.rate,
    taxable_amount_inr: gst.taxable_amount,
    cgst_amount: gst.cgst,
    sgst_amount: gst.sgst,
    igst_amount: gst.igst,
    total_tax_inr: gst.total_tax,
    supplier_gstin: gst.supplier_gstin,
    supplier_state_code: opts.supplierState,
    place_of_supply: opts.placeOfSupply ?? null,
  };
}
