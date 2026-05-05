# Payment Dispute Response Runbook

**Severity:** SEV-2 (Major) for individual disputes; SEV-1 if dispute volume > 5/hour (indicates systemic failure).
**Time to respond:** 1 hour for individual dispute; 15 minutes for chargeback (48h response window legally enforced by Razorpay).
**On-call:** [ON-CALL: TBD] (backend + ops; founder approval required for refunds > ₹5,000).
**Scope:** Customer claims they were charged but plan access denied; refund requests; Razorpay disputes/chargebacks; webhook-driven `payment.dispute.created` events.
**Related runbooks:** `docs/runbooks/payment-webhook-recovery.md` (entitlement recovery), `docs/runbooks/rbi-pre-debit-compliance.md` (autopay compliance).

## 1. Detection

### Signals
- Customer support ticket mentioning: "charged but no plan", "refund", "didn't authorize", "want my money back".
- Razorpay dashboard webhook event: `payment.dispute.created` (chargeback initiated by cardholder's bank).
- Sentry: spike in `/api/payments/verify` or `/api/payments/webhook` 4xx/5xx — may indicate systemic charge-without-entitlement.
- Daily reconciliation report mismatch between Razorpay payment count and `payment_history` row count.

### Razorpay webhook events to monitor
| Event | Meaning | Action window |
|---|---|---|
| `payment.dispute.created` | Cardholder filed chargeback | 48 hours to respond |
| `payment.dispute.won` | Razorpay/bank ruled in our favor | None (informational) |
| `payment.dispute.lost` | Funds clawed back | Update `subscription_events`, possibly downgrade |
| `payment.dispute.closed` | Resolved (won or lost) | Confirm final state |
| `refund.created` | Refund initiated (by us or auto) | Verify entitlement removed if full refund |
| `refund.processed` | Refund settled to customer | None |

## 2. Triage

### Lookup the customer end-to-end

```sql
-- 1. Find the student
SELECT id AS student_id, auth_user_id, email, subscription_plan, created_at
  FROM students
 WHERE email = '<customer_email>'
    OR id = '<student_id>';

-- 2. Pull payment history
SELECT id, razorpay_payment_id, razorpay_order_id, razorpay_subscription_id,
       amount, currency, status, plan_code, billing_cycle, created_at
  FROM payment_history
 WHERE student_id = '<student_id>'
 ORDER BY created_at DESC;

-- 3. Pull subscription state
SELECT id, plan_code, status, billing_cycle,
       current_period_start, current_period_end,
       razorpay_subscription_id, created_at, updated_at
  FROM student_subscriptions
 WHERE student_id = '<student_id>'
 ORDER BY created_at DESC;

-- 4. Pull webhook events
SELECT id, razorpay_event_id, event_type, received_at, processed_at, outcome
  FROM payment_webhook_events
 WHERE raw_payload::text ILIKE '%<student_id>%'
    OR raw_payload->'payload'->'payment'->'entity'->>'email' = '<customer_email>'
 ORDER BY received_at DESC
 LIMIT 20;

-- 5. Pull subscription events (audit log)
SELECT id, event_type, from_plan, to_plan, reason, created_at
  FROM subscription_events
 WHERE student_id = '<student_id>'
 ORDER BY created_at DESC;
```

### Cross-check Razorpay dashboard
1. Razorpay dashboard → Payments → search by `razorpay_payment_id` from step 2 above.
2. Compare: payment status (`captured`, `failed`, `refunded`), amount, customer email, dispute status.
3. Note divergence — Razorpay is the source of truth for payment state; our DB is the source of truth for entitlement.

## 3. Mitigation

### Step 3a — Plan access denied despite payment captured

This is the most common case. Razorpay shows `captured`; our `students.subscription_plan` shows `free`.

Manually run the activation RPC:
```sql
-- Verify the payment row exists and is paid
SELECT * FROM payment_history WHERE razorpay_payment_id = '<rzp_payment_id>';

-- Run activation
SELECT activate_subscription_locked(
  p_auth_user_id := '<auth_user_id>',
  p_plan_code := 'pro_monthly',  -- or 'pro_yearly' etc. — match the customer's purchase
  p_billing_cycle := 'monthly',
  p_razorpay_payment_id := '<rzp_payment_id>',
  p_razorpay_order_id := '<rzp_order_id>',
  p_razorpay_subscription_id := '<rzp_sub_id_or_null>'
);

-- Verify entitlement granted
SELECT s.subscription_plan, ss.status, ss.plan_code, ss.current_period_end
  FROM students s
  LEFT JOIN student_subscriptions ss ON ss.student_id = s.id
 WHERE s.id = '<student_id>';
-- Expect: subscription_plan = '<plan>', status = 'active', current_period_end > now().

-- Mark webhook event as activated (if a webhook row exists with outcome != 'activated')
UPDATE payment_webhook_events
   SET processed_at = now(), outcome = 'activated'
 WHERE razorpay_event_id = '<rzp_event_id>'
   AND outcome != 'activated';
```

### Step 3b — Refund (full or pro-rata)

**Decide refund type:**
- **Full refund:** Customer used the service < 7 days OR account never accessed paid features. No questions asked under our consumer protection policy.
- **Pro-rata refund:** Customer used the service > 7 days. Refund = `(remaining_days / billing_period_days) * amount`.
- **No refund:** Customer used > 50% of period AND no service issue. Document reason in support ticket.

**Refund > ₹5,000 requires founder approval before issuing.**

**Step-by-step Razorpay refund:**
1. Razorpay dashboard → Payments → find payment by `razorpay_payment_id`.
2. Click "Refund" → enter amount (full or pro-rata in paise — multiply rupees by 100).
3. Add notes: `Refund for ticket #<ticket_id>; reason: <short_reason>; ops_user: <name>`.
4. Confirm → Razorpay processes (typically 5-7 business days to customer's account).

**Record in `subscription_events`:**
```sql
INSERT INTO subscription_events (
  student_id, event_type, from_plan, to_plan, reason, metadata, created_at
) VALUES (
  '<student_id>',
  'refund_issued',
  '<current_plan>',
  CASE WHEN <is_full_refund> THEN 'free' ELSE '<current_plan>' END,
  'Customer refund — ticket #<ticket_id>',
  jsonb_build_object(
    'razorpay_refund_id', '<rzp_refund_id>',
    'amount_inr', <amount_in_rupees>,
    'refund_type', '<full|pro_rata>',
    'ops_user', '<name>'
  ),
  now()
);
```

**For full refund — downgrade entitlement immediately:**
```sql
UPDATE students SET subscription_plan = 'free' WHERE id = '<student_id>';
UPDATE student_subscriptions
   SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'refunded'
 WHERE student_id = '<student_id>' AND status = 'active';
```

For pro-rata, leave entitlement until `current_period_end`.

### Step 3c — Chargeback response (48h hard deadline)

**Within 4 hours of `payment.dispute.created`:**
1. Pull customer evidence in super-admin:
   - Signup IP + timestamp from `auth.users` metadata
   - Plan-page hits via PostHog: filter `event:$pageview AND $current_url:*/billing*` for the user
   - Razorpay payment proof (`payment_id`, captured timestamp, payment method)
   - Service usage proof: quiz_sessions count, login count, last_active timestamp
2. Compose response in Razorpay dashboard → Disputes → Submit evidence.
3. Required documents:
   - Customer signup confirmation (timestamped email logs)
   - Plan selection screenshot (PostHog session replay if available)
   - Service usage logs (login + quiz history)
   - Terms of service acceptance record
4. Submit before 48-hour deadline. **Missing the deadline = automatic loss + chargeback fee (~₹500 + lost amount).**

**Evidence query bundle:**
```sql
-- Service usage proof for the disputed period
SELECT 'quiz_sessions' AS source, count(*), min(started_at), max(started_at)
  FROM quiz_sessions
 WHERE student_id = '<student_id>'
   AND started_at BETWEEN '<payment_date>' AND now()
UNION ALL
SELECT 'chat_sessions', count(*), min(created_at), max(created_at)
  FROM chat_sessions
 WHERE student_id = '<student_id>'
   AND created_at BETWEEN '<payment_date>' AND now()
UNION ALL
SELECT 'logins', count(*), min(created_at), max(created_at)
  FROM auth.audit_log_entries
 WHERE payload->>'actor_id' = '<auth_user_id>'
   AND created_at BETWEEN '<payment_date>' AND now();
```

### Step 3d — Customer comms

**English (refund acknowledged):**
> Hi — thanks for reaching out. We've issued a [full / pro-rata] refund of ₹[amount] to the original payment method. You'll see it in your account within 5-7 business days. Your Alfanumrik plan has been [cancelled immediately / will remain active until <date>]. If you have any concerns, reply to this email.

**Hindi (हिंदी, रिफंड स्वीकृत):**
> नमस्ते — संपर्क करने के लिए धन्यवाद। हमने ₹[राशि] का [पूर्ण / आनुपातिक] रिफंड आपके मूल भुगतान विधि पर जारी कर दिया है। आपको यह 5-7 कार्य दिवसों में अपने खाते में दिखाई देगा। आपका Alfanumrik प्लान [तुरंत रद्द कर दिया गया है / <तारीख> तक सक्रिय रहेगा]। यदि आपकी कोई चिंता है, तो इस ईमेल का जवाब दें।

**English (entitlement restored after access denial):**
> Hi — we found and fixed the issue. Your [Plan name] subscription is now active and you have full access. We sincerely apologise for the inconvenience. As a goodwill gesture we've added [X] bonus days. If anything still doesn't work, reply to this email.

**Hindi (हिंदी, सब्सक्रिप्शन बहाल):**
> नमस्ते — हमने समस्या ढूंढ ली है और उसे ठीक कर दिया है। आपकी [प्लान नाम] सदस्यता अब सक्रिय है और आपके पास पूर्ण पहुँच है। असुविधा के लिए हम ईमानदारी से क्षमा चाहते हैं। सद्भावना के तौर पर हमने [X] बोनस दिन जोड़ दिए हैं। यदि कुछ अभी भी काम नहीं कर रहा है, तो इस ईमेल का जवाब दें।

## 4. Recovery / Verification

After any payment dispute resolution, the customer must be able to:
1. Log in.
2. Visit `/billing` and see the correct plan + period end (or "Free" if refunded).
3. Access (or correctly be denied) plan-gated features.

Verify via super-admin user impersonation (read-only mode in `/super-admin/users` → "View as user") — never log in AS the customer.

```sql
-- Final verification
SELECT
  s.email,
  s.subscription_plan,
  ss.status AS sub_status,
  ss.plan_code,
  ss.current_period_end,
  (SELECT count(*) FROM payment_history WHERE student_id = s.id) AS payment_count,
  (SELECT count(*) FROM subscription_events WHERE student_id = s.id) AS event_count
FROM students s
LEFT JOIN student_subscriptions ss ON ss.student_id = s.id
WHERE s.id = '<student_id>';
```

## 5. Compliance & record-keeping

### Statutory retention
- Payment records (per IT Act 2000 + Companies Act 2013): **8 years minimum.**
- GST invoices (per CGST Act): **6 years from end of relevant FY.**
- KYC / customer identification: **5 years post account closure (PMLA).**

These are enforced by NOT hard-deleting from `payment_history`, `student_subscriptions`, `subscription_events`. Use `cancelled` status instead. Coordinate with architect before any DROP/DELETE migration touching these tables.

### GST / refund invoice updates
- Refund > ₹0 requires a credit note generated in our invoicing system.
- For refunds spanning a GST period boundary, file in the period the refund was issued (not the original payment period).
- Retain credit-note PDF in `support_documents` table linked to the support ticket ID.

### Audit log
Every manual SQL action in this runbook MUST be logged to `admin_audit_log`:
```sql
INSERT INTO admin_audit_log (
  admin_user_id, action, target_type, target_id, metadata, created_at
) VALUES (
  '<your_admin_user_id>',
  'payment_dispute_resolution',
  'student',
  '<student_id>',
  jsonb_build_object(
    'ticket_id', '<ticket_id>',
    'razorpay_payment_id', '<rzp_payment_id>',
    'action_taken', '<refund|reactivate|chargeback_response>',
    'amount_inr', <amount_or_null>
  ),
  now()
);
```

## 6. Post-mortem checklist (run for any chargeback or dispute > ₹5,000)

1. Was this a one-off (customer error / bank fraud claim) or systemic (our charge-without-entitlement bug)?
2. If systemic — file a SEV-1 to backend + architect. Run reconciliation per `payment-webhook-recovery.md`.
3. Was the 48h response window met? If not, why? Improve alerting.
4. Did `subscription_events` have a complete audit trail? If not, add the missing event types.
5. Did customer comms go out within 1 hour of detection? If not, automate the first-response template.
