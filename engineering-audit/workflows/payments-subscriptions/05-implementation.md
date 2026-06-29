# Payments & Subscriptions — Implementation (Cycle 2, backend-owned)

**Audit cycle:** Cycle 2 (IMPLEMENTATION) · **Owner:** Backend (payments) · **Date:** 2026-06-29
**Implemented here:** PAY-1, PAY-3, PAY-5, PAY-7, PAY-8 (all backend-owned, auto-fix-safe).
**Validation:** `npm run type-check` → clean (no errors) after every change.

No pricing, plan definition, or amount was touched anywhere. No signature-verification logic was
changed. No schema/RLS/migration touched.

---

## PAY-1 — RBAC gate on `subscribe`

**File:** `src/app/api/payments/subscribe/route.ts`

**Before** — `subscribe` authenticated via `getUser()` + Bearer only; no `authorizeRequest`.
After the 401 block the route went straight to `request.json()`:
```ts
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.json();
```

**After** — added the import (now line 8) and the gate (now line 102), copied byte-for-byte from
the siblings `verify/route.ts:79-80` and `create-order/route.ts:72-73` (same permission code
`payments.subscribe`):
```ts
import { authorizeRequest } from '@/lib/rbac';   // line 8
...
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // PAY-1 / Gap 2 defense-in-depth (P9/P11): RBAC permission gate ...
    const auth = await authorizeRequest(request, 'payments.subscribe');   // line 102
    if (!auth.authorized) return auth.errorResponse!;

    const rawBody = await request.json();
```
The gate denies (403) **before** the plan lookup and **before** any Razorpay object is created.

**Why preserved:**
- **P11/P9** — pure defense-in-depth. A legitimate student with the `payments.subscribe` grant still
  passes; super_admin/admin bypass automatically (existing `authorizeRequest` semantics). No
  legitimate flow changes; the highest-blast-radius write surface now matches its siblings.
- **P13** — no new logging; `authorizeRequest` owns its own (PII-free) audit path.

---

## PAY-8 — Block Razorpay creation when no student row resolves

**File:** `src/app/api/payments/subscribe/route.ts`

**Before** — the existing-sub and redundant-purchase guards were nested in `if (studentRow)`; the
monthly branch resolved `resolvedStudentId` via email fallback but still called
`createRazorpaySubscription` with `notes.student_id: resolvedStudentId ?? ''` even when undefined;
the yearly branch used `student_id: studentRow?.id ?? ''`.

**After** — resolve the student id once (auth_user_id → email fallback) right after the `studentRow`
fetch and short-circuit with a clean **409** before any Razorpay object is created (now lines
145-160):
```ts
    let resolvedStudentId: string | undefined = studentRow?.id;
    if (!resolvedStudentId && user.email) {
      const { data: byEmail } = await admin
        .from('students').select('id')
        .eq('email', user.email)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle();
      resolvedStudentId = byEmail?.id;
    }
    if (!resolvedStudentId) {
      return NextResponse.json({
        error: 'No student profile found for this account. Please complete onboarding before subscribing.',
      }, { status: 409 });
    }
```
The monthly branch's now-duplicate resolution block was deleted; both the monthly subscription notes
(line 272) and the yearly order notes (line 344) now read `student_id: resolvedStudentId` (a
guaranteed-present real id, no more `?? ''`).

**Why preserved:**
- **P11** — removes a path that minted orphan Razorpay objects with empty `student_id` notes (later
  marked `student_unresolved` by the webhook). No grant path is touched; for a legitimate student
  `resolvedStudentId === studentRow.id`, so notes are byte-for-byte unchanged → no behavior change.
- **Idempotency/retry** — unaffected; the 409 returns before any Razorpay or DB write, so a client
  retry has nothing to reconcile.
- **P13** — no new PII logged.

---

## PAY-3 — Atomic activation in reconcile cron

**File:** `src/app/api/cron/reconcile-payments/route.ts`

**Before** — `reconcileOne` did two independent writes plus a now-unused `computeExpiry` helper:
```ts
  // 1. Update students table
  await admin.from('students').update({ subscription_plan, subscription_expiry: expiry })...
  // 2. look up plan_id
  // 3. UPSERT student_subscriptions { ...current_period_end: expiry... }
```
If write 2/3 failed after write 1 succeeded, the cron created the exact split-brain it exists to
repair.

**After** — a single call to the same RPC the webhook uses as its fallback (now line 113):
```ts
  const { error: rpcErr } = await admin.rpc('atomic_subscription_activation_locked', {
    p_student_id: payment.student_id,
    p_plan_code: payment.plan_code,
    p_billing_cycle: payment.billing_cycle,
    p_razorpay_payment_id: payment.razorpay_payment_id,
    p_razorpay_subscription_id: null,
  });
  if (rpcErr) {
    return { studentId: payment.student_id, ok: false, error: `atomic_subscription_activation: ${rpcErr.message}` };
  }
```
`computeExpiry` removed (unused). `findStuckPayments` (the detection / "what gets reconciled" logic)
is **unchanged**. File-level idempotency docstring updated to reference the RPC.

**Behavior note:** the RPC derives `student_subscriptions.current_period_end` from `NOW()` and does
not write `students.subscription_expiry` — identical to the webhook's own activation
(`activate_subscription` / `atomic_subscription_activation`, baseline lines 962-1023). This makes
reconcile consistent with the authoritative webhook path; the period source of truth is
`student_subscriptions.current_period_end`. Within the ≤30-min cron lag the timestamp delta vs the
old `created_at + N` basis is minutes.

**Why preserved:**
- **P11(2)** — the only activation path that lacked atomicity now commits both
  `students.subscription_plan` and `student_subscriptions` in one transaction; the `_locked` wrapper
  also adds the per-student `pg_advisory_xact_lock`, removing interleave-with-webhook risk.
- **P11(3)** — reconcile still only acts on signature-verified `payment_history.status='captured'`
  rows; no grant without verified payment.
- **Cron auth** — `verifyCronSecret` (fail-closed, constant-time, 401 before any work) untouched.
- **Idempotency** — re-running on an already-reconciled payment is still a no-op (detection WHERE
  filter + RPC `ON CONFLICT (student_id)` upsert).

---

## PAY-5 — Fail-safe + observable dedupe degradation

**File:** `src/app/api/payments/webhook/route.ts`

**Before** — both un-dedupable branches (`record_webhook_event` RPC error; missing
`account_id`/`event_id`) logged only `logger.warn` and proceeded, leaning silently on downstream
idempotency.

**After** — both branches now also emit a structured `logOpsEvent` warning so the degradation is
observable, with in-code documentation of why proceeding is safe (downstream activations are
idempotent: `ON CONFLICT (student_id)` upserts, unique `payment_history.razorpay_payment_id`,
no-op stale `atomic_downgrade_subscription`):
- RPC-error branch → `message: 'webhook_event_dedupe_unavailable_rpc_error'` (line 578)
- missing-id branch → `message: 'webhook_event_dedupe_skipped_missing_identifier'` (line 603)

No new guard that could drop a real event was added (failing closed here would lose genuine events).

**Why preserved:**
- **P11(idempotency)** — happy path unchanged; degraded path now surfaces an ops signal instead of
  silently becoming "no-effort." Re-processing remains safe via downstream idempotency.
- **P13** — ops-event context carries only `event_type`, boolean presence flags, and the error
  string (UUIDs/codes only) — no message text, email, phone, or name.

---

## PAY-7 — Missing webhook secret → 503 (retry), missing header stays 400

**File:** `src/app/api/payments/webhook/route.ts`

**Before** — one guard conflated server env-misconfig and malformed request:
```ts
    if (!webhookSecret || !signature) {
      return NextResponse.json({ error: 'Not configured' }, { status: 400 });
    }
```

**After** — split (lines 489-502):
```ts
    if (!webhookSecret) {
      logger.error('webhook: RAZORPAY_WEBHOOK_SECRET not configured — returning 503 so Razorpay retries');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
    }
    if (!signature) {
      return NextResponse.json({ error: 'Missing signature header' }, { status: 400 });
    }
```
The invalid-**signature** branch (`verifyRazorpaySignature` → 400) immediately below is **unchanged**.

**Why preserved:**
- **P11(1)** — signature verification itself is untouched; a genuinely bad HMAC still 4xx-rejects
  before any processing. Only the *missing server secret* (env-misconfig) becomes retryable 503 so
  Razorpay does not permanently drop a real event during a deploy/rotation window. A *missing header*
  (malformed/probe request) correctly stays terminal 400.
- **Idempotency/retry** — strictly improves retry semantics for the retryable cause; reconcile cron
  remains a 30-min backstop.

---

## PAY-4 (architect)

**File:** `vercel.json`

**Decision: Option (a) — register a dedicated Vercel cron** for `/api/cron/payments-health` at
`*/10 * * * *` (every 10 minutes, matching the route's own docstring `payments-health/route.ts:60-62`).
Chosen over Option (b)/the audit-log "Option C" fold.

```json
{
  "path": "/api/cron/payments-health",
  "schedule": "*/10 * * * *"
}
```
Inserted immediately after the `reconcile-payments` entry to keep the payment crons grouped.

**Cron-slot budget evidence (why Option a is feasible):**
- `vercel.json` declared **12** crons before this change (the gap analysis's "13" was off by one —
  actual count verified: `node -e` → 12). Now **13**.
- Several existing crons run **sub-daily** (`reconcile-payments */30`, `fix-failed-questions */15`,
  `expired-subscriptions 15 */6`, `pre-debit-notice 0 */6`). The Vercel **Hobby** plan caps crons at
  2 **and** forbids sub-daily schedules. The presence of these schedules is hard evidence the project
  is on **Pro (or higher)**, whose limit is **40 cron jobs** with arbitrary frequency. 13/40 used →
  ample headroom; no slot pressure.

**Why Option (a) over the fold (Option C):**
- The route is a *webhook-silence* detector. Its entire value is **detection latency** — the
  2026-05-09 incident (`payments-health/route.ts:13-22`) went unnoticed for ~2 weeks. Folding the
  check into `daily-cron` (runs `30 2 * * *`) would cap detection at **24 h**, gutting the purpose.
  A dedicated `*/10` cron restores the designed ~10-minute detection window.
- The audit-log "Option C" (pg_cron + `alert-deliverer`) addressed a *different* failure: the
  Claude-Code **scheduled-session watchdog** that could not reach Supabase from its sandbox
  (`docs/audit-logs/2026-06-26-payment-integrity-blocked.md`). That watchdog is session-environment
  bound; the Vercel route runs **inside** the deployment with the service-role client and has no such
  egress problem. Scheduling the already-built Vercel route is the lower-risk, in-band fix. (pg_cron
  remains a valid *additional* backstop for the session watchdog, but is out of scope here and would
  duplicate this route's checks.)

**Fail-closed auth verified:** `payments-health/route.ts:202-205` runs `verifyCronSecret` (constant-
time, length-checked, returns `false` when `CRON_SECRET` env or the supplied header is absent) and
returns **401 before any DB query**. Same pattern as `reconcile-payments:54-66`. Vercel cron invokes
the route via **GET**, which the route exports (`:199`). ✔

**P10 / infra:** config-only change — no middleware, no bundle, no new code path. The route is already
covered by the `src/app/api/cron/**/*.ts` → `maxDuration: 60` function block (its own `maxDuration=30`
is within that). Region unchanged (`bom1`). No migration, no RLS, no auth-flow change. ✔

**Validation:** `node -e "require('./vercel.json')"` parses clean; cron count 12 → 13.

---

## PAY-6 (testing)

_Intentionally empty — owned by testing (verify-route HMAC-reject unit test; extend the RBAC pin to
cover `subscribe`). See `04-solution-design.md` → Stubs._

---

## Backend self-review

- **P11(1) signature verification:** untouched in both webhook and verify. PAY-7 only re-classifies
  the *missing-secret* env-misconfig branch; the HMAC compare and the invalid-signature 400 are
  byte-for-byte unchanged. ✔
- **P11(2) atomicity:** strengthened — PAY-3 routes the last non-atomic activation path through the
  existing single-transaction `atomic_subscription_activation_locked` RPC (+ advisory lock). No new
  two-statement write was introduced anywhere. ✔
- **P11(3) no grant without verified payment:** PAY-1/PAY-8 only *add denials*; PAY-3 still acts only
  on signature-verified `captured` rows. No path grants access on unverified payment. ✔
- **P13 privacy:** the two new `logOpsEvent` calls (PAY-5) carry event-type + booleans + error
  strings only (no PII). No PII added to any log. ✔
- **Idempotency/retry:** PAY-3 re-runs are no-ops (detection filter + `ON CONFLICT`); PAY-7 improves
  retryability of the env-misconfig case; PAY-5 keeps fail-open + observable; PAY-1/PAY-8 short-
  circuit before any write so retries have nothing to reconcile. ✔
- **No pricing/amount/plan change:** confirmed — no edit touched `subscription_plans` reads,
  `src/lib/plans.ts`, `create-order`'s `PRICING` constant, or any paisa/INR literal. ✔
- **Ownership/scope:** edits limited to `subscribe/route.ts`, `webhook/route.ts`,
  `cron/reconcile-payments/route.ts`. PAY-2 (pricing, gated) and PAY-9 (optional) untouched. ✔
- **type-check:** clean after every change. ✔

**Deferred for review chain (P14, payment flow → architect + testing + mobile):**
- **architect** — review PAY-7 retry-semantics change + PAY-3 RPC reuse (signature/atomicity
  security) and own PAY-4 (`vercel.json`).
- **testing** — own PAY-6 (verify HMAC-reject test) + extend RBAC pin to `subscribe`; regression on
  PAY-3 atomic path and PAY-5 re-fired-event no-op.
- **frontend** — `subscribe` now returns a 409 (`No student profile found…`) for the no-student-row
  case (PAY-8) and 403 for non-students (PAY-1); confirm the checkout client handles these cleanly.
- **mobile** — payment-flow change: confirm the mobile checkout path tolerates the new 403/409 from
  `subscribe`.

---

## Architect security review (P14) — Cycle 2 payment changes

**Reviewer:** architect (mandatory P14 security reviewer for payment-flow changes).
**Scope:** `subscribe/route.ts` (PAY-1, PAY-8), `cron/reconcile-payments/route.ts` (PAY-3),
`webhook/route.ts` (PAY-7, PAY-5). All evidence file:line-pinned.

### PAY-1 (RBAC gate on `subscribe`) — PASS
- Gate `authorizeRequest(request, 'payments.subscribe')` at `subscribe/route.ts:102-103` runs
  **after** `getUser()` resolves identity (`:80-90`) and **before** the plan lookup (`:121`), the
  student-resolve (`:133-160`), and every Razorpay call (`createRazorpaySubscription :266`,
  `createRazorpayOrder :340`). Denies 403 with **zero Razorpay side effect**. ✔
- Permission code is correct and real: `PERMISSIONS.PAYMENTS_SUBSCRIBE = 'payments.subscribe'`
  (`rbac.ts:615`), DB-granted to `student` via migration
  `20260611000050_seed_payments_subscribe_permission.sql`; admin via wildcard, super_admin via
  `hasPermission()` bypass (`rbac.ts:608-614`). Same code + placement as siblings
  `verify:79-80` / `create-order:72-73` — pattern match confirmed. ✔
- Defense-in-depth only: a legitimate student with the grant still passes; no legitimate flow loses
  access. No new logging → no P13 surface.

### PAY-8 (no-student-row guard) — PASS
- Resolve-then-guard at `subscribe/route.ts:145-160`: `studentRow.id` → email fallback → **409
  before any Razorpay object**. For a legit student `resolvedStudentId === studentRow.id`, so
  `notes.student_id` is byte-for-byte unchanged (`:272`, `:344`) — no behavior change on the happy
  path; eliminates the orphan-Razorpay-object path that produced `student_unresolved` ops noise. ✔
- Returns before any write → idempotent/retry-safe (nothing to reconcile on client retry). No PII in
  the 409 body. ✔

### PAY-3 (reconcile via atomic RPC) — PASS
- `reconcileOne` now issues a single `admin.rpc('atomic_subscription_activation_locked', …)`
  (`reconcile-payments/route.ts:113-119`) — the **exact RPC the webhook fallback uses**
  (`webhook/route.ts:718, 1113, 1160`), so reconcile and the canonical path are now identical.
- Atomicity verified at the SQL: `atomic_subscription_activation` (baseline `:962-1023`) upserts
  `student_subscriptions` (`ON CONFLICT (student_id)`) **and** updates `students.subscription_plan`
  in one function body / one transaction; the `_locked` wrapper (`:1029-1044`) takes
  `pg_advisory_xact_lock('subscription:'||student_id)` first, so it can no longer interleave with a
  concurrent webhook activation. The old two-write shape (the split-brain this cron exists to repair)
  is gone. ✔
- **WHAT is reconciled is unchanged** — `findStuckPayments` (`:70-95`) is untouched; still acts only
  on `payment_history.status='captured'` rows (which are only ever written by the two
  signature-verified paths) → P11(3) intact, no grant without verified payment. ✔
- **Expiry-field divergence — checked, NOT a regression.** The RPC sets the authoritative period
  `student_subscriptions.current_period_end` (`baseline:1006`) but does **not** write the legacy
  `students.subscription_expiry`. That column is read only for **display** in
  `super-admin/payment-ops/stuck/route.ts:54,93`; **no entitlement-gating path reads it** (effective
  plan resolves via `student_subscriptions` / `resolveEffectiveEntitlement`). The canonical webhook
  activation already never wrote it either, so this *removes* a reconcile-vs-webhook inconsistency
  rather than creating an entitlement bug. Residual: a cron-reconciled row may show a stale/null
  `subscription_expiry` in the super-admin stuck dashboard only. **Non-blocking follow-up** (cosmetic):
  optionally backfill the display column, or read period from `student_subscriptions` in that view.
- Idempotent + fail-closed: `verifyCronSecret` (`:54-66`) returns 401 before any work — untouched;
  re-runs are no-ops (detection WHERE-filter skips already-matching plans + RPC `ON CONFLICT`). ✔

### PAY-7 (missing-secret → 503, bad signature stays 4xx) — PASS (the P11-critical check)
- The split is correct and the dangerous branch is preserved:
  - Missing **server env** `RAZORPAY_WEBHOOK_SECRET` → **503** (`webhook/route.ts:496-499`) so
    Razorpay retries through a deploy/rotation window instead of dropping a real event on a 400. ✔
  - Missing signature **header** → **400** (`:500-502`), correct for a malformed/probe request. ✔
  - **Invalid signature (bad HMAC) is UNCHANGED → hard 400** (`:506-509`), still **before** JSON
    parse, kill-switch read, dedupe, and any DB write. A bad signature is never processed and never
    retried into a grant. **P11(1) intact.** ✔
- Confirmed the env/secret/header presence checks expose no secret value in logs (`:497` logs a
  static string only). No PII. ✔

### PAY-5 (dedupe degradation observability) — PASS
- Both un-dedupable branches (RPC error `:562-580`; missing `account_id`/`event_id` `:589-606`) now
  emit a structured `logOpsEvent` warning **and proceed**. Proceeding cannot double-process given
  downstream idempotency, verified at the SQL layer: activation upserts `ON CONFLICT (student_id)`
  (`baseline:1000`), `payment_history` unique on `razorpay_payment_id`, and
  `atomic_downgrade_subscription` is a no-op on a stale/already-free row. Failing closed here would
  drop genuine events — correctly avoided. ✔
- Both `logOpsEvent` contexts carry only `event_type`, boolean presence flags, error string, and the
  `razorpay_event_id` (an opaque id, not PII). No message text / email / phone / name. **P13 intact.** ✔

### Cross-cutting security
- No `SUPABASE_SERVICE_ROLE_KEY` exposure, no `NEXT_PUBLIC_*` secret, no user input interpolated into
  SQL (all DB access is parameterized `.rpc()` / query-builder). No new `SECURITY DEFINER` introduced
  (the reused RPCs are pre-existing and documented). No schema/RLS/migration touched by the backend
  changes. No middleware/bundle impact (P10). ✔
- Pricing/amount/plan literals untouched in all four files (confirmed against `subscribe` DB-read path
  and `create-order`'s `PRICING` constant). ✔

### Architect verdict: **APPROVE**
All four backend changes strengthen P11 (atomicity on the last non-atomic path; correct retry
semantics; observable idempotency) and P9 (RBAC parity on the highest-blast-radius write), with no
weakening of the signature gate and no new PII/secret surface.
Required follow-ups (non-blocking, owned downstream):
1. **testing** — PAY-6 verify-HMAC-reject unit test + extend the RBAC pin to `subscribe` (the new
   403 path is currently unpinned).
2. **testing** — regression: cron reconcile routes through `atomic_subscription_activation_locked`
   (PAY-3) and a re-fired `subscription.cancelled` is a clean no-op (PAY-5).
3. **ops/architect (cosmetic)** — reconcile no longer writes `students.subscription_expiry`; align
   the super-admin stuck-dashboard display to read period from `student_subscriptions`.

---

## PAY-2 — DEAD/LIVE finding (architect, read-only — NO pricing changed)

**Finding: DEAD on the live web checkout path; LIVE-referenced only by the Flutter mobile client,
whose payment flow is documented as currently non-functional.** The hardcoded `PRICING` table in
`create-order/route.ts:121-125` is exercised by no live web request today.

**Evidence:**
- **Web live path uses `subscribe`, not `create-order`.** The only checkout hook posts to
  `/api/payments/subscribe` (`src/hooks/useCheckout.ts:92`); the E2E checkout spec mocks
  `subscribe` + `verify`, never `create-order` (`e2e/payment-checkout.spec.ts:118,137,…`). A repo-wide
  grep finds **no** `fetch('/api/payments/create-order')` anywhere in `src/`.
- **Remaining `create-order` references in `src/` are non-live:** unit tests
  (`payments-subscribe-rbac.test.ts:93`, `redundant-purchase-guard.test.ts:159`,
  `gst-tax-inclusive-charge.test.ts:182`), a mirror comment in `pricing.ts:16,67`, and a comment in
  `rbac.ts:610`. None are a runtime caller.
- **Mobile references it but the path is documented broken.** `mobile/lib/core/constants/
  api_constants.dart:30` and `mobile/lib/data/repositories/subscription_repository.dart:46` target
  `/payments/create-order`. However `docs/product/mobile-web-sync.md:102,237` records that the mobile
  payment flow "Without this, no subscription purchase can complete" and the prescribed fix is to
  repoint mobile from `/payments/create-order` to `/payments/subscribe`. So the route is referenced,
  not deletable, yet not on any *working* live checkout.

**Pricing-divergence risk (unchanged by this audit):** `create-order`'s hardcoded paisa amounts
(`:121-125`) can drift from the DB `subscription_plans` source of truth that `subscribe` reads
(`subscribe:121-126,224`). No test asserts equality. **No amount was modified** — this is reported for
the orchestrator to surface as a **user-gated** decision.

**Recommended (gated) options for the orchestrator to surface to the user:**
(a) Refactor `create-order` to read `subscription_plans` like `subscribe` (must provably preserve
currently-charged amounts → user-gated), **and/or** (b) repoint the mobile client to `/subscribe` and
then delete `create-order` (mobile-coordination + user approval). **Do not delete `create-order`
unilaterally** — the mobile contract still names it.
