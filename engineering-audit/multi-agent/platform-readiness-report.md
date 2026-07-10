# Agent G - DevOps, Reliability and Performance Report

Status: Stage 1 read-heavy reconnaissance complete. No code changes implemented.
Date: 2026-07-10
Workspace: `D:\Alfa_local\Alfanumrik`

## Scope inspected

DevOps, reliability, performance, and production-readiness surfaces:

- Vercel configuration, deploy workflow, health checks, deployment protection bypass, cron schedules, and Vercel project metadata.
- Root and `apps/host` package scripts, build aliases, bundle-size guard, and release-gate command wiring.
- Product-readiness release gate and live readiness evidence model.
- Cron/job registry, job-health writer, live verifier, and existing live job-health artifact.
- Supabase Edge Function inventory, manifest, required secrets, deploy workflow, and project pinning.
- Incident/request ID propagation manifest and live incident verifier.
- Existing live readiness evidence bundle and operational execution notes.
- Release checklist and current deployment runbook parity.
- Build artifacts and bundle-size inspection against the current `.next` output.

## Files inspected

Primary files:

- `vercel.json`
- `.vercel/repo.json`
- `package.json`
- `apps/host/package.json`
- `scripts/product-readiness-release-gate.ts`
- `scripts/live-readiness-evidence-manifest.json`
- `scripts/verify-live-readiness-evidence.ts`
- `scripts/job-registry.json`
- `scripts/verify-job-health-live.ts`
- `packages/lib/src/cron-job-health.ts`
- `apps/host/src/app/api/internal/cron/job-health-smoke/route.ts`
- `apps/host/src/__tests__/api/cron-job-health-instrumentation.test.ts`
- `scripts/edge-function-manifest.json`
- `scripts/incident-id-spine.json`
- `scripts/verify-incident-id-live.ts`
- `scripts/verify-devops-policy-contract.ts`
- `scripts/check-bundle-size.mjs`
- `artifacts/live-readiness-evidence-2026-07-10.json`
- `artifacts/devops-operational-execution-2026-07-10.md`
- `artifacts/rca17-job-health.json`
- `docs/ops/release-checklist.md`
- `DEPLOYMENT_RUNBOOK.md`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-production.yml`
- `supabase/config.toml`
- `engineering-audit/FULL_RCA_BACKEND_WORKFLOWS_PRODUCT_READINESS_2026-07-09.md`

Supporting commands:

- `git status --short`
- `npx tsx scripts/product-readiness-release-gate.ts --dry-run`
- `npx tsx scripts/verify-live-readiness-evidence.ts --input=artifacts/live-readiness-evidence-2026-07-10.json`
- `npm run check:bundle-size`
- Read-only Node inventory for API routes, Edge Functions, Vercel crons, job registry, and live gate counts.

## Confirmed findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| G-01 | P0 | Broad-launch live readiness is not proven. Existing evidence validates only 5/15 required live gates. | Confirmed |
| G-02 | P0 | Live job health is failing: 0/13 registered scheduled jobs have a live last-success metric in the captured export. | Confirmed |
| G-03 | P1 | Cron/job-health instrumentation exists in code, so the job-health failure is more likely live execution, env, DB write, or export visibility than a missing registry alone. | Confirmed |
| G-04 | P1 | Release gate is well structured, but the existing operational note says the monolithic runner previously failed at `host-build` due to Next build lock/process hygiene even though the guarded build passed when run alone. | Confirmed from artifact |
| G-05 | P1 | Vercel health/post-deploy checks can soft-pass all-429 protection challenges without proving the real app is healthy unless `VERCEL_AUTOMATION_BYPASS_SECRET` is configured. | Confirmed |
| G-06 | P1 | Production workflow creates release tags from root `package.json.version`, but root package has no version; `apps/host/package.json` is `2.0.0`. This can produce `vundefined` release metadata. | Confirmed |
| G-07 | P1 | Edge Function manifest is complete against disk inventory: 48 active functions and 48 manifest entries, no missing entries either way. | Confirmed |
| G-08 | P1 | Edge deploy workflow deploys changed functions with `--no-verify-jwt` for every changed function, while the manifest records per-function secret and deploy expectations but not per-function JWT posture. | Confirmed |
| G-09 | P1 | `docs/ops/release-checklist.md` is stale (`Last verified: 2026-04-02`) and does not reflect the 2026-07-10 release evidence model now enforced in `DEPLOYMENT_RUNBOOK.md`. | Confirmed |
| G-10 | P2 | Bundle-size check currently passes, but the checked artifact reports `0` rendered HTML pages for shared-JS HTML scan while measuring 180 page manifests. This is a useful caveat on artifact freshness/methodology. | Confirmed |
| G-11 | P2 | `.vercel/repo.json` currently says Vercel project directory is `"."`; root `vercel-build` copies `apps/host/.next` to root `.next`, and `apps/host` also has its own `vercel-build`. This supports both roots but keeps root-vs-host deploy assumptions fragile. | Confirmed |

## Evidence

- `vercel.json` defines `framework: "nextjs"`, `regions: ["bom1"]`, 13 crons, and explicit long durations for `daily-cron`, `irt-calibrate`, `board-score`, and `internal/cron/fix-failed-questions`.
- `scripts/job-registry.json` contains 13 jobs and is schedule-aligned with the 13 Vercel cron paths.
- `packages/lib/src/cron-job-health.ts` writes `ops_events` rows with `category: "job_health"`, `severity: "info"`, metric/path/duration context, request ID, and environment.
- `apps/host/src/__tests__/api/cron-job-health-instrumentation.test.ts` statically asserts every registry job route imports `recordCronJobHealth` and includes the registered metric name.
- `artifacts/rca17-job-health.json` has all 13 metrics present but every `last_success_at` is `null`.
- `npx tsx scripts/verify-live-readiness-evidence.ts --input=artifacts/live-readiness-evidence-2026-07-10.json` failed with 5/15 gates passing.
- `artifacts/live-readiness-evidence-2026-07-10.json` shows pass: production/staging feature flags, grade format, DB function grants, mobile legacy traffic. It shows fail: job health, historical XP target DB decision, TSB4 live cutover. It shows not_run: certification E2E, edge secrets smoke, tenant isolation live, PII notification, incident ID live, XC3 migration execution, wireframe sign-off.
- `scripts/product-readiness-release-gate.ts --dry-run` reports 39/39 repo gates configured.
- `artifacts/devops-operational-execution-2026-07-10.md` reports prior release-gate execution reached 37/38 then failed at `host-build`, then a standalone guarded host build passed, and final monolithic runner attempts failed on `Another next build process is already running`.
- `npm run check:bundle-size` passed: shared JS 166.5 kB / 284 kB, middleware 0.0 kB / 120 kB, 180 pages measured, 0 over cap.
- Read-only inventory counted 364 API route files, 48 active Supabase Edge Functions, 48 Edge manifest entries, 13 Vercel crons, 13 job-registry entries, and live gate counts of 5 pass / 3 fail / 7 not_run.
- `supabase/config.toml` pins `project_id = "shktyoxqhundlvkiwguu"` and only disables JWT verification for local/prod `daily-cron` Edge Function config.
- `.github/workflows/deploy-production.yml` runs migrations with `supabase db push --linked --include-all`, deploys changed Edge Functions after migrations, and uses Vercel bypass headers when the secret exists.
- `.github/workflows/deploy-production.yml` also soft-passes all-429 Vercel Security Checkpoint health checks when bypass is missing.
- Root `package.json` has no `version`; `apps/host/package.json` has `"version": "2.0.0"`.

## Risks

| Risk | Impact | Why it matters |
|---|---|---|
| Live readiness not green | Broad production launch would rely on incomplete evidence. | 10/15 required live gates are not passing in the current bundle. |
| Missing job-health success metrics | Cron failures can be silent. | The registry and code can be correct while production jobs fail to execute or fail to write observability rows. |
| Vercel health soft-pass | CI/deploy can look green while real health was not verified. | All-429 protection challenges are explicitly treated as non-fatal without bypass. |
| Release tags may become `vundefined` | Release traceability and rollback bookkeeping degrade. | Production workflow reads a missing root package version. |
| Edge JWT posture may drift | Deploy command applies one JWT flag to all changed functions. | Manifest tracks deploy/secrets but not verify-JWT policy per function. |
| Release docs split brain | Operators may follow stale April checklist instead of current July evidence gates. | `docs/ops/release-checklist.md` predates the current runbook and live evidence contract. |
| Next build lock hygiene | Monolithic local gate may fail after overlapping build attempts. | Current artifact says standalone build can pass while the release-gate runner fails on `.next/lock`. |
| Bundle artifact caveat | Bundle pass is useful but not full fresh-build proof. | The checker saw 0 rendered HTML pages for shared scan, suggesting current `.next` shape may not represent a freshly completed build. |

## Dependencies

- Operator credentials and environment:
  - `VERCEL_AUTOMATION_BYPASS_SECRET`
  - Supabase production/staging access token and DB password
  - Supabase Edge secrets, especially `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
  - Live tenant smoke tokens and tenant fixture IDs
  - Certification E2E env: `CERTIFICATION_RUN_ENABLED`, `CERTIFICATION_BASE_URL`, `CERTIFICATION_RUN_ID`
- External approvals:
  - Product/CEO decision for historical XP clamp/backfill/comms.
  - TSB4 canonical membership retirement/repoint approval.
  - XC3 service-role/RLS migration execution sign-off.
  - Product sign-off on route/page/flag/API matrix.
  - Lower-tier PII exporter notification and audit review.
- Runtime systems:
  - Vercel deployment protection configuration.
  - Supabase `ops_events` availability and retention.
  - Cron route execution by Vercel.
  - Edge Function deployment state and secret parity.

## Recommended action

1. Treat the current production readiness state as not broad-launch-ready until the live evidence bundle validates 15/15 or explicit accepted-risk approvals are recorded where allowed.
2. Investigate job health first:
   - Manually invoke `apps/host/src/app/api/internal/cron/job-health-smoke/route.ts` with `CRON_SECRET` in staging/prod.
   - Confirm `ops_events` insert succeeds with `category='job_health'`.
   - Confirm Vercel cron requests carry the expected secret form for every scheduled route.
   - Re-export `scripts/verify-job-health-live.ts --print-sql` output and rerun the verifier.
3. Configure `VERCEL_AUTOMATION_BYPASS_SECRET` in both Vercel and GitHub so health and incident-ID probes prove the real app instead of soft-passing protection challenges.
4. Fix production release version source so deploy/release jobs use `apps/host/package.json` or add an intentional root workspace version.
5. Bring `docs/ops/release-checklist.md` forward to the July 2026 release evidence model or mark it superseded by `DEPLOYMENT_RUNBOOK.md`.
6. Add per-function JWT posture to `scripts/edge-function-manifest.json` and make the deploy workflow respect it instead of always using `--no-verify-jwt`.
7. Harden local release-gate build lock behavior further: ensure `host-build` never overlaps a previous Next build and that stale `.next/lock` cleanup only occurs after active process detection.
8. Require a fresh successful `npx cross-env NODE_OPTIONS=--max-old-space-size=6144 npm run build -w apps/host` plus `npm run check:bundle-size` before accepting bundle-size evidence.
9. Keep root-vs-host deploy assumptions explicit: Vercel project currently points at root `"."`, so root `vercel-build`, root `.next` copy, and root `vercel.json` must remain aligned.

## Files proposed for modification

No files were modified in this Stage 1 reconnaissance except this report.

Proposed future edits:

- `.github/workflows/deploy-production.yml`
  - Read release version from `apps/host/package.json` or a deliberate root version.
  - Enforce real health verification when bypass secret is expected for production release gates.
  - Respect per-function Edge JWT posture from a manifest.
- `scripts/edge-function-manifest.json`
  - Add `verifyJwt` or equivalent per function.
- `scripts/product-readiness-release-gate.ts`
  - Further harden build lock/process handling and optionally add an explicit fresh-build artifact proof.
- `docs/ops/release-checklist.md`
  - Update or supersede with the 2026-07-10 live evidence model.
- `DEPLOYMENT_RUNBOOK.md`
  - Add the root package version/release tagging caveat and Edge JWT posture requirement.
- `scripts/job-registry.json` and cron routes if live investigation shows schedule/metric/secret mismatch.
- Vercel and Supabase dashboard configuration:
  - `VERCEL_AUTOMATION_BYPASS_SECRET`
  - Edge Upstash secrets
  - Cron/job-health environment parity

## Tests required

Repo-owned:

- `npx tsx scripts/product-readiness-release-gate.ts`
- `npx cross-env NODE_OPTIONS=--max-old-space-size=6144 npm run build -w apps/host`
- `npm run check:bundle-size`
- `npm run gen:openapi:check -w apps/host`
- `npx tsx scripts/verify-devops-policy-contract.ts`
- `npx vitest run src/__tests__/api/cron-job-registry.test.ts src/__tests__/api/cron-job-health-instrumentation.test.ts src/__tests__/api/cron/job-health-smoke.test.ts` from `apps/host`
- `npx vitest run src/__tests__/edge-functions/edge-function-manifest.test.ts src/__tests__/live-readiness-evidence.test.ts` from `apps/host`

Live/operator-owned:

- `npx tsx scripts/verify-live-readiness-evidence.ts --input=<fresh-evidence-bundle.json>`
- `npx tsx scripts/verify-job-health-live.ts --input=<fresh-ops-events-job-health-export.json>`
- `npx tsx scripts/verify-incident-id-live.ts --input=<fresh-incident-id-evidence.json>`
- `npx tsx scripts/verify-live-tenant-isolation-smoke.ts` with live tenant fixture env.
- Certification E2E against the target deployment.
- Edge deploy/secret smoke for `parent-portal` durable limiter and privileged Edge Functions.
- Production health probe with `x-vercel-protection-bypass` reaching real `/api/v1/health`.

## Confidence level

High for static wiring, manifest counts, release-gate structure, stale checklist detection, root-version mismatch, and current evidence-bundle status.

Medium for production runtime conclusions because this stage did not have operator credentials, did not mutate secrets, did not run live tenant/certification E2E, and did not prove current production health through Vercel protection.

## Unresolved questions

- Is `VERCEL_AUTOMATION_BYPASS_SECRET` configured in Vercel and GitHub but absent locally, or not configured at all?
- Are the 13 Vercel cron routes executing in production, and if so are they failing before `recordCronJobHealth`, failing to authenticate, or writing to a different environment/table?
- Should all changed Supabase Edge Functions really deploy with `--no-verify-jwt`, or should JWT posture be function-specific?
- Should release versioning live at the monorepo root, `apps/host`, or a generated release manifest?
- Was the current `.next` artifact generated by the latest source state, given bundle checker reported 0 rendered HTML pages for the shared scan?
- Which live gates are allowed to be accepted-risk for this release candidate, and who can approve them?
- Has the production database already received every migration in the current dirty/untracked migration set?
- Should `docs/ops/release-checklist.md` remain as a historical checklist or be removed/superseded to prevent operator confusion?
