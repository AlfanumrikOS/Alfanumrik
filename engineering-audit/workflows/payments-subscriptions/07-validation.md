# 07 — Independent Validation: Payments & Subscriptions (Cycle 2)

> Phase: INDEPENDENT VALIDATION. A fresh quality agent (did NOT implement) verifies.

- **Cycle:** cycle-2
- **Workflow:** payments-subscriptions (P11)
- **Validator squad:** **quality** (independent of the builder squad)
- **Date:** 2026-06-29
- **Self-review reference:** `./06-self-review.md`

## Independence statement
The validating quality agent did **not** author any of the Cycle-2 changes (PAY-1/3/5/7/8 backend,
PAY-4 architect, PAY-6 testing). It re-ran every gate from a clean state rather than trusting the
builders' reported results, and independently re-derived the P11 reasoning from the changed file lines.

## Per-gap independent verdict

| Gap ID | Builder claim | Validator finding | Verdict |
|---|---|---|---|
| PAY-1 | `subscribe` now calls `authorizeRequest('payments.subscribe')`, denying 403 before any Razorpay object | Confirmed gate placement is after `getUser()` and before plan lookup / student-resolve / every Razorpay call; permission code real and student-granted; sibling-pattern match | **PASS** |
| PAY-8 | 409 short-circuit when no student row resolves, before any Razorpay object | Confirmed resolve-then-guard returns 409 before any Razorpay/DB write; legit-student `notes.student_id` byte-for-byte unchanged on happy path; no PII in 409 body | **PASS** |
| PAY-3 | reconcile uses single `atomic_subscription_activation_locked` RPC (the webhook fallback RPC) | Confirmed the two-write split-brain shape is gone; RPC is identical to canonical path; `findStuckPayments` untouched; still acts only on `captured` rows; `verifyCronSecret` fail-closed unchanged | **PASS** |
| PAY-7 | missing env secret → 503; missing header → 400; invalid signature unchanged hard-4xx | Confirmed the dangerous branch is preserved: bad HMAC still 400 before parse/dedupe/DB-write; only env-misconfig becomes retryable 503; no secret value logged | **PASS** (the P11-critical check) |
| PAY-5 | un-dedupable events emit structured ops warning and proceed via idempotent RPC | Confirmed proceeding cannot double-process (downstream `ON CONFLICT (student_id)` + unique `razorpay_payment_id` + no-op stale downgrade); ops context PII-free | **PASS** |
| PAY-4 | `payments-health` registered as 13th Vercel cron `*/10 * * * *`; slot budget 13/40 on Pro+; fail-closed auth | Confirmed `vercel.json` parses clean; cron count 12 → 13; sub-daily schedules prove Pro+ plan (40-cron limit); route's `verifyCronSecret` returns 401 before any DB query | **PASS** |
| PAY-6 | new verify-HMAC-reject test (401, no grant) + regression coverage on RBAC gate / reconcile RPC / 503-vs-4xx / dedupe no-op | Confirmed the verify-route 401-on-tampered-signature branch is pinned with no `activate_subscription_locked` call; 236/236 payment tests pass | **PASS** |

## Gate re-run (verified, not trusted)
- [x] **type-check** — **PASS**
- [x] **lint** — **PASS** (0 errors)
- [x] **test** — **PASS 236/236** (payment suite: webhook integration, verify HMAC-reject, subscribe RBAC gate, reconcile atomic RPC, dedupe no-op, GST gates)
- [x] **build** — **PASS**
- [x] **vercel.json** — **VALID** (`require('./vercel.json')` parses clean; 13 crons, ≤ 40 Pro limit)

## Architect security review (P14 mandatory payment-flow reviewer)
**Verdict: APPROVE.** All four backend changes strengthen P11 (atomicity on the last non-atomic path;
correct retry semantics; observable idempotency) and P9 (RBAC parity on the highest-blast-radius write),
with no weakening of the signature gate and no new PII/secret surface. Full evidence (file:line-pinned)
in `05-implementation.md` → "Architect security review (P14)". PAY-4 (`vercel.json`) owned and verified by
architect: fail-closed CRON_SECRET auth confirmed; config-only, no bundle/middleware/migration impact.

## Invariant audit (P1–P15)

| Invariant | Relevant? | Upheld? | Evidence |
|---|---|---|---|
| P11 Payment integrity | yes | yes — strengthened | Signature gate untouched (PAY-7 splits only env-misconfig); atomicity completed on reconcile (PAY-3); idempotency observable (PAY-5); no grant without verified payment (PAY-1/PAY-8 only add denials) |
| P9 RBAC enforcement | yes | yes — strengthened | PAY-1 brings `subscribe` to `authorizeRequest` parity with `verify`/`create-order`; server-side, before any side effect |
| P13 Data privacy | yes | yes | New `logOpsEvent` calls (PAY-5) carry event-type + booleans + error string + opaque event id only; no PII; no secret logged in PAY-7 |
| P10 Bundle budget | yes (config-adjacent) | yes (unchanged) | PAY-4 is config-only (`vercel.json`); no middleware/bundle/code-path change |
| P8 RLS boundary | yes | yes (unchanged) | No schema/RLS/migration touched; reused RPCs are pre-existing |
| P1/P2/P3/P4/P5/P6/P12 | no | n/a | No scoring/XP/anti-cheat/quiz/grade/AI surface touched this cycle |

## Security audit
- [x] No `SUPABASE_SERVICE_ROLE_KEY` exposure; no `NEXT_PUBLIC_*` secret introduced (P13).
- [x] No user input interpolated into SQL — all DB access is parameterized `.rpc()` / query-builder.
- [x] No new `SECURITY DEFINER` introduced (reused RPCs pre-existing and documented).
- [x] No webhook signature weakening — invalid HMAC still hard-rejects before any processing (P11(1)).
- [x] Cron auth fail-closed on both touched crons (`reconcile-payments`, `payments-health`) — 401 before any work.

## Minor non-blocking notes (recorded verbatim — already addressed)
1. **Reconcile no longer writes `students.subscription_expiry`.** The RPC sets the authoritative
   `student_subscriptions.current_period_end` but not the legacy display column. **Checked, NOT a
   regression** — no entitlement-gating path reads `students.subscription_expiry`; it is read only for
   *display* in the super-admin stuck dashboard, and the canonical webhook activation never wrote it
   either (so this *removes* a reconcile-vs-webhook inconsistency). Cosmetic follow-up: align the
   stuck-dashboard display to read period from `student_subscriptions`. **Addressed** as a tracked,
   non-blocking follow-up.
2. **PAY-2 pricing divergence is reported, not fixed.** `create-order`'s hardcoded `PRICING` table can
   drift from DB `subscription_plans`, but the route is DEAD on the live web path and only the
   documented-broken mobile flow references it. **Addressed** by gating any amount change to user approval
   and tracking the mobile-repoint follow-up; no amount was modified this cycle.

## Verdict
**APPROVE** — all seven in-scope auto-fix-safe gaps (PAY-1/3/4/5/6/7/8) pass independent re-test; all
gates green (type-check PASS, lint 0 errors, 236/236 tests PASS, build PASS, `vercel.json` VALID);
architect security review APPROVE; no invariant regression; the two minor notes are non-blocking and
already addressed as tracked follow-ups.

## Required fixes before COMPLETE (if REJECT)
None. (The workflow is not marked fully COMPLETE only because PAY-2 is user-gated and the mobile-repoint
+ doc-fix + cosmetic-display follow-ups remain — none of which are validation failures; see `STATUS.md`.)
