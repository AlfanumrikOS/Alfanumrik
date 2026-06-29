# PAY-2 Layer 1 — Implementation (amount-preserving drift elimination)

**Status:** IMPLEMENTED (Layer 1 only — server de-dup, no amount change)
**Owner:** backend
**Date:** 2026-06-29
**CEO-gated?** NO. Layer 1 swaps an inline paisa literal for an imported constant of byte-identical value. No amount, no DB row, no payment-flow logic changed.
**Scope of this change:** `src/app/api/payments/create-order/route.ts` only (+ one import). The remediation doc. Nothing else.

---

## 1. What changed

`create-order/route.ts` (the MOBILE checkout path) previously held an INLINE paisa
`PRICING` literal. It now imports `CONSUMER_PRICING_PAISA` from `@/lib/pricing`
(= `plans.ts` `PRICING` × 100), the canonical paisa source that was already
exported but not yet wired in. This mechanically eliminates the create-order ↔
plans.ts code-mirror drift (previously only *detected* by XC-6; now it *cannot
occur* — there is one literal).

### Before (route.ts ~lines 120–127)
```ts
// Plan pricing (in paisa — Razorpay uses smallest currency unit)
const PRICING: Record<string, { monthly: number; yearly: number }> = {
  starter:   { monthly: 29900,   yearly: 239900 },   // ₹299/mo, ₹2399/yr
  pro:       { monthly: 69900,   yearly: 559900 },   // ₹699/mo, ₹5599/yr
  unlimited: { monthly: 149900,  yearly: 1199900 },  // ₹1499/mo, ₹11999/yr
};

const taxablePaisa = PRICING[plan_code][billing_cycle as 'monthly' | 'yearly'];
```

### After
```ts
// (new import near the top of the file)
import { CONSUMER_PRICING_PAISA, type ConsumerPlanCode } from '@/lib/pricing';

// ...

// Plan pricing (in paisa — Razorpay uses smallest currency unit).
// PAY-2 Layer 1 (amount-preserving de-dup): create-order now reads the shared
// CONSUMER_PRICING_PAISA (= plans.ts PRICING × 100) instead of an inline literal.
// No amount changed — byte-identical to the prior inline values.
// ⚠️ PAY-2 PENDING CEO DECISION: the DB subscription_plans.unlimited row (web
// path) is ₹1099/₹8799 per migration 20260505155126 while this code mirror
// (mobile path) charges ₹1499/₹11999. That DB↔code divergence is CEO-gated and
// is deliberately NOT touched here (see 01-design.md Open question #1).
const pricingByCycle = CONSUMER_PRICING_PAISA[plan_code as ConsumerPlanCode];
if (!pricingByCycle) {
  return NextResponse.json({ error: 'Plan not available' }, { status: 400 });
}
const taxablePaisa = pricingByCycle[billing_cycle as 'monthly' | 'yearly'];
```

Everything downstream of `taxablePaisa` — the GST gate (`gstChargingEnabled`,
`computeGst`), the Razorpay order body, `notes`, auth (`authorizeRequest` +
`getUser`), the redundant-purchase guard, and PostHog telemetry — is UNCHANGED.

---

## 2. Byte-identical confirmation

| Plan | plans.ts (INR) | × 100 = `CONSUMER_PRICING_PAISA` | Prior inline literal | Match |
|---|---|---|---|---|
| starter monthly | 299 | 29900 | 29900 | ✅ |
| starter yearly | 2399 | 239900 | 239900 | ✅ |
| pro monthly | 699 | 69900 | 69900 | ✅ |
| pro yearly | 5599 | 559900 | 559900 | ✅ |
| unlimited monthly | 1499 | 149900 | 149900 | ✅ |
| unlimited yearly | 11999 | 1199900 | 1199900 | ✅ |

All six charged values are byte-identical before and after. The charged amount,
order body, and GST behavior are unchanged. This is a pure read-source de-dup.

Source confirmation:
- `src/lib/plans.ts:94-98` — `PRICING` = `{starter:299/2399, pro:699/5599, unlimited:1499/11999}`.
- `src/lib/pricing.ts:71-78` — `CONSUMER_PRICING_PAISA` = those × 100.
- `create-order/route.ts` (prior) — inline literal = those × 100. Identical.

---

## 3. What is explicitly NOT changed (P11 / scope safety)

- **No amount moved.** Not CEO-gated.
- **DB `subscription_plans` untouched.** The DB↔code `unlimited` divergence
  (DB 1099/8799 vs code 1499/11999) is left as-is and flagged in-code + here as
  the PENDING CEO decision. L1 only de-dups the CODE mirrors, which already agree.
- **Web `subscribe`/`verify`/`setup-plans` paths untouched.**
- **`plans.ts`, `pricing.ts`, mobile literals untouched.**
- **Payment-flow logic untouched:** webhook signature verification, verify HMAC
  (`timingSafeEqual`), atomic activation RPCs, idempotency, GST gate, kill-switch.
- A defensive `undefined`-lookup 400 was added (cannot regress behavior — the
  schema already constrains `plan_code` to the same enum keys as the constant).

---

## 4. Verification results

- `npm run type-check` — PASS (tsc --noEmit, no errors).
- `npm run lint` — PASS (0 errors; 6 pre-existing unrelated warnings in
  layout.tsx / learn page / oauth-apps page / logger.ts — none in the changed file).

---

## 5. What's left

### Layer 2 (testing — owned by testing agent)
Parity guard per 01-design.md §5.2: a unit test asserting
`plans.ts.PRICING × 100 === CONSUMER_PRICING_PAISA` and a static-source assertion
that `create-order/route.ts` no longer declares an inline numeric paisa literal
(so the de-dup cannot silently regress). Optional 2c live-DB lane (skipIf empty
table) asserting `subscription_plans` rows equal the canonical fixture. New
regression-catalog entry to be assigned by testing (after REG-175).

### tests (testing)

<!-- testing agent fills this section -->

### CEO decision (BLOCKING full consolidation — not part of L1/L2)
The true `unlimited` price must be confirmed: ₹1499/₹11999 (plans.ts + create-order
+ mobile, what mobile buyers pay today) vs ₹1099/₹8799 (the DB, what web buyers
pay today per migration 20260505155126). Until decided, web and mobile bill
different prices for the same plan. L1 surfaces this; it does not pick a side.
If it resolves to ₹1099, the `payment_history.amount` rows mobile wrote at ₹1499
and the MRR estimate need a reconciliation sweep (flagged for ops/finance).
