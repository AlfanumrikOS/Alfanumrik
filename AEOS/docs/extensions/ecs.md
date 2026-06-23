# extensions/ecs.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Extension Module (Platform Binding)
**Priority:** P2 (Medium — bound to the dormant containerized web-migration path)
**Applies To:** ECS Fargate container packaging and runtime for the Alfanumrik Next.js web image and any future containerized workload.

---

# Purpose

Bind the AEOS container/ECS guidance to the **actual** containerization artifacts in this repo: the multi-stage `Dockerfile` and the Fargate `aws/task-definition.json`. These are real and committed, but the workload they run is the **dormant, default-OFF** web-migration path — live traffic is on Vercel (`extensions/vercel.md`). This module is therefore part operational reference, part forward-looking.

---

# Scope

In scope: `Dockerfile`, `aws/task-definition.json`, the ECS Fargate service (`alfa-prod` cluster / `web` service), container health checks, and the secrets-injection model for the container runtime.

Out of scope: the Vercel web deploy, CloudFront/ALB edge layer (`extensions/cloudfront.md`), and Supabase Edge Functions (Deno — not containers managed here).

---

# How AEOS core binds here

- **Core doc 12 (AWS Infrastructure)** is the governing standard for ECS Fargate, ECR, task definitions, and CloudWatch logging. Everything below conforms to it.
- **Status:** the web app is **not** currently served from ECS. This container path activates only on a deliberate cutover (`vars.ENABLE_AWS_DEPLOY = 'true'`, see `extensions/aws.md` and `extensions/github-actions.md`). Treat ECS guidance as **active-on-cutover / forward-looking** for the web tier.
- **Core doc 20 (Deployment Pipeline):** the ECS deploy is a rolling deploy with a circuit breaker and explicit rollback — a direct realization of doc 20's verify-and-reverse principles.

---

# Alfanumrik specifics (factual to this repo)

**Image** (`Dockerfile`):
- Three stages: `deps` (`npm ci`) → `builder` (`npm run build` with `output: 'standalone'`) → `runner` (copies `.next/standalone`, `.next/static`, `public`).
- Runs as non-root (`nextjs`/`nodejs`, uid/gid 1001), `EXPOSE 3000`, `CMD ["node", "server.js"]`.
- `NEXT_PUBLIC_*` baked at build time via `ARG`; **`DEPLOY_TARGET` deliberately NOT set at build time** (it is a runtime flag — setting it at build would trip env validation before secrets exist).
- Container `HEALTHCHECK` polls `http://localhost:3000/api/v1/health` via `node` (alpine has no curl).

**Task definition** (`aws/task-definition.json`):
- Family `alfanumrik-web`, `FARGATE`, `awsvpc`, `cpu 1024 / memory 2048`, container `web` on port 3000.
- Image `032064442164.dkr.ecr.ap-south-1.amazonaws.com/alfa-web:<sha>` (SHA-pinned in deploy; tag immutability ON).
- Runtime `environment`: `DEPLOY_TARGET=production` (this is what flips on `next.config.js` env validation + Sentry wrapping on the container path), `NODE_ENV=production`, `PORT=3000`, `HOSTNAME=0.0.0.0`.
- Runtime `secrets`: all server secrets resolved from Secrets Manager `alfa-prod/app` (Supabase service role, Razorpay trio, Anthropic, Voyage, OpenAI, super-admin, cron, email, Upstash, WhatsApp, OCR, Sentry, PostHog, `PYTHON_AI_BASE_URL`, etc.).
- `healthCheck` (ECS-native) + ALB target-group health both gate task readiness.
- Logs: `awslogs` driver → group `/ecs/alfanumrik-web`, region `ap-south-1`.

---

# Operational guidance

- **Deploy** (`deploy-aws.yml`, gated): build → push SHA tag to ECR → render task def with new image → `amazon-ecs-deploy-task-definition` with `wait-for-service-stability: true` and the **ECS deployment circuit breaker** for auto-rollback. First deploy scales the service 0→2.
- **Rollback:** circuit breaker auto-reverts on failed health; belt-and-suspenders manual rollback re-pins the previous task-definition revision (`aws ecs update-service --task-definition alfanumrik-web:<prev>`). The prior revision is recorded by the deploy job for traceability.
- **Resource sizing:** if `next build` OOMs, the build uses `NODE_OPTIONS=--max-old-space-size=6144` (matches CI). Adjust task `cpu`/`memory` only with an architect review.

---

# Security notes

- No server secret in the image — runtime injection from Secrets Manager only. `NEXT_PUBLIC_*` build args are non-sensitive by definition; never add a server secret as a `NEXT_PUBLIC_*` build arg.
- Container runs non-root; keep it that way.
- Pull from a private ECR repo; ECS task/execution roles are least-privileged IAM roles created by `provision-foundations.sh`.

---

# Checklist

- [ ] Image stays standalone, non-root, healthchecked on `/api/v1/health`.
- [ ] `DEPLOY_TARGET` set only at runtime (task def), never at build time.
- [ ] All server secrets via Secrets Manager `alfa-prod/app`, none baked in.
- [ ] ECS deploy uses SHA-pinned image + circuit breaker + recorded previous revision.
- [ ] ECS path activated only under a planned cutover.

---

# References

- Core: `12_AWS_INFRASTRUCTURE.md`, `20_DEPLOYMENT_PIPELINE.md`, `21_RELEASE_MANAGEMENT.md`
- Extensions: `extensions/aws.md`, `extensions/cloudfront.md`, `extensions/vercel.md`, `extensions/github-actions.md`
- Repo: `Dockerfile`, `aws/task-definition.json`, `.github/workflows/deploy-aws.yml`, `next.config.js`

---

# Final Directive

The container path is real, conformant to core doc 12, and rollback-safe — but dormant. Maintain it to the same standard as if it were live, and activate it only through the deliberate, reversible cutover described in `extensions/aws.md`.

**End of Document**
