# Cycle Log — 2026-06-29 — Auth & Onboarding (P15) — Cycle-1 follow-up batch

> Dated follow-on to `cycles/2026-06-28-auth-onboarding.md`. Records the second (auto-fix-safe)
> follow-up batch for Cycle 1 plus the open production migration-drift incident.
> Authoritative ledger: `workflows/auth-onboarding/` (01-map … 08-regression + STATUS.md).

## Batch summary
Three remaining Cycle-1 auto-fix-safe follow-ups LANDED. Gates: type-check **PASS**, lint **0 errors**.

| ID | Owner | Title | File:line | Disposition |
|---|---|---|---|---|
| AO-5 | assessment | grade stored as canonical "9" not "Grade 9" (P5) | `src/app/onboarding/page.tsx` | **FIXED** — APPROVE |
| AO-7 | backend | `resolveIdentity()` `.single()` → `.maybeSingle()` (PGRST116 noise) | `src/lib/identity/onboarding.ts` | **FIXED** — behavior-preserving |
| AO-9 | frontend | durable per-user once-guard on `signup_complete` analytics | `src/lib/AuthContext.tsx` | **FIXED** — P13/P15 safe |

### AO-5 (assessment, FIXED)
`src/app/onboarding/page.tsx` now stores the **bare canonical grade string** ("9") instead of
"Grade 9", conforming to invariant **P5**. Rigorous reader-safety proof: every TS reader expects the
bare form (8+ `parseInt` sites return `NaN` on "Grade 9"; `StreamGate` exact-match), every SQL reader is
form-invariant via `normalize_grade()`, and no reader depends on the "Grade N" prefix. Assessment
verdict **APPROVE**.

### AO-7 (backend, FIXED)
`src/lib/identity/onboarding.ts` `resolveIdentity()` — four `.single()` → `.maybeSingle()` lookups
(students / teachers / guardians / onboarding_state). Behavior-preserving; removes PGRST116 log noise on
the normal no-row path.

### AO-9 (frontend, FIXED)
`src/lib/AuthContext.tsx` — the single `signup_complete` analytics emission is wrapped in a durable
per-user once-guard (localStorage key by auth UUID), so it fires exactly once per signup even across
sessions. No PII (**P13**); degrades safely if localStorage unavailable (**P15**).

## New backlog item discovered (NOT fixed) — AO-10
`src/lib/AuthContext.tsx` (~lines 423-424) sets the `student` object from the raw DB row **without grade
coercion**, so any legacy "Grade N" rows already in the DB still leak the prefixed form to TS readers
until backfilled. The `normalize_grade` SQL helper is **misnamed** vs the TS canonical (it ADDS the
prefix). Broader convergence/backfill item, **co-owned by assessment + architect**: needs a one-time
backfill of legacy `students.grade` plus either renaming/repurposing `normalize_grade` or a read-time
coercion in AuthContext. Tracked as **AO-10** in `STATUS.md`.

## Still gated (unchanged)
- **AO-3 (GATED):** institution_admin B2B provisioning unification — **requires USER APPROVAL** +
  architect-led design.
- **AO-2 CI fixtures (pending):** ops/infra to seed 3 per-role staging fixtures + secrets before the
  `test.fixme` 3-role E2E can be lifted to gating.

## Incident — production migration-history drift (still open, operator step pending)
See `workflows/_incidents/2026-06-28-prod-migration-drift.md` (full root-cause).

- **Summary:** prod's `supabase_migrations.schema_migrations` carries two orphan "remote-only" rows
  (`20260628015107`, `20260628015237`) from board-score (PR #1147) local-dev iterations that were
  consolidated into `20260628000000_board_score_v1.sql` before the PR. `supabase db push` aborts its
  pre-flight consistency check, failing **Apply Database Migrations** and (via `needs:`) skipping the
  Edge Function redeploy — i.e. "the AI agents stopped updating." Red since PR #1147; last green prod
  deploy was PR #1145.
- **Repo-side fix:** an operator-dispatched `repair-prod-drift` step was added to
  `.github/workflows/schema-reproducibility-fix.yml` (branch `fix/prod-migration-drift-board-score`).
  Option (A) migration-history **REPAIR** (`migration repair --status reverted`) chosen — metadata-only,
  nothing dropped (no DROP approval needed), RLS intact (P8); the idempotent board-score baseline
  re-applies safely.
- **BLOCKED — awaits operator authorization:** the architect has no prod creds. The prod repair awaits
  an operator dispatching:
  ```
  gh workflow run schema-reproducibility-fix.yml \
    --ref fix/prod-migration-drift-board-score \
    -f step=repair-prod-drift \
    -f repair_versions='20260628015107 20260628015237'
  ```
  Needs `production`-env secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.
  After repair, re-run `deploy-production.yml`.

## Gate results (this batch)
- type-check **PASS**
- lint **0 errors**

## Closing note — prod-deploy recovery (2026-06-29)

The production migration-drift incident is **RESOLVED**. The two board-score ghost ledger rows
(`20260628015107`, `20260628015237`) were reconciled **repo-side** — two no-op placeholder migrations
at the exact ghost version strings (per `docs/runbooks/migration-placeholders-audit.md`), merged via
**PR #1153** through normal authorized CI/CD. The operator-gated `repair-prod-drift` step (added by
**PR #1151** to `schema-reproducibility-fix.yml`) was correctly blocked by the safety classifier and
was **not needed**. Recovery shipped across **PRs #1151, #1152, #1153**. Verification:
`deploy-production.yml` run **28335566287** concluded SUCCESS (migrations ✅, Edge Functions ✅ —
AI agents deploying again, health ✅, verification ✅). **Both main CI and the production deploy are
green.** Full record: `workflows/_incidents/2026-06-28-prod-migration-drift.md` §0.

## Next workflow
**Payments & Subscriptions (P11)** — `PRIORITY-BACKLOG.md` rank 2 (unchanged).
