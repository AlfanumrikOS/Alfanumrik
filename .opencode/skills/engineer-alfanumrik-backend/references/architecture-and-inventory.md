# Architecture and Inventory

## Contents

1. Audit objective
2. Required inventory
3. Dependency and trust maps
4. Vertical-path tracing
5. Duplication and drift
6. Health model
7. Architecture decision rules

## 1. Audit objective

Establish what is reachable, authoritative, duplicated, dead, misconfigured, or unobserved. Do not begin by rewriting files whose runtime ownership is unknown.

Distinguish:

- source exists
- compiles
- deploys
- route or job is reachable
- selected by feature configuration
- authorized correctly
- persists expected state
- affects the learner experience
- survives failure and load

Record evidence for each state. An enabled feature with 0% rollout is not live. A successful function deployment with no caller is not integrated.

## 2. Required inventory

Inventory these categories with path, runtime, owner, caller, environment, contract, auth model, data access, side effects, observability, tests, flags, and status:

### Application entry points

- Next.js route handlers, legacy API routes, server actions, middleware, and webhooks
- Supabase Edge Functions and shared Deno modules
- REST/Data API tables and views
- Postgres RPCs, functions, triggers, auth hooks, and database webhooks
- scheduled jobs, Supabase Cron, queue consumers, CI jobs, and one-off workers
- Python or other AI/ML services and scripts
- health, diagnostics, admin, internal, and support routes

### State and infrastructure

- Postgres schemas, tables, views, materialized views, extensions, indexes, constraints, policies, grants, publications, and partitions
- Supabase Auth, Storage buckets/policies, Realtime channels/policies, Vector/pgvector, Queues, and Vault usage
- Upstash Redis or other caches, locks, rate limits, and ephemeral session state
- object storage, logs, analytics, event streams, and backups
- Vercel, ECS/ECR/ALB/CloudFront, Kubernetes, cron runners, and regional dependencies actually present

### External providers

- OpenAI, Anthropic, Gemini, Voyage, Mailgun, Razorpay, PostHog, Sentry, and any provider discovered in code
- base URLs, API versions, server-only secret names, retry/timeout behavior, rate limits, fallbacks, data sent, and error handling

### Configuration

- environment-variable schema and validation
- project references and region
- feature-flag registries, rollout rules, defaults, and stale flags
- generated database types and API schemas
- tenant branding/configuration that changes backend behavior

Never print secret values. Detect missing, duplicated, stale, whitespace-corrupted, multiline, mis-scoped, or client-exposed secrets safely.

## 3. Dependency and trust maps

Produce two maps when the system is non-trivial.

### Dependency map

For each entry point, map domain service, database objects, caches, jobs, providers, emitted events, and downstream consumers. Mark synchronous versus asynchronous boundaries.

### Trust-boundary map

Mark:

- browser, mobile app, server, Edge Function, database, worker, and external provider boundaries
- anonymous, authenticated, teacher, parent, learner, school admin, super admin, service, and scheduled actors
- B2B tenant and B2C ownership boundaries
- where JWTs, cookies, service keys, webhook secrets, and provider credentials are accepted
- where child data, answers, voice, free text, embeddings, and learning evidence cross systems

Use the maps to identify authorization gaps, circular dependencies, hidden service-role bypasses, and blast radius.

## 4. Vertical-path tracing

Trace at least one path from each critical class:

1. Student sign-in and session refresh.
2. Today recommendation retrieval.
3. Quiz answer submission through learning-event persistence and mastery update.
4. Teacher assignment creation and student completion.
5. Parent or teacher insight read with tenant and relationship checks.
6. Foxy grounded answer with retrieval, safety, model routing, and evidence.
7. Razorpay webhook to subscription state.
8. Email or notification job to delivery and retry outcome.

At every hop, capture input validation, identity, tenant, transaction, failure behavior, telemetry, and returned contract.

## 5. Duplication and drift

Search for:

- duplicate or near-duplicate routes, RPCs, functions, hooks, middleware checks, clients, schemas, flags, and health endpoints
- old and new namespaces serving the same capability
- generated types that do not match migrations
- migrations without corresponding runtime usage
- comments, docs, tests, and feature matrices that disagree with code
- providers instantiated in multiple inconsistent ways
- swallowed errors or silent fallbacks that keep requests green
- legacy code selected by import aliases, rewrites, or flags

Classify each duplicate as intentional compatibility, staged migration, divergent business behavior, or accidental duplication. Name the canonical owner before consolidation. Preserve backward compatibility or provide a measured cutover.

Known Alfanumrik history includes duplicated admin routes, multiple health routes, large notification orchestration, overlapping feature-flag systems, and documentation drift. Treat these as hypotheses to verify, not permanent counts.

## 6. Health model

Standardize health semantics:

- **Liveness**: process can answer; no downstream calls.
- **Readiness**: instance can serve required traffic; bounded checks for critical dependencies.
- **Deep diagnostic**: authenticated/internal and rate-limited; richer dependency details without secrets.
- **Business synthetic**: external monitor exercises a representative safe journey.

Return JSON with stable status, service, version, environment, timestamp, and dependency categories. Do not expose credentials, internal hostnames, schema details, or raw provider errors publicly.

Do not let a healthy frontend HTML response masquerade as backend health. Define ownership for `/api/health` or its equivalent and eliminate ambiguous duplicates through migration.

## 7. Architecture decision rules

- Prefer domain modules with explicit contracts over layer-spanning utility files.
- Keep one authoritative implementation per capability and temporary adapters for migration.
- Keep database access behind server-authorized boundaries unless a deliberately exposed Data API path uses correct grants and RLS.
- Prefer asynchronous work for slow or failure-prone side effects that need durable retry.
- Prefer event facts and rebuildable projections for high-volume learning activity.
- Introduce a separate service only for justified ownership, scaling, isolation, runtime, or release needs.
- Record significant changes in an ADR with context, decision, consequences, migration, and rollback.
