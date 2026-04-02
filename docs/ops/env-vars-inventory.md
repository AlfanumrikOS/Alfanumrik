# Environment Variables Inventory

**Last verified**: 2026-04-02

## Required Variables (Production)

### Supabase (Critical — app won't function without these)
| Variable | Scope | Description | Validated |
|----------|-------|-------------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase project URL | Yes (next.config.js) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | Supabase anonymous key (safe for client) | Yes (next.config.js) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase admin key (bypasses RLS) | Yes (env-validation.ts) |

### Razorpay (Critical — payments fail without these)
| Variable | Scope | Description | Validated |
|----------|-------|-------------|-----------|
| `RAZORPAY_KEY_ID` | Server only | Razorpay API key ID | Yes (env-validation.ts) |
| `RAZORPAY_KEY_SECRET` | Server only | Razorpay API secret | Yes (env-validation.ts) |
| `RAZORPAY_WEBHOOK_SECRET` | Server only | Webhook signature verification | Yes (env-validation.ts) |

### Admin (Critical — admin panel inaccessible without this)
| Variable | Scope | Description | Validated |
|----------|-------|-------------|-----------|
| `SUPER_ADMIN_SECRET` | Server only | Admin panel access gate | Yes (env-validation.ts) |

## Optional Variables (Degraded but functional without these)

### Rate Limiting (Falls back to in-memory)
| Variable | Scope | Description | Fallback |
|----------|-------|-------------|----------|
| `UPSTASH_REDIS_REST_URL` | Server only | Redis endpoint for distributed rate limiting | In-memory Map (per-instance) |
| `UPSTASH_REDIS_REST_TOKEN` | Server only | Redis auth token | In-memory Map |

### Monitoring (Errors still logged to console)
| Variable | Scope | Description | Fallback |
|----------|-------|-------------|----------|
| `NEXT_PUBLIC_SENTRY_DSN` | Client + Server | Sentry error tracking | Console logging only |
| `SENTRY_ORG` | Build only | Sentry org for source maps | No source maps in Sentry |
| `SENTRY_PROJECT` | Build only | Sentry project for source maps | No source maps in Sentry |

## Vercel-Provided Variables (Automatic)

These are set automatically by Vercel and should NOT be manually configured:

| Variable | Description |
|----------|-------------|
| `VERCEL_ENV` | `production`, `preview`, or `development` |
| `VERCEL_REGION` | Deployment region (e.g., `bom1` for Mumbai) |
| `VERCEL_DEPLOYMENT_ID` | Current deployment identifier |
| `VERCEL_GIT_COMMIT_SHA` | Git commit hash |
| `VERCEL_GIT_COMMIT_REF` | Git branch name |
| `VERCEL_GIT_COMMIT_MESSAGE` | Commit message |
| `VERCEL_GIT_COMMIT_AUTHOR_LOGIN` | Git author |
| `NODE_ENV` | `production` in production deployments |

## Security Rules

1. **Never prefix secrets with `NEXT_PUBLIC_`** — this exposes them to the client bundle
2. **`SUPABASE_SERVICE_ROLE_KEY` is server-only** — enforced by `supabase-admin.ts` import restriction
3. **Razorpay keys are server-only** — used only in API routes
4. **`SUPER_ADMIN_SECRET` is server-only** — checked in middleware and admin-auth
5. **Post-edit hook** blocks any `NEXT_PUBLIC_` variable that contains `SERVICE_ROLE`, `SECRET_KEY`, or `PRIVATE_KEY`

## Startup Validation

Environment variables are validated at:
1. **Build time**: `next.config.js` checks `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in production
2. **Runtime**: `src/lib/env-validation.ts` provides `validateEnv()` for comprehensive validation
3. **CI**: Placeholder values set in `.github/workflows/ci.yml` for build testing

## Local Development

Copy `.env.local.example` to `.env.local` and fill in values:
```bash
cp .env.local.example .env.local
```

For local development, only Supabase variables are required. Redis, Sentry, and Razorpay are optional (graceful degradation).
