# Phase 3: Payment Ops Console — Design Spec

**Date:** 2026-04-12
**Status:** Design approved
**Depends on:** Phase 1 (Observability Console — ops_events instrumentation for payments)

---

## Context

When a Razorpay payment is captured but the student's subscription doesn't activate (due to RPC failure, split-brain fallback, or race condition), the only fix today is running raw SQL from `reconcile_stuck_payments.sql`. There is no admin visibility into stuck payments, no alerting when they occur, and no timing analytics to know how long activation typically takes. Phase 1 already instruments 3 payment ops_events (signature fail, RPC fail/split-brain, success) — this phase surfaces that data and adds actionable reconciliation tools.

## Architecture

**No new tables.** Everything reads from existing `payment_history`, `students`, `student_subscriptions`, and `ops_events`. Reconciliation writes to `students` and `student_subscriptions` (same tables the webhook handler writes to).

**New tab** on the existing `/super-admin/subscriptions` page:
- Tab 1: Revenue & Entitlements (existing — unchanged)
- Tab 2: Payment Ops (new)

**3 new API routes** under `/api/super-admin/payment-ops/`:

| Route | Method | Purpose |
|---|---|---|
| `/stuck` | GET | Detect stuck payments: captured but plan not active |
| `/reconcile` | POST | Fix a single student or all stuck payments |
| `/stats` | GET | Health strip: stuck count, failure count (24h), avg activation time |

**1 seeded alert rule** in `alert_rules`: "Stuck payment detected" — category=payment, fires when stuck count > 0.

## Payment Ops Tab Layout

### Health strip (top)
- **Stuck count** — number of payments where `status='captured'` but student plan doesn't match
- **Failed webhooks (24h)** — count of `ops_events` WHERE `category='payment' AND severity IN ('error','critical') AND occurred_at > now() - 24h`
- **Avg activation time** — median seconds between `payment_history.created_at` and subscription becoming active
- **[Reconcile All Stuck]** button — batch fix

### Stuck payments table
Detection query:
```sql
SELECT ph.*, s.name, s.email, s.subscription_plan AS current_plan
FROM payment_history ph
JOIN students s ON s.id = ph.student_id
WHERE ph.status = 'captured'
  AND (s.subscription_plan IS NULL
       OR s.subscription_plan = 'free'
       OR s.subscription_plan != ph.plan_code)
ORDER BY ph.created_at DESC
```

Columns: student name/email, razorpay_payment_id, plan_code, amount, captured_at, current plan vs expected plan, [Reconcile] button per row.

### Reconcile action
Per-student or batch:
1. Update `students.subscription_plan = ph.plan_code`
2. Update `students.subscription_expiry` based on `ph.billing_cycle` (monthly: +30 days, yearly: +365 days from `ph.created_at`)
3. Upsert `student_subscriptions` with `plan_code`, `status='active'`
4. Emit `ops_event` (category='payment', source='payment-ops', severity='info', message='manual reconciliation')
5. Log `admin_audit_log` entry
6. Return updated student record for UI refresh

### Recent payment failures
Filtered view of `ops_events WHERE category='payment' AND severity IN ('error','critical')`, last 20 events. Each row shows time, severity, message, payment ID. Link to Observability Console for full detail.

### Activation timing
For the last 50 captured payments, compute the delta between `payment_history.created_at` and the earliest `student_subscriptions.updated_at` where `plan_code` matches and `status='active'` after the payment timestamp.

Display: median, P95, max, failure count. Plus a table showing recent activations with timing and success/fail status.

## Scope

### Ships
- Payment Ops tab component on subscriptions page
- 3 API routes (stuck, reconcile, stats)
- 1 seeded alert rule (stuck payment detected)
- Tests (Vitest + Playwright)
- Regression entries

### Non-goals
- No refund/chargeback management
- No payment creation from admin panel
- No webhook handler modifications
- No new database tables
- No changes to Revenue & Entitlements tab

## Testing
- Vitest: stuck detection query, reconcile action, stats computation
- Playwright: navigate to Payment Ops tab, verify health strip renders, verify stuck table
- Regression: R48 (reconcile action audit-logged), R49 (stuck detection matches runbook SQL)