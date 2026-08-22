# Alfanumrik Production Deployment Runbook

**Last updated:** 2026-07-11
**Owner:** DevOps / Platform Engineering
**Production domain:** `https://alfanumrik.com`
**Production Supabase project:** `shktyoxqhundlvkiwguu`

---

## Purpose

This runbook is the operating source of truth for shipping Alfanumrik safely. A production release is considered healthy only when all three layers are green:

1. **Repo-owned gates:** deterministic checks in `scripts/product-readiness-release-gate.ts`.
2. **Deployment gates:** GitHub Actions, Vercel, Supabase migrations, and Supabase Edge Function deployment complete without real failures.
3. **Live evidence gates:** operator-owned verification proves the target environment is healthy, secure, and aligned with the release candidate.

Do not treat a green local build or a Vercel-ready deployment as broad-launch approval by itself.

---

## Current Deployment Model

Alfanumrik currently uses a multi-plane deployment model:

| Plane | Primary mechanism | Source of truth | Notes |
|---|---|---|---|
| Web app | Vercel GitHub App and optional Vercel CLI workflow | `.github/workflows/deploy-production.yml`, `vercel.json` | Production mutations are push-to-`main` only; release identity is proved on the canonical domain. |
| Database | Supabase CLI through GitHub Actions or controlled operator command | `supabase/migrations/`, `scripts/deploy/deploy_database.sh` | Migrations are forward-only and must be idempotent. |
| Edge Functions | Supabase CLI deploy of changed functions | `supabase/functions/`, `scripts/edge-function-manifest.json` | Functions require deploy freshness and secret activation proof. |
| Jobs / cron | Vercel crons plus Supabase/DB-backed job history | `vercel.json`, `scripts/job-registry.json` | Vercel is the sole schedule authority; GitHub runner is disabled break-glass only. |
| Release evidence | Repo and operator gate manifests | `scripts/product-readiness-release-gate.ts`, `scripts/live-readiness-evidence-manifest.json` | Broad launch requires a fresh evidence bundle. |

The older CI-independent model is retired. If GitHub Actions, Vercel, or Supabase automation is unavailable, use the manual fallback steps in this runbook and record the reason in the release evidence.

### Phase 0 Delivery Containment

- The production deploy workflow is push-to-`main` only. Manual force redeploy is suspended until a protected break-glass environment exists.
- The pre-mutation bypass probe accepts semantic app health JSON with a known status, timestamp, and non-empty version SHA; it does not require dependencies to be healthy during a repair.
- Canonical production is polled for approximately ten minutes. Both health stages must prove `ok===true`, `status==='healthy'`, and `version.git_sha===GITHUB_SHA[:7]` before any release/tag.
- Automatic web rollback requires `CURRENT_SHA_SEEN=1`, unhealthy exact-SHA evidence, and immediate canonical revalidation. Before any release mutation, the workflow must also have captured the same fresh, semantically healthy canonical deployment identity on both sides of the preflight probe. Missing or raced deployment metadata, a database migration, an Edge Function change, previous/newer/missing SHA, healthy state, network failure, timeout, and protection responses all suppress automatic rollback.
- Rollback targets are immutable Vercel deployment IDs resolved through the JSON API, never row positions parsed from human `vercel list` output. A rollback is successful only after a bounded canonical poll proves both the captured deployment ID and its healthy exact Git SHA.
- Keep `ENABLE_PRODUCTION_CRON_BREAK_GLASS` absent/false until `production-break-glass` has required reviewers. A dispatch requires one allowlisted route, reason, and exact `RUN_ONE_PRODUCTION_CRON` confirmation; `all` is forbidden.
- Mesh and credentialed content-quality execution are hard-suspended in code;
  neither retains an executable manual secret-bearing path. AWS production
  delivery is also hard-suspended, and `ENABLE_AWS_DEPLOY` was set to `false`
  on 2026-07-11.
  Re-enabling it requires a reviewed workflow change, a protected
  `production-break-glass` environment, main-ref-scoped AWS OIDC trust, and a
  separately verified ECS rollback path. A repository variable alone is never
  sufficient authority.
- Live containment applied 2026-07-11: GitHub workflows `deploy-aws.yml`,
  `mesh-cron.yml`, `content-quality-nightly.yml`, `python-ai-deploy.yml`, and
  `production-cron-runner.yml` are disabled. The unsafe manual/ref paths in
  `mobile-release.yml`, `schema-reproducibility-fix.yml`, `deploy-staging.yml`,
  `seed-staging-test-student.yml`, `staging-adaptive-drill.yml`,
  `staging-flag-set.yml`, `sync-staging-functions.yml`,
  `sync-staging-migrations.yml`, `rag-eval.yml`, `synthetic-monitor.yml`, and
  `branch-stale-sweep.yml` are also disabled live; their source is not yet safe
  to re-enable. Vercel Git delivery and Vercel cron remain active.
- Live `main` protection now enforces administrators, one approving review,
  stale-review dismissal, last-push approval, conversation resolution, and no
  force-push/deletion. The strict, GitHub-Actions-app-bound aggregate `CI Gate`
  is the required status check.
- Do not set `git.deploymentEnabled.main=false` until the CLI deploy is mandatory and health directly depends on it; PR previews must remain enabled.

---

## Release Policy

### Hard Rules

- Release only from a clean, reviewed Git commit.
- Do not deploy from a dirty working tree.
- Do not broaden rollout if any repo-owned gate fails.
- Do not broaden rollout if any required live evidence gate is missing, stale, or failed.
- Do not bypass migrations, Edge Function deploys, tenant-isolation smoke, or feature-flag verification for convenience.
- Protection challenges are verification failures, not rollback evidence.
- Never create a release/tag without healthy exact-SHA proof from both canonical verification jobs.
- Service-role/admin-client route count must never increase without a reviewed ledger entry and owner.

### Release Types

| Type | When to use | Required proof |
|---|---|---|
| Standard production release | Normal mainline deploy | All repo-owned gates and all required operator-owned gates. |
| Controlled pilot release | Limited tenant or internal rollout | All repo-owned gates, target tenant smoke, feature flags, Edge secrets, job health, incident-ID proof. Accepted risks must be documented. |
| Hotfix | Active incident or severe regression | Focused tests for the fix, production build, affected live smoke, rollback plan, incident note. Run full gates after stabilization. |
| Emergency rollback | Active production outage | Roll back affected plane first, then verify health and open follow-up RCA. |

---

## Required Tools

| Tool | Purpose | Check |
|---|---|---|
| Git | Source control and release SHA traceability | `git --version` |
| Node.js 22.x | Build, tests, release gates | `node --version` — must be `>= 22.22.0` and `< 23`. Pinned in `.nvmrc`; enforced as a hard install failure by `engine-strict=true` in the root `.npmrc`. Run `nvm use` in the repo root. |
| npm | Workspace dependencies and scripts | `npm --version` |
| Supabase CLI | DB migrations and Edge Functions | `supabase --version` |
| Vercel CLI | Optional CLI deploy / rollback support | `vercel --version` |
| Playwright | Certification and smoke E2E | `npx playwright --version` |
| curl | Health checks | `curl --version` |

Install dependencies from the repo root:

```bash
npm ci
```

---

## Required Secrets and Variables

Never commit secrets. Store production values in GitHub Actions environments, Vercel project settings, Supabase project secrets, or a local `.env.deploy` file ignored by Git.

| Name | Scope | Required for |
|---|---|---|
| `VERCEL_ORG_ID` | GitHub Actions | Vercel CLI deployment. |
| `VERCEL_PROJECT_ID` | GitHub Actions | Vercel CLI deployment. |
| `VERCEL_TOKEN` | GitHub Actions | Optional Vercel CLI deployment plus machine-readable rollback baseline capture and guarded rollback. Without it, automatic rollback is suppressed. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | GitHub Actions + Vercel | Real CI health checks through Vercel deployment protection. |
| `SUPABASE_ACCESS_TOKEN` | GitHub Actions / local ops | Production Supabase CLI operations. |
| `SUPABASE_PROJECT_REF` | GitHub Actions / local ops | Production project ref, `shktyoxqhundlvkiwguu`. |
| `SUPABASE_DB_PASSWORD` | GitHub Actions / local ops | `supabase db push --linked`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Local verification only | Production verification scripts that require privileged reads. |
| `UPSTASH_REDIS_REST_URL` | Supabase Edge secret | Durable rate limiting for parent portal. |
| `UPSTASH_REDIS_REST_TOKEN` | Supabase Edge secret | Durable rate limiting for parent portal. |
| `SYNTHETIC_MONITOR_SLACK_WEBHOOK` | GitHub Actions | Synthetic monitor alerting. |
| `SYNTHETIC_AUTH_EMAIL` / `SYNTHETIC_AUTH_PASSWORD` | GitHub Actions | Authenticated synthetic flows. |

---

## Pre-Release Checklist

Run these before merging or deploying a release candidate.

### 1. Confirm Repository State

```bash
git status --short --branch
git fetch origin
git rev-parse HEAD
```

Required:

- Branch is the intended release branch.
- Release commit is pushed.
- No unrelated dirty files.
- Generated artifacts are either intentionally committed or removed from the release scope.

### 2. Inspect the Release Diff

```bash
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

Review with extra care when the diff touches:

- `supabase/migrations/`
- `supabase/functions/`
- `apps/host/src/app/api/`
- `packages/lib/src/rbac.ts`
- `packages/lib/src/flags/`
- `vercel.json`
- `.github/workflows/`
- payment, auth, parent, teacher, school-admin, super-admin, or AI surfaces

### 3. List the Release Gates

```bash
npx tsx scripts/product-readiness-release-gate.ts --list
npx tsx scripts/product-readiness-release-gate.ts --dry-run
```

Expected:

- The command lists all repo-owned and operator-owned gates.
- Dry-run reports all repo-owned gates as configured.

### 4. Run the Repo-Owned Release Gate

```bash
npx tsx scripts/product-readiness-release-gate.ts
```

Expected:

- Every repo-owned gate passes.
- If the monolithic runner times out, run the listed commands directly and capture the outputs in the release evidence.

### 5. Build a Live Evidence Bundle

Print the evidence template:

```bash
npx tsx scripts/verify-live-readiness-evidence.ts --print-template --release-candidate=<rc-id> --target-environment=production --collected-at=<iso-timestamp>
```

Collect evidence for every required gate in `scripts/live-readiness-evidence-manifest.json`, then validate it:

```bash
npx tsx scripts/verify-live-readiness-evidence.ts --input=<evidence-bundle.json>
```

Broad launch requires this verifier to pass or explicitly approved accepted-risk entries where the manifest allows accepted risk.

---

## Standard Production Deployment

### Step 1: Merge to `main`

Use normal review controls. The production workflows are triggered from `main`.

Required GitHub status before merge:

- Secret scanning passes.
- Lint, type-check, unit tests, build, and mandatory regression gates pass.
- Any advisory or skipped check is reviewed and recorded.

### Step 2: Watch GitHub Actions

Monitor:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-production.yml`
- migration, Edge Function, OpenAPI, mobile, and content-quality workflows when touched

`synthetic-monitor.yml` remains manually disabled until its ref, environment,
and secret controls are remediated; it is not active production-health evidence.

Production deploy is not complete until:

- migrations job succeeds,
- changed Edge Functions deploy,
- production health check completes,
- post-deploy verification completes,
- release summary or release tag is created where configured.

### Step 3: Apply Manual Fallback Only If Automation Is Unavailable

If GitHub Actions or Supabase automation is unavailable, use the controlled local fallback from a clean `main` checkout:

```bash
git checkout main
git pull origin main
git status --short --branch
DRY_RUN=1 bash scripts/deploy/deploy_database.sh
bash scripts/deploy/deploy_database.sh
bash scripts/deploy/deploy_functions.sh
bash scripts/deploy/verify_production.sh
```

Record:

- release SHA,
- operator,
- reason automation was unavailable,
- command outputs,
- health check result,
- rollback owner.

### Step 4: Verify Production

Minimum production checks:

```bash
curl -fsS https://alfanumrik.com/api/v1/health
curl -fsS https://alfanumrik.com/api/health
npx tsx scripts/verify-feature-flag-matrix.ts --env=production
npx tsx scripts/verify-grade-format.ts
```

If Vercel deployment protection blocks CI probes, configure `VERCEL_AUTOMATION_BYPASS_SECRET` in both Vercel and GitHub Actions. A protection challenge from CI is not proof that the application is healthy.

### Step 5: Complete Operator-Owned Gates

For broad launch, complete and validate the live evidence bundle. Required categories include:

- certification E2E live run,
- Edge Function deploy and Upstash secret smoke,
- live tenant-isolation smoke,
- production and staging feature-flag DB comparison,
- target DB grade format verification,
- DB function grant inspection,
- live job health inspection,
- lower-tier PII exporter notification and audit review,
- incident-ID observability proof,
- mobile legacy quiz/payment traffic validation,
- historical XP quantification and product decision,
- XC-3 service-role/RLS migration execution,
- TSB-4 class membership live cutover proof,
- product sign-off on route/page/flag/API matrix.

---

## Staging and Preview Deployments

Staging deploys run from `develop` or `staging` through `.github/workflows/deploy-staging.yml`.

Required staging behavior:

- staging migrations apply before preview deploy,
- changed Edge Functions deploy to the staging project,
- preview health check passes,
- PR receives the preview URL when associated with a PR,
- feature flags are verified against staging intent.

Run before promoting a staging candidate:

```bash
npx tsx scripts/verify-feature-flag-matrix.ts --env=staging
npx tsx scripts/product-readiness-release-gate.ts --dry-run
```

For high-risk changes, run the same live evidence template against staging before production.

---

## Rollback Procedures

Alfanumrik has multiple deployment planes. Roll back the plane that caused the incident.

### Web Rollback - Vercel

Use when the web build or routing layer regressed and the database/Edge planes are healthy.

Preferred:

1. Open Vercel Deployments.
2. Confirm the immutable deployment ID and Git SHA of a deployment that previously served the production domain.
3. Use **Instant Rollback** for that known-good production deployment.
4. Verify that `https://alfanumrik.com/api/v1/health` reports `ok=true`, `status=healthy`, and the expected rollback SHA, and verify the canonical alias resolves to the captured deployment ID.
5. Record the rollback deployment ID, SHA, reason, and verification evidence.

CLI fallback:

```bash
vercel inspect alfanumrik.com --format=json
vercel rollback <known-good-deployment-id> --yes --timeout=3m
vercel rollback status --timeout=3m
```

Do not select a rollback target by parsing or taking the second row of human-readable `vercel list` output. If the immutable ID, Git SHA, production eligibility, or canonical health proof is unavailable, stop and use the Vercel Dashboard with an incident reviewer. An Instant Rollback disables automatic production-domain assignment; after the incident is fixed and verified, explicitly undo the rollback or promote the repaired deployment so normal Git production assignment resumes.

### Edge Function Rollback - Supabase

Use when a Supabase Edge Function is stale, broken, or has bad secrets.

```bash
supabase functions logs <function-name> --project-ref shktyoxqhundlvkiwguu
bash scripts/deploy/deploy_functions.sh --function <function-name>
```

If a known-good function version is available in Supabase dashboard, roll back there, then verify logs and affected API flows.

### Database Roll Forward / Compensating Migration

Supabase migrations are forward-only for production operations. Prefer feature-flag disablement or a compensating migration over destructive rollback.

If a migration caused a production incident:

1. Disable the affected feature flag if available.
2. Stop or pause affected jobs/functions if needed.
3. Run targeted validation queries.
4. Write a compensating migration.
5. Apply through normal migration process.
6. Capture RCA and recovery evidence.

Use `scripts/deploy/rollback.sh` only when the migration was designed with explicit rollback support and the risk has been reviewed.

### Node Runtime Rollback - Vercel

Use when a release changed `engines.node` and production regressed afterwards (server-side `TypeError`/`ReferenceError`, native module load failure, Sentry spike concentrated in API routes).

First, confirm what production is actually running:

```bash
curl -fsS https://alfanumrik.com/api/v1/health | jq '.environment.node_version, .version.git_sha'
```

`environment.node_version` is `process.version` from the live function and is the only authoritative source. The Vercel dashboard "Node.js Version" setting is cosmetic once `engines.node` exists.

Then roll back:

1. **Fast path** — Web Rollback (above) to a deployment built *before* the `engines.node` change. This restores the old runtime major, because the Node major is baked into each deployment's built function configuration at build time. Re-run the curl and confirm the major moved back.
2. **Durable path** — revert `engines.node` in the root and every workspace `package.json`, regenerate `package-lock.json` on the target major, redeploy. Architect-owned.

Two traps:

- Reverting `engines.node` in Git changes nothing until a new deployment is built and promoted. If you need the runtime changed now, use the fast path first.
- `engine-strict=false` in `.npmrc` does **not** roll back the runtime. It only relaxes install-time engine checking. See `docs/ops/rollback-plan.md` Scenario 6 (installs blocked) vs Scenario 7 (runtime regressed) — they are different incidents.

### AWS ECS Rollback (decommissioned 2026-08-03)

The AWS ECS Fargate parallel host was decommissioned on 2026-08-03 (CEO decision
2026-07-13). Vercel (bom1) is the sole compute host. There is no AWS ECS deploy
or rollback path to invoke. The CRON_SECRET break-glass runner
(`.github/workflows/production-cron-runner.yml`) no longer depends on AWS — it
reads `secrets.CRON_SECRET` from the GitHub Actions secret store directly. See
`docs/runbooks/aws-host-decommission.md` for the decommission record.

---

## Incident Response

### Severity Triage

| Severity | Examples | Response |
|---|---|---|
| SEV-1 | production down, cross-tenant data leak, payment corruption | Stop rollout, page owner, rollback/disable feature, open incident record. |
| SEV-2 | major role flow broken, cron failure affecting many users, AI unsafe output | Disable affected surface if possible, run focused rollback or hotfix. |
| SEV-3 | isolated tenant issue, degraded analytics, non-critical scheduled job stale | Assign owner, fix in normal release path, monitor. |

### First 15 Minutes

1. Declare incident owner.
2. Capture current deployment SHA and target environment.
3. Identify affected plane: web, DB, Edge Function, cron, third-party dependency, or data.
4. Freeze unrelated deploys.
5. Prefer feature-flag disablement for uncertain DB or product-behavior incidents.
6. Verify user impact with real health or targeted smoke, not only CI status.

### Incident Evidence

Capture:

- `X-Request-Id`,
- Sentry issue or trace,
- PostHog / ops event reference,
- affected tenant and role, redacted,
- release SHA,
- migration versions,
- Edge Function versions,
- rollback or mitigation command,
- final verification output.

---

## Operational Health Standards

### Daily

- Review production deploy status.
- Confirm the disabled GitHub synthetic monitor has not been treated as active evidence;
  use the canonical deployment health checks and Sentry until it is remediated.
- Review Sentry for new high-severity issues.
- Confirm no failed critical cron/job health metrics.
- Review payment reconciliation and webhook errors.

### Weekly

- Verify Supabase backup/PITR status.
- Run production feature-flag matrix verification.
- Review `scripts/job-registry.json` against `vercel.json`.
- Review service-role allowlist count and XC-3 progress.
- Review Edge Function logs for privileged functions.
- Confirm dependency and GitHub Actions health.

### Monthly

- Run disaster-recovery tabletop: Vercel rollback, Supabase restore path, Edge Function redeploy.
- Review public API/OpenAPI drift.
- Review mobile legacy traffic.
- Review PII export audit log.
- Review broad-launch accepted risks.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| CI health check returns 401/403/429 | Vercel deployment protection blocked runner | Configure `VERCEL_AUTOMATION_BYPASS_SECRET`; rerun verification. |
| Health endpoint returns 5xx | App, DB, env, or Edge dependency failure | Check Vercel logs, Supabase status, Sentry, and recent deploy SHA. Roll back web only if DB/Edge are compatible. |
| `supabase db push` fails with `42883` | Function signature or migration ordering mismatch | Inspect `pg_proc`, repair the migration, retry through reviewed path. |
| API reports missing column/table | Migration drift or partial application | Run drift/validation SQL, apply missing migration or compensating migration. |
| Edge Function returns 404 | Function not deployed to target project | Deploy the function and verify Supabase dashboard/logs. |
| Parent portal rate limiting is weak | Upstash Edge secrets missing | Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, then smoke durable limiter. |
| Feature flag behavior differs from expectation | DB flag drift | Run `npx tsx scripts/verify-feature-flag-matrix.ts --env=<env>` and reconcile. |
| Cron appears green but product state is stale | Job lacks live last-success metric or alert | Check `scripts/job-registry.json`, `ops_events`, and `verify-job-health-live.ts`. |
| Mobile clients hit legacy endpoints | Old mobile release or contract drift | Run `verify-mobile-legacy-traffic-live.ts`, block rollout until traffic is clean. |
| `npm ci` / `npm install` fails with `EBADENGINE` / `Unsupported engine` (locally, in CI, in Docker, or in a Vercel build) | Node version outside the pin. Root `.npmrc` sets `engine-strict=true`, so an engine mismatch is a hard failure instead of a warning. Two floors apply: our `engines.node` = `>=22.0.0 <23.0.0`, and the transitive `posthog-node` = `^20.20.0 \|\| >=22.22.0`, making the **effective floor 22.22.0**. | Put the environment on the latest Node 22.x (`nvm use` reads `.nvmrc`). If the failing environment's Node cannot be changed fast enough to clear an outage, use the emergency unblock below. |
| Vercel build fails with `Found invalid Node.js Version` | Vercel no longer offers a Node major satisfying `engines.node`. The range `>=22.0.0 <23.0.0` admits exactly one major and has no fallback, so this fires the day Vercel retires Node 22. | Widen `engines.node` upper bound (e.g. `<25.0.0`) in the root and all workspace `package.json` files, re-run `npm install` to refresh `package-lock.json`, redeploy. Architect-owned change. |
| Production runtime Node major changed unexpectedly after a deploy | `engines.node` in `package.json` **overrides** the Vercel dashboard "Node.js Version" setting. The dashboard value is cosmetic once `engines.node` exists. | Confirm the intended major in `engines.node`, not the dashboard. Record the change in the release evidence — a runtime-major move is a behavioural change, not a config-only one. |

### Emergency Unblock: Node engine pin

The pin's kill switch is one line in the root `.npmrc`:

```
engine-strict=false
```

That reverts npm to its default advisory behaviour (`EBADENGINE` becomes a warning and the install proceeds). It does **not** touch `engines.node`, `.nvmrc`, the workflows, or the Dockerfile, so it is safe to apply and revert in isolation.

- Scope: unblocks *installs* only. It does not change the Vercel runtime Node major — that is governed by `engines.node`.
- Do **not** delete `.npmrc` instead; deleting it loses the documented floor and the rationale.
- Treat any use of this switch as an incident: open a follow-up to restore `engine-strict=true` and record why the environment was off-pin.

---

## Command Reference

### Release Gates

```bash
npx tsx scripts/product-readiness-release-gate.ts --list
npx tsx scripts/product-readiness-release-gate.ts --dry-run
npx tsx scripts/product-readiness-release-gate.ts
```

### Live Evidence

```bash
npx tsx scripts/verify-live-readiness-evidence.ts --print-template --release-candidate=<rc-id> --target-environment=production --collected-at=<iso-timestamp>
npx tsx scripts/verify-live-readiness-evidence.ts --input=<evidence-bundle.json>
```

### Database and Edge

```bash
DRY_RUN=1 bash scripts/deploy/deploy_database.sh
bash scripts/deploy/deploy_database.sh
bash scripts/deploy/deploy_functions.sh
bash scripts/deploy/deploy_functions.sh --all
bash scripts/deploy/deploy_functions.sh --function <function-name>
bash scripts/deploy/verify_production.sh
```

### Live Verification

```bash
npx tsx scripts/verify-feature-flag-matrix.ts --env=production
npx tsx scripts/verify-feature-flag-matrix.ts --env=staging
npx tsx scripts/verify-grade-format.ts
npx tsx scripts/verify-db-function-hardening-live.ts --print-sql
npx tsx scripts/verify-job-health-live.ts --print-sql
npx tsx scripts/verify-mobile-legacy-traffic-live.ts --print-sql
```

---

## Definition of Done

A deployment is complete only when:

- release SHA is known and clean,
- repo-owned release gate passed,
- migrations and Edge Functions are deployed or explicitly not applicable,
- production health is verified against the real app,
- live evidence bundle is fresh and valid for broad launch,
- monitoring is green,
- rollback path is known,
- release notes or deployment summary are recorded.

If any item is missing, the release may be deployed technically, but it is not operationally production-grade.
