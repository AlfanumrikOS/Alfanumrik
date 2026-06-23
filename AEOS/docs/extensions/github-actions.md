# extensions/github-actions.md

# Alfanumrik AI Engineering Operating System (AEOS)

**Document Version:** 1.0
**Classification:** Extension Module (Platform Binding)
**Priority:** P0 (Critical — the actual CI/CD enforcement layer)
**Applies To:** Every CI run, build, gate, and deploy executed by GitHub Actions in the Alfanumrik repository.

---

# Purpose

Bind the AEOS Git-workflow and deployment standards to the **actual** GitHub Actions workflows in `.github/workflows/`. This is the concrete enforcement layer for core docs 11 and 20 — the gates code must clear and the deploy paths it travels.

---

# Scope

In scope: `ci.yml`, `deploy-production.yml`, `deploy-staging.yml`, and the dormant `deploy-aws.yml`. Their stages, gates, secrets posture, and rollback behavior.

Out of scope: provider mechanics covered elsewhere — Vercel (`extensions/vercel.md`), AWS/ECS/CloudFront (`extensions/aws.md`, `ecs.md`, `cloudfront.md`).

---

# How AEOS core binds here

- **Core doc 11 (Git Workflow):** push/PR triggers, branch policy (`main`/`master`/`develop`/`staging`), and the merge model that gates these pipelines.
- **Core doc 20 (Deployment Pipeline):** the build-verify-deploy-validate flow, health checks, progressive rollout, and rollback. The workflows below are doc 20 realized in GitHub Actions.
- These are the **mechanical** enforcement of the product invariants (P8 RLS-on-CREATE-TABLE, P10 bundle budget, P11 payment path, P15 auth funnel) — gates here block merge/deploy when violated.

---

# Alfanumrik specifics (factual to this repo)

**`ci.yml`** — runs on push to `main`/`master`/`develop` and PRs to `main`/`master`. Node 22. Jobs:
- **secret-scan:** gitleaks (BLOCKING) + regex secret scan; plus a **BLOCKING migration-safety gate** that fails any migration which `CREATE TABLE`s without `ENABLE ROW LEVEL SECURITY` in the same file (enforces P8). `_legacy/` is skipped.
- **quality:** `npm ci`, `npm audit` (critical fails), license check, **lint**, Supabase type-drift check (advisory), **type-check** (6 GB heap), **tests with coverage** (hard gate), and a separate **BLOCKING Auth & Identity test gate** (P15). Runs independently of secret-scan so infra flakes can't silently skip tests.
- **edge-function-tests:** hermetic, offline Deno tests (`--allow-read --allow-env`, no net) for select Edge Functions (contract canaries + pure helpers). BLOCKING.
- **integration-tests:** live-DB Vitest against staging Supabase; gated on same-repo (forks skip cleanly), BLOCKING when secrets present.
- **build:** `npm run build` (6 GB heap), bundle-size report, **P10 budget gates** — largest shared chunk vs `SHARED_JS_LIMIT_KB=160` (gzipped), middleware vs `120`, per-page vs `260`, plus the authoritative `check:bundle-size` gate. Uploads build artifact.
- **e2e:** full Playwright (advisory, `continue-on-error`). **e2e-critical-paths:** BLOCKING run of quiz-happy-path + payment-checkout on PRs to main/staging (REG-45/REG-46).
- **health-check:** on push to `main`, probes `https://alfanumrik.com/api/v1/health` (with Vercel protection-bypass handling).

**`deploy-production.yml`** — push to `main` (+ manual dispatch). Canonical web deploy is **Vercel's GitHub App** (CLI `deploy` job is optional, gated on `vars.USE_CLI_DEPLOY`). Stages:
- **quality** (lint/type-check/test/build) → **pre-deploy-checklist** (pending-migration list, destructive-change scan for DROP/TRUNCATE, secret-in-diff scan, env summary incl. region `bom1`) → **migrations** (`supabase db push --linked --include-all` to prod, `environment: production`) → **deploy-functions** (deploys only changed Edge Functions; all active if `_shared/` changed) → **health-check** (canonical domain, auto-rollback on real failure, soft-pass on 429 checkpoint) → **post-deploy-verify** (critical endpoints + security-header presence) → **release** (GitHub release tag from `package.json` version).

**`deploy-staging.yml`** — push to `develop`/`staging` (+ manual dispatch). quality → **migrations to staging** (dedicated staging Supabase org token) → **Vercel preview deploy** (comments preview URL on associated PRs) → **deploy-functions (staging)** → **health-check** against the preview URL.

**`deploy-aws.yml`** — DORMANT. Gated behind `vars.ENABLE_AWS_DEPLOY` (default `false`); a Cutover Gate no-ops the run otherwise. When enabled: OIDC auth (`AWS_DEPLOY_ROLE_ARN`, no static keys) → Docker build + push SHA tag to ECR → ECS Fargate rolling deploy with circuit breaker → smoke test with auto-rollback. See `extensions/aws.md` / `extensions/ecs.md`.

---

# Operational guidance

- Migrations are applied by CI **before** the web build goes live (idempotent, so re-runs are safe). Order matters: schema first, then Edge Functions, then web.
- A skipped optional job (e.g. CLI `deploy`) must not cascade-skip `release`; the workflow gates `release` on the jobs that always run (health-check + post-deploy-verify).
- Treat `continue-on-error` jobs as advisory only; never rely on them as a safety gate.

---

# Security notes

- Secrets live in GitHub Actions encrypted secrets (per environment: prod vs staging Supabase tokens differ). Never echo secret values into logs or `$GITHUB_STEP_SUMMARY`.
- AWS auth is OIDC role-assumption — do not add static AWS access keys.
- Secret-scan (gitleaks + regex) and the deploy-diff scan are BLOCKING for live token patterns and `NEXT_PUBLIC_*` secret exposure; keep them blocking.

---

# Checklist

- [ ] New table migrations enable RLS in the same file (or the P8 gate blocks merge).
- [ ] Bundle changes stay within P10 budgets (largest-chunk/middleware/per-page gates).
- [ ] Auth/identity tests pass (the dedicated BLOCKING gate).
- [ ] Production deploy applies migrations before the web build.
- [ ] `ENABLE_AWS_DEPLOY` stays `false` outside a planned cutover.
- [ ] No secret values printed in workflow logs/summaries.

---

# References

- Core: `11_GIT_WORKFLOW.md`, `20_DEPLOYMENT_PIPELINE.md`, `08_TESTING_PROTOCOL.md`, `21_RELEASE_MANAGEMENT.md`
- Extensions: `extensions/vercel.md`, `extensions/aws.md`, `extensions/ecs.md`, `extensions/cloudfront.md`
- Repo: `.github/workflows/ci.yml`, `.github/workflows/deploy-production.yml`, `.github/workflows/deploy-staging.yml`, `.github/workflows/deploy-aws.yml`

---

# Final Directive

GitHub Actions is where AEOS docs 11 and 20 become enforceable. Keep the blocking gates blocking, apply schema before web, and never weaken a gate to make a red pipeline green — fix the change instead.

**End of Document**
