# Agent A - Architecture and Integration Report

Date: 2026-07-10
Agent: Agent A - Architecture and Integration Lead
Mode: Stage 1 read-heavy reconnaissance; no code changes proposed in this pass.

## Scope inspected

- Read repo-level instructions and handoff context: `AGENTS.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `engineering-audit/CODEX_HANDOVER.md`.
- Read the July 9 RCA and execution ledger: `engineering-audit/FULL_RCA_BACKEND_WORKFLOWS_PRODUCT_READINESS_2026-07-09.md`, `engineering-audit/PRODUCT_READINESS_EXECUTION_2026-07-09.md`.
- Inspected monorepo/package boundaries: root `package.json`, `apps/host/package.json`, `apps/foxy`, `packages/lib`, `packages/ui`, `python/pyproject.toml`, `supabase/functions`, `supabase/migrations`, `vercel.json`.
- Inspected central manifests and guards: `scripts/route-access-manifest.json`, `scripts/admin-client-allowlist.json`, `scripts/edge-function-manifest.json`, `scripts/job-registry.json`, `scripts/product-surface-matrix.json`, `scripts/feature-flag-matrix.json`, `scripts/xc3-service-role-migration-batch.json`, `scripts/tsb4-canonical-membership-cutover.json`, `scripts/product-readiness-release-gate.ts`, `openapi/v2.json`, `docs/public-api/openapi.json`.
- Re-measured current counts instead of copying prior audit values.

## Files inspected

- `AGENTS.md` - present and empty.
- `CLAUDE.md`
- `ARCHITECTURE.md`
- `engineering-audit/CODEX_HANDOVER.md`
- `engineering-audit/FULL_RCA_BACKEND_WORKFLOWS_PRODUCT_READINESS_2026-07-09.md`
- `engineering-audit/PRODUCT_READINESS_EXECUTION_2026-07-09.md`
- `package.json`
- `apps/host/package.json`
- `vercel.json`
- `python/pyproject.toml`
- `scripts/route-access-manifest.json`
- `scripts/admin-client-allowlist.json`
- `scripts/edge-function-manifest.json`
- `scripts/job-registry.json`
- `scripts/product-surface-matrix.json`
- `scripts/feature-flag-matrix.json`
- `scripts/xc3-service-role-migration-batch.json`
- `scripts/tsb4-canonical-membership-cutover.json`
- `scripts/product-readiness-release-gate.ts`
- `openapi/v2.json`
- `docs/public-api/openapi.json`

## Confirmed findings

1. Current integration center of gravity is `apps/host`, not the repo root or `apps/foxy`.
   - Root `package.json` delegates `build` to `npm run build -w apps/host` and `vercel-build` copies `apps/host/.next` to root `.next`.
   - `apps/foxy` currently contains only `.next` and no `package.json`, so it should not own implementation work in this stage.

2. The repo is in a high-concurrency, high-risk integration state.
   - `git status --short` shows many modified and untracked files across `apps/host`, `packages/lib`, `packages/ui`, `scripts`, `supabase/migrations`, `e2e`, and `engineering-audit`.
   - Do not revert, regenerate, or overwrite shared manifests casually. The highest-risk shared files are `scripts/admin-client-allowlist.json`, `scripts/route-access-manifest.json`, `scripts/product-readiness-release-gate.ts`, `scripts/product-surface-matrix.json`, `scripts/feature-flag-matrix.json`, `openapi/v2.json`, `docs/public-api/openapi.json`, `packages/lib/src/rbac.ts`, `packages/lib/src/flags/defaults.ts`, and `apps/host/src/proxy.ts`.

3. Route access metadata has caught up to the live route count, but public/mobile API contract remains intentionally narrow.
   - Current command `rg --files apps/host/src/app/api -g 'route.ts' -g 'route.tsx' | Measure-Object` returned `364`.
   - `scripts/route-access-manifest.json` has `"routeCount": 364`.
   - `openapi/v2.json` still has `12` paths; `docs/public-api/openapi.json` has `5` paths and matches the five current `apps/host/src/app/api/public/v1/**/route.ts` files.
   - This means route classification is broad, but partner/mobile contract coverage remains scoped rather than complete.

4. XC-3 is still the main cross-workstream dependency.
   - `scripts/admin-client-allowlist.json` currently pins `count: 258`, down from the July 9 RCA count of `269`.
   - The allowlist comment states it is a ratchet-down-only ledger for API routes importing the RLS-bypassing service-role client.
   - `scripts/xc3-service-role-migration-batch.json` is the executable first-batch coordination artifact; it currently includes a small prioritized batch, not all 258 remaining routes.

5. TSB-4 canonical membership remains an integration blocker between backend, DB, tests, and product launch proof.
   - July 9 RCA identifies `class_students` vs `class_enrollments` as a P0 multi-tenancy risk.
   - `scripts/tsb4-canonical-membership-cutover.json` exists and has a 7-stage cutover plan, but the execution ledger still lists TSB-4 live repoint/smoke as an operator gate before broad launch.

6. Edge Function manifest appears structurally in sync when parsed correctly.
   - Current corrected command found 48 unique deployable functions in `scripts/edge-function-manifest.json`.
   - Active `supabase/functions/**/index.ts` includes 49 files only because `supabase/functions/grounded-answer/prompts/index.ts` is a nested prompt barrel, not a deployable function directory.
   - No active top-level function directory with `index.ts` was missing from the manifest after excluding `_archive`, `_shared`, and nested non-function barrels.

7. `ARCHITECTURE.md` and `CLAUDE.md` disagree on Foxy naming.
   - `CLAUDE.md` states active Foxy is `src/app/api/foxy/route.ts` and `foxy-tutor` Edge Function was retired on 2026-07-01.
   - `ARCHITECTURE.md` still shows `foxy-tutor` in the architecture diagram.
   - Treat `CLAUDE.md` and live file layout as current for ownership; treat `ARCHITECTURE.md` diagram as stale in this detail.

8. Release readiness is split between repo-owned gates and operator-owned live proof.
   - `scripts/product-readiness-release-gate.ts` defines repo steps including type-check, lint, route access manifest, edge function manifest, tenant isolation eval, host build, and OpenAPI check.
   - The same file defines operator steps for production/staging feature flags, live job health, XC-3 execution, TSB-4 live cutover, and wireframe/CTA sign-off.
   - Execution ledger reports the monolithic runner exceeded a 15-minute timeout once, then underlying gates were run directly; do not treat a local green build as broad-launch proof.

9. Cron/job health is a live-environment dependency, not just a code dependency.
   - `vercel.json` defines 13 crons and `scripts/job-registry.json` has 13 jobs.
   - The execution ledger records `npx tsx scripts/verify-job-health-live.ts --input=artifacts/rca17-job-health.json` exited 1 with `0/13 live scheduler success metrics present yet`.
   - Code instrumentation and registry are present; actual scheduler execution evidence remains required.

10. Python backend is a separate service boundary.
    - `python/pyproject.toml` defines `alfanumrik-ai-services`, FastAPI/uvicorn dependencies, and package discovery under `services*`.
    - Prior memory and local files point to `python/services/ai` as the active service; do not confuse this with legacy root `api/` or root Python files during integration.

## Evidence

- `AGENTS.md`: empty file; no additional repo-local agent instructions found there.
- `package.json:4` declares workspaces; `package.json:11-15` delegates build/type-check to workspace scripts.
- `apps/host/package.json:10` runs `node ../../scripts/auth-guard.js && next build --webpack`; `apps/host/package.json:30` and `:36` own OpenAPI generation and tenant isolation eval.
- `CLAUDE.md:54` identifies active Foxy route and retired `foxy-tutor`; `CLAUDE.md:70-73` defines the three Supabase clients and `supabase-admin` as RLS-bypassing; `CLAUDE.md:77` defines `apps/host/src/proxy.ts` as middleware; `CLAUDE.md:81` defines Supabase Edge Functions as Deno function directories with `index.ts`.
- `ARCHITECTURE.md:27` still names `foxy-tutor`; `ARCHITECTURE.md:382-396` defines the ADR-005 invariant, `state_events`, `projector-runner`, and `projector-health-check`.
- `engineering-audit/CODEX_HANDOVER.md:26-33` warns that features may exist in code but not runtime and requests read-only audit before edits; `:42-44` calls out Foxy actions, adaptive intelligence, and feature flags.
- `engineering-audit/FULL_RCA_BACKEND_WORKFLOWS_PRODUCT_READINESS_2026-07-09.md:11` classifies backend as partially production-ready with high operational debt; `:15` pins the prior 269 service-role route importer risk; `:43` and `:61` identify `class_students` / `class_enrollments`; `:47` identifies OpenAPI 12 paths vs 363 handlers.
- `engineering-audit/PRODUCT_READINESS_EXECUTION_2026-07-09.md:12`, `:16`, `:21`, `:31-35`, `:42-43`, `:137`, `:139-150`, `:174-182` document manifests, release gate split, latest health, and remaining operator gates.
- Current commands executed:
  - `git status --short`
  - `rg --files apps/host/src/app/api -g 'route.ts' -g 'route.tsx' | Measure-Object`
  - Node JSON summary of central manifests: route access `364`, admin allowlist `258`, job registry `13`, edge manifest `48`, product surface matrix `13`, feature flag matrix `120`, XC-3 batch `6`, TSB-4 stages `7`, `openapi/v2.json` paths `12`, `docs/public-api/openapi.json` paths `5`.
  - Node public-v1 comparison: five public v1 route files and five public API spec paths, no missing public-v1 spec path.
  - Node edge-function comparison: 48 unique top-level deployable functions in manifest; nested `grounded-answer/prompts/index.ts` explains the raw 49 `index.ts` file count.

## Risks

- Shared-file overwrite risk is high because multiple agents have already modified manifests, migrations, tests, and package/shared library files.
- Any change to `scripts/admin-client-allowlist.json` or `scripts/route-access-manifest.json` can create false security confidence if not regenerated with the exact live route tree and paired tests.
- XC-3 migrations move risk from route-level service-role checks into scoped RPCs; every such migration needs DB grant/search_path/auth.uid proof, app tests, and route manifest updates in one atomic sequence.
- TSB-4 affects teacher/school/parent visibility. Partial repoints can make different paths answer authorization differently.
- `ARCHITECTURE.md` stale Foxy naming can send agents toward retired Edge Function assumptions.
- `openapi/v2.json` remains too small to describe the full API surface; this is acceptable only if it is explicitly scoped to public/mobile contract and not used as a full backend inventory.
- Local repo gates are not enough for launch readiness; live scheduler, feature flag, tenant isolation, Edge secret/deploy, and mobile traffic proofs are separate operator gates.

## Dependencies

- XC-3 depends on `scripts/admin-client-allowlist.json`, `scripts/route-access-manifest.json`, scoped RPC migrations under `supabase/migrations`, focused API tests under `apps/host/src/__tests__`, and live DB grant proof.
- TSB-4 depends on `scripts/tsb4-canonical-membership-cutover.json`, route/helper repoints away from mixed `class_students` and `class_enrollments` readers, divergence quantification SQL, and live tenant smoke.
- Public/mobile contract work depends on `openapi/v2.json`, `docs/public-api/openapi.json`, `scripts/gen-openapi.mjs`, `apps/host/src/__tests__/public-api/openapi-route.test.ts`, and `apps/host/src/__tests__/mobile-v2-contract-manifest.test.ts`.
- Release readiness depends on `scripts/product-readiness-release-gate.ts` repo gates plus `scripts/verify-live-readiness-evidence.ts` operator bundle.
- Edge deployment readiness depends on `scripts/edge-function-manifest.json`, `scripts/edge-secret-activation-readiness.json`, Supabase project secrets, and function invocation/log proof.

## Recommended action

1. Freeze shared manifest ownership during multi-agent execution. Require one architecture owner to serialize edits to route access, admin allowlist, OpenAPI, feature flag matrix, product surface matrix, release gate, and Edge function manifest.
2. Use this integration sequence:
   - First: run/list current release-gate plan with `npx tsx scripts/product-readiness-release-gate.ts --list` and `--dry-run`.
   - Second: finish in-flight XC-3 route batches and keep allowlist/route-access/tests/migrations synchronized.
   - Third: finish TSB-4 boundary-reader and route-helper repoints before any broad teacher/school-admin launch proof.
   - Fourth: update stale architecture docs only after live ownership is settled, especially Foxy naming and API contract scope.
   - Fifth: collect operator-owned evidence bundle using `scripts/verify-live-readiness-evidence.ts` only after repo-owned gates pass.
3. Treat `apps/host` as the primary Next app and `python/services/ai` as the Python service. Avoid spending integration cycles in `apps/foxy` unless another agent proves it is intentionally revived.
4. Keep OpenAPI language precise: `docs/public-api/openapi.json` currently matches public v1 routes; `openapi/v2.json` is not a full API inventory.

## Files proposed for modification

No code modifications are proposed in Stage 1.

Future likely modification owners, after coordination:
- `ARCHITECTURE.md` - update stale `foxy-tutor` diagram/reference after product/AI owner confirms wording.
- `scripts/admin-client-allowlist.json` - only by XC-3 route owners when a route truly removes broad service-role imports.
- `scripts/route-access-manifest.json` - only regenerated with `scripts/gen-route-access-manifest.mjs` after route additions/removals.
- `scripts/tsb4-canonical-membership-cutover.json` and related route/helper files - only by TSB-4 owner.
- `openapi/v2.json`, `docs/public-api/openapi.json`, `scripts/mobile-v2-contract-manifest.json` - only by API/mobile contract owner.
- `scripts/product-readiness-release-gate.ts`, `scripts/live-readiness-evidence-manifest.json` - only by release/ops owner.

## Tests required

Minimum repo-owned checks before merging integration work:

- `npm run type-check --workspaces --if-present`
- `npm run lint --workspaces --if-present`
- `npx vitest run src/__tests__/api/route-access-manifest.test.ts` from `apps/host`
- `npx vitest run src/__tests__/api-admin-client-allowlist.test.ts` from `apps/host`
- `npx vitest run src/__tests__/edge-functions/edge-function-manifest.test.ts` from `apps/host`
- `npx vitest run src/__tests__/xc3-service-role-migration-batch.test.ts` from `apps/host` for XC-3 work
- `npx vitest run src/__tests__/tsb4-canonical-membership-cutover-readiness.test.ts` from `apps/host` for TSB-4 work
- `npm run eval:tenant-isolation -w apps/host`
- `npx tsx scripts/pre-rollout-checklist.ts`
- `npm run gen:openapi:check -w apps/host`
- `npm run build -w apps/host`

Operator/live checks before broad launch:

- `npx tsx scripts/verify-feature-flag-matrix.ts --env=staging`
- `npx tsx scripts/verify-feature-flag-matrix.ts --env=production`
- `npx tsx scripts/verify-job-health-live.ts --input=<rows.json>`
- `npx tsx scripts/verify-live-tenant-isolation-smoke.ts`
- `npx tsx scripts/verify-db-function-hardening-live.ts --input=<rows.json>`
- `npx tsx scripts/verify-live-readiness-evidence.ts --input=<evidence-bundle.json>`

## Confidence level

High for architecture boundaries, manifest counts, route/API contract drift, and shared-file risks based on live commands and inspected files.

Medium for runtime readiness because this Stage 1 pass did not run the full release gate, live Supabase checks, certification E2E, or operator evidence bundle.

## Unresolved questions

- Which agent owns serialization of shared manifests during this multi-agent run?
- Is `openapi/v2.json` intentionally limited to a subset of mobile/public v2 paths, or should it become a complete public/mobile contract?
- What is the accepted end state for TSB-4: retire `class_students`, retain it as legacy mirror, or keep both with permanent sync?
- Which of the remaining 258 admin-client allowlisted routes are in the next XC-3 batch after the current six-route manifest?
- Has live cron execution produced the 13 job-health metrics after the ledger recorded `0/13`?
- Should `ARCHITECTURE.md` be corrected now for `foxy-tutor`, or deferred until the AI/Foxy agent finishes current Foxy action work?
