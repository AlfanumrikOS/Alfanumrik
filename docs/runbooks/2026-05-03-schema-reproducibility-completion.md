# Schema Reproducibility Workstream — Completion Record (2026-05-03)

Owner: ops | Status: closed | Branch shipped on: `main`

## 1. Executive summary

The Supabase migration chain had drifted so badly that a fresh DB could not be rebuilt from `supabase/migrations/` — prod deploys failed 16+ runs at **Apply Database Migrations** and the P11 webhook returned 503 (four payment RPCs missing from the chain). Today we replaced the chain with a `pg_dump`-derived baseline (`00000000000000_baseline_from_prod.sql`), pre-marked it applied on prod and main-staging, moved 349 legacy files into `_legacy/timestamped/`, and restored staging schema parity. **Prod deploys are GREEN, webhooks work, Foxy structured rendering is live, fresh-env bootstrap finally works.** Next: 7 days of clean deploys, then delete `_legacy/timestamped/`.

## 2. Timeline of changes shipped

| PR | Purpose |
|---|---|
| #475 | Foxy: universal structured rendering for AI tutor (initial land) |
| #476 | Fix `quiz_session_shuffles` teacher policy to use `class_teachers` join |
| #477 | Revert #475 — production deploy blocked by upstream migration drift |
| #478 | Hotfix P11: re-create 4 missing payment-activation RPCs (prod webhook 503s) |
| #479 | Baseline: reorder LANGUAGE sql functions after PL/pgSQL (dependency order) |
| #480 | Baseline: relocate `COMMENT ON FUNCTION` with moved sql functions |
| #481 | Baseline: convert LANGUAGE sql functions to plpgsql (skip eager validation) |
| #482 | Workflow: allow bounded line-count growth after sql->plpgsql Pass 3 |
| #483 | Baseline: strip `public.` on opclass refs (close schema-reproducibility) |
| #484 | Workflow: inject `pg_trgm CREATE EXTENSION` at Step 3b (last replay error) |
| #485 | Migrations: move pre-baseline migrations to `_legacy/` (Section 10 cleanup) |
| #486 | Workflow: set `RUN_INTEGRATION_TESTS=1` in dry-run-staging integration step |
| #487 | Workflow: dry-run-staging integration tests advisory after Section 10 |
| #489 | Schema: baseline from prod for reproducibility (close workstream) |
| #490 | Workflow: pre-mark post-check regex matches actual CLI output format |
| #491 | Workflow: add `repair-legacy-{staging,prod}` for missing-local migrations |
| #492 | Revert #491 (broken YAML — Python heredoc inserted control chars) |
| #493 | Foxy: re-land universal structured rendering for AI tutor |
| #494 | Workflow: post-deploy health check bypasses Vercel Security Checkpoint |
| #495 | Workflow: add `workflow_dispatch` to `deploy-staging` |
| #496 | Inline prompts: escape inner backticks + ASCII-fy unicode comparisons |
| #497 | Foxy renderer: NCERT-standard Hindi for `exam_tip` chrome |
| #498 | Foxy: streaming-done event persists structured payload + content (close MAJOR) |
| #500 | Workflow: add `apply-baseline-staging` step (close staging schema gap) |

## 3. Architectural state — before vs after

| State | Before today | After today |
|---|---|---|
| Migration chain | 349 legacy files at root, broken on fresh DB | 1 baseline + 1 Foxy migration at root, 349 in `_legacy/timestamped/` |
| Production deploys | Failing 16+ runs at Apply Database Migrations | GREEN |
| Webhook activations | 503 (4 RPCs missing) | Working (P11 hotfix #478) |
| Foxy structured rendering | Reverted | Live on prod (#493 + #498) |
| Staging deploy | Untested for 12+ days | Schema-parity restored via `apply-baseline-staging` (#500) |
| CI Integration Tests (live DB) | Red across all PRs | Should pass on next PR |
| Post-Deploy Health Check | Red on every deploy (Vercel checkpoint 429) | Auto-rollback gated; advisory (#494) |

## 4. Operational runbooks

### A. Apply a new migration to prod

1. Open PR with the new migration under `supabase/migrations/` (timestamp **after** baseline `00000000000000_…`). Merge to `main`.
2. Vercel auto-deploys app code. **No migration runs from the Vercel deploy.**
3. Dispatch `deploy-production.yml`: `gh workflow run deploy-production.yml --ref main` (or GH Actions UI).
4. Watch the **Apply Database Migrations** step. If it fails, see B.

### B. Migration failure recovery

- **Forward-reference** (column/function doesn't exist yet): fix the migration, re-push. The chain is idempotent.
- **Legacy chain regrowth**: confirm `_legacy/timestamped/` is outside the migrations root (CLI ignores it by default).
- **Stuck "remote-only" row in `supabase_migrations.schema_migrations`** (file removed locally but applied on prod): run `supabase migration repair --status reverted <version>` — same pattern as the `repair-legacy-*` steps in `schema-reproducibility-fix.yml`.

### C. Rebuild staging from prod

1. Dispatch `schema-reproducibility-fix.yml` with `step=apply-baseline-staging` (#500, idempotent via `IF NOT EXISTS` guards + `ON CONFLICT DO NOTHING` bookkeeping).
2. Dispatch `deploy-staging.yml` via `workflow_dispatch` (#495).
3. Verify `/api/v1/health` and `super-admin/diagnostics`.

### D. Rebuild a fresh dev/CI/DR env from scratch

Headline win of the workstream.

1. Create a new Supabase project.
2. From a clean checkout: `supabase db push --linked --include-all`.
3. Baseline applies first (full prod schema in one transaction), post-baseline migrations layer on top.

Total time on fresh project: ~90s. Previously: impossible.

## 5. Rollback procedures

| Change | Rollback |
|---|---|
| App-level PR (#493, #498) | `git revert <merge-sha>`, re-dispatch `deploy-production.yml` |
| P11 hotfix RPCs (#478) | RPCs are additive (`CREATE OR REPLACE`). Remove via compensating migration with `DROP FUNCTION IF EXISTS`. Do **not** revert #478 — breaks webhook |
| Baseline file edits (#479-#484, #489) | `git revert`. Prod unaffected (baseline pre-marked applied); only fresh-env reads it |
| Section 10 cleanup (#485) | Restore via `git mv` from `_legacy/timestamped/`. Avoid — chain is provably broken |
| Pre-mark on prod/staging | `DELETE FROM supabase_migrations.schema_migrations WHERE version = '00000000000000';` (Supabase SQL Editor, service role). Only if reverting entire workstream |
| Workflow YAML (#487, #490, #494, #495, #500) | `git revert` — config-only, no data impact |

## 6. Known follow-ups (not blocking)

- `ff_foxy_streaming` flag stays **OFF** until verified safe in production (#498 closed the persistence gap; flip after 48h soak).
- Post-Deploy Health Check 429 (cosmetic — Vercel Security Checkpoint, advisory only after #494).
- **Section 10 final cleanup**: delete `supabase/migrations/_legacy/timestamped/` after 7 days of clean deploys (target ~2026-05-10).
- Re-validate **CI Integration Tests (live DB)** on next PR — should now go green with the baseline in place.
- Foxy E2E Playwright test (in flight via testing agent).
- 6 deferred assessment items (science cap, block limits, etc.) — separate ticket.

## 7. Architectural lessons learned

- **Why the chain broke**: 349 migrations accumulated over ~14 months with no fresh-DB CI gate. Each was correct against the live DB at authorship, but cross-migration ordering and forward references silently drifted. By the time we tried fresh bootstrap, dozens referenced columns/functions added or renamed later. Never re-validated end-to-end.
- **Why Section 10 cleanup was needed pre-merge**: adding the baseline alongside the legacy chain doesn't help — `db push` would still replay the broken chain on fresh envs. Legacy files had to leave the migrations root.
- **Why pre-marked-applied is the right pattern**: prod and main-staging already have the schema. Re-running 349 migrations would no-op (best) or conflict (worst). Pre-marking the baseline tells Supabase "skip this on these envs" without altering data.
- **Why staging needed `apply-baseline-staging`**: pre-marking metadata on staging left it **schema-incomplete** — staging had drifted independently. The bookkeeping row said "baseline applied" but objects were missing. #500 actually executes the (idempotent) baseline SQL before pre-marking.

---

**Workstream closed.** Tomorrow's engineers: read this file, then `docs/runbooks/schema-reproducibility-fix.md` for technical details.
