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
- [ ] Runbook `docs/runbooks/payment-webhook-recovery.md` linked from on-call wiki
- [ ] At least one synthetic webhook fire executed in staging within 24h before each prod deploy
- [ ] No `payment_webhook_events` rows with `processed_at IS NULL` older than 5 minutes (sanity sweep on dashboard)

#### Webhook alerting via in-house ops pipeline (NOT Sentry)
Webhook timing telemetry is emitted by `src/app/api/payments/webhook/route.ts` as `logOpsEvent({ message: 'payment.webhook_processed', category: 'payment', context: { latency_ms, outcome, event_type, ... } })` (severity `error` on failed/unresolved, else `info`). It lands ONLY in the `ops_events` table — it is never sent to Sentry. Alerting flows: `ops_events` → `evaluate_alert_rules()` (+ `ops_events_critical_alert_trigger` AFTER INSERT for real-time critical) → `alert_dispatches` (when a rule's `count_threshold` is met over `window_minutes` and `severity_rank(event) >= severity_rank(rule.min_severity)`) → `alert-deliverer` Edge Function delivers pending dispatches to a `notification_channels` row (Slack webhook or email). Schema: `_legacy/timestamped/20260413120000_observability_console_1b.sql`.

- [ ] Confirm the seeded `alert_rules` exist: 'Payment webhook integrity' (category=payment, min_severity=critical, threshold 1 / 1min — fires on invalid signature), 'AI error spike' (category=ai, error, threshold 5 / 10min), 'Health degraded' (category=health, warning, threshold 1 / 5min)
- [ ] Confirm webhook latency/outcome telemetry is visible in super-admin observability (sourced from `ops_events.context.latency_ms`)

#### Enable ops alerting (required — alerts are silent until done)
> Seeded rules ship `enabled=false` with empty `channel_ids='{}'`, so NOTHING alerts out of the box.
- [ ] Create a `notification_channels` row (Slack webhook URL or email) and confirm `enabled=true`
- [ ] Attach that channel id to each desired rule's `channel_ids` array
- [ ] Set `enabled=true` on the rules you want live (at minimum 'Payment webhook integrity' + 'Health degraded')
- [ ] Schedule/confirm the `alert-deliverer` Edge Function is invoked on a cron (it drains `alert_dispatches` rows with `status='pending'`)
- [ ] Fire a synthetic `ops_event` at the chosen severity in staging and confirm Slack/email delivery end-to-end

#### Known gaps — DECISION PENDING (do NOT silently ship; needs CEO sign-off)
- [ ] **(c) Coverage gap — processing-failure rate is currently unalerted.** The seeded 'Payment webhook integrity' rule is `min_severity='critical'`, but webhook *failed/unresolved* outcomes emit at `severity='error'` (`error`=3 < `critical`=4). So only signature-invalid (critical) events trip a rule; a *processing-failure rate* alert is covered by NO rule. Closing this needs either (i) a new error-severity payment `alert_rule` via a seed migration, or (ii) re-classifying the emit severity. DECISION PENDING (backend + architect + testing chain). [noted 2026-06-12]
- [ ] **(d) Capability gap — p99 latency alerting is not expressible as a rule.** The rule model is count-over-window on `severity`, so "p99 latency > 5s" cannot be encoded as an `alert_rule`. Latency is available as a DASHBOARD metric only (super-admin observability computes p50/p95/p99 from `ops_events.context.latency_ms`). Latency alerting stays dashboard-only for launch unless numeric-threshold alerting is added post-launch. DECISION PENDING. [noted 2026-06-12]
