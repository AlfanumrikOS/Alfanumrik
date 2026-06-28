# Audit Loop — Live State

> This file is the program counter for the continuous engineering-audit loop.
> **To resume:** read "Next action" below and continue from there.

| Field | Value |
|---|---|
| Program status | **ACTIVE** |
| Current cycle | **Cycle 1 — auth-onboarding DONE (partial; follow-ups open)** |
| Current workflow | **auth-onboarding** (invariant **P15**) — **CYCLE 1 LANDED — partial** |
| Current phase | **ALL 8 PHASES WRITTEN** (MAP → … → REGRESSION); validation verdict **APPROVE**, sweep **GREEN** |
| Last session | **2026-06-28** |
| Next action | **Start Payments & Subscriptions (P11)** — `PRIORITY-BACKLOG.md` rank 2: run MAP → GAP → ROOT-CAUSE → DESIGN → IMPLEMENT for that workflow. **Also resume the auth-onboarding open follow-ups** (see below) when their gates unblock. |
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
  `test.fixme`-gated), **AO-9** (transitive via AO-4). Gates: type-check/lint/build PASS; test 940/940;
  Deno 10/10.
- **Open follow-ups (resume these):**
  1. **AO-3 (GATED)** — institution_admin provisioning unification; needs **USER APPROVAL** + architect design.
  2. **AO-5 (GATED)** — "Grade 9" → "9" P5 normalization; needs assessment/P5 sign-off + reader grep.
  3. **AO-2 CI un-gating** — ops to seed 3 per-role staging fixtures + secrets.
  4. **AO-1 CI enforcement** — architect to wire `always-200.test.ts` into `ci.yml` Deno lane.
  5. **REG-177** — testing to file `send_auth_email_always_200` (P15) in `.claude/regression-catalog.md`.
  6. **AO-6 / AO-7** — backlog (parent phone dropped; `.single()` noise).
- Mandatory review chain (per `.claude/skills/review-chains/SKILL.md`):
  architect → backend, frontend, testing (E2E for all 3 roles).

## Cycle log

| Cycle | Workflow | Phase reached | Status | Notes |
|---|---|---|---|---|
| 1 | auth-onboarding (P15) | ALL 8 PHASES | **LANDED — partial** | AO-4/8/1/2/9 landed + APPROVED; AO-3/5 gated, AO-2 CI seeding + REG-177 + Deno CI-lane open; see `workflows/auth-onboarding/STATUS.md` |
| 2 | payments-subscriptions (P11) | — | NOT STARTED | next workflow (rank 2) |

## Backlog pointer

Now active: **Payments & Subscriptions (P11)** — `PRIORITY-BACKLOG.md` rank 2. Promote it to IN PROGRESS
in the backlog when its first phase begins.
