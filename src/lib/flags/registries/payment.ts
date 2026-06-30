/**
 * Registry of flag names that payment-integrity code references.
 * Defaults (when the flag is absent from the DB) are documented inline —
 * `isFeatureEnabled` already returns false for unknown flags, but this
 * registry keeps the source of truth close to the code that reads it.
 *
 * Seeded by migration 20260414120000_payment_subscribe_atomic_fix.sql.
 */
export const PAYMENT_FLAGS = {
  /** Enables the reconcile_stuck_subscriptions action in the payments Edge Function.
   *  Default: false (off). Flip via super-admin console after drift metrics confirmed. */
  RECONCILE_STUCK_SUBSCRIPTIONS_ENABLED: 'reconcile_stuck_subscriptions_enabled',

  /** Track A.3 per-state GST on B2C payment paths (create-order, subscribe, verify).
   *  Default: false (off) — seeded OFF by 20260507130003_add_ff_gst_invoicing_v1.sql.
   *  Already gates the B2B invoice-generator Edge Function. When OFF, the B2C
   *  payment routes charge the bare taxable amount with NO GST side effects
   *  (no compute_gst for charging, no GST notes, no GST subscription columns) —
   *  byte-for-byte the pre-Track-A.3 behavior. Fail-closed to OFF: if the flag
   *  check itself errors, treat as OFF (never over-charge on an indeterminate
   *  flag state, never fail the sale). Flip ON only after CEO/finance go-live
   *  confirmation (real supplier GSTINs seeded + final GST rate confirmed). */
  GST_INVOICING_V1: 'ff_gst_invoicing_v1',
} as const;
