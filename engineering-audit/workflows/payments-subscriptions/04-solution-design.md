# Payments & Subscriptions — Solution Design (Cycle 2, auto-fix-safe set)

**Audit cycle:** Cycle 2 (SOLUTION DESIGN) · **Owner:** Backend (payments) · **Date:** 2026-06-29
**Invariant under design:** P11 (Payment Integrity), with P9 (RBAC) and P13 (Privacy) preserved.

This document designs the full auto-fix-safe Cycle-2 hardening set. It does **not** change any
pricing, plan definition, or amount anywhere (that is PAY-2, which is user-gated and excluded).
None of these changes alters the signature-verification logic, the score/XP formulas, or any
schema/RLS.

---

## Scope

| ID | Title | Class | Owner | Designed here |
|---|---|---|---|---|
| PAY-1 | `subscribe` lacks `authorizeRequest` gate | AUTO-FIX-SAFE | Backend | Yes |
| PAY-3 | reconcile cron non-atomic two-write | AUTO-FIX-SAFE | Backend | Yes |
| PAY-4 | payments-health monitor not scheduled | AUTO-FIX-SAFE* | **Architect** (vercel.json) | Stub only |
| PAY-5 | dedupe skipped when ids absent / RPC errors | AUTO-FIX-SAFE | Backend | Yes |
| PAY-6 | verify HMAC-reject path untested | AUTO-FIX-SAFE | **Testing** | Stub only |
| PAY-7 | missing webhook secret → 400 not 503 | AUTO-FIX-SAFE | Backend | Yes |
| PAY-8 | `subscribe` mints Razorpay obj w/o student row | AUTO-FIX-SAFE | Backend | Yes |

**GATED / excluded from this cycle:**
- **PAY-2 — `create-order` hardcoded pricing diverges from DB.** Touching any amount **REQUIRES
  USER APPROVAL** (constitution: pricing values are user-gated; cf. REG-65 pricing-verbatim). The
  read-from-DB refactor is only auto-fix-safe if it provably preserves current charged amounts, and
  `create-order` is off the live checkout path today (the live hook posts to `subscribe`). **Action:
  flag to user; do NOT auto-edit.**
- **PAY-9 — `razorpay_signature` persisted at rest in `payment_history` (verify path).** Optional,
  informational. Not a P13 logging breach (DB column, not a log/Sentry event; the value is a
  per-payment HMAC, not a reusable secret). **No action this cycle.**

\* PAY-4's fix is config-trivial but needs architect/ops confirmation of the Vercel cron-slot budget
(13 crons already declared) — hence architect ownership, not backend.

---

## Design per gap (backend-owned)

### PAY-1 — Add the RBAC gate to `subscribe`
**Root cause (from 03):** an RBAC retrofit enumerated routes by hand and missed `subscribe`, the
actual live order/subscription creator; the pinning test encoded the same blind spot.

**Design:** add the identical guard its siblings already carry, copied byte-for-byte from
`verify/route.ts:79-80` and `create-order/route.ts:72-73`:
```ts
const auth = await authorizeRequest(request, 'payments.subscribe');
if (!auth.authorized) return auth.errorResponse!;
```
Placed immediately after the existing `getUser()` 401 block, **before** any plan lookup or Razorpay
object creation. The exact permission code is `payments.subscribe` (the same code both siblings use —
verified by reading both routes). The `getUser()` block is retained because it supplies `user.id` /
`user.email` order metadata used downstream.

**Alternatives rejected:**
- *Replace `getUser()` entirely with `authorizeRequest`.* Rejected — `authorizeRequest` returns an
  authz verdict, not the `user` object the route needs for `notes`/email resolution. Keeping both is
  what the siblings do; consistency is the goal.
- *Introduce a new permission code (e.g. `payments.create`).* Rejected — that is an RBAC change
  (user-approval-gated) and breaks interchangeability with the siblings. Reuse the existing grant.

**Why P11/P9 preserved:** defense-in-depth only. A legitimate student with the `payments.subscribe`
grant still passes; super_admin/admin bypass as everywhere. No legitimate-flow behavior changes; the
gate strictly denies (403) non-students before the highest-blast-radius write.

### PAY-8 — Block Razorpay creation when no student row resolves
**Root cause:** order creation proceeded without confirming a billable subject exists; the existing
guards were nested inside `if (studentRow)` and the monthly branch fell back to an empty
`notes.student_id`.

**Design:** resolve the student id once (auth_user_id → email fallback, mirroring the verify route)
right after the existing `studentRow` fetch, and short-circuit with a clean **409** before any
Razorpay object is created if none resolves. The monthly branch's now-duplicate resolution block is
deleted and both branches use the single resolved id. For a legitimate student the resolved id equals
`studentRow.id`, so notes and behavior are byte-for-byte unchanged.

**Alternatives rejected:**
- *Rely solely on PAY-1's RBAC gate.* Rejected — PAY-1 blocks the wrong *role*, but a student-role
  principal without a provisioned `students` row (mid-onboarding edge) would still slip through.
  PAY-8 closes the no-billable-subject case directly.
- *400 instead of 409.* Chose 409 (conflict with account state) so the client can render a
  "complete onboarding first" message distinct from a malformed-request 400.

**Why P11 preserved:** strictly removes a path that produced orphan Razorpay objects with empty
`student_id` notes (which the webhook later marks `student_unresolved`). No grant path is touched.

### PAY-3 — Make reconcile-cron activation atomic
**Root cause:** the cron re-implemented activation in JS (UPDATE students; UPSERT
student_subscriptions) instead of delegating to the atomic RPC that already existed for exactly this.

**Design:** replace the two writes in `reconcileOne` with a single call to
`atomic_subscription_activation_locked` — the **same** RPC the webhook uses as its split-brain
fallback (`webhook/route.ts:681`). Params: `{ p_student_id, p_plan_code, p_billing_cycle,
p_razorpay_payment_id, p_razorpay_subscription_id: null }`. The RPC upserts both tables in one
transaction and (via the `_locked` wrapper) takes `pg_advisory_xact_lock` keyed by student — so the
cron can no longer interleave with a concurrent webhook activation for the same student. The
`findStuckPayments` detection logic is untouched: **what** gets reconciled is unchanged, only **how**
the write commits.

**Behavior note (expiry):** the old cron set `students.subscription_expiry` from `created_at + N
days`; the RPC instead derives `student_subscriptions.current_period_end` from `NOW()` and does not
touch `students.subscription_expiry`. This is **intentional and more correct** — it makes reconcile
identical to the webhook's own activation path (`activate_subscription` / `atomic_subscription_
activation` both use `NOW()` and neither writes `students.subscription_expiry`; the period source of
truth is `student_subscriptions.current_period_end`). For a payment reconciled within the ≤30-min
cron lag the timestamp delta is minutes. The now-unused `computeExpiry` helper is removed.

**Alternatives rejected:**
- *Wrap the two existing JS writes in a manual transaction from the client.* Rejected — the
  Supabase JS client cannot open a multi-statement transaction; that is exactly why the SQL RPC
  exists. Re-deriving the writes is the anti-pattern that caused PAY-3.
- *Add a new reconcile-specific RPC that preserves `created_at + N` expiry.* Rejected — duplicates an
  invariant already centralized in SQL and diverges reconcile from the webhook. Consistency with the
  one authoritative activation RPC is the design goal.

**Why P11 preserved:** atomicity is *strengthened* (the only path that lacked it now has it) and
advisory-lock serialization is gained for free. The kill-switch-equivalent gating is not relevant
here (reconcile only ever acts on signature-verified `captured` rows).

### PAY-5 — Make dedupe degradation fail-safe and observable
**Root cause:** a deliberate fail-OPEN choice (proceed rather than drop a possibly-real event) that
leaned entirely on downstream idempotency without making that reliance explicit or observable.

**Design:** keep proceeding (failing closed would drop real events), but in **both** un-dedupable
branches (missing `account_id`/`event_id`, and `record_webhook_event` RPC error) emit a structured
`logOpsEvent` warning so the silent degradation becomes an ops signal, and document in-code that the
re-processing is safe because every downstream activation is idempotent:
`activate_subscription` / `atomic_subscription_activation` upsert `ON CONFLICT (student_id)`,
`payment_history` is unique on `razorpay_payment_id`, and `atomic_downgrade_subscription` is a no-op
on a stale/already-free row. No new guard that could drop an event is introduced.

**Alternatives rejected:**
- *Fail closed (reject the event when un-dedupable).* Rejected — Razorpay always populates both
  fields in practice; failing closed would drop genuine events for zero real protection (downstream
  is already idempotent).
- *Synthesize a surrogate dedupe key from the payload hash.* Rejected — adds complexity and a new
  failure mode for a branch that is essentially never taken; the audit explicitly recommends
  observability + test, not a new key scheme.

**Why P11/P13 preserved:** idempotency guarantee is unchanged in the happy path and now *observable*
when degraded. The ops-event context carries only event-type + boolean presence flags + error
string (UUIDs/codes only) — no PII.

### PAY-7 — Split missing-secret (503) from missing-header (400) on the webhook
**Root cause:** one guard conflated a server env-misconfig (retryable) with a malformed request
(terminal) into a single 400.

**Design:** split the branch. Missing `RAZORPAY_WEBHOOK_SECRET` (server env, e.g. deploy/rotation
window) → **503** so Razorpay retries through the window instead of permanently dropping a genuine
event. Missing `x-razorpay-signature` **header** → stays **400** (no retry; malformed/illegitimate
request). The invalid-**signature** branch below is **untouched** — a genuinely bad HMAC remains a
4xx reject.

**Alternatives rejected:**
- *Make both 503.* Rejected — a request with no signature header is a malformed/probe request, not a
  server fault; 4xx (no retry) is correct for it. Only the env-misconfig case is retryable.
- *Make both 400 (status quo).* Rejected — that is the gap: it permanently drops real events during
  an env-misconfig window, reproducing the captured-but-not-activated incident class.

**Why P11 preserved:** improves retry semantics (5xx for the retryable cause); does not touch
signature verification. The reconcile cron remains a 30-min backstop if any event is still missed.

---

## Stubs (other owners)

### PAY-4 (architect — `vercel.json`)
Add `{ "path": "/api/cron/payments-health", "schedule": "*/10 * * * *" }` to `vercel.json` crons,
**pending architect/ops confirmation of the Vercel cron-slot budget** (13 crons already declared; if
at the plan cap, fold the checks into `daily-cron` or run via Supabase pg_cron per the 2026-06-26
audit-log Option C). Owned by architect because it is deploy-config, not app code.

### PAY-6 (testing)
Add a unit test pinning the verify route's server-side HMAC reject: valid auth + RBAC pass + a
tampered `razorpay_signature` → expect **401** and **no** `activate_subscription_locked` call. Mirror
the webhook integration test's structure. Owned by testing.

---

## Risk & rollback

- **Blast radius:** all backend changes are pure Next.js app code (no schema, no migration, no RLS,
  no pricing). The reconcile change reuses an RPC already in production via the webhook fallback.
- **Risk level:** Low. PAY-1/PAY-8 only add denials for illegitimate/incomplete principals;
  PAY-3 strengthens an existing path with an already-deployed RPC; PAY-5 adds observability only;
  PAY-7 changes one status code on a server-misconfig branch.
- **Rollback:** `git revert` of the commit. No data migration to undo, no flag to flip. The
  `atomic_subscription_activation_locked` RPC predates this change and stays in place regardless.
- **Forward verification:** `npm run type-check` (clean), plus PAY-6's new verify-reject test and an
  existing/extended RBAC test that should be widened to cover `subscribe` (testing-owned).
