/**
 * Foxy AI Tutor mobile redesign flags (2026-06-11).
 *
 *  ff_foxy_os_v1
 *    Master switch for the "Foxy OS" mobile-first redesign of the /foxy AI
 *    tutor workspace (compact top bar + Study bottom sheet on phones, <lg
 *    only). PRESENTATION-LAYER only over the unchanged Foxy engines — it
 *    re-presents the existing modes/subjects/chapters without touching the
 *    structured-render envelope, /api/foxy, scope-lock, or daily limits
 *    (P12/REG-55 untouched). When OFF, /foxy is BYTE-IDENTICAL to today on
 *    every viewport; when ON, only the <lg surface changes (>=lg unchanged).
 *    Default: false. Read client-side via use-foxy-os-flag.
 *
 *    Not yet seeded by any migration; while absent from `feature_flags` both
 *    read paths resolve it to OFF (and the surface stays byte-identical-OFF).
 */
export const FOXY_OS_FLAGS = {
  /** Foxy OS mobile redesign (compact top bar + Study sheet, <lg only). Default off. */
  V1: 'ff_foxy_os_v1',
} as const;

/**
 * Foxy Post-Answer Learning Actions flag (2026-06-14, Phase 1).
 *
 *  ff_foxy_learning_actions_v1 — master switch for the redesigned Foxy
 *    post-answer action bar. When OFF, the ChatBubble renders BYTE-IDENTICALLY
 *    to today (the legacy QA-tester bar: thumbs + dual report + vague "Save").
 *    When ON, the action bar renders the learning-action row (Got it / Explain
 *    simpler / Show example / Quiz me on this) + a single-path overflow menu
 *    (Save to notebook / Read aloud / Report an issue). Got it -> is_up=true and
 *    Explain simpler -> is_up=false reuse the existing record_message_feedback
 *    RPC; Save to notebook reuses student_bookmarks; a new learner.learning_action
 *    event (IDs + enums only) is published. Self-reports do NOT mutate BKT
 *    mastery_mean (P2); only real "Quiz me" answers feed mastery via the existing
 *    concept-check path. This is the FRONT-BAR redesign gate ONLY — the four
 *    continuity/memory flags (ff_foxy_session_reactivate_v1,
 *    ff_foxy_pending_expectations_v1, ff_foxy_long_memory_v1,
 *    ff_foxy_context_rich_v1) ramp INDEPENDENTLY in Phase 2 and are NOT gated by
 *    this flag. Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0, scoping NULL) by migration
 *    20260619000700_seed_ff_foxy_learning_actions_v1.sql — mirrors the
 *    ff_adaptive_loops_bc_v1 seed precedent (defensive to_regclass guard +
 *    explicit column list + ON CONFLICT (flag_name) DO NOTHING; REG-125). No new
 *    table — event-first, reuses foxy_message_feedback + student_bookmarks.
 *    Spec/plan: Foxy AI Tutor — The Moat (Round 1: Post-Answer Learning Actions
 *    + Living Memory), Phase 1.
 */
export const FOXY_LEARNING_ACTIONS_FLAGS = {
  /** Foxy post-answer learning-action bar redesign (Phase 1). Default off. */
  V1: 'ff_foxy_learning_actions_v1',
} as const;

/**
 * Foxy 3-Agent Math Correctness Pipeline flag (2026-06-14, Part 1F).
 *
 *  ff_foxy_math_pipeline_v1 — master switch for the dedicated math-solve path
 *    inside the EXISTING /api/foxy flow. When ON, a detected math-solve query is
 *    routed through the 3-agent pipeline:
 *      (1) Classifier (Haiku, no thinking — topic/chapter/grade/difficulty),
 *      (2) Solver (Haiku 4.5 + Extended Thinking, cached per-chapter NCERT
 *          system prompt, NO RAG, emits structured step/math/answer blocks),
 *      (3) Verifier (SymPy in the Python AI service, no LLM, fail-closed).
 *    On a verifier mismatch the pipeline escalates ONCE to Sonnet+thinking; if
 *    still wrong/unavailable the confident answer is replaced with
 *    show-the-working + a "Check manually" badge (P12 — never serve a
 *    confidently wrong answer). Non-math Foxy keeps the RAG grounded-answer path
 *    UNCHANGED. When OFF, /api/foxy renders BYTE-IDENTICALLY to today: no math
 *    classifier/solver/verifier runs, the solve-math module + /v1/math/verify
 *    Python endpoint are never reached, and no Verified/Check badge is shown.
 *    Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0, scoping NULL) by migration
 *    20260619000800_seed_ff_foxy_math_pipeline_v1.sql — mirrors the
 *    ff_foxy_learning_actions_v1 seed precedent (defensive to_regclass guard +
 *    explicit column list + ON CONFLICT (flag_name) DO NOTHING; REG-125). No new
 *    table. This is the math-pipeline gate ONLY; Part-2 topic progression and
 *    the foxy_pending_expectations `next_topic` CHECK widening (migration
 *    20260619000900) ramp INDEPENDENTLY and are NOT gated by this flag.
 *    Plan: Foxy Math Correctness (3-Agent Pipeline) + Topic-Progression Fixes,
 *    Part 1F.
 */
export const FOXY_MATH_PIPELINE_FLAGS = {
  /** Foxy 3-agent math correctness pipeline (Classifier -> Solver -> SymPy verifier). Default off. */
  V1: 'ff_foxy_math_pipeline_v1',
} as const;

/**
 * Foxy Curriculum Guard — deterministic (no-LLM) curriculum-authenticity gate on
 * the EXISTING /api/foxy STEM path. Two purely-mechanical tiers run when ON:
 *   (T1) Enrolled-grade authenticity — the student's enrolled grade is the only
 *        authority for in-bounds curriculum scope; nothing is inferred from the
 *        query text or model output.
 *   (T4a) Out-of-grade math lexicon — a static lexicon classifies a math query
 *        against the enrolled grade's CBSE band.
 * It HARD-BLOCKS out-of-grade math on ALL STEM Foxy queries and redirects the
 * learner to their current chapter/topic, surfaced with the Outside-Current-
 * Chapter badge in the existing FoxyStructuredRenderer. Decision A (in-grade,
 * DIFFERENT-chapter) stays SOFT (gentle nudge, not a hard block). Decoupled from
 * FOXY_MATH_PIPELINE_FLAGS (the two ramp INDEPENDENTLY; neither gates the other).
 * ENV override FF_FOXY_CURRICULUM_GUARD_V1 is resolved via isCurriculumGuardEnabled
 * in src/lib/foxy/math-flag.ts (backend-owned). OFF = /api/foxy byte-identical to
 * today (no tier runs, no lexicon, no redirect/badge). Default off.
 * Seeded OFF by migration 20260619001000_seed_ff_foxy_curriculum_guard_v1.sql.
 */
export const FOXY_CURRICULUM_GUARD_FLAGS = {
  /** Foxy deterministic curriculum guard (T1 enrolled-grade + T4a out-of-grade math lexicon). Default off. */
  V1: 'ff_foxy_curriculum_guard_v1',
} as const;

/**
 * Foxy shared Redis (Upstash) response-cache L2 tier for the `grounded-answer`
 * Supabase Edge Function pipeline (the shared backend behind Foxy/ncert-solver/
 * quiz-generator/concept-engine/diagnostic) (2026-07-05).
 *
 *  ff_foxy_response_cache_l2_v1 — master switch for REAL serving out of the L2
 *    tier. When ON, `grounded-answer` consults the shared Redis cache before
 *    falling back to the existing retrieval/generation path, and writes fresh
 *    responses back into it. Rollout-percentage-capable (per-user deterministic
 *    hashing via hashForRollout), so this can be ramped gradually once shadow
 *    data validates the hit-rate assumption. When OFF, `grounded-answer` never
 *    reads or writes the L2 tier — byte-identical to today.
 *
 *  ff_foxy_response_cache_l2_shadow_v1 — independent shadow/observability-only
 *    switch. When ON, `grounded-answer` computes the L2 cache key and records
 *    whether it WOULD have been a hit, purely for offline hit-rate analysis —
 *    it never serves a cached value and never mutates student-visible output.
 *    Intended to run ahead of `ff_foxy_response_cache_l2_v1` to validate
 *    assumptions before any real-serving flip. Independent flag — either can be
 *    ON/OFF without the other (shadow does not gate or require real-serving).
 *
 *    Both default: false. Both seeded OFF (is_enabled=false, rollout=0, scoping
 *    NULL) by migration 20260705000000_seed_ff_foxy_response_cache_l2.sql.
 *    Net-new capability; no existing behavior changes while both are OFF.
 */
export const FOXY_RESPONSE_CACHE_L2_FLAGS = {
  /** Foxy grounded-answer shared Redis L2 cache — real serving (rollout-percentage-capable). Default off. */
  V1: 'ff_foxy_response_cache_l2_v1',
  /** Foxy grounded-answer shared Redis L2 cache — shadow/observability-only mode. Default off. */
  SHADOW_V1: 'ff_foxy_response_cache_l2_shadow_v1',
} as const;
