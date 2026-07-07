/**
 * REG-207 [payments / P11] — PAY-2 unlimited-price convergence pin.
 *
 * THE CHANGE (2026-06-30). The `unlimited` consumer plan price was converged
 * across ALL sources to the DB-canonical ₹1099/₹8799:
 *
 *   • web charge / display   `src/lib/plans.ts::PRICING.unlimited`        = 1099/8799
 *   • derived paisa (server) `src/lib/pricing.ts::CONSUMER_PRICING_PAISA` = 109900/879900
 *                            (×100, read by /api/payments/create-order)
 *   • mobile charge/display  `mobile/lib/data/models/subscription.dart`   = 1099/8799
 *   • DB row                 `subscription_plans.unlimited` (migration 20260505155126)
 *                            = 1099/8799  (was ALREADY this value)
 *
 * The prior live divergence — mobile/web code charged ₹1499 while the DB (web
 * checkout) charged ₹1099, and the gateway captured ₹1499 while verify recorded
 * ₹1099 — is CLOSED. The convergence is customer-FAVORABLE (charge lowered,
 * never raised). P11 signature-verification and atomic-write logic are untouched
 * by this change; this pin guards only the pricing CONSTANTS.
 *
 * This pin fails if a future drift in EITHER direction reopens the gap (code
 * creeping back to ₹1499, the paisa constant desyncing from rupees, or the
 * DB migration moving). It also pins starter/pro UNCHANGED so the test proves
 * ONLY unlimited moved.
 *
 * TEST-ONLY: reads plans.ts, pricing.ts, and the DB migration; edits nothing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRICING } from '@alfanumrik/lib/plans';
import { CONSUMER_PRICING_PAISA } from '@alfanumrik/lib/pricing';

const DB_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260505155126_fix_pricing_family_school_plan.sql',
);

/** Extract the DB-canonical unlimited rupee price from migration 20260505155126. */
function parseDbUnlimitedPrice(): { monthly: number; yearly: number } {
  const text = readFileSync(DB_MIGRATION_PATH, 'utf8');
  const monthly = /price_monthly\s*=\s*(\d+)/.exec(text);
  const yearly = /price_yearly\s*=\s*(\d+)/.exec(text);
  if (!monthly || !yearly) {
    throw new Error(
      'parse anchor not found in migration 20260505155126: expected `price_monthly = <int>` and `price_yearly = <int>`',
    );
  }
  return { monthly: Number(monthly[1]), yearly: Number(yearly[1]) };
}

describe('REG-207: PAY-2 unlimited price converged to DB-canonical ₹1099/₹8799', () => {
  it('PRICING.unlimited (web charge + display) === { monthly: 1099, yearly: 8799 }', () => {
    expect({
      monthly: PRICING.unlimited.monthly,
      yearly: PRICING.unlimited.yearly,
    }).toEqual({ monthly: 1099, yearly: 8799 });
  });

  it('CONSUMER_PRICING_PAISA.unlimited (server charge, ×100) === { monthly: 109900, yearly: 879900 }', () => {
    expect({
      monthly: CONSUMER_PRICING_PAISA.unlimited.monthly,
      yearly: CONSUMER_PRICING_PAISA.unlimited.yearly,
    }).toEqual({ monthly: 109900, yearly: 879900 });
  });

  it('the derived paisa constant is exactly the rupee price × 100 (no rounding drift)', () => {
    expect(CONSUMER_PRICING_PAISA.unlimited.monthly).toBe(
      PRICING.unlimited.monthly * 100,
    );
    expect(CONSUMER_PRICING_PAISA.unlimited.yearly).toBe(
      PRICING.unlimited.yearly * 100,
    );
  });

  it('code unlimited price EQUALS the DB-canonical migration value (cross-source convergence)', () => {
    const db = parseDbUnlimitedPrice();
    expect(db).toEqual({ monthly: 1099, yearly: 8799 });
    // The single load-bearing convergence assertion: web/server code === DB.
    expect({
      monthly: PRICING.unlimited.monthly,
      yearly: PRICING.unlimited.yearly,
    }).toEqual(db);
  });

  it('starter and pro are UNCHANGED — only unlimited moved', () => {
    // Guard that the convergence touched exactly one plan. If these break, the
    // edit reached further than the unlimited plan and must be reviewed.
    expect({
      monthly: PRICING.starter.monthly,
      yearly: PRICING.starter.yearly,
    }).toEqual({ monthly: 299, yearly: 2399 });
    expect({
      monthly: PRICING.pro.monthly,
      yearly: PRICING.pro.yearly,
    }).toEqual({ monthly: 699, yearly: 5599 });
    // ...and their derived paisa twins.
    expect(CONSUMER_PRICING_PAISA.starter).toEqual({
      monthly: 29900,
      yearly: 239900,
    });
    expect(CONSUMER_PRICING_PAISA.pro).toEqual({
      monthly: 69900,
      yearly: 559900,
    });
  });
});
