# Environment Variables Inventory

**Last verified**: 2026-04-18
**Canonical reference**: [`ENVIRONMENT_SETUP.md`](../../ENVIRONMENT_SETUP.md) at repo root
**Template**: [`.env.example`](../../.env.example)
**Validator**: [`src/lib/env.ts`](../../src/lib/env.ts) (zod-based, typed accessors)

This file is the short-form ops catalog. The full operator guide, including
step-by-step Vercel/Supabase/Mailgun/Razorpay setup, is `ENVIRONMENT_SETUP.md`.

---

## Next.js runtime (Vercel env settings)

### Required — app does not function without these
| Variable | Scope | Used In | Validated By |
|----------|-------|---------|--------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | `src/lib/supabase-client.ts:22`, many pages | `next.config.js`, `src/lib/env.ts` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | `src/lib/supabase-client.ts:23`, many pages | `next.config.js`, `src/lib/env.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | `src/lib/supabase-admin.ts:68`, admin/payment/auth API routes | `next.config.js`, `getServerEnv()` |
| `RAZORPAY_KEY_ID` | Server only | `src/lib/razorpay.ts:12`, `src/app/api/payments/create-order/route.ts:45` | `next.config.js` |
| `RAZORPAY_KEY_SECRET` | Server only | `src/lib/razorpay.ts:13`, `src/app/api/payments/verify/route.ts:63` | `next.config.js` |
| `RAZORPAY_WEBHOOK_SECRET` | Server only | `src/app/api/payments/webhook/route.ts:170` — signature verification (P11) | `next.config.js` |
| `SUPER_ADMIN_SECRET` | Server only | `src/lib/admin-auth.ts:222`, `src/proxy.ts:435` | `next.config.js` |
| `ANTHROPIC_API_KEY` | Server only | `src/lib/ai/config.ts:32`, `src/app/api/foxy/route.ts` | `getAIEnv()` (optional schema; route-level guard) |
| `VOYAGE_API_KEY` | Server only | `src/lib/ai/config.ts:35`, `src/app/api/foxy/route.ts`, `src/app/api/embedding/route.ts` | `getAIEnv()` |
| `CRON_SECRET` | Server only | `src/app/api/cron/*/route.ts` | Route-level guard |

### Optional — graceful degradation if unset
| Variable | Scope | Used In | Fallback |
|----------|-------|---------|----------|
| `UPSTASH_REDIS_REST_URL` | Server | `src/proxy.ts:70`, `src/lib/rbac.ts:57` | In-memory rate-limit Map (per instance) |
| `UPSTASH_REDIS_REST_TOKEN` | Server | `src/proxy.ts:71`, `src/lib/rbac.ts:58` | In-memory rate-limit Map (per instance) |
| `NEXT_PUBLIC_SENTRY_DSN` | Client + Server | `sentry.{client,server,edge}.config.ts` | Console logging only |
| `SENTRY_ORG` | Build only | `next.config.js:125` | No source-map uploads |
| `SENTRY_PROJECT` | Build only | `next.config.js:126` | No source-map uploads |
| `NEXT_PUBLIC_APP_URL` | Client + Server | `src/app/api/super-admin/improvement/staging/route.ts` | `VERCEL_URL` fallback |
| `AI_ENABLE_INTENT_ROUTER` | Server | `src/lib/ai/config.ts:42` | ON (default) |
| `AI_ENABLE_OUTPUT_VALIDATION` | Server | `src/lib/ai/config.ts:43` | ON (default) |
| `AI_ENABLE_TRACING` | Server | `src/lib/ai/config.ts:44` | ON (default) |

---

## Supabase Edge Function secrets

These are NOT set via Vercel. Set via `supabase secrets set KEY=value` or via
the Supabase Dashboard → Edge Functions → Secrets.

### Required for email (Supabase Auth hooks)
| Variable | Used In | Notes |
|----------|---------|-------|
| `MAILGUN_API_KEY` | `send-auth-email/index.ts:30`, `send-welcome-email/index.ts:48` | Mailgun Basic auth |
| `MAILGUN_DOMAIN` | Same | Must be verified in Mailgun |
| `SEND_EMAIL_HOOK_SECRET` | `send-auth-email/index.ts:28` | P15 — signed by Supabase Auth |
| `SITE_URL` | `send-auth-email/index.ts:36` | Falls back to `https://alfanumrik.com` |

### Required for AI Edge Functions
| Variable | Used In |
|----------|---------|
| `ANTHROPIC_API_KEY` | `foxy-tutor`, `ncert-solver`, `quiz-generator`, `quiz-generator-v2`, `cme-engine`, `bulk-question-gen`, `generate-answers`, `generate-concepts`, `extract-diagrams`, `extract-ncert-questions`, `parent-report-generator`, `daily-cron`, `scan-ocr`, `ncert-question-engine` |
| `VOYAGE_API_KEY` | `_shared/embeddings.ts:167`, `_shared/reranking.ts:131` |
| `OPENAI_API_KEY` | `_shared/embeddings.ts:172` — fallback provider, optional |

### Required for admin-triggered ingestion
| Variable | Used In |
|----------|---------|
| `ADMIN_API_KEY` | `embed-*`, `generate-*`, `extract-*` Edge Functions |

### Required for scheduled jobs
| Variable | Used In |
|----------|---------|
| `CRON_SECRET` | `daily-cron/index.ts:806` (same value as Next.js `CRON_SECRET`) |

### Optional third-party integrations
| Variable | Used In |
|----------|---------|
| `WHATSAPP_TOKEN` | `whatsapp-notify/index.ts:138` |
| `WHATSAPP_PHONE_NUMBER_ID` | `whatsapp-notify/index.ts:139` |
| `GOOGLE_VISION_API_KEY` | `scan-ocr/index.ts:34` |
| `OCR_SPACE_API_KEY` | `scan-ocr/index.ts:58` — default `helloworld` (free tier) |
| `ENVIRONMENT` | `_shared/cors.ts:14` — `"production"` locks CORS to prod origins |

### Auto-provided by Supabase runtime (do not set manually)
| Variable | Notes |
|----------|-------|
| `SUPABASE_URL` | Injected by Supabase Edge Function runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Same |
| `SUPABASE_ANON_KEY` | Same |

---

## Vercel auto-injected (do not set manually)

| Variable | Description |
|----------|-------------|
| `VERCEL` | Truthy when running on Vercel |
| `VERCEL_ENV` | `production`, `preview`, or `development` |
| `VERCEL_REGION` | Deployment region (e.g., `bom1` for Mumbai) |
| `VERCEL_URL` | The deployment host (without protocol) |
| `VERCEL_DEPLOYMENT_ID` | Current deployment identifier |
| `VERCEL_GIT_COMMIT_SHA` | Git commit hash |
| `VERCEL_GIT_COMMIT_REF` | Git branch name |
| `VERCEL_GIT_COMMIT_MESSAGE` | Commit message |
| `VERCEL_GIT_COMMIT_AUTHOR_LOGIN` | Git author |
| `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` | Publicized commit SHA |
| `NODE_ENV` | `production` in production deployments |
| `NEXT_PHASE` | Set to `phase-production-build` during build |
| `CI` | Truthy in GitHub Actions |

---

## Security rules (enforced)

1. **Never prefix secrets with `NEXT_PUBLIC_`** — this exposes them to the client bundle.
2. **`SUPABASE_SERVICE_ROLE_KEY` is server-only** — `supabase-admin.ts` enforces via import restriction; `getServerEnv()` additionally scans `process.env` for accidental duplication into any `NEXT_PUBLIC_*` value and throws.
3. **Razorpay keys are server-only** — used only in API routes.
4. **`SUPER_ADMIN_SECRET` is server-only** — checked in `src/proxy.ts` and `src/lib/admin-auth.ts`.
5. **Post-edit hook** (`.claude/hooks/post-edit-check.sh`) blocks any `NEXT_PUBLIC_` variable that contains `SERVICE_ROLE`, `SECRET_KEY`, or `PRIVATE_KEY`.
6. **CI secret scanner** (`ci.yml` secret-scan job) rejects hardcoded `sk_live_*`, `rzp_live_*`, `service_role.*eyJ`, `NEXT_PUBLIC_.*SERVICE_ROLE`, `NEXT_PUBLIC_.*SECRET`.

## Startup validation

Environment variables are validated at:
1. **Build time**: `next.config.js` checks the 7 critical server vars in `process.env` when both `NODE_ENV=production` and `VERCEL` are truthy.
2. **Runtime**: `src/lib/env.ts` exposes `validatePublicEnv()`, `validateServerEnv()` (legacy), and zod-based typed accessors `getPublicEnv()`, `getServerEnv()`, `getAIEnv()`, `getPaymentEnv()`, `getAdminEnv()`, `getRedisEnv()`, `getMonitoringEnv()`.
3. **CI**: Placeholder values are set in `.github/workflows/ci.yml` for build testing.

## Local development

Copy `.env.local.example` to `.env.local` and fill in values:

```bash
cp .env.local.example .env.local
```

For local development, only Supabase variables are required. Redis, Sentry,
and Razorpay are optional (graceful degradation). AI keys are only needed if
you work on Foxy / RAG / quiz-generation flows.
