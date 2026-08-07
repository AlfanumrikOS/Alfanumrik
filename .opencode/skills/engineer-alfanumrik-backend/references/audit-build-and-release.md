# Audit, Build, and Release

## Contents

1. Audit phases
2. Severity model
3. Finding format
4. Remediation planning
5. Build workflow
6. Verification matrix
7. Release evidence
8. Incident workflow
9. Completion standard

## 1. Audit phases

### Phase A — Scope and evidence

Record objective, environment, branch/commit, active project/deployment, authorization level, repository instructions, available logs/metrics, and excluded systems.

### Phase B — Inventory

Create route/API, Edge Function, RPC/function/trigger, hook/middleware, job/queue, schema/RLS, provider, feature-flag, health, and deployment inventories. Record counts from the current repository rather than repeating historical numbers.

### Phase C — Critical-path tracing

Trace auth, tenant isolation, event persistence, adaptive update, recommendation, Foxy/RAG, assignments, payments, and notification paths. Capture file and runtime evidence.

### Phase D — Security and integrity

Test RLS/grants, role relationships, service-role use, CORS/CSRF, validation, secrets, privileged functions, webhooks, migrations, constraints, logs, and data lifecycle.

### Phase E — Reliability and scale

Establish baselines, inspect query plans/connections/locks/queues/caches/providers, run focused load and failure tests, and document saturation and recovery.

### Phase F — Consolidation and target state

Select canonical owners, identify dead or duplicate paths, define compatibility, migration, rollout, rollback, observability, and acceptance criteria.

## 2. Severity model

| Severity | Definition | Examples |
| --- | --- | --- |
| Critical | Active or readily exploitable child-data, tenant-isolation, auth, payment, destructive-integrity, or widespread availability failure | Cross-tenant read/write, public service key, unsigned payment mutation, unrecoverable assessment loss |
| High | Primary learning path blocked, authoritative state false, strong exploit precondition, or likely outage under normal load | Swallowed mastery write, broken auth refresh, unbounded connection growth, ungrounded tutor bypass |
| Medium | Important secondary failure, scaling risk before forecast load, weak recovery, or costly drift | Duplicate routes, missing idempotency on non-critical job, stale flag, slow query with growing data |
| Low | Local maintainability, observability, documentation, or polish issue with limited immediate impact | Inconsistent error naming, unused non-sensitive config, minor metric gap |

Adjust severity using reachability, data sensitivity, blast radius, exploitability, frequency, detectability, recoverability, and current rollout. Do not inflate unproven hypotheses.

## 3. Finding format

Use this structure:

```text
ID and title
Severity and confidence
Affected actors, tenants, environments, and paths
Observed behavior
Expected invariant
Evidence: files, migration, query, test, log, metric, or trace
Root cause and contributing factors
Failure or exploit scenario
Recommended correction
Verification and regression test
Rollout, rollback, owner, and dependencies
```

Separate verified fact, inference, and unknown. Never claim live exposure from source alone when deployment/rollout is unknown.

## 4. Remediation planning

Prioritize:

1. Stop active security, data-loss, payment, and outage risks.
2. Restore observability for silent failures.
3. Repair primary learning and auth vertical slices.
4. Remove duplicate authoritative paths and contract drift.
5. Address measured performance bottlenecks.
6. Improve maintainability and documentation.

For complex programs, maintain:

- `MASTER_PLAN` — objectives, phases, exit criteria
- `TASK_LEDGER` — owner, scope, status, evidence
- `DECISION_LOG` — architectural decisions and consequences
- `DEPENDENCY_MAP` — interfaces and sequencing
- `CONFLICT_REGISTER` — overlapping writes and unresolved choices
- `RELEASE_EVIDENCE` — commands, results, artifacts, rollout and rollback

When multiple agents or engineers work in parallel, assign non-overlapping files/domains, require explicit handoffs, and run an integration review. Parallel output without ownership increases backend drift.

## 5. Build workflow

1. Create a failing regression or measurable baseline.
2. Confirm the canonical owner and contract.
3. Define invariants, threat cases, failure policy, capacity assumption, and compatibility.
4. Plan schema expansion/backfill/cutover/contraction when needed.
5. Implement one thin vertical slice.
6. Validate server-side auth, tenant scope, RLS, idempotency, concurrency, and errors.
7. Add structured telemetry and safe diagnostics.
8. Run local and staging verification with representative roles and data.
9. Review the diff for secrets, generated drift, dead paths, migration risk, and unrelated changes.
10. Prepare a controlled rollout and rollback.

Do not fix a backend issue only in the frontend. Do not make presentation code reproduce business or adaptive rules.

## 6. Verification matrix

Run applicable gates:

### Static and unit

- typecheck, lint, format, build
- unit tests for validation, domain invariants, adapters, retries, and redaction
- generated types/schema drift
- dependency and secret scanning available in the repository

### Contract and integration

- API request/response and error contracts
- provider adapters with failure and rate-limit cases
- database constraints and transactions
- migrations from clean and representative existing state
- Edge Function/RPC/trigger/job interactions
- feature-flag on, off, partial rollout, and fallback

### Security

- auth/session lifecycle
- role and relationship authorization
- cross-user and cross-tenant RLS matrix
- RPC/view/function grants and service-role boundaries
- CORS, CSRF, rate limits, upload/body limits
- webhook signature/replay/idempotency
- log redaction and secret rotation

### Reliability

- duplicate delivery and concurrent mutation
- timeouts, retries, circuit/fallback, queue replay, dead-letter
- cache loss/staleness and dependency outage
- database connection and lock behavior
- liveness, readiness, deep checks, and business synthetic

### Adaptive learning

- event-to-state-to-recommendation closed loop
- two-learner differentiation
- engine selection and persistence
- grounded-answer quality and refusal
- LLM cannot mutate or declare authoritative mastery

### Scale

- baseline, peak, stress, and soak as appropriate
- p50/p95/p99, throughput, errors, saturation, queue age, and cost
- forecast headroom and scaling trigger

Tests using mocks are necessary but not sufficient for runtime integration claims.

## 7. Release evidence

Require a release packet containing:

- scope, commit, environment, artifact, and migration IDs
- changed contracts and compatibility notes
- executed commands and unedited results
- RLS/authorization matrix results
- migration/advisor results and data verification
- focused and full regression results
- load/capacity scenario and metrics where scale is claimed
- live or staging vertical-path evidence
- dashboards, alerts, synthetics, and log/trace correlation
- feature-flag configuration and actual traffic verification
- canary/cohort result and expansion criteria
- rollback or roll-forward procedure and owner
- known risks, accepted exceptions, and reviewer sign-off

Do not declare production-ready from a plan, code diff, mocked test, or build alone.

## 8. Incident workflow

1. Confirm impact, severity, start time, affected actors/tenants, and current blast radius.
2. Preserve logs, traces, metrics, deploys, flags, provider status, migrations, and configuration evidence.
3. Stabilize using the safest reversible control: pause rollout, disable affected flag, shed load, route to a proven fallback, or stop a worker.
4. Protect data integrity before restoring convenience.
5. Verify recovery with synthetics and affected vertical paths.
6. Identify root and contributing causes without stopping at the first error.
7. Add regression, detection, runbook, ownership, and follow-up deadlines.

Do not rotate, delete, roll back data, or change production schemas during diagnosis without scoped authorization and a verified recovery plan.

## 9. Completion standard

The backend is complete for the requested scope only when:

- the canonical path is identified and duplicate authority is removed or governed
- authentication, authorization, tenant isolation, and data constraints are proven
- failure, retry, idempotency, concurrency, and recovery behaviors are defined and tested
- adaptive claims are verified through the real closed loop
- observability identifies cause and impact without leaking sensitive data
- measured capacity meets the stated target with headroom
- migrations, rollout, and rollback are safe and evidenced
- focused and full gates pass or failures are explicitly accepted by the authorized owner
- release evidence can be independently reproduced
