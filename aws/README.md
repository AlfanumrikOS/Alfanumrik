# AWS ECS Fargate — Setup Guide

**Org:** AlfanumrikOS · **Repo:** Alfanumrik · **Account:** 032064442164 · **Region:** ap-south-1

---

## Step 0 — Confirm Supabase region (do this first)

Supabase Dashboard → Settings → Infrastructure → Region.
- **ap-south-1 (Mumbai):** DPDP is solved. No DB migration needed.
- **Anything else:** open a Supabase support ticket to move the project to ap-south-1
  before cutting traffic, or plan the Aurora migration (Phase 4 in the migration plan).

---

## Step 1 — Bootstrap IAM (one-time console action, ~2 minutes)

The `alfanumrik-admin` IAM user exists but has no policies attached.

1. Sign in to https://console.aws.amazon.com as root (or another admin).
2. **IAM → Users → alfanumrik-admin → Add permissions → Attach policies directly → AdministratorAccess → Next → Add permissions.**
3. From this machine: `bash aws/provision-foundations.sh` (~5 minutes).
4. After the script completes, **replace AdministratorAccess** with the scoped policy
   (the script prints the role ARNs; update alfanumrik-admin to have only the permissions
   needed for day-to-day work — at minimum: ECR read, ECS describe, Secrets Manager read).

---

## Step 2 — GitHub OIDC Provider (one-time console action, ~1 minute)

This allows GitHub Actions to assume the `alfa-prod-github-deploy` role without
storing long-lived AWS access keys in GitHub secrets.

**IAM → Identity Providers → Add Provider:**
- Provider type: **OpenID Connect**
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`
- Click **Add provider**

This is a one-time account-level step. The `alfa-prod-github-deploy` role
(created by provision-foundations.sh) already has the correct trust policy.

---

## Step 3 — GitHub Secrets and Variables

Set in: **GitHub → AlfanumrikOS/Alfanumrik → Settings → Secrets and variables → Actions**

### Repository Secrets (sensitive — stored encrypted)
| Name | Description |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | Output by provision-foundations.sh — arn:aws:iam::032064442164:role/alfa-prod-github-deploy |
| `NEXT_PUBLIC_SUPABASE_URL` | Production Supabase URL (baked into Docker image at build time) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production Supabase anon key (baked at build time) |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN (optional, baked at build time) |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog browser key (optional, baked at build time) |

### Repository Variables (non-sensitive config)
| Name | Value |
|---|---|
| `ENABLE_AWS_DEPLOY` | `false` (flip to `true` only when ready for traffic cutover) |
| `AWS_REGION` | `ap-south-1` |
| `ECR_REPOSITORY` | `alfa-web` |
| `ECS_CLUSTER` | `alfa-prod` |
| `ECS_SERVICE` | `web` |
| `PRODUCTION_DOMAIN` | `https://alfanumrik.com` |

---

## Step 4 — Fill Secrets Manager

After provision-foundations.sh runs, populate `alfa/prod/app` in the console:

**Secrets Manager → alfa/prod/app → Retrieve secret value → Edit**

Replace the placeholder JSON with real values for all server secrets.
See the secret names listed in `aws/task-definition.json` (`secrets[*].name`).
**Never commit real values to the repo.**

---

## Step 5 — Local Docker smoke test

Before any production traffic, verify the container works locally:

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
  -t alfanumrik-web:local .

docker run -p 3000:3000 \
  -e DEPLOY_TARGET=production \
  -e NODE_ENV=production \
  alfanumrik-web:local
  # Add all server-secret env vars via -e flags (get from Secrets Manager console)
```

Then: `curl http://localhost:3000/api/v1/health` — expect HTTP 200.
Log in as student, teacher, and parent. Submit one quiz. Verify XP is correct (P1/P2).

---

## Step 6 — Route 53 cutover (zero downtime)

The provision script creates the AWS Route 53 record at **weight=0** — all traffic
stays on Vercel. Ramp gradually:

| Stage | Route 53 weight | Watch for |
|---|---|---|
| Day 1 | 5% | 5xx rate, p95 latency, ECS task health in CloudWatch |
| Day 3 | 25% | Same + Sentry error classes |
| Day 5 | 50% | Same + Razorpay webhook outcomes in CloudWatch |
| Day 7 | 100% | 48h clean run required before next steps |
| Day 9 | — | Enable EventBridge crons; delete vercel.json crons array |
| Day 9 | — | Repoint Razorpay webhook URL to alfanumrik.com |
| Day 14 | — | Remove Vercel from deploy path (keep cold standby 1 week) |

**Flip `ENABLE_AWS_DEPLOY=true`** in GitHub variables when the infra is ready
(after Steps 1–5 above). The next push to main will build and deploy to ECS
but Route 53 still serves Vercel (weight=0) until you manually ramp it.

---

## Rollback (works at any stage, takes <60 seconds)

**Traffic rollback:** set Route 53 AWS record weight back to 0.
Vercel takes over immediately. Supabase untouched — no data reconciliation needed.

**ECS-only rollback** (without touching Route 53):
```bash
aws ecs update-service \
  --cluster alfa-prod --service web \
  --task-definition alfanumrik-web:<previous-revision-number> \
  --region ap-south-1
```
The previous revision number is logged by the GitHub Actions deploy job.
