# SRE — SLOs, Monitoring, Alerting, and Incident Response

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Runbook
**Priority:** P0 (Critical — defines how the platform's reliability is measured and defended)
**Applies To:** Every reliability activity for the live Alfanumrik web tier: SLO/SLI definitions, monitoring, alerting, incident severity, on-call response, escalation, and post-incident handoff to root-cause analysis.

---

# Purpose

This runbook is the executable Site Reliability Engineering procedure for Alfanumrik. It defines what "healthy" means in measurable terms (SLOs/SLIs), where the signals come from (Sentry, Vercel Analytics, the health endpoint, the synthetic monitor, the pipeline watcher), how alerts fire, how incidents are classified and responded to, and how a resolved incident hands off to RCA.

The platform serves Indian K-12 students on the live Vercel (`bom1`/Mumbai) + Supabase stack. Reliability is a product property: a slow or broken platform during the 4–9 PM IST after-school study peak is a direct hit to learning outcomes and trust. Per core doc 20, *until a change is observed running correctly with evidence, nothing has been delivered* — and per the verification engine (doc 10), every claim of "healthy" requires a signal, not an assumption.

---

# Scope

In scope: SLO/SLI targets, the monitoring surfaces, alert routing, severity levels (SEV-1…SEV-4), the on-call response loop, escalation, rollback as an incident tool, and the post-incident handoff. The live web tier is on Vercel; the AWS path is dormant (see the aws-operations runbook).

Out of scope: the cutover mechanics of the AWS path, CI gate definitions (the github-operations runbook), and Supabase backup/restore (the disaster-recovery runbook).

---

# SLOs and SLIs

Targets are centralized in code at `src/lib/slo.ts` and consumed by the health endpoint and monitoring. The SLI is the measured indicator; the SLO is the target it must hold.

| Objective | SLI (what we measure) | SLO (target) | Source constant |
|---|---|---|---|
| Availability | Monthly uptime (fraction of successful requests) | **99.5%** (~3.6h/month budget) | `UPTIME_TARGET = 0.995` |
| Error rate | Fraction of requests returning 5xx | **< 1%** | `ERROR_RATE_THRESHOLD = 0.01` |
| API latency | p95 latency on API routes | **< 500 ms** | `API_P95_LATENCY_MS = 500` |
| Quiz submission | p95 of the atomic submit path | **< 2000 ms** | `QUIZ_SUBMISSION_P95_MS = 2000` |
| Foxy AI tutor | p95 response (Claude call + stream) | **< 5000 ms** | `FOXY_RESPONSE_P95_MS = 5000` |
| DB query | Slow-query warning threshold | **> 200 ms logged** | `DB_QUERY_WARN_MS = 200` |

Error-budget posture: the availability SLO of 99.5% means roughly 3.6 hours of monthly downtime budget. When the budget is being burned quickly (a sustained error-rate or latency breach), reliability work takes priority over feature work until the budget recovers. B2B per-school SLO tracking exists via `SchoolSLOTracker` for 5K–10K concurrent-user schools.

---

# Monitoring Surfaces

Reliability is observed through five complementary surfaces. No single one is sufficient.

1. **Health endpoint — `GET /api/v1/health`** (`src/app/api/v1/health/route.ts`). Always returns HTTP 200 (so load balancers do not eject the instance); the `status` field carries the truth: `healthy` / `degraded` / `unhealthy`. It probes dependencies with a 3s per-probe timeout: Supabase, an Edge Function (`grounded-answer`), Upstash Redis (skipped if unconfigured), and Razorpay (404 = reachable; 5xx/401 = real failure). It reports app version, deploy env, region, and git SHA — use it first in any incident.
2. **Sentry** (client / server / edge). Error tracking and grouping. Client errors tunnel through `/monitoring` to bypass ad-blockers. Per product invariant **P13**, no PII reaches Sentry — `src/lib/logger.ts` redacts password/token/email/phone/API keys; the client `beforeSend` redactor strips identity/headers/URL params/body/cookies before the event leaves the browser. Watch for new error classes and spikes correlated with a deploy.
3. **Vercel Analytics** — real-user latency, region distribution, and traffic shape (the `bom1` region and the 4–9 PM IST peak).
4. **Synthetic monitor** (`.github/workflows/synthetic-monitor.yml`) — Playwright runs against prod every ~15 minutes; on red it uploads traces and posts to `SYNTHETIC_MONITOR_SLACK_WEBHOOK`. This catches a serving outage even when the deploy pipeline is green.
5. **Pipeline-failure watcher** (`.github/workflows/pipeline-alert.yml`) — opens a `pipeline-failure` GitHub issue when a watched `main` pipeline goes red, auto-closing on green. This catches a broken pipeline that the synthetic monitor cannot see (prod keeps serving the last good deploy). The synthetic monitor and the watcher together cover both failure shapes — broken serving and broken pipeline.

---

# Alerting

| Trigger | Detected by | Channel |
|---|---|---|
| Serving outage / critical-path break on prod | synthetic-monitor (every ~15 min) | Slack + run failure + artifacts |
| Red `main` deploy/CI pipeline | pipeline-alert (`workflow_run`) | GitHub `pipeline-failure` issue (guaranteed) + Slack (best-effort) |
| Error-class spike / new error | Sentry alert rules | Sentry notification |
| Latency / error-rate SLO breach | Vercel Analytics + health `status` | dashboard + on-call review |
| Dependency down (Supabase / Redis / Razorpay / Edge) | `/api/v1/health` `status` != healthy | health probe + on-call |

Alert hygiene: an open `pipeline-failure` issue ALWAYS means "currently broken" (it auto-closes on green) — never let a stale red flag erode trust. Slack alerts are best-effort and must never be the only channel for a critical signal.

---

# Incident Severity Levels

| Severity | Definition | Examples | Response |
|---|---|---|---|
| **SEV-1** | Full outage or data-integrity / payment / privacy breach | Site down; payment double-charge; PII leak; scoring corruption shipped | Immediate; page on-call; consider instant rollback |
| **SEV-2** | Major degradation, no full outage | Quiz submission failing for many users; Foxy down; one role's portal broken; auth funnel (P15) broken | Within minutes; on-call leads; rollback candidate |
| **SEV-3** | Minor / partial degradation | Elevated latency under SLO breach; one dependency degraded but app serving; non-critical Edge Function failing | Same business day |
| **SEV-4** | Cosmetic / low-impact | Single-page UI glitch; advisory CI flake; non-blocking warning | Backlog / next cycle |

Classify by impact, not by cause. A payment or privacy issue is SEV-1 even if few users are affected, because it touches product invariants P11/P13.

---

# On-Call Response Loop

Follow this loop for any SEV-1/SEV-2. It mirrors core doc 22 (Debugging) — preserve evidence, never guess.

1. **Acknowledge.** Claim the alert (Slack / GitHub issue). Start an incident note (timestamp, severity, observed symptom).
2. **Assess.** Hit `https://alfanumrik.com/api/v1/health` and read `status` + per-dependency results. Check Sentry for new error classes, Vercel Analytics for latency/traffic, and any open `pipeline-failure` issue. Determine blast radius (which route, which role, which dependency).
3. **Contain.** Stop the bleed before fixing the root cause:
   - **Deploy-correlated regression?** Roll back via the Vercel Dashboard (Deployments → Promote previous) — instant, no rebuild. The production workflow also auto-rolls-back on a genuine health failure.
   - **Feature-flag-gated change?** Disable the flag — a flag toggle is itself a rollback that needs no redeploy.
   - **Dependency down?** Confirm graceful degradation (the health endpoint and admin client fail fast at their timeouts so the app degrades rather than hangs).
4. **Diagnose.** Identify the minimal corrective action. Do not retry blindly. Collect logs and the failing state.
5. **Correct.** Apply the fix through the full pipeline (core doc 20) — no manual production change outside break-glass. For a SEV-1 a hotfix branch follows the core doc 11 hotfix flow (branch → verify → review → merge → tag → deploy), then merges back.
6. **Verify.** Confirm recovery with evidence: health `status: healthy`, error rate back under 1%, p95 within SLO, synthetic monitor green, the `pipeline-failure` issue auto-closed. A fix is not done until observed.
7. **Communicate.** Update the incident note at each step and on resolution.

Schema-change caution during an incident: never `DROP` in a panic. Migrations are not trivially reversible — prefer rolling the app forward/back against an additive, backward-compatible schema and write a compensating migration with approval (core doc 20, and the disaster-recovery runbook).

---

# Escalation

1. **First responder** (on-call) owns the incident loop above.
2. **Escalate to the domain owner** when the root cause is identified and crosses a boundary: schema/RLS/auth/middleware/deploy → architect; payment flow → backend; AI tutor/RAG safety → ai-engineer; scoring/XP correctness → assessment; UI/portal → frontend.
3. **Escalate to leadership (CEO mode, core doc 28)** for any SEV-1, any payment/privacy breach, or any incident that requires a product-level decision (pricing impact, public communication, prolonged degradation).
4. **Cross-tier note:** the live tier is Vercel; do not attempt an AWS cutover as an incident response — the AWS path is dormant and a cutover is a deliberate, multi-day procedure (aws-operations runbook), not a mitigation.

---

# Post-Incident Handoff to RCA

Every SEV-1 and SEV-2 hands off to a root-cause analysis (core doc 23). Within the next business day after resolution, produce an RCA that records:

- **Timeline** — detection, acknowledgement, containment, correction, verification (with timestamps).
- **Impact** — users/roles affected, duration, SLO/error-budget burn, any invariant touched (P1–P15).
- **Root cause** — the true cause, distinguished from symptoms (core doc 23 — five-whys, not blame).
- **What worked / what was slow** — detection latency, mitigation effectiveness, escalation friction.
- **Corrective actions** — concrete, owned, dated; at minimum a **regression test** for the failure mode so it cannot recur silently (core doc 20's "record every rollback / add a regression check"). High-value failure modes are promoted into the regression catalog.
- **Evidence** — health output, Sentry links, run URLs, classified honestly as verified / observed / unverified.

The RCA is the closing artifact: an incident without a regression check is an incident that will return.

---

# Checklist

- [ ] SLO targets read from `src/lib/slo.ts` (not hardcoded elsewhere).
- [ ] Health endpoint `status` consulted first in every incident.
- [ ] Sentry events carry no PII (P13); logger redaction intact.
- [ ] Synthetic monitor and pipeline watcher both active and alerting.
- [ ] Severity assigned by impact (payment/privacy → SEV-1 regardless of count).
- [ ] Containment chosen before root-cause fix (rollback / flag-off / confirm degradation).
- [ ] Fix shipped through the full pipeline; no panic `DROP`; recovery verified with evidence.
- [ ] Escalation to the correct domain owner and to CEO mode for SEV-1.
- [ ] RCA produced for SEV-1/SEV-2 with a regression check as a corrective action.

---

# References

Core docs:
- `09_SECURITY_PROTOCOL.md` — privacy/PII handling that bounds what monitoring may capture.
- `20_DEPLOYMENT_PIPELINE.md` — health checks, rollback, and "verified before done."
- `22_DEBUGGING_PROTOCOL.md` — preserve evidence, never guess, minimal corrective action.
- `23_ROOT_CAUSE_ANALYSIS.md` — the post-incident RCA standard and regression-check requirement.
- `28_CEO_MODE.md` — leadership escalation and product-level decisions for severe incidents.
- `10_VERIFICATION_ENGINE.md` — every "healthy" claim requires a signal.

Extensions:
- `extensions/vercel.md` — live hosting, health-verification mechanics, instant rollback.
- `extensions/supabase.md` — the data-tier dependency probed by the health endpoint.

Repo:
- `src/lib/slo.ts`, `src/app/api/v1/health/route.ts`, `src/lib/logger.ts`, `.github/workflows/synthetic-monitor.yml`, `.github/workflows/pipeline-alert.yml`, `next.config.js`.

Related runbooks: github-operations (CI/CD + the pipeline watcher), disaster-recovery (data-loss and backup-restore), aws-operations (dormant failover posture).

---

# Final Directive

Measure reliability against the SLOs in `src/lib/slo.ts`, watch all five surfaces, and classify incidents by impact. Contain before you cure — roll back or flag off to stop the bleed, then fix through the pipeline and verify recovery with evidence. Close every serious incident with an RCA and a regression check: a failure mode without a test is a failure mode that will return.

**End of Document**
