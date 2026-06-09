# Database Recovery Artifacts — Alfanumrik Production (shktyoxqhundlvkiwguu)

**Date**: 2026-06-14  
**Author**: architect agent  
**Context**: Three root causes were identified requiring recovery artifacts. No SQL has been executed against production as part of creating these files. This is a WRITE ARTIFACTS ONLY package.

---

## Root Causes Addressed

### RC-1: Two hollow tombstone migrations — DDL never applied

`20260525130001_security_and_performance_advisor_batch1.sql` and  
`20260525130002_api_query_path_indexes_batch2.sql` were applied to production as empty no-ops (`statements = []` in `supabase_migrations.schema_migrations`). The security advisor recommendations (function `search_path` hardening) and API query-path indexes they should have created were NEVER executed on any environment.

**Fix**: New migration `20260614200000_repair_security_advisor_batch1.sql` and `20260614200001_repair_api_query_path_indexes.sql` recover this work.

### RC-2: 17 migrations with potential bare DROP statements

Migrations applied after the baseline (2026-05-03) were audited for bare DROP statements that would fail on fresh-environment bootstrap. Upon systematic re-reading, all 17 identified files already use idempotent patterns (IF EXISTS guards, exception handlers, or CREATE TABLE IF NOT EXISTS). The bootstrap risk is lower than originally assessed.

**Fix**: `20260614200002_bootstrap_idempotency_harness.sql` documents the audit findings and provides spot-check verification.

### RC-3: 3 migrations with ADD COLUMN without IF NOT EXISTS

Upon re-reading, all three flagged files (20260504100200, 20260510000000, 20260511000000) already use idempotent patterns (ADD COLUMN IF NOT EXISTS or `EXCEPTION WHEN duplicate_column`). No file edits were needed.

---

## Files in This Package

| File | Type | Purpose | Execution Order |
|---|---|---|---|
| `00_README.md` | Documentation | This file | — |
| `01_diagnose_migration_state.sql` | Diagnostic | Read-only health check | Run FIRST |
| `02_validate_schema_completeness.sql` | Validation | Critical object existence | Step 2 |
| `03_validate_foreign_keys.sql` | Validation | FK orphan check | Step 3 |
| `04_validate_indexes.sql` | Validation | Repair index presence | Step 4 |
| `05_validate_triggers.sql` | Validation | Trigger presence check | Step 5 |
| `06_validate_rls_policies.sql` | Validation | RLS coverage check | Step 6 |
| `07_validate_auth_dependencies.sql` | Validation | Auth.users FK sanity | Step 7 |
| `08_validate_storage_dependencies.sql` | Validation | Storage bucket check | Step 8 |
| `09_validate_edge_function_rpcs.sql` | Validation | RPC signature check | Step 9 |
| `10_rollback_repair_migrations.sql` | Rollback | Undo repair migrations | Emergency only |
| `11_emergency_rollback.sh` | Rollback | Shell rollback helper | Emergency only |
| `12_test_fresh_bootstrap.sh` | Test | Verify fresh-env bootstrap | Post-deploy |

---

## Execution Order

### Phase 1: Diagnose (read-only, safe to run anytime)

```sql
-- In Supabase SQL editor (prod project shktyoxqhundlvkiwguu):
-- Run 01_diagnose_migration_state.sql
-- Run 02_validate_schema_completeness.sql
-- Run 03_validate_foreign_keys.sql
```

### Phase 2: Deploy repair migrations (via normal CI/CD pipeline)

```
git add supabase/migrations/20260614200000_repair_security_advisor_batch1.sql
git add supabase/migrations/20260614200001_repair_api_query_path_indexes.sql
git add supabase/migrations/20260614200002_bootstrap_idempotency_harness.sql
git commit -m "fix(migrations): repair hollow tombstone migrations RC-1 and RC-2"
# Push to main → Vercel deploy → supabase db push --linked --include-all runs in CI
```

### Phase 3: Post-deploy validation

```sql
-- In Supabase SQL editor after repair migrations apply:
-- Run 04_validate_indexes.sql     (confirm repair indexes landed)
-- Run 05_validate_triggers.sql    (confirm triggers present)
-- Run 06_validate_rls_policies.sql
-- Run 07_validate_auth_dependencies.sql
-- Run 08_validate_storage_dependencies.sql
-- Run 09_validate_edge_function_rpcs.sql
```

### Phase 4: Fresh-bootstrap test (optional but recommended before DR drill)

```bash
bash scripts/recovery/12_test_fresh_bootstrap.sh
```

---

## Safety Guarantees

1. **No destructive SQL** — no DROP TABLE, TRUNCATE, or DELETE outside explicitly-labelled rollback sections.
2. **All repair migrations are idempotent** — safe to run multiple times.
3. **ALTER FUNCTION SET search_path** is metadata-only; does not change function body.
4. **CREATE INDEX IF NOT EXISTS** never blocks DML and never fails if index exists.
5. **Diagnostic scripts are read-only** — cannot modify any data.

---

## Rollback Plan Summary

If a repair migration causes a problem:

1. **For 20260614200000** (search_path pins): Run Section A of `10_rollback_repair_migrations.sql` to RESET search_path on affected functions.
2. **For 20260614200001** (indexes): Run Section B to DROP the repair indexes.
3. **For 20260614200002** (harness): Contains no schema objects; nothing to roll back.

Full instructions: `10_rollback_repair_migrations.sql`.
