# extensions/vercel.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Extension Module (Platform Binding)
**Priority:** P0 (Critical — binds the live production hosting reality)
**Applies To:** The Next.js web application (`alfanumrik.com`), its build, its environment validation, and its deploy/health pipelines.

---

# Purpose

Bind the platform-agnostic AEOS deployment and infrastructure standards to the **actual** production hosting of the Alfanumrik web app: **Vercel**, in the **bom1 (Mumbai) region**, backed by **Supabase**. This module is the authoritative source of hosting truth for the web tier; where core doc 12 reads as AWS-centric, this module reconciles it (see "How AEOS core binds here").

---

# Scope

In scope: the Next.js App Router web app deployed to Vercel, its `vercel.json` config, env validation in `next.config.js`, the GitHub Actions deploy workflows that target Vercel, and post-deploy health verification against the canonical domain.

Out of scope: the dormant AWS ECS/CloudFront migration path (see `extensions/aws.md`, `ecs.md`, `cloudfront.md`), Supabase Edge Functions runtime (Deno), and Razorpay/AI provider mechanics.

---

# How AEOS core binds here

- **Core doc 20 (Deployment Pipeline)** is platform-agnostic and applies in full. Its concrete provider mechanics (region, function timeouts, rollback control) are realized here on Vercel.
- **Core doc 12 (AWS Infrastructure)** states "AWS is the production backbone." **Reconciliation/override for the web tier:** the **live, traffic-serving** Alfanumrik web app runs on **Vercel**, not on AWS ECS. AWS ECS + CloudFront exist in the repo (`aws/`, `Dockerfile`, `.github/workflows/deploy-aws.yml`) as a **dormant, default-OFF** migration path (`vars.ENABLE_AWS_DEPLOY = 'false'`, Route 53 weight 0). Until that cutover is deliberately enabled, doc 12's AWS standards govern **ancillary/future workloads**, not the production web app. See `extensions/aws.md`.
- **Core doc 11 (Git Workflow)** governs the branch→PR→merge model that triggers these deploys; this module only describes the deploy side.

---

# Alfanumrik specifics (factual to this repo)

**Region & framework** (`vercel.json`):
- `"framework": "nextjs"`, `"regions": ["bom1"]` (Mumbai — keeps compute close to Indian 4G users and the Supabase ap-south-1 region).
- `cleanUrls: true`, `trailingSlash: false`.

**Function timeouts** (`vercel.json` `functions`):
- Cron workers `daily-cron`, `irt-calibrate`, internal `fix-failed-questions`: `maxDuration: 300`.
- Other `api/cron/**`: `60`. General `api/**`: `30`. Auth routes `auth/**`: `30`. SSR pages `**/*.tsx`: `15`.

**Vercel Cron jobs** (`vercel.json` `crons`) — these are the scheduler of record for the Vercel-hosted app, e.g. `/api/cron/daily-cron` (`30 2 * * *`), `/api/cron/irt-calibrate` (`50 2 * * *`), `/api/cron/reconcile-payments` (`*/30 * * * *`), `/api/cron/expired-subscriptions`, `/api/cron/account-purge`, plus internal `fix-failed-questions` (`*/15`). Note the migration runbook (`aws/README.md` Step 6 Day 9) plans to move these to EventBridge **only after** an AWS cutover.

**Env validation** (`next.config.js`):
- Validation runs only at **production runtime**, gated by `VERCEL_ENV === 'production'` (or `DEPLOY_TARGET === 'production'` on the dormant ECS path) — never at build time, because secrets are injected at runtime.
- Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SUPER_ADMIN_SECRET`. Missing required vars throw and fail the boot.
- `output: 'standalone'` is set (so the same build can also run in a container on the dormant ECS path), and `withSentryConfig` wraps the build when `VERCEL`/`CI`/`DEPLOY_TARGET=production`.

**Deploy path** (`.github/workflows/deploy-production.yml`):
- Canonical web deploy is **Vercel's GitHub App** on push to `main`. The CLI `deploy` job is optional, gated on `vars.USE_CLI_DEPLOY == 'true'` (skipped by default).
- The pipeline still runs quality, a pre-deploy checklist, **Supabase migrations** (`supabase db push --linked --include-all`), Edge Function deploys, then health-check + post-deploy-verify against `https://alfanumrik.com`.
- A defensive guard rejects placeholder Supabase env values pulled from Vercel before building.

---

# Operational guidance

- **Health verification** probes the canonical domain `https://alfanumrik.com/api/v1/health`, not the `*.vercel.app` deployment URL (that 404s / is behind deployment protection). Configure `VERCEL_AUTOMATION_BYPASS_SECRET` for true verification; without it CI soft-passes on protection challenges (401/403/429) but still hard-fails on real 5xx/timeouts.
- **Rollback** is instant via the Vercel Dashboard (Deployments → Promote previous). The production workflow also auto-rolls-back on a genuine health failure (excluding 429 checkpoint noise).
- **Region drift:** never remove `bom1` without an architecture review — it underpins P10 (Indian-4G latency budget) and DPDP data-locality alignment with Supabase ap-south-1.

---

# Security notes

- Never place a server secret in any `NEXT_PUBLIC_*` var. Only `NEXT_PUBLIC_*` values are baked into the client bundle; everything else stays server-side (Vercel Project → Environment Variables → Production).
- `next.config.js` sets the security-header and CSP baseline (HSTS, X-Frame-Options DENY, scoped CSP). Do not weaken CSP `connect-src`/`script-src` without an architect review.
- Do not print or commit real secret values. CI secret-scan (gitleaks + regex) and the deploy diff scan block leaks.

---

# Checklist

- [ ] `vercel.json` keeps `regions: ["bom1"]` and the documented function timeouts.
- [ ] No server secret in any `NEXT_PUBLIC_*` var.
- [ ] Required env vars present in Vercel Production (no placeholder values).
- [ ] Health check targets `https://alfanumrik.com/api/v1/health`.
- [ ] Migrations applied before the web build goes live.
- [ ] Rollback path (Vercel promote previous) confirmed available.

---

# References

- Core: `12_AWS_INFRASTRUCTURE.md` (reconciled here for the web tier), `20_DEPLOYMENT_PIPELINE.md`, `21_RELEASE_MANAGEMENT.md`, `11_GIT_WORKFLOW.md`
- Extensions: `extensions/aws.md`, `extensions/cloudfront.md`, `extensions/github-actions.md`
- Repo: `vercel.json`, `next.config.js`, `.github/workflows/deploy-production.yml`, `.github/workflows/deploy-staging.yml`

---

# Final Directive

The Alfanumrik web app lives on Vercel (bom1) with Supabase. Treat Vercel as the production backbone for the web tier; treat core doc 12's AWS guidance as the standard for the dormant migration path and ancillary workloads, not for the live web app. Verify every deploy against the canonical domain before declaring it done.

**End of Document**
