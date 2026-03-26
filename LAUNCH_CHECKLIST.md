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
- [ ] SUPER_ADMIN_SECRET — Admin panel access

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
