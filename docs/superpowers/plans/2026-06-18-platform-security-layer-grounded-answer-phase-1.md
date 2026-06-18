# Platform Security Layer for Edge Functions

> **For agentic workers:** implement in phases. Phase 1 covers `grounded-answer` only. Later phases reuse the same helpers and schema without redesigning the contract.

**Goal:** Build a reusable Supabase/Postgres-backed platform security layer for Edge Functions with durable auth, attribution, quota enforcement, audit logging, signed internal caller requests, circuit breakers, tenant AI budgets, and role-aware enforcement modes. `grounded-answer` is the first adopter.

**Scope for Phase 1:** `supabase/functions/grounded-answer/*`, new reusable helpers under `supabase/functions/_shared/security/*`, and one new Supabase migration.

**Design constraints:**
- Durable enforcement only in Postgres/Supabase.
- No in-memory counters or local caches for decisions.
- No wildcard CORS.
- No prompt, bearer token, or PII payload storage in audit rows.
- Internal callers must be explicitly registered and signed.
- Every request must be attributable to `user_id`, `service name`, `cron job`, or `internal worker`.

---

## Architecture

```text
Client / internal job
        |
        v
 Edge Function entrypoint
   |   |   |
   |   |   +-- CORS policy (exact origins only)
   |   +------ Auth / caller verification
   |   +------ Attribution extraction
   |   +------ Structured request validation
   |   +------ Quota reservation / settlement
   |   +------ Circuit breaker check
   |   +------ Audit log write
        |
        v
   grounded-answer pipeline
        |
        v
  Supabase/Postgres RPCs
   - resolve principal
   - validate internal caller
   - resolve route policy
   - reserve quota
   - settle quota
   - record audit event
   - evaluate circuit state
        |
        v
  Policy tables / audit tables / usage tables
```

### Enforcement modes

| Mode | Behavior | Intended use |
|---|---|---|
| `enforce` | Hard fail on auth, quota, and policy violations | Production default |
| `shadow` | Evaluate policy, log decisions, but do not block successful request paths | Controlled rollout / verification |
| `observe` | Log only; no quota reservation or enforcement | Early migration validation |
| `disabled` | No security layer behavior | Local dev and emergency rollback only |

Phase 1 ships `enforce` for `grounded-answer` public callers and trusted internal callers, with `observe` and `shadow` available for rollout toggles in policy rows.

### Circuit breakers

Circuit breakers live in Postgres as durable route-scoped state. They protect against:
- repeated upstream AI failures,
- runaway spend,
- malformed bursts,
- compromised service-role callers issuing high-volume requests.

Breaker dimensions:
- `route`
- `school_id`
- `role`
- `caller_type`
- optional `internal_caller_id`

Breaker actions:
- `closed` -> normal operation
- `open` -> immediate reject
- `half_open` -> limited probe traffic

### Tenant AI budgets

Budgets apply at tenant scope and do not bleed across schools.
Track by:
- `school_id`
- `role`
- `route`
- `budget_period` (`daily`, `monthly`)

Budget metrics:
- request count
- estimated input tokens
- estimated output tokens
- estimated cost

When a budget is exhausted:
- public callers are blocked,
- authenticated users continue only if an explicit policy grants a higher role tier,
- internal callers consume from their own quota profile and never from tenant budgets unless the policy explicitly attaches the route to that school.

### Signed internal caller requests

Internal calls require all of:
- `Authorization: Bearer <service-role token>`
- `x-internal-caller: <registered caller id>`
- `x-internal-signature: <HMAC or Ed25519 signature over canonical request>`
- `x-request-id` or server-generated request id

Signed internal requests bind:
- method
- path
- body hash
- timestamp
- caller id

This prevents anonymous service-role use and makes replay/rate-abuse materially harder.

---

## Final Schema

### 1. `security_internal_callers`

Registered internal callers.

Columns:
- `id uuid pk`
- `name text not null`
- `owner text not null`
- `description text not null`
- `status text not null` (`active`, `paused`, `revoked`)
- `quota_profile_id uuid not null`
- `service_name text not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

### 2. `security_quota_profiles`

Reusable quota profiles by role / caller class.

Columns:
- `id uuid pk`
- `name text not null`
- `scope text not null` (`public`, `authenticated`, `internal_service`, `tenant`)
- `role text null`
- `route text null`
- `requests_daily_limit integer not null`
- `requests_monthly_limit integer not null`
- `input_tokens_daily_limit bigint not null`
- `input_tokens_monthly_limit bigint not null`
- `output_tokens_daily_limit bigint not null`
- `output_tokens_monthly_limit bigint not null`
- `estimated_cost_daily_limit numeric not null`
- `estimated_cost_monthly_limit numeric not null`
- `max_concurrent_requests integer not null`
- `circuit_breaker_threshold integer not null`
- `enforcement_mode text not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

### 3. `security_route_policies`

Route-level policy binding.

Columns:
- `id uuid pk`
- `route text not null`
- `school_id uuid null`
- `role text null`
- `caller_type text not null`
- `quota_profile_id uuid not null`
- `enforcement_mode text not null`
- `is_enabled boolean not null`
- `allow_signed_internal boolean not null`
- `allow_jwt boolean not null`
- `allow_service_role boolean not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

### 4. `security_request_usage_daily`

Daily enforcement ledger.

Columns:
- `usage_date date not null`
- `route text not null`
- `school_id uuid null`
- `user_id uuid null`
- `role text not null`
- `caller_type text not null`
- `internal_caller_id uuid null`
- `request_count integer not null`
- `estimated_input_tokens bigint not null`
- `estimated_output_tokens bigint not null`
- `estimated_cost numeric not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Primary key:
- `(usage_date, route, school_id, user_id, role, caller_type, internal_caller_id)`

### 5. `security_request_usage_monthly`

Monthly enforcement ledger with the same shape as daily, keyed by `usage_month`.

### 6. `security_request_audit`

Append-only audit table.

Columns:
- `request_id uuid pk`
- `timestamp timestamptz not null`
- `route text not null`
- `school_id uuid null`
- `user_id uuid null`
- `role text null`
- `caller_type text not null`
- `service_name text null`
- `cron_job text null`
- `internal_worker text null`
- `internal_caller_id uuid null`
- `quota_decision text not null`
- `latency_ms integer not null`
- `status_code integer not null`
- `enforcement_mode text not null`
- `breaker_state text null`
- `error_code text null`

Do not store:
- request prompts
- authorization headers
- bearer tokens
- raw PII payloads

### 7. `security_circuit_state`

Durable breaker state per scope.

Columns:
- `id uuid pk`
- `route text not null`
- `school_id uuid null`
- `role text null`
- `caller_type text not null`
- `internal_caller_id uuid null`
- `state text not null`
- `failure_count integer not null`
- `opened_at timestamptz null`
- `half_open_probe_count integer not null`
- `last_failure_at timestamptz null`
- `last_success_at timestamptz null`
- `updated_at timestamptz not null`

### 8. `security_tenant_ai_budgets`

Tenant budget controls for schools.

Columns:
- `id uuid pk`
- `school_id uuid not null`
- `route text not null`
- `daily_cost_limit numeric not null`
- `monthly_cost_limit numeric not null`
- `daily_request_limit integer not null`
- `monthly_request_limit integer not null`
- `daily_input_token_limit bigint not null`
- `monthly_input_token_limit bigint not null`
- `daily_output_token_limit bigint not null`
- `monthly_output_token_limit bigint not null`
- `enforcement_mode text not null`
- `is_enabled boolean not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

---

## RPC Design

All RPCs should be `security definer`, `set search_path = public`, and return compact JSON for Edge Functions.

### `security.resolve_request_context(...)`
Input:
- request headers
- route
- school hint
- caller hint
- raw auth token presence

Output:
- caller type
- user id
- school id
- role
- service name
- cron job
- internal worker
- internal caller id
- enforcement mode
- policy id

### `security.validate_internal_caller(...)`
Verifies:
- caller registration exists,
- status is active,
- caller identity matches header,
- signature matches canonical request,
- service-role auth is present.

### `security.resolve_route_policy(...)`
Resolves the best policy row by:
- route
- school_id
- role
- caller_type
- internal caller id when present

### `security.reserve_quota(...)`
Atomically checks and increments:
- daily ledger
- monthly ledger
- tenant budget ledger when relevant

Returns:
- `allowed`
- `decision`
- `remaining_*`
- `breaker_hint`

### `security.settle_quota(...)`
Adjusts reserved counts with final usage values after the request completes.

### `security.write_request_audit(...)`
Writes the immutable audit row.

### `security.update_circuit_state(...)`
Records failure/success transitions and trip logic.

### `security.compute_ai_cost(...)`
Estimates cost from input/output token counts using `model_pricing` or a model-cost mapping table.

---

## Quota Policy Model

### Caller classes

- `public`
- `authenticated`
- `internal_service`

### Role-aware quotas

Supported roles:
- `student`
- `parent`
- `teacher`
- `school_admin`
- `internal_service`

Quota evaluation order:
1. Internal caller registration and signature
2. Route policy match
3. Caller class quota profile
4. Role override
5. Tenant school budget
6. Circuit breaker state

### AI spend rules

For AI endpoints:
- reserve by request count before execution,
- settle actual estimated tokens after execution,
- record estimated cost,
- clamp by daily and monthly spend ceilings,
- open circuit on repeated failures or budget exhaustion.

Estimated cost uses:
- prompt/input token estimate,
- completion/output token estimate,
- model pricing row,
- optional safety multiplier for untrusted callers.

### Enforcement semantics

- `public`: strict per-user, per-IP, per-school quotas
- `authenticated`: higher per-user quotas and school safeguards
- `internal_service`: separate quota pool with strict identity requirements

Compromised service-role protection:
- internal callers do not share unlimited capacity,
- each internal caller has a quota profile,
- route policies can cap internal concurrency and spend,
- breaker state still blocks runaway loops.

---

## Audit Schema

The audit row must always include:
- `request_id`
- `timestamp`
- `route`
- `school_id`
- `user_id`
- `role`
- `caller_type`
- `quota_decision`
- `latency`
- `status_code`

Additional safe fields:
- `service_name`
- `cron_job`
- `internal_worker`
- `internal_caller_id`
- `enforcement_mode`
- `breaker_state`
- `error_code`

Excluded fields:
- prompts
- bearer tokens
- raw payloads containing PII

Retention:
- keep audit indefinitely unless a later retention policy is approved,
- keep usage ledgers at least through the monthly budget window plus operational backfill horizon.

---

## Migration Sequence

### Migration 1
Create security tables, indexes, and RPCs:
- internal callers
- quota profiles
- route policies
- daily and monthly ledgers
- request audit
- circuit state
- tenant AI budgets

### Migration 2
Seed baseline quota profiles and policies for `grounded-answer`:
- student public quota
- parent quota
- teacher quota
- school_admin quota
- internal_service quota

### Migration 3
Add supporting indexes and RLS policy corrections:
- school-scoped lookups
- request audit index by `(school_id, timestamp desc)`
- usage index by `(school_id, route, day/month)`

### Migration 4
Backfill or initialize any existing `grounding_circuit_state` rows into the new circuit state table, if needed.

---

## Rollback Plan

Rollback is safe because the new platform layer is additive.

Rollback steps:
1. Disable `grounded-answer` route policy enforcement mode to `observe`.
2. Remove the entrypoint hook from `grounded-answer`.
3. Leave tables in place for forensic visibility.
4. If needed, drop the new policy rows after traffic is stable.

Do not drop audit or usage tables during an emergency rollback unless storage pressure forces a separate maintenance window.

---

## Testing Strategy

### Unit tests
- auth header parsing
- signed internal request validation
- attribution parsing
- quota decision mapping
- error handling shape

### Integration tests
- grounded-answer public caller rejected without JWT
- grounded-answer authenticated caller allowed with role attribution
- grounded-answer internal caller allowed only with registered identity and signature
- per-school quota isolation
- monthly spend cap reject path
- circuit breaker open reject path
- audit row shape contains only allowed fields

### SQL tests
- policy rows resolve correctly by route/school/role
- usage reservation is atomic
- circuit breaker increments trip correctly
- tenant budget never spills to another school

### Regression checks
- current grounded-answer behavior remains unchanged when auth succeeds
- streaming and non-streaming responses still work
- existing prompt/retrieval pipeline receives the same validated request object shape, plus a security envelope

---

## File-Level Implementation Plan

### Shared platform layer
- `supabase/functions/_shared/security/auth.ts`
- `supabase/functions/_shared/security/attribution.ts`
- `supabase/functions/_shared/security/authorization.ts`
- `supabase/functions/_shared/security/quota.ts`
- `supabase/functions/_shared/security/audit.ts`
- `supabase/functions/_shared/security/cors.ts`
- `supabase/functions/_shared/security/errors.ts`
- `supabase/functions/_shared/security/validation.ts`
- `supabase/functions/_shared/security/request-signature.ts`
- `supabase/functions/_shared/security/types.ts`

### Grounded-answer phase 1
- `supabase/functions/grounded-answer/index.ts`
- `supabase/functions/grounded-answer/validators.ts`
- `supabase/functions/grounded-answer/types.ts`
- `supabase/functions/grounded-answer/config.ts`
- `supabase/functions/grounded-answer/pipeline.ts` only if the security envelope must be threaded through the pipeline context

### Database
- `supabase/migrations/20260618000001_platform_security_layer.sql`

### Tests
- `supabase/functions/_shared/security/__tests__/*`
- `supabase/functions/grounded-answer/__tests__/*`

---

## Affected Files Estimate

Phase 1 should touch approximately:
- 1 migration file
- 8 to 10 new shared helper files
- 3 to 5 grounded-answer files
- 4 to 6 unit/integration tests

Estimated total: 16 to 22 files.

---

## Migration Risk

| Risk | Level | Notes |
|---|---|---|
| Auth gating breaks existing callers | High | Grounded-answer is currently public; rollout must start in observe/shadow for a small cohort |
| Quota misconfiguration blocks valid traffic | Medium | Seed defaults must be conservative and route-specific |
| Audit write overhead | Medium | Use compact inserts and targeted indexes |
| Signature verification bugs | High | Canonicalization must be deterministic and tested |
| Tenant isolation regressions | High | All quota keys must include school scope when present |
| Duplicate enforcement with existing in-memory rate limiter | Medium | Replace, do not stack, for phase 1 routes |

---

## Rollout Order

1. Deploy migration with tables, RPCs, and seed profiles.
2. Deploy shared helpers.
3. Wire grounded-answer in `observe` mode for validation.
4. Flip grounded-answer to `shadow` for a limited tenant set.
5. Flip grounded-answer to `enforce` once audit and quota metrics are clean.
6. Roll the same helpers into phase 2 functions.
7. Roll to all AI and externally reachable Edge Functions in phase 3.

---

## Phase 1 Implementation Notes

For grounded-answer, the entrypoint should:
- require JWT for student-facing requests,
- accept internal requests only when service-role auth plus `x-internal-caller` and signature validation pass,
- resolve attribution before validation and quota checks,
- use structured validation errors,
- reserve quota before pipeline work,
- settle quota and write audit after the response,
- preserve streaming and non-streaming behavior,
- remove wildcard CORS,
- avoid storing prompts or bearer tokens anywhere in audit or quota logs.

The downstream pipeline should remain functionally identical when a request is allowed.

