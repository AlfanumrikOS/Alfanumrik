# Platform Security Layer — Phase 1 & Phase 2 Handoff

## Scope

Phase 1 is complete for `grounded-answer`. Phase 2 is complete for `ncert-question-engine` (PR #1067). Route policies have been seeded in the database for 14 additional AI Edge Functions, but their `index.ts` files have not yet been updated to use the shared security admission flow — they still handle auth and CORS directly.

Rolled out with full security layer integration:
- `grounded-answer` — rolled out and validated
- `ncert-question-engine` — rolled out and validated (PR #1067)

Route policies seeded in DB, code integration pending:
- `ncert-solver`
- `scan-ocr`
- `parent-report-generator`
- `alfabot-answer`
- `bulk-question-gen`
- `bulk-non-mcq-gen`
- `bulk-jee-neet-import`
- `generate-answers`
- `generate-concepts`
- `extract-ncert-questions`
- `extract-diagrams`
- `embed-ncert-qa`
- `embed-questions`
- `embed-diagrams`

Not yet seeded or code-integrated:
- `whatsapp-notify`

## Architecture Summary

The platform security layer inserts a consistent request lifecycle in front of each participating Edge Function:

1. Inbound request is normalized for origin, request ID, and IP attribution.
2. Principal is resolved from the request context and internal caller signature.
3. Route policy is loaded for the current caller and school context.
4. Estimated quota is computed before execution and reserved if policy enforcement requires it.
5. The core function pipeline runs.
6. Actual usage is settled after execution.
7. Audit data is written for every handled request.
8. Circuit-breaker state is updated from success or failure outcomes.

The implementation is split into small shared modules under `supabase/functions/_shared/security` so the same primitives can be reused by later Edge Functions without duplicating policy, quota, audit, or circuit logic.

### Shared Security Modules

- `attribution.ts` - request ID, origin, IP extraction, and IP hashing
- `auth.ts` - principal resolution for JWT and internal callers
- `policy.ts` - route policy lookup and enforcement mode selection
- `quota.ts` - estimation, reservation, settlement, and cost computation
- `audit.ts` - request audit writes
- `circuit.ts` - circuit-breaker state recording
- `cors.ts` - CORS and JSON response helpers
- `request-signature.ts` - request body hashing and signature support
- `errors.ts` - standardized security errors
- `types.ts` - shared security types
- `index.ts` - shared exports

## Files Changed

### Edge Functions

- `supabase/functions/grounded-answer/index.ts`
- `supabase/functions/ncert-question-engine/index.ts` (Phase 2 — full security layer integration: principal resolution, route policy check, quota reserve/settle, audit write, circuit breaker)

### Shared Security Layer

- `supabase/functions/_shared/security/attribution.ts`
- `supabase/functions/_shared/security/auth.ts`
- `supabase/functions/_shared/security/policy.ts`
- `supabase/functions/_shared/security/quota.ts`
- `supabase/functions/_shared/security/audit.ts`
- `supabase/functions/_shared/security/circuit.ts`
- `supabase/functions/_shared/security/cors.ts`
- `supabase/functions/_shared/security/request-signature.ts`
- `supabase/functions/_shared/security/errors.ts`
- `supabase/functions/_shared/security/types.ts`
- `supabase/functions/_shared/security/index.ts`

### Migrations

- `supabase/migrations/20260618000001_platform_security_layer.sql`
- `supabase/migrations/20260620001100_platform_security_layer_replica_identity.sql`
- `supabase/migrations/20260620001200_ncert_question_engine_security_policy.sql` (Phase 2 — 5 role-scoped quota profiles + internal caller registration + route policies for ncert-question-engine)
- `supabase/migrations/20260620001300_ai_edge_function_security_policies.sql` (Phase 2 — bulk route policy and quota profile seeding for 14 additional AI Edge Functions; no code integration)

### Contract Tests

- `src/__tests__/ncert-question-engine-security.test.ts` (Phase 2 — validates code primitives and migration shape for ncert-question-engine)

### Dependency/Tooling Updates

- `package.json`
- `package-lock.json`
- `deno.lock`

## Migrations Added

### `20260618000001_platform_security_layer.sql`

Adds the core platform security schema and RPC support needed by the grounded-answer security layer:

- security route policy storage
- internal caller registration and lookup
- quota reservation and settlement support
- request audit storage
- circuit-breaker state storage
- supporting indexes, triggers, and helper functions

### `20260620001100_platform_security_layer_replica_identity.sql`

Adds replica-identity coverage for the quota usage tables so update paths work correctly when the publication is active on the linked Supabase database.

### `20260620001200_ncert_question_engine_security_policy.sql`

Seeds the security configuration for `ncert-question-engine`:

- 5 role-scoped quota profiles (student, parent, teacher, school_admin, internal_service)
- internal caller registration for the function
- route policies for the ncert-question-engine routes

### `20260620001300_ai_edge_function_security_policies.sql`

Bulk-seeds route policies and quota profiles for 14 additional AI Edge Functions: `ncert-solver`, `scan-ocr`, `parent-report-generator`, `alfabot-answer`, `bulk-question-gen`, `bulk-non-mcq-gen`, `bulk-jee-neet-import`, `generate-answers`, `generate-concepts`, `extract-ncert-questions`, `extract-diagrams`, `embed-ncert-qa`, `embed-questions`, `embed-diagrams`.

These policies are present in the database but none of these functions has been updated to use the shared security admission flow. Code integration is Phase 3 work.

## RPCs Added

The security layer depends on these RPCs:

- `security_resolve_user_context`
- `security_resolve_internal_caller`
- `security_resolve_route_policy`
- `security_compute_ai_cost`
- `security_reserve_quota`
- `security_settle_quota`
- `security_write_request_audit`
- `security_update_circuit_state`

These RPCs were validated against the real database and are exercised by both the grounded-answer and ncert-question-engine request paths.

## Validation Performed

### Build and Type Validation

- `npm run build`
- `deno check supabase/functions/grounded-answer/index.ts`
- `deno check supabase/functions/ncert-question-engine/index.ts`

### Database Migration Validation

- Applied the Phase 1 migration to the linked Supabase database.
- Applied the replica-identity follow-up migration.
- Applied the ncert-question-engine security policy migration (Phase 2).
- Applied the bulk AI Edge Function security policy migration (Phase 2).
- Confirmed the full migration path works on the live database.

### RPC Validation

Validated that the security RPCs execute successfully against the live database:

- principal/context resolution
- internal caller resolution
- route policy lookup
- quota cost estimation
- quota reserve
- quota settle
- audit write
- circuit state update

### Grounded-Answer Validation

Executed a real grounded-answer request through the new security layer and confirmed:

- request admission succeeds
- grounded-answer initializes successfully
- the response path returns `200`
- quota reservation and settlement complete
- audit rows are written
- circuit state updates are recorded

Observed final behavior during validation:

- grounded-answer returned a valid response
- audit rows were present for the request
- quota usage rows were updated
- circuit breaker state returned to `closed` after recovery

### ncert-question-engine Validation (Phase 2)

`ncert-question-engine/index.ts` was updated with the same full security admission flow as grounded-answer (principal resolution, route policy check, quota reserve/settle, audit write, circuit breaker).

Contract test `src/__tests__/ncert-question-engine-security.test.ts` verifies:

- code primitives wire the shared security modules correctly
- migration shape matches the expected quota profile and route policy structure for ncert-question-engine

## Rollout Status

| Function | Route Policy in DB | Code Integration | Status |
|---|---|---|---|
| `grounded-answer` | Yes | Yes | Rolled out and validated |
| `ncert-question-engine` | Yes | Yes | Rolled out and validated (PR #1067) |
| `ncert-solver` | Yes | No | Route policy seeded; code integration pending |
| `scan-ocr` | Yes | No | Route policy seeded; code integration pending |
| `parent-report-generator` | Yes | No | Route policy seeded; code integration pending |
| `alfabot-answer` | Yes | No | Route policy seeded; code integration pending — highest priority for Phase 3 |
| `bulk-question-gen` | Yes | No | Route policy seeded; code integration pending |
| `bulk-non-mcq-gen` | Yes | No | Route policy seeded; code integration pending |
| `bulk-jee-neet-import` | Yes | No | Route policy seeded; code integration pending |
| `generate-answers` | Yes | No | Route policy seeded; code integration pending |
| `generate-concepts` | Yes | No | Route policy seeded; code integration pending |
| `extract-ncert-questions` | Yes | No | Route policy seeded; code integration pending |
| `extract-diagrams` | Yes | No | Route policy seeded; code integration pending |
| `embed-ncert-qa` | Yes | No | Route policy seeded; code integration pending |
| `embed-questions` | Yes | No | Route policy seeded; code integration pending |
| `embed-diagrams` | Yes | No | Route policy seeded; code integration pending |
| `whatsapp-notify` | No | No | Not yet seeded or code-integrated |

The live database migrations required for the grounded-answer and ncert-question-engine rollouts are already applied. The bulk policy seeding migration (`20260620001300`) is also applied, making Phase 3 code integration purely a code change with no new migration required for the 14 already-seeded functions.

## Deployment Checklist

Before rolling the security layer into any additional Edge Function, verify:

- the target function uses the shared security admission flow
- the target route has a policy row in the security policy table (already true for the 14 seeded functions)
- internal caller signing is wired for the function if it accepts service-to-service calls
- quota estimation logic matches the function's usage model
- audit writes include the function's route name and caller context
- circuit-breaker state updates match the function's success and failure semantics
- the target function is covered by real DB validation
- migration state is present in the target environment

## Rollback Procedure

If the security layer must be rolled back for a specific function:

1. Disable the route policy for the target function or set enforcement to a non-enforcing mode.
2. Remove the function's use of the shared security admission flow if code rollback is required.
3. Revert to the previous commit for that function's `index.ts`.
4. Leave the migrations in place unless a database rollback is explicitly required.

If database rollback is required:

1. Restore the pre-Phase-1 database snapshot or apply a reverse migration in a controlled environment.
2. Ensure the quota, audit, and circuit tables are reverted consistently.
3. Re-validate the affected functions after rollback before re-enabling traffic.

Operational note:
- The security migrations were validated on the live linked database, so rollback should be treated as a full application-plus-database change, not just a code revert.

## Phase 2 Implementation Roadmap

Phase 2 is complete. Completed steps:

1. `grounded-answer` — shared security admission flow integrated and validated (Phase 1)
2. `ncert-question-engine` — shared security admission flow integrated and validated (PR #1067)
3. Route policies and quota profiles seeded for 14 additional AI Edge Functions (`20260620001300`) — DB ready for Phase 3 code integration

## Phase 3 Implementation Roadmap

Phase 3 is code integration only for the 14 functions that already have route policies seeded. No new migrations are required for those functions. `whatsapp-notify` will require a policy seeding migration before its code integration.

### 1. Roll the shared layer into `alfabot-answer` (highest priority)

`alfabot-answer` is the highest-visibility user-facing AI function after grounded-answer. Its route policy is already seeded.

- replace direct request handling with the shared admission flow
- validate quota, audit, and circuit behavior against the live database
- confirm the function's usage model maps correctly to quota estimation and settlement

### 2. Roll the shared layer into `ncert-solver`, `scan-ocr`, `parent-report-generator`

These are the next highest-priority functions based on usage. Route policies are already seeded for all three.

- reuse the same principal resolution and policy checks
- add only the minimum function-specific adaptation needed per route
- validate each against real DB after integration

### 3. Roll the shared layer into the bulk and embedding functions

Lower-frequency internal-service callers. Route policies are already seeded.

Functions: `bulk-question-gen`, `bulk-non-mcq-gen`, `bulk-jee-neet-import`, `generate-answers`, `generate-concepts`, `extract-ncert-questions`, `extract-diagrams`, `embed-ncert-qa`, `embed-questions`, `embed-diagrams`

- these are typically service-to-service callers; confirm internal caller signing is wired
- audit logging must capture the internal caller context and route name

### 4. Seed route policies and roll the shared layer into `whatsapp-notify`

`whatsapp-notify` has no policy seeded yet. It requires a migration before code integration.

- write a policy seeding migration for whatsapp-notify
- integrate internal caller resolution and route policy enforcement
- ensure audit logging captures notification-specific caller context
- validate circuit-breaker behavior for transient notification failures

### 5. Operational hardening

- add route-by-route validation scripts for each newly integrated function
- document the expected RPC contracts per function
- keep migration additions incremental and reversible
- verify each new rollout against the real database before enabling traffic

## Notes

- Phase 1 and Phase 2 were validated against the real Supabase database, not just local emulation.
- The function response behavior for grounded-answer and ncert-question-engine remained unchanged in scope; the work was about securing the request lifecycle around each.
- The 14 functions seeded in `20260620001300` have DB-side policy enforcement ready. No additional migration work is needed before Phase 3 code integration for those functions.
- `whatsapp-notify` is the only remaining function that needs both a policy seeding migration and code integration.
- Unrelated workspace edits may exist outside the platform security layer scope and are not part of this handoff.
