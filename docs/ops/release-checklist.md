# Pre-Release Checklist

Last verified: 2026-04-02
Source files: `.github/workflows/ci.yml`, `.github/workflows/deploy-production.yml`, `.claude/skills/release-gates/SKILL.md`

## CI Pipeline

The CI workflow (`.github/workflows/ci.yml`) runs on:
- Push to `main`, `master`, `develop`
- Pull requests targeting `main` or `master`

Concurrency: one run per branch, in-progress runs are cancelled when a new push arrives.

## Gate 0: Secret Scanning (automated)

Runs before all other gates. Scans source code for hardcoded secrets.

| Pattern | Description |
|---------|-------------|
| `sk_live_*` | Stripe/Razorpay live secret keys |
| `rzp_live_*` | Razorpay live keys |
| `service_role.*eyJ*` | Supabase service role JWTs |
| `NEXT_PUBLIC_.*SERVICE_ROLE` | Service role key exposed to browser (P8 violation) |
| `ghp_*` | GitHub personal access tokens |
| `sk-*` | OpenAI/Claude API keys |

**Fails the pipeline** if any pattern matches outside of known exclusions (CI placeholder values, lock files).

## Gate 1: Quality (Lint + Type Check + Tests + Coverage)

All checks must pass before the build step runs. Depends on Gate 0 passing.

| Check | Command | Criteria |
|-------|---------|----------|
| Security audit | `npm audit --audit-level=high` | Currently `continue-on-error: true` (aspirational) |
| Dependency licenses | `npx license-checker --production` | Allowed: MIT, Apache-2.0, BSD-2/3-Clause, ISC, 0BSD, CC0, Unlicense |
| Lint | `npm run lint` | Exit code 0. No `console.log` in production code. |
| Type check | `npm run type-check` | Exit code 0. No `any` in new code. No `@ts-ignore` without reason comment. |
| Unit tests + coverage | `npx vitest run --coverage` | All tests pass. Coverage reported in step summary. |

**Coverage thresholds** (from `vitest.config.ts`):
- Global: 60% statements/branches/functions/lines
- `xp-rules.ts`: 90% (critical business logic)
- `cognitive-engine.ts`: 80%
- `exam-engine.ts`: 80%

**Note:** Install `@vitest/coverage-v8` to enable coverage reporting. Without it, tests still run but coverage is skipped.

**Regression catalog status:** 4/35 regression tests exist (11%). Critical gaps: quiz scoring (0/8), payment (0/4). The CI does not currently enforce regression catalog completeness -- this is an aspirational gate.

## Gate 2: Production Build + Bundle Size Enforcement

Runs after Gate 1 passes.

| Check | Command | Criteria |
|-------|---------|----------|
| Build | `npm run build` | Exit code 0 |
| Bundle size report | Detailed in GitHub Step Summary | Per-file sizes for shared chunks, page bundles, middleware |
| Bundle size limit | **Enforced -- fails CI** | Shared JS < 160 kB, page < 260 kB, middleware < 120 kB |

**Current bundle sizes (approximate):**
- Shared JS: ~155 kB
- Largest page (`/foxy`): ~254 kB
- Middleware: ~109 kB

The build artifact (`.next/`) is uploaded to GitHub Actions with 7-day retention.

Bundle size limits are now **enforced as a CI gate**. If any limit is exceeded, the build step fails with a message referencing P10 and suggesting `npm run analyze` for investigation.

## Gate 3: Post-Deploy Health Check

Runs only on push to `main` (production deploys).

1. Waits 60 seconds for Vercel deployment to complete
2. Hits `https://alfanumrik.vercel.app/api/v1/health` up to 3 times (15 second retry interval)
3. Expects HTTP 200 with `status: "healthy"`
4. Fails the workflow if all 3 attempts return non-200

## Pre-Merge Checklist (Manual)

Before merging a PR, verify:

### Code Quality
- [ ] No hardcoded secrets (grep for `sk_`, `rzp_live_`, `eyJ`, `service_role`)
- [ ] No `.env` or credential files in the diff
- [ ] No `console.log` (use `logger.info/warn/error` instead)
- [ ] No hardcoded XP values (must use `XP_RULES` from `src/lib/xp-rules.ts`)
- [ ] No integer grades (must be string `"6"` through `"12"`)
- [ ] No `@ts-ignore` without reason comment

### Database Changes
- [ ] Migration is idempotent (uses `IF NOT EXISTS`, `IF EXISTS`)
- [ ] RLS enabled on new tables in the same migration
- [ ] RLS policies cover student/parent/teacher access patterns
- [ ] No `DROP TABLE` or `DROP COLUMN` without user approval
- [ ] No SQL injection vectors in API routes
- [ ] Index added for new foreign keys and frequently queried columns

### API Changes
- [ ] API routes use `authorizeRequest()` for RBAC enforcement
- [ ] Super admin routes use `authorizeAdmin()` for admin auth
- [ ] No PII in API responses that shouldn't contain it (P13)
- [ ] Error responses use standard format `{ error: string, code: string }`

### Product Invariants
- [ ] P1: Score formula unchanged (or user-approved change)
- [ ] P2: XP formula unchanged (or user-approved change)
- [ ] P3: Anti-cheat checks present
- [ ] P4: Quiz submission uses atomic RPC
- [ ] P5: Grade format is string
- [ ] P6: Question quality validations present
- [ ] P7: User-facing text has Hindi translation
- [ ] P11: Payment webhook signature verified
- [ ] P12: AI responses filtered for age-appropriateness
- [ ] P13: No PII in client logs or Sentry events

### Review Chains
- [ ] If grading/XP changed: testing, ai-engineer, backend, frontend, mobile notified
- [ ] If RBAC/auth changed: backend, frontend, ops, testing notified
- [ ] If payment flow changed: architect, testing, mobile notified
- [ ] If AI behavior changed: assessment, testing notified
- [ ] If super-admin APIs changed: frontend, ops, testing notified

## Production Deployment Flow

The production workflow (`deploy-production.yml`) now includes pre-deployment and post-deployment safety gates.

```
PR created
  --> CI runs (secret scan, lint, type-check, test+coverage, build, bundle limit check)
  --> Review + approval
  --> Merge to develop --> Vercel staging preview --> Health check
  --> Merge to main:
      Step 1: Quality gate (lint, type-check, test, build)
      Step 1b: Pre-deploy checklist (automated)
        - Migration detection (flags new migration files in last 10 commits)
        - Destructive change detection (scans for DROP TABLE/COLUMN/TRUNCATE)
        - Secret scan on deployment diff
        - Environment verification
      Step 2: Vercel production deploy (requires environment approval)
      Step 3: Health check (3 retries, 15s intervals)
      Step 3b: Post-deploy verification (automated)
        - /api/v1/health returns 200
        - / (homepage) returns 200
        - /login returns 200 or 307
        - Security headers present (X-Frame-Options)
      Step 4: GitHub release tag + deployment summary
  --> Monitor Sentry for error spikes (manual, 30 min)
```

## Rollback Decision Tree

```
Health check fails after deploy?
  |
  Yes --> Rollback via Vercel dashboard (instant)
  |
  No --> Monitor Sentry for 30 minutes
          |
          Error rate > 2x baseline?
            |
            Yes --> Rollback via Vercel dashboard
            |
            No --> Deploy is successful
```

If a database migration was part of the deploy:
- Do NOT rollback the migration with DROP statements
- Write a compensating migration
- Test in staging first
- Deploy the compensating migration before or alongside the app rollback

## Environment Variables Required for Build

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (production) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (production) | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Runtime only | Server-side admin operations |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | Error monitoring |
| `SENTRY_ORG` | Optional | Sentry source map upload |
| `SENTRY_PROJECT` | Optional | Sentry source map upload |
| `UPSTASH_REDIS_REST_URL` | Optional | Distributed rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Distributed rate limiting |
| `RAZORPAY_KEY_ID` | Runtime only | Payment processing |
| `RAZORPAY_KEY_SECRET` | Runtime only | Payment processing |
| `RAZORPAY_WEBHOOK_SECRET` | Runtime only | Webhook signature verification |
| `SUPER_ADMIN_SECRET` | Runtime only | Legacy internal admin auth |

CI uses placeholder values for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to satisfy the build without real credentials.
