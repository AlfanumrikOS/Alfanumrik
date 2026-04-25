# Payment Webhook Recovery Runbook

## Scope
What to do when Razorpay payments arrive but entitlement is not granted, or when subscription state diverges from Razorpay.

## Architecture (post-hardening, 2026-04-25)

```
Razorpay → POST /api/payments/webhook
  ├── verifyRazorpaySignature (HMAC-SHA256, timing-safe)
  ├── record_webhook_event RPC (account_id + event_id unique → dedupe)
  ├── resolveStudent (3-step: notes.student_id → rz_sub_id → notes.user_id)
  ├── activate_subscription_locked RPC (advisory lock per student)
  │     └── on failure → atomic_subscription_activation_locked RPC
  │           └── on failure → return 503 (Razorpay retries)
  ├── For downgrades: atomic_downgrade_subscription RPC (row-level lock + stale-cancel guard)
  ├── For past_due: mark_subscription_past_due RPC (3-day grace)
  └── mark_webhook_event_processed (outcome dashboard) +
      emit payment.webhook_processed ops event (latency_ms, outcome, event_type)
```

Key tables:
- `payment_webhook_events` — every received event (unique on `(razorpay_account_id, razorpay_event_id)`); processed_at + outcome tracked
- `payment_history` — every payment attempt (unique on `razorpay_payment_id`)
- `students.subscription_plan` + `student_subscriptions` — entitlement state (kept in sync via `*_locked` RPCs)

Key RPCs (all `SECURITY DEFINER SET search_path = public`):
- `record_webhook_event(p_account_id, p_event_id, p_event_type, p_raw_payload) → TABLE(is_new, id)`
- `mark_webhook_event_processed(p_id, p_outcome)`
- `activate_subscription_locked(p_auth_user_id, p_plan_code, p_billing_cycle, p_razorpay_payment_id, p_razorpay_order_id, p_razorpay_subscription_id)`
- `atomic_subscription_activation_locked(p_student_id, p_plan_code, p_billing_cycle, p_razorpay_payment_id, p_razorpay_subscription_id)`
- `atomic_downgrade_subscription(p_student_id, p_cancelled_sub_id, p_new_status) → TABLE(outcome)`
- `mark_subscription_past_due(p_student_id, p_grace_days)`

## Common scenarios

### Scenario 1: Customer paid but plan still says Free

1. Find the payment in Razorpay dashboard. Note `payment_id` and `event_id`.
2. Check `payment_webhook_events`:
   ```sql
   SELECT id, event_type, received_at, processed_at, outcome
   FROM payment_webhook_events
   WHERE razorpay_event_id = '<event_id>'
   ORDER BY received_at DESC;
   ```
   - **No row**: webhook never reached us. Check Razorpay's webhook delivery log for HTTP errors (timeouts, signature mismatches). Re-fire the event from Razorpay dashboard.
   - **Row with outcome=`unresolved`**: student lookup failed. Inspect `raw_payload->'payload'->'payment'->'entity'->'notes'` for missing `student_id`/`user_id`. Fix the row in `students` (e.g., reattach `auth_user_id`); then re-fire the webhook.
   - **Row with outcome=`failed`**: both RPCs failed. Look at the corresponding `payment.webhook_processed` ops event for the recorded `error.message`. Fix the underlying cause (e.g., missing plan_code, schema drift), then call `atomic_subscription_activation_locked` manually:
     ```sql
     SELECT atomic_subscription_activation_locked(
       p_student_id := '<student_id>',
       p_plan_code := '<plan>',
       p_billing_cycle := '<monthly|yearly>',
       p_razorpay_payment_id := '<payment_id>',
       p_razorpay_subscription_id := '<sub_id or NULL>'
     );
     UPDATE payment_webhook_events SET processed_at = now(), outcome = 'activated' WHERE id = '<row_id>';
     ```
   - **Row with outcome=`activated`** but `students.subscription_plan` still 'free': split-brain alarm. Check `student_subscriptions.status` — should be 'active'. If both tables disagree, file a P0 incident; the atomic RPCs are designed to prevent this.
3. Verify entitlement granted:
   ```sql
   SELECT s.subscription_plan, ss.status, ss.plan_code, ss.current_period_end
   FROM students s
   LEFT JOIN student_subscriptions ss ON ss.student_id = s.id
   WHERE s.id = '<student_id>';
   ```

### Scenario 2: Suspected duplicate charges

`payment_history.razorpay_payment_id` has a unique constraint. Confirm:
```sql
SELECT razorpay_payment_id, count(*) AS n, array_agg(id) AS ids
FROM payment_history
GROUP BY 1
HAVING count(*) > 1;
```
Expected: zero rows. If duplicates appear, the unique constraint is missing or was dropped — escalate to architect immediately.

Razorpay-side double-charge investigation: look at `payment_webhook_events.raw_payload` for the same `razorpay_event_id` appearing more than once with a different `received_at`. The unique constraint on `(razorpay_account_id, razorpay_event_id)` means only the first INSERT wins; subsequent fires return `is_new=false` and short-circuit with outcome=`dedupe`.

### Scenario 3: Subscription cancelled but plan still active

`atomic_downgrade_subscription` runs with a row-level lock on `student_subscriptions`. Stale cancels (different `sub_id`) are ignored with `outcome='stale_cancel_ignored'` (logged but no state change). Investigate:
```sql
SELECT *
FROM payment_webhook_events
WHERE event_type IN ('subscription.cancelled','subscription.expired','subscription.completed','subscription.halted')
  AND (outcome IS NULL OR outcome = 'failed')
ORDER BY received_at DESC LIMIT 20;
```

If the row shows outcome=`downgraded` but `students.subscription_plan` is still non-free, escalate — the RPC should have written both tables atomically. Check Postgres logs for transaction errors at the timestamp.

### Scenario 4: High webhook latency

`payment.webhook_processed` ops events carry `latency_ms` per terminal path. p99 dashboard query:
```sql
SELECT
  context->>'event_type'   AS event_type,
  context->>'outcome'      AS outcome,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY (context->>'latency_ms')::int) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY (context->>'latency_ms')::int) AS p95_ms,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY (context->>'latency_ms')::int) AS p99_ms,
  count(*)                                                                    AS n
FROM ops_events
WHERE message = 'payment.webhook_processed'
  AND created_at > now() - interval '1 hour'
GROUP BY 1, 2
ORDER BY p99_ms DESC;
```
Razorpay's webhook timeout is conservatively in the low single-digit seconds. If p99 > 5s, escalate.

Common causes:
- Cold-start on the Vercel function (first hit after idle)
- DB connection pool saturation (too many concurrent activations)
- `pg_advisory_xact_lock` contention (verify-route + webhook racing on the same student)

### Scenario 5: Stuck event (received but never processed)

If `payment_webhook_events` has rows with `processed_at IS NULL` older than 5 minutes, the route crashed mid-processing.
```sql
SELECT id, event_type, received_at, raw_payload->>'event' AS event
FROM payment_webhook_events
WHERE processed_at IS NULL
  AND received_at < now() - interval '5 minutes'
ORDER BY received_at;
```
For each stuck row, inspect `raw_payload` and decide:
- If safe to replay: call the appropriate RPC manually (see Scenario 1) and stamp `processed_at` when done.
- If unsafe (state conflict): document the case, mark with `outcome='failed'`, and escalate.

A self-service replay endpoint is tracked as a follow-on (Plan #4 Background Jobs in the orchestrator backlog).

## Manual replay procedure

```sql
-- 1. Find the row
SELECT id, raw_payload, event_type, outcome
FROM payment_webhook_events
WHERE razorpay_event_id = '<event_id>';

-- 2. Inspect raw_payload to extract args (notes, plan_code, payment_id, etc.)
-- 3. Call the appropriate RPC:
--    - payment.captured / subscription.activated / subscription.charged → activate_subscription_locked OR atomic_subscription_activation_locked
--    - subscription.cancelled / subscription.expired / subscription.completed / subscription.halted → atomic_downgrade_subscription
--    - subscription.pending → mark_subscription_past_due
--    - payment.failed → INSERT into payment_history with status='failed' (idempotent on razorpay_payment_id)
-- 4. Stamp the event:
UPDATE payment_webhook_events
SET processed_at = now(), outcome = '<activated|downgraded|ack|failed>'
WHERE id = '<row_id>';
```

## Kill switch: ff_atomic_subscription_activation

```sql
SELECT * FROM feature_flags WHERE flag_name = 'ff_atomic_subscription_activation';
```
- Default `is_enabled = true`: route attempts the atomic fallback when primary fails.
- Set `is_enabled = false` ONLY if `atomic_subscription_activation_locked` itself is misbehaving. The route then 503s on primary failure (Razorpay retries).
- Re-enable as soon as the atomic RPC is fixed.

## Severity tiers

- **P0 (page on-call)**: split-brain (both tables disagree); duplicate charges across distinct `razorpay_payment_id` values; webhook 100% failure rate >5 minutes
- **P1**: outcome=`failed` rate >5% over 15 minutes; p99 latency >5s; >10 stuck events with `processed_at IS NULL`
- **P2**: occasional outcome=`failed`; outcome=`unresolved` for events with missing notes (data hygiene)
- **P3**: stale_cancel_ignored telemetry pattern (informational)

## Related docs
- Plan: `docs/superpowers/plans/2026-04-25-payment-webhook-hardening.md`
- P11 invariant: `.claude/CLAUDE.md` § P11 Payment Integrity
- Migration files: `supabase/migrations/2026042515*` (Task 2/4/5a/6a additions)
