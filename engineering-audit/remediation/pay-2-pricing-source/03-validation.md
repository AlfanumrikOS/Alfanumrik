# PAY-2 — Independent Validation (quality) + Gate 5 closure + residual register

**Status:** VALIDATED — **APPROVE WITH CONDITIONS** → the single condition (close the payment-flow Gate 5) is now **MET**.
**Validator:** quality (independent of backend/testing/architect/mobile builders)
**Date:** 2026-06-29
**Change under review:**
- **L1 (backend):** `src/app/api/payments/create-order/route.ts` — inline paisa `PRICING` literal replaced by the imported `CONSUMER_PRICING_PAISA` from `@/lib/pricing` + a fail-closed 400 guard for an unpriced `plan_code`.
- **L2 (testing):** `src/__tests__/payments/consumer-pricing-sot-drift.test.ts` (10 tests) — the four-way code-mirror parity lock + the DB-divergence pin → **REG-195 / REG-196**.

**Verdict:** **APPROVE** — pure read-source de-duplication. Byte-identical paisa values (no amount moved); not a CEO-gated pricing change. The P11 signature-verification / atomic-activation / idempotency / GST gate / `payments.subscribe` auth surfaces are all untouched. The one true remaining pricing decision — the canonical `unlimited` price — is surfaced (not silently reconciled) and remains **USER-GATED**.

---

## 1. What landed

### L1 — create-order de-dup (amount-preserving)
`create-order/route.ts` (the MOBILE checkout path) previously held an INLINE paisa `PRICING` literal. It now imports `CONSUMER_PRICING_PAISA` (= `plans.ts` `PRICING` × 100), the canonical paisa source that was already exported but never wired in. This mechanically eliminates the create-order ↔ plans.ts code-mirror drift — previously only *detected* by XC-6, now it *cannot occur* (one literal). A defensive `undefined`-lookup 400 was added; this cannot regress behavior (the schema already constrains `plan_code` to the same enum keys as the constant) and additionally fixes a latent 500-crash on the schema-valid-but-unpriced `free` code (now a clean fail-closed 400).

**Byte-identical confirmation** (independently re-derived by quality against `plans.ts:94-98` × 100 and `pricing.ts:71-78`):

| Plan | plans.ts (INR) | × 100 | Prior inline literal | Match |
|---|---|---|---|---|
| starter monthly / yearly | 299 / 2399 | 29900 / 239900 | 29900 / 239900 | ✅ |
| pro monthly / yearly | 699 / 5599 | 69900 / 559900 | 69900 / 559900 | ✅ |
| unlimited monthly / yearly | 1499 / 11999 | 149900 / 1199900 | 149900 / 1199900 | ✅ |

All six charged values are byte-identical before and after. The Razorpay order body, GST gate, `notes`, auth, the redundant-purchase guard, and PostHog telemetry are UNCHANGED.

### L2 — four-way parity lock + DB-divergence pin (REG-195 / REG-196)
`src/__tests__/payments/consumer-pricing-sot-drift.test.ts` (10 tests):
- **Part A (REG-195) — four-way CODE-mirror parity lock:** `plans.ts.PRICING × 100 === CONSUMER_PRICING_PAISA === the paisa map create-order uses === mobile literals × 100`. After L1 this is trivially true for the create-order leg (one literal), but the assertion pins it so a future hand-edit re-introducing an inline literal — or a mobile/web drift — fails CI. Extends XC-6's "drift in either direction fails CI" from mobile↔web to **mobile ↔ web ↔ server-constant**.
- **Part B (REG-196) — DB-divergence pin:** documents the live `unlimited` discrepancy (DB ₹1099/8799 per migration `20260505155126` vs code ₹1499/11999) as a *visible CI fact*. This is the layer that surfaces the gap rather than hiding it; it is the assertion that flips from a divergence-pin into a `DB === code` parity assertion once the CEO picks the canonical amount.

---

## 2. Gates (quality APPROVE WITH CONDITIONS — verbatim)

| Gate | Result | Note |
|---|---|---|
| **type-check** | **PASS** | `tsc --noEmit` clean |
| **lint** | **PASS — 0 errors** | 6 pre-existing unrelated warnings (layout.tsx / learn page / oauth-apps page / logger.ts) — none in the changed file |
| **unit tests** | **PASS** | new `consumer-pricing-sot-drift.test.ts` **10/10**; combined **14/14** (PAY-2 + XC-6) + **333/333** broad payment/pricing suite. XC-6 (REG-191), REG-154, GST-gate, status-and-setup-plans, payment.test still green |
| **build** | **PASS** | L1 is a one-import + one-lookup-line change in an existing server route; L2 is test-only — no shared-chunk or page-budget impact |
| **Quality verdict** | **APPROVE WITH CONDITIONS** | condition = close the payment-flow Gate 5 (architect P11 + mobile contract). **Condition MET** — see §3. |
| **Regression catalog** | **REG-195 / REG-196** filed (P11-adjacent — four-way consumer-pricing SoT parity lock + DB-divergence pin; REG-65 family / cross-refs XC-6 REG-191). Catalog 161 → **163**. |

---

## 3. Gate 5 (payment-flow review chain) — CLOSED

The P14 PAYMENT-FLOW chain (`backend (made) → architect (security) + testing + mobile`) is **COMPLETE**:

- **backend** — L1 implementation (`02-implementation.md`): read-source-only de-dup; byte-identical; defensive 400; no payment-flow logic touched.
- **architect (P11 security)** — **APPROVE.** The change is read-source-only: it changes *where* create-order reads the paisa amount (imported constant vs inline literal of identical value), not the payment-flow logic. Webhook signature verification, verify HMAC (`timingSafeEqual`), atomic activation RPCs (`activate_subscription` / `atomic_subscription_activation` / `activate_subscription_locked`), idempotency (`payment_webhook_events`), the GST gate, and the kill-switch are all untouched. No plan access granted/changed. No migration introduced.
- **mobile (contract)** — **APPROVE.** create-order is the MOBILE checkout path; the order `amount` it returns is byte-identical before/after L1, so the Flutter order→checkout→verify contract is unchanged. (The pre-existing mobile-repoint follow-up — create-order → subscribe + nested-`data` unwrap + 409 mapping — is separate and out of PAY-2 L1/L2 scope.)
- **testing** — REG-195/196; 14/14 + 333/333 broad GREEN.
- **quality** — this document; independent **APPROVE**.

**Gate 5 condition RESOLVED → APPROVE WITH CONDITIONS becomes an unconditional landing.**

---

## 4. RESIDUAL — the canonical `unlimited` price is a SEPARATE, USER-GATED decision (the one true remaining pricing decision)

**L1 de-dups the CODE mirrors, which already agree (₹1499/₹11999). It does NOT touch the DB↔code divergence — that is the CEO-gated part.**

The SAME `unlimited` plan is billed differently by platform **today**:
- **Web checkout** reads the **DB** (`subscription_plans.unlimited` = **₹1099/mo, ₹8799/yr**, set by migration `20260505155126_fix_pricing_family_school_plan.sql`, renamed "Family / School").
- **Mobile checkout** reads the **code mirror** (create-order → `CONSUMER_PRICING_PAISA` = **₹1499/mo, ₹11999/yr**).

So a mobile buyer of "unlimited" pays **₹1499** while a web buyer of the same plan pays **₹1099** — identical product, two prices, decided purely by which client the buyer used. Downstream consequences: `payment_history.amount` (web-side ₹1099) disagrees with the gateway-captured amount on mobile (₹1499); the super-admin MRR estimate multiplies by plans.ts (₹1499), over-reporting `unlimited` revenue vs what web actually bills.

**This is a live billing-trust / consumer-law (DPDP-adjacent, mis-stated-price) exposure**, not a cosmetic mismatch. Full single-source consolidation is **BLOCKED** until the CEO picks the canonical amount:
- Collapsing create-order onto the DB moves the mobile `unlimited` charge ₹1499 → ₹1099 (a price change → CEO-gated).
- Rewriting `subscribe`/`verify`/`setup-plans` to read plans.ts moves the web `unlimited` charge ₹1099 → ₹1499 (a price change → CEO-gated, and a high-blast-radius edit to the P11 verify/atomic path).

**CEO action (the sharp decision):** confirm the canonical `unlimited` price — **₹1499/₹11999** (plans.ts + create-order + mobile, what mobile buyers pay today) **or ₹1099/₹8799** (the DB, what web buyers pay today). When chosen:
1. Reconcile DB ↔ code to the single canonical value.
2. Tighten **REG-196** from a divergence pin into a `DB === code` parity assertion (and enable the optional live-DB lane).
3. If it resolves to ₹1099, run a `payment_history.amount` reconciliation sweep on the mobile rows captured at ₹1499 + correct the MRR estimate (flagged for ops/finance).

**Secondary, architect-owned dependency (not a CEO gate):** the `subscription_plans` seed is not in the schema-only baseline (`00000000000000_baseline_from_prod.sql`), so on a fresh DB the table is empty and "DB as single canonical source" is fragile until the seed is folded into the migration chain (schema-reproducibility track). The L2 live-DB parity lane stays `skipIf` until then.

**Recorded as the open Tier-1 item** on the program RISK register (`STATE.md`) and the post-program remediation backlog (`PRIORITY-BACKLOG.md`):

> **PAY-2-canonical-price (Tier-1 USER-GATED, P11):** pick the canonical `unlimited` price — ₹1499/₹11999 (code/mobile) vs ₹1099/₹8799 (DB/web) — currently billed differently per platform for the same plan. On decision: reconcile DB↔code, tighten REG-196 into a `DB === code` assertion, and (if ₹1099) reconcile mobile `payment_history.amount` + MRR. Fold the `subscription_plans` seed into the migration chain (architect) before the live-DB parity lane can be non-skipped.

---

## 5. Sign-off

| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (L1 de-dup) | backend | 2026-06-29 | DONE (`02-implementation.md`) |
| Security / P11 (Gate 5) | architect | 2026-06-29 | **APPROVE** — read-source-only; P11 surfaces untouched |
| Mobile contract (Gate 5) | mobile | 2026-06-29 | **APPROVE** — order amount byte-identical; contract unchanged |
| Testing (L2) | testing | 2026-06-29 | **GREEN** — 10/10 + 14/14 + 333/333; **REG-195 / REG-196** filed |
| Quality (independent) | quality | 2026-06-29 | **APPROVE WITH CONDITIONS** → condition MET |

**L1 + L2: LANDED + APPROVED. Gate 5 CLOSED.**
**Canonical `unlimited` price: USER-GATED — the one true remaining pricing decision.**
