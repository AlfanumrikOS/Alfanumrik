/**
 * PAY-2 [payments / P11-adjacent] — consumer-pricing source-of-truth drift guard
 * + DB-divergence pin.
 *
 * BACKGROUND. There are FIVE places a consumer plan price lives (see
 * engineering-audit/remediation/pay-2-pricing-source/01-design.md §1):
 *
 *   #1 src/lib/plans.ts            `PRICING`               (INR rupees)
 *   #2 src/lib/pricing.ts          `CONSUMER_PRICING_PAISA` (paisa = #1 × 100)
 *   #3 create-order/route.ts       the paisa amount it charges — after PAY-2 L1
 *                                  it IMPORTS `CONSUMER_PRICING_PAISA` (= #2),
 *                                  so the SERVER source IS #2. (MOBILE checkout)
 *   #4 subscription_plans DB row   set by migration 20260505155126 (rupees)
 *                                  (WEB checkout reads this)
 *   #5 mobile subscription.dart    `PlanInfo` literals      (INR rupees)
 *
 * Today #1, #2/#3 (server) and #5 all AGREE (unlimited = ₹1499/₹11999). The DB
 * (#4) DIVERGES: migration 20260505155126 set unlimited to ₹1099/₹8799. Because
 * web checkout reads the DB and mobile checkout reads the code, the SAME plan
 * bills DIFFERENTLY by platform. Reconciling that divergence is a CEO-gated
 * PRICING decision; this test does NOT resolve it — it makes it a VISIBLE,
 * CI-tracked fact instead of a silent drift.
 *
 * THIS FILE HAS TWO PARTS:
 *
 *   PART A — CODE-SOURCE PARITY GUARD (must stay green).
 *     Asserts the CODE sources are mutually consistent:
 *       plans.ts PRICING (rupees) × 100
 *         === pricing.ts CONSUMER_PRICING_PAISA (paisa) [= the SERVER source #3]
 *         === mobile subscription.dart (rupees) × 100
 *     for every plan + period. They agree today, so it PASSES and prevents any
 *     future code drift. This EXTENDS XC-6 (mobile↔web, REG-191) to also cover
 *     the SERVER paisa constant that create-order now charges from.
 *     NON-VACUOUS: asserts >= 3 plans parsed from each side.
 *
 *   PART B — DB-DIVERGENCE PIN (green — it asserts the divergence EXISTS).
 *     Extracts the DB `unlimited` price from migration 20260505155126 and
 *     asserts it DIFFERS from the code `unlimited` price. This pins the KNOWN,
 *     unresolved billing discrepancy so it cannot vanish silently.
 *
 *     ⚠️  KNOWN DIVERGENCE PENDING CEO DECISION (PAY-2 Open question #1).
 *     When the CEO picks the canonical `unlimited` price and the DB↔code are
 *     reconciled, PART B's "differs" assertions will start FAILING by design —
 *     that failure is the signal to UPDATE/REMOVE this pin and (if the canonical
 *     value lands in code) tighten it into a "DB === code" parity assertion.
 *     DO NOT silently weaken PART B to make it pass; reconcile the sources.
 *
 * TEST-ONLY PIN: never edits plans.ts, pricing.ts, the migration, or the Dart
 * file. It only reads them and asserts relationships.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRICING } from '@/lib/plans';
import { CONSUMER_PRICING_PAISA } from '@/lib/pricing';

const MOBILE_SUBSCRIPTION_PATH = resolve(
  process.cwd(),
  'mobile/lib/data/models/subscription.dart',
);
const DB_MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260505155126_fix_pricing_family_school_plan.sql',
);

interface PlanPrice {
  monthly: number;
  yearly: number;
}

/**
 * Parse Flutter `PlanInfo(... code:'x' ... priceMonthly:N ... priceYearly:N ...)`
 * blocks. Mirrors the parse anchor used by XC-6.
 */
function parseMobilePrices(): Record<string, PlanPrice> {
  const text = readFileSync(MOBILE_SUBSCRIPTION_PATH, 'utf8');
  const re =
    /code:\s*'([^']+)'[\s\S]*?priceMonthly:\s*(\d+)[\s\S]*?priceYearly:\s*(\d+)/g;
  const out: Record<string, PlanPrice> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out[m[1]] = { monthly: Number(m[2]), yearly: Number(m[3]) };
  }
  return out;
}

/**
 * Extract the `unlimited` rupee amounts the DB migration sets. The migration
 * (20260505155126_fix_pricing_family_school_plan.sql) is a single
 * `UPDATE subscription_plans SET price_monthly = N, price_yearly = M
 *  WHERE plan_code = 'unlimited'`.
 *
 * PARSE ANCHOR (documented so a future migration edit that breaks it is
 * obvious): `price_monthly = <int>` and `price_yearly = <int>` within the file.
 */
function parseDbUnlimitedPrice(): PlanPrice {
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

// ─────────────────────────────────────────────────────────────────────────────
// PART A — CODE-SOURCE PARITY GUARD (green: extends XC-6 to the server constant)
// ─────────────────────────────────────────────────────────────────────────────
describe('PAY-2 Part A: consumer code-pricing source parity (drift guard)', () => {
  const mobile = parseMobilePrices();
  const planCodes = Object.keys(PRICING);

  it('parsed >= 3 plans from plans.ts PRICING (non-vacuous)', () => {
    expect(planCodes.length).toBeGreaterThanOrEqual(3);
  });

  it('parsed >= 3 plans from pricing.ts CONSUMER_PRICING_PAISA (server source, non-vacuous)', () => {
    expect(Object.keys(CONSUMER_PRICING_PAISA).length).toBeGreaterThanOrEqual(3);
  });

  it('parsed >= 3 plans from mobile subscription.dart (non-vacuous)', () => {
    expect(Object.keys(mobile).length).toBeGreaterThanOrEqual(3);
    for (const [code, p] of Object.entries(mobile)) {
      expect(Number.isInteger(p.monthly), `${code}.monthly parsed`).toBe(true);
      expect(Number.isInteger(p.yearly), `${code}.yearly parsed`).toBe(true);
      expect(p.monthly).toBeGreaterThan(0);
      expect(p.yearly).toBeGreaterThan(0);
    }
  });

  it('plans.ts PRICING × 100 === CONSUMER_PRICING_PAISA (server source) for every plan + period', () => {
    for (const code of planCodes) {
      const rupees = PRICING[code as keyof typeof PRICING];
      const paisa = CONSUMER_PRICING_PAISA[code as keyof typeof CONSUMER_PRICING_PAISA];
      expect(
        paisa,
        `CONSUMER_PRICING_PAISA missing entry for plan "${code}" present in plans.ts`,
      ).toBeDefined();
      expect(
        paisa.monthly,
        `monthly paisa drift for "${code}": pricing.ts=${paisa.monthly} expected=${rupees.monthly * 100}`,
      ).toBe(rupees.monthly * 100);
      expect(
        paisa.yearly,
        `yearly paisa drift for "${code}": pricing.ts=${paisa.yearly} expected=${rupees.yearly * 100}`,
      ).toBe(rupees.yearly * 100);
    }
  });

  it('CONSUMER_PRICING_PAISA (server source) === mobile subscription.dart × 100 for every plan + period', () => {
    for (const [code, m] of Object.entries(mobile)) {
      const paisa = CONSUMER_PRICING_PAISA[code as keyof typeof CONSUMER_PRICING_PAISA];
      expect(
        paisa,
        `mobile declares plan "${code}" but CONSUMER_PRICING_PAISA has no entry for it`,
      ).toBeDefined();
      expect(
        paisa.monthly,
        `monthly drift mobile↔server for "${code}": mobile×100=${m.monthly * 100} server=${paisa?.monthly}`,
      ).toBe(m.monthly * 100);
      expect(
        paisa.yearly,
        `yearly drift mobile↔server for "${code}": mobile×100=${m.yearly * 100} server=${paisa?.yearly}`,
      ).toBe(m.yearly * 100);
    }
  });

  it('every code-priced plan exists in all three code sources (no orphan plan)', () => {
    for (const code of planCodes) {
      expect(
        CONSUMER_PRICING_PAISA[code as keyof typeof CONSUMER_PRICING_PAISA],
        `plan "${code}" in plans.ts but missing from CONSUMER_PRICING_PAISA`,
      ).toBeDefined();
      expect(
        mobile[code],
        `plan "${code}" in plans.ts but missing from mobile subscription.dart`,
      ).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PART B — DB-DIVERGENCE PIN (green: asserts the KNOWN divergence EXISTS)
//
//   ⚠️  KNOWN DIVERGENCE PENDING CEO DECISION (PAY-2 Open question #1).
//   The DB `unlimited` price (₹1099/₹8799, migration 20260505155126) DIFFERS
//   from the code `unlimited` price (₹1499/₹11999). Web checkout bills the DB
//   value; mobile checkout bills the code value — same plan, two prices.
//
//   When the CEO picks the canonical price and DB↔code are reconciled, these
//   `not.toBe`/`not.toEqual` assertions will FAIL — that is the SIGNAL to update
//   or remove this pin (and, if the canonical value lands in code, replace it
//   with a DB===code parity assertion). DO NOT weaken PART B to keep it green.
// ─────────────────────────────────────────────────────────────────────────────
describe('PAY-2 Part B: DB↔code unlimited-price divergence pin (KNOWN, CEO-pending)', () => {
  const db = parseDbUnlimitedPrice();
  const code = PRICING.unlimited;

  it('extracted the DB unlimited price from migration 20260505155126 (non-vacuous)', () => {
    expect(Number.isInteger(db.monthly)).toBe(true);
    expect(Number.isInteger(db.yearly)).toBe(true);
    expect(db.monthly).toBeGreaterThan(0);
    expect(db.yearly).toBeGreaterThan(0);
  });

  it('documents the exact known values: DB = ₹1099/₹8799, code = ₹1499/₹11999', () => {
    // These literals encode the CURRENT KNOWN STATE. If either side moves, this
    // test breaks and forces a deliberate reconciliation decision (see header).
    expect(db).toEqual({ monthly: 1099, yearly: 8799 });
    expect({ monthly: code.monthly, yearly: code.yearly }).toEqual({
      monthly: 1499,
      yearly: 11999,
    });
  });

  it('DB unlimited monthly DIFFERS from code unlimited monthly (divergence exists)', () => {
    expect(db.monthly).not.toBe(code.monthly);
  });

  it('DB unlimited yearly DIFFERS from code unlimited yearly (divergence exists)', () => {
    expect(db.yearly).not.toBe(code.yearly);
  });
});
