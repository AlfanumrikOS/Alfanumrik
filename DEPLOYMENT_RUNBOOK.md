# Alfanumrik Production Deployment Runbook

**Last updated:** 2026-07-10
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
| Web app | Vercel GitHub App and optional Vercel CLI workflow | `.github/workflows/deploy-production.yml`, `vercel.json` | Production deploys from `main`. Health checks must use the canonical domain and automation bypass where configured. |
| Database | Supabase CLI through GitHub Actions or controlled operator command | `supabase/migrations/`, `scripts/deploy/deploy_database.sh` | Migrations are forward-only and must be idempotent. |
| Edge Functions | Supabase CLI deploy of changed functions | `supabase/functions/`, `scripts/edge-function-manifest.json` | Functions require deploy freshness and secret activation proof. |
| Jobs / cron | Vercel crons plus Supabase/DB-backed job history | `vercel.json`, `scripts/job-registry.json` | Each job must expose a last-success metric and alert threshold. |
| Release evidence | Repo and operator gate manifests | `scripts/product-readiness-release-gate.ts`, `scripts/live-readiness-evidence-manifest.json` | Broad launch requires a fresh evidence bundle. |

The older CI-independent model is retired. If GitHub Actions, Vercel, or Supabase automation is unavailable, use the manual fallback steps in this runbook and record the reason in the release evidence.

---

## Release Policy

### Hard Rules

- Release only from a clean, reviewed Git commit.
- Do not deploy from a dirty working tree.
- Do not broaden rollout if any repo-owned gate fails.
- Do not broaden rollout if any required live evidence gate is missing, stale, or failed.
- Do not bypass migrations, Edge Function deploys, tenant-isolation smoke, or feature-flag verification for convenience.
- Treat Vercel protection-challenge soft-passes as "not verified", not as proof of production health.
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
| Node.js 22.x | Build, tests, release gates | `node --version` |
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
| `VERCEL_TOKEN` | GitHub Actions | Optional Vercel CLI deployment and rollback. |
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
- `.github/workflows/synthetic-monitor.yml`
- migration, Edge Function, OpenAPI, mobile, and content-quality workflows when touched

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
2. Promote the last known-good production deployment.
3. Verify `https://alfanumrik.com/api/v1/health`.
4. Record the rollback SHA and reason.

CLI fallback:

```bash
vercel ls --prod
vercel promote <previous-deployment-url> --yes
```

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

### AWS ECS Rollback

The AWS ECS workflow is gated by `vars.ENABLE_AWS_DEPLOY`. Use it only during AWS cutover or controlled ECS rollout.

If ECS smoke fails, the workflow attempts rollback to the previous task definition. Manual fallback:

```bash
aws ecs update-service --cluster <cluster> --service <service> --task-definition <previous-task-definition> --force-new-deployment
```

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
- Check synthetic monitor status.
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
