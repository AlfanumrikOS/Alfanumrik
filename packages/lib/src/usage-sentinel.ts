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
 * True when a resolved daily limit is effectively unlimited.
 * Single source of the "is this plan uncapped?" test so the header badge, the
 * mobile tools sheet, and any future usage surface all agree.
 *
 * TWO shapes of "unlimited" are accepted, because both genuinely reach this
 * function:
 *
 *  1. `>= 999999` — the RESOLVED form. `get_plan_limit()` maps the DB's `-1` to
 *     999999 before returning, so anything that came through that RPC is large.
 *  2. `< 0` — the RAW DISPLAY form. `subscription_plans.foxy_chats_per_day`
 *     stores literal `-1` for every paid plan, and surfaces that read the plan
 *     row directly (rather than going through `get_plan_limit`) hand us the
 *     `-1` unconverted. Treating that as a FINITE cap was the bug: `-1` is
 *     smaller than every real cap, so a paid student's uncapped plan read as
 *     "0 messages left" / exhausted instead of "Unlimited".
 *
 * `mobile/lib/data/models/dashboard_data.dart` already accepts both forms; this
 * brings the TS detector to parity with it.
 *
 * NOTE: this is a DISPLAY predicate only. Quota ENFORCEMENT lives entirely in
 * the DB (`check_and_record_usage` → `get_plan_limit`), and no caller of this
 * function grants or denies access — widening it cannot loosen a real cap.
 * The error/unknown path in `usage.ts` returns `limit: 0`, never a negative, so
 * no failure state is misread as unlimited here.
 */
export function isUnlimitedUsage(limit: number | null | undefined): boolean {
  if (typeof limit !== 'number' || Number.isNaN(limit)) return false;
  return limit < 0 || limit >= UNLIMITED_USAGE_SENTINEL;
}
