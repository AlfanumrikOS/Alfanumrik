# Agent B - Backend and Data Security Report

Status: Stage 1 reconnaissance complete  
Date: 2026-07-10  
Scope: read-heavy backend/data-security audit only. No code changes proposed here were implemented.

## Scope Inspected

- API correctness and route contract posture for `apps/host/src/app/api/**/route.ts`.
- Supabase RLS/RBAC/tenant isolation posture, especially parent, teacher, school-admin, public API, and service-role migration paths.
- Service-role usage controls in `scripts/admin-client-allowlist.json` and `scripts/route-access-manifest.json`.
- SECURITY DEFINER RPC safety, grants, search path pinning, and DB-function hardening coverage.
- Class membership canonicalization: `class_students` vs `class_enrollments`.
- Parent/school-admin/teacher July 10 RPC migrations and the route code that calls them.
- OpenAPI/public API contract coverage and route/spec drift.
- Idempotency and data-integrity signals in scoped RPCs and migration manifests.

## Files Inspected

- `scripts/admin-client-allowlist.json`
- `scripts/route-access-manifest.json`
- `scripts/xc3-service-role-migration-batch.json`
- `scripts/db-function-hardening.json`
- `scripts/verify-db-function-hardening-live.ts`
- `scripts/tsb4-canonical-membership-cutover.json`
- `scripts/tsb4-class-membership-divergence-quantification.sql`
- `docs/public-api/openapi.json`
- `openapi/v2.json`
- `apps/host/src/__tests__/api-admin-client-allowlist.test.ts`
- `apps/host/src/__tests__/api/route-access-manifest.test.ts`
- `apps/host/src/__tests__/db-function-hardening.test.ts`
- `apps/host/src/__tests__/db-function-live-grant-verifier.test.ts`
- `apps/host/src/__tests__/public-api/openapi-route.test.ts`
- `apps/host/src/__tests__/tsb4-canonical-membership-cutover-readiness.test.ts`
- `apps/host/src/__tests__/tsb4-divergence-quantification.test.ts`
- `apps/host/src/__tests__/tsb4-enrollments-rls-reconcile.test.ts`
- `apps/host/src/app/api/school-admin/students/route.ts`
- `apps/host/src/app/api/teacher/join-class/route.ts`
- `apps/host/src/app/api/teacher/remediation/route.ts`
- `apps/host/src/app/api/teacher/parent-notify/route.ts`
- `apps/host/src/app/api/teacher/lab-leaderboard/route.ts`
- `apps/host/src/app/api/parent/report/route.ts`
- `apps/host/src/app/api/parent/profile/route.ts`
- `apps/host/src/app/api/parent/notifications/route.ts`
- `apps/host/src/app/api/parent/notifications/[id]/read/route.ts`
- `apps/host/src/app/api/parent/notifications/mark-all-read/route.ts`
- `apps/host/src/app/api/parent/children/[student_id]/export/route.ts`
- `apps/host/src/app/api/parent/children/[student_id]/request-erasure/route.ts`
- `apps/host/src/app/api/parent/children/[student_id]/erasure-status/route.ts`
- `apps/host/src/app/api/public/v1/students/route.ts`
- `apps/host/src/app/api/public/v1/classes/route.ts`
- `apps/host/src/app/api/public/v1/reports/route.ts`
- `apps/host/src/app/api/public/v1/marketplace/listings/route.ts`
- `apps/host/src/app/api/public/v1/openapi/route.ts`
- `packages/lib/src/public-api/auth.ts`
- `packages/lib/src/rbac.ts`
- `supabase/migrations/20260702050000_class_enrollments_teacher_select_policy.sql`
- `supabase/migrations/20260702060000_class_membership_isactive_backfill.sql`
- `supabase/migrations/20260707010000_rca_final_fixes.sql`
- `supabase/migrations/20260707020000_rca18_db_function_execute_grants.sql`
- `supabase/migrations/20260710020000_xc3_teacher_join_class_rpc.sql`
- `supabase/migrations/20260710030000_xc3_parent_report_cache_guardian_rls.sql`
- `supabase/migrations/20260710040000_xc3_parent_erasure_scoped_rpcs.sql`
- `supabase/migrations/20260710050000_xc3_school_admin_students_list_rpc.sql`
- `supabase/migrations/20260710060000_xc3_parent_child_export_scoped_rpc.sql`
- `supabase/migrations/20260710070000_xc3_school_admin_student_toggle_rpc.sql`
- `supabase/migrations/20260710080000_xc3_parent_child_state_event_rpc.sql`
- `supabase/migrations/20260710090000_xc3_school_admin_student_attach_rpc.sql`
- `supabase/migrations/20260710100000_xc3_school_admin_student_create_preflight_rpc.sql`
- `supabase/migrations/20260710110000_xc3_school_admin_student_create_class_preflight_rpc.sql`
- `supabase/migrations/20260710120000_xc3_parent_erasure_status_rpc.sql`
- `supabase/migrations/20260710130000_xc3_parent_profile_update_rpc.sql`
- `supabase/migrations/20260710140000_xc3_parent_notifications_rpcs.sql`

## Confirmed Findings

| ID | Severity | Finding | Evidence | Risk | Recommended action | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| BSEC-01 | High | Service-role reduction is in progress, but the route surface still relies heavily on bypass clients. | `scripts/admin-client-allowlist.json:2-3` says the ledger ratchets down only and currently pins `258` admin-client routes. `scripts/route-access-manifest.json:3` records `364` API routes; current manifest grouping found `258` routes with `serviceRoleUse`. | App-layer tenant checks remain the primary boundary for a large number of routes. A missed route-level check can bypass RLS. | Continue XC-3 route-by-route migration to RLS-scoped request clients or narrowly scoped RPCs. Keep the allowlist ratchet and require each remaining exception to name the invariant, owner, and live test. | High |
| BSEC-02 | High | New July 10 SECURITY DEFINER RPCs have good local grant/search_path patterns but are not covered by the DB-function hardening manifest/live verifier. | `scripts/db-function-hardening.json:7,21,35` tracks only `submit_quiz_results`, `submit_quiz_results_v2`, and `match_rag_chunks_ncert`. July 10 migrations add many callable public-schema SECURITY DEFINER RPCs, for example `teacher_join_class_by_code` with `REVOKE ... PUBLIC/anon` and `GRANT ... authenticated` at `supabase/migrations/20260710020000_xc3_teacher_join_class_rpc.sql:94-96`, parent export at `20260710060000...:142-144`, school-admin attach at `20260710090000...:74-76`, and notifications at `20260710140000...:207-217`. | The static grant posture is currently inspectable but not centrally enforced for this new wave. A future migration could accidentally reintroduce PUBLIC execute, missing search_path, or an over-broad authenticated RPC without tripping RCA-18 tests. | Expand `scripts/db-function-hardening.json` or create an XC-3 RPC hardening manifest for every new public SECURITY DEFINER RPC. Extend `verify-db-function-hardening-live.ts` coverage to these functions before rollout. | High |
| BSEC-03 | Medium-High | `school_admin_student_create_preflight` exposes global email existence to any authenticated school admin. | The 3-arg function checks `public.students` by `lower(s.email) = v_normalized_email` without `school_id` scoping, then returns `'emailExists'` at `supabase/migrations/20260710110000_xc3_school_admin_student_create_class_preflight_rpc.sql:68-92`. It grants EXECUTE to all authenticated users at `:101-103`; route usage is at `apps/host/src/app/api/school-admin/students/route.ts:534-541`. | The route needs global duplicate prevention before Auth Admin creation, but the direct RPC can be used as an authenticated cross-tenant email-enumeration oracle. | Move the global email check behind a server-only service-role exception or return a generic duplicate/preflight failure only through the route. If kept callable, add rate/audit controls and avoid exposing the boolean. | Medium-High |
| BSEC-04 | Medium | Public API classes endpoint exposes `class_code` to API-key callers. | `apps/host/src/app/api/public/v1/classes/route.ts:45-48` selects class metadata including `class_code` scoped to the key school; response returns it at `:77`. The public spec documents `class_code` at `docs/public-api/openapi.json:188`. | School API keys are scoped, but `class_code` is a join credential. A leaked low-scope classes key may enable unauthorized class discovery/join attempts if downstream join flows trust code possession too much. | Decide whether `class_code` is intentionally public to school integrations. If not, remove it from v1 or gate it behind a narrower scope such as `classes.join_codes.read`. | Medium |
| BSEC-05 | Medium | Public API v1 contract is well covered, but global OpenAPI remains incomplete relative to implemented routes. | `docs/public-api/openapi.json:17-138` covers five public v1 paths, and `apps/host/src/__tests__/public-api/openapi-route.test.ts:56-76` verifies every public v1 route file is documented. `openapi/v2.json:1516-1521` is generated from the v2 Zod contract and currently has 12 paths, while route inventory found 364 API route files. | Consumers may confuse `openapi/v2.json` with the whole server contract. Security/review tooling that depends on OpenAPI will miss most internal/role-scoped endpoints. | Label `openapi/v2.json` as v2-mobile/client-only in docs and keep `docs/public-api/openapi.json` as the public v1 source. Add a non-public route-contract manifest export if API review tooling needs full coverage. | High |
| BSEC-06 | Medium | `class_enrollments` cutover is materially safer than prior state, but final tenant-isolation proof is still gated. | `scripts/tsb4-canonical-membership-cutover.json:5-6` records canonical `class_enrollments` and legacy `class_students`. `20260702050000_class_enrollments_teacher_select_policy.sql:45-54` adds teacher SELECT policy. `packages/lib/src/rbac.ts:305-331` reads `class_enrollments` for teacher reachability. The manifest still marks `live-tenant-smoke` as `live_gated` and legacy-table retirement as decision-gated. | Static code now points to the canonical table, but production confidence still depends on live tenant smoke and divergence proof staying current. Legacy `class_students` writes remain in school-admin attach paths for sync/seat flows. | Run the live tenant-isolation lane before irreversible cleanup. Keep `class_students` retirement CEO-gated; do not drop or freeze until live evidence and divergence reports are attached. | Medium-High |
| BSEC-07 | Positive | Parent, teacher, and school-admin service-role migrations show the right boundary pattern in the sampled current routes. | Routes call RLS-scoped clients/RPCs: school-admin list/toggle/attach/preflight at `apps/host/src/app/api/school-admin/students/route.ts:132-133,213-223,350-361,534-541`; teacher join at `apps/host/src/app/api/teacher/join-class/route.ts:97-98`; parent export/event at `apps/host/src/app/api/parent/children/[student_id]/export/route.ts:169-170,246-253`; parent erasure at `request-erasure/route.ts:121-122,180-187,238-239,279-286`; parent notifications at `notifications/route.ts:85-92`, `[id]/read/route.ts:54-59`, and `mark-all-read/route.ts:43-46`. | This reduces route-level service-role blast radius and moves ownership checks into DB helpers, but it increases the importance of RPC grant verification and direct RPC abuse testing. | Preserve this migration pattern, but harden it with live grant checks and direct-RPC negative tests. | High |

## Evidence

- Current route inventory:
  - `364` API route files under `apps/host/src/app/api`.
  - `scripts/route-access-manifest.json` records `routeCount: 364`.
  - `scripts/admin-client-allowlist.json` records `count: 258`.
  - Manifest service-role-use grouping observed during this pass: `super_admin=71`, `auth=64`, `school_admin=29`, `cron=17`, `teacher=15`, `student=13`, `parent=10`, `public_api=4`, plus smaller categories.
- Current DB/migration inventory:
  - `734` migration files.
  - `1351` `CREATE POLICY` references.
  - `578` `ENABLE ROW LEVEL SECURITY` references.
  - `1001` `SECURITY DEFINER` references.
  - `52` Supabase Edge Functions with `index.ts`.
- Public API:
  - `docs/public-api/openapi.json` covers five public v1 paths.
  - `openapi/v2.json` covers 12 v2 Zod-contract paths.
- XC-3 migration ledger:
  - `scripts/xc3-service-role-migration-batch.json:9-105` records migrated scoped-RPC/RLS status for parent export/erasure/status/report, school-admin students, and teacher join-class.
  - `scripts/xc3-service-role-migration-batch.json:119-120` records a reviewed service-role exception.

## Risks

- Large remaining service-role footprint means app-layer authorization bugs can still become data-isolation bugs.
- New public SECURITY DEFINER RPCs are safer than raw service-role routes only if grants, `auth.uid()` checks, and direct-call behavior remain continuously verified.
- Direct RPC access by `authenticated` users may expose subtle metadata side channels even when route code is safe.
- Public API key routes are tenant-scoped, but returned fields need scope-by-scope review because API keys are long-lived integration credentials.
- Class-membership cutover should not be declared complete until live tenant smoke confirms canonical `class_enrollments` behavior under real RLS claims.

## Dependencies

- Agent/owner coordination for XC-3 service-role migration sequencing.
- Supabase linked target or staging DB access for live grant/RLS verification.
- Stable public API product decision on whether `class_code` is allowed in `classes.read`.
- CEO/product approval before destructive `class_students` retirement.
- Current route-access and admin-client manifests must remain generated/ratcheted by CI.

## Recommended Action

1. Extend DB function hardening coverage to all July 10 scoped RPCs before rollout.
2. Rework `school_admin_student_create_preflight` to avoid direct global email-existence disclosure to all authenticated callers.
3. Review public API class response fields and remove or scope-gate `class_code` if it is a join credential.
4. Continue shrinking `scripts/admin-client-allowlist.json` and keep per-route exceptions in `scripts/route-access-manifest.json`.
5. Run live tenant-isolation smoke for the `class_enrollments` cutover and attach divergence artifacts before legacy table retirement.
6. Add direct-RPC negative tests for parent/school-admin/teacher helpers, not only route-level tests.

## Files Proposed For Modification

- `scripts/db-function-hardening.json`
- `scripts/verify-db-function-hardening-live.ts`
- `apps/host/src/__tests__/db-function-hardening.test.ts`
- `apps/host/src/__tests__/db-function-live-grant-verifier.test.ts`
- `supabase/migrations/20260710110000_xc3_school_admin_student_create_class_preflight_rpc.sql`
- `apps/host/src/app/api/school-admin/students/route.ts`
- `apps/host/src/__tests__/school-admin-students-rpc-migration.test.ts`
- `apps/host/src/app/api/public/v1/classes/route.ts`
- `docs/public-api/openapi.json`
- `apps/host/src/__tests__/public-api/openapi-route.test.ts`
- `scripts/tsb4-canonical-membership-cutover.json`
- `apps/host/src/__tests__/live-tenant-isolation-smoke.test.ts`

No frontend components are proposed for modification.

## Tests Required

- `cd apps/host && npx vitest run src/__tests__/api-admin-client-allowlist.test.ts`
- `cd apps/host && npx vitest run src/__tests__/api/route-access-manifest.test.ts`
- `cd apps/host && npx vitest run src/__tests__/db-function-hardening.test.ts src/__tests__/db-function-live-grant-verifier.test.ts`
- `cd apps/host && npx vitest run src/__tests__/school-admin-students-rpc-migration.test.ts`
- `cd apps/host && npx vitest run src/__tests__/teacher-join-class-rpc-migration.test.ts`
- `cd apps/host && npx vitest run src/__tests__/parent-child-export-rpc-migration.test.ts src/__tests__/parent-erasure-rpc-migration.test.ts src/__tests__/parent-notifications-rpc-migration.test.ts src/__tests__/parent-profile-rpc-migration.test.ts`
- `cd apps/host && npx vitest run src/__tests__/public-api/openapi-route.test.ts`
- `cd apps/host && npx vitest run src/__tests__/tsb4-canonical-membership-cutover-readiness.test.ts src/__tests__/tsb4-divergence-quantification.test.ts src/__tests__/tsb4-enrollments-rls-reconcile.test.ts`
- Live/staging: `npx tsx scripts/verify-db-function-hardening-live.ts --input=<pg_catalog rows json>`
- Live/staging: tenant-isolation smoke for assigned teacher, unassigned teacher, active enrollment, inactive enrollment, parent linked child, parent unlinked child, and school-admin cross-school class/student attempts.

## Confidence Level

Overall confidence: Medium-High.

- High confidence in static route, manifest, and migration evidence.
- Medium-High confidence in service-role and RPC hardening findings because they are directly visible in source and migrations.
- Medium confidence in live safety status because no live Supabase target or integration lane was executed in this Stage 1 pass.

## Unresolved Questions

- Is `class_code` intentionally part of the public v1 classes contract for integrations, or should join credentials require a narrower scope?
- Should school-admin duplicate-email preflight disclose a global `emailExists` boolean to route callers, or should it be collapsed to a generic duplicate failure?
- Which July 10 scoped RPCs are already applied to staging/production, and do live catalog grants match source migrations?
- Are any `authenticated` users without matching role rows able to call the new SECURITY DEFINER RPCs and learn useful negative/positive state from error messages?
- What is the latest live divergence output for `class_students` vs `class_enrollments` after the route/helper repoint?
- Which of the 258 remaining admin-client routes are true exceptions versus migration backlog?
