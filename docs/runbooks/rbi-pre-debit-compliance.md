# RBI E-Mandate Pre-Debit Notification — Runbook

**Status:** Live (Wave 2 D7.3, 2026-05-05)
**Owner:** backend (cron + Edge Function), ops (monitoring + Razorpay coordination)

## What this is

Every recurring auto-debit on a card / UPI / net-banking mandate in India MUST be
preceded by a pre-debit notification sent to the customer at least 24 hours
before the charge. Without it the auto-charge is non-compliant under RBI rules,
and Razorpay (the payment processor) can be penalised — and can in turn pause
or reject our merchant account.

### Regulatory references

- RBI/2020-21/74 DPSS.CO.PD No. 754/02.14.003/2020-21 (4-Dec-2020) — original
  e-mandate framework introducing AFA + pre-debit notification.
- RBI/2021-22/82 (25-Aug-2021) — extended deadline + clarification.
- 30-Sep-2022 — final hard-deadline circular; non-compliant transactions fail.

The notice must contain: amount, charge date + window, plan name, merchant
name, cancellation instructions, and support contact.

## Implementation

| Layer | File | What it does |
|---|---|---|
| Vercel cron entry | `src/app/api/cron/pre-debit-notice/route.ts` | Every 6 hours scans `student_subscriptions` for charges in the [+24h, +48h] window and POSTs each to the Edge Function |
| Edge Function | `supabase/functions/send-pre-debit-notice/index.ts` | Sends regulated email via Mailgun with 3-retry exponential backoff, optionally queues WhatsApp, writes audit row |
| Audit table | `subscription_events` | Each notice writes one row with `event_type` = `pre_debit_notice_sent` or `pre_debit_notice_failed` |
| Idempotency | DB partial unique index | `idx_sub_events_pre_debit_idempotency` on `metadata->>'idempotency_key'` — guarantees one notice per `(subscription_id, charge_date)` across worker races |
| Schedule | `vercel.json` | `/api/cron/pre-debit-notice` at `0 */6 * * *` |

Migration: `supabase/migrations/20260505130000_pre_debit_notice_events.sql`

### Why a 6-hour cron, not daily

RBI minimum is 24h. With a 6h cron we always have 24h+ warning even if one
tick fails — the next tick still lands in the [+24h, +48h] window. With a
daily cron, a single missed tick = silent compliance miss = Razorpay penalty.

## Expected steady-state behaviour

```
4 cron ticks/day × ~N subs due in next 24h
  → ~N HTTP calls to send-pre-debit-notice on the FIRST tick
  → 0 HTTP calls on the next 3 ticks (idempotency_key dedup at DB level)
```

`subscription_events` row count grows by exactly one `pre_debit_notice_sent`
row per (subscription, charge_date) pair.

## What to do if Razorpay reports a missing pre-debit notice

1. **Get the dispute details from Razorpay**: subscription_id, charge attempt
   timestamp, customer email.
2. **Look up audit history**:
   ```sql
   SELECT created_at, event_type, metadata
   FROM subscription_events
   WHERE subscription_id = '<the-uuid>'
     AND event_type IN ('pre_debit_notice_sent', 'pre_debit_notice_failed')
   ORDER BY created_at DESC LIMIT 10;
   ```
3. **If `pre_debit_notice_sent` row exists** with `metadata->>'charge_date_iso'`
   matching the disputed charge: notice WAS sent. Pull Mailgun event log via
   `metadata->>'channels'` and Mailgun dashboard search for the
   `idempotency_key` tag. Reply to Razorpay with timestamp + Mailgun message-id.
4. **If `pre_debit_notice_failed` row exists** for that charge_date: notice
   delivery failed. Check `metadata->>'error'` for root cause (Mailgun bounce,
   invalid email, SMTP outage). The customer's auto-charge should have been
   skipped — coordinate with Razorpay to refund/reverse if it went through anyway.
5. **If NO row exists for that charge_date**: cron miss. Check Vercel cron logs
   for `/api/cron/pre-debit-notice` around 24-48h before the disputed charge.
   Likely root cause: cron suspended (paid-tier issue), wrong CRON_SECRET, or
   subscription was added to `student_subscriptions` AFTER all 4 ticks for
   that charge had already run.

## Charge-skip on notice failure (open compliance gap)

**Current state:** When the email send fails 3 times, we write a
`pre_debit_notice_failed` audit row and surface a 5xx so Sentry alerts ops.
We do NOT yet automatically pause the Razorpay subscription via API.

**Required follow-up (D7.3.f):** Add a daily reconciliation job that:
1. Selects `pre_debit_notice_failed` rows from the last 48h.
2. For each: calls Razorpay's `subscriptions/{id}/pause` API to halt the next
   auto-charge attempt.
3. Notifies the user out-of-band (WhatsApp / SMS via support team) that their
   subscription is paused pending payment-method update.
4. Logs to `ops_events` for super-admin visibility.

This requires:
- Razorpay API key with `subscription:write` scope (we already have this).
- A new cron job at `/api/cron/pause-on-notice-failure` (separate from this
  one to keep failure domains isolated).
- An ops-approved decision on whether to also email the user via a fallback
  channel (e.g. SES) when Mailgun is the failing channel.

Until D7.3.f ships, ops MUST manually scan
`subscription_events WHERE event_type='pre_debit_notice_failed'` daily and
manually pause affected subscriptions in the Razorpay dashboard.

## Customer support FAQ snippet

> **Q: I got an email about an "upcoming auto-debit" for Alfanumrik. What is this?**
>
> A: This is a mandatory advance notice required by Reserve Bank of India
> rules. We must inform you at least 24 hours before any auto-debit is
> attempted on your saved payment method. The email shows the exact amount,
> date, and how to cancel if you don't want to renew. No charge has happened
> yet — this is just the heads-up. The actual charge will fire on the date
> shown in the email. If you want to cancel auto-renew, go to Settings →
> Subscription before the charge date.

## Hindi template (open follow-up D7.3.h)

The current email template is English-only. The bilingual subject line
satisfies P7 entry-point parity, but the body should be fully translated
before we promote auto-renew as a default. Tracked under D7.3.h. Do NOT
modify the English template independently — Hindi must land alongside any
English copy change to keep the two in sync.

## Monitoring

- **Sentry alert:** any 500 from `/api/cron/pre-debit-notice` or any 5xx
  from `send-pre-debit-notice` should page ops within 15 minutes.
- **Daily check:** count `pre_debit_notice_sent` rows from yesterday vs
  count of subscriptions where `next_billing_at` fell in yesterday's
  [+24h, +48h] window — these should match exactly.
- **Mailgun dashboard:** filter by tag `pre_debit_notice` to see delivery
  health (bounce rate target: <2%).
