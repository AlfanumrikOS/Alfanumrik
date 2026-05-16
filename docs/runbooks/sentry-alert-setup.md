# Runbook — Sentry alert setup

**Type:** operator runbook (configuration, not incident response).
**Pairs with:** [`docs/architecture/SLO.md`](../architecture/SLO.md) — the source of truth for every threshold below. If a number here disagrees with SLO.md, **SLO.md wins** and this file is stale; file a PR to reconcile.
**Owner:** ops (configuration) + per-row owner (semantics).
**Updated:** 2026-05-16.

## 1. Scope

This runbook turns the SLO targets in [`SLO.md`](../architecture/SLO.md) into concrete Sentry alert rule definitions an operator can paste into the Sentry dashboard. It covers:

- Per-route latency alerts (Performance Alerts)
- Correctness alerts (Issue Alerts + PostHog bridge)
- Availability alerts (synthetic + 5xx rate)
- Projector lag — the only SLI that lives outside Sentry by default (PostHog event from the `projector-health-check` Edge Function); this runbook documents how to bridge it in.

It does **not** cover incident response. When an alert fires, follow the linked runbook in the rule's "Runbook" column.

The companion SLO doc is `docs/architecture/SLO.md` §"Alerting wire-up" — that section explicitly defers Sentry rule configuration to "Iteration 2". This runbook closes that gap.

## 2. Prerequisites

| Requirement | How to verify |
|---|---|
| Sentry org access at "Manager" or higher | Sentry → Settings → Members; your role must include "Alerts: Create" permission |
| Per-environment Sentry project IDs | `NEXT_PUBLIC_SENTRY_DSN` env var per environment in Vercel; project ID is the integer between `@` and `/` in the DSN |
| Slack workspace + #alerts-prod and #alerts-warn channels | Sentry → Settings → Integrations → Slack must show "Installed" |
| PagerDuty service for SEV-1 critical paging | Sentry → Settings → Integrations → PagerDuty; service key must be configured before any rule routes to it |
| PostHog → Sentry webhook (for projector lag) | PostHog → Project Settings → Webhooks; receiver endpoint configured in Sentry → Integrations → Webhooks |

**Hands off `tracesSampleRate`.** All three configs (`sentry.server.config.ts:12`, `sentry.client.config.ts:9`, `sentry.edge.config.ts:12`) pin `tracesSampleRate = 0.1` in production with an explicit comment warning against bumping it. Bumping to `1.0` multiplies Sentry transaction spend by 10× and exhausts free-tier quota — see [`RISK_REGISTER.md`](../architecture/RISK_REGISTER.md) §R16. Performance Alerts work fine at 0.1 sampling; what changes is the noise floor on tail-percentile alerts, not the alert correctness. **Do not adjust sample rate as a tuning lever** — adjust thresholds instead (see §10 "Tuning guidance").

**Project ID placeholders used below.** Replace at paste time:

| Placeholder | Where to get it |
|---|---|
| `<PROD_PROJECT_ID>` | Sentry → Settings → Projects → `alfanumrik-prod` → Project ID |
| `<STAGING_PROJECT_ID>` | Sentry → Settings → Projects → `alfanumrik-staging` → Project ID |
| `<ORG_SLUG>` | URL of any Sentry page: `https://<ORG_SLUG>.sentry.io/...` |
| `<PD_SERVICE_KEY>` | PagerDuty → Services → Alfanumrik prod → Integration key |

## 3. Alert rules — latency

Every row in [`SLO.md`](../architecture/SLO.md) §"Latency" maps to one Sentry **Performance Alert**. Trigger condition is `p95 of transaction.duration over 5-min window > <alert at>` for the specific transaction.

| # | SLO row ([`SLO.md`](../architecture/SLO.md#latency)) | Sentry alert type | Trigger condition (Sentry filter) | Threshold (warn → critical) | Severity at threshold | Runbook on fire |
|---|---|---|---|---|---|---|
| L1 | `/api/tutor/next` | Performance Alert | `transaction:/api/tutor/next AND http.method:[GET,POST]` p95 over 5 min | 450 ms → 600 ms | warn (SLO at risk) → critical (paging) | `docs/runbooks/tutor-latency-spike.md` (Iter. 2 placeholder; until then: [`projector-failure.md`](./projector-failure.md) §"Downstream DB pressure") |
| L2 | `/api/tutor/answer` | Performance Alert | `transaction:/api/tutor/answer AND http.method:POST` p95 over 5 min | 750 ms → 1000 ms | warn → critical | `docs/runbooks/tutor-latency-spike.md` (Iter. 2) |
| L3 | `/api/foxy` first-token | Performance Alert | `transaction:/api/foxy AND op:foxy.first_token` p95 over 5 min | 4 s → 5 s | warn → critical | [`ai-outage-response.md`](./ai-outage-response.md) |
| L4 | `/api/foxy` full response | Performance Alert | `transaction:/api/foxy AND op:foxy.full_response` p95 over 5 min | 12 s → 15 s | warn → critical | [`ai-outage-response.md`](./ai-outage-response.md) |
| L5 | Dashboard SSR `/dashboard` | Performance Alert | `transaction:GET /dashboard AND transaction.op:pageload.server` p95 over 5 min | 1200 ms → 1500 ms | warn → critical | `docs/runbooks/ssr-latency-degraded.md` (Iter. 2) |
| L6 | `/api/v1/quiz/submit` | Performance Alert | `transaction:/api/v1/quiz/submit AND http.method:POST` p95 over 5 min | 800 ms → 1000 ms | warn → critical | [`projector-failure.md`](./projector-failure.md) §"Downstream DB pressure" (`atomic_quiz_profile_update` RPC) |
| L7 | `/api/webhooks/razorpay` ack | Performance Alert | `transaction:/api/webhooks/razorpay AND http.method:POST` p95 over 5 min | 2 s → 3 s | warn → critical | [`payment-webhook-recovery.md`](./payment-webhook-recovery.md) §"Scenario 4: High webhook latency" |
| L8 | RAG retrieval (Voyage) | Performance Alert | `transaction:supabase.functions.grounded-answer AND op:rag.retrieve` p95 over 5 min | 650 ms → 800 ms | warn → critical | [`ai-outage-response.md`](./ai-outage-response.md) §"Step 3b — Selective degradation" (Voyage-only path) |
| L9 | `/api/v1/health` | Performance Alert | `transaction:/api/v1/health` p95 over 5 min | 750 ms → 1000 ms | warn → critical | `docs/runbooks/health-check-down.md` (Iter. 2) |

**Why warn < critical, both below the SLO "Alert at" line.** [`SLO.md`](../architecture/SLO.md) §"Conventions" defines the "Alert at" column as the page-on-call threshold. A `warn` tier at 75 % of that value gives the owner ~15 minutes to investigate before the page fires. Sentry supports two trigger thresholds per alert rule (Trigger 1 / Trigger 2) so both are encoded in a single rule (see §7 "Per-rule setup procedure").

**Transaction-name caveat.** Sentry's default Next.js auto-instrumentation names transactions after the route, but custom spans (e.g., `foxy.first_token`, `rag.retrieve`) require explicit instrumentation in the route handler. If a transaction name above doesn't exist yet in Sentry's Discover, the alert will never fire — confirm with: Sentry → Discover → query `event.type:transaction transaction:<name>` last 7 days; if zero results, the route is uninstrumented and needs a code change before this alert is useful. Track the gap in [`SLO.md`](../architecture/SLO.md) §"Out of scope" rather than letting it rot here.

## 4. Alert rules — correctness

Correctness SLIs in [`SLO.md`](../architecture/SLO.md#correctness) are not latency — they are silent data drift detected via product events or scheduled jobs. Each gets either an **Issue Alert** (for events Sentry already captures) or a **PostHog → Sentry webhook bridge** (for events PostHog captures).

| # | SLO row ([`SLO.md`](../architecture/SLO.md#correctness)) | Sentry alert type | Trigger condition | Threshold | Severity | Runbook on fire |
|---|---|---|---|---|---|---|
| C1 | Path C v2 fallback rate (`/api/tutor/answer`) | Issue Alert (via PostHog bridge — see §6 "Projector lag" for the bridge mechanism) | `event.type:posthog_event AND name:tutor_answer_path_c_fallback AND flag.ff_tutor_bkt_v1:on` count over 1 h | > 0.1 % of total tutor_answer submissions | critical (silent correctness loss) | [`EXCEPTIONS.md`](../architecture/EXCEPTIONS.md) §E5 |
| C2 | RAG grounding pass rate | **Not Sentry — CI check.** `eval:rag` runs in CI on every PR. Failing PRs block merge; no production alert needed. Cross-link only. | `pnpm eval:rag` exit code ≠ 0 | drop below 0.80 in any PR | blocking (CI) | [`ai-outage-response.md`](./ai-outage-response.md) §"Step 4a — Verify upstream is back" |
| C3 | Razorpay webhook drift (DB vs API state) | Issue Alert | `event.type:error AND tag.job:nightly_razorpay_recon AND message:"subscription drift detected"` over 24 h | any mismatch | critical (P0 per [`payment-webhook-recovery.md`](./payment-webhook-recovery.md) §"Severity tiers") | [`payment-webhook-recovery.md`](./payment-webhook-recovery.md) §"Scenario 1: Customer paid but plan still says Free" |
| C4 | Tenant config invalid override fallback rate | Issue Alert (via PostHog bridge) | `event.type:posthog_event AND name:tenant_config_invalid_override_fallback` count over 1 h | > 5 % of total tenant config reads | warn (config corruption likely) | `docs/runbooks/tenant-config-drift.md` (Iter. 2) — until then: [`projector-failure.md`](./projector-failure.md) §"Check the kill-switch" pattern |
| C5 | Custom domain TLS drift | Issue Alert (via PostHog bridge) | `event.type:posthog_event AND name:tenant.custom_domain_drift_detected` count over 1 h | any flip from `domain_verified=true` to `false` | warn (visible to that one tenant only) | `docs/runbooks/domain-drift-investigation.md` (Iter. 2) |
| C6 | Seat-cap bypass | Issue Alert (via PostHog bridge) | `event.type:posthog_event AND name:school_seat_cap_hit GROUP BY school_id` rate over 1 min | > 10 events/min from the same `school_id` | warn (operational — likely staff scripting) | _(none — direct school review per [`SLO.md`](../architecture/SLO.md#correctness) "Owner" col)_ |

**Why C2 is NOT a Sentry alert.** Grounding pass rate is evaluated in CI per [`SLO.md`](../architecture/SLO.md#correctness) row 2 — "drop in any PR" is enforced by CI failure, not paging. Adding a production Sentry alert here would be noise: by the time a model regression hits prod, it has already been deployed past the CI gate. Investigate the gate, not the alert. If we ever drift to merging despite failing `eval:rag`, that's a process problem; tightening CI is the fix, not adding an after-the-fact pager.

**PostHog → Sentry bridge.** Rows C1, C4, C5, C6 all route PostHog events into Sentry as Issue Alerts. The mechanism is identical for all four; the configuration is described once in §6 (it's the same as the projector-lag bridge). Per-row differences are only the event `name` filter and the threshold.

## 5. Alert rules — availability

[`SLO.md`](../architecture/SLO.md#availability) defines availability via the synthetic ping on `/api/v1/health` plus 5xx-rate ceilings on user-facing surfaces. Sentry covers both via:

- **Cron Monitors** for the synthetic — Sentry pings the URL on a schedule; missed pings = downtime.
- **Metric Alerts** for 5xx rate — count of `event.type:error AND tag.http.status_code:5xx` over a rolling window.

| # | SLO row ([`SLO.md`](../architecture/SLO.md#availability)) | Sentry alert type | Trigger condition | Threshold | Severity | Runbook on fire |
|---|---|---|---|---|---|---|
| A1 | `/api/v1/health` (99.9 % monthly) | Cron Monitor | HTTP probe to `https://alfanumrik.vercel.app/api/v1/health` every 60 s; expect 200 | 2 consecutive failures (~2 min) | critical (page on-call) | [`database-outage-response.md`](./database-outage-response.md) — health endpoint composes DB + auth + Edge Function probes |
| A2 | Marketing pages (ISR) (99.95 %) | Metric Alert | `event.type:error AND tag.http.status_code:5xx AND tag.route:/(?!api)` count over 5 min | ≥ 5 consecutive 5xx | warn | Vercel deployment logs (operator console) |
| A3 | Student dashboard `/dashboard` (99.9 %) | Metric Alert | `event.type:error AND tag.http.status_code:5xx AND transaction:/dashboard` count over 5 min | ≥ 5 consecutive 5xx | critical | `docs/runbooks/ssr-latency-degraded.md` (Iter. 2) — same root causes (DB pool, cold start, RSC failure) |
| A4 | Razorpay webhook `/api/webhooks/razorpay` (99.95 %) | Issue Alert | `event.type:error AND transaction:/api/webhooks/razorpay AND tag.http.status_code:5xx` count over 5 min | 1 failure on POST | critical (P0 — Razorpay retry budget burns fast) | [`payment-webhook-recovery.md`](./payment-webhook-recovery.md) §"Severity tiers" P0 row |

**Maintenance-window exclusion.** [`SLO.md`](../architecture/SLO.md#availability) says maintenance windows are excluded from the monthly calculation; they're not excluded from alerting. If a planned maintenance is happening, mute the affected rule via Sentry → Alerts → `<rule>` → "Snooze" for the window duration (max 24 h per snooze; renew if longer). Do not delete the rule. Document the snooze in the maintenance ticket so the trail is auditable; an un-snoozed rule firing during a known window is a noisy false positive that erodes trust in the alert system.

**Cron Monitor caveat.** Sentry Cron Monitors require the [PRO plan](https://sentry.io/pricing/) on most orgs; on the team-tier plan, fall back to Vercel's built-in uptime monitor (Vercel → Project → Speed Insights → Uptime) and configure the Vercel monitor to POST to Sentry's webhook on failure. This is a hosting cost decision, not a technical one — flag to ops before paying.

## 6. Projector lag — the PostHog bridge

Projector lag is the **only SLI** in [`SLO.md`](../architecture/SLO.md#latency) whose canonical signal lives outside Sentry. The path is:

```
public.subscriber_lag view (SQL)
  → projector-health-check Edge Function (polls every 2 min)
  → PostHog event projector_health_degraded with severity field (warn | critical)
  → [bridge] → Sentry Issue Alert
```

Two valid configurations — pick **one**, not both, to avoid duplicate pages.

### 6a. Option A: Sentry-side (centralized)

Configure the bridge so PostHog forwards `projector_health_degraded` to Sentry, where the existing Issue Alert routing applies.

**Setup steps:**

1. PostHog → Project Settings → Webhooks → "Add webhook"
   - URL: `https://sentry.io/api/0/projects/<ORG_SLUG>/<PROD_PROJECT_ID>/store/?sentry_key=<SENTRY_INGEST_KEY>`
   - Trigger: `event = projector_health_degraded AND properties.severity = 'critical'`
   - Payload template: see [PostHog → Sentry webhook docs](https://posthog.com/docs/webhooks); the body must wrap the PostHog event into a Sentry-compatible payload with `event.type:posthog_event` tag.
2. Sentry → Alerts → Create Alert → Issue Alert
   - Name: `projector_health_degraded (critical) — bridged from PostHog`
   - Filter: `event.type:posthog_event AND name:projector_health_degraded AND properties.severity:critical`
   - Trigger: When `count > 0` over 1 min
   - Action: notify #alerts-prod Slack + page on-call via PagerDuty (per §8 routing matrix)

**Pros:**
- One paging system to consult during an incident — every alert is in Sentry.
- Cross-references with simultaneous Sentry errors are visible on the Issue page (e.g., projector lag + DB connection error → same incident).

**Cons:**
- Bridge latency adds ~30 s to alert delivery vs. PostHog direct.
- One more moving piece — the bridge can fail silently if the webhook URL rotates or PostHog rate-limits.

### 6b. Option B: PostHog-side (native)

Configure the alert directly in PostHog. Skip Sentry entirely for this SLI.

**Setup steps:**

1. PostHog → Insights → New Insight → "Trends"
   - Series: `projector_health_degraded` count over time
   - Breakdown: `properties.severity`
   - Save as `Projector lag — severity breakdown`
2. PostHog → Alerts → "Add alert" on the insight
   - Condition: `severity = critical` count > 0 over 5 min
   - Channel: Slack #alerts-prod + email ops@
   - Page on-call via PostHog's webhook to PagerDuty service `<PD_SERVICE_KEY>` (PostHog → Settings → Integrations → PagerDuty)

**Pros:**
- Native; no bridge to maintain.
- PostHog has richer breakdown filters (per-subscriber, per-cohort) than Sentry's tag-based filters.

**Cons:**
- Splits paging across two tools — on-call must learn to check PostHog as well as Sentry.
- No cross-correlation with Sentry errors at incident time (must manually open both UIs).

### Recommendation

**Use Option A (Sentry-side bridge) until/unless the bridge proves unreliable.** Single pane of glass during incidents matters more than per-tool ergonomics for an SLI that fires rarely. If the bridge accumulates a track record of dropped events (track via comparison: count of `projector_health_degraded` in PostHog vs. count of bridged Issues in Sentry, daily), flip to Option B and document the reason in the change log below.

The bridge mechanism in §6a is the same pattern used for correctness rows C1, C4, C5, C6 in §4. Configure it once, route four event names through it, get five alerts.

## 7. Per-rule setup procedure

This is the Sentry-dashboard click-path for each alert type listed in §3–§5. Sentry's UI changes occasionally; if a navigation step disagrees with what you see, file a PR to fix the runbook.

### 7.1. Performance Alert (latency rows L1–L9)

Use this for all latency rows in §3.

1. Sentry → Alerts → **Create Alert**
2. Choose alert type: **Performance** → "Number of transactions exceeded threshold" → Next
3. **Environment** dropdown: select `production` (create a separate rule for `staging` only if staging traffic is high enough for p95 to be meaningful — usually it isn't; staging tracks via dev signals)
4. **Filter** field: paste the `transaction:...` filter from the row's "Trigger condition" column
5. **Metric** dropdown: `p95(transaction.duration)`
6. **Time window**: 5 minutes (matches [`SLO.md`](../architecture/SLO.md#conventions) "p95 over a 5-minute rolling window")
7. **Critical trigger**: above `<critical threshold>` ms — paste from the row's "Threshold" column (the right-hand value)
8. **Warning trigger**: above `<warn threshold>` ms — left-hand value
9. **Actions**:
   - Critical: notify #alerts-prod Slack + page on-call via PagerDuty (§8)
   - Warning: notify #alerts-warn Slack only — no page
10. **Resolve threshold**: leave at "Automatic" — Sentry auto-resolves when p95 drops back below the warning trigger for one full window
11. **Name** field: use the SLO row name, e.g., `L1 / tutor next p95 600ms`
12. **Owner** dropdown: assign to the per-row owner team from [`SLO.md`](../architecture/SLO.md#latency) (e.g., `B9 assessment` → maps to the `b9-assessment` Sentry team)
13. Save Rule

Repeat for L1 through L9. Most fields are identical row-to-row; only filter, thresholds, and owner change.

### 7.2. Issue Alert (correctness rows C1, C3, C4, C5, C6 + projector bridge §6a)

Use this for non-latency rules that fire on event count.

1. Sentry → Alerts → **Create Alert**
2. Choose alert type: **Issue** → "Number of events in an issue is more than" → Next
3. **Environment** dropdown: select `production`
4. **Filter** (under "If") field: paste the row's "Trigger condition" filter (e.g., `event.type:posthog_event AND name:projector_health_degraded AND properties.severity:critical`)
5. **Trigger** (under "When"): occurrence count > threshold over time window — paste from the "Threshold" column
6. **Actions** (under "Then"):
   - Critical-severity rules: notify #alerts-prod + page on-call via PagerDuty
   - Warn-severity rules: notify #alerts-warn only
7. **Name** field: e.g., `C1 / Path C v2 fallback rate >0.1%`
8. **Owner**: per the row's owner column in [`SLO.md`](../architecture/SLO.md#correctness)
9. Save Rule

### 7.3. Metric Alert (availability rows A2, A3)

Use this for 5xx rate ceilings.

1. Sentry → Alerts → **Create Alert**
2. Choose alert type: **Metric** → "Number of errors" → Next
3. **Environment** dropdown: `production`
4. **Filter** field: paste the row's filter
5. **Time window**: 5 minutes
6. **Critical trigger**: count ≥ 5 (or the row-specific value)
7. **Actions** per §8 routing matrix
8. Save Rule

### 7.4. Cron Monitor (availability row A1)

Use this for the synthetic `/api/v1/health` ping.

1. Sentry → Crons → **Create Monitor**
2. **Schedule** type: HTTP probe
3. **URL**: `https://alfanumrik.vercel.app/api/v1/health`
4. **Interval**: every 60 s
5. **Expected status**: 200
6. **Grace period**: 30 s (allow one slow response without flagging)
7. **Alert on**: 2 consecutive missed checks
8. **Actions** per §8 routing matrix — A1 is critical
9. Save Monitor

### 7.5. Issue Alert (availability row A4 — Razorpay webhook 5xx)

Identical to §7.2 but with the filter from row A4. Critical severity from the first failure: Razorpay's retry budget is short and dropped events become drift (see [`payment-webhook-recovery.md`](./payment-webhook-recovery.md) §"Severity tiers").

## 8. Notification routing

This is the channel matrix for **Actions** in §7. Mirrors [`SLO.md`](../architecture/SLO.md#escalation) tiers.

| Severity | Slack channel | Email | PagerDuty | When |
|---|---|---|---|---|
| **warn** | #alerts-warn | _(none)_ | _(none)_ | SLO at risk; owner investigates within 30 min (business hours) or by morning (out-of-hours) |
| **critical** | #alerts-prod | ops@alfanumrik.com | service `<PD_SERVICE_KEY>` | Tier 1 alert per [`SLO.md`](../architecture/SLO.md#escalation); page on-call immediately |
| **P0** (subset of critical) | #alerts-prod + #incident-room | ops@ + founder@ | service `<PD_SERVICE_KEY>` with `urgency=high` | Split-brain, P11 invariant breach, full payment outage, data corruption — per [`payment-webhook-recovery.md`](./payment-webhook-recovery.md) §"Severity tiers" and [`projector-failure.md`](./projector-failure.md) §"Escalation" |

**Slack action setup.** Sentry → Settings → Integrations → Slack → Add Action; pick channel from the dropdown. The integration must already be installed at org level (Prerequisites §2). The Sentry Slack app posts as `Sentry`; do not use a personal bot token.

**PagerDuty action setup.** Sentry → Settings → Integrations → PagerDuty → Add Service. Use the service-level integration key, not the user-level routing key — the service key correctly routes to the on-call rotation. User keys route to one specific human and break when they rotate off-call.

**Tier 2 / Tier 3 escalation.** Per [`SLO.md`](../architecture/SLO.md#escalation), Tier 2 (SLO at risk of monthly breach) and Tier 3 (SLO breached) are **post-hoc reviews**, not alerts — they fire from monthly error-budget reports, not from Sentry. No Sentry rule encodes them. The owner reviews actuals against [`SLO.md`](../architecture/SLO.md#error-budgets) on the monthly cadence ([`SLO.md`](../architecture/SLO.md#review-cadence) §"Review cadence") and files the postmortem from there.

**Per-tenant escalation (white-label).** Custom-domain tenants (row C5) are scoped to one school's user base. A `tenant.custom_domain_drift_detected` event affects only that tenant; the alert routes to #alerts-warn only, not PagerDuty. Per-tenant pages would create a noise cascade as the school roster grows. If a P0 tenant-impacting condition arises, the per-row runbook (when written) is responsible for escalating manually.

## 9. Verification

After creating any rule, verify it routes correctly **before** trusting it in production.

### 9.1. Sentry "Test alert" button

Every Issue/Metric/Performance alert in Sentry has a `...` menu → **"Send test alert"** option. This dispatches a synthetic event through the configured Actions without triggering the underlying condition. Use it to confirm:

- Slack channel receives the message in the right channel (#alerts-prod vs #alerts-warn)
- PagerDuty pages the correct service (the test page should resolve immediately; do not silence it without checking that it was received)
- Email lands in ops@alfanumrik.com (check the inbox; spam filters can swallow Sentry's `notifications@sentry.io` sender)

Test every critical-severity rule after creation. Skipped tests are how dropped pages happen.

### 9.2. Manual artificial breach

For high-stakes rules (A1 health Cron Monitor, A4 Razorpay webhook, C3 Razorpay drift), do an end-to-end test by temporarily lowering the threshold and triggering the underlying condition.

**Example for L7 (Razorpay webhook latency):**

1. Sentry → Alerts → `L7 / razorpay webhook ack p95` → Edit
2. Temporarily set critical threshold to 50 ms (so any real webhook will breach)
3. Save
4. Re-fire a recent webhook from Razorpay dashboard (Razorpay → Webhooks → recent event → "Re-send"). The real p95 will be in the hundreds of ms, so the artificially low threshold will fire.
5. Confirm the page lands per §9.1.
6. **Revert the threshold immediately** to the documented value (2 s warn, 3 s critical per row L7). A forgotten artificial-breach threshold causes a flood of false-positive pages.
7. Document the test in the rule's "Description" field with date and verifier.

**Do not artificially breach on Friday evening or before holidays.** Operator availability is lower; a forgotten revert causes weekend pages. If the test must happen, leave a calendar reminder for the next business hour to verify the revert.

### 9.3. Reverse verification — "did it actually fire?"

For the projector-lag bridge (§6) specifically, since it crosses two systems, run a weekly reconciliation:

```sql
-- In PostHog: count of projector_health_degraded events last 7 days, severity = critical
SELECT count(*) FROM events
WHERE event = 'projector_health_degraded'
  AND properties.severity = 'critical'
  AND timestamp > now() - interval '7 days';
```

Compare against Sentry → Discover → `event.type:posthog_event AND name:projector_health_degraded AND properties.severity:critical` over the same window. Counts should match. Any drift > 5 % indicates bridge drops; investigate the webhook delivery log in PostHog.

## 10. Tuning guidance

Once rules are live, they will fire on real conditions. Use this rubric to decide whether to widen the threshold or treat the alert as a real symptom.

### 10.1. Widen the threshold when:

- **The alert fires on every cold start / autoscale event** with no user impact. Cold starts on Vercel serverless add 200–800 ms tail latency; an L9 health-check rule set at 1 s will fire on every cold start without indicating a problem. Solution: raise the threshold, or filter out cold-start transactions via a Sentry tag (the routes already emit a `cold_start:true` tag when applicable — confirm via Discover before adding the filter).
- **Sentry sampling makes the p95 noisy at low traffic.** At `tracesSampleRate = 0.1` with < 100 transactions/min on a route, the sampled p95 has high variance. Solution: raise the time window from 5 min to 15 min for low-traffic rules (L9 health-check, L8 RAG retrieval out of hours). Do **not** raise sample rate per §2 / R16.
- **The threshold was set aspirationally.** If [`SLO.md`](../architecture/SLO.md) was written before measuring real production p95, the alert threshold may be tighter than the actual baseline. The fix is to update [`SLO.md`](../architecture/SLO.md) (file a PR with the observed p95 and a rationale), not to silently widen the Sentry rule. Sentry-side widening that drifts from [`SLO.md`](../architecture/SLO.md) is an audit failure.

### 10.2. Treat as a real symptom when:

- **Multiple correlated alerts fire in the same window.** If L1 (tutor/next) and L6 (quiz/submit) both fire at the same time, the symptom is shared infrastructure — typically DB pressure (see [`projector-failure.md`](./projector-failure.md) §"Downstream DB pressure" or [`database-outage-response.md`](./database-outage-response.md)). Widening individual alert thresholds in this case masks the real problem.
- **The alert fires sustained, not transiently.** A 5-min window that breaches for 30 s and recovers is often noise (a single slow request dragged the p95). A 5-min window that has breached for 20 minutes is a real degradation. Sentry's automatic resolution catches the first case; sustained alerts need investigation.
- **It correlates with a recent deploy.** Sentry → Releases shows the deploy that preceded the breach. If the alert started within 1 hour of a release, the deploy is the prime suspect — follow [`projector-failure.md`](./projector-failure.md) §"Handler bug introduced in recent deploy" pattern for the relevant route owner.

### 10.3. Don't:

- **Don't snooze critical rules without a paired calendar reminder.** Snoozed rules silently miss real outages. Sentry's max snooze is 24 h; renew explicitly, do not let it become a habit.
- **Don't disable alerts during incidents** — even if they're noisy. The noise is information about scope. Note the alerts on the postmortem and tune them after; disabling them mid-incident loses the breadth-of-impact signal.
- **Don't bump `tracesSampleRate` to reduce noise.** That's the wrong lever; it 10×'s spend per §2 and [R16](../architecture/RISK_REGISTER.md). Adjust time windows or thresholds.

## 11. Related runbooks

- [`projector-failure.md`](./projector-failure.md) — when projector-lag alerts (§6) fire
- [`payment-webhook-recovery.md`](./payment-webhook-recovery.md) — when row L7 (latency) or A4 (5xx) or C3 (drift) fire
- [`ai-outage-response.md`](./ai-outage-response.md) — when rows L3, L4, L8 (Foxy + Voyage latency) fire
- [`database-outage-response.md`](./database-outage-response.md) — when A1 (health) or A3 (dashboard) fire and the root cause is DB
- [`SLO.md`](../architecture/SLO.md) — source of truth for every threshold above
- [`RISK_REGISTER.md`](../architecture/RISK_REGISTER.md) §R16 — why `tracesSampleRate` stays at 0.1
- [`EXCEPTIONS.md`](../architecture/EXCEPTIONS.md) §E5 — the Path C fallback exception that row C1 alerts on

## 12. Change log

- **2026-05-16 v1** — initial runbook closing Phase-1 audit finding H4. Encodes Sentry alert rules for every row in [`SLO.md`](../architecture/SLO.md) §"Latency", "Correctness", "Availability". Documents the PostHog→Sentry webhook bridge for `projector_health_degraded` and the four correctness events (C1, C4, C5, C6) that share the same mechanism. Companion to [`SLO.md`](../architecture/SLO.md) §"Alerting wire-up" — replaces the "Iteration 2 will configure Sentry alert rules" placeholder with concrete operator steps.
