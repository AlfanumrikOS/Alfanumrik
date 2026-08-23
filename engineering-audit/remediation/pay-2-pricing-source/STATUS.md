# STATUS: PAY-2 — Pricing source-of-truth (drift elimination)

**PAY-2 LANDED — code-mirror drift eliminated + parity guard + DB-divergence pinned; canonical `unlimited` price RESOLVED (PR #1179 / commit `9d19cd7618`, 2026-06-30) — converged to ₹1099/₹8799, REG-196 tightened to REG-207.**

- **Item:** PAY-2 (post-program remediation backlog, Tier-1; surfaced Cycle 2 — payments-subscriptions)
- **Invariant:** P11 (payment integrity) — read-source-only de-dup, **no amount moved**
- **Owner squad:** backend (L1 de-dup) + testing (L2 parity/divergence) + architect (P11 review) + mobile (contract review) + quality
- **CEO gate:** the recommended L1/L2 fix is **NOT** CEO-gated (no amount changes). The canonical `unlimited` price (DB ₹1099 vs code ₹1499) **IS** USER-GATED.
- **Started / landed:** 2026-06-29
- **Status:** **LANDED — APPROVE; Gate 5 CLOSED. Canonical `unlimited` price = RESOLVED (PR #1179 / commit `9d19cd7618`, 2026-06-30, REG-207) — see "Deferred / residual" item 1 below.**

## Ledger
| Step | Artifact | Done |
|---|---|---|
| DESIGN (backend — pricing-source map + chosen fix) | `01-design.md` | [x] |
| IMPLEMENTATION (backend — L1 amount-preserving de-dup) | `02-implementation.md` | [x] |
| VALIDATION (quality APPROVE-WITH-CONDITIONS → condition MET + residual register) | `03-validation.md` | [x] |

## What landed
- **L1 (backend)** — `src/app/api/payments/create-order/route.ts` now imports `CONSUMER_PRICING_PAISA`
  from `@/lib/pricing` (= `plans.ts` `PRICING` × 100) instead of an inline paisa literal —
  **byte-identical values, NOT a CEO-gated amount change**. Adds a fail-closed 400 for an unpriced
  `plan_code` (also fixes a latent 500-crash on the schema-valid-but-unpriced `free` code). The
  mobile↔web↔server code-mirror drift now *cannot occur* (one literal), where XC-6 previously only
  *detected* it. P11 surfaces (signature verification / atomic activation / idempotency / GST gate /
  `payments.subscribe` auth) all UNTOUCHED.
- **L2 (testing)** → **REG-195 / REG-196** — `src/__tests__/payments/consumer-pricing-sot-drift.test.ts`
  (10 tests). **Part A** = four-way CODE-mirror parity lock (`plans.ts × 100 == CONSUMER_PRICING_PAISA ==
  mobile × 100`). **Part B** = DB-divergence pin documenting the live `unlimited` discrepancy (DB ₹1099/8799
  vs code ₹1499/11999) as a visible CI fact — flips to a `DB === code` parity assertion once the CEO picks
  the canonical amount.

## Gates
- type-check **PASS** | lint **0 errors** | tests **14/14 (PAY-2 + XC-6) + 333/333 broad payment/pricing** |
  build **PASS**. Quality **APPROVE WITH CONDITIONS** → condition MET.
- **P14 PAYMENT-FLOW chain CLOSED (Gate 5):** backend (impl) + **architect (P11 APPROVE)** + **mobile
  (contract APPROVE)** + testing (REG-195/196) + quality (independent APPROVE).
- Catalog 161 → **163** (REG-195 / REG-196).

## Deferred / residual
1. **Canonical `unlimited` price — RESOLVED (P11).** Web checkout read the DB
   (`subscription_plans.unlimited` = ₹1099/₹8799); mobile checkout read the code mirror (₹1499/₹11999) —
   the SAME plan was billed differently by platform. **Resolved via PR #1179 (commit `9d19cd7618`,
   2026-06-30):** CEO-approved convergence to the DB-canonical **₹1099/₹8799** (per the commit message,
   "strictly downward — customer-favorable, never overcharges"). See
   `apps/host/src/app/api/payments/create-order/route.ts` (~lines 116-136, citing migration
   `20260505155126`) and `packages/lib/src/plans.ts` (`PRICING.unlimited` = `{monthly: 1099, yearly: 8799}`).
   **REG-196** (the DB-divergence pin) was tightened into **REG-207** — a `DB === code` convergence-pin
   (`toEqual`) in `apps/host/src/__tests__/payments/consumer-pricing-sot-drift.test.ts`, asserting both
   sides equal `{monthly: 1099, yearly: 8799}`. The `payment_history.amount` reconciliation sweep for
   mobile rows historically captured at ₹1499, and the MRR estimate correction, remain a separate,
   financially-sensitive item tracked outside this doc.
2. **`subscription_plans` seed into the migration chain — architect dependency (not a CEO gate).** The
   schema-only baseline carries no seed rows, so a fresh DB has an empty table; "DB as single canonical
   source" is fragile and the L2 live-DB parity lane stays `skipIf` until the seed is folded in
   (schema-reproducibility track).

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (L1 de-dup) | backend | 2026-06-29 | DONE |
| Security / P11 (Gate 5) | architect | 2026-06-29 | **APPROVE** |
| Mobile contract (Gate 5) | mobile | 2026-06-29 | **APPROVE** |
| Testing (L2) | testing | 2026-06-29 | **GREEN** — REG-195 / REG-196 filed |
| Quality (independent) | quality | 2026-06-29 | **APPROVE WITH CONDITIONS** → condition MET |
