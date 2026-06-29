# 07 — Independent Validation: Student Learning Core (Cycle 3)

> Phase: INDEPENDENT VALIDATION. A fresh quality agent (did NOT implement) verifies.

- **Cycle:** cycle-3
- **Workflow:** student-learning-core (P1, P2, P3, P4, P5, P6, P12)
- **Validator squad:** **quality** (independent of the builder squad)
- **Date:** 2026-06-29
- **Self-review reference:** `./06-self-review.md`

## Independence statement
The validating quality agent did **not** author any Cycle-3 change (SLC-7 frontend; SLC-2/3/6/8-pin
testing). It re-ran every gate from a clean state rather than trusting the builders' reported results, and
independently re-derived the P1/P4 served-count-consistency reasoning for SLC-7 from the changed lines of
`src/app/quiz/page.tsx`.

## Per-gap independent verdict

| Gap ID | Builder claim | Validator finding | Verdict |
|---|---|---|---|
| SLC-7 | `isValidQuestion` wired into `startQuiz`; `mcqIds` + `displayQuestions` + submitted set all derive from the SAME filtered array; zero-valid → bilingual error; PII-free drop warn | Confirmed all three artifacts derive from one filtered list → served-count consistency preserved; the server still snapshots + re-derives the score over exactly the served set; zero-valid path renders Hi/En error without opening a session; drop-log carries id + reason only | **PASS** |
| SLC-2 | new parity guard asserts 10/20/50 SQL↔TS across every root migration | Confirmed the test reads the live award expressions and anchors them to `XP_RULES`; closes the REG-48 earning-literal gap | **PASS** |
| SLC-3 | three-way score-formula parity (TS + SQL v1/v2 source-inspect + consume-not-recompute + Math.round/PG-ROUND property) | Confirmed all three computing sites are inspected, `QuizResults` consume-not-recompute is asserted, and the half-up/half-away equivalence holds across 0..100 | **PASS** |
| SLC-6 | pins pattern=FLAG, speed/count=REJECT on client + server; brace-robustness fix | Confirmed the asymmetry is locked both sides; the balanced-brace fix makes the matcher format-robust | **PASS** |
| SLC-8 (pin) | pins current keyless-submit + `reference_id` no-double-XP; honest FIXME for the duplicate-row gap | Confirmed the pin asserts current reality (no double XP on replay) and the FIXME honestly records the pre-cutover duplicate-session residual; does not overclaim a fix | **PASS** |

## Gate re-run (verified, not trusted)
- [x] **type-check** — **PASS**
- [x] **lint** — **PASS** (0 errors)
- [x] **test** — **PASS** — **40/40** new assertions + **~1678** broad quiz/xp/scoring tests
- [x] **build** — **PASS**
- [x] **bundle** — within **P10** caps (SLC-7 is a small pure-React change in an existing page; no new
  shared chunk; test-only files have no bundle impact)

## Invariant audit (P1–P15)

| Invariant | Relevant? | Upheld? | Evidence |
|---|---|---|---|
| P1 Score accuracy | yes | yes — strengthened | Formula untouched at all three sites; SLC-3 now guards identity; SLC-7 preserves served-count consistency so the server re-derives the score over exactly the snapshotted set |
| P2 XP economy | yes | yes — strengthened | No 10/20/50 literal or 200 cap changed; SLC-2 now guards the earning literals SQL↔TS |
| P3 Anti-cheat | yes | yes — pinned | 3s / >3 / count thresholds unchanged; SLC-6 pins the intended pattern=FLAG vs speed/count=REJECT asymmetry on both sides |
| P4 Atomic submission | yes | yes (unchanged) | Single in-transaction `atomic_quiz_profile_update` call untouched; count consistency keeps `responses.length === questions.length` |
| P5 Grade format | yes | yes (unchanged) | `student.grade` flows as a string; untouched |
| P6 Question quality | yes | yes — strengthened | Dead `isValidQuestion` gate now live at the render boundary; server snapshot guarantee unchanged |
| P7 Bilingual | yes | yes | SLC-7 zero-valid error state Hi/En via `AuthContext.isHi` |
| P12 AI safety | yes (workflow-adjacent) | yes (unchanged) | No AI Edge Function / prompt / RAG surface touched this cycle (Foxy/RAG is the separate Cycle-4 workflow) |
| P13 Data privacy | yes | yes | SLC-7 drop-log carries question id + reason only; no student identity/answers |
| P8 / P9 / P10 / P11 / P15 | no (this cycle) | n/a | No RLS / RBAC / payment / onboarding surface touched; bundle within caps |

## Minor non-blocking note (recorded verbatim — now fixed)
1. **Balanced-brace nit in the SLC-6 pattern matcher (MINOR).** The first cut of
   `quiz-pattern-flag-intended-behavior.test.ts` used a brace-naive source match that could be fooled by
   formatting. **Now fixed** — a balanced-brace robustness fix was applied so the assertion is
   format-robust. No other issues raised.

## Verdict
**APPROVE** — all five in-scope auto-fix-safe items (SLC-7 + SLC-2/3/6/8-pin) pass independent re-test;
all gates green (type-check PASS, lint 0 errors, 40/40 new + ~1678 broad tests PASS, build PASS, bundle
within P10 caps); no invariant regression; the single MINOR brace nit is fixed. P1/P4 served-count
consistency for SLC-7 independently re-derived and confirmed.

## Required fixes before COMPLETE (if REJECT)
None for the auto-fix-safe set. The workflow is not marked fully COMPLETE only because **SLC-1 / SLC-4 /
SLC-5** are gated/cross-agent and the **SLC-8 cutover** (flag flip) is pending — none of which are
validation failures; see `STATUS.md`.
