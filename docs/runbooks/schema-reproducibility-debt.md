# Runbook: Schema-Reproducibility Debt + Reconciliation Scope (Project B)

> **Filed:** 2026-06-12
> **Owner:** architect (DB) with ops oversight
> **Status:** OPEN — debt catalogued, reconciliation (project B) not yet started
> **Type:** doc-only. This file documents a known-debt root cause, scopes the
> fix, and records a CEO decision. No SQL, migration, or CI change is performed
> by reading it.
>
> **Related runbooks:**
> - `docs/runbooks/schema-reproducibility-fix.md` — the 2026-05-03 P0 work that
>   replaced the legacy chain with a pg_dump-derived idempotent baseline.
> - `docs/runbooks/staging-schema-drift-resolution.md` — the 2026-05-05
>   post-mortem of the `rag_chunks_valid_grade` constraint drift.
> - This debt is the **unfinished remainder** of that 2026-05-03 reproducibility
>   work: the baseline captured *schema* faithfully but did not fold in the
>   reference-data seeds and out-of-band schema mutations the chain depends on.

---

## 1. Summary

The committed baseline (`supabase/migrations/00000000000000_baseline_from_prod.sql`)
plus the root migration chain do **NOT** build a self-consistent schema. A fresh
database — the CI `Integration Tests (live DB)` job against `STAGING_SUPABASE_URL`,
a disaster-recovery rebuild, or a brand-new staging project — **cannot reproduce
production** purely from the committed migrations.

Why: multiple reference-data seeds and some schema changes were applied to prod
**out-of-band** (directly, via the Supabase MCP) or live **only** in `_legacy/`
files that `supabase db push` **deliberately skips** (it replays only files at the
immediate `supabase/migrations/` root). The committed root chain therefore assumes
prod-only state it never recreates, and downstream INSERTs / DDL that reference that
state fail on a fresh DB.

This is precisely what makes the CI `Integration Tests (live DB)` job fail: it runs
against a fresh-ish staging DB that has been built (or partially rebuilt) from the
committed chain, not against the long-lived hand-mutated prod.

---

## 2. Evidence (walls hit during the 2026-06-12 staging-sync recovery)

Each item below is a concrete failure observed while recovering the broken
staging-sync pipeline on 2026-06-12.

1. **`sync_school_admin_role` referenced a non-existent column.**
   The trigger function used `user_roles.role_name`, which does not exist in the
   baseline. This was already fixed on `main` by
   `supabase/migrations/20260603140000_fix_sync_school_admin_role_trigger.sql`,
   but staging was weeks behind and had not applied it.
   → This one is **drift (staging lag), not a missing fix** — the committed chain
   is correct here; staging simply hadn't caught up. Listed for completeness
   because it was the first wall hit during recovery.

2. **`subjects` ships schema-only in the baseline.**
   Verified: the table definition is present (baseline ~line 14123) with **zero
   `INSERT`s**. The canonical rows live ONLY in the skipped
   `_legacy/timestamped/20260415000004_subject_governance_seed.sql` (17 rows),
   **plus** 6 grade-11/12 stream electives that were added to prod **out-of-band**
   (referenced by `20260528000010_extend_g11_12_stream_subjects_cbse.sql`).
   On a fresh DB, `subjects` is born empty, so FK-dependent inserts fail:
   - `question_bank_subject_fk` (Postgres `23503` foreign-key violation)
   - `grade_subject_map_subject_code_fkey` (`23503`)
   Unblocked on staging by seeding all 23 subjects in one shot. The exact seed
   used is committed alongside this runbook:
   `docs/runbooks/staging-unblock-question-bank-subject-fk.sql`.

3. **`feature_flags` schema mismatch (the current staging wall).**
   The baseline defines `feature_flags` with `flag_name` (NOT NULL, unique) and
   `is_enabled`. But migration
   `supabase/migrations/20260606000000_phase5_phase6_python_flags.sql` runs
   `INSERT INTO feature_flags (name, enabled, ...) ON CONFLICT (name) ...` — it
   assumes a `name` column **and** a unique constraint on `name` that **no root
   migration creates**.
   → On a fresh DB this fails with `column "name" of relation "feature_flags"
   does not exist` (Postgres `42703`). This indicates a `feature_flags` schema
   change was applied to prod out-of-band and never folded into the root chain,
   so prod "has" a `name`/`enabled` shape the committed migrations cannot
   reconstruct.

4. **More walls are expected downstream** — same pattern (data-bearing seeds or
   out-of-band schema living outside the reproducible root chain). Candidate
   tables to audit proactively: `subscription_plans`, `feature_flags` rows,
   `readiness_rubric_config`.

---

## 3. Root cause

Out-of-band prod mutations (applied via the Supabase MCP) **and** data-bearing /
`_legacy/`-stranded seeds are **absent from the reproducible root chain**. Because
`supabase db push` replays only the immediate `supabase/migrations/` root, the
chain silently assumes prod-only state (seed rows + a couple of out-of-band schema
shapes) that it never recreates on a fresh project. The baseline faithfully
captured prod's *schema-as-of-capture* but not the *reference data* nor the
*post-baseline out-of-band schema edits*.

---

## 4. Scope of the reconciliation project (B) — what "done" looks like

**AUDIT.** Diff the live prod schema **and** reference data against
(`baseline` + root chain). Enumerate EVERY stranded or out-of-band change —
both schema and seed data. Output: a complete inventory of deltas.

**FOLD.** Bring into the committed baseline or forward root migrations:
- Canonical reference-data seeds — `subjects` (incl. the grade-11/12 stream
  electives), `grade_subject_map`, `feature_flags` rows, `subscription_plans`,
  and any others the audit surfaces.
- The out-of-band schema changes — e.g. reconcile the `feature_flags`
  `name`/`enabled` shape (either add the column + unique constraint in a root
  migration, or correct `20260606000000` and peers to match the committed
  `flag_name`/`is_enabled` shape — pick one canonical shape and make the chain
  internally consistent).

**VERIFY (acceptance gate).** A brand-new Supabase project built purely from
`supabase/migrations/` (root only) must:
- (a) apply cleanly start-to-finish (no `23503`, no `42703`, no missing-relation
  errors), and
- (b) pass `npm run test:integration`.
Add this as the explicit acceptance gate for project B. When this passes, the
`Integration Tests (live DB)` CI job (see §5) can be expected green again.

**CROSS-REFERENCE.** Treat this project as the continuation of the 2026-05-03
reproducibility work documented in `schema-reproducibility-fix.md` and
`staging-schema-drift-resolution.md`. This debt is that work's unfinished
remainder.

---

## 5. Decision D — CI `Integration Tests (live DB)` accepted-RED until B lands

**CEO-approved 2026-06-12.** The `Integration Tests (live DB)` CI check is
**accepted-RED until project B lands**.

Rationale:
- **Non-required** — it is not in branch protection, so it does not gate merge.
- **Non-prod-blocking** — production is healthy and live; this job tests
  fresh-DB *reproducibility*, not prod behavior. A red here is a statement about
  the committed migration chain's self-consistency, not about production health.
- **Already red for weeks** — its red is a known, understood condition, not a
  new regression.

Interim handling: **do NOT** treat this job's red as a release blocker or as a
regression while B is outstanding.

Where the check is defined: `.github/workflows/ci.yml`, the `integration-tests`
job (`name: Integration Tests (live DB)`). Note the current committed state of
that job's test step is `continue-on-error: false` (i.e. the *step* is wired
blocking), but the job is **not** in branch protection, so it does not actually
gate merges — which is the basis for "non-required" above.

**Optional interim nicety (architect's call, NOT required):** flipping that
step's `continue-on-error` to `true` would make the job surface as a clean
amber/pass in the checks UI rather than a red X while B is in flight. This is
cosmetic; it is explicitly out of scope for this doc-only change and is left to
the architect's discretion. No CI change is made by this runbook.

---

## 6. Progress log — 2026-06-12

During recovery the staging project (`alfanumrik-staging`) was advanced
~80 migrations:
- All 23 subjects seeded (the 17 legacy governance rows + 6 grade-11/12 stream
  electives), via `docs/runbooks/staging-unblock-question-bank-subject-fk.sql`.
- `20260603140000_fix_sync_school_admin_role_trigger.sql` applied (resolved the
  `user_roles.role_name` wall in §2.1).
- Sync now **stalls at the `feature_flags.name` wall** (`20260606000000`,
  §2.3 — `42703`).

Staging is deliberately left in this **advanced-but-incomplete** state pending
project B. It is NOT a reproducible build; it is a hand-advanced recovery state
that mirrors prod closely enough to keep working, but does not prove the
committed chain reproduces prod. Project B's acceptance gate (§4) is the real
proof of reproducibility.
