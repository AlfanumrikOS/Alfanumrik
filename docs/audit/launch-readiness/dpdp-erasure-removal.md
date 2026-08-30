# DPDP right-to-erasure subsystem — permanent removal (2026-08-30)

## Decision

CEO decision, 2026-08-30: the DPDP Act 2023 §17 right-to-erasure subsystem
(account deletion cooling-off flow, guardian child-data erasure requests, and
per-layer Foxy memory erasure) is **not required by the schools this platform
serves**. Removed permanently rather than left half-wired. This is distinct
from — and does not affect — the DPDP §13 data-**export** flow
(`/api/parent/children/[student_id]/export`), which stays, or parental
consent tracking (`parental_consent`, `/api/parent/consent`), which stays.

## Root cause / scope decision

Prior to removal, verified live against the production database
(`shktyoxqhundlvkiwguu`):
- `account_deletion_log`: 0 rows.
- `data_erasure_requests`: 0 rows.
- No other table held a foreign key into either table.
- No `pg_cron` job referenced either table or the `account-purge` /
  `data-erasure-purger` Edge Functions.
- `packages/lib/src/memory/erasure-guard.ts` had zero callers anywhere in the
  app — the `ff_unified_memory_v1` feature it gated was seeded OFF and never
  enabled, so removing it disabled nothing that was live.

The subsystem was fully unused in production and safe to remove without a
data-migration step.

## Database changes

Migration: `supabase/migrations/20260830172610_remove_dpdp_erasure_system.sql`
(applied to `shktyoxqhundlvkiwguu`).

Dropped:
- Tables: `public.account_deletion_log`, `public.data_erasure_requests`
  (CASCADE — takes their triggers and RLS policies with them).
- RPCs: `request_account_deletion`, `cancel_account_deletion`,
  `execute_data_erasure_purge`, `parent_request_child_erasure`,
  `parent_child_erasure_status`, `parent_cancel_child_erasure`.
- Trigger functions: `update_account_deletion_log_updated_at`,
  `set_data_erasure_requests_updated_at`, `insert_data_erasure_audit_event`.
- RBAC permission codes `account.delete` and `memory.erase_own`, and every
  `role_permissions` grant pointing at them (student, parent, teacher).

Schema integrity: post-migration verification confirmed zero remaining
tables, functions, or permission rows for any of the above.

## Application code removed

**Next.js routes:**
- `apps/host/src/app/api/v1/account/delete/route.ts`
- `apps/host/src/app/api/cron/account-purge/route.ts`
- `apps/host/src/app/api/parent/children/[student_id]/request-erasure/route.ts`
- `apps/host/src/app/api/parent/children/[student_id]/erasure-status/route.ts`
- The `DELETE` handler on `apps/host/src/app/api/learner/memory/route.ts`
  (the `GET` read surface is untouched).

**Frontend pages/components** (orphaned by the route removals above):
- `apps/host/src/app/settings/account/delete/page.tsx` (whole page — the
  30-day cooling-off UI).
- The "Delete Account" row on `apps/host/src/app/settings/page.tsx`.
- `deleteAccountHref` wiring through `apps/host/src/app/me/page.tsx` and
  `packages/ui/src/profile/v2/ProfileScreen.tsx`.
- The danger-zone delete button + already-dead confirm modal on
  `apps/host/src/app/(student)/profile/page.tsx` (this modal's trigger was
  unreachable before this change too — dead code, not new scope).
- `packages/ui/src/parent/ChildDataErasureSection.tsx` (guardian child-erasure
  CTA + dialog) and its usage in `apps/host/src/app/parent/children/page.tsx`.
- `packages/ui/src/memory/ErasePanel.tsx` (per-layer Foxy memory erase panel)
  and its usage + the now-unreachable `erasurePending` full-screen state on
  `apps/host/src/app/(student)/memory/page.tsx`.

**Edge Functions:**
- `supabase/functions/account-purge/`
- `supabase/functions/data-erasure-purger/`

**Library code:**
- `packages/lib/src/memory/erasure-guard.ts` (zero callers, confirmed above).
- `packages/lib/src/data-erasure-purger.ts` (zero importers).
- `packages/lib/src/deletion-cache-invalidation.ts` (zero importers — was
  meant to run after account-purge but was never wired up).
- `ACCOUNT_DELETE` / `MEMORY_ERASE_OWN` constants in `packages/lib/src/rbac.ts`.
- The DPDP erasure-guard short-circuit in
  `apps/host/src/lib/memory/student-memory.ts` (`getStudentMemory` no longer
  pre-checks erasure-pending state before reading memory).
- The three `parent.child_erasure_*` event-kind schemas in
  `packages/lib/src/state/events/registry.ts` (and their Deno mirror in
  `supabase/functions/_shared/state-runtime/events-registry.ts`), and the
  corresponding dead `switch` case in
  `packages/lib/src/state/journey/journey.ts`.

**Tests deleted** (dedicated coverage for the above):
`account-deletion.test.ts`, `parent-child-erasure.test.ts`,
`account-purge.test.ts`, `data-erasure-purger-scoped-skip.test.ts`,
`data-erasure-purger.test.ts`, `erasure-guard.test.ts`,
`parent-erasure-rpc-migration.test.ts`.

**Tests updated** to drop erasure-flow coverage while keeping the surrounding
feature's tests intact: `learner-memory.test.ts`, `student-memory.test.ts`,
`memory-page.test.tsx`, `ProfileScreen.test.tsx`,
`parent-children-data-load-error.test.tsx`, `pp5-unlinked-deny.test.ts`,
`edge-function-auth-guard-sweep.test.ts`,
`flag-posture-canary-cron-pin.test.ts`, `test-env-hermeticity.test.ts`,
`rls-no-cross-table-recursion.test.ts`, `events-registry.test.ts`,
`xc3-service-role-migration-batch.test.ts`, `api-admin-client-allowlist.test.ts`.

## RBAC impact

N/A beyond the permission-row deletion above — `account.delete` and
`memory.erase_own` are gone from `permissions`/`role_permissions`; no other
permission code was touched, and no role gained or lost any other grant.

## Config / ledger updates

- `apps/host/vercel.json`: removed the `account-purge` cron entry.
- `.github/workflows/production-cron-runner.yml`: removed `account-purge`
  from the break-glass dispatch options and allowlist.
- `scripts/route-access-manifest.json`,
  `scripts/admin-client-allowlist.json` (count 275 → 273),
  `scripts/xc3-service-role-migration-batch.json`,
  `scripts/edge-function-manifest.json`,
  `scripts/deploy/deploy_functions.sh` (45 → 43 active functions),
  `scripts/job-registry.json`, `scripts/product-surface-matrix.json`,
  `eval/tenant-isolation/baseline.json`: pruned every entry referencing the
  removed routes, Edge Functions, or cron job.
- `packages/lib/src/flags/protected-flags.ts`: corrected the
  `ff_unified_memory_v1` staged-rollout reason, which cited the now-removed
  erasure-pending interlock as an open blocker.
- `docs/architecture/EVENT_CATALOG.md`: marked the three
  `parent.child_erasure_*` event kinds removed.

## Dual-host impact

None. This subsystem had no school-tenant-specific behavior — it operated
identically across every tenant on the shared platform, so there is no
per-host reconciliation needed.

## Rollback

The DB migration is a straight `DROP` — there is no automated rollback.
Recovery, if ever needed, means re-authoring the tables/RPCs/permissions from
the historical migrations (`20260505120000_account_deletion_flow.sql`,
`20260527000006_data_erasure_requests.sql` and its successors) and
re-implementing the deleted app code from git history. Given 0 live rows at
removal time, there is no data to restore.

## Verification

- `tsc --noEmit` clean across `apps/host` and `packages/lib`.
- `eslint` clean (0 errors; pre-existing unrelated warnings only) across all
  changed files.
- 17 affected test files / 154 tests passing, plus the edge-function-manifest
  and protected-flags suites (110 tests) run clean.
- Live-DB verification post-migration: 0 remaining tables, functions, or
  permission rows for every dropped object.
