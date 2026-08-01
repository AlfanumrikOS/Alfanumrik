---
name: status-report
description: Synthesize a founder-facing status report (product health, system health, release readiness, risk register, academic integrity, AI health, support status) from all agent domains. Use when the user asks for a status update, health check, or report on the platform.
user-invocable: false
---

# Status Report

## Reporting Chain

```
User (Founder/CEO)
  │
  │  Receives from orchestrator:
  │  ├─ Product health    (ops: users, DAU/MAU, quiz completion, revenue)
  │  ├─ System health     (ops: error rate, uptime, health check, latency)
  │  ├─ Release readiness (quality: gate status, test count, bundle sizes)
  │  ├─ Risk register     (orchestrator: blockers, high-risk changes pending)
  │  ├─ Academic integrity (assessment: scoring accuracy, content coverage gaps)
  │  ├─ AI health         (ai-engineer: API success rate, circuit breaker, RAG quality)
  │  └─ Support status    (ops: open tickets, resolution time, top issues)
  │
  └── orchestrator (synthesizes all agent reports)
        ├── architect     → schema changes, security assessments, deploy status
        ├── frontend      → files changed, UI states, i18n, mobile impact
        ├── backend       → API changes, payment impact, notification changes
        ├── assessment    → scoring accuracy, grading consistency, content coverage
        ├── ai-engineer   → AI changes, prompt changes, safety, RAG quality
        ├── testing       → test results, regression catalog, coverage gaps
        ├── quality       → checks passed/failed, review findings, UX audit, verdict
        └── ops           → system metrics, user metrics, revenue, support, flags
```

## Super Admin Reporting Visibility

The super admin panel (ops-owned) exposes:
| Category | Source | Metrics |
|---|---|---|
| Product health | ops + assessment | Active users, signups, DAU/MAU, quiz completion, avg score |
| Learner metrics | assessment + ai-engineer | Topics mastered, Bloom's distribution, knowledge gaps, XP velocity |
| Revenue | backend + ops | Active subs, MRR, churn, plan distribution, payment failures |
| System health | architect + ops | Health endpoint, error rate, latency, DB connections, memory |
| AI health | ai-engineer | Claude API success rate, circuit breaker state, response time, RAG hit rate |
| Release readiness | quality + testing | Gate status, test count, regression results, bundle sizes |
| Content coverage | assessment | Questions per subject/grade, gap analysis, Bloom's per topic |
| Support | ops | Open tickets, resolution time, top issue categories |
