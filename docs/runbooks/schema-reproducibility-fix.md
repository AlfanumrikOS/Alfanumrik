# Schema Reproducibility Fix — P0 Runbook

> **Status: automatable.** This runbook ships alongside `.github/workflows/schema-reproducibility-fix.yml` so it can be driven entirely from CI. Operator is *not* required to run any local commands. Owner: architect (DB) + ops (oversight).

## Problem statement

The repo's `supabase/migrations/` tree (349 files at time of writing) is no longer reproducible from a clean Postgres. Some early migrations reference objects that were created out-of-band (Supabase managed extensions, dashboard-applied policies, hand-edited prod state) or rely on `_legacy` history that has been pruned. The CI integration-tests job that runs `supabase db reset` against a scratch project fails on these old files.

Symptom: `Integration Tests (live DB)` job reports "relation does not exist" or "function ... does not exist" partway through the migration replay; PRs cannot get a green DB job; deploys still work because prod already has the schema.

## Solution: Option B — baseline from prod

Capture the live prod schema, sanitize it, ship it as `00000000000000_baseline_from_prod.sql`, and pre-mark it applied on prod + staging so neither environment re-executes it. From then on:

- Fresh DB (CI scratch project, local dev): apply baseline + every migration after it. All 349 dependencies satisfied.
- Prod / staging: baseline row already in `supabase_migrations.schema_migrations` so `db push` skips it.

**Effort if done manually:** 3.5–4.5h focused operator time. **With the workflow:** 5 `gh workflow run` invocations, ~25 min wall-clock.

## Sections

1. Capture (`pg_dump --schema-only` + Supabase CLI)
2. Sanitization sed transforms — **load-bearing**, must match the workflow exactly
3. File header (capture metadata)
4. Local validation (Supabase local stack on CI runner)
5. Staging validation (rehearsal)
6. PR review and merge
7. Pre-mark applied on staging
8. Pre-mark applied on prod
9. Verify (zero pending migrations on both envs)
10. Rollback
11. Automated execution (the GitHub Actions workflow)

---

## Section 1: Capture

```bash
# Supabase CLI path (preferred — auto-handles auth + connection pooling)
supabase db dump \
  --project-ref "$PROD_PROJECT_REF" \
  --db-url "$PROD_DB_URL" \
  --schema public \
  --schema extensions \
  -f baseline.raw.sql

# Fallback: direct pg_dump if the CLI fails
pg_dump --schema-only --no-owner --no-privileges \
  --schema=public --schema=extensions \
  "$PROD_DB_URL" > baseline.raw.sql
```

Sanity: file size 500 KB – 5 MB, zero `INSERT INTO`, zero `COPY`. Anything outside that envelope means the dump captured data, not just schema — fail fast.

## Section 2: Sanitization sed transforms

These run in order. Each writes a new file (`baseline.step1.sql`, `baseline.step2.sql`, …) so a regex bug is debuggable from artifacts.

The goal: produce a file that is **safe to apply against a fresh Postgres** (no role assumptions, no Supabase-internal identifiers we don't own) AND **idempotent** (re-running it on top of itself or on prod is a no-op).

### Step 1 — Strip ownership/privilege noise

`pg_dump` emits per-object `ALTER ... OWNER TO ...` and `GRANT/REVOKE` lines that target Supabase internal roles. None of those exist on a clean local PG, and Supabase manages them anyway via dashboard.

```bash
sed -E '/^ALTER (TABLE|FUNCTION|TYPE|SCHEMA|SEQUENCE|VIEW|MATERIALIZED VIEW|DOMAIN|AGGREGATE|FOREIGN TABLE|PROCEDURE|ROUTINE|PUBLICATION|SUBSCRIPTION|EVENT TRIGGER|COLLATION|CONVERSION|EXTENSION|TEXT SEARCH (PARSER|DICTIONARY|TEMPLATE|CONFIGURATION)|OPERATOR( CLASS| FAMILY)?|TRIGGER|RULE|FOREIGN DATA WRAPPER|SERVER|USER MAPPING|CAST|LARGE OBJECT|DEFAULT PRIVILEGES) .* OWNER TO .*;$/d' \
  baseline.step1.sql > baseline.step2.sql

sed -E '/^(GRANT|REVOKE) .* (ON|FROM|TO) /d' \
  baseline.step2.sql > baseline.step3.sql
```

### Step 2 — Strip `pg_dump` boilerplate that can't run on a fresh DB

```bash
sed -E '/^SET (default_table_access_method|default_tablespace|lock_timeout|idle_in_transaction_session_timeout|row_security|statement_timeout|client_min_messages|standard_conforming_strings|check_function_bodies|xmloption|client_encoding) /d' \
  baseline.step3.sql > baseline.step4.sql

sed -E '/^SELECT pg_catalog\.set_config/d' \
  baseline.step4.sql > baseline.step5.sql
```

### Step 3 — Make extension creation idempotent

`CREATE EXTENSION` is not idempotent without `IF NOT EXISTS`. Supabase preinstalls the common ones, so applying the file twice (or against a Supabase-bootstrapped DB) must be safe.

```bash
sed -E 's/^CREATE EXTENSION ([^ ]+) WITH SCHEMA ([^;]+);$/CREATE EXTENSION IF NOT EXISTS \1 WITH SCHEMA \2;/' \
  baseline.step5.sql > baseline.step6.sql

sed -E 's/^CREATE EXTENSION ([^ ;]+);$/CREATE EXTENSION IF NOT EXISTS \1;/' \
  baseline.step6.sql > baseline.step7.sql
```

### Step 4 — Make schema/type/function creation idempotent where possible

`CREATE SCHEMA` and `CREATE TYPE` need `IF NOT EXISTS` (PG 15+ supports `CREATE TYPE ... AS ENUM` but not all forms — wrap the unsafe forms in `DO $$` blocks instead).

```bash
sed -E 's/^CREATE SCHEMA ([a-zA-Z_][a-zA-Z0-9_]*);$/CREATE SCHEMA IF NOT EXISTS \1;/' \
  baseline.step7.sql > baseline.step8.sql
```

For `CREATE TYPE`, wrap each in a `DO $$` so duplicate types are skipped:

```bash
awk '
  /^CREATE TYPE / && !/AS ENUM/ {
    print "DO $$ BEGIN"
    sub(/^CREATE TYPE /, "  CREATE TYPE ")
    print
    print "EXCEPTION WHEN duplicate_object THEN NULL;"
    print "END $$;"
    next
  }
  /^CREATE TYPE .* AS ENUM/ {
    # ENUM types span multiple lines; capture until the closing );
    block = $0
    while (block !~ /\);[[:space:]]*$/) {
      getline next_line
      block = block "\n" next_line
    }
    print "DO $$ BEGIN"
    print block
    print "EXCEPTION WHEN duplicate_object THEN NULL;"
    print "END $$;"
    next
  }
  { print }
' baseline.step8.sql > baseline.step9.sql
```

### Step 5 — Drop publication / subscription lines (Supabase-managed)

```bash
sed -E '/^CREATE PUBLICATION /d; /^ALTER PUBLICATION /d; /^CREATE SUBSCRIPTION /d' \
  baseline.step9.sql > baseline.step10.sql
```

### Step 6 — Strip `\restrict` / `\unrestrict` psql meta-commands

These appear in newer `pg_dump` output and aren't valid SQL when fed through Supabase migrate.

```bash
sed -E '/^\\restrict /d; /^\\unrestrict /d; /^\\connect /d' \
  baseline.step10.sql > baseline.step11.sql
```

### Step 7 — Final pass: collapse 3+ consecutive blank lines

```bash
awk 'BEGIN{blank=0} /^$/{blank++; if (blank<=2) print; next} {blank=0; print}' \
  baseline.step11.sql > baseline.sanitized.sql
```

Output: `baseline.sanitized.sql`. This is the file that ships as `00000000000000_baseline_from_prod.sql`.

## Section 3: File header

Prepend:

```sql
-- ============================================================================
-- BASELINE — captured from production on <ISO timestamp>
-- ============================================================================
-- Source project: <SUPABASE_PROJECT_REF>
-- Capture method: supabase db dump --schema public --schema extensions
-- Sanitization:   docs/runbooks/schema-reproducibility-fix.md Section 2
--
-- IDEMPOTENCY: this file is pre-marked applied on prod + staging via
-- `supabase migration repair --status applied 00000000000000`. It MUST
-- never re-execute against an env that already has the prod schema.
--
-- Fresh envs (CI scratch project, local dev): this file runs first, then
-- every migration after it. All 349 subsequent files apply on top.
--
-- DO NOT EDIT BY HAND. Re-run the workflow if a regeneration is needed:
--   gh workflow run schema-reproducibility-fix.yml -f step=capture-and-pr
-- ============================================================================
```

## Section 4: Local validation

On the CI runner:

```bash
supabase init   # creates supabase/config.toml in scratch dir
supabase start  # spins up local Postgres + Supabase services
cp baseline.sanitized.sql supabase/migrations/00000000000000_baseline_from_prod.sql
supabase db reset   # drops local DB, re-applies baseline + all 349 migrations
```

Exit code 0 required. The output table count + RPC count must be within ±5 of the prod snapshot taken before capture (some legacy tables may not be present in the migration history but exist on prod — that's the drift Section 1's snapshot quantifies).

## Section 5: Staging validation (rehearsal)

The workflow's `dry-run-staging` step is the rehearsal. It runs Sections 1 → 4 only and uploads `baseline.sanitized.sql` as a workflow artifact. **It does NOT touch staging or prod metadata.** If it fails, fix the sed transforms here and re-run; nothing is mutated.

## Section 6: PR review and merge

The `capture-and-pr` step opens a PR titled "fix(schema): baseline from prod for reproducibility". Reviewer checklist:

- File header has a recent capture timestamp (not stale).
- Diff is +1 file (`supabase/migrations/00000000000000_baseline_from_prod.sql`); no other files changed.
- File size between 500 KB and 5 MB.
- Spot-check: zero `INSERT INTO`, zero `COPY`, zero `ALTER ... OWNER TO`.
- The dry-run job referenced in the PR body succeeded.

Merge to main. Do **not** run any deploy yet — pre-marking on prod + staging must happen first or the next deploy will try to execute the baseline against an env that already has all those objects (every CREATE will collide).

## Section 7: Pre-mark applied on staging

```bash
supabase login --token "$SUPABASE_ACCESS_TOKEN"
supabase link --project-ref "$STAGING_PROJECT_REF" --password "$STAGING_DB_PASSWORD"

# Idempotency check first
psql "$STAGING_DB_URL" -c \
  "SELECT version FROM supabase_migrations.schema_migrations WHERE version='00000000000000';"
# If row exists → already pre-marked, exit 0

supabase migration repair --status applied 00000000000000

# Verify
psql "$STAGING_DB_URL" -c \
  "SELECT version, inserted_at FROM supabase_migrations.schema_migrations WHERE version='00000000000000';"
```

## Section 8: Pre-mark applied on prod

Same as Section 7 with `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD`. The workflow inserts a 30-second sleep first so the operator can cancel between staging-success and prod-execution.

## Section 9: Verify

```bash
supabase db push --linked --dry-run   # against staging then prod
```

Expected output: `Remote database is up to date.` (zero pending migrations) on both. The `migrations` job on the next push to `main` must succeed without any baseline-related work.

## Section 10: Rollback

The pre-mark inserts exactly one row into `supabase_migrations.schema_migrations`. Rollback:

```sql
DELETE FROM supabase_migrations.schema_migrations WHERE version='00000000000000';
```

The baseline file in the repo is then either:
- left in place (harmless on prod since the prior pre-mark was undone — next `db push --include-all` will *try* to apply it and most CREATEs will collide), or
- reverted via `git revert <PR sha>` (cleanest).

If the pre-mark was already in place on prod when rollback is needed, prefer the SQL DELETE. If the file was already merged but pre-mark hasn't run on prod yet, prefer `git revert`.

There is no data risk: this entire operation only writes one row of metadata; no schema is altered.

## Section 11: Automated execution

The GitHub Actions workflow at `.github/workflows/schema-reproducibility-fix.yml` automates Sections 1 through 9. It is `workflow_dispatch` only — there is no auto-trigger.

```bash
# 1. Rehearse against staging (does not touch prod or staging metadata)
gh workflow run schema-reproducibility-fix.yml -f step=dry-run-staging
# … wait, review artifact `baseline.sanitized.sql` and the dry-run summary …

# 2. Capture for real and open a PR with the new baseline file
gh workflow run schema-reproducibility-fix.yml -f step=capture-and-pr
# … review and merge the PR it opens …

# 3. Pre-mark the baseline applied on staging
gh workflow run schema-reproducibility-fix.yml -f step=pre-mark-staging
# … verify staging via the workflow summary …

# 4. Pre-mark the baseline applied on prod (30s safety delay before execution)
gh workflow run schema-reproducibility-fix.yml -f step=pre-mark-prod
# … verify prod via the workflow summary …

# 5. Confirm zero pending migrations on both envs
gh workflow run schema-reproducibility-fix.yml -f step=verify
```

Each step is idempotent. Re-running `pre-mark-staging` after the row already exists exits 0. Re-running `dry-run-staging` re-uploads a fresh artifact and never mutates anything.

The workflow uses only the existing repo secrets:
- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD` (prod)
- `SUPABASE_PROJECT_REF` (prod)
- `SUPABASE_STAGING_DB_PASSWORD`
- `SUPABASE_STAGING_PROJECT_REF`

No new secrets are required.

## Authorisation log

| Step | Authorised by | When |
|---|---|---|
| Workflow design + automation | "operator capacity — must be CI-driven" | 2026-04-29 |
