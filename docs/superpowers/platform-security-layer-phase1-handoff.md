# Platform Security Layer — Phase 1, 2 & 3 Handoff

## Scope

Phase 1 is complete for `grounded-answer`. Phase 2 is complete for `ncert-question-engine` (PR #1067). Phase 3 has completed code integration for `alfabot-answer`, `ncert-solver`, and `whatsapp-notify`. Route policies have been seeded in the database for the remaining 11 functions, but their `index.ts` files have not yet been updated to use the shared security admission flow.

Rolled out with full security layer integration:
- `grounded-answer` — rolled out and validated
- `ncert-question-engine` — rolled out and validated (PR #1067)
- `alfabot-answer` — rolled out (Phase 3); callerTypes `['internal_service']` only; Next.js proxy at `/api/alfabot` signs requests with HMAC-SHA256 internal caller signing
- `ncert-solver` — rolled out (Phase 3); callerTypes `['student', 'internal_service']`; function-local circuit breaker preserved alongside platform circuit breaker
- `whatsapp-notify` — rolled out (Phase 3 Wave 3); callerTypes `['internal_service']` only; modelProvider `meta` (WhatsApp Cloud API); legacy `constantTimeEqual` service-role check replaced; three Next.js callers sign requests with HMAC-SHA256 (`notifications-whatsapp-route`, `school-admin-parents-route`, `synthesis-parent-share-route`); migration `20260620001500_whatsapp_notify_security_policy.sql` seeds quota profile + route policy + three internal caller registrations

Route policies seeded in DB, code integration pending:
- `scan-ocr`
- `parent-report-generator`
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
- `supabase/functions/alfabot-answer/index.ts` (Phase 3 — admitAiRoute with callerTypes `['internal_service']`; body read as text for body hash; finalizeAiRoute in non-streaming path and streaming finally block)
- `supabase/functions/alfabot-answer/stream-response.ts` (Phase 3 — buildStreamingResponse accepts `admission: AiAdmissionContext` + `sb`; finalizeAiRoute in the ReadableStream finally block; streamStatusCode tracked for circuit outcome)
- `supabase/functions/ncert-solver/index.ts` (Phase 3 — admitAiRoute with callerTypes `['student', 'internal_service']`; finalizeAiRoute on every exit path; function-local circuit breaker preserved)

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
- `supabase/migrations/20260620001500_whatsapp_notify_security_policy.sql` (Phase 3 Wave 3 — quota profile + route policy + three internal caller registrations for whatsapp-notify)

### Internal Caller Signing (Next.js)

- `src/lib/security/internal-caller-signing.ts` (Phase 3 — Node.js HMAC-SHA256 helper mirroring the Deno `request-signature.ts`; base64url encoding; canonical request matches Deno verifier field order)
- `src/app/api/alfabot/route.ts` (Phase 3 — `callEdgeFunction` now serializes body to string, computes HMAC-SHA256 signing headers via `buildInternalCallerHeaders`, and spreads them into the fetch call)

### Contract Tests

- `src/__tests__/ncert-question-engine-security.test.ts` (Phase 2 — validates code primitives and migration shape for ncert-question-engine)
- `src/__tests__/alfabot-answer-security.test.ts` (Phase 3 — 7 tests: code primitives, callerTypes, body-text-before-parse order, finalizeAiRoute non-streaming, stream-response finally block, migration seeding, admission parameter)
- `src/__tests__/ncert-solver-security.test.ts` (Phase 3 — 6 tests: code primitives, callerTypes, body-text-before-parse, finalize-on-every-exit-path, migration seeding, function-local circuit breaker preserved)
- `src/__tests__/lib/security/internal-caller-signing.test.ts` (Phase 3 — 16 unit tests: sha256Hex, canonical field order, base64url encoding, HMAC determinism, missing-secret null return, headers shape, timestamp window)
- `src/__tests__/whatsapp-notify-security.test.ts` (Phase 3 Wave 3 — 7 tests: code primitives, internal_service-only callerTypes, meta modelProvider, body-text-before-admit order, finalizeAiRoute call count, quota profile migration seeding, three internal caller registrations)

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
| `ncert-solver` | Yes | Yes | Rolled out (Phase 3); JWT + internal_service callers |
| `scan-ocr` | Yes | No | Route policy seeded; code integration pending |
| `parent-report-generator` | Yes | No | Route policy seeded; code integration pending |
| `alfabot-answer` | Yes | Yes | Rolled out (Phase 3); internal_service caller only; Next.js proxy signs requests |
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
| `whatsapp-notify` | Yes | Yes | Rolled out (Phase 3 Wave 3); internal_service caller only; 3 Next.js callers sign requests; migration 20260620001500 |

The live database migrations required for the grounded-answer and ncert-question-engine rollouts are already applied. The bulk policy seeding migration (`20260620001300`) is also applied, making Phase 3 code integration purely a code change with no new migration required for the 14 already-seeded functions.

## Phase 3 Deployment Notes

### INTERNAL_CALLER_SIGNING_SECRET

A new environment variable `INTERNAL_CALLER_SIGNING_SECRET` was introduced for the `alfabot-answer` integration. Before enabling traffic to the integrated Edge Function:

1. Generate a secure random secret: `openssl rand -base64 32`
2. Set it in Vercel: `vercel env add INTERNAL_CALLER_SIGNING_SECRET production`
3. Set it in Supabase Edge Function secrets: `supabase secrets set INTERNAL_CALLER_SIGNING_SECRET=<same-value>`
4. Both values MUST match. A mismatch will cause all AlfaBot traffic to fail with 401.
5. Redeploy both the Vercel function AND the Edge Function after setting the secret.

Without this secret set, the Next.js proxy will log a warning (`alfabot.internal_signing_not_configured`) and no signing headers will be sent. The Edge Function will reject all calls with 401 once its security layer is live.

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

### 1. ✅ Roll the shared layer into `alfabot-answer` (COMPLETE)

`alfabot-answer` is integrated. Key architectural decision: `callerTypes: ['internal_service']` only — no student JWT admitted directly. All traffic must flow through the Next.js proxy at `/api/alfabot`, which handles anon session management, rate limiting, and denylist before calling the Edge Function with signed internal caller headers.

- `src/lib/security/internal-caller-signing.ts` created (Node.js HMAC-SHA256 mirror of the Deno verifier)
- `callEdgeFunction` in `/api/alfabot/route.ts` now adds `x-request-id`, `x-internal-caller`, `x-internal-timestamp`, `x-internal-signature` headers
- **Deployment requirement**: `INTERNAL_CALLER_SIGNING_SECRET` must be set in both Vercel env vars (Next.js) and Supabase Edge Function secrets with the same value before deploying. If the secret is not set, the Next.js route logs a warning and the Edge Function will reject unsigned calls with 401.

### 2. 🔄 Roll the shared layer into `ncert-solver`, `scan-ocr`, `parent-report-generator` (ncert-solver COMPLETE)

`ncert-solver` is integrated with `callerTypes: ['student', 'internal_service']`. The function-local circuit breaker for the Claude API is preserved alongside the platform circuit breaker (they coexist at different abstraction levels). `finalizeAiRoute` is called on every exit path.

Remaining: `scan-ocr`, `parent-report-generator`

### 3. Roll the shared layer into the bulk and embedding functions

Lower-frequency internal-service callers. Route policies are already seeded.

Functions: `bulk-question-gen`, `bulk-non-mcq-gen`, `bulk-jee-neet-import`, `generate-answers`, `generate-concepts`, `extract-ncert-questions`, `extract-diagrams`, `embed-ncert-qa`, `embed-questions`, `embed-diagrams`

- these are typically service-to-service callers; confirm internal caller signing is wired
- audit logging must capture the internal caller context and route name

### 4. ✅ Seed route policies and roll the shared layer into `whatsapp-notify` (COMPLETE)

`whatsapp-notify` is fully integrated. Migration `20260620001500_whatsapp_notify_security_policy.sql` seeds the quota profile, route policy, and three internal caller registrations. The legacy `constantTimeEqual` service-role key check is replaced by `admitAiRoute`. All three Next.js callers (`/api/notifications/whatsapp`, `/api/school-admin/parents`, `/api/synthesis/parent-share`) now serialize body text before the fetch call and add HMAC-SHA256 signing headers via `buildInternalCallerHeaders`. `finalizeAiRoute` is called on every exit path (10 branches including the outer catch).

### 5. Operational hardening

- add route-by-route validation scripts for each newly integrated function
- document the expected RPC contracts per function
- keep migration additions incremental and reversible
- verify each new rollout against the real database before enabling traffic

## Phase 4 Implementation Roadmap

Phase 4 covers the 10 bulk and embedding Edge Functions. These functions share a common problem: their current auth patterns are incompatible with the platform security layer and require auth migration before the admission flow can be applied.

### Auth migration required before security layer integration

**`bulk-question-gen`**
Uses `verifyAdminAuth` which checks `admin_users.admin_level` — a custom admin table, not the platform RBAC roles (`student`, `teacher`, `school_admin`, `internal_service`). The security layer's `resolveSecurityPrincipal` cannot resolve a principal from this custom check. Migration path: replace `verifyAdminAuth` with platform RBAC role check (`teacher` or `school_admin`) before applying the admission flow.

**`bulk-non-mcq-gen`**
Same pattern as `bulk-question-gen` — uses `verifyAdminAuth` / `admin_users.admin_level`. Requires the same RBAC migration before security layer integration.

**`bulk-jee-neet-import`**
Uses an `x-admin-key` header (a shared secret, not a JWT). The security layer has no principal resolver for raw API keys. Migration path: replace `x-admin-key` with either a JWT-bearing caller or an internal caller signing header, then integrate the security layer.

**`generate-answers`**
Same `x-admin-key` pattern as `bulk-jee-neet-import`. Requires API key → JWT or internal caller signing migration.

**`generate-concepts`**
Same `x-admin-key` pattern. Requires API key → JWT or internal caller signing migration.

**`extract-ncert-questions`**
Same `x-admin-key` pattern. Requires API key → JWT or internal caller signing migration.

**`extract-diagrams`**
Same `x-admin-key` pattern. Requires API key → JWT or internal caller signing migration.

**`embed-ncert-qa`**
Same `x-admin-key` pattern. Requires API key → JWT or internal caller signing migration.

**`embed-questions`**
Same `x-admin-key` pattern. Requires API key → JWT or internal caller signing migration.

**`embed-diagrams`**
Same `x-admin-key` pattern. Requires API key → JWT or internal caller signing migration.

### Recommended Phase 4 sequence

1. Decide auth migration strategy for bulk functions: platform RBAC JWT (teacher/school_admin) or internal caller signing (service-to-service). The bulk/embed functions are typically run from scripts or the super-admin panel — internal caller signing is the simpler path if callers are always server-side.
2. For `bulk-question-gen` and `bulk-non-mcq-gen`: replace `verifyAdminAuth` with platform role check or internal caller registration. These two functions already have quota profiles seeded in `20260620001300` for the `teacher`, `school_admin`, and `internal_service` roles.
3. For the eight `x-admin-key` functions: register each as an internal caller (or wire JWT auth), then integrate `admitAiRoute` / `finalizeAiRoute`. Quota profiles are already seeded.
4. No new migration is needed for the quota profiles or route policies — they were seeded in `20260620001300`. Only caller registrations may need updating if the caller names change during the auth migration.

## Notes

- Phase 1 and Phase 2 were validated against the real Supabase database, not just local emulation.
- The function response behavior for grounded-answer and ncert-question-engine remained unchanged in scope; the work was about securing the request lifecycle around each.
- The 14 functions seeded in `20260620001300` have DB-side policy enforcement ready. No additional migration work is needed before Phase 4 code integration for those functions (quota profiles and route policies exist).
- `whatsapp-notify` is fully integrated as of Phase 3 Wave 3.
- Unrelated workspace edits may exist outside the platform security layer scope and are not part of this handoff.
