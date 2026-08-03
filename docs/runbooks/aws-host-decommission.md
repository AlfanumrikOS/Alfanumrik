# Decision Record: Decommission the AWS ECS Fargate host (2026-07-13)

**Decision (CEO, 2026-07-13):** decommission the AWS Fargate parallel host.
Vercel (bom1) is the sole compute host for the Next.js app going forward.

**Basis (verified):**
- `deploy-aws.yml` is `workflow_dispatch`-only and marked suspended — AWS has
  not received automated deploys; it runs stale code by construction.
- The 2026-07-13 Anthropic backoff fix (claude.ts) shipped to Vercel only —
  the dual-host §3a burden ("fix on one host does nothing for the other") is
  being paid with no traffic evidence justifying it.
- Vercel is the canonical scheduler (production-cron-runner.yml: "Vercel is
  the sole scheduler") and serves alfanumrik.com production aliases.

**Retirement checklist (ops, do in order):**
1. Confirm no DNS/ALB routes production traffic to the Fargate service
   (Route53 / CloudFront / ALB listeners → alfanumrik.com must resolve to
   Vercel only).
2. Confirm no webhooks (Razorpay, Mailgun) point at an AWS-hosted URL —
   Hard Rule: one callback URL per webhook.
3. Scale the ECS service to 0; observe one full school day for regressions.
4. Delete the service + task definition; keep the ECR images 30 days.
5. Keep AWS Secrets Manager `alfa-prod/app` — it remains the CRON_SECRET
   source of truth for the break-glass cron runner (see secret-rotation.md).
6. Archive `deploy-aws.yml` (move under .github/workflows/_archive/ or
   delete) and remove `CRON_SECRET_AWS_SECRET_ID`-adjacent plumbing ONLY
   after step 5's exception is re-homed.
7. Update ARCHITECTURE.md / DEPLOYMENT_RUNBOOK.md to single-host.

Until this checklist completes, treat AWS as OFF for change management: no
fix is required to ship there, and no report should be debugged against it.

---

## Execution log

### 2026-08-03 — Steps 5-6 DONE; break-glass re-homed + on-disk AWS artifacts deleted

- **Step 5 (re-home CRON_SECRET): DONE.** `.github/workflows/production-cron-runner.yml`
  no longer sources CRON_SECRET from AWS Secrets Manager (`alfa-prod/app`). The
  `aws-actions/configure-aws-credentials` step and the `aws secretsmanager
  get-secret-value` fetch step were removed; the runner now reads
  `${{ secrets.CRON_SECRET }}` directly from the GitHub Actions secret store and
  passes it to `scripts/run-production-crons.mjs` (which fails closed if empty).
  The job's `id-token: write` permission (needed only for AWS OIDC) was dropped.
- **Step 6 (remove AWS plumbing + on-disk artifacts): DONE (2026-08-03).** Beyond
  the cron-runner AWS-Secrets-Manager plumbing (removed above), this batch deleted
  `.github/workflows/deploy-aws.yml` and the entire `aws/` directory (4 files:
  `task-definition.json`, `README.md`, `cloudfront-config.json`,
  `provision-foundations.sh`). The test/tooling references that previously blocked
  these deletions were decoupled first (see "Completed deletions" below). The root
  `Dockerfile` is intentionally **retained** (local container dev — `compose*.yaml`,
  `.vscode/tasks.json`; independent of AWS).

> **PREREQUISITE — verify before relying on the break-glass path.** The re-source
> assumes a `CRON_SECRET` GitHub Actions secret (repo- or `Production`-environment-
> scoped, value == the Vercel production `CRON_SECRET` == the value previously in
> AWS Secrets Manager `alfa-prod/app`) is provisioned. `secrets.CRON_SECRET` is
> already referenced by `deploy-production.yml` (flag-posture canary), but an
> architect note there (2026-07-22) states the secret value "does not exist yet in
> this repo." That canary fails **open** (warn + skip) when the secret is absent;
> the break-glass cron runner cannot — an empty CRON_SECRET aborts the run. **If
> the GitHub secret is not yet provisioned, add it before decommissioning AWS
> Secrets Manager `alfa-prod/app`, or the break-glass path will be unable to
> authenticate to production cron routes.**

### Completed deletions (2026-08-03)

The test/tooling references that previously blocked teardown were decoupled first,
then the on-disk AWS artifacts were deleted — the suite stays green (Gate 3):

| Artifact | Prior blocker | Disposition |
|---|---|---|
| `.github/workflows/deploy-aws.yml` | `apps/host/src/__tests__/dockerfile-standalone-layout.test.ts` (`readFileSync` + `toContain` assertions) | **DELETED.** The test was decoupled first — its `deploy-aws.yml` assertions were dropped; it now asserts only the standalone Dockerfile layout. |
| `aws/task-definition.json` | `apps/host/src/__tests__/host-env-parity.test.ts` (`readFileSync` + env-parity assertions) | **DELETED.** The test was **retired** (host env-parity is moot with a single Vercel host). |
| `aws/README.md`, `aws/cloudfront-config.json`, `aws/provision-foundations.sh` | Only `deploy-aws.yml` + docs prose | **DELETED** with the rest of the `aws/` directory. |
| `scripts/verify-devops-policy-contract.ts` (verifier) | asserted against the AWS artifacts | **DECOUPLED** from the deleted AWS artifacts (retained; no longer references `deploy-aws.yml`/`aws/`). |
| root `Dockerfile` | `compose.yaml`, `compose.debug.yaml`, `.vscode/tasks.json` (local container dev — NOT AWS), `dockerfile-standalone-layout.test.ts` | **KEPT.** Serves local container dev independent of AWS. |

Done by this batch: **testing** retired `host-env-parity.test.ts` and decoupled
`dockerfile-standalone-layout.test.ts` + `scripts/verify-devops-policy-contract.ts`;
the deployment-config change deleted `deploy-aws.yml` + the `aws/` directory. The
`Dockerfile`, `compose*.yaml`, and `.vscode/tasks.json` remain.
