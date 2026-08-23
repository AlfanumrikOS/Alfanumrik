# 01 — System Inventory

**Status:** DRAFT — Phase 1. Real, measured facts only; anything not yet independently confirmed is marked
PENDING. Do not quote counts in this file from memory in future sessions — re-run the commands shown.

## Repo shape
- Monorepo: npm workspaces (`apps/*`, `packages/*`, `eslint-plugin-alfanumrik`). Node `>=22.0.0 <23.0.0`
  (confirmed installed: v22.23.2). npm 12.0.2. Package manager: **npm** (package-lock.json present, no
  pnpm/yarn lockfile).
- No root `tsconfig.json` — path aliases resolve relative to `apps/host/tsconfig.json`.
- Current branch at start of this program: `fix/staging-catchup-quiz-rag-and-learning-source`.
  Working branch for this program: `release/launch-readiness` (created off the above, non-destructively;
  all prior uncommitted changes preserved — 33 modified/untracked entries at branch-creation time, listed
  in git status, not reproduced here to avoid this doc going stale the moment anything is committed).

## CI/CD
29 workflows in `.github/workflows/` as of 2026-08-23 (`ls .github/workflows/ | wc -l`):
ci, deploy-production, deploy-staging, e2e-suite, e2e-nightly, edge-auth-sweep, mesh-cron, migration-lint,
mobile-ci, mobile-release, openapi-contract, peer-deps-guard, pipeline-alert, pr-health-sweep,
production-cron-runner, python-ai-deploy, rag-cosine-replay, rag-eval, schema-reproducibility-fix,
seed-staging-test-student, staging-adaptive-drill, staging-flag-set, sync-staging-functions,
sync-staging-migrations, synthetic-monitor, codeql-analysis, branch-cleanup-on-merge, branch-stale-sweep,
content-quality-nightly.
**This is a mature CI setup, not greenfield** — Gate A/G expectations should be evaluated as "does the
existing pipeline already cover this + is it green" rather than "build one from scratch." See CI/reliability
recon findings for actual current pass/fail state (`04_FINDINGS_AND_CONFLICTS.md`).

## Prior audit corpus (primary existing evidence — read before re-deriving anything)
`engineering-audit/` — an 8-cycle audit program (2026-06-28→2026-06-29), CEO-facing close-out at
`PROGRAM-SUMMARY.md`, live state at `STATE.md`, open items at `PRIORITY-BACKLOG.md`. Also present:
`CODEX_HANDOVER.md` (a follow-up mission brief for a second agent system, targeting Foxy action-button
wiring and adaptive-engine runtime verification — **no distinct completion/findings doc for this could be
located**; see `04_FINDINGS_AND_CONFLICTS.md`), `cycles/`, `feature-inventory/`, `metrics/`, `multi-agent/`,
`remediation/` (per-item remediation folders, e.g. `remediation/pay-2-pricing-source/`), `templates/`,
`workflows/` (per-cycle 8-phase docs: map/gap-analysis/root-cause/design/implementation/self-review/
validation/regression).

Regression catalog: sharded at `.claude/regression/` (00-header.md + numbered shard files). **Its own
header admits an unresolved three-way count divergence** as of 2026-08-11: "404 entries upper bound / 399
honest... Independently measured body-backed REG-N ids: 346 (max 399)." Latest REG id: REG-399. Do not
quote a single number without stating which of the three definitions you mean — this is itself a Gate A
finding, not just a documentation nit (see findings doc).

## Domains (per launch mandate's own grouping — used to structure recon)
- **Frontend journeys**: `apps/host/src/app/` (student non-admin routes, `/parent/*`, `/teacher/*`,
  `/super-admin/*`, `/internal/admin/*`), `packages/ui/src/`.
- **Backend/API**: `apps/host/src/app/api/` (280+ routes per `.claude/CLAUDE.md`, last counted 2026-06-27 —
  re-measure, don't quote), middleware at `apps/host/src/proxy.ts`.
- **Supabase/security/data**: `supabase/migrations/`, `supabase/functions/` (Edge Functions, Deno),
  RLS/grants, RBAC (`packages/lib/src/rbac.ts`).
- **Adaptive/Foxy/RAG**: `packages/lib/src/cognitive-engine.ts`, `packages/lib/src/irt/`,
  `packages/lib/src/learn/` (SRS/daily-rhythm/weekly-dive/monthly-synthesis orchestrators),
  `supabase/functions/{cme-engine,quiz-generator,ncert-solver,grounded-answer}/`,
  `apps/host/src/app/api/foxy/route.ts`.
- **CI/reliability**: `.github/workflows/`, `vitest.config.ts`, `playwright.config.ts`, `e2e/`,
  `packages/lib/src/logger.ts`, Sentry config in `next.config.js`.

## Environments / project references (see `02_DEPENDENCY_AND_TRUST_MAP.md` for full trust map)
- Production Supabase project ref: `shktyoxqhundlvkiwguu` — **confirmed by the CEO directly** during a
  separate investigation this session (PAY-2 divergence query, 2026-08-23). `apps/host/.env.local` and
  `.env.local.LIVE-SAVE` both point to this project.
- A separate `.env.staging.local` points to project ref `gzpxqklxwzishrkiaatd`, but its
  `SUPABASE_SERVICE_ROLE_KEY` value is only 41 characters — too short to be a genuine Supabase JWT service
  key; treat as a placeholder, not a working staging credential, until proven otherwise.
- Deployment: Vercel, bom1/Mumbai region (per root CLAUDE.md); not independently re-verified this session.

## Findings sources feeding this inventory
This file is seeded from direct orchestrator inspection (git/package.json/CI workflow listing) plus reading
`engineering-audit/PROGRAM-SUMMARY.md` and `CODEX_HANDOVER.md` in full. Domain-specific inventory (routes,
API surface counts, migration counts, Edge Function counts) is being independently gathered by the 5 parallel
recon agents dispatched 2026-08-23 (frontend, backend, Supabase/security/data, adaptive/Foxy/RAG,
CI/reliability) — their findings will be merged into this file and into `04_FINDINGS_AND_CONFLICTS.md` /
`05_TASK_LEDGER.md` once returned.
