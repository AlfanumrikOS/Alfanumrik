# Cycle Log — 2026-06-29 — Student Learning Core (Quiz / Scoring / XP) (P1-P6, P12)

> Dated summary of Cycle 3, the third workflow of the engineering-audit program.
> Authoritative ledger lives under `workflows/student-learning-core/` (01-map … 08-regression + STATUS.md).

## Workflow
- **Cycle:** 3
- **Workflow:** student-learning-core
- **Primary invariants:** P1 (score accuracy), P2 (XP economy), P3 (anti-cheat), P4 (atomic submission),
  P5 (grade format), P6 (question quality); P12 (AI safety) workflow-adjacent
- **Status:** **CYCLE 3 LANDED — auto-fix-safe complete; SLC-1/4/5 + SLC-8-cutover gated/cross-agent**

## Agents involved
- **assessment** — workflow lead + auditor: MAP → GAP → ROOT-CAUSE (01-03); defined the auto-fix-safe vs
  gated split; signs off that no P1/P2/P3 value changed.
- **frontend** — SLC-7: wired the dead P6 `isValidQuestion` validator into `startQuiz` with served-count
  consistency preserved.
- **testing** — SLC-2, SLC-3, SLC-6, SLC-8-pin (4 new test files); regression sweep (40/40 new + ~1678
  broad GREEN); filed REG-180 / REG-181.
- **quality** — independent validation (did not implement); verdict APPROVE; flagged the one MINOR brace
  nit (now fixed).
- **ops (this doc)** — ledger finalization.

## Gaps found (SLC-1 … SLC-10) and dispositions
| ID | Title | Severity | Owner | Disposition |
|---|---|---|---|---|
| SLC-1 | Second uncapped XP writer — `quiz_sessions` AFTER-completion trigger re-awards 10/20/50 with no cap, 5s-window dedup | **High** | architect + assessment | **GATED — USER APPROVAL** (DB trigger + P2 economy); consolidate to one capped writer |
| SLC-2 | P2 XP earning literals (10/20/50) duplicated across ~9 SQL bodies (drift risk) | High | testing | **LANDED** — `xp-sql-literal-parity.test.ts`; closes the REG-48 cap-only gap → **REG-181** |
| SLC-3 | No mechanical P1 three-way score-formula parity guard | Medium | testing | **LANDED** — `score-formula-three-way-parity.test.ts` → **REG-180** |
| SLC-4 | Two daily-cap implementations (IST ledger vs CURRENT_DATE fallback) + `score`/`xp_earned` column mismatch | Medium | architect / backend | **GATED** — schema/behavior alignment; cap value (200) unchanged |
| SLC-5 | Server records flagged submissions (XP=0) vs client true-reject; pollutes mastery analytics | Medium | assessment → backend | **GATED — cross-agent** — needs canonical reject-semantics definition |
| SLC-6 | Pattern check (P3 #2) FLAG-only by design — asymmetry unpinned | Low (info) | testing | **LANDED** — `quiz-pattern-flag-intended-behavior.test.ts`; pins client+server; balanced-brace robustness fix |
| SLC-7 | P6 `isValidQuestion` gate defined but not invoked in serve path | Medium | frontend | **LANDED** — wired into `startQuiz`; P1/P4 served-count consistency preserved (quality-verified) |
| SLC-8 | Live web client bypasses idempotency-keyed `/api/quiz/submit` (double-submit risk) | Medium | testing (pin) / backend+architect (cutover) | **PIN LANDED** — `quiz-submit-idempotency-contract-pin.test.ts` (honest FIXME); **cutover GATED** (flip `ff_server_only_quiz_submit`) |
| SLC-9 | Coverage below aspirational target (xp-rules branches, cognitive-engine) | Low-Med | testing | **DEFERRED** — documented ratchet backlog |
| SLC-10 | `submit_quiz_results_v2` redefined across 6 post-baseline migrations | Low (info) | testing | **NOTED** — parity guards target the latest migration body, not just the baseline |

## What landed vs gated
- **Landed + APPROVED (auto-fix-safe):** SLC-7 (frontend), SLC-2, SLC-3, SLC-6, SLC-8-pin (testing).
- **Gated (USER APPROVAL required):** SLC-1 (DB trigger + P2 economy → consolidate to one capped writer).
- **Gated / cross-agent:** SLC-4 (architect/backend), SLC-5 (assessment→backend), SLC-8 cutover
  (backend/architect, flip `ff_server_only_quiz_submit`).
- **Deferred / informational:** SLC-9 (coverage ratchet), SLC-10 (v2 redefinition churn).

## Files touched (code/test — by builders, outside this doc-only finalization)
- `src/app/quiz/page.tsx` (SLC-7 — wire P6 `isValidQuestion` into `startQuiz`)
- `xp-sql-literal-parity.test.ts` (SLC-2 → REG-181)
- `score-formula-three-way-parity.test.ts` (SLC-3 → REG-180)
- `quiz-pattern-flag-intended-behavior.test.ts` (SLC-6, + brace-robustness fix)
- `quiz-submit-idempotency-contract-pin.test.ts` (SLC-8 pin)

## Gate results (independent validation, verified not trusted)
- type-check **PASS**; lint **0 errors**
- test **40/40 new + ~1678 broad quiz/xp/scoring tests PASS**
- build **PASS**; bundle within **P10** caps
- quality verdict **APPROVE** (one MINOR brace nit fixed); regression sweep **GREEN**

## P14 review chain (Student Learning Core) — COMPLETE
assessment (audit/definition) → frontend (impl) + testing (coverage GREEN) + quality (independent APPROVE).
(The gated SLC-1/4/5 + SLC-8 cutover open their own architect + assessment + backend chains when scheduled.)

## Regression catalog
- **REG-180** (`score_formula_three_way_parity`, P1) — identical `ROUND/Math.round((correct/total)*100)`
  across `scoring.ts` + SQL v1/v2 + `QuizResults` consume-not-recompute + Math.round/PG-ROUND property.
- **REG-181** (`xp_sql_literal_parity`, P2) — 10/20/50 earning literals SQL↔TS across every root migration
  (closes the REG-48 cap-only gap).
- Catalog 146 → **148**. Existing learner-core entries **REG-45 / REG-48 / REG-51 / REG-53 remain green**.
  (Authoritative: `.claude/regression-catalog.md`.)

## Open follow-ups carried to STATE.md
SLC-1 (user approval — uncapped trigger consolidation; architect + assessment), SLC-4 (dual cap alignment;
architect/backend), SLC-5 (canonical reject-semantics; assessment → backend), SLC-8 cutover (flip
`ff_server_only_quiz_submit`; backend/architect), SLC-9 (coverage ratchet; testing).

## Next workflow
**Foxy AI Tutor & RAG** — `PRIORITY-BACKLOG.md` rank 4 (invariants P12, P8): age-appropriateness,
CBSE-scope lock, daily limits, NCERT-grounded retrieval, no PII to LLM. Owner squad: ai-engineer (lead) +
assessment.
