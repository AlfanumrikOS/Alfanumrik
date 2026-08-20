# Migration Placeholders — Audit (Phase B.3, 2026-05-16)

## TL;DR

The prod-readiness audit reported "52 SELECT-1 placeholder migrations." After investigation the real count is **10** — the broader 52-count was caught by an over-loose grep that matched legitimate `SELECT 1` subqueries inside `EXISTS()` clauses and similar DDL idioms. All 10 placeholders are **intentional** and **required** for the CI/CD pipeline to function. **None should be deleted.** They are this codebase's documented reconciliation pattern for migrations that were applied to remote environments outside of git.

## Why placeholders exist

The Supabase CLI's `supabase db push --linked --include-all` (used by the Deploy Production workflow) requires a **1:1 match** between local `supabase/migrations/*.sql` files and rows in remote `supabase_migrations.schema_migrations`. When a migration version is present remotely but absent locally, the CLI fails with:

```
Remote migration versions not found in local migrations directory.
```

This can happen when:

1. An operator applies a migration via Supabase MCP / dashboard directly (skipping the git pipeline)
2. An older PR was applied and then deleted from `supabase/migrations/` (rare, but documented case)
3. A staging-only DDL was applied for a tracer-bullet experiment

The placeholder pattern is: commit a file at the exact missing version with a `SELECT 1` no-op body so the CLI sees a local match. Because the version is recorded as applied remotely, the CLI **skips** this file on future runs — the no-op SQL is never executed.

## Inventory (10 placeholders)

| Filename | Origin | Real DDL location | Back-fill priority | E.2 annotation |
|---|---|---|---|---|
| `20260509130000_mcp_applied_placeholder.sql` | MCP-applied to staging | Unknown — staging only | Low | `lint:allow-placeholder` (intentional) |
| `20260510035233_restore_grant_execute_overrevoked_client_rpcs.sql` | MCP-applied to staging during PR #678/#679/#681 series | `GRANT EXECUTE` on client RPCs (recoverable via `\df+` in psql) | Medium | `lint:allow-placeholder` (intentional — sibling `20260510033000_…` holds canonical body) |
| `20260510050527_agent_traces.sql` | MCP-applied during PR #683 | `agent_traces` table DDL (visible in current prod schema) | Medium | `lint:allow-placeholder` (intentional — sibling `20260510043216_…` holds canonical body) |
| `20260510065248_qb_fixer.sql` | MCP-applied during PR #686 | QB fixer agent tables | Medium | `lint:allow-placeholder` (intentional — sibling `20260510064952_…` holds canonical body) |
| `20260510070057_qb_fixer_fix_review_feedback.sql` | MCP-applied after initial qb_fixer | Review-feedback fix to QB fixer | Low | `lint:allow-placeholder` (intentional — fixes folded back into `20260510064952_qb_fixer.sql`) |
| `20260512065502_reconcile_phantom.sql` | Phantom from PR #749 | None — was the phantom itself | None (no DDL behind it) | `lint:allow-placeholder` (intentional — placeholder IS the fix) |
| `20260512065503_reconcile_phantom.sql` | Companion phantom | None | None | `lint:allow-placeholder` (intentional — placeholder IS the fix) |
| `20260513120000_promote_ncert_exercises_skip_duplicates.sql` | PR #658 follow-up superseded | Logic moved to a later migration | None (intentionally retired) | `lint:allow-placeholder` (intentional — logic merged into `20260513000000_…`) |
| `20260525130001_security_and_performance_advisor_batch1.sql` | Supabase Advisor recommendations applied directly | Security + performance indexes | **HIGH** | `lint:allow-placeholder` + `TODO(phase-e2): write body` — recover DDL via `pg_dump` |
| `20260525130002_api_query_path_indexes_batch2.sql` | Supabase Advisor batch 2 | API query-path indexes | **HIGH** | `lint:allow-placeholder` + `TODO(phase-e2): write body` — recover DDL via `pg_dump` |

### E.2 annotation summary

Phase E.2 (the CI guard in `scripts/lint-migrations.js`) requires every
no-op `SELECT 1` migration to carry a top-of-file `-- lint:allow-placeholder`
marker. All 10 existing placeholders above were retro-annotated as part of
the lint introduction (PR for Phase E.2):

- **8 intentional** — no DDL behind them, or the DDL is canonically expressed
  in a sibling file. These will remain no-ops indefinitely; the allow-marker
  acknowledges that.
- **2 TODO(phase-e2)** — the advisor-batch placeholders DO have prod DDL
  behind them that needs to be recovered via `pg_dump --schema-only`. They
  carry both the allow-marker (so CI passes today) and a `TODO(phase-e2):
  write body` comment so a future grep finds them.

## What's at risk

1. **Staging/dev environments don't match prod.** A fresh `supabase db reset --linked` against staging will re-create the schema from local migrations only, missing whatever DDL was applied in the placeholder versions. This is the biggest practical problem — when a developer or QA engineer tries to repro a prod bug locally, they're working against a different schema.

2. **Audit trail gaps.** DPDP and SOC-2 reviewers asking "what changed in your schema on 2026-05-10 between 03:52 and 03:53 UTC?" cannot point at a git commit. They have to read prod's `pg_dump`.

3. **Backup/restore parity.** Per Phase D.5 (per-school backup/restore runbook), restore-from-backup currently restores a snapshot, not a re-application of migrations. So the staging-vs-prod schema drift doesn't affect restore — but it does affect "scratch a new region" provisioning.

## Recommended back-fill procedure (per-placeholder)

This is the work to actually close the schema-reproducibility gap. **Out of scope for Phase B** (prod-readiness blockers); recommended for Phase E or a dedicated DBA pass.

For each HIGH-priority placeholder:

1. **Identify the actual DDL.** Compare prod `pg_dump --schema-only` from a date just before and just after the migration timestamp:
   ```bash
   pg_dump --schema-only --no-owner --no-acl \
     "postgres://...prod..." > /tmp/prod-current.sql
   git show <commit-just-before-placeholder>:supabase/migrations/00000000000000_baseline_from_prod.sql \
     > /tmp/baseline.sql
   diff /tmp/baseline.sql /tmp/prod-current.sql > /tmp/drift.sql
   ```
2. **Attribute drift to placeholders.** Walk `/tmp/drift.sql`, attributing each DDL statement to one of the placeholders by date and content.
3. **Replace placeholder body** with the actual DDL, making it idempotent (`CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS / CREATE POLICY`, etc.). Test against a fresh `supabase db reset` on staging.
4. **Open a PR per placeholder** with the recovered DDL. Tag with `tech-debt` / `schema-reconciliation`.

## When to defer back-fill

- The migration was a staging-only experiment that's been superseded → mark with a comment, leave the no-op body.
- The migration was a one-time data fix (not DDL) → leave the no-op body; data fixes are not idempotent and shouldn't be in DDL migrations anyway.
- The migration was a phantom (PR #749 case) → leave it; placeholders ARE the fix.

## Operational guardrails added in Phase E

- **Phase E.2** (shipped): migration-template lint at `scripts/lint-migrations.js`, wired via `.github/workflows/migration-lint.yml` on `pull_request` events that touch `supabase/migrations/**`. Rejects any new file whose body — after stripping comments and whitespace — is a no-op `SELECT 1` flavor (including `SELECT 1 WHERE false`, `SELECT 1::int`, `BEGIN; SELECT 1; COMMIT;`, etc.). Files opt out with a top-of-file `-- lint:allow-placeholder` marker. Existing 10 placeholders are retro-annotated (see "E.2 annotation" column above). Self-test at `scripts/__tests__/lint-migrations.test.sh`.
- **Phase E.1** (already planned): branch-lifecycle GitHub Action that auto-deletes merged branches, reducing the "operator applies via MCP rather than fight a CI failure" temptation.
- **Pre-deploy check** (new ask): a CI job that runs `supabase db reset` on a fresh staging clone and asserts no schema drift against prod. Would catch the drift proactively.

## Exceptions to the placeholder pattern

This section exists because a 2026-08-20 incident (PR #1584) hit the exact
"remote version not found locally" symptom this doc's pattern was written
for, and used a different fix — `supabase migration repair --status
reverted` in CI, run against two hardcoded ghost versions — instead of
committing a placeholder file. That divergence was flagged by review as
needing an explicit, written rationale rather than living only in the PR
author's head. This is that rationale.

**The incident:** staging's ledger had two versions —
`20260814000023` and `20260814000024` — with no corresponding file
anywhere in git history. Full trace and fix in
`docs/runbooks/staging-schema-drift-resolution.md`'s "2026-08-20 — staging
migration ledger drift" section and in
`.github/workflows/sync-staging-migrations.yml`'s own header comment.

**Why a placeholder file was NOT used here, even though the symptom
matches this doc's pattern exactly:**

1. **What actually happened to the DDL is different in kind from the other
   10 instances.** Every placeholder in the inventory above stands in for a
   migration that WAS applied somewhere for real (via MCP/dashboard, or an
   advisor recommendation) and needs a no-op local record so the ledger and
   the filesystem agree that "yes, this happened." The two 2026-08-20
   versions are the opposite: both trace to abandoned/rewritten branches
   whose migration content was deliberately dropped or superseded before
   merge — `20260814000023` was explicitly not recovered (stopped at
   `000022`) and `20260814000024`'s own commit message records it as
   superseded during the same PR's iteration. Nothing about either version
   was ever meant to ship. A `SELECT 1` placeholder would assert "this was
   applied and is accounted for," which is not true — these were never
   supposed to be applied at all; they only exist in staging's ledger as a
   side effect of a preview/branch-deploy apply that predates the
   abandonment. `migration repair --status reverted` — which deletes the
   ledger row, i.e. asserts "this never happened" — is the more accurate
   statement of the two. In that specific narrow sense, a repair step
   arguably has a *stronger* claim to being the honest choice for this
   incident than a placeholder file would.
2. **Blast radius is staging-only.** All 10 cataloged placeholder instances
   above (and the 2026-06-28 precedent that first rejected a repair-in-CI
   approach for this doc's convention) are production-facing, which is why
   the "What's at risk" section above weighs DPDP/SOC-2 audit-trail
   questions ("what changed in your schema on this date, show me the git
   commit") so heavily — a repair step that silently deletes a prod ledger
   row with no git-visible trace is a real audit-trail liability. Staging
   carries materially lower stakes: no regulator or customer data audit
   depends on staging's migration history, so the audit-trail cost that
   motivated the placeholder convention is largely absent here. (The fix
   still documents the repair in git — via the workflow file's own header
   comment plus this doc — so even the staging case isn't audit-trail-free,
   just lower-stakes.)

**This is a judgment call, not a new rule.** Do not read this as "orphan
ghost versions on staging always get repaired, never placeholdered." A
future recurrence of this exact symptom could still be a case where (a) the
orphan version DID carry real, intentional DDL that's now unrecoverable
except via `pg_dump`, in which case the placeholder-plus-backfill pattern
in the rest of this document is almost certainly the right call even on
staging, or (b) the blast radius turns out not to be staging-only after
all. Re-evaluate each occurrence on its own facts — trace the version to
its origin commit/branch first (as PR #1584 did), and only reach for
`migration repair` when that trace shows the DDL was genuinely never meant
to ship, not merely "we don't currently know what it was."

## Related runbooks

- [`2026-04-27-schema-reconciliation.md`](./2026-04-27-schema-reconciliation.md) — the foundational reconciliation walkthrough that this audit builds on
- [`2026-05-03-schema-reproducibility-completion.md`](./2026-05-03-schema-reproducibility-completion.md) — broader schema-reproducibility status report
- [`staging-schema-drift-resolution.md`](./staging-schema-drift-resolution.md) — the 2026-08-20 ledger-drift incident (PR #1584) that motivated the "Exceptions" section above
