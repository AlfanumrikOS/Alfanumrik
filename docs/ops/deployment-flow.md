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
[quality] ubuntu-latest, Node 20
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
| Node.js version | 20.x |
| Serverless function timeout | Default (10s for Hobby, 60s for Pro) |

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
