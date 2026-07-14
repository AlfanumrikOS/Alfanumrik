/**
 * ALFANUMRIK — Unlimited-usage sentinel (dependency-free leaf)
 *
 * The single source of truth for the "no daily cap" sentinel and its detector.
 *
 * WHY a standalone leaf (not just inline in usage.ts):
 *   `usage.ts` transitively imports the server-only service-role client
 *   (`usage.ts` → `plan-gate` → `supabase-admin`) plus the heavy deprecated
 *   `./supabase` graph. The institution entitlements CATALOG
 *   (`entitlements/catalog.ts`) is a SHARED client+server contract — it is
 *   imported by the `'use client'` super-admin panel. To reuse this EXACT value
 *   without dragging any of that server-only graph into a client bundle (P8),
 *   the sentinel lives here, importing NOTHING. Both `usage.ts` and
 *   `entitlements/catalog.ts` import it, so there is ONE definition and ZERO
 *   duplication.
 *
 * VALUE CONTRACT: mirrors the DB. `get_plan_limit()` maps a
 * `subscription_plans.foxy_chats_per_day = -1` (unlimited) to 999999, so any
 * resolved limit at or above this value is treated as effectively uncapped.
 */

/**
 * Sentinel that mirrors the DB's "unlimited" cap (DB `-1` → 999999). A resolved
 * limit at or above this value means "no cap": the UI shows "Unlimited" instead
 * of a finite "X/Y" countdown, and no upsell.
 */
export const UNLIMITED_USAGE_SENTINEL = 999999;

/**
 * True when a resolved daily limit is effectively unlimited (DB `-1` → 999999).
 * Single source of the "is this plan uncapped?" test so the header badge, the
 * mobile tools sheet, and any future usage surface all agree.
 */
export function isUnlimitedUsage(limit: number | null | undefined): boolean {
  return typeof limit === 'number' && limit >= UNLIMITED_USAGE_SENTINEL;
}
