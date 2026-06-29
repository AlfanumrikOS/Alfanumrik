# Payments & Subscriptions — Gap Analysis

**Audit cycle:** Cycle 2 (GAP) · **Owner:** Backend (payments) · **Date:** 2026-06-29
**Invariant under test:** P11 (Payment Integrity), with P9 (RBAC), P13 (Privacy) cross-checks.

This is an audit, not fault-finding. **Compliant areas are stated explicitly in §A.** Gaps follow in §B with the per-gap schema.

---

## A. WHERE THE CODE IS COMPLIANT (verified, not assumed)

1. **P11(1) — Signature verified before ANY processing on the webhook.** `webhook/route.ts:495-498` runs `verifyRazorpaySignature` and returns 400 before parse, before kill-switch read, before dedupe, before any DB write. Kill-switch + dedupe deliberately run AFTER signature (`:516-518`) so an attacker cannot probe flag/dedupe state without a valid HMAC. **COMPLIANT.**

2. **P11(1) — Verify route also re-derives signature server-side.** `verify/route.ts:99-115` computes HMAC over the correct payload (`sub_id|payment_id` for subscriptions, `order_id|payment_id` for orders) and rejects with 401 via `crypto.timingSafeEqual` before any DB write. The client's `razorpay_signature` is never trusted as proof on its own. **COMPLIANT** — no client-verify trust.

3. **P11(1) — Timing-safe comparison everywhere.** Single shared util `payment-verification.ts:16-33` (timing-safe, length-checked, try/catch on hex parse). Verify route uses the same `timingSafeEqual` pattern inline (`verify:111-113`). **COMPLIANT.**

4. **P11(2) — Activation is atomic on every primary and fallback branch.** `activate_subscription` (`…20260425150100…:59-89`), `atomic_subscription_activation` (`…20260502170000…:89-124`), `atomic_downgrade_subscription` (`…:168-177`), and `atomic_cancel_subscription` each update BOTH `student_subscriptions` and `students` inside one function body (one transaction). The webhook **never** does per-table writes from JS on RPC failure — it 503s instead (`webhook:689-720`, `:1083-1116`). **COMPLIANT.**

5. **P11(2) — verify+webhook race serialized.** `activate_subscription_locked` / `atomic_subscription_activation_locked` take `pg_advisory_xact_lock(hashtextextended('subscription:'||student_id))` (`…20260502170000…:239`, `:289`). Downgrade + cancel use `SELECT … FOR UPDATE` on the same row (`…:157-160`; `cancel/route.ts:35-41`). **COMPLIANT.**

6. **P11(3) — No grant without verified payment.** Verify returns 202/503 (NOT `success:true`) when student unresolved or activation RPC fails (`verify:204-214`, `:261-284`). Reconcile cron only acts on `payment_history.status='captured'` rows, which are only ever written by the two signature-verified paths. **COMPLIANT** (with the atomicity caveat in PAY-3).

7. **P11 — Idempotency substrate is real.** Event-level dedupe via `payment_webhook_events` UNIQUE `(razorpay_account_id, razorpay_event_id)` + `record_webhook_event` ON CONFLICT DO NOTHING (`…20260425150000…:32`, `:71-86`). Payment-level dedupe via `payment_history.razorpay_payment_id` checks (`webhook:593-602`, `verify:161-169`). Downgrades idempotent via stale-cancel guard + set-to-free. **COMPLIANT** (with the missing-id caveat in PAY-5).

8. **Webhook retry semantics mostly correct.** Transient failures (env, kill-switch, RPC, unresolved, unexpected) all return 5xx so Razorpay retries; processed/dedupe/ack return 200. See map §2 table. **COMPLIANT except PAY-7.**

9. **P13 — No PII in payment telemetry/logs.** PostHog `payment_succeeded` passes a safe subset and explicitly excludes `razorpay_signature` (`webhook:771-786`); `payment_failed` passes `error_code` not `error_description` (`webhook:841-854`). `logOpsEvent` contexts carry UUIDs + plan codes + error strings only. **COMPLIANT.**

10. **Crons are fail-closed on auth + idempotent.** All four payment crons use a constant-time `verifyCronSecret` returning 401 before any work (`reconcile:52-64,172-178`; `expired:35-47,51-57`; `pre-debit:56-65,95-97`; `health:71-83,202-205`). RPC/upsert WHERE-filters make re-runs no-ops. **COMPLIANT** (atomicity caveat PAY-3).

11. **Cancel route's Razorpay-first ordering prevents charge-while-cancelled.** If Razorpay cancel fails, it does NOT downgrade locally and returns 502 with a queued retry (`cancel:136-204`). **COMPLIANT.**

12. **setup-plans admin gate is constant-time.** `secureEqual(adminSecret, serviceKey)` (`setup-plans:25`); 401 otherwise. **COMPLIANT.**

13. **GST gates are fail-CLOSED and post-entitlement.** Every GST path (`subscribe`, `create-order`, `verify`) treats an indeterminate flag as OFF and never lets a GST failure block or reverse a paid activation. **COMPLIANT.**

---

## B. GAPS

### PAY-1 — Live order/subscription entry point (`subscribe`) lacks the `authorizeRequest` RBAC gate its sibling has
- **Evidence:** `subscribe/route.ts:72-89` authenticates via `getUser()` + Bearer only; there is **no** `authorizeRequest('payments.subscribe')` call (grep: 0 occurrences in the file). Its sibling `create-order/route.ts:72-73` and `verify/route.ts:79-80` both call it. The live checkout hook posts to `subscribe`, not `create-order` (`useCheckout.ts:92`). The RBAC regression test pins only create-order + verify (`payments-subscribe-rbac.test.ts:6-12`).
- **Business impact:** A non-student authenticated principal (teacher/parent/other role) can reach the Razorpay order/subscription creation path and mint Razorpay orders/subscriptions. No direct fund loss (webhook later marks such events `student_unresolved` when `notes.student_id` is empty), but it is wasted Razorpay objects + an inconsistent security posture on the highest-blast-radius write surface.
- **Technical impact:** Violates the documented API standard "every authenticated route calls `authorizeRequest(request, 'permission.code')`" and P9. Inconsistency between two routes that should be interchangeable.
- **Severity:** Medium · **Likelihood:** Low-Medium (requires a logged-in non-student to call the endpoint directly).
- **Recommendation:** Add `const auth = await authorizeRequest(request, 'payments.subscribe'); if (!auth.authorized) return auth.errorResponse!;` immediately after the `getUser()` block in `subscribe/route.ts` (mirror verify `:79-80`). Extend `payments-subscribe-rbac.test.ts` to cover `subscribe`.
- **Est. effort:** S (≈30 min incl. test). **AUTO-FIX-SAFE** (defense-in-depth wiring, no behavior change for legitimate students).

### PAY-2 — `create-order` hardcodes a PRICING table that diverges from the DB source of truth
- **Evidence:** `create-order/route.ts:121-125` hardcodes paisa amounts (`pro` yearly `559900` = ₹5599, `unlimited` yearly `1199900` = ₹11999, `starter` yearly `239900` = ₹2399). The live `subscribe` path reads `subscription_plans.price_yearly`/`price_monthly` from DB (`subscribe:107-116`, `:186-187`). The payment-flow skill lists different yearly prices (pro ₹6,990 etc.). Two pricing sources can drift.
- **Business impact:** If `create-order` is ever wired back onto the live path (or used by `pricing.ts`/admin tooling), a customer could be charged an amount that disagrees with the DB/displayed price. Pricing drift is a brand/legal risk (cf. REG-65 pricing-verbatim).
- **Technical impact:** Duplicated pricing authority; the hardcoded table is not covered by any "matches DB" test. Note the listed amounts differ from BOTH the skill table and (potentially) the DB.
- **Severity:** Medium · **Likelihood:** Low (route is off the live checkout path today).
- **Recommendation:** Make `create-order` read `subscription_plans` like `subscribe` does, OR delete `create-order` if it is dead (confirm no caller). Do NOT change any price value as part of this audit — pricing edits are user-gated.
- **Est. effort:** S-M. **REQUIRES USER APPROVAL** to touch any amount; the read-from-DB refactor itself is AUTO-FIX-SAFE only if it provably preserves current charged amounts. Recommend: flag to user, do not auto-edit.

### PAY-3 — Reconcile cron self-heals via two separate writes, not the atomic activation RPC
- **Evidence:** `reconcile-payments/route.ts:reconcileOne` does UPDATE `students` (`:107-114`) then a separate UPSERT `student_subscriptions` (`:128-143`). These are two independent statements with no transaction/RPC wrapper. Every OTHER activation path uses the atomic RPC.
- **Business impact:** If the second write fails after the first succeeds, the cron itself creates the exact `students.subscription_plan='pro'` / `student_subscriptions` stale split-brain it exists to repair. Self-corrects on the next 30-min run, but the window exposes inconsistent entitlement.
- **Technical impact:** P11(2) atomicity is not guaranteed on the reconcile path (it is on all others). Also bypasses the advisory lock, so it can interleave with a concurrent webhook activation for the same student.
- **Severity:** Medium · **Likelihood:** Low (only on a partial DB failure mid-pair).
- **Recommendation:** Replace the two writes with a single call to `atomic_subscription_activation(student_id, plan_code, billing_cycle, razorpay_payment_id, null)` (the same RPC the webhook fallback uses). Gains atomicity + advisory-lock serialization for free.
- **Est. effort:** S. **AUTO-FIX-SAFE.**

### PAY-4 — Payments-health monitor is not actually scheduled
- **Evidence:** `payments-health/route.ts:60-62` documents "Schedule (vercel.json): every 10 minutes," but `vercel.json:32-81` contains **no** `/api/cron/payments-health` entry. The route only runs if invoked manually/externally.
- **Business impact:** The webhook-silence detector built specifically to catch the 2026-05-09 "captured-but-never-activated" incident (route header `:14-22`) does not fire on a schedule. A repeat of that incident would again go undetected until a customer complains — exactly the failure the route was written to prevent. Reinforced by the 2026-06-26 audit-log entry (`docs/audit-logs/2026-06-26-payment-integrity-blocked.md`) noting the external watchdog also could not run.
- **Technical impact:** Dead safety net; the `ops_events` critical signals it would emit are never produced.
- **Severity:** High · **Likelihood:** High that it is currently silent (it is, structurally).
- **Recommendation:** Add `{ "path": "/api/cron/payments-health", "schedule": "*/10 * * * *" }` to `vercel.json` crons. (Note Vercel Hobby/plan cron-count limits — confirm the deployment plan allows another cron; if at the cap, fold the checks into `daily-cron` or run via Supabase pg_cron per audit-log Option C.)
- **Est. effort:** S (config) — pending cron-slot confirmation. **AUTO-FIX-SAFE** (scheduling a read-only monitor; architect/ops should confirm cron-slot budget).

### PAY-5 — Event-level dedupe is skipped (not fail-closed) when `account_id`/`event_id` is absent or the RPC errors
- **Evidence:** `webhook/route.ts:544-569` — if `accountId && razorpayEventId` is false, or `record_webhook_event` returns `dedupeErr`, the handler logs a warn and **proceeds without event-level dedupe**. Only `payment.captured`/`charged` then have payment-id-level dedupe; re-fired `subscription.cancelled/halted/expired` carry no payment entity and would fall through to re-processing.
- **Business impact:** A duplicated subscription terminal event lacking `account_id`/`event_id` could re-run a downgrade. In practice mitigated because `atomic_downgrade_subscription` is idempotent (stale-cancel guard + set-to-free is a no-op on the second run) and Razorpay always populates `id`/`account_id`. So real-world blast radius is small.
- **Technical impact:** The idempotency guarantee is "best-effort, relies on downstream idempotency" rather than airtight at the dedupe layer.
- **Severity:** Low · **Likelihood:** Low (Razorpay always sends both fields; downgrades idempotent anyway).
- **Recommendation:** Keep proceeding (failing closed here would drop real events), but add a test asserting a re-fired `subscription.cancelled` is a clean no-op, and emit an `ops_events` warn (not just `logger.warn`) when dedupe is skipped so the gap is observable.
- **Est. effort:** S. **AUTO-FIX-SAFE** (observability + test only).

### PAY-6 — Verify route's own HMAC-rejection (401) path has no direct test
- **Evidence:** Grep for signature-rejection assertions matched only `webhook-route-integration.test.ts` and `school-webhook-events.test.ts`; none target `verify/route.ts:113-115`. The verify route is the client-facing P11 gate and its 401-on-bad-signature branch is unpinned.
- **Business impact:** A future refactor could weaken/remove verify's server-side HMAC check (e.g., trust the client signature) without a test failing — that would allow plan grant without a valid signature (P11(3) breach).
- **Technical impact:** Missing regression coverage on a P11-critical branch.
- **Severity:** Medium · **Likelihood:** Low now, but the cost of a regression here is severe.
- **Recommendation:** Add a unit test: valid auth + RBAC pass + a tampered `razorpay_signature` → expect 401 and **no** `activate_subscription_locked` call. Mirror the webhook integration test's structure.
- **Est. effort:** S. **AUTO-FIX-SAFE.**

### PAY-7 — Missing webhook secret/header returns 400 (no retry) instead of 503
- **Evidence:** `webhook/route.ts:489-491` returns 400 when `RAZORPAY_WEBHOOK_SECRET` (env) or the signature header is missing. 400 tells Razorpay not to retry. A missing env during a deploy/secret-rotation window would silently DROP genuine events.
- **Business impact:** During a misconfiguration window, real payment events are lost (not retried), reproducing a captured-but-not-activated class of incident. Distinguish: a missing *header* is correctly a client/4xx condition; a missing *server env secret* is a server condition that should 5xx.
- **Technical impact:** Conflates a server-config fault (should be retryable 503) with a malformed-request fault (4xx).
- **Severity:** Low-Medium · **Likelihood:** Low (only during env misconfiguration).
- **Recommendation:** Split the branch: missing `RAZORPAY_WEBHOOK_SECRET` → 503 (force retry); missing/invalid signature header → 400. Reconcile cron is a backstop but operates on a 30-min lag.
- **Est. effort:** S. **AUTO-FIX-SAFE.**

### PAY-8 — `subscribe` can create a Razorpay subscription/order for a principal with no resolvable student row
- **Evidence:** `subscribe/route.ts` — the existing-active-sub guard and redundant-purchase guard are nested in `if (studentRow)` (`:125-169`). For the monthly branch, `resolvedStudentId` falls back to email lookup and may stay `undefined` (`:228-238`), yet `createRazorpaySubscription` is still called with `notes.student_id: resolvedStudentId ?? ''` (`:245`). `create_pending_subscription` then runs keyed on `auth_user_id` (`:263-271`).
- **Business impact:** An authenticated principal without a `students` row mints a Razorpay subscription with empty `student_id` notes. The webhook will later mark its events `student_unresolved` (500 + ops critical), so no false grant occurs — but it produces orphan Razorpay objects and ops noise. Closely related to PAY-1 (the RBAC gate would also block most such callers).
- **Technical impact:** Order creation proceeds without confirming a billable subject exists.
- **Severity:** Low · **Likelihood:** Low.
- **Recommendation:** After PAY-1's `authorizeRequest`, additionally short-circuit with a 400/409 when no student row resolves before calling Razorpay. Largely subsumed by fixing PAY-1.
- **Est. effort:** S. **AUTO-FIX-SAFE.**

### PAY-9 — `razorpay_signature` persisted at rest in `payment_history` (verify path only)
- **Evidence:** `verify/route.ts:235-246` inserts `razorpay_signature` into `payment_history`. The webhook path does not store it. This is not a P13 logging breach (it is a DB column, not a log/Sentry event), and the value is a per-payment HMAC, not a reusable secret. Noting for completeness/consistency.
- **Business impact:** Negligible — the stored signature is only verifiable with the secret and pertains to one payment.
- **Technical impact:** Minor inconsistency (one path stores it, the other does not).
- **Severity:** Low (informational) · **Likelihood:** n/a.
- **Recommendation:** Optional — drop the column from the insert for consistency, or document why it is retained (dispute forensics). No action required for P11/P13 compliance.
- **Est. effort:** XS. **AUTO-FIX-SAFE** (optional).

---

## C. Gap summary table

| ID | Title | Severity | P-invariant | Class |
|---|---|---|---|---|
| PAY-4 | payments-health monitor not scheduled | High | P11 (detection) | AUTO-FIX-SAFE* |
| PAY-1 | `subscribe` lacks `authorizeRequest` gate | Medium | P9/P11 | AUTO-FIX-SAFE |
| PAY-2 | `create-order` hardcoded pricing diverges from DB | Medium | P11-adjacent | USER APPROVAL (amounts) |
| PAY-3 | reconcile cron non-atomic two-write | Medium | P11(2) | AUTO-FIX-SAFE |
| PAY-6 | verify HMAC-reject path untested | Medium | P11(1) | AUTO-FIX-SAFE |
| PAY-7 | missing webhook secret → 400 not 503 | Low-Med | P11(retry) | AUTO-FIX-SAFE |
| PAY-5 | dedupe skipped when ids absent / RPC errors | Low | P11(idempotency) | AUTO-FIX-SAFE |
| PAY-8 | subscribe creates Razorpay obj w/o student row | Low | P11(3)-adjacent | AUTO-FIX-SAFE |
| PAY-9 | signature stored at rest (verify path) | Low (info) | P13-adjacent | AUTO-FIX-SAFE (optional) |

\* PAY-4 fix is config-trivial but needs architect/ops confirmation of the Vercel cron-slot budget (13 crons already declared).
