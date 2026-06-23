# 20_DEPLOYMENT_PIPELINE.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Mandatory Deployment Engineering Standard
**Priority:** Critical
**Applies To:** Every promotion of code or configuration from one environment to another, every build, every release artifact, every infrastructure change, and every post-deployment validation performed under the AEOS.

---

# Purpose

This document defines the deployment engineering standard for the AEOS.

It governs how software moves from a developer's change to a running, verified production system. It establishes the environments, the pipeline gates, the build-verify-deploy-validate flow, the handling of configuration and secrets, health checks, progressive rollout, rollback, and the evidence every deployment must produce.

Deployment is one of the highest-risk activities in engineering. A flawed deployment can expose data, corrupt state, or take down the live system. This standard exists to make deployment safe, repeatable, and provable.

This is a **core, platform-agnostic** standard. Concrete provider mechanics (for the current project: a specific cloud region, function timeout values, dashboard rollback controls, and the like) belong in the AEOS extensions layer (`AEOS/docs/extensions/`). The principles here apply regardless of provider.

---

# Deployment Philosophy

The governing principle of this document:

> **A deployment is incomplete until it is verified in the target environment.**

Pushing an artifact is not a deployment. Starting a process is not a deployment. A deployment is complete only when the target environment has been observed serving correct behavior, supported by evidence.

Three corollaries follow:

1. **No silent deployments.** Every deployment produces a record of what changed, where it went, and how it was verified.
2. **No unverifiable deployments.** If a deployment cannot be validated post-hoc, it is not permitted to production.
3. **No irreversible deployments without a plan.** Every deployment must have a known, rehearsed path back to the prior good state.

This philosophy is a direct application of the Verification Engine (document 10): expectation is not evidence, and "deployed" is a claim of fact that requires proof.

---

# Environments

The AEOS recognizes three standard environments. A project may add more, but these three are mandatory and must be isolated from one another.

## Development

* Purpose: active engineering and integration of in-progress work.
* Data: synthetic or anonymized only. Never production data.
* Stability: expected to be unstable; breaking changes are normal here.
* Access: broad among engineers.

## Staging

* Purpose: a production-like environment for final verification before release.
* Data: anonymized production-shaped data, or a sanitized clone. Never raw production PII.
* Stability: must mirror production configuration, topology, and constraints as closely as practical.
* Access: restricted; changes arrive through the pipeline, not by hand.

## Production

* Purpose: the live system serving real users.
* Data: real user data, fully protected.
* Stability: changes are deliberate, gated, reversible, and evidence-backed.
* Access: most restricted. No manual changes outside the pipeline except documented break-glass procedures.

## Environment Parity

The closer staging mirrors production, the more a passing staging run predicts a safe production run. Configuration drift between environments is a defect. Differences that cannot be eliminated must be documented so their risk is understood.

---

# The Deployment Flow

Every deployment follows the same four-phase flow. No phase may be skipped, and each phase gates the next.

```text
Build
        v
Verify
        v
Deploy
        v
Post-Deploy Verification
```

## Phase 1 — Build

* Produce a deterministic, reproducible artifact from a known commit.
* The artifact is immutable; the same artifact is promoted across environments. Never rebuild per environment, as that reintroduces variance.
* The build must fail closed: any build error stops the pipeline.

## Phase 2 — Verify

* Run the full quality gate suite against the artifact and its source before any environment receives it.
* This is static and dynamic verification: compilation, type checking, linting, unit tests, integration tests, security scanning, and bundle or size budgets where applicable.
* Verification failure stops promotion. There is no override that ships unverified code to production.

## Phase 3 — Deploy

* Promote the already-verified, immutable artifact into the target environment.
* Apply configuration for that environment from externalized config, not from the artifact.
* Apply database and schema migrations in a controlled, ordered, idempotent manner before or alongside the application change, per the database engineering standard.
* Use a progressive strategy where the platform supports it (see Progressive Rollout).

## Phase 4 — Post-Deploy Verification

* Observe the running target environment.
* Run health checks, smoke tests, and where appropriate a small set of critical-path end-to-end checks.
* Confirm key metrics (error rate, latency, saturation) are within expected bounds.
* Only after this phase succeeds is the deployment declared complete.

---

# CI/CD Gates

The pipeline is the single sanctioned path to production. Manual deployment to production is prohibited except under a documented break-glass procedure.

Mandatory gates, in order:

1. **Secret scan** — block the pipeline if credentials, keys, or tokens appear in the change.
2. **Type / compilation check** — exit zero required.
3. **Lint** — exit zero required; no disallowed log statements in production code.
4. **Unit and integration tests** — all pass; regression coverage for invariant-touching changes confirmed to exist, not merely assumed.
5. **Build** — produce the immutable artifact; honor any size or bundle budgets.
6. **End-to-end checks** — run critical-path E2E on pull requests and before production promotion.
7. **Post-deploy health check** — run automatically after promotion to a live environment.

Gate rules:

* Gates run in sequence; a failure stops the pipeline.
* Gates are fail-closed. The absence of a passing result is treated as a failure, never as a pass.
* Production promotion requires every prior gate green and explicit release authorization per document 21.

---

# Configuration and Secrets Handling

Configuration is externalized; it never lives in the build artifact and never in source control.

Rules:

* **Externalize all environment-specific values.** The same artifact must run in dev, staging, and production with only configuration differing.
* **Validate configuration at startup.** A service must refuse to start with missing or malformed required configuration rather than running in a degraded, surprising state.
* **Secrets are never in source.** API keys, tokens, signing secrets, and credentials live only in the platform's secret manager or equivalent, injected at deploy or runtime.
* **Least privilege for every secret.** Each environment uses its own credentials, scoped to the minimum capability needed. Production secrets never appear in development or staging.
* **No privileged secret crosses to a client surface.** Service-role and admin credentials are server-only and must never be embedded in client-shipped configuration.
* **Rotation is a first-class operation.** Secrets must be rotatable without a code change. Document the rotation procedure in a runbook.

This section enforces the constitutional Prime Directive of least privilege (document 00) and the security protocol (document 09). Concrete secret-store mechanics are an extensions concern.

---

# Health Checks

Every deployable service must expose a health signal the pipeline and operators can read.

* **Liveness** — is the process up and responsive?
* **Readiness** — is the service ready to serve traffic (dependencies reachable, migrations applied, configuration valid)?
* **Dependency health** — can the service reach its critical downstreams (database, cache, external providers)?

Health checks are consumed at two points:

1. Immediately after deployment, as the gate that declares Phase 4 success or failure.
2. Continuously in production, feeding monitoring and alerting per the operational standard.

A deployment whose health checks do not pass is not complete and must trigger rollback.

---

# Progressive Rollout

Where the platform supports it, production changes are rolled out progressively rather than all at once. This limits the blast radius of an undetected defect.

Common strategies, from least to most conservative:

* **Rolling** — replace instances incrementally, watching health between batches.
* **Canary** — route a small fraction of traffic to the new version, observe, then widen.
* **Blue-green** — stand up the new version in parallel, shift traffic atomically, keep the old version warm for instant rollback.

Rules for progressive rollout:

* Define explicit promotion criteria (error rate, latency, key business metrics) before starting.
* Define explicit abort criteria. If the new version breaches them, halt and roll back automatically where possible.
* Feature flags complement rollout: ship code dark, then enable behavior gradually and reversibly (see document 21).
* Never widen a rollout while any abort criterion is breached.

The choice of strategy and its concrete configuration is platform-specific and belongs in extensions; the requirement to limit blast radius is universal.

---

# Rollback Strategy

Every production deployment must have a rollback plan that is known before the deployment begins.

Principles:

* **Forward is preferred, backward is guaranteed.** Prefer rolling forward with a fix when safe, but a clean path back to the last known-good state must always exist.
* **Rollback must be fast.** Keep the prior artifact available so reverting is a promotion, not a rebuild.
* **Schema changes are special.** Database migrations are not trivially reversible. Prefer additive, backward-compatible migrations so the application can roll back without the schema rolling back. Never drop tables or columns in a panic; write a compensating migration instead, with approval.
* **Decouple deploy from release.** Using feature flags, code can be deployed without being active, so disabling a flag is itself a rollback that needs no redeploy.
* **Rehearse rollback.** A rollback path that has never been exercised is a hypothesis, not a plan.
* **Record every rollback.** Capture what failed, what was reverted, and the regression that will prevent recurrence.

---

# Deployment Evidence Requirements

Per the Verification Engine, a deployment claim requires evidence. Every production deployment must record:

* the exact commit and immutable artifact identifier deployed,
* the target environment,
* the result of every CI/CD gate (with outputs, not summaries),
* the migrations applied and their result,
* the configuration and secret references resolved (references, never secret values),
* post-deploy health check and smoke test results,
* key post-deploy metrics within the observation window,
* the rollout strategy used and, if progressive, the promotion decisions made,
* the rollback plan that was in place,
* the human authorization for the production promotion.

Evidence must be classified honestly: **verified** (executed and observed), **observed** (confirmed by inspection), or **unverified** (could not be confirmed). A deployment with unverified critical evidence is not complete.

---

# Failure Handling During Deployment

When a deployment fails at any phase:

1. Stop further promotion immediately.
2. Preserve logs and the failing state for diagnosis.
3. Execute the rollback plan if the live environment is affected.
4. Identify the root cause; do not retry blindly.
5. Implement and verify the correction through the full pipeline.
6. Add a regression check for the failure mode.
7. Record the incident and resolution per the operational standard.

Concealing a failed or partial deployment is a constitutional violation. Report it.

---

# Deployment Readiness Checklist

Confirm each item before promoting to production. Use '-' for each check.

- The artifact is built from a known commit and is immutable across environments.
- Every CI/CD gate passed with evidence: secret scan, type check, lint, tests, build, E2E.
- Regression coverage exists for any product-invariant-touching change (confirmed, not assumed).
- Staging verification ran against production-like configuration and passed.
- All required configuration is externalized and validated at startup.
- No secret appears in source or in any client-shipped artifact; least privilege confirmed.
- Database migrations are ordered, idempotent, and backward-compatible (or have a compensating plan).
- Health checks (liveness, readiness, dependency) are implemented and observed passing.
- A progressive rollout strategy with explicit promote and abort criteria is defined where supported.
- A fast, rehearsed rollback path to the last known-good state exists.
- Post-deploy verification (health, smoke, critical E2E, key metrics) is planned and will be executed.
- Human release authorization is in place per document 21.
- Deployment evidence will be recorded and classified honestly.

If any item fails, the deployment is not ready. Do not promote.

---

# References

* `00_AI_CONSTITUTION.md` — The supreme charter; this standard derives from the verification, security, and evidence values.
* `08_TESTING_PROTOCOL.md` — The verification suite that runs as the pipeline's quality gates.
* `09_SECURITY_PROTOCOL.md` — Secret handling, least privilege, and security gating requirements.
* `10_VERIFICATION_ENGINE.md` — The evidence and execution protocol underlying "deployment is incomplete until verified."
* `11_GIT_WORKFLOW.md` — Branching and commit discipline that feeds the pipeline.
* `12_AWS_INFRASTRUCTURE.md` — Infrastructure-as-code foundations; concrete provider mechanics live in extensions.
* `21_RELEASE_MANAGEMENT.md` — Release types, sign-off gates, feature flags, and post-release monitoring that wrap this pipeline.
* `AEOS/docs/extensions/` — Provider-specific deployment mechanics (region, timeouts, dashboard controls, secret stores).

---

# Final Directive

Deployment is where engineering meets reality. Until the change is observed running correctly in the target environment, with evidence, nothing has been delivered.

Build deterministically. Verify exhaustively. Deploy progressively. Validate honestly. Keep the road back open at all times.

A deployment you cannot verify is a deployment you cannot trust — and an untrusted change must never reach production.

**End of Document**
