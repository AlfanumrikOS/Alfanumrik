# AWS Operations — Operating the Dormant ECS/CloudFront Path

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**AEOS Release:** v1.1
**Classification:** Operational Runbook
**Priority:** P1 (High — governs activation of a dormant production-capable path)
**Applies To:** Every operation against the AWS ECS Fargate / CloudFront web-migration path: prerequisites, controlled cutover, verification, and rollback to Vercel.

---

# Purpose

This runbook is the executable procedure for operating the **AWS path** at Alfanumrik. It exists because the AWS path is real, committed, and production-capable — but **dormant**. The single most important fact an operator must hold before touching anything here:

> **The live, traffic-serving web app runs on Vercel (`bom1`/Mumbai), backed by Supabase. AWS ECS + CloudFront exist as a built-but-OFF migration path** (`vars.ENABLE_AWS_DEPLOY = 'false'`, Route 53 weight 0).

Until a deliberate cutover is in progress, every push to `main` is a **no-op** for AWS: the `deploy-aws.yml` `Cutover Gate` job short-circuits the run. This runbook tells you how to verify dormancy, how a controlled cutover would proceed, how to verify it, and — most importantly — how to roll back to Vercel in under sixty seconds.

This is a direct application of core doc 20's principle: *a deployment is incomplete until verified in the target environment*, and *no irreversible deployment without a plan*.

---

# Scope

In scope: `aws/` (`task-definition.json`, `cloudfront-config.json`, `provision-foundations.sh`, `README.md`), the `Dockerfile`, `.github/workflows/deploy-aws.yml`, the AWS account `032064442164` / region `ap-south-1`, ECR repo `alfa-web`, ECS cluster `alfa-prod` / service `web`, the CloudFront distribution `E3GYX90RS5NCAP`, and the Route 53 weighted-routing cutover.

Out of scope: the live Vercel deploy (`extensions/vercel.md`, and the SRE runbook), Supabase backups (the disaster-recovery runbook), and AI/payment provider mechanics.

---

# Prerequisites

Confirm every item before any cutover activity. Do not skip.

1. **Supabase region is `ap-south-1`.** Supabase Dashboard → Settings → Infrastructure → Region. If it is anything else, DPDP data-locality is not satisfied; stop and open a Supabase ticket to relocate before serving any AWS traffic (`aws/README.md` Step 0).
2. **IAM bootstrap complete.** `aws/provision-foundations.sh` has run once and created the deploy role, ECS execution/task roles, and the GitHub OIDC trust. After bootstrap, `AdministratorAccess` on the bootstrap principal has been replaced with the scoped least-privilege policy (`aws/README.md` Step 1).
3. **GitHub OIDC provider exists** (`token.actions.githubusercontent.com`, audience `sts.amazonaws.com`). No static AWS access keys live in GitHub secrets — auth is OIDC role-assumption via `AWS_DEPLOY_ROLE_ARN` (`aws/README.md` Step 2).
4. **Secrets Manager populated.** `alfa-prod/app` holds real values for every server secret listed in `aws/task-definition.json` `secrets[*]` (Supabase service role, Razorpay trio, Anthropic, Voyage, OpenAI, super-admin, cron, email, Upstash, WhatsApp, OCR, Sentry, PostHog, `PYTHON_AI_BASE_URL`). Placeholder JSON is filled **only** in the AWS console, never committed.
5. **GitHub Actions variables set** (`aws/README.md` Step 3): `AWS_REGION=ap-south-1`, `ECR_REPOSITORY=alfa-web`, `ECS_CLUSTER=alfa-prod`, `ECS_SERVICE=web`, `PRODUCTION_DOMAIN=https://da8yhieheuw7p.cloudfront.net`, and `ENABLE_AWS_DEPLOY=false` (until cutover).
6. **Local Docker smoke test passed** (`aws/README.md` Step 5): the standalone image builds, `curl http://localhost:3000/api/v1/health` returns HTTP 200, and a student/teacher/parent login plus one quiz submission verify P1/P2 locally.

---

# Verify Dormancy (run this first, every time)

Before any change, confirm the path is OFF and Vercel is authoritative.

1. **Flag check:** GitHub → Settings → Secrets and variables → Actions → Variables. Confirm `ENABLE_AWS_DEPLOY = false`.
2. **Workflow behavior:** the last `Deploy AWS ECS — Alfanumrik` run shows the `Cutover Gate` job reporting `AWS deploy is DISABLED` and all downstream jobs skipped.
3. **Traffic source:** `https://alfanumrik.com` resolves to Vercel (Route 53 AWS record weight 0 / no production ALIAS to the ALB).
4. **Distribution status (informational):**
   ```bash
   aws cloudfront get-distribution --id E3GYX90RS5NCAP \
     --query 'Distribution.Status' --region us-east-1
   ```
   The CloudFront staging pseudolink `https://da8yhieheuw7p.cloudfront.net` may be live as a staging surface; this does **not** mean production traffic is on AWS.

If any check shows the path active when it should be dormant, treat it as an incident and follow the rollback below.

---

# Controlled Cutover Procedure

A cutover is deliberate, gradual, and reversible. Execute it only with explicit release authorization (core doc 21) and only after every prerequisite is green.

## Phase 1 — Build and push the image

1. Flip the gate: set GitHub Actions variable `ENABLE_AWS_DEPLOY = true`.
2. Push to `main` (or run `deploy-aws.yml` via `workflow_dispatch` with a `reason`). The pipeline:
   - assumes the OIDC deploy role (no static keys),
   - builds the multi-stage `Dockerfile` (`NODE_OPTIONS=--max-old-space-size=6144`, `NEXT_PUBLIC_*` baked as build args),
   - pushes an **immutable SHA tag** to ECR `alfa-web` (tag immutability ON; never `:latest`).
3. Verify in the run summary that `Build & Push to ECR` succeeded and recorded the `image_uri` (SHA-pinned).

## Phase 2 — Update the ECS service (rolling, circuit-breaker)

The `Deploy to ECS Fargate` job:
1. records the current task-definition revision for rollback,
2. renders `aws/task-definition.json` with the new SHA-pinned image (`DEPLOY_TARGET=production` injected at runtime — never at build time),
3. deploys with `wait-for-service-stability: true` and the **ECS deployment circuit breaker** (auto-reverts on failed health),
4. on first deploy, scales the service from 0 to 2 tasks.

Confirm tasks reach `RUNNING` and the ALB target group reports healthy targets before proceeding. A deploy is not done until tasks are healthy (core doc 12).

## Phase 3 — Edge layer (CloudFront)

CloudFront `E3GYX90RS5NCAP` fronts the ALB → ECS path. Confirm:
- `/_next/static/*` → CachingOptimized (immutable hashed assets),
- `/api/*` → CachingDisabled (APIs must never be cached at the edge),
- the `X-Forwarded-Proto: https` origin header is preserved (CloudFront terminates TLS; CloudFront→ALB is plain HTTP by design).
Do **not** place CloudFront in front of the Vercel app (`extensions/cloudfront.md`).

## Phase 4 — Route 53 weight shift (the actual traffic cutover)

The provision script creates the AWS Route 53 record at **weight 0** — all traffic on Vercel. Ramp gradually (`aws/README.md` Step 6):

| Stage | Route 53 AWS weight | Watch |
|---|---|---|
| Day 1 | 5% | 5xx rate, p95 latency, ECS task health (CloudWatch) |
| Day 3 | 25% | Same + Sentry error classes |
| Day 5 | 50% | Same + Razorpay webhook outcomes (CloudWatch) |
| Day 7 | 100% | 48h clean run required before next steps |
| Day 9 | — | Enable EventBridge crons; remove `vercel.json` `crons`; repoint Razorpay webhook to `alfanumrik.com` |
| Day 14 | — | Remove Vercel from the deploy path (keep cold standby ~1 week) |

Define explicit promote and abort criteria before each stage. Never widen the weight while any abort criterion (5xx rate, p95 latency, error classes) is breached.

---

# Verification

A cutover stage is complete only with evidence (core doc 10). At each stage confirm:

- `curl -sS https://da8yhieheuw7p.cloudfront.net/api/v1/health` (or `https://alfanumrik.com/api/v1/health` post-DNS) returns HTTP 200 with `status: "healthy"`.
- ECS service: desired == running count; all tasks `HEALTHY`; circuit breaker not tripped.
- ALB target group: all targets healthy.
- CloudWatch: 5xx rate within budget (SRE runbook: error rate < 1%), p95 latency within budget.
- Sentry: no new error class spike correlated with the weight increase.
- Critical paths: a real login (Supabase Auth), one quiz submission (P1/P2 correct XP), and one Razorpay webhook outcome succeed.

Record the commit SHA, image URI, task-definition revision, weight, and these results as deployment evidence.

---

# Rollback to Vercel

Rollback is the headline safety property: it works at any stage and takes **under 60 seconds**.

## Fast traffic rollback (preferred)

1. Set the Route 53 AWS record **weight back to 0**. Vercel resumes serving 100% immediately.
2. Supabase is untouched — no data reconciliation is needed (both Vercel and ECS read the same Supabase project).
3. Confirm `https://alfanumrik.com/api/v1/health` returns HTTP 200 from the Vercel-served app.
4. Set `ENABLE_AWS_DEPLOY = false` to stop further AWS deploys.

## ECS-only rollback (without touching Route 53)

If the ECS path itself is bad but you want to keep the weight where it is, re-pin the previous task definition:
```bash
aws ecs update-service \
  --cluster alfa-prod --service web \
  --task-definition alfanumrik-web:<previous-revision-number> \
  --region ap-south-1
```
The previous revision number is logged by the `deploy-aws.yml` deploy job. The `smoke-test` job also performs this automatically on a failed health check, belt-and-suspenders to the ECS circuit breaker.

## After any rollback

Record what failed, what was reverted, and the regression that prevents recurrence (core doc 23, RCA). Re-run dormancy verification.

---

# Checklist

- [ ] Supabase region confirmed `ap-south-1` before any traffic ramp.
- [ ] `ENABLE_AWS_DEPLOY` stays `false` outside a planned, authorized cutover.
- [ ] No server secret baked into the image; only `NEXT_PUBLIC_*` build args.
- [ ] All server secrets resolved from Secrets Manager `alfa-prod/app` at runtime.
- [ ] GitHub→AWS auth via OIDC role; no static AWS keys in GitHub secrets.
- [ ] ECS deploys SHA-pinned image URIs, never `:latest`; ECR immutability ON.
- [ ] Circuit breaker enabled; previous task-definition revision recorded.
- [ ] CloudFront keeps `/api/*` on CachingDisabled; `X-Forwarded-Proto: https` preserved.
- [ ] Route 53 weight ramps with explicit promote/abort criteria per stage.
- [ ] Rollback to Vercel (weight 0) confirmed available and rehearsed.
- [ ] No CloudFront placed in front of the Vercel-hosted production app.

---

# References

Core docs:
- `12_AWS_INFRASTRUCTURE.md` — the AWS infrastructure standard this path must meet.
- `20_DEPLOYMENT_PIPELINE.md` — build-verify-deploy-validate, progressive rollout, rollback.
- `21_RELEASE_MANAGEMENT.md` — release authorization and post-release monitoring wrapping the cutover.
- `10_VERIFICATION_ENGINE.md` — evidence requirement behind every verification step.

Extensions:
- `extensions/aws.md` — the dormant-path binding (account, region, dormancy gate).
- `extensions/ecs.md` — container packaging, task definition, circuit-breaker deploy.
- `extensions/cloudfront.md` — edge layer reconciliation (Vercel edge vs AWS CloudFront).
- `extensions/vercel.md` — the live web host this path would replace, and the rollback target.
- `extensions/github-actions.md` — `deploy-aws.yml` stages and gates.

Repo:
- `aws/README.md`, `aws/task-definition.json`, `aws/cloudfront-config.json`, `aws/provision-foundations.sh`, `Dockerfile`, `.github/workflows/deploy-aws.yml`, `next.config.js`, `vercel.json`.

---

# Final Directive

The AWS path is a loaded, holstered weapon: production-capable, conformant to core doc 12, and OFF by default. Operate it only through a deliberate, authorized, gradually-ramped Route 53 cutover, verify every stage with evidence, and keep the one-line rollback to Vercel — set the AWS weight to 0 — within arm's reach at all times. Never let the existence of the AWS path imply the web app has left Vercel.

**End of Document**
