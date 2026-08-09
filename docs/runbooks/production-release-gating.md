# Runbook: Production Release Gating (database-before-code)

> **Status of the owner-side change described in §3: NOT APPLIED — requires owner action.**
> Nothing in this document has been executed. It records the exact settings, the
> required values, the order they must be changed in, how to verify, and the risk
> that remains until then.

**Owner:** architect (pipeline) with ops (dashboard access)
**Approver:** user (Pradeep) — §3 changes a GitHub repo variable and a Vercel project setting; both are outside the repo.
**Created:** 2026-08-09 (Wave 1 — "database success is a prerequisite for production code release")
**Applies to:** `.github/workflows/deploy-production.yml`, Vercel project (production/`main`), GitHub repo variable `USE_CLI_DEPLOY`

---

## 1. What Wave 1 changed IN THE REPO (already in effect once merged)

Three holes in `deploy-production.yml` were closed. All three are in-repo and take
effect on the next push to `main` after merge.

### 1.1 The completion gate now depends on the migration lane

`production-release-completion-gate` previously had
`needs: [health-check, post-deploy-verify, release]` and asserted seven values,
none of which said anything about the database. It now also needs `migrations`
and `deploy-functions`, and asserts:

| Assertion | Why |
|---|---|
| `needs.migrations.result == 'success'` | **A skipped or cancelled job reports as green to a downstream job.** `require_equal` is a string comparison, so the literal `'success'` is what makes `'skipped'` / `'cancelled'` fail. |
| `migration_parity == 'verified'` | Proves the lane actually verified database state. An unrun/crashed parity step leaves the output empty, and empty is not `verified`. |
| `migration_target_environment == 'production'` | Proves the parity check ran against the right database. |
| `needs.deploy-functions.result == 'success'` | Edge Functions are part of the deployed backend surface. |

The seven pre-existing assertions (health-check result / exact-SHA proof /
verified SHA, post-deploy-verify result / exact-SHA proof / verified SHA,
release result) are unchanged.

### 1.2 A "frontend-only" push can no longer bypass database verification

This is the hole that let the migration lane stay broken from 2026-08-08 while
production deploys reported green.

The `migrations` job used to skip `supabase db push` whenever the push carried no
SQL, print `skipped`, and exit 0. Both paths now end in the **same read-only
migration-history parity check**:

1. `supabase link --project-ref <SUPABASE_PROJECT_REF>` (as the push step already did).
2. **LOCAL set** = 14-digit versions of committed `supabase/migrations/*.sql`,
   top-level only (`find -maxdepth 1`). `_legacy/` is excluded — the same scope
   the Supabase CLI itself uses and the same scope `scripts/lint-migrations.js`
   uses.
3. **REMOTE set** = the `Remote` column of `supabase migration list --linked`,
   i.e. the CLI's own view of `supabase_migrations.schema_migrations`. Read-only.
   No new secret: it reuses `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and
   `SUPABASE_PROJECT_REF`, which the push step already uses.
4. The job **fails** on a mismatch in either direction, and emits job output
   `migration_parity` = `verified` | `drift`.

| Direction | Meaning | Consequence if unnoticed |
|---|---|---|
| committed, not on remote | A migration that should have been applied is still pending | The release ships application code **ahead of** its schema |
| on remote, not committed | Out-of-band drift (operator applied SQL directly) | This is exactly what aborts `supabase db push --include-all`; it stays invisible until the **next** migration-bearing deploy, which then fails for reasons unrelated to that release |

**Why `--include-all` exists, and what it does not do.** Production can contain
operator-applied emergency migration versions that reached the remote ledger out
of band. Without `--include-all` the CLI refuses to apply committed files that
sort *before* the newest remote version. That flag makes out-of-order **local**
files applicable; it does **not** reconcile **remote-only** versions, which still
abort the push. The parity check makes those remote-only versions visible on the
release that follows them, instead of silently tolerated until the next deploy
that happens to carry SQL.

**Non-vacuity guards.** An empty LOCAL set or an unparseable/empty REMOTE set
fails the job. Zero parsed remote versions means the ledger read broke — not that
the two sides agree.

#### Remediating a `drift` result

*Remote-but-not-committed* (the common case):

1. Identify what the operator actually applied (Supabase dashboard → SQL editor
   history, or `supabase db diff`).
2. Create `supabase/migrations/<the exact 14-digit version>_<name>.sql` whose body
   **idempotently** reproduces that change (`IF NOT EXISTS` / `CREATE OR REPLACE` /
   `DO $$ … EXCEPTION …`), so re-applying it to a fresh environment is safe and
   applying it to production is a no-op.
3. Commit it. This is precisely the recovery performed for
   `20260808085345`, `20260808085349`, and `20260808085419`
   (commits `d74ae967c`, `bc67ef98a`).
4. If a remote row is genuinely bogus and the change should *not* exist in the
   chain, clear it deliberately with
   `supabase migration repair --status reverted <version>`. **Never hand-edit
   `supabase_migrations.schema_migrations`.**

*Committed-but-not-remote:* fix whatever blocked the push and re-run the job, or
apply the pending versions deliberately with `supabase db push --linked --include-all`.

> **Expect the first run after merge to be informative.** This check has never run
> against production before. If it reports drift on the first release, that drift
> was already there — the check did not create it, it revealed it. Work the
> remediation above before assuming the check is wrong.

### 1.3 The release record is bound to the migration set

The GitHub release body and the deployment step summary now carry: app commit SHA,
target environment, whether migrations changed, the migration versions applied in
this release (or `none`), and the `migration_parity` result. A release note that
names only the app SHA cannot answer "was the schema ahead of, behind, or level
with this code?" six months later.

---

## 2. What Wave 1 did NOT fix — the Vercel gap

**The web deploy is still not gated by the migration job.**

```
push to main
├─ GitHub Actions:  quality → migrations → deploy-functions → health-check → … → completion gate
└─ Vercel GitHub App: builds and promotes to production  ← independent, concurrent, ungated
```

The `deploy` job in `deploy-production.yml` (the Actions-side Vercel CLI deploy,
which *is* ordered after `migrations`) is guarded by
`if: ${{ vars.USE_CLI_DEPLOY == 'true' }}` and is **skipped**, because the repo
variable is `false`. Vercel's own GitHub App integration therefore performs the
production deploy, on its own trigger, with no knowledge of the Actions run.

**Consequence — the interim risk.** A failing `Apply Database Migrations` job now
turns the whole Actions run red (health-check requires it, and the completion gate
asserts it directly), but **the new application code is already live**, because
Vercel shipped it in parallel. The gate is an *alarm*, not yet an *interlock*.
Until §3 is applied, treat a red completion gate on `main` as a live incident:
either roll the Vercel deployment back (Vercel dashboard → Deployments → previous
production deployment → Promote/Rollback) or fix the database forward, immediately.

`apps/host/scripts/ignore-build.cjs` cannot close this: it filters Vercel builds by
changed file paths only and has no knowledge of the Actions run's outcome.

---

## 3. The owner-side change (NOT APPLIED — requires owner action)

Two settings must change, **together and in this order**.

### 3.1 The exact settings

| # | Setting | Where | Current observed value | Required value |
|---|---|---|---|---|
| A | Vercel Git production auto-deploy for branch `main` | Vercel dashboard → project → Settings → Git → *Production Branch* / *Ignored Build Step* (or Settings → Git → "Automatically deploy from Git" for the production branch) | **enabled** (Vercel's GitHub App deploys every push to `main`) | **disabled** for the production branch |
| B | GitHub repo variable `USE_CLI_DEPLOY` | GitHub → repo → Settings → Secrets and variables → Actions → *Variables* | **`false`** (last updated 2026-07-18) | **`true`** |

> **Doc conflict to be aware of.** `docs/runbooks/SRE_RUNBOOK.md` §13 states
> `USE_CLI_DEPLOY=true` was set on 2026-07-17T13:35Z and calls it "the CURRENT
> ACTIVE production path". That is **stale** — the variable was observed as
> `false` (last updated 2026-07-18) on 2026-08-09. Whoever applies §3 should also
> correct SRE_RUNBOOK.md §13 in the same change.

### 3.2 Why both must change, and why the order matters

- **Flipping B alone produces DOUBLE production deploys.** With
  `USE_CLI_DEPLOY=true`, the Actions `deploy` job runs `vercel build --prod` +
  `vercel deploy --prebuilt --prod`, promoting a deployment to the production
  alias. Vercel's GitHub App is *also* still building the same commit and
  promoting it. Two deployments race for the production alias; which one wins is
  timing-dependent, and the health-check/post-deploy-verify SHA proofs can end up
  probing whichever landed last. That is strictly worse than the current state.
- **Flipping A alone leaves production undeployed.** With Vercel auto-deploy off
  and `USE_CLI_DEPLOY` still `false`, nothing deploys the web app at all.
- **Therefore: A first, then B, in the same maintenance window.** There is a short
  window between A and B in which a push to `main` would not deploy the web app.
  Do not push to `main` between the two steps.

Required order of operations:

1. Announce a short deploy freeze on `main`.
2. **A** — disable Vercel Git production auto-deploy for `main` in the Vercel dashboard.
3. Confirm no in-flight Vercel deployment is running (Vercel → Deployments).
4. **B** — set the GitHub repo variable `USE_CLI_DEPLOY=true`.
5. Confirm `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` are present as repo
   secrets (the `deploy` job needs all three; `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`
   are already read into workflow `env`).
6. Lift the freeze and push a trivial commit to `main` to exercise the path.
7. Run §4 verification.
8. Update `docs/runbooks/SRE_RUNBOOK.md` §13 and the "Status" banner at the top of
   this file.

**Rollback of §3:** re-enable Vercel Git auto-deploy for `main` (A), then set
`USE_CLI_DEPLOY=false` (B) — reverse order, so the repo never sits with neither
deploy path active.

### 3.3 What §3 actually buys

Once applied, `deploy` (`needs: [quality, pre-deploy-checklist, migrations]`) is
the only path to production, so **a failing migration lane means the new code is
never promoted**. That converts the Wave 1 alarm into a true interlock.

---

## 4. Verification procedure (run after §3)

Observe all five. Any one failing means §3 did not take effect.

**In the GitHub Actions run** (Deploy Production — Alfanumrik, on the next push to `main`):

1. The job **`Deploy to Vercel Production`** shows a real result (`success`), **not
   `Skipped`**. Skipped means `USE_CLI_DEPLOY` is still not exactly the string `true`.
2. That job's log contains `vercel deploy --prebuilt --prod` output ending in a
   `https://…vercel.app` URL, and the job's `deploy-url` output is non-empty.
3. `Post-Deploy Health Check` ran (it requires `needs.deploy.result == 'success'`
   when `USE_CLI_DEPLOY == 'true'`) and `Production Release Completion Gate` is
   green with the new database assertions in its log:
   `Production release completion evidence is complete for <sha>.`

**In the Vercel dashboard** (project → Deployments):

4. Exactly **one** production deployment exists for that commit SHA. Two
   deployments for the same SHA means Vercel Git auto-deploy (§3.1 A) is still on —
   revert B immediately and finish A first.
5. That deployment's source reads as a CLI/token deployment rather than a Git
   integration deployment (Vercel → Deployments → the deployment → *Source* /
   *Created by*; a GitHub-App deploy is attributed to the Git integration and the
   branch, a CLI deploy to the token's user). Settings → Git shows production
   auto-deploy disabled for `main`.

**Negative test (recommended, on a throwaway branch promoted to `main` only if you
accept the risk — otherwise do this on staging):** push a commit that intentionally
fails the migration lane and confirm no new production deployment appears. This is
the only observation that actually proves the interlock rather than the ordering.

---

## 5. Summary: enforced vs. still open

| Invariant | Status after Wave 1 (in-repo) |
|---|---|
| A production release cannot be recorded "complete" unless the migration lane succeeded | **Enforced** (completion gate asserts `needs.migrations.result == 'success'`) |
| A skipped/cancelled migration lane cannot pass as green | **Enforced** (literal string comparison against `'success'`) |
| Every production release verifies database state, including frontend-only releases | **Enforced** (parity check runs on both paths) |
| Out-of-band remote-ledger drift is surfaced on the release that follows it | **Enforced** (parity check, `migration_parity=drift`, offending versions in the step summary) |
| Edge Functions deploy success is asserted terminally | **Enforced** |
| The release record names the migration set it shipped against | **Enforced** |
| **New application code is not promoted to production when migrations fail** | **NOT ENFORCED — blocked on §3 (owner action, outside the repo)** |
