# 12 — Observability, Alerting & Reliability

**Audit date:** 2026-08-29
**Evidence source:** Observability agent (completed), CI/CD agent (completed)

---

## 1. Observability Stack

| Layer | Tool | Status |
|-------|------|--------|
| Error tracking | Sentry | Active — global-error.tsx reports; beforeSend PII redaction |
| Product analytics | PostHog | Active — allowlist filtering; hashed distinct IDs; autocapture disabled |
| Structured logging | Custom logger | Active — JSON-structured; shared redactor for PII |
| Ops events | ops_events table | Active — cron results, health checks, operational alerts written to DB |
| Uptime monitoring | Vercel Analytics | Active — bom1 region |
| Infrastructure | Supabase Dashboard | Active — connection pooling, query performance, disk usage |

## 2. Alerting

| Channel | Type | Status |
|---------|------|--------|
| Email (single CEO inbox) | Primary | Active |
| Slack | Not configured | — |
| PagerDuty / Opsgenie | Not configured | — |
| SMS / Phone | Not configured | — |

## 3. Findings

### P1
| ID | Finding | Impact |
|----|---------|--------|
| P1-04 | Single-person email-only alerting (CEO inbox) — no redundancy, no escalation chain, no guaranteed delivery | If CEO email is down, has full inbox, or is asleep, critical alerts are lost. No PagerDuty/Slack backup. |

### P2
| ID | Finding | Impact |
|----|---------|--------|
| P2-14 | Single notification channel for all severity levels — no escalation tiers (warn → page → call) | P0 incidents get the same delivery as P3 informational alerts |
| P2-15 | No SLO/SLA dashboards — no formal latency/availability targets tracked | Can't measure service quality commitments to schools |
| P2-16 | Edge auth sweep CI check runs as advisory (non-blocking) — findings don't fail the build | Security regressions can merge without anyone noticing |

### P3
| ID | Finding | Impact |
|----|---------|--------|
| P3-09 | No distributed tracing (OpenTelemetry/Jaeger) — cross-service request flows can't be traced | Debugging multi-hop issues (API → Edge Function → Supabase) requires manual log correlation |
| P3-10 | No synthetic monitoring (scheduled health probes from external vantage points) | Outages detected only when users report or cron fails |
| P3-11 | ops_events table has no retention policy — will grow unbounded | Storage cost and query performance will degrade over time |
| P3-12 | Sentry has no alert rules configured for error rate spikes | Errors only visible when someone checks the Sentry dashboard manually |

---

## 4. Positive Findings

1. **PII redaction is multi-layered:** shared redactor utility, Sentry `beforeSend` hooks, PostHog allowlist filtering, hashed distinct IDs, and autocapture disabled. This is defense-in-depth for privacy.
2. **ops_events pipeline** provides a self-hosted audit trail of cron job outcomes and operational events — unusual for a startup-stage product.
3. **PostHog autocapture disabled** prevents accidental collection of student interaction data — a privacy-conscious choice.
4. **global-error.tsx** reports to Sentry with context — no silent error swallowing at the top level.

---

## 5. Gate Verdict

**CONDITIONAL GO** — Observability tooling is in place and functional. P1-04 (single-person alerting) is in Phase 0 blockers. For a controlled pilot with known school partners, the CEO can manually monitor, but this must be addressed before scaling.
