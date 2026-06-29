# Payments & Subscriptions — End-to-End Lifecycle Map

**Audit cycle:** Cycle 2 (DISCOVER→UNDERSTAND→MAP) · **Owner:** Backend (payments) · **Date:** 2026-06-29
**Governing invariant:** P11 (Payment Integrity)
**Scope:** Razorpay one-time orders (yearly) + recurring subscriptions (monthly), webhook lifecycle, renewal/cancel/expiry crons, plan-change/coverage guards, entitlement resolution.

All citations are `path:line` against files read during this audit. Line numbers are point-in-time.

---

## 0. Component inventory (what exists on disk)

| Layer | File | Role |
|---|---|---|
| Razorpay client | `src/lib/razorpay.ts` | Plan/subscription/order creation, quantity update, cancel. Pricing→paisa boundary. |
| Signature util | `src/lib/payment-verification.ts:16-33` | `verifyRazorpaySignature()` — HMAC-SHA256, timing-safe. Single source of P11 verification. |
| Order/sub create (LIVE) | `src/app/api/payments/subscribe/route.ts` | Used by the live checkout hook. Monthly→Razorpay Subscription; yearly→Razorpay Order. |
| Order create (SECONDARY) | `src/app/api/payments/create-order/route.ts` | Order-only path with hardcoded PRICING table. Not on the live checkout path (see §1). |
| Verify | `src/app/api/payments/verify/route.ts` | Client-invoked post-checkout. Server-side HMAC + activation RPC. |
| Webhook | `src/app/api/payments/webhook/route.ts` | Canonical Razorpay event receiver. Signature→killswitch→dedupe→activate/downgrade. |
| Status | `src/app/api/payments/status/route.ts` | Read-only subscription state. |
| Cancel | `src/app/api/payments/cancel/route.ts` | Razorpay cancel-first → atomic local downgrade. |
| Setup plans | `src/app/api/payments/setup-plans/route.ts` | Admin-only Razorpay Plan provisioning (service-role header). |
| Reconcile cron | `src/app/api/cron/reconcile-payments/route.ts` | Every 30 min — self-heal captured-but-not-activated. |
| Expiry cron | `src/app/api/cron/expired-subscriptions/route.ts` | Every 6h — past_due/grace/halt transitions via RPC. |
| Pre-debit cron | `src/app/api/cron/pre-debit-notice/route.ts` | Every 6h — RBI e-mandate 24-48h notice. |
| Health cron | `src/app/api/cron/payments-health/route.ts` | Webhook-silence / stuck-pending monitor (see GAP: not scheduled). |
| Entitlement resolver | `src/lib/entitlements/effective-plan.ts` | B2C↔B2B effective-tier + redundant-purchase guard. |
| Live checkout hook | `src/hooks/useCheckout.ts` | Client orchestration of subscribe→Razorpay modal→verify. |

### Payment RPCs (all SECURITY DEFINER, `search_path=public`, service_role-only)
| RPC | Source migration | Atomic? |
|---|---|---|
| `activate_subscription` | `_legacy/timestamped/20260425150100_pin_search_path_activate_subscription.sql:20-91` | Yes — upsert `student_subscriptions` + UPDATE `students` in one function body. |
| `activate_subscription_locked` | `_legacy/timestamped/20260502170000_hotfix_p11_atomic_subscription_rpcs.sql:216-253` | Yes — advisory lock then `activate_subscription`. |
| `atomic_subscription_activation` | `…20260502170000…:52-131` | Yes — fallback; both tables in one body. |
| `atomic_subscription_activation_locked` | `…20260502170000…:276-302` | Yes — advisory lock then fallback. |
| `atomic_downgrade_subscription` | `…20260502170000…:139-187` | Yes — `FOR UPDATE` lock + stale-cancel guard + both tables. |
| `atomic_cancel_subscription` | `20260505110000_atomic_cancel_subscription_rpc.sql` | Yes (per cancel-route contract `cancel/route.ts:17-42`). |
| `create_pending_subscription` | `20260509124350_create_pending_subscription_clear_stale_lifecycle.sql` | Writes pending `payment_history` + `student_subscriptions`. |
| `record_webhook_event` / `mark_webhook_event_processed` | `_legacy/timestamped/20260425150000_payment_webhook_events.sql:50-113` | Idempotency substrate (unique `(account_id,event_id)`). |
| `mark_subscription_past_due`, `halt_subscription`, `check_expired_subscriptions` | `…20260328160000_recurring_billing.sql`, `…20260425160000…` | Lifecycle transitions. |

---

## 1. CHECKOUT FLOW (client-initiated)

### 1a. Create order/subscription
```
Client (useCheckout.ts:92) → POST /api/payments/subscribe
```
Step-by-step (`subscribe/route.ts`):
1. **Env guard** (`:67-69`) — 503 if Supabase env missing.
2. **Auth** (`:72-89`) — cookie session via `createServerClient`, Bearer fallback via `globalSupabase.auth.getUser(token)`. 401 if neither resolves.
   - NOTE: **no `authorizeRequest('payments.subscribe')` call here** (contrast §1b/§2). See GAP PAY-1.
3. **Validate** (`:91-94`) — `paymentSubscribeSchema` (`validation.ts:166-169`): `plan_code` ∈ enum, `billing_cycle` ∈ enum. Client never sends amount.
4. **Reject free** (`:97-99`) — 400 if `plan_code==='free'`.
5. **Canonicalize plan** (`:102`) — strip `_monthly/_yearly`, map legacy aliases.
6. **Plan lookup from DB** (`:107-116`) — `subscription_plans` where `plan_code` AND `is_active` (source of truth for price).
7. **Duplicate guard** (`:125-140`) — if active same plan+cycle+`razorpay_subscription_id` → 409.
8. **Redundant-purchase guard** (`:149-168`) — `resolveEffectiveEntitlement(studentRow.id)` + `isRedundantPurchase`; 409 `covered_by_school` if school tier ≥ requested. Fail-OPEN on resolve error.
9. **GST gate** (`:196-211`) — `gstChargingEnabled()` fail-CLOSED to NO-GST; only stamps notes when `ff_gst_invoicing_v1` ON.
10. **Monthly branch** (`:214-306`):
    - Requires `razorpay_plan_id_monthly` (`:215-219`) else 503.
    - `createRazorpaySubscription` (`razorpay.ts:101-117`) with `notes={student_id, user_id, plan_code, billing_cycle, ...gst}`.
    - **Atomic pending write** (`:263-271`) `create_pending_subscription` RPC persisting `razorpay_subscription_id`. On RPC error → 503, card not charged (`:273-293`).
    - Returns `{success, data:{type:'subscription', subscription_id, key, ...}}`.
11. **Yearly branch** (`:308-342`):
    - `createRazorpayOrder` (`razorpay.ts:174-188`) with `notes={student_id,user_id,plan_code,billing_cycle:'yearly',...gst}`. Charges tax-inclusive if GST on, else `plan.price_yearly`.
    - Returns `{success, data:{type:'order', order_id, amount(paisa), ...}}`.

### 1b. Secondary order route (NOT on live path)
`create-order/route.ts` — same auth + **adds** `authorizeRequest('payments.subscribe')` (`:72-73`), but uses a **hardcoded PRICING table in paisa** (`:121-125`) instead of DB. Live client calls `subscribe` only (`useCheckout.ts:92`); `create-order` is referenced by `pricing.ts`/tests, not the live checkout. See GAP PAY-2.

### 1c. Client opens Razorpay modal → server verify
```
useCheckout.ts handler → POST /api/payments/verify
```
Step-by-step (`verify/route.ts`):
1. **Env guard** (`:44-51`) — 503 if env missing.
2. **Auth** (`:54-71`) — cookie + Bearer fallback; 401 if none. Client re-grabs a fresh token right before verify to dodge the 2026-05-09 stale-token 401 (`useCheckout.ts:185`, `:295`).
3. **RBAC gate** (`:79-80`) — `authorizeRequest('payments.subscribe')`; returns its errorResponse on deny. **Present here.**
4. **Validate** (`:82-90`) — `paymentVerifySchema` (`validation.ts:171-183`): `razorpay_payment_id` starts `pay_`, `razorpay_signature` min(1).
5. **HMAC verify (P11)** (`:99-115`) — `type==='subscription'` → `sub_id|payment_id`; else `order_id|payment_id`. `crypto.timingSafeEqual`. **401 before any DB write** on mismatch.
6. **Kill switch** (`:131-158`) — `razorpay_payments` flag; 503 Retry-After if OFF. Fail-OPEN on read error.
7. **Idempotency** (`:161-169`) — if `payment_history.razorpay_payment_id` already `captured` → `{success:true, note:'already_processed'}`.
8. **Resolve student** (`:171-214`) — by `auth_user_id`, email fallback (and repairs stale `auth_user_id`). If unresolved → **202 `activation_pending`, NOT success** (P11: no false grant).
9. **Plan price from DB** (`:217-232`) — `subscription_plans`.
10. **Record payment** (`:235-249`) — insert `payment_history` (ignore duplicate).
11. **Activate (critical)** (`:252-259`) — `activate_subscription_locked` RPC. On error → **503 `reconciliation_required`, NOT success** (`:261-284`); webhook/cron reconciles.
12. **Read-back verify** (`:287-300`) — confirms `students.subscription_plan===plan_code`, else 202 `pending_confirmation`.
13. **GST stamp** (`:318-340`) — post-entitlement, best-effort, flag-gated, single UPDATE. Never flips success→error.
14. **200 `{success:true, plan}`** (`:342`).

---

## 2. WEBHOOK FLOW (Razorpay-initiated, canonical source of truth)

```
Razorpay → POST /api/payments/webhook   (webhook/route.ts:482)
```
Ordered processing (matches the P11-mandated order):
1. **Read raw body + signature header** (`:485-487`).
2. **Config guard** (`:489-491`) — 400 if `RAZORPAY_WEBHOOK_SECRET` or `x-razorpay-signature` missing. (See GAP PAY-7: 400 not 503.)
3. **Signature verify FIRST (P11)** (`:495-498`) — `verifyRazorpaySignature(body, sig, secret)`; **400 before any parse/DB work** on mismatch. Comment `:493-494` asserts "MUST run before any other processing."
4. **Parse event** (`:500-501`).
5. **Supabase env guard** (`:503-509`) — 503 (retry) if service key/url missing.
6. **Global kill switch** (`:519-533`) — `razorpay_payments`; 503 Retry-After. Runs AFTER signature (`:516-518`) so attackers can't probe flag state without a valid HMAC. Fail-OPEN on read error (`isRazorpayPaymentsEnabled:314-325`).
7. **Event-level dedupe** (`:540-569`) — `record_webhook_event(account_id, event_id, ...)`; `is_new===false` → 200 `dedupe`. If `account_id`/`event.id` missing OR RPC errors → proceeds WITHOUT event-dedupe (logged warn). See GAP PAY-5.

### 2a. `payment.captured` (yearly one-time / orders) — `:575-788`
- Canonicalize plan; if no plan → 200 ack.
- Idempotency on `payment_history.razorpay_payment_id==captured` → 200.
- `resolveStudent({notesStudentId, notesUserId})` (`:604-611`); unresolved → `handleUnresolved` → 500 (retry).
- Insert `payment_history` (idempotent).
- Activate: `activate_subscription_locked` (`:632-638`); on error → atomic-fallback kill-switch check (`:647-675`, 503 if OFF) → `atomic_subscription_activation_locked` (`:681-687`); both fail → 503 (retry), **never per-table writes** (`:689-720`).
- Publish `billing.invoice_paid` event (`:747-761`), PostHog `payment_succeeded` with SAFE subset (no signature) (`:774-786`).
- `markEvent('activated')` + timing emit.

### 2b. `payment.failed` — `:790-856`
- Resolve student (unresolved → 200 ack, not 500 — failed payment is low-criticality).
- Insert `payment_history` status `failed`. PostHog `payment_failed` with `error_code` only (never `error_description`) (`:843-854`). 200.

### 2c. Subscription events — `:861-1337`
`subEvents` set (`:861-870`): authenticated, activated, charged, pending, halted, cancelled, expired, completed.
- **School branch first** (`:881-952`) — `handleSchoolSubscriptionEvent` detects `notes.school_id`; idempotent `school_subscriptions` updates; DB error → throw → 500 (retry). Returns null → fall through to student path.
- **Resolve student** (`:954-962`) — `{notesStudentId, rzSubId, notesUserId}`; unresolved → 500 (retry).
- **authenticated** (`:973-985`) — pending row exists → 200 ack.
- **activated / charged** (`:988-1229`) — record payment if entity present; activate via `activate_subscription_locked` (authUserId path) or `atomic_subscription_activation_locked` (no-authUserId path `:1118-1163`); same fallback/kill-switch ladder as 2a; both fail → 503. Publish invoice_paid + PostHog activated/renewed.
- **pending** (`:1232-1262`) — `mark_subscription_past_due(grace_days=3)`; RPC error → 503.
- **halted** (`:1265-1280`) — `downgradeIfMatchingSub(...,'halted')` → `atomic_downgrade_subscription` RPC (race-safe, stale-cancel guard).
- **cancelled / expired / completed** (`:1283-1324`) — `downgradeIfMatchingSub`; PostHog `subscription_cancelled` only when actually downgraded.
- Fallthrough/unknown → 200 ack (`:1326-1342`).
- **Outer catch** (`:1343-1348`) → 500 (retry).

### Webhook HTTP-status contract (observed)
| Condition | Status | Razorpay retry? | Correct? |
|---|---|---|---|
| Bad/invalid signature | 400 | No | Yes |
| Missing webhook secret/header | 400 | No | **No** — should 503 (PAY-7) |
| Missing Supabase env | 503 | Yes | Yes |
| Kill switch active | 503 + Retry-After | Yes | Yes |
| Duplicate (dedupe) | 200 | No | Yes |
| Already processed | 200 | No | Yes |
| Student unresolved (captured/sub) | 500 | Yes | Yes |
| RPC(s) failed | 503 | Yes | Yes |
| Activated/downgraded/ack | 200 | No | Yes |
| Unhandled exception | 500 | Yes | Yes |

---

## 3. RENEWAL / CANCEL / EXPIRY

### 3a. Renewal (recurring)
Razorpay fires `subscription.charged` → webhook §2c activated/charged branch reuses `activate_subscription_locked` to bump `current_period_end`/`next_billing_at`. Pre-debit notice cron (§3d) sends RBI mandate notice 24-48h before each charge.

### 3b. Cancel (`cancel/route.ts`)
1. Auth (cookie+Bearer) `:61-71`. (No `authorizeRequest`; guardian path uses ownership check.)
2. Validate `paymentCancelSchema` (`validation.ts:185-188`).
3. Resolve student: self (`auth_user_id`) OR guardian-on-behalf via `listChildrenForGuardian` ownership (`:96-116`); non-owned → 404 (no enumeration).
4. Guard terminal/free states → 400 (`:129-131`).
5. **Razorpay cancel FIRST** (`:136-204`) — if Razorpay API fails: log `subscription_events`, enqueue `task_queue` retry, ops critical, **502, DO NOT downgrade locally** (prevents charge-while-cancelled split-brain).
6. **Atomic local cancel** (`:209-246`) — `atomic_cancel_subscription` RPC (FOR UPDATE, single txn, idempotent `already_terminal`). RPC error after Razorpay success → 503 `reconciliation_required`.
7. Audit `subscription_events` + scheduled/immediate response.

### 3c. Expiry cron (`expired-subscriptions/route.ts`, every 6h `vercel.json:49-52`)
1. `verifyCronSecret` constant-time (`:35-47`); 401 if bad.
2. `check_expired_subscriptions` RPC (`:63`) — active-past-period → past_due+grace; past_due-past-grace → halted. Idempotent WHERE filters. RPC error → 500.

### 3d. Pre-debit cron (`pre-debit-notice/route.ts`, every 6h `vercel.json:57-60`)
1. `verifyCronSecret` (`:56-65`); 401 if bad. 503 if env missing.
2. Window [+24h,+48h], `auto_renew=true`, status ∈ active/past_due (`:114-122`).
3. Per-sub idempotency `pre_debit_{id}_{date}` checked against `subscription_events` (`:153-163`) + Edge-Function-side unique index. No email → fail (must not auto-charge per RBI). Per-sub failures isolated (`:209-219`).

### 3e. Reconcile cron (`reconcile-payments/route.ts`, every 30 min `vercel.json:45-48`)
1. `verifyCronSecret` (`:52-64`); 401 if bad.
2. `findStuckPayments` (`:75-100`) — captured `payment_history` whose `students.subscription_plan` ≠ paid `plan_code`.
3. `reconcileOne` (`:102-168`) — **two separate writes**: UPDATE `students` (`:107-114`) then UPSERT `student_subscriptions` (`:128-143`). NOT wrapped in the atomic activation RPC. See GAP PAY-3.
4. Batch cap 100/run; backlog ≥100 → critical ops event.

### 3f. Health cron (`payments-health/route.ts`)
Webhook-silence / stuck-pending-payment / stuck-pending-subscription / verify-401-spike checks; writes `ops_events` only. **Comment claims "every 10 minutes (vercel.json)" (`:60-62`) but NO cron entry exists in `vercel.json:32-81`.** See GAP PAY-4.

---

## 4. PLAN-CHANGE / COVERAGE / ENTITLEMENT

- **Effective plan** (`effective-plan.ts:13-55`) — highest tier among school coverage (active seat), personal sub (active/past_due in grace), free floor. One ranking via `planTier` (`plans.ts`).
- **Redundant-purchase guard** — both `subscribe/route.ts:149-168` and `create-order/route.ts:92-110` short-circuit 409 when school tier ≥ requested. Genuine upgrade above school tier falls through. Fail-OPEN.
- **Plan swap** — Razorpay does not support plan_id change on a running subscription (`razorpay.ts:142-145`); a true swap is cancel + re-subscribe. Quantity (seat) bumps via `updateRazorpaySubscriptionQuantity` (`razorpay.ts:147-159`).
- **Status read** (`status/route.ts`) — suppresses stale lifecycle dates while `pending` (`:106-130`); grace computed from `grace_period_end`.

---

## 5. P11 quick-trace (every grant requires verified payment)

| Grant path | Signature proof before grant? | Atomic grant? |
|---|---|---|
| verify route | Yes — server HMAC `verify/route.ts:99-115` | Yes — `activate_subscription_locked` |
| webhook captured/activated/charged | Yes — `webhook:495-498` | Yes — `activate_subscription_locked`/atomic fallback |
| reconcile cron | Indirect — only acts on `payment_history.status='captured'` rows, which are written only by the two signature-verified paths above | **No** — two separate writes (PAY-3) |

No path grants access on client assertion alone; the client `razorpay_signature` is always re-derived server-side.
