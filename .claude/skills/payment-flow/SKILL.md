---
name: payment-flow
description: Razorpay subscription lifecycle, webhook processing rules, and payment integrity checklist.
user-invocable: false
---

# Skill: Payment Flow

Rules for the Razorpay payment integration. Reference when touching subscription creation, payment verification, webhook handling, or billing UI.

**Owning agent**: backend. Architect reviews security.

## Subscription Plans
| Plan | Code | Monthly (INR) | Yearly (INR) | Features |
|---|---|---|---|---|
| Explorer | `free` | 0 | 0 | 5 chats/day, basic quizzes |
| Starter | `starter` | 299 | 2,990 | 30 chats/day, all subjects |
| Pro | `pro` | 699 | 6,990 | Unlimited chats, mock tests, analytics |
| Unlimited | `unlimited` | 1,499 | 14,990 | Everything + priority support |

Plans defined in: `src/lib/plans.ts` and `subscription_plans` DB table.

## Payment Lifecycle
```
1. Student selects plan → frontend calls /api/payments/subscribe
2. Backend creates Razorpay subscription (monthly) or order (yearly)
3. Frontend opens Razorpay checkout modal
4. Student pays → Razorpay sends webhook
5. /api/payments/webhook verifies signature, updates student_subscriptions
6. /api/payments/verify called by frontend as backup confirmation
7. student_subscriptions.status updated atomically
```

## Subscription States
```
pending → active → (charged → active)* → cancelled | halted | expired
```
| State | Meaning | Access |
|---|---|---|
| `pending` | Awaiting first payment | Free tier only |
| `active` | Paid and current | Full plan access |
| `past_due` | Payment failed, grace period | Full access (grace) |
| `halted` | Payment repeatedly failed | Downgrade to free |
| `cancelled` | User cancelled, runs until period end | Full access until `current_period_end` |
| `expired` | Period ended after cancellation | Free tier only |

## Webhook Events to Handle
| Event | Action |
|---|---|
| `subscription.activated` | Set status = active, record payment |
| `subscription.charged` | Update current_period_end, record payment |
| `payment.captured` | Record payment for yearly one-time orders |
| `subscription.halted` | Set status = halted, downgrade access |
| `subscription.cancelled` | Set status = cancelled (access until period end) |
| `payment.failed` | Set status = past_due, notify student |

## Webhook Processing Rules (product invariant P11)
1. **Verify signature FIRST**: `crypto.createHmac('sha256', secret).update(body).digest('hex')` must match `x-razorpay-signature` header
2. **Reject if invalid**: Return 401 immediately, log attempt
3. **Idempotent**: Check if this event ID was already processed before writing
4. **Atomic**: Update subscription status + payment record in single transaction
5. **Return 200**: Razorpay retries on non-200 (up to 24 hours)
6. **Log everything**: Payment events to audit trail for reconciliation

## Checklist: Payment Change Review
- [ ] Webhook signature verified before any processing
- [ ] Subscription status change is atomic with payment record
- [ ] No plan access granted without verified payment
- [ ] Grace period handled for past_due (don't instantly cut off)
- [ ] Cancellation: access continues until current_period_end
- [ ] Yearly payments use one-time order (not subscription)
- [ ] Monthly payments use recurring subscription
- [ ] Plan codes match between `src/lib/plans.ts` and `subscription_plans` table
- [ ] Razorpay test vs live key checked (test for staging, live for production)

## Key Files
| File | Purpose |
|---|---|
| `src/lib/razorpay.ts` | Razorpay API client (plans, subscriptions, orders) |
| `src/lib/plans.ts` | Plan definitions and feature limits |
| `src/app/api/payments/subscribe/route.ts` | Create subscription/order |
| `src/app/api/payments/verify/route.ts` | Frontend payment confirmation |
| `src/app/api/payments/webhook/route.ts` | Razorpay webhook handler |
| `src/app/api/payments/status/route.ts` | Current subscription status |
| `src/app/api/payments/cancel/route.ts` | Cancel auto-renew |
| `src/app/billing/page.tsx` | Billing dashboard UI |
| `src/app/pricing/page.tsx` | Pricing page |
| `src/components/SubscriptionConfirm.tsx` | Payment confirmation modal |
| `src/components/UpgradeModal.tsx` | Upsell modal |
