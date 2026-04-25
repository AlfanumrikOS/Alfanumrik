# Alfanumrik Launch Checklist

## Environment Variables (Vercel)
- [ ] NEXT_PUBLIC_SUPABASE_URL — Supabase project URL
- [ ] NEXT_PUBLIC_SUPABASE_ANON_KEY — Supabase anon key
- [ ] SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (server-only)
- [ ] RAZORPAY_KEY_ID — Razorpay live key ID
- [ ] RAZORPAY_KEY_SECRET — Razorpay live secret
- [ ] RAZORPAY_WEBHOOK_SECRET — Razorpay webhook secret
- [ ] UPSTASH_REDIS_REST_URL — Redis for rate limiting
- [ ] UPSTASH_REDIS_REST_TOKEN — Redis token
- [ ] SUPER_ADMIN_SECRET — DEPRECATED (admin auth migrated to session-based)

## Razorpay Dashboard
- [ ] Webhook URL set to https://alfanumrik.com/api/payments/webhook
- [ ] Events: payment.captured, payment.failed enabled
- [ ] Live mode activated (KYC complete)

## Supabase
- [ ] RLS enabled on all tables
- [ ] activate_subscription RPC exists
- [ ] check_expired_subscriptions RPC exists
- [ ] reconcile_stuck_payments RPC exists
- [ ] increment_daily_usage RPC exists
- [ ] Edge function foxy-tutor deployed (v16+)

## Smoke Tests
- [ ] Landing page loads (/welcome)
- [ ] Login/signup works
- [ ] Student dashboard loads with welcome banner (new user)
- [ ] Foxy chat sends and receives messages
- [ ] Quiz starts and completes
- [ ] Free user hits 5 chat limit → UpgradeModal appears
- [ ] Payment checkout opens (Razorpay modal)
- [ ] Payment succeeds → subscription activates
- [ ] Webhook fires and activates subscription independently
- [ ] Profile shows correct plan
- [ ] Refresh shows correct plan
- [ ] Parent portal login works with link code
- [ ] Teacher dashboard loads
- [ ] Teacher can create class
- [ ] Admin panel accessible with secret
- [ ] Health endpoint returns ok (/api/v1/health)

## Rollback
- [ ] Vercel: Deployments → Previous → Promote
- [ ] Supabase: SQL migrations are additive (no destructive changes)
- [ ] Edge functions: redeploy previous version

### Payment Webhook Health (post-hardening)
- [ ] `payment_webhook_events` table exists; unique constraint on `(razorpay_account_id, razorpay_event_id)` is in place (migration `20260425150000`)
- [ ] `activate_subscription_locked` and `atomic_subscription_activation_locked` RPCs deployed (migration `20260425150300`)
- [ ] `atomic_downgrade_subscription` RPC deployed (migration `20260425150200`)
- [ ] `activate_subscription` RPC has `SET search_path = public` (migration `20260425150100`)
- [ ] `ff_atomic_subscription_activation` feature flag exists with `is_enabled = true`
- [ ] Sentry alert configured: `payment.webhook_processed` outcome=`failed` rate >5% over 15 minutes → P1 page
- [ ] Sentry alert configured: webhook p99 latency from `payment.webhook_processed.context.latency_ms` > 5s over 15 minutes → P1 page
- [ ] Runbook `docs/runbooks/payment-webhook-recovery.md` linked from on-call wiki
- [ ] At least one synthetic webhook fire executed in staging within 24h before each prod deploy
- [ ] No `payment_webhook_events` rows with `processed_at IS NULL` older than 5 minutes (sanity sweep on dashboard)
