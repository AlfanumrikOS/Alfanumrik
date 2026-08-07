# Reliability and Scale

## Contents

1. Reliability objectives
2. Failure policy
3. Async work and idempotency
4. Database performance
5. Caching and rate control
6. Load and capacity testing
7. Observability and alerting
8. Deployment and recovery
9. Cost and provider resilience

## 1. Reliability objectives

Define service-level indicators before claiming scale:

- availability of critical learning and auth journeys
- successful event persistence and learner-state update rate
- p50/p95/p99 latency by route and dependency
- error, timeout, retry, and fallback rate
- queue age, depth, throughput, and dead-letter rate
- database connections, CPU, memory, I/O, locks, cache hit rate, and storage growth
- provider latency, quota, safety refusal, and cost
- RAG quality and grounding metrics

Alfanumrik has used 99.9% availability as a target. Convert it into scoped SLOs and an error budget; do not apply it indiscriminately to every background job.

Classify journeys:

- **Tier 0**: authentication, tenant isolation, learning-event writes, authoritative assessment state
- **Tier 1**: Today queue, assignments, mastery/recommendation updates, payment entitlements
- **Tier 2**: Foxy, RAG, notifications, analytics, enrichment

Define degraded behavior per tier. Safety, authorization, and data integrity must fail closed. Optional AI assistance may fail open only to a clearly declared safe non-AI path.

## 2. Failure policy

For each dependency define:

- connect, read, write, and total timeout
- which failures are transient
- maximum attempts, exponential backoff, jitter, and retry budget
- whether the operation is safe to retry
- circuit threshold and recovery probe
- concurrency and queue limits
- fallback and data-quality consequence
- client-visible error and recovery action
- alert and owner

Do not retry validation, authorization, quota-exhausted without reset, safety rejection, or permanent 4xx errors. Respect provider `Retry-After` where appropriate. Avoid synchronized retries and fallback storms.

Use bulkheads for AI providers, email, payments, vector search, analytics, and other dependencies so one saturation event does not exhaust application or database resources.

## 3. Async work and idempotency

Use durable asynchronous processing for work that is slow, bursty, rate-limited, or needs replay: notifications, embeddings, analytics projection, content processing, calibration, and non-blocking evidence tasks.

Each job should include:

- stable job and idempotency key
- tenant and actor scope
- schema/version and correlation/causation IDs
- attempt count and next-attempt time
- deterministic handler or safe compensation
- completion marker or unique outcome constraint
- dead-letter reason and replay controls

Prefer transactional outbox or an equivalent atomic handoff when a database write and event publication must not diverge. Consumers must tolerate duplicates and out-of-order delivery or enforce ordering per aggregate.

Do not make an authoritative mastery write best effort. If it cannot commit, record and surface a recoverable failure rather than returning false success.

## 4. Database performance

Start with measured workload and query plans.

- Use Supavisor or appropriate pooling for deployment style. Account for PostgREST, Auth and other Supabase consumers before allocating connection capacity.
- Avoid creating a connection per request or per serverless invocation.
- Monitor active, idle, waiting, and saturated connections; cap application pools.
- Use `pg_stat_statements`, database advisors, slow-query logs, and `EXPLAIN (ANALYZE, BUFFERS)` safely in non-production or with bounded production use.
- Index frequently filtered and joined columns, foreign keys, tenant/owner fields used by RLS, and stable cursor ordering.
- Avoid N+1 access. Batch, join, or use authorized RPCs when they reduce round trips without creating privileged monoliths.
- Use cursor/keyset pagination for deep or high-volume lists.
- Keep transactions short and acquire locks in consistent order.
- Use optimistic concurrency, compare-and-set, advisory locks, or queue serialization according to the invariant.
- Monitor autovacuum, bloat, dead tuples, table/index size, hot updates, lock waits, and deadlocks.
- Partition high-volume time-series learning events only when size, retention, and query patterns justify the operational complexity.

Vector search requires separate measurement of recall/quality, candidate count, filter selectivity, index type, memory, build time, update frequency, and latency. A lower similarity threshold can improve recall while harming grounding; tune with an evaluation set.

## 5. Caching and rate control

Cache only data with defined ownership, freshness, invalidation, and authorization scope.

- Include tenant, learner, locale, content version, policy, and role in keys when they change results.
- Never share personalized or authorized results through under-scoped cache keys.
- Use bounded TTLs plus explicit invalidation for critical changes.
- Prevent cache stampedes with request coalescing, jittered expiry, or locks.
- Define behavior for cache outage and stale reads.
- Do not cache authoritative mutation success before commit.

For Upstash Redis or similar services, define command timeout, pool/connection behavior, key cardinality, eviction policy, regional latency, rate limits, and observability.

Rate-limit by risk and resource: actor, tenant, learner, API key, device/session, route, provider budget, and sometimes IP. Support legitimate school-network bursts while blocking abuse and runaway clients.

## 6. Load and capacity testing

Create a workload model with:

- registered and daily active learners
- peak concurrent sessions and school-start bursts
- reads/writes per learning minute
- answer, hint, event, recommendation, Foxy, retrieval, notification, and admin mix
- payload and response sizes
- dataset scale and tenant skew
- cache-warm and cache-cold cases
- provider and database limits

Test in phases:

1. Baseline single-user correctness.
2. Component benchmark for suspected bottlenecks.
3. Gradual load to expected peak.
4. Stress to identify saturation and safe rejection.
5. Soak for leaks, queue growth, bloat, and latency drift.
6. Failure injection for database, cache, AI provider, email, payment, and network degradation.
7. Recovery and replay after dependency restoration.

Use representative authenticated tenants and realistic data distribution. Verify tenant isolation under concurrency. Record environment, commit, configuration, dataset, tool, scenario, p50/p95/p99, throughput, error rate, resource saturation, provider cost, and bottleneck.

Do not extrapolate capacity linearly past observed saturation without a model and safety margin.

## 7. Observability and alerting

Use structured logs, metrics, traces, and audit events with a shared correlation ID.

### Logs

Record route/job, tenant-safe identifier, actor class, status, duration, dependency category, attempt, error code, rollout flag, and trace ID. Redact answers, prompts, tokens, secrets, full names, emails, phone numbers, voice, and provider payloads by default.

### Metrics

Use low-cardinality labels. Track RED metrics for services, database/query saturation, queue health, cache, external providers, adaptive pipelines, and business synthetics.

### Traces

Trace server, Edge Function, database/RPC, cache, queue, vector search, and AI-provider spans. Avoid attaching sensitive content.

### Alerts

Alert on user-impacting symptoms and error-budget burn, not every log line. Each alert needs severity, owner, runbook, safe diagnostic query, and escalation. Test alert delivery.

Never swallow an authoritative write error. A request can degrade, retry, or fail explicitly, but telemetry must preserve the causal chain.

## 8. Deployment and recovery

- Keep environments and project references explicit; prevent production/staging mix-ups through validation and protected credentials.
- Build immutable artifacts and record version, migration set, feature-flag state, and configuration schema.
- Separate schema expansion from code cutover and contraction.
- Use canary, cohort, or percentage rollout for risky paths; verify actual traffic reaches the new code.
- Define automated rollback triggers and a roll-forward path for irreversible data changes.
- Run post-deploy synthetics and inspect live metrics before expanding rollout.
- Test backup restore, point-in-time recovery, queue replay, cache loss, secret rotation, and regional/dependency failure.
- Preserve incident timelines, contributing factors, corrective owners, and regression tests.

Kubernetes, ECS, or microservices do not create reliability automatically. Verify probes, resource requests/limits, autoscaling metrics, disruption budgets, graceful shutdown, connection draining, job uniqueness, secret delivery, and dependency topology when those platforms are present.

## 9. Cost and provider resilience

Track cost per learner, learning session, answer, Foxy interaction, embedding, retrieval, model token, email, and stored event where relevant.

- Set budgets and anomaly alerts.
- Use provider routing based on pedagogical need, quality, safety, latency, and cost—not cost alone.
- Cache embeddings by normalized content and model/version when legally and semantically safe.
- Limit context, candidate counts, output tokens, and retries.
- Preserve a safe fallback and disclose degraded quality.
- Evaluate fallback providers independently; a fallback that is never tested is not resilience.
