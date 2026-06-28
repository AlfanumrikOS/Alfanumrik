# Audit Loop — Live State

> This file is the program counter for the continuous engineering-audit loop.
> **To resume:** read "Next action" below and continue from there.

| Field | Value |
|---|---|
| Program status | **ACTIVE** |
| Current cycle | **Cycle 1 — auth-onboarding DONE (partial; follow-ups open)** |
| Current workflow | **auth-onboarding** (invariant **P15**) — **CYCLE 1 LANDED — partial** |
| Current phase | **ALL 8 PHASES WRITTEN** (MAP → … → REGRESSION); validation verdict **APPROVE**, sweep **GREEN** |
| Last session | **2026-06-29** |
| Next action | **Start Payments & Subscriptions (P11)** — `PRIORITY-BACKLOG.md` rank 2: run MAP → GAP → ROOT-CAUSE → DESIGN → IMPLEMENT for that workflow. **Also resume the auth-onboarding open follow-ups** (see below) when their gates unblock; **and the BLOCKED prod migration-drift repair awaits user authorization to dispatch `schema-reproducibility-fix.yml step=repair-prod-drift`.** |
| Next workflow | **Payments & Subscriptions (P11)** (rank 2) |

## How to resume

> Open this file, read **Next action**. Auth-onboarding Cycle 1 has landed (partial — see open
> follow-ups). The next vertical workflow is **Payments & Subscriptions (P11)**; begin its MAP phase and
> write artifacts under `workflows/payments-subscriptions/`. Keep the auth-onboarding follow-ups visible.

## Current workflow detail — auth-onboarding (P15) — CYCLE 1 LANDED (partial)

- Scope: signup → email verification → profile creation → role onboarding → dashboard,
  for all three roles (student / teacher / parent). Governed by invariant **P15**.
- Artifacts: `workflows/auth-onboarding/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- Landed (APPROVED): **AO-4** (bootstrap honours RPC logical-failure → 500, P15 layer-3 fallback engages),
  **AO-8** (auth-form a11y), **AO-1** (executable always-200 Deno test), **AO-2** (honest 3-role E2E,
  `test.fixme`-gated). Gates: type-check/lint/build PASS; test 940/940; Deno 10/10.
- **Cycle-1 follow-ups LANDED 2026-06-29** (type-check PASS, lint 0 errors — see
  `cycles/2026-06-29-auth-onboarding-followups.md`):
  - **AO-5 (assessment, FIXED)** — `src/app/onboarding/page.tsx` stores canonical "9" not "Grade 9" (P5); APPROVE.
  - **AO-7 (backend, FIXED)** — `src/lib/identity/onboarding.ts` `resolveIdentity()` 4× `.single()` → `.maybeSingle()`.
  - **AO-9 (frontend, FIXED)** — `src/lib/AuthContext.tsx` durable per-user once-guard on `signup_complete` (P13/P15 safe).
- **Open follow-ups (resume these):**
  1. **AO-3 (GATED)** — institution_admin provisioning unification; needs **USER APPROVAL** + architect design.
  2. **AO-2 CI fixtures (pending)** — ops/infra to seed 3 per-role staging fixtures + secrets.
  3. **AO-1 CI enforcement** — architect to wire `always-200.test.ts` into `ci.yml` Deno lane.
  4. **REG-177** — testing to file `send_auth_email_always_200` (P15) in `.claude/regression-catalog.md`.
  5. **AO-10 (NEW, grade-coercion / legacy backfill — co-owned assessment + architect)** —
     `src/lib/AuthContext.tsx` (~L423-424) sets `student` from the raw DB row WITHOUT grade coercion, so
     legacy "Grade N" rows still leak the prefixed form until backfilled; `normalize_grade` is misnamed
     (it ADDS the prefix). Needs one-time backfill + rename/read-time coercion.
  6. **BLOCKED — production migration-drift repair** — awaits **USER AUTHORIZATION** to dispatch
     `schema-reproducibility-fix.yml step=repair-prod-drift` (versions `20260628015107 20260628015237`).
     Prod deploys + Edge Function redeploys red since PR #1147. See
     `workflows/_incidents/2026-06-28-prod-migration-drift.md`.
  7. **AO-6** — backlog (parent phone dropped at signup).
- Mandatory review chain (per `.claude/skills/review-chains/SKILL.md`):
  architect → backend, frontend, testing (E2E for all 3 roles).

## Cycle log

| Cycle | Workflow | Phase reached | Status | Notes |
|---|---|---|---|---|
| 1 | auth-onboarding (P15) | ALL 8 PHASES | **LANDED — partial** | AO-4/8/1/2 + follow-up batch AO-5/7/9 (2026-06-29) landed + APPROVED; AO-3 gated, AO-2 CI fixtures + REG-177 + Deno CI-lane open; NEW AO-10 grade-coercion/backfill; prod migration-drift repair BLOCKED on user auth; see `workflows/auth-onboarding/STATUS.md` + `cycles/2026-06-29-auth-onboarding-followups.md` |
| 2 | payments-subscriptions (P11) | — | NOT STARTED | next workflow (rank 2) |

## Backlog pointer

Now active: **Payments & Subscriptions (P11)** — `PRIORITY-BACKLOG.md` rank 2. Promote it to IN PROGRESS
in the backlog when its first phase begins.
