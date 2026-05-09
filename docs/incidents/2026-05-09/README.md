# 2026-05-09 Razorpay Webhook Silent Failure — Incident Report

## Summary
- **Detection date:** 2026-05-09 (user-reported, ~12:30 UTC)
- **Detection trigger:** Hridaan Kaushik paid ₹699 for the Pro plan; account was not upgraded; billing UI showed three contradictory states simultaneously ("Cancelled" badge, "Auto-renew" billing, "Access Until 2 May 2026" — a date already in the past, "Cancellation Scheduled" banner).
- **Earliest known regression date:** 2026-04-25 (when `payment_webhook_events` table was created — last successful webhook activation was 2026-04-02).
- **Customer impact:** at least 1 confirmed (₹699 captured but plan not upgraded). Possibly more — every payment between 2026-04-25 and 2026-05-09 went through verify-only (the fast path) and silently lost the webhook safety net.
- **Resolution date:** 2026-05-09 (commit `d5880ae1`, merged via PR #665).

## Root cause (three-fault pile-up)

1. **Middleware rate limiter returned 429 to Razorpay's webhook IPs.**
   - `src/proxy.ts` applied a general 200 req/min per-IP limit to every endpoint except `/api/v1/health`.
   - Razorpay delivers webhooks from a small pool of static egress IPs that are shared across many merchants. The 200/min budget on a single IP is exceeded routinely.
   - Razorpay treats **4xx as terminal** (it retries 5xx with exponential backoff, but 4xx is marked failed and not retried). One 429 = one webhook event silently dropped forever.
   - `payment_webhook_events` table was empty since the day it was created.

2. **`/api/payments/verify` returned 401 on Hridaan's checkout return.**
   - `src/hooks/useCheckout.ts` captured the Supabase `access_token` ONCE before opening the Razorpay popup, then reused it from the `handler` callback to POST `/api/payments/verify`.
   - The Razorpay popup stayed open ~85 seconds while he entered UPI/OTP. Supabase rotated the JWT in the background. The captured token was now invalid → 401.
   - Confirmed in Vercel runtime logs: `12:24:44 POST /api/payments/subscribe → 200` (token X) → `12:26:09 POST /api/payments/verify → 401` (same token X).
   - Without the webhook safety net (failure #1) this 401 was the final say. Plan never activated.

3. **`create_pending_subscription` RPC leaked stale lifecycle fields.**
   - `ON CONFLICT (student_id) DO UPDATE` overwrote `plan_code`, `status='pending'`, `auto_renew=true`, `razorpay_subscription_id`, `razorpay_plan_id`, `updated_at`.
   - It DID NOT clear `cancelled_at`, `current_period_start/end`, `next_billing_at`, `amount_paid`, `renewal_attempts`, `ended_at`, `razorpay_payment_id`.
   - Hridaan's pending Pro row inherited `cancelled_at = 2026-04-07` and `current_period_end = 2026-05-02` from his April starter sub that was cancelled on 2026-04-07. Hence the contradictory UI.

## Fix shipped (commit d5880ae1, PR #665)

| File | Change |
|---|---|
| `src/proxy.ts` | Exempt `/api/payments/webhook` from the general rate limiter, alongside `/api/v1/health`. The Razorpay HMAC signature check inside the route handler remains the actual auth boundary. |
| `src/hooks/useCheckout.ts` | Re-grab `supabase.auth.getSession()` immediately before `/api/payments/verify`. Add `credentials: 'include'` for cookie auth fallback. Both subscription and order checkout paths fixed. |
| `src/app/api/payments/status/route.ts` | Tighten `is_cancel_scheduled` to require `status='active'`. Suppress `current_period_*`, `next_billing_at`, and `cancelled_at` while `status='pending'`. |
| `src/app/billing/page.tsx` | Distinct "Activating" badge for pending. "Auto-renew" label gated by `auto_renew && !cancel_scheduled`. Period dates hidden during pending. "Cancel Auto-Renew" button only when active+auto_renew. |
| `supabase/migrations/20260509130000_create_pending_subscription_clear_stale_lifecycle.sql` | RPC now clears `cancelled_at`, period dates, `amount_paid`, etc. on the conflict branch. (Applied to prod via Supabase MCP before commit landed.) |
| `src/__tests__/payment-webhook-rate-limit-exempt.test.ts` | REG-65: structural test on `proxy.ts` — webhook exempt block must exist BEFORE the general rate limiter. |
| `src/__tests__/checkout-token-refresh.test.ts` | REG-66: structural test on `useCheckout.ts` — every verify call site must re-grab the session and use `credentials: 'include'`. |

## Manual reconciliation done

- Hridaan's `student_subscriptions` row updated to `plan='pro'`, `status='active'`, `current_period_end='2026-06-09'`, `razorpay_subscription_id='sub_SnGT4NJXVeJDdV'`, `razorpay_payment_id='pay_SnGTLSWsYYklid'`, `amount_paid=699`. Audit row written to `subscription_events`.
- Orphan `payment_history` row for `sub_SnGUcGY4LsK543` (the duplicate subscribe attempt) marked `status='failed'` with reconciliation note.
- **Outstanding action:** the orphan Razorpay subscription `sub_SnGUcGY4LsK543` itself is still alive at Razorpay and may auto-charge. Cancel it from the Razorpay dashboard.

## Permanent safeguards (this directory)

The follow-up patch that codifies the lessons in `.claude/CLAUDE.md`, `.claude/regression-catalog.md`, `.claude/hooks/post-edit-check.sh`, `.github/workflows/deploy-production.yml`, and `vercel.json` is saved as **`safeguards-patch.diff`** in this directory. It was generated against `main@d5880ae1` but could not be committed from the same Claude session because those paths are owned by specialist agents (architect / ops). Apply it manually:

```bash
cd /path/to/Alfanumrik
git checkout -b ops/payments-safeguards-2026-05-09
git apply docs/incidents/2026-05-09/safeguards-patch.diff
git add -A
git commit -m "ops(payments): permanent safeguards from 2026-05-09 incident — P16/P17 + monitor cron + CI gate"
git push -u origin ops/payments-safeguards-2026-05-09
gh pr create --base main --fill
```

What the patch contains:

1. **`.claude/CLAUDE.md`** — adds **P16 (Razorpay Webhook Reliability)** and **P17 (Pending-Subscription Lifecycle Hygiene)** as non-negotiable invariants. Bumps catalog total from 35 → 37.

2. **`.claude/regression-catalog.md`** — adds **REG-65** (webhook rate-limit exempt) and **REG-66** (useCheckout token refresh) as catalogued regressions tied to P16.

3. **`.claude/hooks/post-edit-check.sh`** — adds two static guards:
   - Warns if any edit to `src/proxy.ts` or `src/middleware.ts` removes the `/api/payments/webhook` reference.
   - Warns if any redefinition of `create_pending_subscription` drops `cancelled_at = NULL` from the conflict branch.

4. **`.github/workflows/deploy-production.yml`** — adds a P16 reachability gate to the post-deploy verification step. It POSTs a deliberately bad signature to `/api/payments/webhook` and fails the deploy if the response is anything other than HTTP 400 (handler reached, signature rejected). Any 401/403/404/429/5xx fails the gate, blocking the release.

5. **`vercel.json`** — registers `/api/cron/payments-health` to run every 10 minutes (the route itself is committed in this branch).

The cron route at `src/app/api/cron/payments-health/route.ts` IS committed in this same branch — that file lives outside the restricted paths.

## Acceptance criteria for "never compromised again"

After the safeguards patch is applied and a deploy succeeds, the following should all be true:

- [ ] CI's post-deploy verify step probes `/api/payments/webhook` and confirms HTTP 400 (handler reached).
- [ ] `/api/cron/payments-health` writes a `severity='critical'` ops_event within 10 minutes of any future webhook silence regression.
- [ ] `payment_webhook_events` receives a row within seconds of the next real Razorpay event.
- [ ] Reading `payment_webhook_events` per day shows non-zero traffic on every day with payment activity.
