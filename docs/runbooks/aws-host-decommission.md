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
