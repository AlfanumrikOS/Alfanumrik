# Service-level objectives

**As of:** 2026-05-16.
**Authority:** derives from [`ADR-005-concept-first-adaptive-learning-spine.md`](./ADR-005-concept-first-adaptive-learning-spine.md) §"Success metrics" and Phase-1 audit finding H4 ("no documented per-route latency SLO + alerts"). Resolves the gap by codifying targets + alert thresholds + escalation.

This is the **spec to alert against**. Every threshold below has a paired SLI source — no aspirational targets without a way to measure.

## Conventions

- **SLI** = the measurement (e.g., "p95 latency on `/api/tutor/next` over a 5-min window").
- **SLO target** = the value the SLI must beat in 99.9 % of evaluation windows over the calendar month.
- **Alert threshold** = the value at which the on-call is paged. Strictly worse than the SLO target so alerts fire before the SLO is burned.
- **Owner** = the module owner per [`DOMAIN_BOUNDARIES.md`](./DOMAIN_BOUNDARIES.md) responsible for restoring service.
- **Runbook** = link to the runbook covering this failure class.

## Availability

Application availability is measured by the synthetic ping on `/api/v1/health` from Vercel Speed Insights + Vercel Analytics uptime monitor.

| Surface | Availability target | Alert threshold | Owner |
|---|---|---|---|
| `/api/v1/health` | 99.9 % monthly | 2 consecutive failures (1 min) | ops |
| Marketing pages (ISR) | 99.95 % monthly | 5 consecutive 5xx | ops |
| Student dashboard (`/dashboard`) | 99.9 % monthly | 5 consecutive 5xx | B12 + ops |
| Razorpay webhook (`/api/webhooks/razorpay`) | 99.95 % monthly | 1 failure on POST | B10 + ops |

Maintenance windows are excluded from the calculation; communicated via `maintenance_banner` (per [`DATA_OWNERSHIP_MATRIX.md`](./DATA_OWNERSHIP_MATRIX.md) B13).

## Latency

p95 over a 5-minute rolling window unless otherwise stated. Measured at the BFF (Vercel serverless function) for routes; at the Edge Function for Deno functions; at the substrate for projectors.

| Route class | p95 target | Alert at | SLI source | Owner | Runbook |
|---|---|---|---|---|---|
| `/api/tutor/next` | 300 ms | 600 ms | Sentry Performance | B9 assessment | *(to add Iter. 2)* `docs/runbooks/tutor-latency-spike.md` |
| `/api/tutor/answer` | 500 ms | 1000 ms | Sentry Performance | B9 assessment | *(to add Iter. 2)* `docs/runbooks/tutor-latency-spike.md` |
| `/api/foxy` first-token | 2.5 s | 5 s | custom timing in `src/app/api/foxy/route.ts` → Sentry | B7 Foxy | [`ai-outage-response.md`](../runbooks/ai-outage-response.md) |
| `/api/foxy` full response | 8 s | 15 s | same | B7 Foxy | same |
| Dashboard SSR (`/dashboard`) | 800 ms | 1500 ms | Vercel Speed Insights | B12 ops | *(to add Iter. 2)* `docs/runbooks/ssr-latency-degraded.md` |
| Quiz submit (`/api/v1/quiz/submit`) | 500 ms | 1000 ms | Sentry Performance | B5 quiz | *(uses atomic_quiz_profile_update RPC; degradation = DB pressure)* |
| `/api/webhooks/razorpay` ack | 1 s | 3 s | Sentry Performance | B10 billing | [`payment-webhook-recovery.md`](../runbooks/payment-webhook-recovery.md) |
| RAG retrieval (Voyage) | 400 ms | 800 ms | custom timing in `supabase/functions/grounded-answer/` | B6 content + B7 Foxy | [`ai-outage-response.md`](../runbooks/ai-outage-response.md) |
| Projector lag (publish → projection write) | 5 s | 30 s | `public.subscriber_lag` view per [PR #752](https://github.com/AlfanumrikOS/Alfanumrik/pull/752) | B9 + ops | *(to add Iter. 2)* `docs/runbooks/projector-failure.md` |
| `/api/v1/health` | 200 ms | 1 s | Vercel Analytics | ops | *(to add Iter. 2)* `docs/runbooks/health-check-down.md` |

The projector-lag SLI is computed as:

```sql
SELECT max(now() - last_processed_event_at) FROM public.subscriber_lag;
```

Polled every 2 minutes by the `projector-health-check` Edge Function (Iteration 2). Lag > 30 s emits a `projector_health_degraded` PostHog event + Sentry breadcrumb.

## Correctness

Some failures are not latency — they are silent data drift. These get their own SLIs.

| Failure class | SLI | Target | Alert at | Owner | Runbook |
|---|---|---|---|---|---|
| Path C v2 fallback rate (`/api/tutor/answer`) | `tutor_answer_path_c_fallback` PostHog events / total submissions, daily | 0 in production with `ff_tutor_bkt_v1` ON | > 0.1 % over 1 h | B9 | E5 in [`EXCEPTIONS.md`](./EXCEPTIONS.md) |
| RAG grounding pass rate | `eval:rag` score | ≥ 0.80 in CI | drop in any PR | B6 content + B7 Foxy | [`ai-outage-response.md`](../runbooks/ai-outage-response.md) |
| Razorpay webhook drift | DB `subscriptions.status` vs. Razorpay API state | 100 % match in nightly recon job | any mismatch | B10 | [`payment-webhook-recovery.md`](../runbooks/payment-webhook-recovery.md) |
| Tenant config invalid override fallback rate | resolver fallback path hit count / total reads | < 1 % | > 5 % over 1 h | B2 tenant | *(per PR #559 banner — fallback is intentional but spike implies real config corruption)* |
| Custom domain TLS drift | nightly `/api/cron/reverify-domains` (PR #577) | 0 schools with `domain_verified` flipped false | any flip emits `tenant.custom_domain_drift_detected` event | B2 tenant | *(to add Iter. 2)* `docs/runbooks/domain-drift-investigation.md` |
| Seat-cap bypass | `school_seat_cap_hit` rate per source | bounded; no spikes | > 10 events / min from same school | B10 billing | *(operational — review the school)* |

## Error budgets

Monthly error budget = (100 % − availability target). Spending the budget signals it is time to invest in reliability over features.

| Surface | Budget per month | Means |
|---|---|---|
| `/api/v1/health` (99.9 %) | 43.2 min | tolerable monthly downtime |
| Razorpay webhook (99.95 %) | 21.6 min | tolerable monthly outage of B10 |
| Student dashboard (99.9 %) | 43.2 min | tolerable degradation |

When ≥ 50 % of a monthly budget is burned, the owner posts a write-up to `docs/runbooks/post-rollout-decision-template.md` and engineering pauses feature work on that surface until reliability investment lands.

## Alerting wire-up

| Tool | What it covers |
|---|---|
| **Sentry Performance** | route + Edge Function p95 timings; configured via `sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts` |
| **Sentry Issues** | unhandled exceptions; `tracesSampleRate=0.1` per R16 in [`RISK_REGISTER.md`](./RISK_REGISTER.md) |
| **Vercel Analytics** | request volume, status codes, geographic distribution |
| **Vercel Speed Insights** | LCP / FID / CLS / TTFB / INP (Web Vitals) |
| **PostHog** | product events; `tutor_answer_path_c_fallback`, `school_seat_cap_hit`, `learn_read_mode_fallback`, `projector_health_degraded` |
| **`subscriber_lag` view** | per-subscriber lag; queried by `projector-health-check` Edge Function (Iter. 2) |
| **`/api/v1/health`** | synthetic readiness probe |

**Iteration 2 will configure Sentry alert rules** to fire on the thresholds in the tables above. Until then, the thresholds are *target* — manual review in incident postmortems is the only enforcement.

## Escalation

Tier 1 alert (p95 above alert threshold, lasting > 5 min):
- Owner is paged via Sentry + the team's standing escalation channel.
- Owner consults the relevant runbook column.
- If unresolved after 15 min, ops on-call joins.

Tier 2 alert (SLO at risk of breach over remaining error budget for the month):
- Architect + ops review the trend.
- Decision: continue feature work, pause for reliability, or extend budget with documented business justification.

Tier 3 alert (SLO breached for the calendar month):
- Public post-mortem to `docs/postmortems/YYYY-MM-DD-<surface>.md` (template in `docs/runbooks/post-rollout-decision-template.md`).
- Engineering pauses feature work on that surface until corrective action ships.

## Review cadence

- **Monthly** at the end of each calendar month: owner reviews actual vs. SLO, files post-mortem if breached.
- **Quarterly**: architect reviews this document; updates targets if observed performance has shifted enough to make the SLO miscalibrated (set targets too low and they're meaningless; too high and the team burns out chasing them).

## Out of scope for this document

- Cost SLOs (Anthropic spend, Voyage spend, Razorpay fees) — covered separately in `docs/runbooks/audit-production-readiness.md`.
- User-experience SLOs (e.g., quiz completion rate, retention) — these are product metrics, not service-level. PostHog dashboards own them.
- Security SLOs — DPDP compliance, PII redaction, audit-log integrity. Governed by [`RISK_REGISTER.md`](./RISK_REGISTER.md) and audit reports under `docs/audits/`, not by latency budgets.

## Change log

- **2026-05-16 v1** — initial SLO table derived from ADR-005 explicit targets + Phase-2 architecture review § 4.4 + observable surfaces that currently exist in code.
