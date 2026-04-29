# Runbook: Schema Reproducibility Fix (P0)

> **Purpose**: Replace the broken legacy migration chain with a single
> pg_dump-derived baseline so a fresh Supabase project can be bootstrapped from
> scratch and CI's "Integration Tests (live DB)" job can go green again.
>
> **Strategy (Option B)**: Capture prod schema with `pg_dump`, sanitize and
> idempotency-wrap it, ship as `00000000000000_baseline_from_prod.sql`, **and
> pre-mark it applied on prod and main-staging _before merge_** so the merge
> never executes the dump on prod.
>
> **Owner**: architect (DB) with ops oversight.
> **Approver**: user (Pradeep) — this runbook is the script.
> **This is a doc-only deliverable.** No SQL is created, no migration is run by
> reading this file. The user executes the steps.

---

## 0. Prerequisites

### Tools
| Tool | Minimum version | Install / verify |
|---|---|---|
| Supabase CLI | `>= 1.200.0` (must support `migration repair --status applied`) | `supabase --version` |
| `pg_dump` / `psql` | `17.x` (matches prod PG 17.6) | `pg_dump --version` (Windows: install via PostgreSQL installer or `winget install PostgreSQL.PostgreSQL`) |
| `gh` CLI | any recent | `gh --version`; `gh auth status` |
| `git` | any recent | n/a |
| Node | `>= 20` (matches CI) | `node --version` |
| GNU `sed` (or perl) | any | Windows: use Git Bash; macOS: `brew install gnu-sed` and use `gsed` |

### Secrets / handles needed (have these in front of you before starting)
| Variable | Where it comes from | Example |
|---|---|---|
| `PROD_PROJECT_REF` | Supabase dashboard → prod project → Settings → General | `xxxxxxxxxxxxxxxxxxxx` |
| `PROD_DB_PASSWORD` | 1Password / vault entry "Supabase prod DB password" | `********` |
| `PROD_DB_URL` | Build below: `postgresql://postgres.<PROD_PROJECT_REF>:<PROD_DB_PASSWORD>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres` | n/a |
| `STAGING_PROJECT_REF` | Supabase dashboard → main-staging project | `yyyyyyyyyyyyyyyyyyyy` |
| `TEST_PROJECT_REF` | Will be created in Section 4 (note its ref then) | `zzzzzzzzzzzzzzzzzzzz` |
| `TEST_DB_PASSWORD` | Set when creating the test project | `********` |
| `SUPABASE_ACCESS_TOKEN` | Supabase dashboard → Account → Access Tokens | `sbp_...` |
| `GITHUB_TOKEN` | already in `gh auth status` | n/a |

> **Safety rail.** No command in Sections 1–4 mutates prod. The only prod write is
> Section 5 (`migration repair --status applied`), which is metadata-only — it
> writes a row to `supabase_migrations.schema_migrations` and does **not**
> execute the SQL.

### Total time budget
| Phase | Wall-clock |
|---|---|
| Section 1 (capture) | 5–10 min |
| Section 2 (sanitize) | 30–45 min (most error-prone) |
| Section 3 (save) | 5 min |
| Section 4 (fresh-project bootstrap test) | 60–90 min (project creation + push + tests) |
| Section 5 (pre-mark prod) | 5 min |
| Section 6 (pre-mark staging) | 5 min |
| Section 7 (PR + merge) | 30–60 min (CI run + review) |
| Section 8 (post-merge verify) | 15 min |
| **Total** | **~3.5–4.5 hours of focused work** |

A full working day is realistic if Section 2 needs iteration (most likely cause
of slippage: a `CREATE` form `pg_dump` emits that the sanitizer didn't catch).

---

## 1. Capture baseline from production

### 1.1 Snapshot prod table count BEFORE the dump (used to validate Section 4)

```bash
export PROD_DB_URL="postgresql://postgres.${PROD_PROJECT_REF}:${PROD_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

psql "$PROD_DB_URL" -At -c "select count(*) from information_schema.tables where table_schema = 'public'"
```

**Acceptance**: a single integer is printed (expected: 200–300 range based on
the 265-migration chain). **Write this number down here:**

```
PROD_PUBLIC_TABLE_COUNT = ____  (filled in at runtime)
PROD_PUBLIC_RPC_COUNT  = ____  (from the next query, also write it down)
```

```bash
psql "$PROD_DB_URL" -At -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace"
```

If either query errors with `connection refused` or auth failure, stop and fix
the `PROD_DB_URL` — do not proceed with a partial baseline.

### 1.2 Capture the dump (preferred path: Supabase CLI)

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
mkdir -p /tmp/schema-fix && cd /tmp/schema-fix

supabase db dump \
  --project-ref "$PROD_PROJECT_REF" \
  --db-url "$PROD_DB_URL" \
  --schema public \
  --schema extensions \
  -f baseline.raw.sql
```

If `supabase db dump` is unavailable or fails, **fallback to direct pg_dump**:

```bash
pg_dump \
  --schema-only \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=extensions \
  --file=baseline.raw.sql \
  "$PROD_DB_URL"
```

### 1.3 Sanity-check the raw dump

```bash
# Should be > 500 KB (the 265-migration chain produces a sizable schema dump)
ls -lh baseline.raw.sql

# MUST be zero matches — we want schema only, never data
grep -cE '^(INSERT INTO|COPY )' baseline.raw.sql
```

**Acceptance**:
- File size between **500 KB and 5 MB** (sanity bounds).
- `grep -cE '^(INSERT INTO|COPY )'` returns **0**.

**If it fails**:
- File < 500 KB → connection likely dropped mid-dump; re-run.
- File contains `INSERT`/`COPY` → you used the wrong flag. Re-run with
  `--schema-only` (pg_dump) or `supabase db dump` (which is schema-only by
  default). Do not proceed; data must never enter the baseline.

---

## 2. Sanitize the dump

> Run each transform in order against `baseline.raw.sql` and write to
> `baseline.sql`. After each step, diff to confirm only the expected lines
> changed.

```bash
cp baseline.raw.sql baseline.sql
```

### 2.1 Strip ownership and role clauses (Supabase manages these)

```bash
# Remove `OWNER TO ...;` lines
sed -i.bak -E '/^[[:space:]]*ALTER [A-Z ]+ OWNER TO /d' baseline.sql

# Remove `GRANT ... TO authenticated|anon|service_role|postgres` lines
sed -i.bak -E '/^GRANT [^;]* TO (authenticated|anon|service_role|postgres|supabase_[a-z_]+)( |,|;)/d' baseline.sql

# Remove `REVOKE ... FROM ...` if present (Supabase reapplies)
sed -i.bak -E '/^REVOKE [^;]* FROM (authenticated|anon|service_role|postgres|public|supabase_[a-z_]+)( |,|;)/d' baseline.sql

# Remove CREATE ROLE / ALTER ROLE
sed -i.bak -E '/^(CREATE|ALTER) ROLE /d' baseline.sql

# Remove `SET ROLE` and `RESET ROLE`
sed -i.bak -E '/^(SET|RESET) ROLE /d' baseline.sql
```

**Acceptance**: `grep -cE '^(ALTER [A-Z ]+ OWNER TO|GRANT|REVOKE|CREATE ROLE|ALTER ROLE|SET ROLE|RESET ROLE)' baseline.sql` is **0**.

### 2.2 Idempotency-wrap CREATE statements

`pg_dump` already emits `CREATE EXTENSION IF NOT EXISTS` and (in recent versions)
`CREATE SCHEMA IF NOT EXISTS`. We need to add `IF NOT EXISTS` to the rest:

```bash
# CREATE TABLE foo (...) -> CREATE TABLE IF NOT EXISTS foo (...)
sed -i.bak -E 's/^CREATE TABLE ([^I][A-Za-z0-9_."]*)/CREATE TABLE IF NOT EXISTS \1/' baseline.sql

# CREATE INDEX ...
sed -i.bak -E 's/^CREATE INDEX ([^I][A-Za-z0-9_."]*)/CREATE INDEX IF NOT EXISTS \1/' baseline.sql

# CREATE UNIQUE INDEX ...
sed -i.bak -E 's/^CREATE UNIQUE INDEX ([^I][A-Za-z0-9_."]*)/CREATE UNIQUE INDEX IF NOT EXISTS \1/' baseline.sql

# CREATE SEQUENCE ...
sed -i.bak -E 's/^CREATE SEQUENCE ([^I][A-Za-z0-9_."]*)/CREATE SEQUENCE IF NOT EXISTS \1/' baseline.sql

# CREATE VIEW ... -> CREATE OR REPLACE VIEW
sed -i.bak -E 's/^CREATE VIEW /CREATE OR REPLACE VIEW /' baseline.sql

# CREATE MATERIALIZED VIEW ... -> CREATE MATERIALIZED VIEW IF NOT EXISTS
sed -i.bak -E 's/^CREATE MATERIALIZED VIEW ([^I][A-Za-z0-9_."]*)/CREATE MATERIALIZED VIEW IF NOT EXISTS \1/' baseline.sql

# CREATE TYPE ... — wrap in DO/EXCEPTION block (no IF NOT EXISTS in PG)
# Use perl for multi-line replacement
perl -i.bak -pe '
  s|^CREATE TYPE ([A-Za-z0-9_."]+) AS|DO \$do\$ BEGIN CREATE TYPE \1 AS|;
' baseline.sql
# Note: the closing paren of CREATE TYPE ... AS (...); needs the matching wrapper.
# This regex is approximate — manually inspect every CREATE TYPE block after this
# step and ensure each one ends with: ); EXCEPTION WHEN duplicate_object THEN null; END \$do\$;
# pg_dump usually emits CREATE TYPE on a small number of enums; review them by hand.
grep -n '^DO \$do\$ BEGIN CREATE TYPE' baseline.sql  # list all wrapped types
```

> **Manual step required for `CREATE TYPE`**: open `baseline.sql` in an editor,
> find each `DO $do$ BEGIN CREATE TYPE ...` block, and on the line immediately
> after the closing `);` of that type, insert:
> ```
> EXCEPTION WHEN duplicate_object THEN null; END $do$;
> ```
> Most prod schemas have < 20 enum types so this is bounded.

**Acceptance**: `grep -cE '^CREATE (TABLE |INDEX |UNIQUE INDEX |SEQUENCE |MATERIALIZED VIEW )[^I]' baseline.sql` is **0**.

### 2.3 Make CREATE POLICY idempotent (DROP+CREATE pairs)

`CREATE POLICY` has no `IF NOT EXISTS`. Wrap each with a preceding
`DROP POLICY IF EXISTS`:

```bash
perl -i.bak -ne '
  if (/^CREATE POLICY "([^"]+)" ON ([A-Za-z0-9_."]+)/) {
    print "DROP POLICY IF EXISTS \"$1\" ON $2;\n";
  }
  print;
' baseline.sql
```

**Acceptance**: `grep -c '^CREATE POLICY ' baseline.sql` equals
`grep -c '^DROP POLICY IF EXISTS ' baseline.sql` (every CREATE has a paired DROP).

### 2.4 Make CREATE TRIGGER idempotent

```bash
perl -i.bak -ne '
  if (/^CREATE TRIGGER ([A-Za-z0-9_]+) /) {
    # Find the ON <table> in the same line
    if (/ON ([A-Za-z0-9_."]+)/) {
      print "DROP TRIGGER IF EXISTS $1 ON $2;\n";
    }
  }
  print;
' baseline.sql
```

**Acceptance**: `grep -c '^CREATE TRIGGER ' baseline.sql` equals
`grep -c '^DROP TRIGGER IF EXISTS ' baseline.sql`.

### 2.5 Make CREATE FUNCTION idempotent

`pg_dump` emits `CREATE FUNCTION`. Promote to `CREATE OR REPLACE FUNCTION`:

```bash
sed -i.bak -E 's/^CREATE FUNCTION /CREATE OR REPLACE FUNCTION /' baseline.sql
```

**Acceptance**: `grep -c '^CREATE FUNCTION ' baseline.sql` is **0**.

### 2.6 Final sanity sweep

```bash
# No data
grep -cE '^(INSERT INTO|COPY )' baseline.sql        # expect 0
# No grants/owners
grep -cE '^(GRANT |REVOKE |ALTER .* OWNER TO )' baseline.sql  # expect 0
# No raw role mgmt
grep -cE '^(CREATE|ALTER) ROLE ' baseline.sql       # expect 0
# All CREATE TABLE idempotent
grep -cE '^CREATE TABLE [^I]' baseline.sql          # expect 0
# All CREATE INDEX idempotent
grep -cE '^CREATE (UNIQUE )?INDEX [^I]' baseline.sql # expect 0
# All CREATE FUNCTION promoted
grep -c '^CREATE FUNCTION ' baseline.sql            # expect 0

# File still substantial
wc -l baseline.sql                                  # expect > 5000 lines
```

If any check fails, re-run the matching transform. Clean up the `.bak` backup
files **only after** all acceptance checks pass:

```bash
rm baseline.sql.bak baseline.raw.sql.bak 2>/dev/null || true
```

---

## 3. Save the file

```bash
# Move into the repo (replace path with your worktree)
cd /c/Users/Bharangpur\ Primary/Alfanumrik-repo

# Create a feature branch from main
git fetch origin main
git checkout -b fix/schema-reproducibility-baseline-from-prod origin/main
```

Add the header comment, then move the file in:

```bash
cat > supabase/migrations/00000000000000_baseline_from_prod.sql <<'HEADER'
-- ============================================================================
-- 00000000000000_baseline_from_prod.sql
-- ----------------------------------------------------------------------------
-- This is a pg_dump-derived schema baseline of the Alfanumrik production
-- database, captured on YYYY-MM-DD (fill in at commit time).
--
-- WHY THIS EXISTS
-- ----------------
-- The historical migration chain (~265 files) drifted from prod and could no
-- longer bootstrap a fresh Supabase project from zero. CI's "Integration Tests
-- (live DB)" job has been red because of this drift. This baseline replaces
-- that broken chain with a single idempotent file that reflects the schema
-- prod actually has.
--
-- DEPLOYMENT SAFETY
-- -----------------
-- Before this migration was merged, it was pre-marked APPLIED on:
--   - production (project ref: see runbook)
--   - main-staging (project ref: see runbook)
-- via `supabase migration repair --status applied 00000000000000`.
-- That means: when the deploy pipeline runs `supabase db push`, the CLI sees
-- this migration is already recorded in `supabase_migrations.schema_migrations`
-- and SKIPS it on prod / main-staging. The SQL below is only ever executed
-- against fresh projects (CI integration tests, dev sandboxes, new staging
-- envs). It is fully idempotent (IF NOT EXISTS / OR REPLACE / DROP+CREATE
-- guards) so re-running it is a no-op.
--
-- DO NOT EDIT THIS FILE BY HAND. To regenerate, re-run the runbook at:
--   docs/runbooks/schema-reproducibility-fix.md
-- ============================================================================

HEADER

# Append the sanitized dump
cat /tmp/schema-fix/baseline.sql >> supabase/migrations/00000000000000_baseline_from_prod.sql

# Confirm the file landed
ls -lh supabase/migrations/00000000000000_baseline_from_prod.sql
head -30 supabase/migrations/00000000000000_baseline_from_prod.sql
```

**Acceptance**: file exists, header is present, total line count matches
`baseline.sql` line count + ~30 (header).

---

## 4. Phase 4.2 — fresh-project bootstrap test

> This is the critical correctness check. We run the new baseline against a
> brand-new Supabase project to prove a zero-state environment can be built
> from this single file.

### 4.1 Authenticate

```bash
supabase login
# (paste SUPABASE_ACCESS_TOKEN when prompted, or use --token)
```

### 4.2 Create a throwaway test project

Via dashboard (preferred — clearer audit trail):
1. Go to https://supabase.com/dashboard/projects → "New project"
2. Name: `alfanumrik-baseline-test-YYYYMMDD`
3. Region: **ap-south-1 (Mumbai)** (match prod)
4. Plan: free (sufficient for the test)
5. DB password: generate strong password, save as `TEST_DB_PASSWORD`
6. After provisioning (~2 min), note the project ref as `TEST_PROJECT_REF`

Or via CLI:
```bash
# Replace ORG_ID with the org slug visible in the dashboard URL
supabase projects create alfanumrik-baseline-test-$(date +%Y%m%d) \
  --org-id <ORG_ID> \
  --region ap-south-1 \
  --db-password "$TEST_DB_PASSWORD"
```

### 4.3 Link and push

```bash
export TEST_PROJECT_REF="zzzzzzzzzzzzzzzzzzzz"  # fill in

supabase link --project-ref "$TEST_PROJECT_REF" --password "$TEST_DB_PASSWORD"

# Apply ALL local migrations to the linked (test) project, including our new baseline
supabase db push --linked --include-all
```

**Acceptance**:
- Exit code: `0`.
- Acceptable output: `NOTICE: ... already exists, skipping` (idempotency
  guards firing on an empty project means no-ops or success).
- **Forbidden**: any line containing `ERROR:`, `permission denied`,
  `duplicate_object`, `does not exist` (other than for harmless DROP IF EXISTS
  on an empty DB), or non-zero exit code.

**If it fails**: capture the failing statement, fix the corresponding sanitizer
in Section 2, re-run `db push --linked --include-all` against the test project.
This is the loop you most likely will iterate.

### 4.4 Validate parity with prod (table + RPC counts)

```bash
export TEST_DB_URL="postgresql://postgres.${TEST_PROJECT_REF}:${TEST_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

psql "$TEST_DB_URL" -At -c "select count(*) from information_schema.tables where table_schema = 'public'"
psql "$TEST_DB_URL" -At -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace"
```

**Acceptance**:
- Test public table count == `PROD_PUBLIC_TABLE_COUNT` (recorded in 1.1).
  - Tolerance: ±2 (prod may have created/dropped a transient table between
    capture and check). If diff > 2, investigate before proceeding.
- Test public RPC count == `PROD_PUBLIC_RPC_COUNT` (±5 acceptable since RPCs
  may have been added between capture and now; investigate larger gaps).

### 4.5 Spot-check critical RPCs

```bash
psql "$TEST_DB_URL" -At -c "
  select proname
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in (
      'atomic_quiz_profile_update',
      'submit_quiz_results_v2',
      'start_quiz_session',
      'bootstrap_user_profile',
      'activate_subscription',
      'atomic_subscription_activation',
      'get_student_snapshot',
      'get_quiz_questions'
    )
  order by proname;
"
```

**Acceptance**: exactly **8 distinct names** returned (some may have multiple
overloads — that's fine, we're checking presence by `proname`).

**If fewer than 8**: the missing RPC is referenced in code paths that integration
tests will hit. Fix the sanitizer (most likely cause: a `CREATE FUNCTION` body
contained `$$ ... $$` text that the line-based sed broke). Re-run.

### 4.6 Run integration tests against the test project

```bash
SUPABASE_URL="https://${TEST_PROJECT_REF}.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key-from-test-project-settings>" \
npm test -- --run \
  src/__tests__/migrations/ \
  src/__tests__/scripts/backfill-cbse-syllabus.test.ts
```

**Acceptance**: `0 failed`. All migration assertion tests and the backfill
script tests must pass.

**If anything fails**: read the failure, identify the missing object/column,
audit Section 2 sanitization, re-loop.

### 4.7 Tear down the test project (after success)

In the dashboard: Project Settings → General → "Delete project".
Or note the ref and delete it after merge — it costs nothing on free tier.

---

## 5. Pre-mark applied on PROD (the critical safety step)

> **This is the single most important command in the runbook. It must run
> BEFORE the PR merges.** It tells Supabase "treat this baseline as already
> applied on prod, so when the deploy pipeline runs `supabase db push`, skip
> it." Without this, the merge will attempt to execute the baseline against
> prod, which is unnecessary (prod already has the schema) and risky.

```bash
supabase login   # if not still authed

supabase migration repair \
  --status applied \
  --project-ref "$PROD_PROJECT_REF" \
  --password "$PROD_DB_PASSWORD" \
  00000000000000
```

### Verification (mandatory)

```bash
psql "$PROD_DB_URL" -At -c "
  select version, name
  from supabase_migrations.schema_migrations
  where version = '00000000000000';
"
```

**Acceptance**: exactly **1 row** returned, version `00000000000000`.

**If 0 rows**: the repair did not take. Re-run `migration repair`. **Do NOT
proceed to Section 7 until this row exists.**

**If multiple rows for the same version**: not possible under the unique
constraint, but if it happens, stop and escalate.

---

## 6. Pre-mark applied on MAIN-STAGING

```bash
supabase migration repair \
  --status applied \
  --project-ref "$STAGING_PROJECT_REF" \
  --password "$STAGING_DB_PASSWORD" \
  00000000000000
```

### Verification

```bash
export STAGING_DB_URL="postgresql://postgres.${STAGING_PROJECT_REF}:${STAGING_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

psql "$STAGING_DB_URL" -At -c "
  select version
  from supabase_migrations.schema_migrations
  where version = '00000000000000';
"
```

**Acceptance**: **1 row**.

---

## 7. Open + merge the PR

### 7.1 Stage and commit

```bash
git add supabase/migrations/00000000000000_baseline_from_prod.sql

git commit -m "$(cat <<'EOF'
fix(schema): consolidate baseline from prod pg_dump (close schema reproducibility P0)

Replace the historical 265-file migration chain with a single
pg_dump-derived baseline so a fresh Supabase project can bootstrap from
zero and CI's Integration Tests (live DB) job goes green.

SAFETY: The baseline has been pre-marked APPLIED on prod and
main-staging via `supabase migration repair --status applied
00000000000000` before this commit. The deploy pipeline will see the
migration is already recorded and skip it on those environments. The
file is fully idempotent (IF NOT EXISTS / OR REPLACE / DROP+CREATE)
so re-running it on any environment is a no-op.

Runbook: docs/runbooks/schema-reproducibility-fix.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

git push -u origin fix/schema-reproducibility-baseline-from-prod
```

### 7.2 Open the PR

```bash
gh pr create \
  --title "fix(schema): consolidate baseline from prod pg_dump (close schema reproducibility P0)" \
  --body "$(cat <<'EOF'
## Summary

Replaces the broken 265-file legacy migration chain with a single
pg_dump-derived baseline (`00000000000000_baseline_from_prod.sql`) so:

1. A fresh Supabase project can be bootstrapped from zero.
2. CI's "Integration Tests (live DB)" job goes green again.
3. Disaster recovery / new staging environments work without manual
   schema fixups.

## Safety mechanism

This migration is **pre-marked APPLIED** on production and main-staging
via `supabase migration repair --status applied 00000000000000`
**before this PR merges**. When the deploy pipeline runs
`supabase db push` after merge, the CLI sees the row already exists in
`supabase_migrations.schema_migrations` and **skips** the file on those
environments. It only executes against fresh / blank projects.

The SQL itself is fully idempotent (`IF NOT EXISTS`, `OR REPLACE`,
`DROP POLICY IF EXISTS ... ; CREATE POLICY ...`), so re-running it
anywhere is a no-op.

## Runbook

Full executable runbook: [`docs/runbooks/schema-reproducibility-fix.md`](docs/runbooks/schema-reproducibility-fix.md)

## Test plan

- [x] Section 1: prod schema captured via `supabase db dump`
- [x] Section 2: sanitization passed (no GRANT/OWNER/data, all CREATE forms idempotent)
- [x] Section 4.3: `db push --linked --include-all` succeeded against fresh test project
- [x] Section 4.4: test project public table/RPC counts match prod (within tolerance)
- [x] Section 4.5: 8/8 critical RPCs present
- [x] Section 4.6: `npm test -- --run src/__tests__/migrations/` passes against test project
- [x] Section 5: prod `schema_migrations` row for `00000000000000` confirmed
- [x] Section 6: main-staging `schema_migrations` row for `00000000000000` confirmed
- [ ] CI: "Integration Tests (live DB)" green on this PR (BLOCKING)
- [ ] Post-merge (Section 8): prod deploy logs show the baseline migration skipped, not executed

## Rollback

See Section 9 of the runbook. tl;dr: `git revert <merge-sha>`. The
pre-marked `schema_migrations` row stays — it's harmless metadata and
just means future deploys still skip the (now-deleted) file. If we
discover prod is missing an object the baseline assumed, write a
compensating migration with `IF NOT EXISTS` guards (no DROP).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### 7.3 Wait for CI

```bash
gh pr checks --watch
```

**Acceptance (BLOCKING merge gate)**:
- "Integration Tests (live DB)" status: **success**.
- All other checks: success.

**If "Integration Tests (live DB)" is red**: the baseline is not yet correct.
Read the failure, fix the sanitizer (Section 2), force-push, re-test against
the test project (Section 4), and let CI re-run. **Do not bypass this gate.**
This job going green is the entire point of the P0 fix.

### 7.4 Merge

Once green:

```bash
gh pr merge --squash --delete-branch
```

---

## 8. Post-merge verification

### 8.1 Watch the production deploy

```bash
# Find the deploy run kicked off by the merge to main
gh run list --workflow=deploy-production.yml --limit 1

# Watch it
gh run watch <run-id> --exit-status
```

### 8.2 Confirm the baseline was SKIPPED on prod (not executed)

In the deploy-production run logs, locate the `supabase db push` step. Expected
output:
```
Connecting to remote database...
Skipping migration ...00000000000000_baseline_from_prod.sql (already applied)
```

**Acceptance**: the line containing `Skipping migration` (or equivalent
"already applied") for `00000000000000_baseline_from_prod.sql` is present.

**Forbidden**: any line attempting to execute statements from the baseline
against prod (e.g. `Applying migration 00000000000000_baseline_from_prod.sql`).
If you see this, **immediately go to Section 9 (rollback)** — the pre-mark in
Section 5 didn't take.

### 8.3 Verify Integration Tests now pass on subsequent PRs

Open or pick the next PR after merge. Watch its CI:

```bash
gh pr checks <next-pr-number> --watch
```

**Acceptance**: "Integration Tests (live DB)" green. The whole point.

### 8.4 Smoke test prod is unaffected

```bash
curl -s https://alfanumrik.com/api/v1/health | jq .
```

**Acceptance**: `{"ok": true, ...}`. Quiz submission, payment webhooks, and
auth callbacks should all continue to work — the baseline was never executed
on prod, so behavior is unchanged.

---

## 9. Rollback procedure

### 9.1 If post-merge prod deploy attempts to execute the baseline (Section 8.2 fails)

This means Section 5's `migration repair` did not actually persist. Immediate
actions, in order:

1. **Cancel the running deploy** if still mid-flight:
   ```bash
   gh run cancel <run-id>
   ```
2. **Revert the merge**:
   ```bash
   git checkout main
   git pull
   git revert <merge-sha> -m 1
   git push origin main
   ```
3. The revert PR will trigger another deploy that removes the baseline file.
   The pre-marked row in `schema_migrations` (if it ever made it) is harmless
   to leave — it just records a version with no file.
4. Investigate why Section 5 didn't take. Most likely: wrong `--project-ref`,
   wrong CLI version, or the command hit an error you didn't notice. Re-run
   from Section 5 before re-attempting the merge.

### 9.2 If a fresh project bootstrap (Section 4.6) fails after the runbook is
"complete"

This means the baseline is missing some object that prod actually has but the
dump didn't capture (e.g., extension installed via dashboard, RLS policy added
by a hotfix that bypassed migrations).

1. Identify the missing object from the failure.
2. Write a **compensating migration** (do **not** edit the baseline):
   ```
   supabase/migrations/20260430xxxxxx_compensating_<thing>.sql
   ```
3. Use `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS ; CREATE POLICY` guards so it's safe to apply on prod (where the object exists) and on fresh projects (where it doesn't).
4. PR through normal review chain (architect → testing → quality).

### 9.3 If prod schema diverges from the baseline going forward

That's normal — every new feature migration after `00000000000000` adds to
the chain. The baseline is the **floor**, not the **ceiling**. Future
migrations stack on top.

---

## 10. Cleanup (out of scope; future PR)

Not part of this runbook. Track as a separate ticket once the baseline has
been live for **at least 7 days** with no rollback:

- Delete `supabase/migrations/_legacy/` directory (the pre-timestamp `000_*`
  to `008_*` files). They are superseded by the baseline.
- Delete or empty the 9 timestamp-format stub files (each is just a comment
  pointing back to legacy). Identify them with:
  ```bash
  for f in supabase/migrations/2026*.sql; do
    if [ "$(grep -cE '^[^-]' "$f")" -lt 5 ]; then echo "$f"; fi
  done
  ```
- Remove any documentation that points at the legacy chain as authoritative.

> **Why deferred**: keeping `_legacy/` and the stubs around for a week gives
> us a safety net if the baseline turns out to be missing something subtle.
> Once Integration Tests (live DB) has been green for 7 days against multiple
> PRs, the legacy chain is provably dead and can be pruned.

---

## Appendix: Quick reference (cheatsheet)

```bash
# 0. Set env
export PROD_PROJECT_REF=...
export PROD_DB_PASSWORD=...
export STAGING_PROJECT_REF=...
export STAGING_DB_PASSWORD=...
export SUPABASE_ACCESS_TOKEN=...
export PROD_DB_URL="postgresql://postgres.${PROD_PROJECT_REF}:${PROD_DB_PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"

# 1. Capture
supabase db dump --project-ref "$PROD_PROJECT_REF" --db-url "$PROD_DB_URL" \
  --schema public --schema extensions -f baseline.raw.sql

# 2. Sanitize (run all sed/perl in Section 2)

# 3. Save with header into supabase/migrations/00000000000000_baseline_from_prod.sql

# 4. Test against fresh project
supabase link --project-ref "$TEST_PROJECT_REF" --password "$TEST_DB_PASSWORD"
supabase db push --linked --include-all

# 5. Pre-mark prod (CRITICAL — before merge)
supabase migration repair --status applied \
  --project-ref "$PROD_PROJECT_REF" --password "$PROD_DB_PASSWORD" 00000000000000

# 6. Pre-mark main-staging
supabase migration repair --status applied \
  --project-ref "$STAGING_PROJECT_REF" --password "$STAGING_DB_PASSWORD" 00000000000000

# 7. PR + merge (wait for Integration Tests live DB green)

# 8. Watch deploy: confirm "Skipping migration ...00000000000000..." on prod
```
