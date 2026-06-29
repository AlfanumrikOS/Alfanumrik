# Audit Loop — Live State

> This file is the program counter for the continuous engineering-audit loop.
> **To resume:** read "Next action" below and continue from there.

| Field | Value |
|---|---|
| Program status | **ACTIVE** |
| Current cycle | **Cycle 2 — payments-subscriptions DONE (auto-fix-safe complete; PAY-2 gated, follow-ups open)** |
| Current workflow | **payments-subscriptions** (invariant **P11**) — **CYCLE 2 LANDED — auto-fix-safe complete** |
| Current phase | **ALL 8 PHASES WRITTEN** (MAP → … → REGRESSION); validation verdict **APPROVE**, architect security **APPROVE**, sweep **GREEN** |
| Last session | **2026-06-29** |
| Next action | **Start Student Learning Core (Quiz / Scoring / XP)** — `PRIORITY-BACKLOG.md` rank 3 (invariants **P1, P2, P3, P4, P5, P6, P12**): run MAP → GAP → ROOT-CAUSE → DESIGN → IMPLEMENT for that workflow under `workflows/student-learning-core/`. **Also resume the payments + auth-onboarding open follow-ups** (see below) when their gates unblock. |
| Next workflow | **Student Learning Core (Quiz / Scoring / XP)** (rank 3) |

## How to resume

> Open this file, read **Next action**. Payments & Subscriptions Cycle 2 has landed (auto-fix-safe
> complete — see open follow-ups; PAY-2 user-gated). The next vertical workflow is **Student Learning
> Core (Quiz / Scoring / XP) (P1-P6, P12)**; begin its MAP phase and write artifacts under
> `workflows/student-learning-core/`. Keep the payments + auth-onboarding follow-ups visible.

## Current workflow detail — payments-subscriptions (P11) — CYCLE 2 LANDED (auto-fix-safe complete)

- Scope: Razorpay checkout → webhook signature verification → atomic subscription activation →
  reconcile/expired/pre-debit crons → dedupe/idempotency. Governed by invariant **P11** (P9/P13 cross-checks).
- Artifacts: `workflows/payments-subscriptions/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- Landed (APPROVED, auto-fix-safe): **PAY-1** (`subscribe` RBAC gate, 403 before any Razorpay object),
  **PAY-8** (409 when no student row resolves), **PAY-3** (reconcile via atomic
  `atomic_subscription_activation_locked` RPC — no more split-brain), **PAY-7** (missing webhook secret →
  503 retryable; invalid signature unchanged hard-4xx), **PAY-5** (observable dedupe degradation),
  **PAY-4** (architect — `payments-health` registered as 13th Vercel cron `*/10 * * * *`), **PAY-6**
  (testing — verify-HMAC-reject test + extend RBAC pin to `subscribe`).
- Gates: type-check **PASS**, lint **0 errors**, test **236/236** payment suite, build **PASS**,
  `vercel.json` **VALID**. Quality **APPROVE** + architect security **APPROVE**; regression sweep **GREEN**.
- P14 review chain (payment flow) **COMPLETE**: backend (made) → architect (security APPROVE) + testing
  (coverage GREEN) + mobile (downstream review) + frontend (checkout 403/409 SAFE-AS-IS).
- **Open follow-ups (resume these):**
  1. **PAY-2 (Medium, GATED — USER APPROVAL)** — `create-order` hardcoded `PRICING` can diverge from DB
     `subscription_plans`. DEAD on the live web path (web uses `subscribe`); LIVE-referenced only by the
     mobile app, whose flow is already documented-broken. **Do NOT delete unilaterally** (mobile contract
     names it); any pricing-amount change is **user-gated**.
  2. **Mobile repoint** — mobile to repoint `create-order` → `subscribe`, unwrap nested `data`, add 409
     mapping (mobile + backend coordination).
  3. **`docs/product/mobile-web-sync.md` doc fix** — stale; says `create-order` route doesn't exist (it
     exists but is dead on the web path).
  4. **Super-admin stuck-payments display (cosmetic)** — read period from
     `student_subscriptions.current_period_end` since reconcile no longer writes `students.subscription_expiry`.
  5. **REG-178 / REG-179 filing** — testing to file `verify_route_hmac_reject` (P11) and
     `subscribe_rbac_gate_pre_razorpay` (P9/P11) into `.claude/regression-catalog.md` (confirm ids with
     orchestrator if they shift). Catalog 144 → 146 once filed.
  6. **PAY-9 (Low, optional)** — `razorpay_signature` persisted at rest in `payment_history` (verify path).
- See `workflows/payments-subscriptions/STATUS.md` + `cycles/2026-06-29-payments-subscriptions.md`.

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
  6. **RESOLVED — production migration-drift repair** — fixed via **repo-side reconciliation**
     (two no-op placeholder migrations at the ghost version strings `20260628015107` /
     `20260628015237`, per `docs/runbooks/migration-placeholders-audit.md`), merged via **PR #1153**
     through normal authorized CI/CD. The operator-gated `repair-prod-drift` dispatch was correctly
     blocked by the safety classifier and **not needed**. Verification: `deploy-production.yml` run
     **28335566287** SUCCESS — migrations ✅, Edge Functions ✅ (AI agents deploying again), health ✅,
     verification ✅. See `workflows/_incidents/2026-06-28-prod-migration-drift.md` §0.
  7. **AO-6** — backlog (parent phone dropped at signup).
- Mandatory review chain (per `.claude/skills/review-chains/SKILL.md`):
  architect → backend, frontend, testing (E2E for all 3 roles).

## Cycle log

| Cycle | Workflow | Phase reached | Status | Notes |
|---|---|---|---|---|
| 1 | auth-onboarding (P15) | ALL 8 PHASES | **LANDED — partial** | AO-4/8/1/2 + follow-up batch AO-5/7/9 (2026-06-29) landed + APPROVED; AO-3 gated, AO-2 CI fixtures + REG-177 + Deno CI-lane open; NEW AO-10 grade-coercion/backfill; prod migration-drift incident RESOLVED (repo-side reconciliation, PR #1153, deploy 28335566287 green); see `workflows/auth-onboarding/STATUS.md` + `cycles/2026-06-29-auth-onboarding-followups.md` |
| 2 | payments-subscriptions (P11) | ALL 8 PHASES | **LANDED — auto-fix-safe complete** | PAY-1/3/4/5/6/7/8 landed + APPROVED (type-check PASS, lint 0, 236/236 payment tests, build PASS, vercel.json VALID; architect security APPROVE; sweep GREEN); REG-178/179 filing in flight; PAY-2 gated to USER (pricing); mobile-repoint + mobile-web-sync.md doc fix + super-admin display open; see `workflows/payments-subscriptions/STATUS.md` + `cycles/2026-06-29-payments-subscriptions.md` |
| 3 | student-learning-core (P1-P6,P12) | — | NOT STARTED | next workflow (rank 3) |

## Backlog pointer

Now active: **Student Learning Core (Quiz / Scoring / XP) (P1-P6, P12)** — `PRIORITY-BACKLOG.md` rank 3.
Promote it to IN PROGRESS in the backlog when its first phase begins. (Rank 2 Payments & Subscriptions is
DONE — auto-fix-safe complete; PAY-2 gated to user.)
