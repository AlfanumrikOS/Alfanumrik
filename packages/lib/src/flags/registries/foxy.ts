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
 * Foxy math-format house style — Wave B of the math-rendering work (2026-07-16,
 * band variants 2026-07-20).
 *
 *  ff_foxy_math_format_v2 — master switch for injecting the math-format
 *    directive (buildMathFormatDirective in foxy/prompt-sections.ts) into the
 *    Foxy prose-teaching turns via the ADDITIVE `mode_directive` channel.
 *    When ON, worked examples are steered into numbered "step" blocks
 *    alternating with display "math" blocks at the student's grade-band step
 *    density ('6-8' | '9-10' | '11-12' — docs/math-rendering-spec.md §3, the
 *    CEO-approved single source), with the delimiter contract (\( .. \) /
 *    \[ .. \] / bare LaTeX in math blocks; $ and $$ forbidden) unchanged.
 *    When OFF (default), the directive is never built or injected and the
 *    grounded request is BYTE-IDENTICAL to today (mathFormatDirective = '' →
 *    composeModeDirective returns the base verbatim). MCQ-emitting turns
 *    (practice / quiz_me / real-practice) never receive it — the route skips
 *    the flag read entirely on mode === 'practice'. Default: false.
 *
 *    Seeded OFF (is_enabled=false, rollout=0) by migration
 *    20260716120000_seed_ff_foxy_math_format_v2.sql — REG-125 canonical shape
 *    (to_regclass guard + explicit column list + ON CONFLICT (flag_name)
 *    DO NOTHING). Flipping it is a separate operator decision gated on the
 *    mobile-degradation memo — this registry entry only names the flag.
 */
export const FOXY_MATH_FORMAT_FLAGS = {
  /** Foxy grade-band math-format directive injection (mode_directive channel). Default off. */
  V2: 'ff_foxy_math_format_v2',
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

/**
 * Foxy Vertical Math rendering flag (2026-07-18).
 *
 *  ff_foxy_vertical_math_v1 — master switch for vertical math block rendering.
 *    When ON, the VERTICAL_MATH_DIRECTIVE is appended to Foxy prompts for
 *    math subjects (grades 6-8), instructing the model to emit `vertical_math`
 *    blocks for arithmetic operations. When OFF, no vertical math blocks are
 *    emitted and the model uses flat LaTeX (byte-identical to today). Default: false.
 */
export const FOXY_VERTICAL_MATH_FLAGS = {
  V1: 'ff_foxy_vertical_math_v1',
} as const;

/**
 * Foxy SST Maps rendering flag (2026-07-18).
 *
 *  ff_foxy_maps_v1 — master switch for geographic/political map blocks in SST.
 *    When ON, the MAP_DIRECTIVE is appended to Foxy prompts for SST subjects,
 *    instructing the model to emit `map` blocks for geography and historical
 *    events with spatial context. When OFF, no map blocks are emitted and
 *    SST renders text-only (byte-identical to today). Default: false.
 */
export const FOXY_MAPS_FLAGS = {
  V1: 'ff_foxy_maps_v1',
} as const;

/**
 * Foxy Engagement Dashboard flag (2026-07-18).
 *
 *  ff_engagement_dashboard_v1 — master switch for the student-facing progress
 *    dashboard at /progress/dashboard. When OFF, the page is not accessible
 *    (byte-identical to today). Default: false.
 */
export const FOXY_ENGAGEMENT_DASHBOARD_FLAGS = {
  V1: 'ff_engagement_dashboard_v1',
} as const;

/**
 * Foxy Olympiad Mode flag (2026-07-18).
 *
 *  ff_foxy_olympiad_mode_v1 — master switch for the olympiad teaching mode.
 *    When ON, 'olympiad' is available as a Foxy mode with competition-level
 *    problems, Bloom analyze+ only, and Indian olympiad context (RMO, INMO,
 *    NSEP). When OFF, olympiad mode is not available. Default: false.
 */
export const FOXY_OLYMPIAD_MODE_FLAGS = {
  V1: 'ff_foxy_olympiad_mode_v1',
} as const;

/**
 * Foxy Interactive Lesson Mode flag (2026-07-18).
 *
 *  ff_foxy_interactive_lesson_v1 — master switch for structured step-by-step
 *    lesson flow with voice narration. Depends on voice playback (Phase 2).
 *    When ON, 'lesson' is available as a Foxy mode with lesson_step progression,
 *    check questions, and voice sync. When OFF, lesson mode is not available.
 *    Default: false.
 */
export const FOXY_INTERACTIVE_LESSON_FLAGS = {
  V1: 'ff_foxy_interactive_lesson_v1',
} as const;

/**
 * Provider-agnostic Model Gateway flag (2026-07-24, GenAI architecture Phase 1).
 *
 *  ff_model_gateway_v1 — gates the NON-DEFAULT routing policies of the new
 *    provider-agnostic Model Gateway (the shared AI-infra layer in front of the
 *    LLM providers behind Foxy / ncert-solver / quiz-generator / cme-engine /
 *    grounded-answer). When OFF (default), the gateway reproduces today's
 *    Anthropic-primary behavior EXACTLY — no alternate provider selection, no
 *    fallback/shadow/cost-routing policy runs — so OFF is a TRUE no-op and every
 *    AI path is byte-identical to today. When ON, the gateway's non-default
 *    routing policies (multi-provider selection, failover, cost/latency routing)
 *    become active behind the same call surface. Default: false.
 *
 *    Normal staged-rollout flag (NOT constitution-pinned): mirrors the
 *    ff_foxy_response_cache_l2_v1 / ff_adaptive_live_selection_v1 precedent —
 *    lives in FLAG_DEFAULTS as false and is intentionally NOT added to
 *    EXPECTED_OFF_FLAGS / PROTECTED_FLAGS (that list is the CEO-approved
 *    forced-OFF posture derived from migration 20260720110000; every member must
 *    be console-protected). Seed migration is owned by architect; the gateway
 *    implementation (packages/lib/src/ai/gateway/**) is owned by ai-engineer.
 *    While absent from feature_flags every read path resolves it to OFF.
 */
export const MODEL_GATEWAY_FLAGS = {
  /** Provider-agnostic Model Gateway non-default routing policies. Default off = legacy Anthropic-primary. */
  V1: 'ff_model_gateway_v1',
} as const;

/**
 * OpenAI-primary rollout flag (2026-08-03) — percentage-based rollback lever
 * added ON TOP OF the already-shipped, unconditional 2026-08-02 OpenAI-primary
 * provider swap (MODEL_FALLBACK_ORDER / LEGACY_FALLBACK_ORDER, CEO-approved,
 * REG-334). That swap flipped 100% of traffic to OpenAI-primary at deploy
 * time with no ramp; this flag lets ops dial a CONTROLLED, deterministic
 * percentage of traffic back to the reconstructed Claude-primary order
 * (CLAUDE_PRIMARY_FALLBACK_ORDER / packages/lib/src/ai/gateway/rollout.ts)
 * instead of a second flat switch.
 *
 *  ff_foxy_openai_primary_rollout_v1 — plain is_enabled + rollout_percentage
 *    columns (NOT the ff_python_* metadata/kill_switch envelope — see
 *    rollout.ts's header for why). Bucketing is per-caller deterministic
 *    (hashForRollout(callerId, flagName) < rollout_percentage), matching the
 *    prior-art precedent this codebase already uses for sticky, multi-turn-
 *    stable rollout decisions (REG-135: MoL's original Math.random() weighted
 *    routing was a documented bug precisely because per-REQUEST randomness
 *    breaks continuity — deterministic per-caller hashing is required here for
 *    the same reason, doubly so for a multi-turn tutoring conversation).
 *
 *    Mapping (inverted from "rollout_pct% get the new thing" — read the
 *    rollout.ts header before touching this flag):
 *      - is_enabled=false, OR rollout_percentage<=0, OR no caller id
 *        available, OR the flag read fails → OPENAI-PRIMARY (today's shipped,
 *        100%-live default — this is what keeps a fresh deploy of this
 *        mechanism, and its seed state, a pure no-op).
 *      - is_enabled=true AND rollout_percentage=P AND a caller id is present
 *        → bucket<P rolls that caller BACK to Claude-primary; bucket>=P stays
 *        on OpenAI-primary. So rollout_percentage names how much traffic is
 *        peeled OFF OpenAI (not how much newly gets it — it already has 100%).
 *
 *    Default: false / rollout_percentage=0 (pure no-op seed; CEO/orchestrator
 *    decides the actual ramp schedule separately, after this ships). Seed
 *    migration is owned by architect; the rollout implementation
 *    (packages/lib/src/ai/gateway/rollout.ts, Deno mirror
 *    supabase/functions/grounded-answer/_model-rollout-flag.ts) is owned by
 *    ai-engineer. Not added to PROTECTED_FLAGS/EXPECTED_OFF_FLAGS by this
 *    change — flagged as a recommendation for architect/ops given this flag's
 *    AI-provider-routing blast radius (see the `ai_provider` tier precedent
 *    for ff_mol_enabled / ff_grounded_answer_mol_shadow_v1 in protected-flags.ts).
 */
export const MODEL_ROLLOUT_FLAGS = {
  /** Percentage-based rollback lever for the OpenAI-primary swap. Default off = 100% OpenAI-primary, unchanged. */
  V1: 'ff_foxy_openai_primary_rollout_v1',
} as const;

/**
 * Unified Student Memory read-API flag (2026-07-24, GenAI architecture Phase 2).
 *
 *  ff_unified_memory_v1 — gates the Unified Student Memory read-API (the shared
 *    memory-assembly layer that consolidates today's per-reader memory behavior
 *    behind a single read surface). When OFF (default), every reader keeps its
 *    legacy per-reader memory assembly EXACTLY — no unified read path runs — so
 *    OFF is a TRUE no-op and memory behavior is byte-identical to today. When ON,
 *    readers resolve memory through the unified read-API behind the same call
 *    surface. Default: false.
 *
 *    Normal staged-rollout flag (NOT constitution-pinned): mirrors the
 *    ff_model_gateway_v1 / ff_foxy_response_cache_l2_v1 precedent — lives in
 *    FLAG_DEFAULTS as false and is intentionally NOT added to EXPECTED_OFF_FLAGS /
 *    PROTECTED_FLAGS (that list is the CEO-approved forced-OFF posture derived
 *    from migration 20260720110000; every member must be console-protected). Seed
 *    migration is owned by architect; the memory implementation
 *    (packages/lib/src/memory/**) is owned by ai-engineer. While absent from
 *    feature_flags every read path resolves it to OFF.
 */
export const UNIFIED_MEMORY_FLAGS = {
  /** Unified Student Memory read-API. Default off = legacy per-reader memory assembly. */
  V1: 'ff_unified_memory_v1',
} as const;

/**
 * Runtime ResponseEval observability sensor flag (2026-07-24, GenAI architecture
 * Phase 4).
 *
 *  ff_response_eval_v1 — gates the runtime 9-dimension ResponseEval observability
 *    sensor (the fire-and-forget quality-scoring layer that grades AI responses
 *    across 9 dimensions behind Foxy / ncert-solver / quiz-generator / cme-engine /
 *    grounded-answer). When OFF (default), no runtime eval is computed or emitted —
 *    so OFF is a TRUE no-op and every AI path is byte-identical to today. When ON,
 *    the sensor computes and emits the 9-dimension eval fire-and-forget, off the
 *    response's critical path (it never alters student-visible output). Default: false.
 *
 *    Normal staged-rollout flag (NOT constitution-pinned): mirrors the
 *    ff_unified_memory_v1 / ff_model_gateway_v1 / ff_foxy_response_cache_l2_v1
 *    precedent — lives in FLAG_DEFAULTS as false and is intentionally NOT added to
 *    EXPECTED_OFF_FLAGS / PROTECTED_FLAGS (that list is the CEO-approved forced-OFF
 *    posture derived from migration 20260720110000; every member must be
 *    console-protected). Seed migration is owned by architect; the eval
 *    implementation (packages/lib/src/ai/eval/**) is owned by ai-engineer. While
 *    absent from feature_flags every read path resolves it to OFF.
 */
export const RESPONSE_EVAL_FLAGS = {
  /** Runtime 9-dimension ResponseEval observability sensor. Default off = no runtime eval (byte-identical, fire-and-forget). */
  V1: 'ff_response_eval_v1',
} as const;

/**
 * Outcome Prediction Agent read-only endpoint flag (2026-07-24, GenAI architecture
 * Phase 5a).
 *
 *  ff_outcome_prediction_v1 — gates the read-only Outcome Prediction Agent endpoint
 *    (the forward-looking predictor that projects a learner's likely outcomes from
 *    existing signals). When OFF (default), the endpoint serves NO prediction — it
 *    returns a disabled/404-style response — so OFF is a TRUE no-op and no
 *    prediction is ever computed or surfaced. When ON, the endpoint serves the
 *    read-only prediction behind the same call surface (it never mutates
 *    student-visible state). Default: false.
 *
 *    Normal staged-rollout flag (NOT constitution-pinned): mirrors the
 *    ff_response_eval_v1 / ff_unified_memory_v1 / ff_model_gateway_v1 precedent —
 *    lives in FLAG_DEFAULTS as false and is intentionally NOT added to
 *    EXPECTED_OFF_FLAGS / PROTECTED_FLAGS (that list is the CEO-approved forced-OFF
 *    posture derived from migration 20260720110000; every member must be
 *    console-protected). Seed migration is owned by architect; the prediction
 *    implementation (packages/lib/src/predict/**) is owned by assessment and the
 *    API route by backend. While absent from feature_flags every read path resolves
 *    it to OFF.
 */
export const OUTCOME_PREDICTION_FLAGS = {
  /** Read-only Outcome Prediction Agent endpoint (GenAI Phase 5a). Default off. */
  V1: 'ff_outcome_prediction_v1',
} as const;

/**
 * Lesson Generation Agent student-facing endpoint flag (2026-07-24, GenAI
 * architecture Phase 5b).
 *
 *  ff_lesson_generation_v1 — gates the student-facing Lesson Generation Agent
 *    endpoint (the on-demand lesson builder that composes a generated lesson from
 *    existing signals). When OFF (default), the endpoint serves NO generated
 *    lesson — it returns a disabled/404-style response — so OFF is a TRUE no-op
 *    and no lesson is ever generated or surfaced. When ON, the endpoint serves the
 *    generated lesson behind the same call surface (it never mutates
 *    student-visible state). Default: false.
 *
 *    Normal staged-rollout flag (NOT constitution-pinned): mirrors the
 *    ff_outcome_prediction_v1 / ff_response_eval_v1 / ff_unified_memory_v1 /
 *    ff_model_gateway_v1 precedent — lives in FLAG_DEFAULTS as false and is
 *    intentionally NOT added to EXPECTED_OFF_FLAGS / PROTECTED_FLAGS (that list is
 *    the CEO-approved forced-OFF posture derived from migration 20260720110000;
 *    every member must be console-protected). Seed migration is owned by architect;
 *    the lesson implementation (packages/lib/src/lesson/**) is owned by
 *    ai-engineer and assessment and the API route by backend. While absent from
 *    feature_flags every read path resolves it to OFF.
 */
export const LESSON_GENERATION_FLAGS = {
  /** Student-facing Lesson Generation Agent (GenAI Phase 5b). Default off = no generated lesson served. */
  V1: 'ff_lesson_generation_v1',
} as const;

/**
 * Content Generation Agent student-facing endpoint flag (2026-07-24, GenAI
 * architecture Phase 5c).
 *
 *  ff_content_generation_v1 — gates the student-facing Content Generation Agent
 *    endpoint (the on-demand Mermaid diagram generator that composes generated
 *    content — Mermaid diagrams — from existing signals). When OFF (default), the
 *    endpoint serves NOTHING — it returns a disabled/404-style response — so OFF
 *    is a TRUE no-op and no content is ever generated or surfaced. When ON, the
 *    endpoint serves the generated content behind the same call surface (it never
 *    mutates student-visible state). Default: false.
 *
 *    Normal staged-rollout flag (NOT constitution-pinned): mirrors the
 *    ff_lesson_generation_v1 / ff_outcome_prediction_v1 / ff_response_eval_v1 /
 *    ff_unified_memory_v1 / ff_model_gateway_v1 precedent — lives in FLAG_DEFAULTS
 *    as false and is intentionally NOT added to EXPECTED_OFF_FLAGS /
 *    PROTECTED_FLAGS (that list is the CEO-approved forced-OFF posture derived from
 *    migration 20260720110000; every member must be console-protected). Seed
 *    migration is owned by architect; the diagram implementation
 *    (packages/lib/src/diagram/**) is owned by ai-engineer and the API route by
 *    backend. While absent from feature_flags every read path resolves it to OFF.
 */
export const CONTENT_GENERATION_FLAGS = {
  /** Student-facing Content Generation Agent (Mermaid diagrams, GenAI Phase 5c). Default off = nothing served. */
  V1: 'ff_content_generation_v1',
} as const;

/**
 * Foxy SEL-moment flag (2026-08-31, assessment-authored SEL spec).
 *
 *  ff_foxy_sel_v1 — gates the ADDITIVE "SEL MOMENT" prompt section
 *    (`buildSelSection` in packages/lib/src/foxy/prompt-sections.ts) that is
 *    appended to the `cognitive_context_section` template variable on a
 *    TEACHING turn where an OBSERVED academic-difficulty signal just appeared.
 *
 *    The section instructs Foxy to open the turn with ONE ≤25-word sentence
 *    that acknowledges the WORK (never the person), restores agency, and points
 *    at the small next step the pedagogy mode has ALREADY chosen — then teach
 *    normally. It explicitly FORBIDS naming or guessing a feeling (same rule as
 *    Safety Rail 9 / prohibited inferences, which stays the hard floor),
 *    FORBIDS caving (no free answer, no skipped hint rung, no lowered Bloom
 *    target, no coach-mode change), and FORBIDS self-authored crisis copy — the
 *    safeguarding lane (Tier-1 screen → Tier-2 classifier → escalation) is the
 *    only surface allowed to produce that, because it alerts a real adult.
 *
 *    Route-side gates, ALL required before the section is built:
 *      1. this flag ON for the student,
 *      2. EDGE TRANSITION on the pure `detectStruggleSignal` detector — null on
 *         the prior messages, non-null including the current message (anti-spam:
 *         it never repeats on consecutive struggle turns). `repeated_wrong` is
 *         excluded (currently unreachable — sessionWrongCount is never passed),
 *      3. `isTeachingTurn(mode)` — scopes SEL out of the exam/practice template,
 *      4. NOT suppressed by a safeguarding Tier-2 classifier failure on this
 *         turn (a Tier-1 hit whose classifier threw ⇒ SEL is suppressed).
 *
 *    When OFF (default) `buildSelSection` is never called and the composed
 *    `cognitive_context_section` is BYTE-IDENTICAL to today. No template text
 *    changed and no PROMPT_REV bump: the section rides the existing
 *    {{cognitive_context_section}} slot, and `template_variables` is already in
 *    the hashed gen_ctx cache tuple, so cache keys rotate automatically.
 *
 *    P13: an SEL-bearing turn is per-student, so `selSection !== ''` is a term
 *    of the route's `cognitiveSectionIsPersonal` predicate — such a turn can
 *    never be declared `cache_scope: 'shared'` and served to another student.
 *
 *    Seeded OFF (is_enabled=false, rollout_percentage=0) by migration
 *    20260831120000_seed_ff_foxy_sel_v1.sql — REG-125 canonical shape
 *    (to_regclass guard + explicit column list + ON CONFLICT (flag_name)
 *    DO NOTHING). Ramp is an ops/CEO decision.
 *
 *    Owner: ai-engineer (wiring). Content owner: assessment. Default: false.
 */
export const FOXY_SEL_FLAGS = {
  /** Foxy SEL-moment opening line (additive cognitive_context_section append). Default off. */
  V1: 'ff_foxy_sel_v1',
} as const;
