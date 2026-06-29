# 06 — Self-Review: Payments & Subscriptions (Cycle 2)

> Phase: SELF-REVIEW. The implementation squad reviews its own work before independent validation.

- **Cycle:** cycle-2
- **Workflow:** payments-subscriptions (P11)
- **Reviewer (authors):** backend (PAY-1, PAY-3, PAY-5, PAY-7, PAY-8) + architect (PAY-4) + testing (PAY-6)
- **Date:** 2026-06-29
- **Implementation reference:** `./05-implementation.md`

## Per-gap verification

| Gap ID | Owner | Fixed? | Evidence (file / test) | Notes |
|---|---|---|---|---|
| PAY-1 | backend | yes | `src/app/api/payments/subscribe/route.ts` — `authorizeRequest('payments.subscribe')` gate (line 102) denies 403 **before** plan lookup and any Razorpay object; mirrors siblings `verify:79-80` / `create-order:72-73` | Defense-in-depth; legitimate students with the grant pass unchanged. |
| PAY-3 | backend | yes | `src/app/api/cron/reconcile-payments/route.ts` — two non-atomic writes replaced by single `atomic_subscription_activation_locked` RPC (line 113); `computeExpiry` removed; `findStuckPayments` untouched | Reconcile can no longer create the split-brain it repairs; advisory lock removes webhook-interleave risk. |
| PAY-5 | backend | yes | `src/app/api/payments/webhook/route.ts` — both un-dedupable branches emit structured `logOpsEvent` warning and proceed via idempotent activation RPC (lines 578, 603) | Fail-open preserved (failing closed would drop real events); observability gap closed. Downstream `ON CONFLICT` prevents double-grant. |
| PAY-7 | backend | yes | `src/app/api/payments/webhook/route.ts` — missing `RAZORPAY_WEBHOOK_SECRET` env → 503 retryable (lines 489-499); missing header stays 400; invalid-SIGNATURE branch unchanged hard-4xx | Only the env-misconfig branch re-classified; the load-bearing P11(1) HMAC reject is byte-for-byte unchanged. |
| PAY-8 | backend | yes | `src/app/api/payments/subscribe/route.ts` — 409 short-circuit when no student row resolves (auth_user_id → email fallback), before any Razorpay object (lines 145-160) | Removes the orphan-Razorpay-object path; happy path notes byte-for-byte unchanged. |
| PAY-4 | architect | yes | `vercel.json` — registered `/api/cron/payments-health` at `*/10 * * * *` (13th cron); slot budget 13/40 on Pro+; fail-closed `verifyCronSecret` confirmed | The previously-dark webhook-silence monitor now fires on schedule. |
| PAY-6 | testing | yes | `verify-hmac-reject.test.ts` pins verify-route HMAC-reject (401, no grant); regression coverage on subscribe RBAC gate, reconcile atomic RPC, webhook 503-vs-4xx, dedupe no-op | 236/236 payment tests pass. |
| PAY-2 | — | **GATED** | architect read-only finding in `05-implementation.md` | DEAD on live web path (web uses `subscribe`); LIVE-referenced only by mobile (documented-broken). Any pricing-amount change is USER-GATED. NOT implemented. |
| PAY-9 | — | not done (optional) | — | `razorpay_signature` persisted at rest in `payment_history` (verify path). Informational only; not a P13 breach (DB column, not a log). Deferred. |

## Self-review checklist
- [x] Every gap in `02-gap-analysis.md` is addressed or explicitly deferred (PAY-1/3/4/5/6/7/8 landed; PAY-2 gated; PAY-9 optional-deferred).
- [x] No broken links / dead buttons / empty-placeholder states on touched paths — the new 403 (PAY-1) and 409 (PAY-8) are clean error returns; frontend confirmed checkout handles them SAFE-AS-IS.
- [x] Loading / empty / error states handled for touched paths — no UI introduced; backend returns structured JSON errors only.
- [x] Bilingual (P7) — N/A; no user-facing copy added (the 409 body is a developer-facing API error string surfaced through existing checkout error handling).
- [x] **P11(1) signature verification** — untouched. PAY-7 re-classifies only the *missing-server-secret* env-misconfig branch; the HMAC compare and the invalid-signature 400 are byte-for-byte unchanged.
- [x] **P11(2) atomicity** — strengthened. PAY-3 routes the last non-atomic activation path through the existing single-transaction `atomic_subscription_activation_locked` RPC (+ advisory lock). No new two-statement write introduced anywhere.
- [x] **P11(3) no grant without verified payment** — PAY-1/PAY-8 only *add denials*; PAY-3 still acts only on signature-verified `payment_history.status='captured'` rows. No path grants access on unverified payment.
- [x] **P9 RBAC** — PAY-1 brings the highest-blast-radius write surface (`subscribe`) into parity with its siblings via `authorizeRequest`; server-side enforced before any side effect.
- [x] **P13 privacy** — the two new `logOpsEvent` calls (PAY-5) carry event-type + boolean presence flags + error string + opaque `razorpay_event_id` only; no message text / email / phone / name. No PII added to any log.
- [x] **No pricing / amount / plan change** — confirmed: no edit touched `subscription_plans` reads, `src/lib/plans.ts`, `create-order`'s `PRICING` constant, or any paisa/INR literal.
- [x] Idempotency / retry — PAY-3 re-runs are no-ops (detection filter + `ON CONFLICT`); PAY-7 improves env-misconfig retryability; PAY-5 keeps fail-open + observable; PAY-1/PAY-8 short-circuit before any write so retries have nothing to reconcile.
- [x] No `any` in new code; no `console.log` (PAY-7 uses `logger.error`); no weakened assertions.
- [x] Migrations idempotent; RLS in same file — N/A (no schema/RLS/migration touched this cycle; pure app/config/test code). PAY-4 is config-only (`vercel.json`).
- [x] Feature-flag changes audited — N/A (no flag added or toggled this cycle).
- [x] Ownership/scope — backend edits limited to `subscribe/route.ts`, `webhook/route.ts`, `cron/reconcile-payments/route.ts`; architect to `vercel.json`; testing to the new test file. PAY-2 (gated) and PAY-9 (optional) untouched.

## Known limitations carried forward (for the independent reviewer)
1. **PAY-2 is GATED, not fixed.** `create-order`'s hardcoded `PRICING` table can diverge from DB `subscription_plans`. It is DEAD on the live web path (web checkout posts to `subscribe`), but the mobile contract still names `create-order`, and that mobile flow is already documented-broken (`docs/product/mobile-web-sync.md`). Do **not** delete unilaterally; any pricing-amount change is **USER-GATED**.
2. **Mobile repoint follow-up.** Mobile should repoint `create-order` → `subscribe`, unwrap the nested `data`, and add 409 mapping. Tracked, not a blocker.
3. **`mobile-web-sync.md` is stale.** It states the `create-order` route does not exist; in fact it exists but is dead on the web path. Doc fix tracked (ops/backend).
4. **Super-admin stuck-payments display (cosmetic).** Reconcile no longer writes `students.subscription_expiry`; the super-admin stuck dashboard should read the period from `student_subscriptions.current_period_end` (no entitlement-gating path reads the legacy column). Non-blocking.
5. **PAY-9 optional.** `razorpay_signature` is persisted at rest in `payment_history` on the verify path only. Not a P11/P13 breach; left as-is (dispute-forensics rationale) pending a consistency decision.

## Ready for independent validation?
**YES.** All Cycle-2 auto-fix-safe items (PAY-1, PAY-3, PAY-4, PAY-5, PAY-6, PAY-7, PAY-8) are implemented and locally green; PAY-2 is explicitly gated with its reason; PAY-9 is optional-deferred.
