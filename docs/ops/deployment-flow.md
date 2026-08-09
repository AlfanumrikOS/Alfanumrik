# Alfanumrik Deployment Flow

**Last verified**: 2026-04-02

## CI/CD Pipeline

Three GitHub Actions workflows handle all builds and deployments.

### 1. CI Pipeline (`ci.yml`)

**Trigger**: Push to `main`, `master`, `develop`; PRs to `main`, `master`.

```
Push/PR
  |
  v
[quality] ubuntu-latest, Node 22
  |- npm ci
  |- npm audit --audit-level=high (continue-on-error: true)
  |- npm run lint
  |- npm run type-check
  |- npm test -- --reporter=verbose
  |
  v
[build] (depends on quality)
  |- npm ci
  |- npm run build
  |- Bundle size report (GitHub Step Summary)
  |- Upload .next/ artifact (7-day retention)
  |
  v
[health-check] (main branch push only, after build)
  |- Wait 60s for Vercel deployment
  |- curl https://alfanumrik.vercel.app/api/v1/health
  |- 3 attempts, 15s apart
  |- Fail if no HTTP 200
```

**Concurrency**: `ci-${{ github.ref }}`, cancel-in-progress.

**Environment Variables (CI)**: Placeholder Supabase URL and anon key are used. No real secrets needed for type-check, lint, or unit tests.

### 2. Production Deploy (`deploy-production.yml`)

**Trigger**: Push to `main` only.

```
Push to main
  |
  v
[quality] (same as CI: lint + type-check + test + build)
  |
  v
[deploy] (requires "production" environment approval)
  |- npm ci
  |- Read package.json version
  |- Install Vercel CLI
  |- vercel pull --environment=production
  |- vercel build --prod
  |- vercel deploy --prebuilt --prod
  |- Output: deploy URL
  |
  v
[health-check]
  |- Wait 60s
  |- curl {deploy-url}/api/v1/health
  |- 3 attempts, 15s apart
  |
  v
[release] (requires contents:write permission)
  |- Create GitHub release tag (vX.Y.Z)
  |- If tag exists, append short SHA (vX.Y.Z+abc1234)
  |- Post deployment summary to GitHub Step Summary
```

**Concurrency**: `deploy-production`, cancel-in-progress.

**Secrets required**: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`.

**Environment gate**: The `deploy` job requires the `production` environment, which can be configured in GitHub to require manual approval.

### 3. Staging Deploy (`deploy-staging.yml`)

**Trigger**: Push to `develop` or `staging` branches.

```
Push to develop/staging
  |
  v
[quality] (lint + type-check + build; no unit tests in staging)
  |
  v
[deploy]
  |- vercel pull --environment=preview
  |- vercel build (non-prod)
  |- vercel deploy --prebuilt (preview, not --prod)
  |- Output: preview URL
  |- Comment preview URL on associated PRs (auto-cleans old comments)
  |
  v
[health-check]
  |- Wait 30s
  |- curl {preview-url}/api/v1/health
  |- 3 attempts, 15s apart
```

**Concurrency**: `deploy-staging-${{ github.ref }}`, cancel-in-progress.

**Note**: Staging does NOT run unit tests (only lint, type-check, build). Tests are run in the CI workflow which also triggers on `develop`.

## Vercel Deployment Configuration

| Setting | Value |
|---|---|
| Region | bom1 (Mumbai, India) |
| Framework | Next.js (auto-detected) |
| Build command | `next build` (via Vercel CLI in CI) |
| Output directory | `.next/` |
| Node.js version | **22.x** — controlled by `engines.node` (`>=22.0.0 <23.0.0`) in `package.json`, **not** by the Vercel dashboard. When `engines.node` is present Vercel honours it and it overrides the dashboard "Node.js Version" setting, so the dashboard value is now cosmetic. Changing the production runtime Node major means editing `engines.node`, not the dashboard. |
| Serverless function timeout | Default (10s for Hobby, 60s for Pro) |

### Node Version Pin (repo-wide)

Node is pinned to **22.x** in every plane. There is exactly one supported major; there is no fallback.

| Surface | Where the pin lives | Value |
|---|---|---|
| Local dev | `.nvmrc` | `22` |
| Local + CI installs | root `.npmrc` → `engine-strict=true` | makes a mismatch a hard `npm install`/`npm ci` failure, not a warning |
| All workspaces | `engines.node` in root + `apps/host` + `packages/lib` + `packages/ui` + `eslint-plugin-alfanumrik` `package.json` | `>=22.0.0 <23.0.0` |
| GitHub Actions | `NODE_VERSION: '22'` (`ci.yml`, `deploy-production.yml`, `deploy-staging.yml`, `e2e-suite.yml`) and literal `node-version: '22'` in the standalone workflows | latest 22.x resolved by `actions/setup-node` |
| Container builds | `Dockerfile` (all 3 stages) | `node:22-alpine` |
| Vercel runtime | `engines.node` (overrides the dashboard setting) | 22.x |

**Effective floor is 22.22.0, not 22.0.0.** `engine-strict` validates the *whole* dependency tree, and the tightest transitive constraint is `posthog-node` → `^20.20.0 || >=22.22.0`. Node 22.0–22.21 therefore fails `npm ci` even though it satisfies our own `engines` range. Re-check this floor whenever `posthog-node` is bumped.

**Emergency unblock (one line, no code change):** set `engine-strict=false` in the root `.npmrc`. See the Troubleshooting section of `DEPLOYMENT_RUNBOOK.md` for the full failure-mode table.

#### Which `package.json` does Vercel read?

Vercel reads `engines.node` from the `package.json` in the project's configured **Root Directory**, not necessarily the repo root. This project's `vercel.json` lives at `apps/host/vercel.json` and its `functions` globs are written relative to `apps/host` (`src/app/api/**`), which indicates the Vercel Root Directory is `apps/host`.

Both files now declare the same range, so the distinction no longer changes the outcome. It matters for one thing only: **you cannot infer the pre-pin production runtime from the repo.** Before the 2026-08 pin, the repo root had no `engines` block while `apps/host` declared `>=20.0.0 <23.0.0`, and the Vercel dashboard was last observed at 24.x (`docs/superpowers/discovery/PRODUCTION_TRUTH.md`, 2026-05-06). Those three inputs imply different answers. Measure it, do not reason about it.

#### Verifying the live Node version

There is exactly one authoritative answer, and it is served by the app itself:

```bash
curl -fsS https://alfanumrik.com/api/v1/health | jq '.environment.node_version'
```

`environment.node_version` is `process.version` read inside the live serverless function (`apps/host/src/app/api/v1/health/route.ts`). It reports the full `vMAJOR.MINOR.PATCH`, so it answers both "which major is production on" and "is the minor above the 22.22.0 floor." Capture it **before and after** any deploy that touches `engines.node`, and record both values in the release evidence.

Secondary sources, in decreasing order of trust:
- **Vercel build logs** — the build output names the Node version the *build image* used. This is the number that decides whether `npm ci` clears the 22.22.0 floor.
- **Vercel dashboard → Project Settings → Node.js Version** — cosmetic once `engines.node` exists. Do not trust it.

#### The build-image minor is not pinnable

Vercel exposes a Node **major** selector only; the minor inside that major comes from whatever the build image currently ships and drifts on Vercel's schedule, with no repo-side knob and no advance notice. Because `engine-strict=true` enforces the transitive 22.22.0 floor at install time, a build-image minor below 22.22.0 fails `npm ci` **during the build**. Two consequences:

- The failure is loud and pre-production — a Vercel build failure, never a bad deploy. This is the pin working as designed.
- A deploy that succeeded yesterday can fail today with no repo change. If a Vercel build starts failing `EBADENGINE` out of nowhere, check the build-log Node version before looking for a code cause.

Margin is thin: the floor is 22.22.0 and the latest 22.x is 22.23.2. Re-check this whenever `posthog-node` is bumped — recompute the true floor from the lockfile rather than trusting this paragraph:

```bash
node -e "
const l=require('./package-lock.json');
let best=null;
for (const [name,meta] of Object.entries(l.packages||{})) {
  const r = meta && meta.engines && meta.engines.node;
  if (typeof r !== 'string') continue;
  for (const m of r.matchAll(/>=\s*22\.(\d+)\.(\d+)/g)) {
    const v = (+m[1])*1e6 + (+m[2]);
    if (!best || v > best.v) best = { v, name, range: r, floor: \`22.\${m[1]}.\${m[2]}\` };
  }
}
console.log(best ? \`effective 22.x floor: \${best.floor} (from \${best.name}: \${best.range})\` : 'no 22.x floor found');
"
```

As of 2026-08-09 that prints `effective 22.x floor: 22.22.0 (from node_modules/posthog-node: ^20.20.0 || >=22.22.0)`. Compare minors numerically, not by array/string comparison — `>=22.3.0` sorts above `>=22.22.0` under string coercion and will silently report the wrong floor.

### Environment Variables in Vercel

Configured per environment (Production / Preview / Development):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPER_ADMIN_SECRET`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

Vercel auto-provides: `VERCEL_ENV`, `VERCEL_REGION`, `VERCEL_DEPLOYMENT_ID`, `VERCEL_GIT_*`.

### Production Build Validation

`next.config.js` enforces that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are present in production. Missing either will throw at build time.

## Environment Management

| Environment | Branch | Vercel Target | Supabase Project | Purpose |
|---|---|---|---|---|
| Production | `main` | Production | Production project | Live users |
| Staging | `develop`, `staging` | Preview | Same or separate project | Pre-release testing |
| Development | Local | N/A | Local or dev project | Developer workstations |

### Branch Strategy
- `main` -- production deployments, protected
- `develop` -- integration branch, triggers staging
- Feature branches -- PR to `main` or `develop`, triggers CI only

## Migration Strategy

### Supabase Migrations (190 files)
- Location: `supabase/migrations/`
- Naming: `YYYYMMDDHHMMSS_description.sql`
- Applied to Supabase via `supabase db push` or Supabase Dashboard

### Migration Rules
1. Migrations are append-only. Never modify an applied migration.
2. New tables must include `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` and at least one RLS policy in the same migration.
3. Destructive operations (`DROP TABLE`, `DROP COLUMN`) require user approval and a compensating rollback migration prepared in advance.
4. Migrations are currently applied manually (not automated in CI/CD).

### Migration Application Process (Current)
1. Write migration SQL file in `supabase/migrations/`
2. Test locally with `supabase db reset` (if using local Supabase)
3. Apply to staging Supabase project manually
4. Verify via super admin diagnostics page
5. Apply to production Supabase project
6. Deploy code that depends on the migration

### Migration Application Process (Target)
- Automated migration application in CI/CD pipeline
- Staging auto-apply on `develop` push
- Production apply with manual approval gate

## Post-Deployment Verification

### Automated (in CI)
1. Health check: `GET /api/v1/health` returns HTTP 200 with `status: "healthy"`
2. Health check validates: database connectivity, auth service connectivity

### Manual (operator checklist)
1. Verify super admin control room shows correct deployment info
2. Check Sentry for new error spikes
3. Verify Vercel function logs for errors
4. Spot-check a quiz flow (if quiz-related changes)
5. Verify payment webhook endpoint responds (if payment-related changes)
