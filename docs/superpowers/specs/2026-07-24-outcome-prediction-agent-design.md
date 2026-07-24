# Spec: Outcome Prediction Agent (GenAI Phase 5a)

- **Date**: 2026-07-24
- **Owner**: assessment (owns prediction/progress correctness + the learner-state boundary)
- **Status**: SPEC + PURE composer only — NO API route, NO registry flip, NO tests, NO migration, NO flag in this slice.
- **Registry id**: `outcome_prediction` (one of the 7 GenAI agents; `decides: 'HOW'`, `mayWriteMastery: false`, capability `predict_outcome`).
- **Scope**: A typed `OutcomePrediction` contract + a PURE composer (`packages/lib/src/predict/outcome-prediction.ts`) that COMPOSES the platform's existing predictors into one unified, read-only projection. It introduces NO new prediction math, NO new thresholds, NO new confidence formula, and NO pass-mark constant.

---

## 0. Non-negotiable design stance

1. **COMPOSE, do not reinvent.** Every number is delegated to, or read verbatim from, an existing source of truth:
   - `predictExamScore(chapters, totalMarks)` — the core predictor (`{ predicted, confidence(0.3–0.95), breakdown }`).
   - `calculateBoardExamScore(correct, total, totalBoardMarks=80)` — the SOLE CBSE grade-band oracle (A1≥90 / A2≥80 / B1≥70 / B2≥60 / C1≥50 / D<50) AND the source of the D→C1 pass boundary and the default 80 board marks.
   - `PULSE_THRESHOLDS.at_risk_mastery` (0.4) — the single platform-wide at-risk line.
   - Precomputed rows `board_score_predictions` / `cme_exam_readiness` — read verbatim; NEVER recomputed.
2. **READ-ONLY projection.** This agent PREDICTS. It writes NOTHING — not mastery, not progression, not XP, and specifically **not** `board_score_predictions` / `cme_exam_readiness` (the cron/edge functions own those rows). `mayWriteMastery: false`.
3. **PURE composer.** `composeOutcomePrediction` has no I/O, no DB, no `Date.now`, no `throw`. It takes ALREADY-READ signals; the backend route (backend-owned, later) does the DB reads + auth and calls it.
4. **Zero new magic numbers.** No numeric literal acts as a threshold. The only literals present are domain bounds (0, 1, 100 for percent/probability scales) and the `/g` display regex. Confidence and bands are reused; the D-boundary and the 80-mark default are *derived* from the grade oracle.
5. **Bilingual-ready (P7).** Every human-readable field that has a Hindi source (gap `descriptionHi`, recovery `actionHi`) carries it through; the route/UI localizes the rest.

---

## 1. The `OutcomePrediction` type (semantics)

| Field | Type | Meaning / source |
|---|---|---|
| `subject` / `grade` | `string` / `string` | Passed through. **P5: grade is a STRING "6".."12".** |
| `source` | `PredictionSource` | Which fallback tier produced the range (see §3). |
| `sufficientData` | `boolean` | `false` only on the `insufficient_data` tier. |
| `passLikelihood` | `PassLikelihood` | Band + coverage-aware likelihood expressed **only** via existing CBSE bands (see §4). |
| `boardScoreRange` | `BoardScoreRange \| null` | `{ low, mid, high, lowMarks, midMarks, highMarks, totalMarks, grade, gradeLow, gradeHigh, confidenceBand:[low,high] }`. `grade*` from `calculateBoardExamScore`. `null` on insufficient data. |
| `weakConcepts` | `WeakConcept[]` | From memory `knowledgeGaps` + `weakTopics(<0.4)`, `cme.weakestChapters`, `board.recoveryPlan`. Weakest-first. |
| `atRiskSignals` | `{ signals: PulseSignals \| null; anyAtRisk: boolean }` | Pulse inactivity / mastery-cliff / at-risk-concentration passed through + a derived roll-up. |
| `interventionRecommendations` | `InterventionRecommendation[]` | **Deterministic**, derived from gaps + at-risk + weakest chapters. NO LLM (see §5). |
| `confidence` | `{ overall; perPrediction:{ boardScore; passLikelihood } }` | Reuses `predictExamScore`'s confidence / board coverage — NO new formula (see §6). |
| `rationale` | `RationaleDriver[]` | **Deterministic** structured drivers (top drivers, coverage, velocity, pulse), assembled from inputs — NOT LLM prose. |
| `learningVelocity` | `number \| null` | From `calculateLearningVelocity` (mastery pts/day), passed through. |

Full field list: `subject, grade, source, sufficientData, passLikelihood, boardScoreRange, weakConcepts, atRiskSignals, interventionRecommendations, confidence, rationale, learningVelocity`.

---

## 2. Inputs (`OutcomePredictionInputs`) — all already-read

`subject`, `grade` (string), `totalBoardMarks?` (defaults to 80 *read from the grade oracle*, never hardcoded), `boardScorePrediction?` (a `board_score_predictions` row), `cmeExamReadiness?` (a `cme_exam_readiness` row), `chapters?` (`ExamChapter[]` — memory-derived per-chapter mastery + `cbse_chapter_weights`), `memory?` (`weakTopics`, `knowledgeGaps`), `pulseSignals?` (`PulseSignals` from `deriveSignals`), `learningVelocity?`.

Every field is optional/defensive; the composer degrades to `insufficient_data` rather than throwing.

---

## 3. Data-source resilience — the fallback ladder

The **range** is resolved by the first tier whose inputs are present:

| Tier | Condition | Range source | Band | Confidence |
|---|---|---|---|---|
| **1** | `board_score_predictions` present | `predicted_pct` → marks | `[confidence_band_low, confidence_band_high]` read **verbatim** (already ±10 / ±15-if-coverage<60 widened by the edge fn) | `coverage_pct / 100` (passthrough of the precomputed coverage — a read, not a formula) |
| **2** | `chapters` present | `predictExamScore(chapters, totalMarks).predicted` | synthesized from **that predictor's returned confidence**: half-width scales with `1 − confidence` (no constant) | `predictExamScore(...).confidence` (0.3–0.95) |
| **2′** | only `cme_exam_readiness` present | `predicted_marks` (read verbatim; else `overall_score`→marks) | synthesized as tier 2 | `overall_score / 100` — mirrors `predictExamScore`'s mastery-based confidence for a single zero-variance estimate (no new formula) |
| **3** | none of the above | `null` | — | `0` |

`cme_exam_readiness` is **additive at every tier**: `weakest_chapters` feed `weakConcepts` + interventions, and `predicted_marks` / `overall_score` appear in the rationale as corroboration. `board_score_predictions.recovery_plan` likewise feeds weak concepts + interventions.

**Band synthesis rule (tiers 2 / 2′):** `low = mid·confidence`, `high = mid + (1−confidence)·(total−mid)`, both clamped to `[0, total]`. This reuses ONLY the confidence the predictor produced — introducing no tuning constant. Tier 1 does NOT synthesize; it reports the row's own coverage-widened band.

---

## 4. Pass-mark — expressed via existing bands only (product decision flagged)

**The platform has NO explicit 33% pass constant.** "Pass" is implicit (D band `<50%`; `at_risk` mastery `0.4`). This spec does **NOT** invent one.

`passLikelihood` is defined strictly over the EXISTING CBSE bands:

- `band: 'likely' | 'borderline' | 'at_risk' | 'unknown'` — derived from the grade oracle over the interval:
  - `gradeLow != 'D'` → `likely` (even the worst case clears D);
  - `gradeHigh == 'D'` → `at_risk` (even the best case is D);
  - otherwise → `borderline`; no range → `unknown`.
- `likelihood: number | null` — a **coverage-aware** `P(grade != 'D')` computed as the fraction of the predicted interval `[low, high]` at/above the **D→C1 boundary**, where that boundary is **DERIVED** from `calculateBoardExamScore` (scan for the smallest percentage the bands classify as not-`D`), never a hardcoded `50`. A wider (low-coverage) band pulls the likelihood toward 0.5 — the coverage-awareness is automatic.
- `confidence` — mirrors the board-score sub-prediction confidence.
- `basis` — a human string naming the derived boundary used.

> **FLAG FOR ARCHITECT / CEO (product decision, not an engineering assumption):** whether a **canonical numeric pass-mark constant** (e.g. CBSE's 33% theory pass, or a platform "pass" line) should exist is a **product decision**. Until one is decided, `passLikelihood` is anchored to the D→C1 (50%) band edge because that is the *only* existing pass-adjacent line in the codebase. If a canonical pass-mark is introduced, it must live beside the CBSE bands in `cognitive-engine.ts` and be imported here — the composer will consume it with a one-line change (swap the boundary source), no other logic changes.

---

## 5. Interventions — deterministic, NO LLM

`interventionRecommendations` is assembled by fixed rules, in a stable priority order (ordinal by category urgency — an ordering index, not a threshold):

1. `remediate_prerequisite` — one per memory `knowledgeGaps` entry (root-cause first).
2. `review_regression` — when pulse `masteryCliff.verdict === 'flagged'` (targets `worstSubject`/`worstChapter`).
3. `revise_chapter` — one per weak-chapter `weakConcept`.
4. `concentrate_subject` — when pulse `atRiskConcentration.worstBand !== 'none'` (targets the worst subject).
5. `resume_practice` — when pulse `inactivity.verdict` is `at_risk`/`broken`.

No thresholds are invented; the only reused numeric gate is `PULSE_THRESHOLDS.at_risk_mastery` (0.4) selecting weak topics.

---

## 6. Confidence — reused, not invented

- `confidence.overall` = the board-score sub-prediction confidence of the tier that fired: tier 1 `coverage_pct/100`; tier 2 `predictExamScore(...).confidence`; tier 2′ `overall_score/100`; tier 3 `0`.
- `confidence.perPrediction.boardScore` = same value.
- `confidence.perPrediction.passLikelihood` = the pass-likelihood confidence (mirrors the board-score confidence).

No confidence formula is invented. The `board_score_predictions` **coverage-widened band** is the band representation for tier 1; `predictExamScore`'s returned confidence drives tiers 2/2′.

---

## 7. WHAT/HOW + read-only guarantees

- The **adaptive engine decides WHAT** the student learns; this agent decides only **HOW to project** an outcome. It is a projection, never a director.
- **Writes nothing.** No mastery, progression, XP, gaps, review schedules, or the precomputed prediction rows. `mayWriteMastery: false` in the registry.
- **No new thresholds** beyond reuse of `PULSE_THRESHOLDS` and the CBSE bands.
- **Purity** makes it fully unit-testable in isolation and identical across web/mobile/route callers.

---

## 8. Ownership / follow-ups (NOT in this slice)

| Piece | Owner |
|---|---|
| API route that reads the DB rows + memory + pulse and calls the composer | **backend** |
| Registry status flip `planned → live` + `entryPoint` + `gatingFlag` | **ai-engineer** |
| Unit tests (fallback ladder, pass-band boundaries, purity, zero-magic) | **testing** |
| Feature flag seed (default OFF) | **architect / ops** |
| Canonical pass-mark constant decision | **CEO / architect** (flagged §4) |

Files: spec `docs/superpowers/specs/2026-07-24-outcome-prediction-agent-design.md`; composer `packages/lib/src/predict/outcome-prediction.ts`.
