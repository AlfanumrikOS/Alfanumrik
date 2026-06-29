# PAY-2 — Pricing Source-of-Truth (drift elimination)

**Status:** DESIGN ONLY (read-only investigation, no code changed)
**Owner:** backend
**Reviewers required before implementation:** architect (migration/DB authority + P11 signature/atomicity untouched), frontend (super-admin revenue display), mobile (create-order is the mobile checkout path), testing (parity-guard extension)
**Date:** 2026-06-29
**CEO-gated?** The recommended Phase-1 fix is NOT CEO-gated (no amount changes). One latent divergence (the `unlimited` plan) IS a pricing decision and IS escalated to CEO — see "Open question #1".

---

## 1. Pricing-source map (file:line + table)

There are **five** places a consumer plan price lives. Four are code mirrors; one is the DB.

| # | Source | Unit | Values (starter / pro / unlimited) | Who reads it at runtime |
|---|--------|------|-------------------------------------|--------------------------|
| 1 | `src/lib/plans.ts:94-98` — `export const PRICING` | INR rupees | 299·2399 / 699·5599 / **1499·11999** | UI: PricingCards, UpgradeModal; super-admin revenue estimate `src/app/super-admin/subscriptions/page.tsx:145-152`; re-exported by pricing.ts |
| 2 | `src/lib/pricing.ts:53,61` re-export + `:71-78` `CONSUMER_PRICING_PAISA` | rupees (re-export) / **paisa** | derived ×100 from #1 → 29900·239900 / 69900·559900 / **149900·1199900** | Nothing wired yet — built explicitly as the drift-detection mirror of create-order; comment at `:68-69` says "NOT yet wired into the order route (P11 surface)" |
| 3 | `src/app/api/payments/create-order/route.ts:121-125` — inline `const PRICING` | **paisa** | 29900·239900 / 69900·559900 / **149900·1199900** (= ₹1499/₹11999) | **MOBILE checkout** → `mobile/lib/core/constants/api_constants.dart:30` + `mobile/lib/data/repositories/subscription_repository.dart:46` |
| 4 | `subscription_plans` DB table (`price_monthly`, `price_yearly`, INR rupees — baseline `00000000000000_baseline_from_prod.sql:14163-14164`, comment "in INR rupees not paisa") | rupees | starter/pro: seeded outside the schema-only baseline (unverifiable statically); **unlimited set to 1099·8799** by `supabase/migrations/20260505155126_fix_pricing_family_school_plan.sql:4-9` | **WEB checkout** `subscribe/route.ts:121-130`; **verify** `verify/route.ts:217-232` (records `payment_history.amount`); **setup-plans** `setup-plans/route.ts:36-41,60-63,83-87` (provisions Razorpay Plan objects → fixes the monthly recurring charge) |
| 5 | `mobile/lib/data/models/subscription.dart:67-99` — `PlanInfo` literals | rupees | 299·2399 / 699·5599 / **1499·11999** | Mobile UI display only (server is authoritative for the charge) |

Razorpay-facing flow summary (which source decides the actual charge):

- **Web monthly** → `subscribe` → Razorpay *subscription* on `razorpay_plan_id_monthly`. That Plan object was minted by `setup-plans` from **DB `price_monthly`** (source #4). → charge = DB.
- **Web yearly** → `subscribe` → `createRazorpayOrder(amountInr = plan.price_yearly)` from **DB** (source #4). → charge = DB.
- **Mobile (both cycles)** → `create-order` → order `amount` from the **inline paisa `PRICING`** (source #3). → charge = code mirror.
- **Webhook** `payments/webhook/route.ts` trusts Razorpay's captured `payment.amount`; it does not re-derive price. So it faithfully records whatever #3 or #4 charged.

Existing guards:
- `src/__tests__/cross-cutting/mobile-web-subscription-price-drift.test.ts` (XC-6) pins **#5 == #1** (mobile == plans.ts). This is the "web==mobile" parity referenced in the task brief.
- `src/__tests__/pricing-drift-guard.test.ts` (REG-154) pins the **B2B per-seat** SoT in `pricing.ts` — it does **not** cover the B2C consumer plans or the DB.

So today: **#1, #3, #5 all agree** (1499/11999 for unlimited). **#4 (DB) is the divergent one.** Nothing mechanically links #3 (create-order) to #1/#2, and nothing at all links any code mirror to #4 (DB).

---

## 2. Drift risk (confirmed static divergence; possibly live)

### 2a. The confirmed divergence
The last migration to touch the table — `20260505155126_fix_pricing_family_school_plan.sql` — sets `unlimited` to **₹1099/mo, ₹8799/yr** (renamed "Family / School"). All three code mirrors still say **₹1499/mo, ₹11999/yr**. `src/lib/pricing.ts:45` even documents the canonical as `unlimited"/Family-School plan: ₹1,099/mo` — i.e. plans.ts (1499) is treated as the stale mirror by the pricing module's own header.

### 2b. What breaks
Because web reads the DB (#4) and mobile reads the code constant (#3):

1. **Same plan, different price by platform (billing-trust / consumer-law / P11-adjacent).** A *mobile* buyer of "unlimited" is charged **₹1499** (create-order #3); a *web* buyer of "unlimited" is charged **₹1099** (subscribe→DB #4). Identical product, two prices, decided purely by client.
2. **`payment_history.amount` ≠ captured amount.** `verify` writes `amount = DB price (1099)` while a mobile order actually captured **1499** via create-order. Reconciliation and finance reports disagree with the gateway.
3. **Over-stated MRR.** The super-admin revenue estimate (`subscriptions/page.tsx:145-152`) multiplies by plans.ts (1499), over-reporting unlimited revenue vs the ₹1099 actually billed on web.

### 2c. Fresh-DB fragility (secondary)
The baseline (`00000000000000_baseline_from_prod.sql`) is **schema-only** — it contains no `INSERT`/`COPY` for `subscription_plans`. The seed rows live outside the live migration chain (prod has them; the archived legacy seed had them). On a fresh project (CI live-DB, new staging, DR), the table is empty, `20260505155126`'s `UPDATE` affects 0 rows, and `subscribe`/`verify`/`setup-plans` return "Plan not available". This makes "promote the DB to the single canonical source" fragile until the seed is folded into the chain (tracked under schema-reproducibility debt, not PAY-2).

---

## 3. Chosen fix

> The two code mirrors (#1/#3/#5) agree; the DB (#4) does not. Therefore a *true* single-source consolidation cannot be done without **changing an amount** — collapsing create-order onto the DB would move the mobile `unlimited` charge from ₹1499 → ₹1099, which is a pricing change (CEO-gated) and violates PAY-2's "every amount unchanged" constraint. So full consolidation is blocked on a CEO pricing decision (Open question #1).

**Recommendation: a two-layer fix — server de-duplication (no amount change) + a mechanical parity guard extending XC-6 to the server constant and the DB.** This is option (b) with a small, safe slice of option (a) that does not touch any amount.

### Layer 1 — collapse create-order's literal into the existing exported constant (option-a slice, amount-preserving)
Replace the inline `const PRICING` paisa map in `create-order/route.ts:121-125` with the already-exported `CONSUMER_PRICING_PAISA` from `src/lib/pricing.ts` (source #2), which is `plans.ts.PRICING × 100`.

- **Byte-identical:** plans.ts ×100 = `{starter:29900/239900, pro:69900/559900, unlimited:149900/1199900}` — exactly the current inline literal. **No amount changes.** Pure refactor.
- **Effect:** create-order (#3) can no longer drift from plans.ts (#1) — they become one literal. The mobile↔server code-mirror drift is eliminated *mechanically* (today it's eliminated only by XC-6 *detecting* drift; after this it cannot occur).
- **Not CEO-gated** (no number moves).

### Layer 2 — parity-guard test (option b), extending XC-6 to the server + DB
Add a guard test that asserts the consumer-plan price is identical across all sources:

- **2a (pure unit, ships green now):** `plans.ts.PRICING × 100 === CONSUMER_PRICING_PAISA === the paisa map create-order actually uses`. After Layer 1 this is trivially true (one literal), but the assertion pins it so a future hand-edit re-introducing an inline literal fails CI.
- **2b (code↔DB canonical map):** assert `plans.ts.PRICING` equals an explicit **canonical expectation fixture** for `subscription_plans`. This is the layer that *surfaces* the unlimited divergence (1499 code vs 1099 DB-migration). It is a static/source-level test that encodes the CEO-decided canonical value; it changes no amount.
- **2c (optional live-DB integration job):** in the CI live-DB lane, `SELECT plan_code, price_monthly, price_yearly FROM subscription_plans WHERE is_active` and assert each row equals the canonical fixture. Skipped in the unit env (table empty there — see §2c).

This mirrors XC-6's "drift in either direction fails CI" philosophy and REG-154's "test-only pin, never edits the source" rule, extended from mobile↔web to **mobile ↔ web ↔ server-constant ↔ DB**.

### Why not full single-source now
- Promoting the DB to canonical changes the mobile `unlimited` charge (CEO-gated) and is fragile on un-seeded fresh DBs (§2c).
- Promoting plans.ts to canonical and rewriting `subscribe`/`verify`/`setup-plans` to read it would change the *web* `unlimited` charge from ₹1099 → ₹1499 (also CEO-gated) and is a high-blast-radius edit to the P11 verify/atomic path.
- Either direction is a price change. PAY-2's mandate is drift-elimination *without* a price change, so the safe deliverable is: de-dup what already agrees (Layer 1) + make all four sources CI-linked (Layer 2), and escalate the one real disagreement to CEO.

---

## 4. Confirmation: NO amount changes (not a CEO-gated pricing change)

- **Layer 1** swaps an inline literal for an imported constant of **identical value** (29900/239900, 69900/559900, 149900/1199900 paisa). Verified byte-for-byte against `CONSUMER_PRICING_PAISA` (`pricing.ts:71-78`) and `plans.ts.PRICING × 100`. The Razorpay order body, GST gate, auth, and signature paths are untouched.
- **Layer 2** is test-only; it never edits a price source.
- No row in `subscription_plans` is mutated. No constant in `plans.ts`/`pricing.ts`/`subscription.dart` is changed.
- Therefore this is a **centralization + guard** change, explicitly NOT a pricing change → **not CEO-gated** per `.claude/CLAUDE.md` "User Approval Required For".
- The single pre-existing divergence (`unlimited` 1499 vs 1099) is **reported, not silently reconciled** — resolving it IS a CEO pricing decision (Open question #1).

---

## 5. Code / test sketch (outline, not runnable)

### 5.1 Layer-1 create-order edit (amount-preserving de-dup)
```ts
// src/app/api/payments/create-order/route.ts
import { CONSUMER_PRICING_PAISA } from '@/lib/pricing';
// remove the inline `const PRICING = { starter:{...}, pro:{...}, unlimited:{...} }`
// (values are identical to CONSUMER_PRICING_PAISA — pure de-dup, no number moves)
const taxablePaisa =
  CONSUMER_PRICING_PAISA[plan_code as ConsumerPlanCode][billing_cycle as 'monthly' | 'yearly'];
// ...everything downstream (GST gate, order creation, signature, notes) UNCHANGED
```
Guard for an unknown `plan_code`: `paymentSubscribeSchema` already constrains `plan_code` to the enum, and `CONSUMER_PRICING_PAISA` has the same three keys; keep a defensive 400 if the lookup is undefined.

### 5.2 Layer-2 parity guard (new test file, e.g. `src/__tests__/payments/consumer-pricing-sot-drift.test.ts`)
```ts
import { PRICING } from '@/lib/plans';
import { CONSUMER_PRICING_PAISA } from '@/lib/pricing';

// CANONICAL fixture — the CEO-decided consumer price (single place a reviewer edits).
const CANONICAL_RUPEES = {
  starter:   { monthly: 299,  yearly: 2399 },
  pro:       { monthly: 699,  yearly: 5599 },
  unlimited: { monthly: 1499, yearly: 11999 }, // OPEN: DB migration says 1099/8799 — CEO to confirm
} as const;

describe('Consumer pricing SoT drift guard (PAY-2)', () => {
  it('plans.ts === canonical', () => expect(PRICING).toEqual(CANONICAL_RUPEES));
  it('paisa mirror === plans.ts × 100', () => {
    for (const code of Object.keys(CANONICAL_RUPEES) as (keyof typeof CANONICAL_RUPEES)[]) {
      expect(CONSUMER_PRICING_PAISA[code].monthly).toBe(PRICING[code].monthly * 100);
      expect(CONSUMER_PRICING_PAISA[code].yearly).toBe(PRICING[code].yearly * 100);
    }
  });
  // 2c: live-DB lane only — query subscription_plans and assert === CANONICAL_RUPEES.
  //     describe.skipIf(noLiveDb) so the unit env (empty table) does not fail.
});
```
Plus a static-source assertion (mirroring XC-6) that `create-order/route.ts` no longer declares an inline numeric paisa literal (regex anchor), so the de-dup cannot silently regress.

### 5.3 DB seed-into-chain (NOT in this PR — flagged dependency)
Folding the `subscription_plans` seed into the migration chain (so fresh DBs and the 2c live-DB test have rows) belongs to the schema-reproducibility track and needs architect ownership. Layer 2c stays `skipIf` until then.

---

## 6. Rollback

- **Layer 1:** revert the one import + the `taxablePaisa` line back to the inline literal. Zero data/migration impact; values were identical, so no payment behavior changes either way.
- **Layer 2:** delete the test file. Test-only; no runtime surface.
- No migration is introduced by the recommended fix, so there is nothing to roll back on the DB side.

---

## 7. Verification / test plan

1. `npm run type-check` + `npm run lint`.
2. `npx vitest run src/__tests__/payments/consumer-pricing-sot-drift.test.ts` — new guard (2a/2b pass; 2c skipped in unit env).
3. Re-run existing pins, expected still green: `src/__tests__/cross-cutting/mobile-web-subscription-price-drift.test.ts` (XC-6), `src/__tests__/pricing-drift-guard.test.ts` (REG-154), `src/__tests__/payments/gst-tax-inclusive-charge.test.ts`, `src/__tests__/api/payments/status-and-setup-plans.test.ts`, `src/__tests__/payment.test.ts`.
4. Manual byte-diff: confirm create-order's effective paisa values are unchanged before/after Layer 1 (starter 29900/239900, pro 69900/559900, unlimited 149900/1199900).
5. (live-DB lane, when seed lands) enable 2c and assert `subscription_plans` rows equal the canonical fixture.
6. **New regression-catalog entry** (testing to assign id, after REG-175): "consumer pricing SoT drift guard — plans.ts ↔ create-order paisa ↔ subscription_plans DB linked in CI; P11-adjacent / REG-65 family; mobile-web-server-DB four-way parity."

---

## 8. P11 safety statement

- The change is **read-source-only**: it changes *where* create-order reads the paisa amount (imported constant vs inline literal of identical value), not the payment-flow logic.
- **Webhook signature verification** (`payments/webhook/route.ts`) and **verify HMAC** (`verify/route.ts:99-115`, `crypto.timingSafeEqual`) are **untouched**.
- **Atomic activation** (`activate_subscription_locked` in verify; `create_pending_subscription` in subscribe; the webhook's `activate_subscription`/`atomic_subscription_activation` fallback) is **untouched**.
- No plan access is granted/changed; the redundant-purchase guard, kill-switch, GST gate, and idempotency checks are all unchanged.
- Layer 2 is test-only and runs in CI, never in the request path.

---

## 9. Open questions / flags

1. **[CEO — pricing decision, BLOCKING full consolidation]** Which is the true `unlimited` price — **₹1499/₹11999** (plans.ts + create-order + mobile, what mobile buyers pay today) or **₹1099/₹8799** (the DB, what web buyers pay today, per migration `20260505155126`)? Until this is decided, web and mobile bill different prices for the same plan. The recommended fix does NOT silently pick one; it surfaces the gap. Resolving it is the only CEO-gated part.
2. **[Open — runtime verification, cannot do statically]** Confirm the *live prod* `subscription_plans.unlimited` row actually holds 1099/8799 (the migration's intent). I cannot query prod from this design pass. If prod was re-seeded to 1499 after the migration, the divergence is dormant rather than live — but the sources are still un-linked, so PAY-2 still applies.
3. **[architect — dependency]** The `subscription_plans` seed is not in the schema-only baseline; folding it into the migration chain is required before Layer-2c (live-DB parity) can be non-skipped, and before "DB as single canonical source" is even viable. Belongs to the schema-reproducibility track.
4. **[finance/ops]** If Open question #1 resolves to ₹1099, `payment_history.amount` rows written by mobile create-order at ₹1499 (and the MRR estimate) need a reconciliation sweep — out of scope for this code fix, flagged for ops.
