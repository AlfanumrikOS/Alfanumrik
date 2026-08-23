---
name: alfanumrik-architecture
description: Cross-cutting architecture, new services, major features, refactors, shared data models, and platform boundaries. Use for anything spanning more than one domain, any new table/service/console, or any question about who owns a given piece of the system.
user-invocable: false
---

# Skill: Alfanumrik Architecture

Alfanumrik is an **Adaptive Learning OS and school intelligence platform** — not an ERP, not a generic LMS, not a fee/transport/billing system. Fee billing and transport are explicitly outside the current product scope; do not let a task pull them in because "schools need it eventually."

## Index: the real architecture corpus

`docs/architecture/` is the evidence-based architecture record for this repo (not referenced elsewhere in CLAUDE.md — treat it as authoritative here). Read the specific document you need rather than re-deriving its content:

| Document | What it's for |
|---|---|
| `docs/architecture/README.md` | Conventions for the whole corpus — read this first; explains why every claim must be traceable to a real artifact |
| `docs/architecture/DOMAIN_BOUNDARIES.md` | The bounded-module map (which context owns which behavior) |
| `docs/architecture/DATA_OWNERSHIP_MATRIX.md` | Per-table single-write-owner + reader list — the source of truth for "who may write this table" |
| `docs/architecture/EXCEPTIONS.md` | Every deliberate, time-bound architectural deviation, with a sunset condition. Check here before assuming a duplication you found is unintentional drift — it may already be a tracked, dated exception |
| `docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md` | The target-state service-extraction roadmap |
| `docs/architecture/CURRENT_ARCHITECTURE_AUDIT.md`, `RISK_REGISTER.md`, `MIGRATION_AND_ROLLBACK_PLAN.md`, `API_CONTRACTS_MATRIX.md`, `EVENT_CATALOG.md` | Current-state audit, tracked risks, migration/rollback planning, API contract inventory, event bus catalogue |
| `docs/architecture/ADR-001-learner-loop-unification.md`, `ADR-004-adaptive-tutor.md`, `ADR-005-concept-first-adaptive-learning-spine.md` | Accepted architecture decisions for the learner-loop/adaptive-tutor spine — these are **target-state** decisions; see below on how to read them against current code |

## Current state vs. target state — do not conflate them

An ADR or a target-state document describes what the architecture is *supposed to become*. Current code, migrations, and tests show what is *actually implemented today*. When they disagree:
- **Report the gap.** Say plainly "ADR-005 requires X; the current route at `path` does Y instead" (see `docs/architecture/EXCEPTIONS.md` for how known, deliberate gaps like this are supposed to be tracked, with an owner and a sunset condition).
- **Do not silently pick one.** Do not "fix" the code to match the ADR as a drive-by, and do not rewrite the ADR to match the code, without an explicit decision from the owning agent/user.
- **Do not present a planned capability as already implemented**, in this skill or in any report that cites it.
- Temporary audit documents (dated one-off reports under `docs/audits/`) are **evidence for a point in time**, not permanent policy -- cite them as such, never as the architecture itself.

## One owner per domain — the standing rule

Every table, console, service, and privilege model has exactly one write owner. Before adding a new one, check `docs/architecture/DATA_OWNERSHIP_MATRIX.md` for an existing owner of the same concept. **Do not create a second roster, a second admin console, a second privilege model, or a parallel table for a concept that already has an owner** — this is the single most common architectural failure mode in this repo's history (see `EXCEPTIONS.md` E4, E9, and the roster split-brain documented in full in `alfanumrik-identity-rbac`). If you find yourself about to add a table that looks like it duplicates an existing one, stop and check ownership first, not after.

**"On-disk" is not "deployed."** Verify what's actually running (`supabase functions list`, live query) before asserting deployment state — this repo has been burned by exactly this assumption more than once (an archived-looking Edge Function was in fact live in production).

## Provider neutrality behind typed contracts

AI-provider integrations stay behind the typed gateway contract at `packages/lib/src/ai/gateway/` (adapters per provider, a shared `types.ts`/`registry.ts`/`router.ts`). A new model or provider is a new adapter behind that gateway, never a bespoke direct call to a provider API from application code — this is already implemented, not aspirational; extend it, don't bypass it. See `ai-integration` for the AI-specific detail.

## What this skill defers, deliberately

- **Supabase/RLS/migration mechanics** — templates, migration structure, SECURITY DEFINER review: `supabase-patterns`.
- **Identity, RBAC, tenancy, roster detail** (including the live `class_students`/`class_enrollments` split-brain): `alfanumrik-identity-rbac`.
- **AI provider/pedagogy/RAG detail**: `ai-integration` (+ its two references).
- **Student-data safety policy**: `alfanumrik-student-safety`.
- **Student-facing IA/frontend detail**: `student-frontend` (+ `student-dashboard-design` for `/dashboard`).

This skill's job is the cross-cutting question — which domain owns this, does a new feature need a new boundary, is this duplicating an existing source of truth — not the implementation detail any one domain already owns elsewhere.

## New feature checklist

1. Identify which domain(s)/role(s) this touches — check `DOMAIN_BOUNDARIES.md` and `DATA_OWNERSHIP_MATRIX.md` first.
2. If it needs a new table: confirm no existing table already owns this concept; write RLS in the same migration (`supabase-patterns`).
3. If it needs a new permission/role: check `alfanumrik-identity-rbac` for the existing tier ladders before adding a new one.
4. If it's AI-powered: route through the existing gateway (`ai-integration`), not a new direct provider call.
5. If it's learner-facing: assessment defines the business rule before frontend builds the UI.
6. If it touches student data: `alfanumrik-student-safety` reviews consent/retention/PII exposure.
7. Write tests; run the release-gate sequence (`release-gates`) before push.

## Do not

- Quote a migration count, table count, function count, page count, or route count from memory or from this file — re-derive it with a command (`git ls-files supabase/migrations | wc -l`, `supabase functions list`, etc.) if you genuinely need it, and expect it to be different from any number you remember.
- Reintroduce an agent role name that is not in the current roster, or any pre-monorepo `src/...` path -- the current roster is architect/frontend/backend/assessment/ai-engineer/mobile/testing/quality/ops/orchestrator, and the monorepo layout is `apps/host/src/*` + `packages/lib/src/*` + `packages/ui/src/*`.
- Frame a superseded AI Edge Function as the live AI tutoring path -- verify what is canonical (see `ai-integration`) before describing any AI surface as current.

## Review chain

Making agent: architect. Required reviewers: quality (always); the owning domain agent for whatever the feature touches; user approval for anything that would create a second source of truth, drop a table/column, or change the agent system itself.
