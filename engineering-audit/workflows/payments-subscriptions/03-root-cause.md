# Payments & Subscriptions — Root-Cause Analysis

**Audit cycle:** Cycle 2 (ROOT-CAUSE) · **Owner:** Backend (payments) · **Date:** 2026-06-29

For each significant gap: the true root cause (not the symptom) and the layer/decision that introduced it. Ordered by severity.

---

## PAY-4 — payments-health monitor not scheduled (High)

**True root cause:** Incomplete wiring at landing time. The route was written as an incident response to 2026-05-09 (the header `payments-health/route.ts:14-22` documents the post-mortem), and its docstring even names the intended schedule ("every 10 minutes (vercel.json)"). But the corresponding `crons[]` entry in `vercel.json` was never added. The code-level intent and the deploy-level config diverged, and nothing reconciles a "route claims a schedule" comment against the actual `vercel.json` cron list.

**Introducing layer:** Deployment configuration (`vercel.json`). The route author treated the doc-comment as the contract; the schedule lives in a separate file that was not updated in the same change.

**Why it persisted undetected:** A monitor that never runs emits no signal — its absence is silent by construction. There is no meta-check ("is every cron route referenced in `vercel.json`?"), so the dead monitor produced neither alerts nor test failures. The 2026-06-26 audit-log entry shows the *external* watchdog also failed, so both the in-app and out-of-band detectors were simultaneously dark.

**Systemic lesson:** Schedule intent expressed in a code comment is not enforceable. Cron registration should be asserted by a test that parses `vercel.json` and cross-checks declared cron routes against `src/app/api/cron/*` (and vice-versa for safety-critical monitors).

---

## PAY-1 — `subscribe` lacks the `authorizeRequest` RBAC gate (Medium)

**True root cause:** The RBAC gate was added as a later "Gap 2 defense-in-depth" hardening pass (see the matching comments in `verify/route.ts:73-80` and `create-order/route.ts:66-73`), but that pass enumerated the routes by hand and **missed `subscribe`** — likely because at the time the author reasoned about "the two payment write routes" as create-order + verify, not realizing `subscribe` is the actual live order/subscription creator. The regression test that pins the gate (`payments-subscribe-rbac.test.ts:6-12`) encodes the same blind spot ("BOTH payment write routes (create-order, verify)"), so the test green-lights the incomplete coverage.

**Introducing layer:** Backend route authorization, during a retrofit. The original `subscribe` route shipped with `getUser()`-only auth (authentication, not authorization); the later RBAC retrofit did not include it.

**Why it persisted:** The test was written to match the routes that were changed, not the routes that *should* be changed — so the test reinforces the gap rather than catching it. There is no inventory check asserting "every route under `api/payments/**` that performs a write calls `authorizeRequest`."

**Systemic lesson:** Security-control retrofits should be driven by an enumerated route inventory (grep all write routes), not by the set of files already open in the change.

---

## PAY-2 — `create-order` hardcoded pricing diverges from DB (Medium)

**True root cause:** Two order-creation routes evolved in parallel. `create-order` is the older shape carrying an inline `PRICING` constant (`create-order:121-125`); `subscribe` is the newer unified shape that reads `subscription_plans` from the DB. When the live checkout migrated to `subscribe` (`useCheckout.ts:92`), `create-order` was left in place — neither deleted nor refactored onto the DB — so its hardcoded amounts became a stale second source of truth.

**Introducing layer:** Backend, via route duplication during the recurring-billing/unified-checkout evolution. The hardcoded constant predates the "client never sends amount; server reads DB price" convention.

**Why it persisted:** No test asserts `create-order` amounts equal `subscription_plans`, and the route is off the live path so the divergence is invisible in normal operation. The constitution flags pricing values as user-gated, which (correctly) discourages casual edits — but that gate does not catch a *stale duplicate*.

**Systemic lesson:** Pricing must have exactly one runtime source (the DB). Dead-but-deployed routes that embed pricing are latent liabilities; either delete or re-point them.

---

## PAY-3 — reconcile cron non-atomic two-write (Medium)

**True root cause:** The reconcile cron was authored as a stand-alone "mirror of the super-admin reconcile tool" (`reconcile-payments:13-16`) and re-implemented the activation logic in JS (UPDATE students; UPSERT student_subscriptions) instead of delegating to the `atomic_subscription_activation` RPC that already existed for exactly this purpose. The atomic RPC and the cron were built by different changes addressing different facets of the same 2026-04/05 P11 work, and the cron did not adopt the RPC.

**Introducing layer:** Backend cron implementation. The atomicity guarantee was centralized in SQL RPCs, but this one consumer re-derived the writes in application code, opting out of the guarantee.

**Why it persisted:** The cron self-corrects on the next run, so a transient split-brain it creates is short-lived and statistically rare — it never surfaced as an incident. The "split-brain risk is closed" narrative in the constitution refers to the webhook/verify paths and did not audit the self-heal path itself.

**Systemic lesson:** Once an invariant is centralized in an RPC, every writer must route through it. A lint/review rule "no direct UPDATE students.subscription_plan + student_subscriptions outside the activation RPCs" would have caught this.

---

## PAY-6 — verify HMAC-reject path untested (Medium)

**True root cause:** Test coverage was concentrated on the webhook (the path with the most historical incidents), and the verify route's server-side HMAC check was treated as "obviously present" rather than pinned. The verify route's signature logic is inline (`verify:99-115`) rather than routed through the shared `verifyRazorpaySignature` util the webhook uses — so it is also not transitively covered by the util's tests.

**Introducing layer:** Testing strategy. The P11 regression effort (REG-46/47) focused on the funnel E2E and the atomicity RPC, leaving the verify-route unit branch unpinned.

**Why it persisted:** The branch works correctly today, so its absence from the suite produces no failure. Untested-but-correct code is invisible until a refactor breaks it.

**Systemic lesson:** The two server-side signature gates (webhook + verify) are the load-bearing P11(1) controls; both deserve an explicit "tampered signature → reject, no activation" pin. Consider refactoring verify to call the shared `verifyRazorpaySignature` util so there is one tested implementation.

---

## PAY-7 — missing webhook secret → 400 not 503 (Low-Med)

**True root cause:** A single guard conflates two distinct failure modes — a missing *request header* (client/4xx) and a missing *server env secret* (server/5xx) — into one 400 (`webhook:489-491`). The author optimized for the common case (a probe without a signature header is correctly 4xx) and did not separate the rare server-misconfig case that should be retryable.

**Introducing layer:** Backend webhook error-handling. An early-return convenience that combined two checks.

**Why it persisted:** Env secrets are present in steady state, so the 400-on-missing-secret branch is effectively dead except during a misconfiguration/rotation window — which is exactly when you most want retries.

**Systemic lesson:** Map each failure to retryable (5xx) vs terminal (4xx) by its *cause*, not by where it is detected. Server-side misconfiguration is always retryable.

---

## PAY-5 — dedupe skipped when ids absent / RPC errors (Low)

**True root cause:** A deliberate fail-OPEN choice (proceed without dedupe rather than drop a possibly-real event), correct in spirit, but it leans entirely on downstream idempotency (`atomic_downgrade_subscription` no-op, `payment_history` unique) without making that reliance explicit or observable. The dedupe layer's guarantee silently degrades from "airtight" to "best-effort" under these conditions.

**Introducing layer:** Backend webhook dedupe. Defensive coding that prioritized never-lose-an-event over airtight-once-only.

**Why it persisted:** Razorpay always populates `account_id`/`event_id`, so the skip branch is essentially never taken in production; downgrades are idempotent so even if taken, no harm results.

**Systemic lesson:** When a safety layer fails open, the fallback guarantee (downstream idempotency) should be asserted by a test and the degradation should emit an ops signal, so "best-effort" does not silently become "no-effort."

---

## Cross-cutting root-cause themes

1. **Intent-vs-config drift (PAY-4):** safety behavior declared in code comments but not enforced by the deploy config or a meta-test.
2. **Retrofit-by-open-files (PAY-1, PAY-3):** hardening/centralization passes that enumerated changed files instead of the full route/writer inventory, and tests that pinned the incomplete set.
3. **Dead-but-deployed duplication (PAY-2):** an obsolete route retained with embedded pricing after the live path moved on.
4. **Untested-but-correct critical branches (PAY-6, PAY-5):** the load-bearing P11 controls that happen to work and therefore escaped regression pinning.

None of these is a live P11 breach today: every grant path still requires a server-verified signature and every primary/fallback activation is atomic. The gaps are erosion risks — places where a future change could breach P11 without a test failing, or where a safety net is structurally inert (PAY-4).
