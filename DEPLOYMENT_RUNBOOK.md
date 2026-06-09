# Alfanumrik Production Deployment Runbook

**Last updated:** 2026-06-09

---

## Overview

Alfanumrik uses a CI-independent deployment model. GitHub Actions is billing-blocked and no longer handles deployments. The Vercel GitHub App handles frontend deploys automatically on every push to `main`. Database migrations and Edge Functions are deployed manually by the engineer from a local machine using the Supabase CLI. This gives full control over when schema changes reach production and makes it easy to run pre/post checks.

---

## Architecture

```
Developer machine
  │
  ├── git push → GitHub (source control only)
  │                │
  │                └── Vercel GitHub App → Production frontend (automatic)
  │                     https://www.alfanumrik.com
  │
  ├── supabase db push ──────────────────────────────────────────────────────┐
  │   (scripts/deploy/deploy_database.sh)                                    │
  │                                                                          ▼
  └── supabase functions deploy ──────────────────────────────────────────── Production DB
      (scripts/deploy/deploy_functions.sh)                    project: shktyoxqhundlvkiwguu
```

Vercel deploys happen without any action from you. DB migrations and Edge Functions require the manual steps below.

---

## Prerequisites

### Required tools

| Tool | Install | Version check |
|---|---|---|
| Supabase CLI | `brew install supabase/tap/supabase` (macOS/Linux) | `supabase --version` |
| | `scoop install supabase` (Windows) | |
| | `npm install -g supabase` (any platform) | |
| git | System git | `git --version` |
| curl | Usually pre-installed | `curl --version` |
| psql | Needed for rollback only. `brew install libpq` | `psql --version` |

### Required credentials

| Variable | Required | Where to get it |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | Yes | https://app.supabase.com/account/tokens → Generate new token |
| `SUPABASE_DB_PASSWORD` | Yes (migrations) | Supabase dashboard → Project Settings → Database → Password |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (verify script) | Supabase dashboard → Project Settings → API → service_role |
| `SUPABASE_PROJECT_REF` | No (defaults to `shktyoxqhundlvkiwguu`) | Already in scripts |
| `PRODUCTION_URL` | No (defaults to `https://www.alfanumrik.com`) | N/A |
| `SUPABASE_DB_URL` | Rollback only | `postgresql://postgres:[DB_PASSWORD]@db.shktyoxqhundlvkiwguu.supabase.co:5432/postgres` |

Export these in your shell or add to a local `.env.deploy` file (do not commit):

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
export SUPABASE_DB_PASSWORD="..."
export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
```

### Required Git state

- Must be on the `main` branch
- Must be up to date with remote: `git pull origin main`
- Working tree must be clean: `git status` should show nothing uncommitted

---

## Standard Deployment Procedure

### Step 1: Pre-deployment checks

```bash
# Confirm you are on main and up to date
git checkout main
git pull origin main
git status  # should show: nothing to commit, working tree clean
```

Run the backup/health diagnostic in the Supabase SQL editor:
- Open: https://app.supabase.com/project/shktyoxqhundlvkiwguu/sql/new
- Run: `scripts/recovery/01_backup.sql`
- Expected: no long-running transactions, DB responding normally

Confirm no long-running transactions:
```sql
SELECT pid, now() - query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND query_start < now() - interval '30 seconds'
ORDER BY duration DESC;
```
If any rows appear, wait for them to complete before proceeding.

---

### Step 2: Deploy database migrations

```bash
bash scripts/deploy/deploy_database.sh
```

**What it does:**
- Links the Supabase CLI to project `shktyoxqhundlvkiwguu`
- Runs `supabase db push --linked --include-all` to apply all pending migrations
- Logs duration, git SHA, and exit code to `scripts/deploy/.last_deploy.log`

**To preview without applying (dry run):**
```bash
DRY_RUN=1 bash scripts/deploy/deploy_database.sh
```

**Expected output (success):**
```
[OK]   Linked to project shktyoxqhundlvkiwguu
[OK]   All migrations applied successfully.
Next steps:
  1. Validate the schema: run scripts/recovery/04_validation.sql
  2. Deploy Edge Functions: bash scripts/deploy/deploy_functions.sh
```

**If it fails:**
The script prints the SQLSTATE code and specific recovery guidance. See the Troubleshooting section below for common errors.

---

### Step 3: Validate database

After migrations apply, confirm schema integrity:

1. Open the Supabase SQL editor: https://app.supabase.com/project/shktyoxqhundlvkiwguu/sql/new
2. Paste and run: `scripts/recovery/04_validation.sql`
3. Expected output: `VALIDATION PASSED N/M checks`

If any checks fail, do not proceed to Edge Function deployment. Investigate the failure using `scripts/recovery/02_drift_report.sql`.

---

### Step 4: Deploy Edge Functions

**Deploy only the 7 changed functions (normal deployment):**
```bash
bash scripts/deploy/deploy_functions.sh
```

**Deploy all 46 functions (takes ~10 minutes — use when in doubt):**
```bash
bash scripts/deploy/deploy_functions.sh --all
```

**Deploy a single function:**
```bash
bash scripts/deploy/deploy_functions.sh --function monthly-synthesis-builder
```

**Expected output (success):**
```
PASS  bulk-non-mcq-gen
PASS  extract-ncert-questions
PASS  grade-experiment-conclusion
PASS  monthly-synthesis-builder
PASS  nep-compliance
PASS  parent-report-generator
PASS  verify-question-bank
---------------------------------------------------------------
Total: 7 | 7 succeeded | 0 failed
```

If a function fails, the script continues deploying the others and prints a retry command at the end.

---

### Step 5: Verify production

```bash
bash scripts/deploy/verify_production.sh
```

This runs 6 checks:
1. `GET /api/health` → expects 200
2. `GET /api/auth/session` → expects 200 or 401
3. `GET /api/foxy` → expects 401 (not 500, not 404)
4. `POST /rest/v1/rpc/get_school_overview` (dummy UUID) → confirms function exists
5. `GET /rest/v1/feature_flags` → expects 200 with rows
6. Migration dry-run → expects 0 pending

**Expected output:**
```
[PASS]  Health endpoint — 200 OK
[PASS]  Auth session endpoint — 401 (expected 200 or 401)
[PASS]  Foxy route — 401 (auth required, as expected)
[PASS]  get_school_overview RPC — function exists (status 200)
[PASS]  Feature flags — 200 OK with data rows
[PASS]  Migration status — 0 pending migrations

OVERALL: PASS
```

If any check fails, do not mark the deployment complete. Follow the Troubleshooting section.

---

## Emergency: Rollback

### Roll back all pending migrations

Use this when a migration batch caused a production incident and needs to be completely reverted.

```bash
bash scripts/deploy/rollback.sh --all-pending
```

Or manually in the Supabase SQL editor:
1. Open: https://app.supabase.com/project/shktyoxqhundlvkiwguu/sql/new
2. Paste and run: `scripts/recovery/05_rollback.sql`
3. Then remove versions from migration history:
   ```sql
   DELETE FROM supabase_migrations.schema_migrations
   WHERE version IN (
     '20260604100000','20260605000000','20260606000000','20260607000000',
     '20260608000000','20260609000000','20260609100000','20260609110000',
     '20260609120000','20260609130000','20260609140000','20260609150000',
     '20260609160000'
   );
   ```

### Roll back a specific migration

```bash
bash scripts/deploy/rollback.sh --migration 20260614200001
```

### After any rollback

1. Run `scripts/recovery/04_validation.sql` — confirm schema is consistent
2. Run `bash scripts/deploy/verify_production.sh` — confirm 0 pending migrations
3. Fix the migration that failed before re-deploying

---

## Recovering from Migration Failure

### SQLSTATE 42883: undefined_function in ALTER FUNCTION

**Symptom:** Migration fails with `ERROR: function "some_function_name" does not exist (SQLSTATE 42883)`

**Root cause:** A migration uses `ALTER FUNCTION` or calls a function that was created by a later migration in the chain, or the function was never created (guard migration skipped it).

**Fix:**
1. Check whether the function exists:
   ```sql
   SELECT proname, proargtypes FROM pg_proc WHERE proname LIKE '%function_name%';
   ```
2. If missing, check the migration that creates it. Apply that migration first.
3. If the migration uses a dynamic `pg_proc` loop to conditionally alter functions, confirm the loop guard condition matches the actual function signature.
4. Reference: `scripts/recovery/07_validate_auth_dependencies.sql` for function dependency checks.

### Migration partially applied

**Symptom:** Migration appears in `schema_migrations` as applied but the schema is incomplete.

**Steps:**
1. Check what was actually applied:
   ```sql
   SELECT version, checksum FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20;
   ```
2. Determine the last fully successful version.
3. Identify which objects are missing: run `scripts/recovery/02_drift_report.sql`
4. Apply the missing objects via `scripts/recovery/03_repair_migrations.sql` or by re-running individual SQL statements.
5. If the partial state needs to be re-run cleanly, remove the version from history and re-push:
   ```sql
   DELETE FROM supabase_migrations.schema_migrations WHERE version = 'YYYYMMDDHHMMSS';
   ```
   Then: `DRY_RUN=1 bash scripts/deploy/deploy_database.sh` to preview, then apply.

### Production schema drift detected

**Symptom:** API endpoints return errors referencing missing columns or tables that should exist.

**Steps:**
1. Run `scripts/recovery/02_drift_report.sql` — lists expected vs. actual objects
2. Identify which migration(s) are responsible for the missing objects
3. Apply the missing migrations via `bash scripts/deploy/deploy_database.sh`
4. If the migration was marked applied but didn't run cleanly, use the repair path above

---

## Daily Operations

### Check production migration status

In the Supabase SQL editor, run:
```sql
SELECT version, checksum
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 10;
```

Or run the full diagnostic: `scripts/recovery/01_diagnose_migration_state.sql`

### Verify Edge Function health

1. Open the Supabase dashboard: https://app.supabase.com/project/shktyoxqhundlvkiwguu/functions
2. Click any function to see recent invocations and error logs
3. For real-time logs: use the Supabase CLI:
   ```bash
   supabase functions logs FUNCTION_NAME --project-ref shktyoxqhundlvkiwguu
   ```

### Force-redeploy a single Edge Function

```bash
bash scripts/deploy/deploy_functions.sh --function grounded-answer
```

### Deploy functions changed since a specific commit

```bash
bash scripts/deploy/deploy_functions.sh --changed-since abc1234
```

---

## Troubleshooting

| Symptom | Likely Cause | Resolution | Script |
|---|---|---|---|
| API returns 500 on school admin endpoints (`/api/v1/admin/*`) | Tables or RPCs from pending migrations not applied | Apply pending migrations | `bash scripts/deploy/deploy_database.sh` |
| `supabase db push` fails with SQLSTATE 42883 | Function referenced in `ALTER FUNCTION` does not exist yet — signature mismatch or creation ordering issue | Check `pg_proc` for actual function signature; verify dynamic loop guard condition in migration | `scripts/recovery/07_validate_auth_dependencies.sql` |
| Edge Function returns 404 | Function not deployed or deployment failed | Redeploy the function | `bash scripts/deploy/deploy_functions.sh --function NAME` |
| Feature flag missing from super-admin console | Feature flag INSERT migration not applied | Apply the `2026060910xxxx_python_*_flag` migrations | `bash scripts/deploy/deploy_database.sh` |
| GitHub Actions CI failing | Billing blocked — GH Actions is not used for deployment | No action needed for deployment. Resolve billing at github.com/organizations/AlfanumrikOS/settings/billing if CI lint/test gates are needed | Not needed for deployment |
| `verify_production.sh` check 4 fails (42883 on RPC) | `get_school_overview` function not applied | Apply `20260604100000_classroom_integration_and_teacher_planner.sql` | `bash scripts/deploy/deploy_database.sh` |
| Migration dry-run shows pending after deploy | Supabase CLI cache stale or `--linked` flag not used | Re-link and retry: `supabase link --project-ref shktyoxqhundlvkiwguu --password $SUPABASE_DB_PASSWORD` | — |
| Rollback script says "no pending file found" | No automated rollback SQL for that version | Write compensating SQL manually; guidance printed by the script | `scripts/recovery/05_rollback.sql` for batch rollback |

---

## Appendix: All Pending Migrations (as of 2026-06-09)

13 migrations pending. All are LOW risk (feature flags, new columns, new tables with RLS). All are idempotent.

| Version | Filename | Purpose | Risk | Idempotent |
|---|---|---|---|---|
| 20260604100000 | `classroom_integration_and_teacher_planner.sql` | Classroom integration schema + teacher planner tables | LOW | YES |
| 20260605000000 | `fix_board_subject_chapter_gaps.sql` | Backfill missing board/subject/chapter mapping rows | LOW | YES |
| 20260606000000 | `phase5_phase6_python_flags.sql` | Feature flags for Python AI Phase 5 and 6 | LOW | YES |
| 20260607000000 | `micro_telemetry_and_cognitive_gaps.sql` | Micro-telemetry events table + cognitive gap tracking | LOW | YES |
| 20260608000000 | `streak_freeze_and_curriculum.sql` | Streak freeze mechanic + curriculum mapping table | LOW | YES |
| 20260609000000 | `lesson_flow_and_parameters.sql` | Lesson flow state table + tunable parameters | LOW | YES |
| 20260609100000 | `python_monthly_synthesis_builder_flag.sql` | Feature flag: `ff_python_monthly_synthesis_builder` | LOW | YES |
| 20260609110000 | `python_nep_compliance_flag.sql` | Feature flag: `ff_python_nep_compliance` | LOW | YES |
| 20260609120000 | `python_parent_report_generator_flag.sql` | Feature flag: `ff_python_parent_report_generator` | LOW | YES |
| 20260609130000 | `python_grade_experiment_conclusion_flag.sql` | Feature flag: `ff_python_grade_experiment_conclusion` | LOW | YES |
| 20260609140000 | `python_verify_question_bank_flag.sql` | Feature flag: `ff_python_verify_question_bank` | LOW | YES |
| 20260609150000 | `python_extract_ncert_questions_flag.sql` | Feature flag: `ff_python_extract_ncert_questions` | LOW | YES |
| 20260609160000 | `python_bulk_non_mcq_gen_flag.sql` | Feature flag: `ff_python_bulk_non_mcq_gen` | LOW | YES |

---

## Appendix: Edge Function Change Log (2026-06-09)

7 functions changed since last deploy. All gated by feature flags (default OFF).

| Function | Commit | Description |
|---|---|---|
| `bulk-non-mcq-gen` | PR #982 | Port to Python Cloud Run stub (Phase 2); default OFF via `ff_python_bulk_non_mcq_gen` |
| `extract-ncert-questions` | PR #982 | Port to Python Cloud Run stub (Phase 2); default OFF via `ff_python_extract_ncert_questions` |
| `grade-experiment-conclusion` | PR #979 | Port to Python Cloud Run (rule-based); default OFF via `ff_python_grade_experiment_conclusion` |
| `monthly-synthesis-builder` | PR #979 | Python Cloud Run port; default OFF via `ff_python_monthly_synthesis_builder` |
| `nep-compliance` | PR #981 | Python Cloud Run stub; default OFF via `ff_python_nep_compliance` |
| `parent-report-generator` | PR #981 | Python Cloud Run stub; default OFF via `ff_python_parent_report_generator` |
| `verify-question-bank` | PR #981 | Python Cloud Run stub; default OFF via `ff_python_verify_question_bank` |

---

## Appendix: Environment Variables Reference

| Variable | Required by | Required | Where to get |
|---|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | `deploy_database.sh`, `deploy_functions.sh` | Yes | https://app.supabase.com/account/tokens |
| `SUPABASE_DB_PASSWORD` | `deploy_database.sh` | Yes | Supabase dashboard → Project Settings → Database → Password |
| `SUPABASE_PROJECT_REF` | All scripts | No (default: `shktyoxqhundlvkiwguu`) | Visible in Supabase dashboard URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `verify_production.sh` | Yes | Supabase dashboard → Project Settings → API → `service_role` |
| `NEXT_PUBLIC_SUPABASE_URL` | `verify_production.sh` | No (derived from `PROJECT_REF`) | Supabase dashboard → Project Settings → API |
| `PRODUCTION_URL` | `verify_production.sh` | No (default: `https://www.alfanumrik.com`) | N/A |
| `SUPABASE_DB_URL` | `rollback.sh` | Only for automated rollback | `postgresql://postgres:[DB_PASSWORD]@db.shktyoxqhundlvkiwguu.supabase.co:5432/postgres` |
| `DATABASE_URL` | `rollback.sh` | Alternative to `SUPABASE_DB_URL` | Same format as above |
