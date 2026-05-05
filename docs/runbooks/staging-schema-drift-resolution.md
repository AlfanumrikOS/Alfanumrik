# Staging Schema Drift — Resolution Runbook

**Date filed:** 2026-05-05
**Owner:** architect
**Status:** RESOLVED (drift mitigated, future-detection smoke test below)

## Summary of original symptom

During PR #534 launch-readiness work, the Integration Tests (live DB) CI job
failed against the staging Supabase project (`gzpxqklxwzishrkiaatd`) with two
representative failures in `src/__tests__/migrations/rag-chunks-constraints.test.ts`:

- `rejects invalid grade_short` — INSERT with `grade_short='13'` was expected
  to violate the `rag_chunks_valid_grade` CHECK and return an error. Instead
  the row inserted successfully.
- `rejects source other than ncert_2025` — INSERT with `source='wikipedia'`
  was expected to violate `rag_chunks_source_ncert_only`. Same silent success.

Diagnostic SELECT against `pg_constraint` confirmed both constraints existed
on staging with `convalidated = true` and the correct expression. Under that
report, the constraint should enforce on INSERT — but it didn't. This was
the "constraint mystery" that motivated the temporary CI gate flip on
2026-05-05 (commit `a011acf0`).

After re-triggering CI later the same day (post `683e9156`, the pg_cron
disable v4 migration), the same tests passed at ~50s on both `main` and
PR #534. The drift was real but transient.

## Root cause hypothesis (confidence: HIGH)

The diagnostic SELECT was almost certainly run against **a different
Supabase project than the one CI was inserting into**, OR against a
**stale read replica** that reported the constraint as present while the
primary writer endpoint did not yet have it. Specifically:

1. `STAGING_SUPABASE_URL` in GitHub Actions points to one Supabase project.
2. The diagnostic SQL was run via Supabase Dashboard / SQL Editor, which
   may have been pointing at a sibling project, an older snapshot, or used
   a connection that hit a replica/cached metadata.
3. The actual write target reached by `npm run test:integration` did not
   have the constraints because the migration that adds them
   (`20260504100800_staging_baseline_catchup.sql`) had not been applied
   to that specific endpoint yet.

The chain of evidence supporting this hypothesis:

- The `sync-staging-migrations.yml` workflow runs `supabase db push
  --linked --include-all` against staging on every push to main that
  touches `supabase/migrations/**`. That workflow had failed on
  `4aaeb612` and `484d1c85` (pg_cron migration encoding/quoting bugs)
  before succeeding on `683e9156` at 12:21 UTC on 2026-05-05.
- A failed sync-staging-migrations run aborts mid-chain and leaves all
  subsequent migrations un-applied, including
  `20260504100800_staging_baseline_catchup.sql` which is what installs
  `rag_chunks_valid_grade` and `rag_chunks_source_ncert_only` on any
  environment where they were never installed at baseline.
- Once `683e9156` succeeded, the catchup migration applied, and
  Integration Tests (live DB) flipped from failure to success on the
  next CI run. Confirmed on PR #534 (run 25370695928, conclusion success)
  and main (run 25376585431 — Integration Tests success; only the
  unrelated post-deploy health check failed due to Vercel security
  checkpoint 429s on the GitHub Actions runner IP, a known false
  positive).

Alternative hypotheses considered and rejected:

- **Replication / cache delay on the same project** — possible but unlikely
  to persist for hours. Postgres metadata reads do not lag DDL by hours
  even on hot-standby setups.
- **`STAGING_SUPABASE_URL` pointing at the wrong project** — possible but
  there is no evidence the secret was rotated mid-incident. The fact that
  it now works against the same secret value points to the catchup
  migration finally landing, not the URL changing.

## How to detect the same issue in the future

Run the smoke-test SQL below (see "Smoke test" section) against whatever
project `STAGING_SUPABASE_URL` resolves to. If any object returns
`MISSING`, staging has drifted from main and `sync-staging-migrations`
needs to be re-run.

To verify which project `STAGING_SUPABASE_URL` actually points to, ops
can read the GitHub Environment secret `staging` → `STAGING_SUPABASE_URL`.
The host is the `<project-ref>.supabase.co` portion of that URL.

## How to fix

1. **Preferred:** re-trigger `Sync Migrations to Staging` workflow via
   GitHub Actions → workflow_dispatch. This applies any pending
   migrations from `supabase/migrations/` (including
   `20260504100800_staging_baseline_catchup.sql`) idempotently.

2. **If sync-staging-migrations is failing:** identify the offending
   migration (the run logs will show which file). Common cause: an
   environment-specific quirk like `pg_cron` not being installed on
   staging. Fix the migration to be safe across environments
   (see `683e9156` — "fix(migration): pg_cron disable v4 - correct
   single-quote SQL escaping" — for a recent reference pattern).

3. **If `STAGING_SUPABASE_URL` points at a project that was never
   migrated from baseline:** apply the baseline first
   (see `docs/runbooks/schema-reproducibility-fix.md`), then run
   sync-staging-migrations.

## Smoke test (one-liner)

Run this in the Supabase SQL Editor for **whichever project
`STAGING_SUPABASE_URL` resolves to**. It returns one row per expected
schema object with PRESENT or MISSING. If any row reports MISSING,
staging is drifted from main.

```sql
WITH expected(kind, name) AS (
  VALUES
    ('constraint', 'rag_chunks_valid_grade'),
    ('constraint', 'rag_chunks_source_ncert_only'),
    ('trigger',    'rag_chunks_recompute_trigger'),
    ('trigger',    'question_bank_recompute_trigger'),
    ('function',   'recompute_syllabus_status'),
    ('function',   'trg_rag_chunks_recompute'),
    ('function',   'trg_question_bank_recompute')
)
SELECT
  e.kind,
  e.name,
  CASE
    WHEN e.kind = 'constraint' AND EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conname = e.name AND c.convalidated = true
    ) THEN 'PRESENT'
    WHEN e.kind = 'trigger' AND EXISTS (
      SELECT 1 FROM pg_trigger t
      WHERE t.tgname = e.name AND NOT t.tgisinternal
    ) THEN 'PRESENT'
    WHEN e.kind = 'function' AND EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = e.name AND n.nspname = 'public'
    ) THEN 'PRESENT'
    ELSE 'MISSING'
  END AS status
FROM expected e
ORDER BY e.kind, e.name;
```

Expected output: 7 rows, all `PRESENT`. Any `MISSING` → drift; run the
fix steps above.

## Cross-references

- CI gate restored: `.github/workflows/ci.yml` line ~272
  (`continue-on-error: false`)
- Catchup migration: `supabase/migrations/20260504100800_staging_baseline_catchup.sql`
- Sync workflow: `.github/workflows/sync-staging-migrations.yml`
- Baseline runbook: `docs/runbooks/schema-reproducibility-fix.md`
- Forensic quiz investigation (related forensic view): `docs/runbooks/forensic-quiz-investigation.md`
