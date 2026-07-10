# Agent D - Adaptive Intelligence Report

Stage 1 read-heavy reconnaissance only. No implementation changes were made or proposed as approved work. This report traces runtime paths, feature gates, state reads/writes, cron/projector flows, tests, and manifests for adaptive intelligence behavior in Alfanumrik.

## 1. Scope inspected

Inspected active runtime surfaces and supporting libraries for:

- IRT ability and item calibration.
- DKT/BKT knowledge tracing.
- Spaced repetition and SM-2 grading.
- Concept mastery state, projection, and mastery-derived decisions.
- Adaptive content and quiz difficulty selection.
- Learning path and daily rhythm decisions.
- Foxy personalization from learner state, misconceptions, goals, and memory.
- Evidence that outputs change based on learner state rather than only static code existence.

This pass covered the active Next.js host app under `apps/host`, Supabase Edge Functions under `supabase/functions`, shared libraries under `packages/lib`, migrations, cron manifests, tests, product-surface manifests, and multi-agent coordination files.

## 2. Files inspected

Primary coordination and manifest files:

- `engineering-audit/multi-agent/MASTER_PLAN.md`
- `engineering-audit/multi-agent/TASK_LEDGER.md`
- `engineering-audit/multi-agent/DEPENDENCY_MAP.md`
- `scripts/student-learning-readiness.json`
- `scripts/product-surface-matrix.json`
- `vercel.json`

Adaptive tutor, mastery, BKT, and projector paths:

- `apps/host/src/app/api/tutor/next/route.ts`
- `apps/host/src/app/api/tutor/answer/route.ts`
- `packages/lib/src/tutor/resolve-next-concept.ts`
- `packages/lib/src/tutor/types.ts`
- `packages/lib/src/tutor/bkt.ts`
- `supabase/functions/_shared/state-runtime/concept-mastery-projector.ts`
- `supabase/functions/_shared/state-runtime/mastery-state-writer.ts`
- `supabase/functions/projector-runner/index.ts`
- `supabase/migrations/20260525100001_adr_004_phase_2_bkt_rpc.sql`

IRT, adaptive quiz, and content selection:

- `apps/host/src/app/api/cron/irt-calibrate/route.ts`
- `packages/lib/src/domains/quiz.ts`
- `packages/lib/src/supabase.ts`
- `packages/lib/src/adaptive/select-adaptive-questions.ts`
- `packages/lib/src/irt/fisher-info.ts`
- `packages/lib/src/quiz-assembler.ts`
- `supabase/functions/quiz-generator/index.ts`
- `supabase/migrations/20260703000200_irt_calibrator_theta_repoint.sql`

Spaced repetition, daily learning path, and remediation:

- `apps/host/src/app/api/learner/review/grade/route.ts`
- `apps/host/src/app/api/learner/cards/create/route.ts`
- `apps/host/src/app/api/learner/cards/queue-from-scan/route.ts`
- `packages/lib/src/domains/profile.ts`
- `packages/lib/src/domains/practice.ts`
- `apps/host/src/app/api/rhythm/today/route.ts`
- `apps/host/src/app/api/v2/today/route.ts`
- `apps/host/src/app/api/student/daily-plan/route.ts`
- `apps/host/src/app/api/cron/adaptive-remediation/route.ts`
- `supabase/functions/daily-cron/index.ts`
- `packages/lib/src/learn/daily-rhythm-orchestrator.ts`
- `packages/lib/src/learn/weekly-dive-orchestrator.ts`

Foxy personalization and cognitive context:

- `apps/host/src/app/api/foxy/route.ts`
- `apps/host/src/app/api/foxy/_lib/cognitive-context.ts`
- `apps/host/src/app/api/foxy/suggest-prompts/route.ts`
- `apps/host/src/app/api/foxy/quiz-answer/route.ts`
- `apps/host/src/app/api/foxy/learning-action/route.ts`
- `packages/lib/src/learn/foxy-long-memory.ts`
- `supabase/functions/cme-engine/index.ts`

Feature flags and tests:

- `packages/lib/src/flags/registries/pedagogy.ts`
- `packages/lib/src/flags/registries/foxy.ts`
- `packages/lib/src/flags/defaults.ts`
- `apps/host/src/app/api/tutor/next/route.test.ts`
- `apps/host/src/app/api/tutor/answer/route.test.ts`
- `apps/host/src/__tests__/lib/adaptive/select-adaptive-questions.test.ts`
- `apps/host/src/__tests__/lib/adaptive/get-quiz-questions-v2-merge.test.ts`
- `apps/host/src/__tests__/lib/irt/fisher-info.test.ts`
- `apps/host/src/__tests__/adaptive-differential.test.ts`
- `apps/host/src/__tests__/migrations/adaptive-selection-e2e.test.ts`
- `apps/host/src/__tests__/migrations/adaptive-loop-e2e.test.ts`
- Foxy readiness and persistence tests under `apps/host/src/__tests__/api/foxy/`

## 3. Confirmed findings

1. Adaptive intelligence is partially active at runtime, not merely documented. The strongest state-dependent surfaces are the adaptive tutor, BKT-backed tutor answer path, SM-2 review grading, adaptive quiz selection, daily rhythm/adaptive remediation, and Foxy cognitive context.

2. DKT is not active in the inspected runtime. Searches for DKT and "deep knowledge tracing" found historical architecture and handover references only. Active knowledge tracing evidence is BKT, not DKT.

3. BKT is active in the tutor path. `/api/tutor/answer` uses `tutor_commit_attempt` and `bkt_update` when the tutor/BKT flags are enabled, then returns `mastery_mean` and `mastered` based on `MASTERY_THRESHOLD = 0.85`. The state projector also updates `concept_mastery` from `learner.concept_check_answered` events.

4. The tutor next-concept decision is learner-state-dependent. `/api/tutor/next` reads the authenticated student, grade concepts, and `concept_mastery`, then `resolveNextConcept` skips concepts at or above the mastery threshold and chooses the first unmastered concept in the preferred order.

5. SM-2 is active in learner review grading. `/api/learner/review/grade` reads the learner card, applies SM-2 from submitted quality, writes ease, interval, streak, repetition count, next review date, and review totals, and can publish a `learner.review_graded` event when the event bus flag is on.

6. IRT is active as a calibration and selection signal, but depends on flags and calibrated data. The nightly cron route `/api/cron/irt-calibrate` invokes `recalibrate_question_irt_2pl(NULL, 30)`, migrations repoint theta to `student_learning_profiles.irt_theta`, and quiz selection can use theta plus item parameters. Fisher information is explicitly gated by `ff_irt_question_selection` and calibration sufficiency.

7. Adaptive quiz selection is wired through the host library and Edge function path, but ownership comments are inconsistent. `packages/lib/src/supabase.ts` calls adaptive selection when `ff_adaptive_live_selection_v1` is enabled and mastery exists. `supabase/functions/quiz-generator/index.ts` also contains adaptive/IRT selection logic while warning it is deprecated/internal-only and canonical routing is elsewhere. This is a runtime ownership risk, not proof of absence.

8. Concept mastery is used by multiple surfaces. It drives tutor progression, adaptive quiz weak-topic selection, profile/practice due review surfaces, Foxy cognitive context, remediation decisions, and projector writes. However, the repo uses multiple nearby mastery shapes and names, including `mastery_mean`, `mastery_probability`, `learner_mastery.mastery`, and CME-derived fields, which creates semantic drift risk.

9. Daily learning-path decisions are adaptive. `/api/rhythm/today` uses learner ability from `student_learning_profiles.irt_theta`, adaptive questions from `get_adaptive_questions`, question difficulty/Bloom metadata, and active `adaptive_interventions` to compose a daily rhythm with remediation before ZPD work. The route invalidates cache after quiz submission so subsequent plans can reflect updated state.

10. Adaptive remediation has a scheduled runtime path. `/api/cron/adaptive-remediation` owns Loop A/B/C gating and decisions. `supabase/functions/daily-cron/index.ts` triggers it as a worker and leaves flag evaluation to the host route.

11. Foxy personalization is stateful. `/api/foxy` loads cognitive context, goal/persona state, optional long memory, misconception context, and digital-twin context, then injects those sections into grounded-answer prompt variables. Foxy suggestion chips also query weak/overdue mastery and CME next action. Outputs therefore can change based on learner mastery, weak topics, misconceptions, academic goal, and memory flags.

## 4. Evidence

IRT evidence:

- `apps/host/src/app/api/cron/irt-calibrate/route.ts` defines a nightly IRT 2PL recalibration endpoint and calls `recalibrate_question_irt_2pl(NULL, 30)`.
- `vercel.json` schedules `/api/cron/irt-calibrate`.
- `supabase/migrations/20260703000200_irt_calibrator_theta_repoint.sql` creates/repoints recalibration around `student_learning_profiles.irt_theta`.
- `packages/lib/src/domains/quiz.ts` reads the student's calibrated theta.
- `packages/lib/src/irt/fisher-info.ts` gates Fisher information through `ff_irt_question_selection` and calibration checks.
- `apps/host/src/__tests__/lib/irt/fisher-info.test.ts` covers false/true Fisher activation.

BKT and DKT evidence:

- `supabase/migrations/20260525100001_adr_004_phase_2_bkt_rpc.sql` creates `bkt_update` and `tutor_commit_attempt`.
- `apps/host/src/app/api/tutor/answer/route.ts` uses the commit RPC path and returns posterior mastery when enabled.
- `supabase/functions/_shared/state-runtime/concept-mastery-projector.ts` updates `concept_mastery` via BKT from concept-check events.
- DKT searches only found historical and future-facing documentation. No active DKT inference route, function, library, or test was found in this pass.

Spaced repetition and SM-2 evidence:

- `apps/host/src/app/api/learner/review/grade/route.ts` applies SM-2 from quality scores and writes `ease_factor`, `interval_days`, `streak`, `repetition_count`, `next_review_date`, and review totals.
- `packages/lib/src/domains/profile.ts` reads due review cards by RPC and falls back to due `spaced_repetition_cards` or `concept_mastery.next_review_at`.
- `packages/lib/src/domains/practice.ts` reads spaced cards and concept mastery due signals for practice surfaces.

Concept mastery evidence:

- `/api/tutor/next` reads `concept_mastery` for the authenticated student and grade concept set.
- `packages/lib/src/tutor/resolve-next-concept.ts` marks concepts mastered at `MASTERY_THRESHOLD` and chooses the next unmastered item.
- `/api/tutor/answer` and the projector write mastery updates.
- `apps/host/src/app/api/foxy/_lib/cognitive-context.ts` reads mastery, gaps, revision rows, recent errors, LO skill state, and misconceptions to derive weak topics and next action.

Adaptive selection and quiz difficulty evidence:

- `packages/lib/src/supabase.ts` uses `selectAdaptiveQuestions` under `ff_adaptive_live_selection_v1`, passes theta, and checks `ff_irt_question_selection` for Fisher scoring.
- `packages/lib/src/adaptive/select-adaptive-questions.ts` targets due/low-mastery topics, applies Bloom ceilings from mastery, and scores candidates using theta and item difficulty/discrimination.
- `supabase/functions/quiz-generator/index.ts` includes adaptive selection, IRT info selection, and `ff_irt_question_selection` runtime checks.
- `apps/host/src/__tests__/lib/adaptive/get-quiz-questions-v2-merge.test.ts` verifies host wiring from `getQuizQuestionsV2` into adaptive selection and IRT flag behavior.

Learning path evidence:

- `/api/rhythm/today` fetches adaptive question IDs, enriches difficulty metadata, composes daily rhythm with `studentAbility`, and inserts active remediation into the daily queue.
- `/api/student/daily-plan` is goal-adaptive behind `ff_goal_daily_plan`.
- `packages/lib/src/learn/weekly-dive-orchestrator.ts` changes options based on goal mode and weak topic count.
- `/api/cron/adaptive-remediation` runs scheduled remediation loops, while `daily-cron` triggers that host route.

Foxy personalization evidence:

- `/api/foxy` loads `loadCognitiveContext`, academic goal, optional long memory, and digital twin context before calling grounded answer.
- Grounded-answer prompt variables include `academic_goal_section`, `cognitive_context_section`, `misconception_section`, and `learner_memory_section`.
- `/api/foxy/suggest-prompts` returns chips from weak topics, overdue topics, next action, and Bloom hints.
- `/api/foxy/quiz-answer` routes Foxy quiz answers through the sanctioned tutor/BKT mastery pipeline.

State-dependent output evidence:

- A mastered learner and an unmastered learner can receive different `/api/tutor/next` concepts because mastered concepts are skipped.
- The same review card can receive different next review dates from `/api/learner/review/grade` depending on quality, ease, interval, and streak.
- The same quiz request can produce different question ordering/content when mastery rows, due topics, theta, and feature flags differ.
- The same daily rhythm request can include or omit remediation lanes depending on active interventions and updated quiz state.
- The same Foxy question can produce different context sections and suggested actions depending on mastery, misconceptions, academic goal, long memory, and digital-twin flags.

## 5. Risks

- DKT is not implemented in active runtime despite historical references. Any product claim that says DKT is live would be unsupported by this pass.
- Adaptive quiz ownership is ambiguous. `quiz-generator` says it is deprecated/internal-only, while the host library still uses it as a primary source path. This can cause stale assumptions about which selector actually decides production output.
- Mastery semantics are fragmented across `mastery_mean`, `mastery_probability`, `learner_mastery.mastery`, `cme_concept_state`, and projector-specific versions.
- `apps/host/src/app/api/foxy/_lib/cognitive-context.ts` comments indicate `cme_concept_state` was writer-less for Foxy next action and now derives locally, while `supabase/functions/cme-engine/index.ts` still reads CME state. That split needs explicit ownership.
- Feature flag comments and defaults may drift. `ff_adaptive_live_selection_v1` is described as default-off in registry comments, but defaults indicate it is enabled.
- Several adaptive branches have fallback modes that can bypass BKT/IRT/adaptive behavior when flags are off, data is missing, or RPCs fail.
- Runtime deployment proof was not established in this Stage 1 pass. I inspected code, manifests, and tests, but did not run live cron, Edge, or database validation.
- The repo worktree is very dirty from other agents or prior work. This pass did not attempt to distinguish every unrelated modified file beyond preserving the write boundary.

## 6. Dependencies

- Agent A/B/C/E/F/G outputs may affect route ownership, data contracts, Foxy routing, security gates, and DB migration interpretation.
- Supabase schema/RPC correctness is required for `bkt_update`, `tutor_commit_attempt`, `get_adaptive_questions`, `recalibrate_question_irt_2pl`, and review-card RPCs.
- Feature flags materially affect whether adaptive behavior is active: `ff_tutor_v1`, `ff_tutor_bkt_v1`, `ff_adaptive_live_selection_v1`, `ff_irt_question_selection`, `ff_event_bus_v1`, `ff_projector_runner_v1`, `ff_adaptive_remediation_v1`, `ff_adaptive_loops_bc_v1`, `ff_goal_daily_plan`, `ff_goal_aware_foxy`, and `ff_foxy_long_memory_v1`.
- Cron execution depends on `vercel.json`, host route auth, `daily-cron` dispatch, and cron secrets.
- Projector behavior depends on learner event production, event consumption cadence, and state-runtime subscribers.
- Foxy personalization depends on grounded-answer availability, cognitive context queries, misconception sources, goal/persona state, and long-memory synthesis availability.

## 7. Recommended action

For Stage 2 or owner review:

1. Decide whether the product should claim BKT only or also DKT. If DKT is expected, add a tracked implementation epic rather than treating historical docs as runtime evidence.
2. Establish a single canonical adaptive quiz execution path and remove or update stale "deprecated/internal-only" comments where they conflict with active calls.
3. Normalize mastery semantics in an ADR or contract: define canonical learner mastery fields, acceptable aliases, writer ownership, and reader precedence.
4. Add a runtime trace test that starts at quiz answer submission and proves the resulting mastery/IRT changes affect the next tutor, quiz, rhythm, or Foxy output.
5. Add a feature-flag truth table for adaptive intelligence surfaces so QA can tell which learner-state-dependent outputs should change in each environment.
6. Verify cron and projector behavior against a real or seeded database: IRT calibration, adaptive remediation dispatch, projector-runner, and daily rhythm cache invalidation.

## 8. Files proposed for modification

None approved for modification in Stage 1. This report is the only file written.

Candidate files for later stages, pending coordinator approval:

- `packages/lib/src/supabase.ts`
- `packages/lib/src/adaptive/select-adaptive-questions.ts`
- `supabase/functions/quiz-generator/index.ts`
- `packages/lib/src/flags/registries/pedagogy.ts`
- `packages/lib/src/flags/defaults.ts`
- `apps/host/src/app/api/foxy/_lib/cognitive-context.ts`
- `supabase/functions/cme-engine/index.ts`
- Tests under `apps/host/src/__tests__/lib/adaptive/`, `apps/host/src/app/api/tutor/`, and `apps/host/src/__tests__/migrations/`

## 9. Tests required

Not executed in Stage 1 because the user requested read-heavy reconnaissance and no implementation. Tests inspected but not run.

Recommended targeted verification:

- `pnpm --dir apps/host test src/app/api/tutor/next/route.test.ts src/app/api/tutor/answer/route.test.ts`
- `pnpm --dir apps/host test src/__tests__/lib/adaptive/select-adaptive-questions.test.ts src/__tests__/lib/adaptive/get-quiz-questions-v2-merge.test.ts src/__tests__/lib/irt/fisher-info.test.ts`
- Live or seeded DB validation for `tutor_commit_attempt`, `bkt_update`, `get_adaptive_questions`, `recalibrate_question_irt_2pl`, and projector updates.
- End-to-end state-change test: submit answer -> mastery/IRT update -> next tutor/quiz/rhythm/Foxy output differs.
- Cron validation for `/api/cron/irt-calibrate`, `/api/cron/adaptive-remediation`, `daily-cron`, and `projector-runner`.
- Foxy personalization test proving prompt variables change when weak topics, misconceptions, goals, or long-memory inputs differ.

## 10. Confidence level

Medium-high for code-path reconnaissance: the active routes, shared libraries, feature flags, migrations, cron manifests, and tests show real adaptive runtime wiring.

Medium for production-active behavior: feature flags, cron secrets, live DB contents, deployment routing, and Edge/host ownership were not executed or validated in this pass.

Low for DKT being active: no active runtime evidence was found.

## 11. Unresolved questions

- Is DKT actually on the roadmap, or should all live copy and internal docs say BKT/IRT/CME instead?
- Which path is canonical for quiz generation in production: host `getQuizQuestionsV2`, Edge `quiz-generator`, `/api/v2/quiz/questions`, or a mixed transition state?
- Which mastery field is canonical for adaptive decisions: `mastery_mean`, `mastery_probability`, `learner_mastery.mastery`, or CME state?
- Is `cme_concept_state` currently written anywhere that matters to Foxy or learning-path decisions, or should local derivation remain the source of truth?
- Are `ff_adaptive_live_selection_v1` defaults intentionally enabled despite registry comments implying default-off?
- Which environments have `ff_irt_question_selection`, `ff_tutor_bkt_v1`, `ff_projector_runner_v1`, and Foxy long memory enabled?
- Has any live or seeded run proven that learner answer submission changes the next visible learner output across tutor, quiz, rhythm, or Foxy?
