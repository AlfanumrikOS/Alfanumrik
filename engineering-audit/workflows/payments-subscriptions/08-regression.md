# 08 — Regression: Payments & Subscriptions (Cycle 2)

> Phase: REGRESSION. Dependent-workflow regression sweep.

- **Cycle:** cycle-2
- **Workflow:** payments-subscriptions (P11)
- **Verification squad:** **testing**
- **Date:** 2026-06-29
- **Validation reference:** `./07-validation.md`

## Regression sweep
- [x] Payment suite green — **236/236 PASS** (webhook integration, verify HMAC-reject, subscribe RBAC
  gate, reconcile atomic RPC, dedupe no-op, GST gates).
- [x] No previously-passing test now skipped or weakened — the new `verify-hmac-reject.test.ts` is an
  *additive* pin on a previously-unpinned P11(1) branch; the RBAC pin was *extended* from
  create-order/verify to also cover `subscribe`. No assertion was relaxed.
- [x] type-check green; lint 0 errors; build green; `vercel.json` VALID (12 → 13 crons, ≤ 40 Pro limit).

## P14 review-chain completeness (payment flow)
Per `.claude/skills/review-chains/SKILL.md`, a payment-flow change requires: **backend (made) →
architect + testing + mobile**, with frontend confirming the checkout client. All present:

| Role | Agent | Scope | Result |
|---|---|---|---|
| Maker | **backend** | PAY-1, PAY-3, PAY-5, PAY-7, PAY-8 (+ PAY-4 owned by architect) | DONE |
| Security review | **architect** | PAY-7 retry semantics + PAY-3 RPC reuse (signature/atomicity) + owns PAY-4 (`vercel.json`) | **APPROVE** |
| Coverage | **testing** | PAY-6 verify-HMAC-reject test + extend RBAC pin to `subscribe` + reconcile/dedupe regression | **GREEN** (236/236) |
| Downstream | **mobile** | confirm mobile checkout tolerates the new 403 (PAY-1) / 409 (PAY-8) from `subscribe` | reviewed — see residual risk (mobile still targets the dead `create-order`; repoint tracked) |
| Checkout client | **frontend** | confirm web checkout handles 403/409 cleanly | **SAFE-AS-IS** — `useCheckout` surfaces the structured error; no UI change needed |

**Chain: COMPLETE.**

## Dependent-workflow regression result
The payment spine is shared by checkout, the webhook, the reconcile/expired/pre-debit crons, and the
super-admin payment-ops surfaces. No regressions in the dependent flows that ride it:

| Dependent flow | Shared dependency | Regression? |
|---|---|---|
| Web checkout (`useCheckout` → `subscribe`) | now passes through the new `authorizeRequest` gate (PAY-1) + 409 guard (PAY-8) | none — legitimate student with grant + student row is byte-for-byte unchanged; only non-students / no-student-row principals are newly denied |
| Razorpay webhook activation | PAY-7 (env→503) + PAY-5 (observable dedupe) on the same handler | none — happy path + invalid-signature 400 unchanged; only env-misconfig and un-dedupable branches changed, both strictly safer |
| Reconcile cron self-heal | PAY-3 swaps two writes for the atomic RPC | none — `findStuckPayments` detection untouched; re-runs still no-ops; now atomic + advisory-locked |
| Expired / pre-debit crons | unchanged this cycle; share `verifyCronSecret` | none — not touched |
| Super-admin stuck-payments dashboard | reconcile no longer writes `students.subscription_expiry` | display-only: cosmetic stale/null in that view (no entitlement path reads it); tracked follow-up |
| Mobile checkout | still targets the dead `create-order`; documented-broken pre-cycle | unchanged — mobile path was already broken before this cycle; repoint to `subscribe` tracked |

## Existing payment-funnel regressions — still green
The pre-existing payment regression catalog entries are unaffected and remain green:

| REG-ID | Pins | Status after Cycle 2 |
|---|---|---|
| REG-46 | E2E payment funnel (checkout → verify → grant) | **green** — checkout still mocks `subscribe` + `verify`; new gate passes for the legitimate test principal |
| REG-47 | `atomic_plan_change` atomicity (bulk plan-change via RPC + advisory lock + audit in one transaction) | **green** — untouched; PAY-3 reuses the same atomic-activation discipline on the reconcile path |

## New regression catalog entries

| Proposed REG-ID | Invariant | What it pins | Test file | Filed in catalog? |
|---|---|---|---|---|
| REG-178 | P11 | `verify_route_hmac_reject` — verify route returns 401 on a tampered `razorpay_signature` with **no** `activate_subscription_locked` call (no grant) | `verify-hmac-reject.test.ts` | filed by separate testing task (in flight) |
| REG-179 | P9 / P11 | `subscribe_rbac_gate_pre_razorpay` — `subscribe` denies a non-`payments.subscribe` principal **before** any Razorpay object is created | extended `payments-subscribe-rbac.test.ts` | filed by separate testing task (in flight) |

> `.claude/regression-catalog.md` is authoritative. REG-178 / REG-179 are being added by a separate
> testing task; **confirm with the orchestrator if the ids shift** (next free ids after REG-177 from
> Cycle 1). The 236/236 payment suite already enforces both behaviors regardless of catalog filing.

## Coverage delta

| Metric | Before | After |
|---|---|---|
| Payment-suite assertions | (verify HMAC-reject unpinned; subscribe RBAC unpinned) | **236/236 PASS** — verify HMAC-reject + subscribe RBAC gate now pinned + reconcile-atomic + dedupe no-op regressions |
| Regression catalog entries | 144 (REG-177, Cycle 1) | **146** with REG-178 + REG-179 once filed |

> Snapshotted into `metrics/coverage-trend.md` (2026-06-29 Cycle-2 row).

## Residual risk
1. **PAY-2 pricing divergence — GATED.** `create-order`'s hardcoded `PRICING` can drift from DB
   `subscription_plans`. DEAD on the live web path; any amount change is **USER-GATED**. No amount was
   touched this cycle.
2. **Mobile repoint follow-up.** Mobile still targets the dead `create-order`; it should repoint to
   `subscribe`, unwrap the nested `data`, and add 409 mapping. Until then the mobile checkout remains in
   its pre-existing documented-broken state (not a regression introduced here).
3. **`docs/product/mobile-web-sync.md` stale.** States `create-order` does not exist; it exists but is
   dead on the web path. Doc fix tracked.
4. **Super-admin stuck-dashboard display (cosmetic).** Should read period from
   `student_subscriptions.current_period_end` now that reconcile no longer writes the legacy column.

## Sweep verdict
**GREEN** — payment suite 236/236, P14 chain complete, no dependent-flow regression, REG-46/47 still
green, the two new guards (REG-178/179) strengthen the P11/P9 surface; the residual items above are
tracked follow-ups, not sweep failures.
