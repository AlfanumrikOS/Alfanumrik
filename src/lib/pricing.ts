/**
 * ALFANUMRIK — Pricing Source of Truth (SoT)
 * ==========================================
 *
 * Single import surface for every price the platform quotes or bills, so that
 * marketing copy can never silently drift from what the system actually charges
 * (REG-65 — landing-page pricing-verbatim drift is a brand/legal risk).
 *
 * Two distinct revenue lines live here, kept separate on purpose:
 *
 *   1. B2C consumer plans (free / starter / pro / unlimited)
 *      ─ Canonical values live in `src/lib/plans.ts::PRICING` (already the
 *        single source consumed by PricingCards, UpgradeModal, super-admin
 *        analytics, and the `subscription_plans` DB table). We RE-EXPORT them
 *        here rather than re-declaring, so there is still exactly one literal.
 *      ─ The Razorpay order route (`/api/payments/create-order`) holds the same
 *        numbers in PAISA (×100). Those are intentionally NOT replaced in this
 *        pass (P11 high-blast-radius surface); they are reconciled against this
 *        module by `CONSUMER_PRICING_PAISA` below for drift detection only.
 *
 *   2. B2B per-seat school pricing
 *      ─ The system bills schools off `school_subscriptions.price_per_seat_monthly`
 *        (a PER-SCHOOL, operator-negotiated value; trial schools = 0). There is
 *        no global per-seat constant in the billing path.
 *      ─ The ONLY hardcoded per-seat numbers in the billing path are the default
 *        tier fallbacks in `POST /api/super-admin/invoices` (used when a school
 *        has no negotiated `price_per_seat_monthly`). Those tiers are the
 *        system-of-record default and are centralized here as
 *        `SCHOOL_SEAT_TIER_INR`.
 *      ─ `SCHOOL_PER_SEAT_MARKETING_INR` is the value the /schools marketing
 *        page should quote. It is derived from the system-of-record default
 *        tier (NOT an independent number) so the public "from ₹X/student/month"
 *        claim is anchored to a real billable figure.
 *
 * ⚠️  PRICING-CHANGE POLICY: changing ANY number in this file (or in plans.ts)
 *     is a pricing change and requires CEO approval (.claude/CLAUDE.md "User
 *     Approval Required For"). This module is for CENTRALIZATION ONLY.
 *
 * ✅  RESOLVED (CEO-approved 2026-06-16): ₹99 is the official public per-seat
 *     marketing price for schools. It equals the lowest billable tier (`basic`),
 *     so the public "from ₹99/student/month" claim is anchored to a real billed
 *     figure with zero drift from the billing path:
 *        • invoice default tiers: 99 / 199 / 399 / 599 (default 199)
 *        • per-school negotiated price_per_seat_monthly: arbitrary, trial = 0
 *        • consumer "unlimited"/Family-School plan: ₹1,099/mo (B2C, not per-seat)
 *     The /schools page renders this value directly from the SoT
 *     (`SCHOOL_PER_SEAT_MARKETING_INR`). The earlier "₹75" placeholder is retired;
 *     no figure other than the SoT value may be quoted publicly. Any change to the
 *     basic tier (and therefore this marketing figure) remains a pricing change
 *     needing CEO sign-off per the PRICING-CHANGE POLICY above.
 */

import { PRICING, formatINR, yearlyPerMonth } from '@/lib/plans';

// ─── B2C consumer plan pricing (re-exported single source) ────────────────────

/**
 * Canonical B2C plan pricing in INR rupees. Re-exported from `plans.ts` so this
 * module is the one import surface without creating a second literal.
 */
export { PRICING as CONSUMER_PRICING, formatINR, yearlyPerMonth };

export type ConsumerPlanCode = keyof typeof PRICING;

/**
 * Same consumer prices expressed in PAISA (×100), the unit Razorpay's order API
 * expects. Mirrors the literal map inside `/api/payments/create-order`. Exported
 * so a unit test can assert the two never diverge — NOT yet wired into the order
 * route (P11 surface; left untouched in this centralization pass).
 */
export const CONSUMER_PRICING_PAISA: Record<
  ConsumerPlanCode,
  { monthly: number; yearly: number }
> = {
  starter: { monthly: PRICING.starter.monthly * 100, yearly: PRICING.starter.yearly * 100 },
  pro: { monthly: PRICING.pro.monthly * 100, yearly: PRICING.pro.yearly * 100 },
  unlimited: { monthly: PRICING.unlimited.monthly * 100, yearly: PRICING.unlimited.yearly * 100 },
} as const;

// ─── B2B per-seat school pricing ──────────────────────────────────────────────

/**
 * Default per-seat monthly price (INR) by school plan tier. SYSTEM OF RECORD for
 * the invoice fallback when a school has no negotiated
 * `school_subscriptions.price_per_seat_monthly`.
 *
 * These are the exact values used by `POST /api/super-admin/invoices`. Keep the
 * keys lowercase to match `schools.subscription_plan` normalisation there.
 *
 * NOTE: the live billed price for any given school is its negotiated
 * `price_per_seat_monthly` column when set (> 0); these tiers are the fallback
 * default only.
 */
export const SCHOOL_SEAT_TIER_INR = {
  basic: 99,
  standard: 199,
  premium: 399,
  enterprise: 599,
} as const;

export type SchoolSeatTier = keyof typeof SCHOOL_SEAT_TIER_INR;

/** Invoice fallback default when a school's plan tier is unknown/unset. */
export const SCHOOL_SEAT_DEFAULT_INR: number = SCHOOL_SEAT_TIER_INR.standard;

/**
 * Resolve the default per-seat price for a school plan tier. Mirrors the
 * lookup in the invoice route: unknown/empty tier falls back to the standard
 * tier. The live billed amount still prefers the school's negotiated
 * `price_per_seat_monthly` when set.
 */
export function schoolSeatPriceForTier(tier: string | null | undefined): number {
  const key = (tier ?? '').toLowerCase() as SchoolSeatTier;
  return SCHOOL_SEAT_TIER_INR[key] ?? SCHOOL_SEAT_DEFAULT_INR;
}

/**
 * The per-seat price the /schools MARKETING page quotes as its headline
 * "from ₹X/student/month" figure.
 *
 * CEO-approved 2026-06-16: the official public per-seat price is ₹99, equal to
 * the system-of-record lowest published tier (`basic`). The /schools page renders
 * this SoT value directly, so the public "starting from" claim is a real billed
 * number with zero drift (see RESOLVED note in the module header).
 */
export const SCHOOL_PER_SEAT_MARKETING_INR: number = SCHOOL_SEAT_TIER_INR.basic;

/**
 * Pre-formatted marketing string for the per-seat headline, e.g. "₹99".
 * Frontend can render this directly next to its "/student/month" suffix.
 */
export const SCHOOL_PER_SEAT_MARKETING_LABEL: string = formatINR(
  SCHOOL_PER_SEAT_MARKETING_INR,
);

// ─── Quarterly (3-month) per-seat — DISPLAY / MARKETING ONLY ──────────────────
//
// IMPORTANT: this is a DERIVED display figure, not a billing input. The billing
// path always charges `price_per_seat_monthly × seats × cycle` (cycle = 3 for
// quarterly). A school admin comparing cadences sees "₹297 per seat per
// quarter" = the basic tier × 3 months. There is NO independent quarterly
// literal — changing the basic tier above moves this automatically (so the
// PRICING-CHANGE POLICY in the module header still covers it with one number).

/**
 * The per-seat amount billed across a 3-month (quarterly) cycle, derived from
 * the system-of-record basic tier. e.g. ₹99/mo × 3 = ₹297/quarter.
 * DISPLAY/MARKETING ONLY — billing computes price_per_seat_monthly × seats × 3.
 */
export const SCHOOL_PER_SEAT_QUARTERLY_INR: number = SCHOOL_SEAT_TIER_INR.basic * 3;

/** Pre-formatted quarterly per-seat headline, e.g. "₹297". Display only. */
export const SCHOOL_PER_SEAT_QUARTERLY_LABEL: string = formatINR(
  SCHOOL_PER_SEAT_QUARTERLY_INR,
);

/**
 * Resolve the DISPLAY per-seat price for a 3-month quarterly cycle for a given
 * school plan tier (tier monthly price × 3). Mirrors `schoolSeatPriceForTier`
 * but for the quarterly display figure. DISPLAY/MARKETING ONLY — the live
 * billed amount is still `price_per_seat_monthly × seats × 3`.
 */
export function schoolSeatPriceQuarterly(tier: string | null | undefined): number {
  return schoolSeatPriceForTier(tier) * 3;
}
