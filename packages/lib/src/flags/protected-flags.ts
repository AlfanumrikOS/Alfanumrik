/**
 * Protected-flag registry — guardrail after the 2026-07-20 console bulk-enable
 * incident (an operator bulk-enable re-armed 49 of the 52 CEO-approved
 * forced-OFF flags at rollout 100; restored by migration
 * 20260720130000_restore_approved_flag_posture.sql).
 *
 * Consumed by:
 *   - apps/host/src/app/api/super-admin/feature-flags/route.ts — the console
 *     API refuses to make a protected flag MORE enabled (and, for the
 *     payment-safety tiers, refuses to disable it) without an explicit typed
 *     confirmation: body.confirm === the exact flag_name (409 FLAG_PROTECTED
 *     otherwise, before any DB write or audit).
 *   - apps/host/src/app/api/cron/flag-posture-canary/route.ts — nightly drift
 *     canary comparing EXPECTED_OFF_FLAGS against live feature_flags rows.
 *
 * Source of truth for the lists: migrations
 *   20260720110000_feature_flags_data_repair_ceo_approved.sql (block ii — the
 *   52-flag forced-OFF list: Group A + E3 + E4 + E5 + E6 + E7) and
 *   20260720130000_restore_approved_flag_posture.sql (block B —
 *   ff_irt_question_selection; hard-exclusion list — the do-not-touch names).
 *
 * NOTE: this registry protects flags at the CONSOLE boundary. It does not (and
 * cannot) change how any flag evaluates at runtime.
 *
 * DB-layer mirror (2026-07-22, Phase 0 flag-governance hardening): this
 * registry's PROTECTED_FLAGS keys are ALSO mirrored 1:1 into
 * public.protected_feature_flags (migration
 * 20260722090000_protected_feature_flags_registry.sql), which a BEFORE
 * UPDATE trigger on feature_flags (migration
 * 20260722090100_feature_flags_db_guard_trigger.sql) reads to block a
 * direct-Postgres/Supabase-Studio mutation from bypassing this CONSOLE-layer
 * guardrail entirely -- the vector the 2026-07-20 incident's operator action
 * resembles. A static parity test
 * (apps/host/src/__tests__/api/super-admin/feature-flags-protected-guardrail.test.ts)
 * pins the two registries together going forward. If you add/remove a
 * PROTECTED_FLAGS entry, add a companion migration updating
 * protected_feature_flags in the SAME change.
 */

export type ProtectedTier =
  | 'p0_outage'
  | 'p11_payment'
  | 'ai_provider'
  | 'constitution_pinned'
  | 'staged_rollout'
  | 'special_do_not_touch';

export interface FlagProtection {
  tier: ProtectedTier;
  reason: string;
  reasonHi?: string;
}

// ─── Reusable reason strings (one per tier/group) ───────────────────────────

const P0_QUIZ_SUBMIT: FlagProtection = {
  tier: 'p0_outage',
  reason:
    'Enabling without deployed preconditions breaks quiz submission for all students (P0 outage class).',
  reasonHi:
    'तैनात पूर्व-शर्तों के बिना सक्षम करने से सभी छात्रों के लिए क्विज़ सबमिशन टूट जाता है (P0 आउटेज श्रेणी)।',
};

const P11_SKU: FlagProtection = {
  tier: 'p11_payment',
  reason:
    'Payment-coupled flag: the ₹999 Razorpay SKU must exist before this can be enabled (P11).',
  reasonHi:
    'भुगतान से जुड़ा फ़्लैग: सक्षम करने से पहले ₹999 का Razorpay SKU मौजूद होना चाहिए (P11)।',
};

const AI_PROVIDER: FlagProtection = {
  tier: 'ai_provider',
  reason:
    'AI provider change (MoL program): requires explicit CEO approval before any enable.',
  reasonHi:
    'AI प्रदाता परिवर्तन (MoL प्रोग्राम): सक्षम करने से पहले CEO की स्पष्ट स्वीकृति आवश्यक है।',
};

const CONSTITUTION_PINNED: FlagProtection = {
  tier: 'constitution_pinned',
  reason:
    'Constitution-pinned default-OFF; staged-rollout runbook required (REG-124 / REG-126..129 / REG-131..134 / REG-175).',
  reasonHi:
    'संविधान-पिन्ड डिफ़ॉल्ट-OFF; चरणबद्ध रोलआउट रनबुक आवश्यक (REG-124 / REG-126..129 / REG-131..134 / REG-175)।',
};

const STAGED_ROLLOUT: FlagProtection = {
  tier: 'staged_rollout',
  reason:
    'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.',
  reasonHi:
    'CEO-स्वीकृत forced-OFF स्थिति (माइग्रेशन 20260720110000 ब्लॉक ii): फ़ीचर बना नहीं, लॉन्च नहीं हुआ, या रिटायर है। स्वीकृत रोलआउट योजना के बिना पुनः सक्षम न करें।',
};

const IRT_DORMANT: FlagProtection = {
  tier: 'staged_rollout',
  reason:
    'Dormant by design ("off until IRT calibration accumulates" — Foxy moat plan / constitution). Do not enable until calibration data exists.',
  reasonHi:
    'डिज़ाइन से निष्क्रिय ("IRT कैलिब्रेशन जमा होने तक OFF" — Foxy moat plan)। कैलिब्रेशन डेटा बनने तक सक्षम न करें।',
};

const PYTHON_ENVELOPE: FlagProtection = {
  tier: 'special_do_not_touch',
  reason:
    'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.',
  reasonHi:
    'ff_python_* फ़्लैग metadata jsonb envelope (python-ai-proxy) से नियंत्रित होते हैं, is_enabled/rollout_percentage से नहीं। कंसोल से कॉलम बदलना निरर्थक या हानिकारक है।',
};

// ─── The registry ───────────────────────────────────────────────────────────

export const PROTECTED_FLAGS: Record<string, FlagProtection> = {
  // p0_outage — E3 quiz-submit hardening pair
  ff_server_only_quiz_submit: P0_QUIZ_SUBMIT,
  ff_v1_quiz_rpc_web_blocked: P0_QUIZ_SUBMIT,

  // p11_payment
  ff_competitive_exams_v1: P11_SKU,

  // ai_provider — E6 MoL program (paused)
  ff_mol_enabled: AI_PROVIDER,
  ff_mol_hybrid_mode_v1: AI_PROVIDER,
  ff_mol_openai_default: AI_PROVIDER,
  ff_grounded_answer_mol_shadow_v1: AI_PROVIDER,
  ff_mol_shadow_text_capture_v1: AI_PROVIDER,

  // constitution_pinned — Group A (REG-124/126/131/175)
  ff_adaptive_remediation_v1: CONSTITUTION_PINNED,
  ff_adaptive_loops_bc_v1: CONSTITUTION_PINNED,
  ff_digital_twin_v1: CONSTITUTION_PINNED,
  ff_school_pulse_v1: CONSTITUTION_PINNED,

  // constitution_pinned — Pedagogy v2 flags added 2026-07-22 (Phase 0
  // flag-governance hardening): these were live constitution-pinned
  // default-OFF flags NOT yet enumerated in this registry. Added here and in
  // the DB mirror (migration 20260722090000_protected_feature_flags_registry.sql)
  // in the same change so the two registries land in lockstep.
  ff_productive_failure_v1: CONSTITUTION_PINNED,
  ff_pedagogy_v2_monthly_synthesis: CONSTITUTION_PINNED,

  // staged_rollout — E4 wave2/wave3 placeholders (migration 20260720110000)
  wave2_group_sessions: STAGED_ROLLOUT,
  wave2_video_lessons: STAGED_ROLLOUT,
  wave2_teacher_classroom: STAGED_ROLLOUT,
  wave2_multilingual_12: STAGED_ROLLOUT,
  wave2_all_subjects: STAGED_ROLLOUT,
  wave2_jee_neet_prep: STAGED_ROLLOUT,
  wave3_voice_tutor: STAGED_ROLLOUT,
  wave3_govt_school_mode: STAGED_ROLLOUT,
  wave3_phygital_centers: STAGED_ROLLOUT,
  video_lessons: STAGED_ROLLOUT,
  voice_tutor: STAGED_ROLLOUT,
  group_sessions: STAGED_ROLLOUT,

  // staged_rollout — E5 orchestrator / learner-loop platform (not launched)
  ff_orchestrator_v1: STAGED_ROLLOUT,
  ff_rule_engine_v1: STAGED_ROLLOUT,
  ff_learner_loop_v1: STAGED_ROLLOUT,
  ff_learner_loop_dashboard_v1: STAGED_ROLLOUT,
  ff_scheduled_actions_v1: STAGED_ROLLOUT,
  ff_scan_to_queue_v1: STAGED_ROLLOUT,
  ff_personalised_compete_v1: STAGED_ROLLOUT,

  // staged_rollout — E7 never-ramped / retired experiments
  ff_class_leaderboard_v1: STAGED_ROLLOUT,
  ff_streak_guardian_cron_v1: STAGED_ROLLOUT,
  ff_quiz_telemetry_v1: STAGED_ROLLOUT,
  ff_institution_entitlements_v1: STAGED_ROLLOUT,
  ff_foxy_curriculum_guard_v1: STAGED_ROLLOUT,
  ff_unified_quiz_v1: STAGED_ROLLOUT,
  ff_alfabot_lead_capture_v1: STAGED_ROLLOUT,
  ff_demo_accounts_v2: STAGED_ROLLOUT,
  ff_tutor_v1: STAGED_ROLLOUT,
  ff_foxy_streaming: STAGED_ROLLOUT,
  ff_goal_daily_plan: STAGED_ROLLOUT,
  ff_goal_aware_rag: STAGED_ROLLOUT,
  ff_goal_daily_plan_reminder: STAGED_ROLLOUT,
  improvement_mode: STAGED_ROLLOUT,
  improvement_auto_detect: STAGED_ROLLOUT,
  improvement_recommendations: STAGED_ROLLOUT,
  improvement_auto_stage: STAGED_ROLLOUT,
  ff_grounded_ai_concept_engine: STAGED_ROLLOUT,
  ff_offline_payment_reconciliation_v1: STAGED_ROLLOUT,
  ff_school_contracts_v1: STAGED_ROLLOUT,
  ff_gst_invoicing_v1: STAGED_ROLLOUT,

  // staged_rollout — dormant until IRT calibration accumulates (restore block B)
  ff_irt_question_selection: IRT_DORMANT,

  // special_do_not_touch — controlled outside the console
  ff_atomic_subscription_activation: {
    tier: 'special_do_not_touch',
    reason:
      'P11 payment kill-switch read directly by the Razorpay webhook fallback. enabled-at-rollout-0 is its CORRECT shape; disabling it 503s subscription activation. Do not touch from the console.',
    reasonHi:
      'P11 भुगतान kill-switch, Razorpay webhook fallback सीधे पढ़ता है। enabled-at-rollout-0 ही इसकी सही स्थिति है; disable करने से सब्सक्रिप्शन activation 503 हो जाता है। कंसोल से न छेड़ें।',
  },
  ff_board_score_v1: {
    tier: 'special_do_not_touch',
    reason: 'Excluded per standing CEO instruction (20260720110000 hard-exclusion list). Controlled outside the console.',
    reasonHi: 'CEO के स्थायी निर्देश पर बहिष्कृत (20260720110000 hard-exclusion सूची)। कंसोल के बाहर नियंत्रित।',
  },
  reconcile_stuck_subscriptions_enabled: {
    tier: 'special_do_not_touch',
    reason: 'Payment-reconciliation control, excluded per standing CEO instruction. Controlled outside the console.',
    reasonHi: 'भुगतान-समाधान नियंत्रण, CEO के स्थायी निर्देश पर बहिष्कृत। कंसोल के बाहर नियंत्रित।',
  },

  // special_do_not_touch — ff_python_* (metadata-envelope controlled; the
  // enumerated names below are every ff_python_ flag seeded in
  // supabase/migrations as of 2026-07-20; the prefix rule in getProtection()
  // covers any name this list drifts behind).
  ff_python_ai_services_v1: PYTHON_ENVELOPE,
  ff_python_bulk_question_gen_v1: PYTHON_ENVELOPE,
  ff_python_generate_answers_v1: PYTHON_ENVELOPE,
  ff_python_generate_concepts_v1: PYTHON_ENVELOPE,
  ff_python_voice_tts_v1: PYTHON_ENVELOPE,
  ff_python_ncert_solver_v1: PYTHON_ENVELOPE,
  ff_python_cme_engine_v1: PYTHON_ENVELOPE,
  ff_python_foxy_tutor_v1: PYTHON_ENVELOPE,
  ff_python_quiz_generator_v1: PYTHON_ENVELOPE,
  ff_python_monthly_synthesis_builder_v1: PYTHON_ENVELOPE,
  ff_python_nep_compliance_v1: PYTHON_ENVELOPE,
  ff_python_grade_experiment_conclusion_v1: PYTHON_ENVELOPE,
  ff_python_verify_question_bank_v1: PYTHON_ENVELOPE,
  ff_python_extract_ncert_questions_v1: PYTHON_ENVELOPE,
  ff_python_parent_report_generator_v1: PYTHON_ENVELOPE,
  ff_python_bulk_non_mcq_gen_v1: PYTHON_ENVELOPE,
};

/** Prefixes whose EVERY member is protected, even if not enumerated above. */
const PROTECTED_PREFIXES: ReadonlyArray<{ prefix: string; protection: FlagProtection }> = [
  { prefix: 'ff_python_', protection: PYTHON_ENVELOPE },
];

/**
 * Look up protection for a flag name. Exact-name match first, then the
 * ff_python_ prefix rule (so a newly seeded ff_python_* flag is protected
 * before anyone remembers to add it here).
 */
export function getProtection(flagName: string): FlagProtection | null {
  const exact = PROTECTED_FLAGS[flagName];
  if (exact) return exact;
  for (const { prefix, protection } of PROTECTED_PREFIXES) {
    if (flagName.startsWith(prefix)) return protection;
  }
  return null;
}

/**
 * Every flag whose CEO-approved posture is is_enabled=false AND
 * rollout_percentage=0: the 52-flag block-(ii) list from migration
 * 20260720110000 plus ff_irt_question_selection (restore block B in
 * 20260720130000). The flag-posture-canary cron compares live rows against
 * this list nightly.
 *
 * NOT in this list (on purpose): ff_atomic_subscription_activation (its
 * approved posture is is_enabled=TRUE), ff_board_score_v1,
 * reconcile_stuck_subscriptions_enabled, and all ff_python_* flags
 * (metadata-envelope controlled — their columns are not posture).
 */
export const EXPECTED_OFF_FLAGS: string[] = [
  // Group A — constitution-pinned
  'ff_adaptive_remediation_v1',
  'ff_adaptive_loops_bc_v1',
  'ff_digital_twin_v1',
  'ff_school_pulse_v1',
  // Pedagogy v2 constitution-pinned flags added 2026-07-22
  'ff_productive_failure_v1',
  'ff_pedagogy_v2_monthly_synthesis',
  // E3 — quiz-submit hardening + payment-coupled
  'ff_server_only_quiz_submit',
  'ff_v1_quiz_rpc_web_blocked',
  'ff_competitive_exams_v1',
  // E4 — wave2/wave3 placeholders
  'wave2_group_sessions',
  'wave2_video_lessons',
  'wave2_teacher_classroom',
  'wave2_multilingual_12',
  'wave2_all_subjects',
  'wave2_jee_neet_prep',
  'wave3_voice_tutor',
  'wave3_govt_school_mode',
  'wave3_phygital_centers',
  'video_lessons',
  'voice_tutor',
  'group_sessions',
  // E5 — orchestrator / learner-loop platform
  'ff_orchestrator_v1',
  'ff_rule_engine_v1',
  'ff_learner_loop_v1',
  'ff_learner_loop_dashboard_v1',
  'ff_scheduled_actions_v1',
  'ff_scan_to_queue_v1',
  'ff_personalised_compete_v1',
  // E6 — MoL program
  'ff_mol_enabled',
  'ff_mol_hybrid_mode_v1',
  'ff_mol_openai_default',
  'ff_grounded_answer_mol_shadow_v1',
  'ff_mol_shadow_text_capture_v1',
  // E7 — never-ramped / retired experiments
  'ff_class_leaderboard_v1',
  'ff_streak_guardian_cron_v1',
  'ff_quiz_telemetry_v1',
  'ff_institution_entitlements_v1',
  'ff_foxy_curriculum_guard_v1',
  'ff_unified_quiz_v1',
  'ff_alfabot_lead_capture_v1',
  'ff_demo_accounts_v2',
  'ff_tutor_v1',
  'ff_foxy_streaming',
  'ff_goal_daily_plan',
  'ff_goal_aware_rag',
  'ff_goal_daily_plan_reminder',
  'improvement_mode',
  'improvement_auto_detect',
  'improvement_recommendations',
  'improvement_auto_stage',
  'ff_grounded_ai_concept_engine',
  'ff_offline_payment_reconciliation_v1',
  'ff_school_contracts_v1',
  'ff_gst_invoicing_v1',
  // Restore block B — dormant-by-design
  'ff_irt_question_selection',
];
