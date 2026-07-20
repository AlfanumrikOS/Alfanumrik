# GitHub Operations — CI/CD, Branch Protection, and the Pipeline Watcher

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Runbook
**Priority:** P0 (Critical — GitHub Actions is the only sanctioned path to production)
**Applies To:** Every GitHub operation that gates or ships code: branch protection, the CI pipeline, required checks, secret management, the deploy workflows, and the pipeline-failure watcher.

---

# Purpose

GitHub Actions is where AEOS docs 11 (Git Workflow) and 20 (Deployment Pipeline) become **mechanically enforceable**. This runbook is the executable operator's view of the real workflows in `.github/workflows/`: what each gate does, which checks must be green to merge or ship, how secrets are managed, and how a red `main` pipeline is made impossible to miss.

The governing principle (core doc 20): *the pipeline is the single sanctioned path to production; manual deployment is prohibited except under a documented break-glass procedure, and gates are fail-closed — the absence of a passing result is a failure, never a pass.*

---

# Scope

In scope: `ci.yml`, `deploy-production.yml`, `deploy-staging.yml`, the dormant `deploy-aws.yml`, the `pipeline-alert.yml` watcher, and the `synthetic-monitor.yml` external probe. Branch protection on `main`, required status checks, and the GitHub Actions secrets/variables posture.

Out of scope: provider mechanics covered elsewhere — Vercel (`extensions/vercel.md`), AWS/ECS/CloudFront (the aws-operations runbook), and SLO/incident response (the SRE runbook).

---

# Branch Protection

Per core doc 11, `main` (and any `production` / `release/*` branch) is protected. Configure GitHub → Settings → Branches → Branch protection rules for `main`:

1. **Require a pull request before merging.** Direct pushes to `main` are prohibited.
2. **Require status checks to pass before merging.** Mark the BLOCKING jobs below as required (the advisory ones must NOT be required).
3. **Require branches to be up to date before merging** so checks run against the post-merge tree.
4. **Require linear history** (squash or rebase merge; avoid noise merge commits).
5. **Block force pushes** on `main` / `production` / `release/*`. Force push is permitted only on personal feature branches.
6. **Restrict who can dismiss reviews** and require review approval (evidence-based, per core doc 11).

Working branches follow the convention `feature/*`, `bugfix/*`, `hotfix/*`, `refactor/*`, `infra/*`, `security/*`, `docs/*`, `test/*`. Keep them short-lived. Conventional Commits are mandatory (`type(scope): description`).

---

# The CI Pipeline (`ci.yml`)

`ci.yml` runs on push to `main`/`master`/`develop` and on PRs to `main`/`master`. Node 22. Concurrency cancels in-progress runs per ref. Since 2026-07-20 the topology is **parallel**: every root job (secret-scan, quality, the 4 unit-test shards, edge-function-tests, integration-tests, build, e2e, e2e-critical-paths) starts at t=0 with no cross-job `needs`; the only fan-ins are `unit-tests-merge` (over quality + the shards) and the aggregate `ci-gate`. Jobs:

## 1. secret-scan (BLOCKING)
- **Gitleaks** scan over full history (BLOCKING — a leak fails CI; allowlist false positives via `.gitleaks.toml`, never by disabling the gate).
- An advisory regex secret scan (warns, does not block) catches `sk_live_*`, `rzp_live_*`, service-role JWTs, and `NEXT_PUBLIC_*` secret exposure.
- **Migration safety — RLS-on-CREATE-TABLE (BLOCKING):** any migration that `CREATE TABLE`s without `ENABLE ROW LEVEL SECURITY` in the same file fails the run. This is the mechanical enforcement of product invariant **P8**. `_legacy/` is skipped; view/type/function-only migrations are unaffected.

## 2. quality — display name "Lint & Type-check" (BLOCKING)
Runs independently of secret-scan (so an infra flake in gitleaks cannot silently skip lint/type-check):
- `npm ci`, `npm audit` (critical vulns fail), dependency license check,
- **lint** (`npm run lint`),
- Supabase type-drift check (advisory, `continue-on-error`),
- **type-check** (`npm run type-check`, 6 GB heap),
- **Auth & Identity test gate (BLOCKING, separate step):** `auth-*` and `identity-*` specs must pass independently so unrelated test churn cannot mask an auth regression (product invariant **P15**). This gate lives here (not in the shards) and is enforced on the merge gate via the `unit-tests-merge` fan-in below.

## 2b. unit-tests (matrix "Unit Tests (shard N/4)") + unit-tests-merge fan-in — display name "Lint, Type-check & Test" (BLOCKING)
The unit-test suite runs as **4 parallel shards**; each uploads a Vitest blob report artifact (`vitest-blob-shard-N`, `retention-days: 1`, `overwrite: true`). The `unit-tests-merge` fan-in (`if: always()` + explicit re-assertion that `quality` and all 4 shards concluded `success`, so a failed/skipped upstream can never satisfy the check) downloads the blobs, runs `--merge-reports`, and enforces the coverage thresholds from the root `vitest.config.ts` against the merged coverage. Its display name is deliberately kept as **"Lint, Type-check & Test"** so the branch-protection context is unchanged. Live-DB migration/script tests are still excluded here and run in `integration-tests`.

## 3. edge-function-tests (BLOCKING)
Hermetic, offline Deno tests (`--allow-read --allow-env`, **no `--allow-net`**) for contract canaries (`parent-portal`, `teacher-dashboard`, `daily-cron`) and pure helpers (`grounded-answer`, `bulk-jee-neet-curated-import`). The module cache is pre-warmed so the test step never touches the network.

## 4. integration-tests (BLOCKING when secrets present)
Live-DB Vitest against the staging Supabase project. Skips cleanly on forked PRs (no secrets). Enforces P8/P9 against the real staging schema.

## 5. build (BLOCKING)
Starts at t=0 (since 2026-07-20 it no longer `needs: quality` — the `ci-gate` fan-in still requires both):
- `npm run build` (6 GB heap),
- bundle-size report and **P10 budget gates**: largest shared chunk vs `SHARED_JS_LIMIT_KB=160` (gzipped), middleware vs `120`, per-page vs `260`, plus the authoritative `npm run check:bundle-size` gate,
- uploads the build artifact.

## 6. e2e (ADVISORY) and e2e-critical-paths (BLOCKING)
Both start at t=0 (2026-07-20: `e2e-critical-paths` no longer `needs: build`).
- `e2e` runs the full Playwright suite on PRs only, with `continue-on-error: true` (advisory only — never rely on it as a gate; `ci-gate` does not wait on it).
- `e2e-critical-paths` is **BLOCKING** on PRs to `main`/`master`/`staging`: it runs the two highest-blast-radius specs — quiz happy path (REG-45) and payment checkout (REG-46) — against `https://alfanumrik.com` with mocked RPCs pinning P1/P2/P3.

## 7. health-check (main push only)
Probes `https://alfanumrik.com/api/v1/health` with retry/backoff. Soft-passes ONLY on Vercel deployment-protection challenges (401/403/429); genuine 5xx / connection / DNS / timeout hard-fail. Configure `VERCEL_AUTOMATION_BYPASS_SECRET` for true verification.

---

# Required Checks (merge gate summary)

Mark these as **required** status checks on `main`:

- `Secret Scanning` (gitleaks + RLS-on-CREATE-TABLE)
- `Lint, Type-check & Test` (2026-07-20: this is the `unit-tests-merge` fan-in over `Lint & Type-check` + the 4 unit-test shards; the Auth & Identity gate runs in `Lint & Type-check` and is enforced through this fan-in — context name unchanged)
- `Edge Function Deno Tests`
- `Integration Tests (live DB)` (when staging secrets are configured)
- `Production Build` (includes P10 budgets)
- `E2E Critical Paths (blocking)`

Do **not** require `E2E Tests` (advisory — `ci-gate` does not wait on it either) or `Post-Deploy Health Check` (post-merge). Never weaken a gate to make a red pipeline green — fix the change instead.

---

# Secret Management

Per core docs 09, 11, and 20, secrets live only in GitHub Actions encrypted secrets — never in source.

1. **Per-environment isolation.** Production and staging Supabase tokens differ; production secrets never appear in staging. Set environment-scoped secrets under Settings → Environments where a workflow uses `environment: production`.
2. **Variables vs secrets.** Non-sensitive config (`ENABLE_AWS_DEPLOY`, `AWS_REGION`, `SYNTHETIC_TARGET_URL`, `USE_CLI_DEPLOY`) are Actions **variables**; credentials and tokens are **secrets**.
3. **AWS auth is OIDC.** Use `AWS_DEPLOY_ROLE_ARN` role-assumption — never add static AWS access keys (see the aws-operations runbook).
4. **Never echo secrets.** Do not print secret values into logs or `$GITHUB_STEP_SUMMARY`. The secret-scan and deploy-diff scans are BLOCKING for live token patterns and `NEXT_PUBLIC_*` secret exposure — keep them blocking.
5. **Rotation.** Secrets are rotatable without a code change. To rotate: update the secret in GitHub (and the corresponding provider — Vercel Project env, Supabase function secret, or Secrets Manager), then re-run the relevant deploy. Record the rotation in a runbook; never commit the old or new value.
6. **No privileged secret on a client surface.** `SUPABASE_SERVICE_ROLE_KEY` and any server secret must never be exposed via `NEXT_PUBLIC_*`.

---

# Deploy Workflows

## deploy-production.yml (push to `main` + manual dispatch)
Canonical web deploy is **Vercel's GitHub App** (the CLI `deploy` job is optional, gated on `vars.USE_CLI_DEPLOY`). Stages in order:
1. **quality** (lint/type-check/test/build),
2. **pre-deploy-checklist** (pending-migration list, destructive-change scan for `DROP`/`TRUNCATE`, secret-in-diff scan, env summary incl. region `bom1`),
3. **migrations** — `supabase db push --linked --include-all` to prod (`environment: production`),
4. **deploy-functions** — only changed Edge Functions (all active if `_shared/` changed),
5. **health-check** — canonical domain, auto-rollback on real failure, soft-pass on 429,
6. **post-deploy-verify** — critical endpoints + security-header presence,
7. **release** — GitHub release tag from `package.json` version.

Order matters: **schema first, then Edge Functions, then web.** Migrations are idempotent, so re-runs are safe. A skipped optional job (CLI `deploy`) must not cascade-skip `release` — `release` gates on the always-run jobs (health-check + post-deploy-verify).

## deploy-staging.yml (push to `develop`/`staging` + manual dispatch)
quality → migrations to staging (dedicated staging org token) → Vercel preview deploy (comments preview URL on PRs) → deploy-functions (staging) → health-check against the preview URL.

## deploy-aws.yml (DORMANT)
Gated behind `vars.ENABLE_AWS_DEPLOY` (default `false`); the `Cutover Gate` no-ops the run otherwise. When enabled: OIDC auth → Docker build + SHA tag to ECR → ECS Fargate rolling deploy with circuit breaker → smoke test with auto-rollback. Operating this is the subject of the aws-operations runbook; do not flip the flag outside a planned cutover.

---

# The Pipeline-Failure Watcher (`pipeline-alert.yml`)

A failed pipeline is invisible unless something watches the pipeline itself. This watcher exists because of a real incident (2026-06-12): `Deploy Production — Alfanumrik` was red for 26 days on a broken `SUPABASE_ACCESS_TOKEN` while the synthetic monitor stayed green (the last good prod build kept serving). It is `workflow_run`-triggered on completion of the watched workflows on `main`:

- Watched (byte-exact names): `Deploy Production — Alfanumrik`, `Sync Migrations to Staging`, `CI — Alfanumrik`.
- On `conclusion == 'failure'` for `main`: opens a `pipeline-failure` GitHub issue (guaranteed channel, no secrets needed), deduped to at-most-one open issue per workflow (repeated failures add a comment); best-effort Slack via `PIPELINE_ALERT_SLACK_WEBHOOK` (falls back to `SYNTHETIC_MONITOR_SLACK_WEBHOOK`).
- On the next green `main` run: **auto-closes** the matching issue, so an open `pipeline-failure` issue ALWAYS means "currently broken."

Operator rules:
1. **Treat any open `pipeline-failure` issue as a live incident.** Read the "What this blocks" hint — for a red Deploy Production, prod is serving the last successful deploy and the synthetic monitor will NOT catch it.
2. **The watcher is live only after merge to `main`** (`workflow_run` triggers from the default-branch version of the file).
3. **If a watched workflow is renamed, update the watched-names list** — matching is byte-exact (em-dashes included), or alerts silently stop.
4. The watcher needs only `issues: write` + `actions: read`; do not broaden its permissions.

The external `synthetic-monitor.yml` (every ~15 min, Playwright against prod) complements this: it catches a serving outage even when the pipeline is green. The two together cover both failure shapes — broken pipeline (watcher) and broken serving (synthetic monitor).

---

# Checklist

- [ ] `main` requires PR + the BLOCKING checks; advisory checks are NOT required.
- [ ] Force push blocked on `main`/`production`/`release/*`; linear history enforced.
- [ ] New-table migrations enable RLS in the same file (or the P8 gate blocks merge).
- [ ] Bundle changes stay within P10 budgets.
- [ ] Auth/identity tests pass (the dedicated BLOCKING gate).
- [ ] Secrets are per-environment, OIDC for AWS, never echoed to logs.
- [ ] Production deploy applies migrations before the web build; functions in between.
- [ ] `ENABLE_AWS_DEPLOY` stays `false` outside a planned cutover.
- [ ] Watched workflow names in `pipeline-alert.yml` match their `name:` byte-for-byte.
- [ ] Any open `pipeline-failure` issue is triaged as a live incident.

---

# References

Core docs:
- `11_GIT_WORKFLOW.md` — branch protection, commit standards, merge conditions, rollback discipline.
- `20_DEPLOYMENT_PIPELINE.md` — CI/CD gates, fail-closed posture, schema-before-app ordering.
- `08_TESTING_PROTOCOL.md` — the verification suite that runs as the pipeline gates.
- `09_SECURITY_PROTOCOL.md` — secret handling and least privilege.
- `21_RELEASE_MANAGEMENT.md` — release authorization wrapping the deploy workflows.

Extensions:
- `extensions/github-actions.md` — the binding this runbook operationalizes.
- `extensions/vercel.md` — the canonical deploy target and health-verification mechanics.
- `extensions/aws.md` — the dormant `deploy-aws.yml` gate.

Repo:
- `.github/workflows/ci.yml`, `deploy-production.yml`, `deploy-staging.yml`, `deploy-aws.yml`, `pipeline-alert.yml`, `synthetic-monitor.yml`.

Related runbooks: aws-operations (operating `deploy-aws.yml`), sre (SLOs and incident response).

---

# Final Directive

Keep the blocking gates blocking, apply schema before web, manage secrets least-privileged and per-environment, and never weaken a gate to turn a red pipeline green — fix the change instead. A pipeline nobody watches is a pipeline that fails silently; trust the watcher, treat its issues as incidents, and keep its watched-names list honest.

**End of Document**
