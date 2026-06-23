# extensions/aws.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Extension Module (Platform Binding)
**Priority:** P1 (High — governs the dormant migration path and ancillary AWS workloads)
**Applies To:** Every AWS resource and operation in the Alfanumrik repo: the dormant ECS/CloudFront web-migration path and any ancillary/future AWS-hosted workloads.

---

# Purpose

State precisely **where AWS actually applies** to Alfanumrik today, and bind those uses to the AEOS AWS standard (core doc 12). The headline fact: **the live, traffic-serving web app is NOT on AWS — it runs on Vercel** (see `extensions/vercel.md`). AWS exists in the repo as a fully built but **dormant, default-OFF** migration path plus a home for ancillary workloads.

---

# Scope

In scope: `aws/` (task definition, CloudFront config, provisioning script, setup README), the `Dockerfile`, `.github/workflows/deploy-aws.yml`, the planned AWS account `032064442164` / region `ap-south-1`, and any future AWS-hosted service (e.g. a Python AI service).

Out of scope: the production Vercel web deploy (`extensions/vercel.md`), Supabase (managed Postgres + Edge Functions), and provider mechanics for Razorpay / AI vendors.

---

# How AEOS core binds here

- **Core doc 12 (AWS Infrastructure)** applies in full **to the workloads AWS actually hosts** — i.e. the dormant ECS/CloudFront path and any ancillary AWS services. Its standards (version-controlled, reproducible, observable, least-privileged, recoverable, cost-aware) are the bar those workloads must meet.
- **Reconciliation/override:** doc 12's statement that "AWS is the production backbone" is **aspirational/forward-looking for the web tier**. Today the web backbone is Vercel. Doc 12 governs the migration target and ancillary workloads until/unless a deliberate Route 53 cutover makes AWS the live web host.
- **Core doc 21 (Infrastructure Operations)** governs day-2 ops for whatever AWS resources become live.

---

# Alfanumrik specifics (factual to this repo)

**The web app is NOT on AWS.** Live traffic is on Vercel (bom1). The AWS path is built and ready but dormant.

**Dormancy gate** (`.github/workflows/deploy-aws.yml`):
- The entire workflow is gated behind `vars.ENABLE_AWS_DEPLOY`. Default is `'false'` (`aws/README.md`), so pushes to `main` are a **no-op** for AWS. A `Cutover Gate` job short-circuits everything when the flag is not `'true'`.

**Account & region** (`aws/README.md`, `aws/task-definition.json`):
- Account `032064442164`, region `ap-south-1` (Mumbai) — chosen so DPDP data-locality holds against Supabase ap-south-1.

**What is built and committed:**
- `Dockerfile` — multi-stage Next.js standalone image (`output: 'standalone'` in `next.config.js`), non-root `nextjs` user, container `HEALTHCHECK` on `/api/v1/health`.
- `aws/task-definition.json` — Fargate task (`cpu 1024 / memory 2048`), image from ECR `alfa-web`, server secrets injected at runtime from Secrets Manager key `alfa-prod/app`, awslogs to `/ecs/alfanumrik-web`.
- `aws/cloudfront-config.json` + `aws/README.md` — CloudFront → ALB → ECS staging pseudolink (see `extensions/cloudfront.md`, `extensions/ecs.md`).
- `aws/provision-foundations.sh` — one-time IAM/infra bootstrap; GitHub OIDC role `alfa-prod-github-deploy` (no long-lived AWS keys in GitHub).

**Secrets posture:**
- `NEXT_PUBLIC_*` values are baked into the image at build time (non-sensitive). All **server** secrets (Supabase service role, Razorpay, Anthropic, Voyage, OpenAI, etc.) are injected at **container runtime** from AWS Secrets Manager — never baked into the image, never committed. See `aws/task-definition.json` `secrets[*]`.

**Ancillary/future workloads:**
- `PYTHON_AI_BASE_URL` appears in the task definition secrets, consistent with a separate Python AI service (the Cloud Run / containerized AI workload referenced in the project constitution). Any such service is a doc-12-governed AWS (or container-platform) workload, distinct from the Next.js web app.

---

# Operational guidance

- **Cutover is deliberate, gradual, reversible** (`aws/README.md` Step 6): Route 53 weighted routing starts at weight 0 (all Vercel), ramps 5→25→50→100% over ~7 days, then EventBridge crons replace `vercel.json` crons at Day 9. Do not flip `ENABLE_AWS_DEPLOY=true` outside a planned cutover.
- **Rollback** (any stage, <60s): set the Route 53 AWS record weight back to 0 — Vercel resumes instantly, Supabase untouched. ECS-only rollback: redeploy the previous task-definition revision.
- **Least privilege:** after `provision-foundations.sh`, replace the bootstrap `AdministratorAccess` with the scoped policy the README prescribes.

---

# Security notes

- Never commit real Secrets Manager values; the README's placeholder JSON must be filled only in the AWS console.
- Keep GitHub→AWS auth on OIDC (`AWS_DEPLOY_ROLE_ARN`); do not introduce static AWS access keys into GitHub secrets.
- ECR tag immutability is ON; ECS deploys SHA-pinned image URIs, never `:latest`.

---

# Checklist

- [ ] `ENABLE_AWS_DEPLOY` remains `false` unless a planned cutover is in progress.
- [ ] No server secret baked into the Docker image (only `NEXT_PUBLIC_*` build args).
- [ ] All server secrets resolved from Secrets Manager `alfa-prod/app` at runtime.
- [ ] GitHub→AWS auth via OIDC role, no static keys.
- [ ] Route 53 weight-0 default preserved until cutover ramp begins.

---

# References

- Core: `12_AWS_INFRASTRUCTURE.md`, `21_RELEASE_MANAGEMENT.md`, `20_DEPLOYMENT_PIPELINE.md`
- Extensions: `extensions/vercel.md`, `extensions/ecs.md`, `extensions/cloudfront.md`, `extensions/github-actions.md`
- Repo: `aws/README.md`, `aws/task-definition.json`, `aws/cloudfront-config.json`, `aws/provision-foundations.sh`, `Dockerfile`, `.github/workflows/deploy-aws.yml`

---

# Final Directive

AWS at Alfanumrik is a dormant, default-OFF web-migration path plus a home for ancillary workloads — not the live web host. Hold every AWS resource to core doc 12, keep the cutover deliberate and reversible, and never let the existence of the AWS path imply the web app has left Vercel.

**End of Document**
