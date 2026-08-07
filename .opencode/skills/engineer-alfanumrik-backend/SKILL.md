---
name: engineer-alfanumrik-backend
description: Audit, design, build, repair, secure, test, and scale the Alfanumrik backend. Use for APIs, Next.js route handlers and server actions, Supabase Auth/Postgres/RLS/RPCs/Edge Functions/Storage/Realtime/Cron/Queues, hooks, middleware, database functions and triggers, webhooks, caching, feature flags, adaptive-learning engines, Foxy services, RAG/vector search, AI-provider integrations, payments, email, observability, migrations, incidents, load testing, deployment readiness, architecture reviews, backend duplication, and production-hardening work.
compatibility: opencode
---

# Engineer Alfanumrik Backend

Build an evidence-driven, multi-tenant backend that preserves learning data, isolates schools and learners, explains adaptive decisions, degrades safely, and scales under measured load. Treat “foolproof” as defense in depth with verified recovery—not as a claim of zero possible failure.

## Load the right references

- Read [references/architecture-and-inventory.md](references/architecture-and-inventory.md) for every repository audit, architecture task, dependency trace, consolidation, or health review.
- Read [references/security-and-data-integrity.md](references/security-and-data-integrity.md) for auth, tenant scope, RLS/RBAC, middleware, secrets, migrations, webhooks, storage, payments, or personal data.
- Read [references/reliability-and-scale.md](references/reliability-and-scale.md) for performance, concurrency, caching, queues, retries, observability, capacity, deployment, or incidents.
- Read [references/adaptive-learning-backend.md](references/adaptive-learning-backend.md) for Foxy, learner events, mastery, IRT, BKT/DKT, CME, SRS, recommendations, curriculum graphs, RAG, embeddings, or LLM routing.
- Read [references/audit-build-and-release.md](references/audit-build-and-release.md) before implementing changes, assigning severity, planning remediation, or declaring production readiness.

Inspect repository instructions, source, migrations, types, generated schemas, infrastructure, runtime configuration, logs, tests, current official documentation, and user-provided evidence when available. Treat functioning code and newer user decisions as authoritative. Label inference.

For Supabase work, check the current Supabase changelog for relevant breaking changes, then consult official documentation before changing configuration, libraries, migrations, RLS, Edge Functions, or CLI workflows. Discover CLI commands with `--help`; do not guess flags.

## Choose the operating mode

Use the smallest mode that satisfies the request:

1. **Reconnaissance** — inventory the backend and produce the dependency and trust-boundary maps.
2. **Audit** — trace live behavior, identify failures and risks, and prioritize evidence-backed findings.
3. **Design** — define domain boundaries, contracts, data ownership, failure policy, capacity model, and migration path.
4. **Build or repair** — implement a thin, reversible vertical slice and prove it across layers.
5. **Incident** — stabilize, preserve evidence, identify blast radius and cause, recover safely, and prevent recurrence.
6. **Release** — run focused and full gates, verify rollout and observability, and produce release evidence.

A request to review or assess does not authorize production mutations. A request to build authorizes local or scoped repository changes and safe verification, not destructive production data changes or silent deployment.

## Start with read-heavy reconnaissance

Before editing:

1. Read repository instructions and inspect the working tree without overwriting unrelated changes.
2. Identify the active environment, Supabase project, deployment target, branch, region, and feature-flag state from real configuration. Never select a project from memory alone.
3. Enumerate all backend entry points, data stores, jobs, provider clients, secret names, and deployment units.
4. Generate or update a route/function/RPC inventory and a dependency map.
5. Identify duplicate, legacy, unreachable, shadow, or conflicting paths.
6. Trace one representative request end to end, including auth, tenant scope, data access, side effects, external calls, telemetry, and response.
7. Establish a baseline using tests, logs, query plans, latency, error rate, connection usage, and load when available.

Do not equate a green build, passing mock, deployed function, enabled flag, or HTTP 200 with correct live behavior.

## Enforce backend boundaries

Use explicit ownership:

- Route handlers and Edge Functions own transport concerns, not business truth.
- Domain services own invariants and orchestration.
- Postgres constraints, transactions, grants, and RLS protect data at the lowest practical layer.
- Adaptive engines own mastery and recommendation decisions; presentation layers and LLMs do not.
- Provider adapters isolate OpenAI, Anthropic, Gemini, Voyage, Mailgun, Razorpay, Redis, and other external contracts.
- Events record durable learning facts; projections and analytics remain rebuildable where practical.

Prefer a well-modularized deployable system before introducing networked microservices. Split services only when data ownership, independent scaling, failure isolation, security, or team ownership justifies the operational cost.

## Trace contracts, not filenames

For every API, hook, function, middleware layer, RPC, trigger, job, queue consumer, or webhook, identify:

- caller and authorized actor
- transport and versioned input contract
- authentication, tenant scope, and capability check
- validation and canonical identifiers
- domain owner and transaction boundary
- reads, writes, emitted events, and external side effects
- idempotency, ordering, retry, timeout, and cancellation policy
- cache behavior and invalidation
- error contract and safe client message
- logs, metrics, traces, alerts, and audit trail
- tests, rollout flag, owner, and deprecation state

Reject implicit contracts, swallowed errors, best-effort writes to authoritative state, and duplicate implementations without a migration owner.

## Secure before scaling

Apply defense in depth:

- Authenticate server-side and authorize every operation by tenant, actor, relationship, and capability.
- Enforce RLS and explicit grants on exposed Supabase objects; UI hiding and middleware alone are not authorization.
- Keep service-role and secret keys server-only and narrowly scoped.
- Validate exact allowed origins, webhook signatures, CSRF protections, content type, body size, and rate limits where applicable.
- Use database constraints and atomic transactions for authoritative invariants.
- Minimize child and learner data, redact logs, and preserve auditable access and consent boundaries.
- Treat AI output and retrieved content as untrusted input.

Never weaken RLS, add `SECURITY DEFINER`, broaden CORS, expose a secret, disable validation, or suppress an error merely to make a failing path pass.

## Build for safe failure

Every network and asynchronous boundary must define:

- finite timeouts
- bounded retries with backoff and jitter only for safe transient failures
- idempotency and deduplication
- concurrency limits and backpressure
- circuit-breaking or dependency isolation where failure cascades are possible
- dead-letter, replay, compensation, or human recovery for durable work
- explicit fallback quality and provenance
- observable failure without personal data leakage

Keep database transactions short. Do not hold locks while calling AI, payments, email, embeddings, or other remote services.

## Prove scale with measurements

Define workload assumptions before recommending scale changes: active learners, interaction rate, peak concurrency, payload size, event volume, latency target, availability target, retention, provider limits, and cost ceiling.

Use query plans and runtime statistics to find bottlenecks. Audit connection pools, RLS predicates, indexes, foreign keys, N+1 access, pagination, hot rows, lock order, vacuum, storage growth, vector indexes, cache hit rate, and large event-table lifecycle. Partition only when observed or forecast data volume justifies it.

Load-test representative authenticated multi-tenant flows, not a health endpoint alone. Report test shape, environment, dataset, p50/p95/p99 latency, throughput, error rate, saturation, bottleneck, and cost signal.

## Preserve adaptive-learning truth

Require a closed loop:

`authorized event -> validated learning evidence -> learner-state update -> explainable recommendation -> learning action -> new evidence`

Prove that BKT/DKT, IRT, CME, spaced repetition, curriculum prerequisites, Foxy context, and RAG are wired into real runtime paths before claiming personalization. The LLM may explain, teach, and suggest; it must not declare authoritative mastery, grades, or interventions.

## Implement in vertical slices

For build or repair work:

1. Reproduce the failure or define a measurable acceptance test.
2. Identify the owning layer and root cause.
3. Design the contract, failure policy, migration, rollout, and rollback before code.
4. Make the smallest coherent end-to-end change.
5. Test unit, integration, contract, authorization, RLS, concurrency, and failure paths as applicable.
6. Run focused gates, then broader regression, typecheck, lint, build, advisors, and migration checks.
7. Exercise the runtime path with authorized real or representative data.
8. Verify metrics, logs, alerts, rollout percentage, and rollback readiness.

Never rewrite applied migrations. Use forward fixes and a tested recovery plan. Never apply destructive schema or production data operations without explicit authorization and verified backups or reversibility.

## Produce evidence-backed outputs

Lead an audit with the verdict. For every finding provide severity, affected path, user or business impact, file/runtime evidence, root cause, exploit or failure scenario, and recommended correction.

For a design, include current-state map, target boundaries, contracts, data ownership, failure model, capacity assumptions, migration phases, compatibility, observability, and acceptance criteria.

For implementation, identify changed files, migrations, tests, commands, runtime evidence, remaining risks, rollout, and rollback. Never report “production-ready” without the release evidence defined in the references.

## Protect product scope

Keep transport management and generic school fee/accounting ERP outside the Alfanumrik core. Permit only platform subscriptions, tenant billing, Razorpay payments, and explicitly approved integrations. Preserve B2B white-label school isolation and the separate B2C access model.
