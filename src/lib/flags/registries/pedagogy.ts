/**
 * Goal-Adaptive Learning Layers flags (Phase 0 + Phase 1 + Phase 2).
 *
 * `ff_goal_profiles` gates the super-admin Goal Profile Preview page that
 * lets admins inspect each of the 6 goal personas + their config tables.
 *
 * `ff_goal_aware_foxy` gates two user-visible behaviors that ship together:
 *   1. Foxy's system prompt swaps the legacy single-line goal sentence for
 *      a multi-paragraph persona tailored to (goal × mode).
 *   2. QuizResults renders a goal-aware scorecard sentence after every quiz.
 *
 * `ff_goal_aware_selection` (Phase 2) gates two backend behaviors:
 *   1. Quiz-generate workflow uses pickQuizParams + the additive
 *      get_adaptive_questions_v2 RPC instead of legacy constants + v1 RPC.
 *   2. Mastery display thresholds switch from the global 0.8 default to
 *      goal-specific thresholds (see src/lib/goals/mastery-display.ts).
 *
 * All three flags fall back to the legacy default when off, so disabling at
 * any time is an instant rollback.
 *
 * Seeded by migrations:
 *   - 20260503120000_add_ff_goal_adaptive_layers.sql       (Phase 0+1)
 *   - 20260503140000_add_phase2_goal_aware_selection.sql   (Phase 2)
 */
export const GOAL_ADAPTIVE_FLAGS = {
  GOAL_PROFILES: 'ff_goal_profiles',
  GOAL_AWARE_FOXY: 'ff_goal_aware_foxy',
  GOAL_AWARE_SELECTION: 'ff_goal_aware_selection',
  GOAL_DAILY_PLAN: 'ff_goal_daily_plan',  // Phase 3
  GOAL_AWARE_RAG: 'ff_goal_aware_rag',  // Phase 4
  GOAL_DAILY_PLAN_REMINDER: 'ff_goal_daily_plan_reminder',  // Phase 5
} as const;

/**
 * Pedagogy v2 — Wave 1 (Daily Rhythm) + Wave 2 (Weekly Curiosity Dive) flags.
 *
 *  ff_productive_failure_v1
 *    /learn/[subject]/[chapter] presents the ZPD problem BEFORE the tutorial.
 *    Default: false. When off, the legacy tutorial-first path is rendered.
 *    Persona-aware: even when the flag is on, `improve_basics` persona keeps
 *    worked-example-first via pedagogyContentRules — see
 *    src/lib/learn/pedagogy-content-rules.ts.
 *
 *  ff_distractor_micro_explainer_v1
 *    After a wrong MCQ pick, surface the curated remediation from
 *    wrong_answer_remediations and offer a one-click "Ask Foxy" CTA.
 *    Default: false.
 *
 *  ff_pedagogy_v2_daily_rhythm
 *    Dashboard renders <DailyRhythmQueue/> above the hero; /api/rhythm/today
 *    is callable. Default: false. When off, dashboard is unchanged.
 *
 *  ff_pedagogy_v2_weekly_dive
 *    /dive surface is reachable, /api/dive/* endpoints respond, and the
 *    dashboard's DailyRhythmQueue shows a "This week's dive" CTA when the
 *    week's dive is not yet completed. Default: false. When off, /dive
 *    returns 404 and the CTA is suppressed.
 *
 *  ff_pedagogy_v2_monthly_synthesis
 *    /synthesis surface is reachable, /api/synthesis/* endpoints respond,
 *    and the daily-cron triggers monthly-synthesis-builder for active
 *    flagged students. Default: false. When off, /synthesis returns 404,
 *    the WhatsApp parent-share path is suppressed, and the cron skips
 *    flagged-out students.
 *
 * Seeded by migrations:
 *   20260509120000_pedagogy_v2_wave_1_flags.sql
 *   20260510000000_pedagogy_v2_wave_2_phenomena_and_dive.sql
 *   20260511000000_pedagogy_v2_wave_3_monthly_synthesis.sql
 */
export const PEDAGOGY_V2_FLAGS = {
  PRODUCTIVE_FAILURE_V1:        'ff_productive_failure_v1',
  DISTRACTOR_MICRO_EXPLAINER_V1: 'ff_distractor_micro_explainer_v1',
  DAILY_RHYTHM:                 'ff_pedagogy_v2_daily_rhythm',
  WEEKLY_DIVE:                  'ff_pedagogy_v2_weekly_dive',
  MONTHLY_SYNTHESIS:            'ff_pedagogy_v2_monthly_synthesis',
} as const;

/**
 * Phase A Loop A adaptive remediation flag (2026-06-12, CEO-approved TIERED
 * authority model 3).
 *
 *  ff_adaptive_remediation_v1 — master switch for the adaptive closed loop
 *    (mastery-cliff -> auto-inject targeted remediation -> verify recovery ->
 *    escalate on failure). When OFF, no new interventions are injected and the
 *    /api/rhythm/today remediation lane renders empty; the verify cron step is
 *    deliberately gated on the existence of active rows, NOT this flag, so
 *    mid-flight interventions drain to terminal state (kill switch drains,
 *    does not freeze — spec Section 9). Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0, scoping NULL) by migration
 *    20260619000300_seed_ff_adaptive_remediation_v1.sql — mirrors the
 *    ff_school_pulse_v1 seed precedent. Data layer: adaptive_interventions
 *    (20260619000200). Spec:
 *    docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md
 */
export const ADAPTIVE_REMEDIATION_FLAGS = {
  /** Phase A Loop A adaptive closed loop (cliff -> inject -> verify -> escalate). Default off. */
  V1: 'ff_adaptive_remediation_v1',
} as const;

/**
 * Phase A Loops B & C adaptive closed loops (2026-06-13). ONE flag for BOTH
 * loops on the Loop A substrate (NOT a reuse of ff_adaptive_remediation_v1 —
 * spec Decision X1; the two ramp independently).
 *
 *  ff_adaptive_loops_bc_v1 — master switch for the inactivity (Loop B) and
 *    at-risk-concentration (Loop C) inject branches of the daily-cron adaptive
 *    worker. When OFF, no new B/C interventions are opened (the inactivity +
 *    at_risk_concentration inject branches short-circuit; the mastery_cliff
 *    branch still respects its own ff_adaptive_remediation_v1 flag — per-signal
 *    inject gating, Decision X2); when ON, Loop B opens a re-engagement nudge on
 *    a 'broken' inactivity verdict and Loop C opens an IMMEDIATE teacher/parent
 *    escalation on a 'high'-band subject. The verify phase is deliberately gated
 *    on the existence of active rows, NOT this flag, so mid-flight B/C
 *    interventions drain to terminal state (kill switch drains, does not freeze —
 *    spec Section 9). Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0, scoping NULL) by migration
 *    20260619000600_seed_ff_adaptive_loops_bc_v1.sql — mirrors the
 *    ff_adaptive_remediation_v1 seed precedent. Substrate: adaptive_interventions
 *    (20260619000200) with the CHECK extension (20260619000500). Spec:
 *    docs/superpowers/specs/2026-06-13-phase-a-loops-b-c-design.md
 */
export const ADAPTIVE_LOOPS_BC_FLAGS = {
  /** Phase A Loops B (inactivity nudge) & C (concentration escalation). Default off. */
  V1: 'ff_adaptive_loops_bc_v1',
} as const;

/**
 * Post-submit quiz telemetry flag (2026-06-15, SPEC-1..5).
 *
 *  ff_quiz_telemetry_v1 — master switch for the best-effort post-submit learning
 *    telemetry on the server-authoritative quiz submit path (/api/v2/quiz/submit
 *    via the shared submit-side-effects seam). When ON, after a FRESH grade the
 *    route emits per-answer learning_events (SPEC-1), mastery-achieved
 *    learning_events (SPEC-2, 0.8 pre/post threshold), and (when a reliable
 *    node_code↔topic mapping exists — see OQ-5) consecutive-wrong
 *    intervention_alerts (SPEC-3). All telemetry is fire-and-forget and never
 *    blocks/breaks the submit response; idempotent replays + errors emit nothing
 *    (SPEC-5). When OFF/unseeded, the route captures no pre-snapshot and the
 *    telemetry step is a complete no-op (submit path byte-identical to today).
 *    Default: false.
 *
 *    Seeded OFF in a follow-up migration; ships gated (isFeatureEnabled returns
 *    false for the unseeded flag until then).
 */
export const QUIZ_TELEMETRY_FLAGS = {
  /** Post-submit learning telemetry (per-answer + mastery + intervention). Default off. */
  V1: 'ff_quiz_telemetry_v1',
} as const;

/**
 * Phase 2 — Adaptive LIVE quiz selection flag (2026-06-22).
 *
 *  ff_adaptive_live_selection_v1 — gates the weak-topic-targeted candidate
 *    provider layered IN FRONT of the existing getQuizQuestionsV2 fallback
 *    ladder. When ON (and the student HAS concept_mastery rows), the shared
 *    selectAdaptiveQuestions provider (src/lib/adaptive/select-adaptive-questions.ts)
 *    runs FIRST to surface questions on the student's weakest + due-for-review
 *    topics — applying a mastery→Bloom ceiling and ranking candidates by the
 *    IRT-proxy computeSelectionScore(irt_theta, item) — and the EXISTING ladder
 *    (RAG RPC → v2 RPC → v1 direct query) then tops the result up to the exact
 *    requested count. When OFF, or when the student has NO mastery rows
 *    (cold-start), getQuizQuestionsV2 is byte-identical to today (no provider
 *    call, ladder unchanged).
 *
 *    Deliberately a SEPARATE flag from ff_irt_question_selection (which is
 *    ON @100 in prod and gates the nightly-calibrated SQL-RPC IRT path):
 *    reusing it would push this brand-new, unvalidated live-selection path to
 *    100% on merge. A dedicated default-OFF flag gives an independent kill
 *    switch and a clean validation ramp before it touches live quizzes.
 *
 *    The provider is a CANDIDATE PROVIDER, never a hard filter — it can only
 *    ADD weak-topic candidates ahead of the ladder; the count + P6 guarantees
 *    are still enforced downstream by assembleQuiz. Default: false.
 *
 *    Seeded OFF in a follow-up migration (mirrors the ff_school_pulse_v1 seed
 *    precedent). While absent from feature_flags both read paths resolve it to
 *    OFF, so the live quiz stays byte-identical until explicitly enabled.
 */
export const ADAPTIVE_LIVE_SELECTION_FLAGS = {
  /** Weak-topic candidate provider in front of the getQuizQuestionsV2 ladder. Default off. */
  V1: 'ff_adaptive_live_selection_v1',
} as const;

/**
 * IRT question-selection ACTIVATION flag (2026-07-03; flag itself seeded by the
 * Foxy-moat Phase 4 migration 20260428000600_select_questions_by_irt_info.sql).
 *
 *  ff_irt_question_selection — gates every consumer that lets NIGHTLY-CALIBRATED
 *    2PL parameters (irt_a/irt_b with irt_calibration_n >= 30) change question
 *    RANKING: the select_questions_by_irt_info SQL RPC path, the quiz-generator
 *    Edge Function branch, and the fisher_info branch of the live web selector
 *    (computeSelectionScore via selectAdaptiveQuestions / getQuizQuestionsV2).
 *
 *    Rationale (OEF staged-ramp rule): the repaired IRT calibrator progressively
 *    stamps calibration onto live items. Without this gate, items crossing
 *    n >= 30 would silently flip from proxy_distance to fisher_info ranking for
 *    the ff_adaptive_live_selection_v1 cohort with NO flag flip. IRT-scored
 *    serving must instead be a deliberate, evidence-backed ramp of THIS flag.
 *
 *    Evaluated per-student via isFeatureEnabled with userId = students.id so
 *    percentage rollout hashes deterministically per student. FAIL-CLOSED
 *    everywhere: flag missing / read error / evaluation false → proxy_distance
 *    ranking (calibrated items score exactly like uncalibrated ones).
 */
export const IRT_SELECTION_FLAGS = {
  /** fisher_info ranking activation for calibrated items. Fail-closed. */
  QUESTION_SELECTION: 'ff_irt_question_selection',
} as const;

/**
 * Digital Twin + Knowledge Graph flag (2026-07-02, Slice 1, CEO-approved).
 *
 *  ff_digital_twin_v1 — master switch for the learner digital-twin behaviors
 *    built on the concept_edges unified prerequisite graph + the
 *    learner_twin_snapshots / learner_twin_memory substrate and the
 *    traverse_prerequisites / detect_blocked_dependents RPCs. When OFF, no twin
 *    surface/consumer runs and the additive concept_edges branch of
 *    detect_knowledge_gaps + the 'prerequisite_aware' generate_learning_path
 *    path type are not invoked by flag-gated callers. Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0, scoping NULL) by migration
 *    20260702000700_seed_ff_digital_twin_v1.sql — mirrors the
 *    ff_adaptive_loops_bc_v1 seed precedent. Data layer: concept_edges
 *    (20260702000100), learner_twin_snapshots (20260702000200),
 *    learner_twin_memory (20260702000300). Stays OFF until an operator flips it.
 */
export const DIGITAL_TWIN_FLAGS = {
  /** Digital Twin + Knowledge Graph (Slice 1). Default off. */
  V1: 'ff_digital_twin_v1',
} as const;
