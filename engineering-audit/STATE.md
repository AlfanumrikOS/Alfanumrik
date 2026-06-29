# Audit Loop — Live State

> This file is the program counter for the continuous engineering-audit loop.
> **To resume:** read "Next action" below and continue from there.

| Field | Value |
|---|---|
| Program status | **ACTIVE** |
| Current cycle | **Cycle 4 — foxy-ai-rag DONE (P12 output backstop complete; FOX-4 user-gated, FOX-7 + streaming-residual + Hindi-tokens follow-ups)** |
| Current workflow | **foxy-ai-rag** (invariants **P12, P8, P13**) — **CYCLE 4 LANDED — auto-fix-safe complete** |
| Current phase | **ALL 8 PHASES WRITTEN** (MAP → … → REGRESSION); independent quality verdict **APPROVE**, P14 chain complete, sweep **GREEN** |
| Last session | **2026-06-29** |
| Next action | **Start Teacher / School-Admin B2B** — `PRIORITY-BACKLOG.md` rank 5 (invariants **P8, P9, P13**): run MAP → GAP → ROOT-CAUSE → DESIGN → IMPLEMENT for that workflow under `workflows/teacher-school-admin-b2b/`. **Also resume the gated items: FOX-4 (Foxy OpenAI provider governance — USER); the student-learning-core gated items (SLC-1 user-gated; SLC-4/5 cross-agent; SLC-8 cutover); + the payments + auth-onboarding open follow-ups** (see below) when their gates unblock. |
| Next workflow | **Teacher / School-Admin B2B** (rank 5) |

## How to resume

> Open this file, read **Next action**. Foxy AI Tutor & RAG Cycle 4 has landed (auto-fix-safe complete —
> the P12 "no unfiltered LLM output" output backstop now guards every student-facing exit of the live
> grounded path; FOX-4 OpenAI provider governance is USER-gated). The next vertical workflow is
> **Teacher / School-Admin B2B (P8, P9, P13)**; begin its MAP phase and write artifacts under
> `workflows/teacher-school-admin-b2b/`. Keep the Foxy FOX-4 gate + the student-learning-core gated items
> + the payments + auth-onboarding follow-ups visible.

## Current workflow detail — foxy-ai-rag (P12, P8, P13) — CYCLE 4 LANDED (auto-fix-safe complete)

- Scope: the end-to-end Foxy chat turn (`/api/foxy` → `callGroundedAnswer` → `grounded-answer` Deno RAG
  pipeline) + sibling AI Edge Functions (ncert-solver, quiz-generator, cme-engine). Governed by **P12** (AI
  safety), **P8** (RLS on RAG/vector reads), **P13** (no PII to LLM/traces).
- **Live-topology reconciliation (RECORDED):** the constitution's "`/api/foxy` … not yet wired to UI" note
  is **STALE** — `/api/foxy/route.ts` is the LIVE production route; the legacy `foxy-tutor` Edge Function no
  longer exists on disk; `grounded-answer` is the LLM pipeline. Correct on the next constitution
  reconciliation. See `workflows/foxy-ai-rag/01-map.md` §0.
- Artifacts: `workflows/foxy-ai-rag/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- Landed (APPROVED, auto-fix-safe; **no model/provider/prompt-scope change**): **FOX-1** (HIGH, P12 — added
  `screenStudentFacingText` (`src/lib/ai/validation/output-screen.ts`) + byte-identical Deno twin
  (`supabase/functions/grounded-answer/output-screen.ts`); deterministic word-boundary `HARD_BLOCK_PATTERNS`
  that EXCLUDE curriculum collisions; legacy `validateOutput` runs WARN-only; fail-safe; wired into EVERY
  student-facing exit — non-streaming `route.ts`, streaming `_lib/streaming.ts`, Deno `pipeline-stream.ts` →
  REG-182), **FOX-1 refinement** (CS-curriculum exemption — bare `<system>`/`[inst]` PASS, real chat
  templates BLOCK), **FOX-2** (MED — `neutralizeInjectionAttempt` (`src/lib/ai/validation/input-guard.ts`),
  fail-open → REG-183), **FOX-3** (LOW, assessment-approved — widened `VALID_MODES` doubt/homework/explorer;
  safety rails template-independent), **FOX-6** (P13 — prompt-assembly contract test, only scope+UUID).
- Gates: type-check **PASS**, lint **0 errors**, test **305/305 vitest + 3/3 Deno PASS**, build **PASS**,
  bundle within **P10** caps. Quality verdict **APPROVE**; regression sweep **GREEN**; catalog 148 → **150**
  (REG-182/183); existing P12 REG-37/39/50/54/66/67 still green.
- P14 review chain (AI tutor behavior) **COMPLETE**: ai-engineer (impl) → assessment (CBSE-scope /
  age-appropriateness correctness: **APPROVE WITH CONDITIONS**, conditions addressed) + testing (coverage
  GREEN) + quality (independent **APPROVE**).
- **Open gated / follow-up items (resume these):**
  1. **FOX-4 (Medium, GATED — USER APPROVAL):** OpenAI gpt-4o-mini/gpt-4o is present in `grounded-answer` as
     a **MoL SHADOW comparison** (telemetry only; does NOT reach students today — the student-facing answer
     is always the screened Claude output). Provider PRESENCE is user-gated per the constitution. CEO to
     formally approve & govern the shadow usage, or remove it.
  2. **FOX-7 (NEW, MINOR follow-up — ai-engineer):** extend `screenStudentFacingText` to the legacy fallback
     persist path (`_lib/legacy-flow.ts` / `persistLegacyFoxyResponse`). Reachable on `ff_grounded_ai_foxy`-OFF
     / grounded-abstain fallback; currently retains the OLDER substring `validateOutput` guard — consistency
     upgrade, **not an unfiltered hole**.
  3. **Streaming live-view residual (MINOR):** upstream deltas reach the browser before the completion screen;
     persisted record + final frame + every non-streamed consumer always safe; gated by `ff_foxy_streaming`.
     Frontend full-closure (`onAbstain` also clears `structured`) flagged — touches the REG-50-pinned transform.
  4. **Bilingual Hindi profanity-token coverage (MINOR, tracked):** `HARD_BLOCK_PATTERNS` English-oriented;
     bounded (acts on model OUTPUT, not student input).
- See `workflows/foxy-ai-rag/STATUS.md` + `cycles/2026-06-29-foxy-ai-rag.md`.

## Current workflow detail — student-learning-core (P1-P6, P12) — CYCLE 3 LANDED (auto-fix-safe complete)

- Scope: quiz setup → assembly + server-shuffle authority → answering/timing → client+server anti-cheat →
  submit dispatch → server scoring + atomic XP/profile write → results display → progress propagation.
  Governed by invariants **P1** (score), **P2** (XP), **P3** (anti-cheat), **P4** (atomic), **P5** (grade
  string), **P6** (question quality); P12 (AI safety) adjacent.
- Artifacts: `workflows/student-learning-core/01-map.md` … `08-regression.md` + `STATUS.md` (all written).
- Landed (APPROVED, auto-fix-safe): **SLC-7** (frontend — wired the dead P6 `isValidQuestion` validator
  into `startQuiz`; `mcqIds` + `displayQuestions` + submitted set all derive from ONE filtered set so
  P1/P4 served-count consistency is preserved; zero-valid → bilingual error; PII-free drop warn),
  **SLC-2** (testing — `xp-sql-literal-parity.test.ts`, P2 earning literals 10/20/50 SQL↔TS across every
  root migration; closes the REG-48 cap-only gap → **REG-181**), **SLC-3** (testing —
  `score-formula-three-way-parity.test.ts`, P1 formula identical across scoring.ts + SQL v1/v2 +
  consume-not-recompute → **REG-180**), **SLC-6** (testing — `quiz-pattern-flag-intended-behavior.test.ts`,
  pins the intended P3 pattern=FLAG / speed+count=REJECT asymmetry; brace-robustness fix), **SLC-8 pin**
  (testing — `quiz-submit-idempotency-contract-pin.test.ts`, current keyless-submit + `reference_id`
  no-double-XP, honest FIXME for the pre-cutover duplicate-row gap).
- Gates: type-check **PASS**, lint **0 errors**, test **40/40 new + ~1678 broad quiz/xp/scoring PASS**,
  build **PASS**, bundle within **P10** caps. Quality verdict **APPROVE** (one MINOR brace nit fixed);
  regression sweep **GREEN**; REG-45/48/51/53 still green; catalog 146 → **148** (REG-180/181).
- P14 review chain (Student Learning Core) **COMPLETE**: assessment (audit) → frontend (impl) + testing
  (coverage GREEN) + quality (independent APPROVE).
- **Open gated / cross-agent items (resume these):**
  1. **SLC-1 (High, GATED — USER APPROVAL)** — legacy `quiz_sessions` AFTER-completion trigger re-awards
     XP (10/20/50) with **no daily cap**, deduped from the RPC only by a fragile 5-second wall-clock window
     — a second uncapped XP writer. DB trigger + P2 economy change. Needs **architect + assessment** joint
     design to consolidate to one capped writer. Do NOT change the cap (200) or the earning literals.
  2. **SLC-4 (Medium, GATED)** — two daily-cap implementations (7-arg IST ledger vs JSONB 6-arg
     `CURRENT_DATE` fallback) + a `score`-vs-`xp_earned` column mismatch. **architect / backend** alignment.
  3. **SLC-5 (Medium, cross-agent)** — server "rejects" flagged submissions by zeroing XP but still records
     the session/counters (vs client true-reject); pollutes mastery analytics; reachable by direct/mobile
     callers. **assessment** defines canonical reject-semantics → **backend** implements.
  4. **SLC-8 cutover (backend / architect)** — flip `ff_server_only_quiz_submit` so all submits route
     through the idempotency-keyed `/api/quiz/submit`. The SLC-8 pin protects the interim state.
  5. **SLC-9 (Low-Med, testing backlog)** — xp-rules branch + cognitive-engine coverage below aspirational
     target. Non-blocking ratchet.
- See `workflows/student-learning-core/STATUS.md` + `cycles/2026-06-29-student-learning-core.md`.

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
| 3 | student-learning-core (P1-P6,P12) | ALL 8 PHASES | **LANDED — auto-fix-safe complete** | SLC-7 (frontend) + SLC-2/3/6/8-pin (testing) landed + APPROVED (type-check PASS, lint 0, 40/40 new + ~1678 broad tests PASS, build PASS, bundle within P10 caps; quality APPROVE; sweep GREEN); REG-180/181 filed (catalog 146 → 148); SLC-1 USER-GATED, SLC-4/5 + SLC-8 cutover gated/cross-agent, SLC-9 backlog; see `workflows/student-learning-core/STATUS.md` + `cycles/2026-06-29-student-learning-core.md` |
| 4 | foxy-ai-rag (P12,P8,P13) | ALL 8 PHASES | **LANDED — auto-fix-safe complete** | FOX-1 (+ Deno twin + injection-pattern refinement) + FOX-2 + FOX-3 + FOX-6 landed + APPROVED (type-check PASS, lint 0, 305/305 vitest + 3/3 Deno PASS, build PASS, bundle within P10 caps; assessment APPROVE WITH CONDITIONS [addressed] + quality APPROVE; sweep GREEN); REG-182/183 filed (catalog 148 → 150); FOX-4 USER-GATED (OpenAI provider governance — MoL shadow, not student-facing), FOX-7-new + streaming-residual + Hindi-tokens follow-ups; live-topology reconciliation recorded (`/api/foxy` is LIVE, `foxy-tutor` Edge Fn gone); see `workflows/foxy-ai-rag/STATUS.md` + `cycles/2026-06-29-foxy-ai-rag.md` |
| 5 | teacher-school-admin-b2b (P8,P9,P13) | — | NOT STARTED | next workflow (rank 5) |

## Backlog pointer

Now active: **Teacher / School-Admin B2B (P8, P9, P13)** — `PRIORITY-BACKLOG.md` rank 5. Promote it to IN
PROGRESS in the backlog when its first phase begins. (Rank 4 Foxy AI Tutor & RAG is DONE — auto-fix-safe
complete; FOX-4 user-gated provider governance, FOX-7-new + streaming-residual + Hindi-tokens follow-ups.)
