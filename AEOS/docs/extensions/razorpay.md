# extensions/razorpay.md

# Alfanumrik Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Extension Module
**Priority:** Critical
**Applies To:** Every code path that creates, verifies, activates, renews, downgrades, or reconciles a Razorpay payment, subscription, or order at Alfanumrik.

---

# Purpose

AEOS core docs 06 (API Engineering) and 09 (Security Protocol) define the generic rules for webhooks, idempotency, and security. This module binds them to Alfanumrik's actual Razorpay integration so an AI engineer touching billing inherits the hard-won invariants instead of rediscovering them — and so the platform's payment-integrity invariant (**P11**) is never silently weakened.

Razorpay is Alfanumrik's payment processor for INR billing: **monthly recurring** plans (Razorpay Subscriptions) and **yearly one-time** purchases (Razorpay Orders). Money correctness has no acceptable failure mode that grants access without verified payment.

---

# Scope

In scope: webhook signature verification, atomic subscription-status writes, event idempotency, the subscription lifecycle, and the real files that implement them.

Out of scope: pricing/plan definitions and feature limits (assessment + product domain; `src/lib/plans.ts` and the `subscription_plans` table), GST invoicing internals beyond the fail-closed gate, and UI billing surfaces (frontend domain).

---

# How AEOS core binds here

* **06_API_ENGINEERING** — "APIs are contracts; idempotent where applicable" maps directly. Razorpay retries any non-2xx for up to ~24 hours, so the webhook MUST be idempotent and MUST return 2xx once it has durably handled (or safely skipped) an event. Returning 5xx is the *correct* way to ask Razorpay to retry on a transient failure; returning 4xx tells it to stop.
* **09_SECURITY_PROTOCOL** — the webhook is an unauthenticated public endpoint reachable by anyone. The HMAC signature check is the entire trust boundary. No DB read or write may happen before it passes.

The governing product invariant is **P11 (Payment Integrity)**: signature verified before processing; subscription status written atomically with the payment record; never grant plan access without verified payment. Where this module and P11 disagree, P11 wins.

---

# Key Files

| File | Role |
|---|---|
| `src/lib/razorpay.ts` | Razorpay REST client — plans, subscriptions, orders. Pricing is rupees internally; **× 100 to paisa only at the API boundary** here. Basic-auth header from `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`. |
| `src/app/api/payments/subscribe/route.ts` | Creates a Razorpay subscription (monthly) and a pending `student_subscriptions` row. |
| `src/app/api/payments/create-order/route.ts` | Creates a one-time order (yearly). |
| `src/app/api/payments/verify/route.ts` | Client-callback confirmation — re-verifies HMAC, records payment, activates via RPC. Returns `success:true` **only** if entitlement was actually granted. |
| `src/app/api/payments/webhook/route.ts` | **Canonical** Razorpay webhook receiver (the legacy Edge Function `payments` handler is disabled). |
| `src/app/api/payments/status/route.ts`, `cancel/route.ts`, `setup-plans/route.ts` | Status read, auto-renew cancel, plan provisioning. |
| `src/lib/payment-verification.ts` | `verifyRazorpaySignature` — timing-safe HMAC-SHA256 comparison. |

---

# Webhook Processing Order (non-negotiable)

The order below is implemented in `webhook/route.ts` and may not be reordered:

1. **Read the raw body and the `x-razorpay-signature` header.** Verify HMAC-SHA256 over the raw body with `RAZORPAY_WEBHOOK_SECRET`, timing-safe, **before parsing or touching the database**. Mismatch → log and return 400 immediately. This is the literal first thing the handler does after reading config.
2. **Kill-switch check** (`razorpay_payments` flag) — read *after* signature verification so an attacker cannot probe flag state without a valid HMAC. If off, return 503 + `Retry-After` before any DB work, so Razorpay retries with backoff and no events are lost.
3. **Event-level idempotency** — `record_webhook_event` records `(account_id, event_id)` under a unique constraint in `payment_webhook_events`. A duplicate delivery → ACK 200 and skip.
4. **Resolve the subscriber** — three-step order: `notes.student_id` → `student_subscriptions.razorpay_subscription_id` → `students.auth_user_id = notes.user_id`. School subscriptions branch first on `notes.school_id`. All-failed → log critical and return 500 so Razorpay retries.
5. **Mutate atomically** (see below), record the payment, and emit telemetry.
6. **Return 200** on success. On a transient/DB failure, return 5xx so Razorpay retries.

---

# Atomic Subscription Activation

Subscription status and the payment record must move together — a "split-brain" where one is written without the other is a P11 violation. The webhook **never** issues two bare `UPDATE` statements. It calls RPCs that mutate both `students` and `student_subscriptions` (and record the payment) inside a single transaction:

* **Primary:** `activate_subscription_locked` (advisory-locked by student to serialize against the verify-route).
* **Fallback:** `atomic_subscription_activation_locked` — single-transaction upsert across both tables (migration `20260424120000_atomic_subscription_activation_rpc.sql`). Gated by the `ff_atomic_subscription_activation` flag; if that flag is off and the primary RPC fails, the handler returns 503 immediately rather than risk a partial write.
* **Both RPCs fail → HTTP 503.** It does **not** fall back to per-table writes, because that re-introduces the exact split-brain the RPCs exist to prevent.
* **Downgrades** (`halted` / `cancelled` / `expired` / `completed`) go through `atomic_downgrade_subscription`, which row-locks `student_subscriptions`, applies a stale-cancel guard, and downgrades both tables in one transaction — closing the SELECT-then-UPDATE race.

Verify-route and webhook contention is serialized via `pg_advisory_xact_lock` keyed by student.

---

# Subscription Lifecycle

Handled events (student and school scopes): `payment.captured`, `payment.failed`, `subscription.authenticated`, `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.expired`, `subscription.completed`.

State semantics (from the `payment-flow` skill and the handler):

* `pending` → first payment awaited (free tier only).
* `active` → paid and current; `subscription.charged` (renewal) keeps it active and extends `current_period_end`.
* `past_due` → `subscription.pending` marks past-due with a grace window (`mark_subscription_past_due`, 3 days) — do **not** instantly cut off access.
* `halted` → retries exhausted; downgrade to free.
* `cancelled` → keep access until `current_period_end`; Razorpay fires `cancelled` immediately and `expired` at period end.
* `expired` → terminal; free tier.

Monthly = recurring Subscription; yearly = one-time Order (`payment.captured`). Never model a yearly purchase as a recurring subscription.

---

# Security Notes

* The webhook is public and unauthenticated by design. The HMAC check over the **raw** request body is the whole trust boundary — never verify over a re-serialized JSON object (re-serialization changes bytes and breaks the signature).
* `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` are required server secrets. Never log them, never expose via `NEXT_PUBLIC_`, never echo into command output.
* PII discipline (P13): never emit `razorpay_signature` or free-text `error_description` into analytics/logs — pass only stable fields (`error_code`, plan, amount, IDs). Use the `razorpay_event_id` as the analytics `$insert_id` so retries dedupe at ingest.
* Use the admin client (service role, RLS bypassed) for webhook writes — there is no signed-in user in a webhook context — and keep all such logic server-side.
* Test vs live keys: test keys for staging, live keys for production. Verify before shipping.

---

# Checklist

- [ ] Signature verified (timing-safe HMAC over raw body) before any parse/DB access; mismatch → 400.
- [ ] Event idempotency enforced via `payment_webhook_events`; duplicates ACK and skip.
- [ ] Subscriber resolved through the documented 3-step (student) / school-first order; unresolved → 500 (retry).
- [ ] Status + payment record written atomically via RPC; both-fail → 503, never per-table writes.
- [ ] Grace period honored for `past_due`; cancellation keeps access until `current_period_end`.
- [ ] Yearly = one-time Order; monthly = recurring Subscription.
- [ ] No secrets, signature, or free-text card errors in logs/analytics.
- [ ] 2xx on success, 5xx on transient failure so Razorpay retries; never grant access without verified payment.

---

# References

* `06_API_ENGINEERING.md` — webhook contracts, idempotency, retry semantics.
* `09_SECURITY_PROTOCOL.md` — trust boundaries, secrets, least privilege.
* `extensions/supabase.md` — admin client + atomic-RPC patterns the webhook relies on.
* Project constitution `.claude/CLAUDE.md` — invariant **P11 (Payment Integrity)**, plus P9/P13.
* Skill: `.claude/skills/payment-flow` — plans, states, and event-to-action mapping.

---

# Final Directive

Money is the one place where "probably fine" is unacceptable. Verify the signature first, always; write status and payment atomically through the RPCs, never as two loose updates; and never, under any failure mode, grant plan access without a verified payment. When in doubt, return 5xx and let Razorpay retry rather than write something wrong. P11 is the floor, not the ceiling.

**End of Document**
