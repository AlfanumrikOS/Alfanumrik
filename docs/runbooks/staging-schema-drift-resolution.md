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

## 2026-08-20 recurrence — cross-workflow concurrency gap (partially closed)

**Symptom:** `select-quiz-questions-rag-verification-gate.test.ts` (AC-1/2/3)
failed identically on 3 consecutive main pushes (`cb0e9a1`, `0b05519`,
`218977f3d9`) — `expect(rows.length).toBe(N)` receiving `0` — which failed
`ci.yml`'s CI Gate, which in turn blocked `deploy-production.yml`'s Quality
Gate on every subsequent push, stopping ALL production deploys. Unlike the
2026-05-05 incident above, this was NOT preceded by a `sync-staging-
migrations.yml` failure that could explain a straightforward "later
migrations never landed" story for THIS specific RPC: `select_quiz_
questions_rag`'s current definition (`20260814000014_tiered_verification_
serving_and_truthful_picker.sql`) predates all three failing commits and had
already synced cleanly (runs #260/#261, 2026-08-14/16). The failure was also
NOT purely a same-push CI-vs-CI race: it reproduced on `218977f3d9`, a commit
that touches no `supabase/migrations/**` files at all (so `sync-staging-
migrations.yml` never even triggered for it) and ran with no other DB-writing
workflow active.

**What WAS confirmed and fixed:** a genuine, evidenced, unrelated structural
gap — `sync-staging-migrations.yml` / `deploy-staging.yml`'s `migrations` job
and `ci.yml`'s `Integration Tests (live DB)` job (the job that runs this
test) sat in **disjoint concurrency groups** despite both reading/writing the
SAME staging Supabase project. For commit `0b05519`, sync-staging-migrations
run `32337055976` (05:49:09–05:49:36) and the ci.yml integration job in run
`32337056137` (05:49:10–05:52:42) ran with direct wall-clock overlap — the
exact class of contention the 2026-08-12 same-job cross-ref concurrency fix
(see the job's own comment in `ci.yml`) was written for, just not covering
this cross-*workflow* case. Closed 2026-08-20 by folding the integration-test
job into the same `staging-db-push` concurrency group already shared by the
other two DB-pushing jobs (branch `fix/staging-integration-drift`).

**What remains OPEN / NOT explained by the concurrency fix alone:** the race
does not account for the `cb0e9a1` or `218977f3d9` failures (no concurrent
DB-push in either window). `sync-staging-migrations.yml` run `#262`
(triggered by `0b05519`, needs to apply `20260820000100` /
`20260820000101`) also failed outright — separately from, and prior to, this
investigation's scope (those two migrations belong to an in-flight,
separately-owned P0 security-hotfix change and were explicitly out of scope
here) — meaning staging is *currently* behind on those two files regardless
of the concurrency fix. Whether staging's `select_quiz_questions_rag` is
ALSO out of sync with `20260814000014` in some way not visible from the
migration-file diff alone (e.g. a `supabase_migrations.schema_migrations`
bookkeeping/checksum drift causing a partial or out-of-order re-apply) could
not be confirmed or ruled out from this sandbox: no `STAGING_SUPABASE_*`
credentials are available here, and GitHub's raw Actions log blobs
(`.../actions/jobs/{id}/logs`) redirect to `*.blob.core.windows.net`, which
is blocked by this environment's egress policy — only `annotations` (test
assertion output) were retrievable, not the `supabase db push` step's own
stdout for run #262. **Follow-up needed by whoever has staging DB
credentials:** run the smoke-test pattern below (adapted) against
`select_quiz_questions_rag`, and/or re-run `sync-staging-migrations.yml` via
`workflow_dispatch` (this session's GitHub token was read-only and could not
dispatch it) and confirm it reaches `success` before treating this as fully
closed.

## 2026-08-20 — staging migration ledger drift (orphan ghost versions, PR #1584)

**This is a separate incident from the concurrency-gap recurrence directly
above it** — same date, unrelated root cause. That section is about two
DB-writing jobs racing each other; this one is about two migration *version
numbers* existing in staging's ledger with no corresponding local file.

**Symptom:** every run of `sync-staging-migrations.yml` since before
2026-08-20 aborted pre-flight (before `supabase db push` touched any schema)
with:

```
Remote migration versions not found in local migrations directory: 20260814000023, 20260814000024.
```

Neither file exists on `main`, in `_legacy/`, or anywhere else in git
history at HEAD. This blocked every subsequent run of the workflow, and
because `ci.yml`'s `Integration Tests (live DB)` job shares the
`staging-db-push` concurrency group, it transitively blocked the CI Gate for
every PR — i.e. a wedged staging ledger was blocking production deploys via
a staging-only workflow.

**Root cause (two independent, unrelated abandoned/rewritten branches — full
trace already established in PR #1584's own investigation; not re-derived
here, only cited):**

- `20260814000023` (`keyless_question_serving_and_server_side_p6`) came from
  commit `145eed3e7` on the unmerged branch
  `Alfanumrik/alfanumrik-e2e-fix-d9bca6` (PR #1524). Commit `cbd86866`
  (#1529) recovered 5 of that commit's 6 renumbered migration files
  (`20260814000018`..`000022`) into `main` as the record of what had already
  shipped to PRODUCTION — but stopped at `000022`; `000023` was never
  recovered, so no file for it exists anywhere on `main`. It only reached
  STAGING's ledger via a preview/branch-deploy apply that predates that
  recovery-and-abandonment.
- `20260814000024` (`reconcile_subjects_allowed_with_plan_reality`) came
  from commit `717265e6` ("...three superseded pins", 2026-08-11), whose
  branch was later squash-merged with different final content — the
  commit's own title records that this migration was superseded/dropped
  during that PR's iteration. Same mechanism: a preview/staging apply ran
  before the squash, so the version landed in staging's ledger with no
  surviving file.
- Neither version is present in PRODUCTION's ledger — `cbd86866`'s recovery
  scope was explicitly `000018`..`000022` only ("ALREADY APPLIED" never
  mentions `000023` or `000024`). This is a staging-only ledger artifact.

The full trace (exact commit SHAs, branch names, and the CLI-internals
verification that the repair command is metadata-only) lives in
`.github/workflows/sync-staging-migrations.yml`'s own header comment (the
"2026-08-20 incident" block) — treat that comment as the source of record;
this section is a pointer + summary, not a duplicate.

**Fix (PR #1584):**

1. Added a `supabase migration repair --status reverted 20260814000023
   20260814000024` step, run immediately after `supabase link` and before
   `supabase db push`. This deletes exactly those two rows from
   `supabase_migrations.schema_migrations` on staging — confirmed
   metadata-only (no table/column/data touched) by inspecting the CLI
   binary's embedded SQL. It is hardcoded to these two versions, not a
   generic orphan-healer, so a genuine future drift still aborts the push
   loudly.
2. Pinned `SUPABASE_CLI_VERSION` to `2.109.1` (was `latest`) in this
   workflow, matching the pin already used in `ci.yml` and
   `deploy-production.yml` — an unpinned CLI silently changing its
   pre-flight reconciliation behavior between runs was an independent
   reproducibility risk surfaced by this incident, not just the ghost
   versions themselves.

**Divergence from this repo's usual pattern — read before reusing this as a
template:** this repo has a documented, 10-instance-strong convention for
the identical class of symptom ("remote version not found locally"): commit
a no-op placeholder migration file at the exact ghost version instead of
running `migration repair` in CI (see
`docs/runbooks/migration-placeholders-audit.md`, and the 2026-06-28
PRODUCTION incident that deliberately chose that convention over a repair
step). PR #1584 did not follow that convention, and did not explain the
fork in the PR itself. The reasoning for why a repair step is still
defensible for *this* incident specifically — and why it is not a general
license to always prefer repair over placeholders — is written up as an
explicit exception in `docs/runbooks/migration-placeholders-audit.md`
("Exceptions to the placeholder pattern" section). Read that section, not
just this one, before deciding how to handle the next occurrence of this
symptom.
