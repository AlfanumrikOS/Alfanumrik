# 10 — Reporting & Analytics

**Audit date:** 2026-08-29
**Evidence source:** Limited — cross-references from observability and cron agents

---

## 1. Analytics Stack

| Component | Tool | Notes |
|-----------|------|-------|
| Product analytics | PostHog | Privacy-first config: autocapture OFF, hashed IDs, allowlist filtering |
| Error tracking | Sentry | beforeSend PII redaction |
| Operational events | ops_events table | Self-hosted audit trail for cron outcomes and health checks |
| Analytics aggregation | analytics-aggregator cron | Daily rollup at 07:00 UTC |
| Report generation | report-generator cron | Weekly school reports at 08:00 UTC Monday |
| Parent reports | parent-report-sender cron | Weekly parent reports at 14:00 UTC Friday |

## 2. Report Types

| Report | Audience | Frequency | Delivery |
|--------|----------|-----------|----------|
| School performance report | School admins | Weekly | In-app + email |
| Parent progress report | Parents | Weekly | Email |
| Teacher class report | Teachers | On-demand | In-app |
| Student dashboard | Students | Real-time | In-app |
| MRR/subscription report | Platform admin | On-demand | In-app |
| Analytics snapshot | Internal | Daily | DB (pg_cron) |

## 3. Findings

No dedicated reporting/analytics agent was run. Known issues from cross-references:

| ID | Severity | Finding |
|----|----------|---------|
| P2-15 | P2 | No SLO/SLA dashboards — no formal latency/availability targets tracked |
| P3-12 | P3 | Sentry has no alert rules configured for error rate spikes |

## 4. Data Gaps

- Full analytics event coverage mapping not completed
- Report accuracy validation not performed
- Dashboard load time / performance not measured
- Data retention policies for analytics data not audited

## 5. Gate Verdict

**CONDITIONAL GO** — Analytics stack is in place with privacy-first configuration. Deeper audit deferred.
