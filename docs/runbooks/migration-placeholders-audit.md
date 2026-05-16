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

| Filename | Origin | Real DDL location | Back-fill priority |
|---|---|---|---|
| `20260509130000_mcp_applied_placeholder.sql` | MCP-applied to staging | Unknown — staging only | Low |
| `20260510035233_restore_grant_execute_overrevoked_client_rpcs.sql` | MCP-applied to staging during PR #678/#679/#681 series | `GRANT EXECUTE` on client RPCs (recoverable via `\df+` in psql) | Medium |
| `20260510050527_agent_traces.sql` | MCP-applied during PR #683 | `agent_traces` table DDL (visible in current prod schema) | Medium |
| `20260510065248_qb_fixer.sql` | MCP-applied during PR #686 | QB fixer agent tables | Medium |
| `20260510070057_qb_fixer_fix_review_feedback.sql` | MCP-applied after initial qb_fixer | Review-feedback fix to QB fixer | Low |
| `20260512065502_reconcile_phantom.sql` | Phantom from PR #749 | None — was the phantom itself | None (no DDL behind it) |
| `20260512065503_reconcile_phantom.sql` | Companion phantom | None | None |
| `20260513120000_promote_ncert_exercises_skip_duplicates.sql` | PR #658 follow-up superseded | Logic moved to a later migration | None (intentionally retired) |
| `20260525130001_security_and_performance_advisor_batch1.sql` | Supabase Advisor recommendations applied directly | Security + performance indexes | **HIGH** |
| `20260525130002_api_query_path_indexes_batch2.sql` | Supabase Advisor batch 2 | API query-path indexes | **HIGH** |

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

- **Phase E.2** (already planned): migration-template lint that rejects `SELECT 1` bodies on new PRs. Existing 10 placeholders pre-date the lint and are explicitly allowlisted by filename pattern.
- **Phase E.1** (already planned): branch-lifecycle GitHub Action that auto-deletes merged branches, reducing the "operator applies via MCP rather than fight a CI failure" temptation.
- **Pre-deploy check** (new ask): a CI job that runs `supabase db reset` on a fresh staging clone and asserts no schema drift against prod. Would catch the drift proactively.

## Related runbooks

- [`2026-04-27-schema-reconciliation.md`](./2026-04-27-schema-reconciliation.md) — the foundational reconciliation walkthrough that this audit builds on
- [`2026-05-03-schema-reproducibility-completion.md`](./2026-05-03-schema-reproducibility-completion.md) — broader schema-reproducibility status report
