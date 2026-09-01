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
 *   52-flag forced-OFF list: Group A + E3 + E4 + E5 + E6 + E7),
 *   20260720130000_restore_approved_flag_posture.sql (block B —
 *   ff_irt_question_selection; hard-exclusion list — the do-not-touch names),
 *   20260801100500_seed_ff_whatsapp_bot.sql (the two WhatsApp bot
 *   protected flags — ff_whatsapp_bot_v1, ff_whatsapp_alarm_template — added
 *   here 2026-07-30 as that seed's architect-ruled companion, closing its
 *   documented DB⊃TS drift BEFORE any first flip), and
 *   20260801120000_protected_feature_flags_genai_ecosystem_seed.sql (5 GenAI
 *   ecosystem flags — ff_model_gateway_v1, ff_unified_memory_v1,
 *   ff_outcome_prediction_v1, ff_lesson_generation_v1,
 *   ff_content_generation_v1 — added here 2026-08-01). These 5 were seeded
 *   OFF between 2026-07-24 and 2026-07-27 but never opted into this registry,
 *   which is why two of their siblings (ff_lesson_generation_v1,
 *   ff_content_generation_v1) could go from seeded-OFF to 100%-production-
 *   rollout in a single day (20260724220000_set_ff_generation_rollout_100.sql)
 *   with zero CI check, console confirmation, or canary alert firing — the
 *   Phase 0 safety net below is opt-in PER FLAG, and nobody had opted these
 *   in. ff_response_eval_v1, the 6th flag seeded in that same window, is
 *   deliberately EXCLUDED here: it was a knowing, CEO-authorized 100%-rollout
 *   of a fire-and-forget, metadata-only observability sensor
 *   (20260724190000_enable_ff_response_eval_v1.sql), never disabled, and not
 *   implicated in the incident — EXPECTED_OFF_FLAGS is for flags whose
 *   approved posture is OFF, which is not this one's.
 *
 *   ff_foxy_openai_primary_rollout_v1 — the Foxy OpenAI-primary provider-swap
 *   rollback lever (REG-334/REG-335 — renumbered 2026-08-03 from
 *   REG-332/REG-333 during the origin/main merge; see 00-header.md's
 *   collision note) — was added here 2026-08-03 by migration
 *   20260803120001_protect_ff_foxy_openai_primary_rollout_v1.sql, itself
 *   seeded is_enabled=false / rollout_percentage=0 the same day by
 *   20260803120000_seed_ff_foxy_openai_primary_rollout_v1.sql. It is
 *   registered as its own `ai_provider`-tier PROTECTED_FLAGS entry — separate
 *   from both the E6 MoL program group and the GenAI ecosystem group above,
 *   since it governs a different concern: what percentage of live student
 *   Foxy/ncert-solver/quiz-gen traffic is routed to Claude-primary instead of
 *   the shipped OpenAI-primary default. CEO-APPROVED INTENTIONALLY-LIVE
 *   2026-08-03 (Pradeep Sharma): its production posture is now
 *   is_enabled=true / rollout_percentage=100 (the OpenAI-primary rollback
 *   lever, deliberately pulled), so it is DELIBERATELY EXCLUDED from
 *   EXPECTED_OFF_FLAGS below — mirroring the ff_adaptive_remediation_v1 /
 *   ff_whatsapp_bot_v1 precedents. It REMAINS an ai_provider-tier
 *   PROTECTED_FLAGS entry, so the console guardrail still requires typed
 *   confirmation for any further change (and, if ever rolled back to 0%, it
 *   should be re-added to EXPECTED_OFF_FLAGS).
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
  // F9 correction (2026-08-05, Foxy North-Star Phase 0): the old text said
  // "Do not enable until calibration data exists" — self-contradictory,
  // because the nightly /api/cron/irt-calibrate cron (02:50 UTC, REG-44) HAS
  // been writing question_bank.irt_a/irt_b. The real gate is the Phase-3
  // shadow evaluation, not data existence. DB row updated in lockstep by
  // migration 20260805100300_update_ff_irt_protected_reason.sql.
  reason:
    'Calibration runs nightly (irt-calibrate cron). Enable only after the Phase-3 shadow evaluation gate passes (see docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md, E2) — cohort rollout with kill switch.',
  reasonHi:
    'कैलिब्रेशन हर रात चलता है (irt-calibrate cron)। केवल Phase-3 shadow evaluation gate पास होने के बाद ही सक्षम करें (देखें docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md, E2) — kill switch के साथ cohort rollout।',
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

  // ai_provider — GenAI ecosystem Phase 1 Model Gateway (separate program from
  // MoL above; registered 2026-08-01, closing the 2026-07-24..27 GenAI
  // generation-agent incident gap — see migration
  // 20260801120000_protected_feature_flags_genai_ecosystem_seed.sql).
  ff_model_gateway_v1: {
    tier: 'ai_provider',
    reason:
      "AI provider-routing change (GenAI Model Gateway L2; seeded OFF by migration 20260724120000, never enabled). When ON, the gateway's default policy adds an OpenAI fallback tier (gpt-4o-mini/gpt-4o) behind Anthropic for Foxy's intent classifier (packages/lib/src/ai/workflows/foxy-router.ts) — a real cross-provider routing change requiring explicit CEO provider approval that has not been given.",
    reasonHi:
      'AI प्रदाता-रूटिंग परिवर्तन (GenAI मॉडल गेटवे L2; माइग्रेशन 20260724120000 द्वारा सीड किया गया OFF, कभी सक्षम नहीं हुआ)। ON होने पर, गेटवे की default नीति Foxy के इंटेंट क्लासिफायर के लिए Anthropic के पीछे एक OpenAI फ़ॉलबैक टियर (gpt-4o-mini/gpt-4o) जोड़ती है (packages/lib/src/ai/workflows/foxy-router.ts) — यह एक वास्तविक क्रॉस-प्रदाता रूटिंग परिवर्तन है जिसके लिए स्पष्ट CEO प्रदाता स्वीकृति आवश्यक है, जो अभी तक नहीं दी गई है।',
  },

  // ai_provider — Foxy OpenAI-primary provider-swap rollback lever
  // (REG-334/REG-335, 2026-08-03 — renumbered same-day from REG-332/REG-333
  // during the origin/main merge). NOT part of the MoL program group above —
  // architect ruling (migration 20260803120001_protect_ff_foxy_openai_primary_rollout_v1.sql,
  // Task 2): protect at tier 'ai_provider' (this flag decides which AI
  // provider serves real student traffic — precisely the class of risk the
  // tier exists to gate) but do NOT reuse the shared AI_PROVIDER constant
  // above — its reason text is scoped to "(MoL program)" and would mislead
  // an operator reading the console's 409 response for this flag. Reason
  // text below is copied verbatim from that migration's `reason` column, per
  // its own OBLIGATION note. DB-layer mirror: that same migration inserts
  // the matching public.protected_feature_flags row (tier 'ai_provider').
  ff_foxy_openai_primary_rollout_v1: {
    tier: 'ai_provider',
    reason:
      'Foxy OpenAI-primary provider-swap rollback lever (REG-334, commit 5e6ffa9f, 2026-08-02): governs the percentage of live student Foxy/ncert-solver/quiz-gen traffic routed to Claude-primary instead of the shipped OpenAI-primary default. AI provider change affecting real student traffic — requires explicit CEO approval before any enable.',
    reasonHi:
      'Foxy OpenAI-प्राइमरी प्रदाता-स्वैप के लिए प्रतिशत-आधारित रोलबैक लीवर (REG-334, कमिट 5e6ffa9f, 2026-08-02): यह तय करता है कि लाइव छात्र Foxy/ncert-solver/quiz-gen ट्रैफ़िक का कितना प्रतिशत, पहले से लागू OpenAI-primary डिफ़ॉल्ट के बजाय, Claude-primary की ओर भेजा जाता है। वास्तविक छात्र ट्रैफ़िक को प्रभावित करने वाला AI प्रदाता परिवर्तन — किसी भी सक्षमीकरण से पहले CEO की स्पष्ट स्वीकृति आवश्यक है।',
  },

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
  // ff_quiz_telemetry_v1 was promoted to always-on in code (v2/quiz/submit/route.ts
  // always calls prepareQuizTelemetry unconditionally, 2026-08-06 backendaudit P0)
  // — the route no longer reads the flag, so it is NOT watched by the posture
  // canary (EXPECTED_OFF_FLAGS). It REMAINS a PROTECTED_FLAGS entry (staged_rollout)
  // so any further flag change still requires typed confirmation; the DB mirror
  // row (migration 20260722090000) is unchanged.
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

  // staged_rollout — WhatsApp bot protected pair (DB seed migration
  // 20260801100500_seed_ff_whatsapp_bot.sql; TS companion landed 2026-07-30
  // per that seed's OBLIGATION header — the two registries are in lockstep).
  // Tier and reason mirror the DB protected_feature_flags rows.
  ff_whatsapp_bot_v1: {
    tier: 'staged_rollout',
    reason:
      'WhatsApp bot MASTER kill switch (default-OFF, CEO-gated staged rollout per the approved 2026-07-29 WhatsApp bot plan). Enabling activates all inbound processing and outbound sends for the channel; flip only via admin_flip_feature_flag, per approved rollout step.',
    reasonHi:
      'WhatsApp बॉट का MASTER किल स्विच (डिफ़ॉल्ट-OFF, स्वीकृत 2026-07-29 WhatsApp बॉट योजना के अनुसार CEO-गेटेड चरणबद्ध रोलआउट)। सक्षम करने से चैनल की सभी inbound प्रोसेसिंग और outbound सेंड सक्रिय हो जाती हैं; केवल admin_flip_feature_flag से, स्वीकृत रोलआउट चरण के अनुसार ही फ़्लिप करें।',
  },
  ff_whatsapp_alarm_template: {
    tier: 'staged_rollout',
    reason:
      'The only recurring PAID WhatsApp template send (daily alarm — 2026-07-29 WhatsApp bot plan). Premature or bulk enable spends real money per recipient per day AND risks the WhatsApp number quality rating (block-rate driven). Staged 5/25/100 percent with quality monitoring; flip only via admin_flip_feature_flag.',
    reasonHi:
      'एकमात्र आवर्ती PAID WhatsApp टेम्पलेट सेंड (डेली अलार्म — 2026-07-29 WhatsApp बॉट योजना)। समय-पूर्व या बल्क सक्षम करने से प्रति प्राप्तकर्ता प्रतिदिन वास्तविक खर्च होता है और WhatsApp नंबर की quality rating को खतरा होता है। quality निगरानी के साथ 5/25/100 प्रतिशत चरणबद्ध; केवल admin_flip_feature_flag से फ़्लिप करें।',
  },

  // staged_rollout — GenAI ecosystem flags registered 2026-08-01 (incident
  // gap closure; see migration
  // 20260801120000_protected_feature_flags_genai_ecosystem_seed.sql and the
  // header note above). ff_model_gateway_v1 (ai_provider tier) is declared
  // earlier, next to the MoL group.
  ff_unified_memory_v1: {
    tier: 'staged_rollout',
    reason:
      "Seeded OFF by migration 20260724130000, not yet enabled (design spec docs/superpowers/specs/2026-07-24-unified-student-memory-design.md Sec 2.3/3). The DPDP erasure-pending interlock this flag used to be blocked on was removed 2026-08-30 along with the DPDP erasure subsystem (see supabase/migrations/20260830172610_remove_dpdp_erasure_system.sql), and the getStudentMemory composer now exists at apps/host/src/lib/memory/student-memory.ts. Remains staged_rollout pending an explicit rollout decision, not a known blocker.",
    reasonHi:
      'माइग्रेशन 20260724130000 द्वारा सीड किया गया OFF, अभी सक्षम नहीं हुआ (डिज़ाइन स्पेक docs/superpowers/specs/2026-07-24-unified-student-memory-design.md खंड 2.3/3)। यह फ़्लैग पहले जिस DPDP erasure-pending इंटरलॉक पर अवरुद्ध था, उसे 2026-08-30 को DPDP erasure सबसिस्टम के साथ हटा दिया गया (देखें supabase/migrations/20260830172610_remove_dpdp_erasure_system.sql), और getStudentMemory कंपोज़र अब apps/host/src/lib/memory/student-memory.ts पर मौजूद है। किसी ज्ञात अवरोधक के बजाय, स्पष्ट रोलआउट निर्णय की प्रतीक्षा में staged_rollout बना हुआ है।',
  },
  ff_outcome_prediction_v1: {
    tier: 'staged_rollout',
    reason:
      'Read-only Outcome Prediction Agent endpoint (GenAI Phase 5a; seeded OFF by migration 20260724150000, never enabled). Backend route and tests are complete, but zero UI surface reaches it — verified no reference to predict/outcome or outcome_prediction anywhere under apps/host/src/app outside the route itself. Enabling today would activate a route nobody can navigate to; hold OFF until a UI consumer ships.',
    reasonHi:
      'रीड-ओनली Outcome Prediction Agent एंडपॉइंट (GenAI Phase 5a; माइग्रेशन 20260724150000 द्वारा सीड किया गया OFF, कभी सक्षम नहीं हुआ)। बैकएंड रूट और टेस्ट पूर्ण हैं, लेकिन इस तक पहुँचने के लिए कोई UI सतह मौजूद नहीं है — सत्यापित: apps/host/src/app में रूट के अलावा कहीं भी predict/outcome या outcome_prediction का कोई संदर्भ नहीं है। आज सक्षम करने से एक ऐसा रूट सक्रिय हो जाएगा जिस तक कोई नहीं पहुँच सकता; UI उपभोक्ता के लॉन्च होने तक OFF रखें।',
  },
  ff_lesson_generation_v1: {
    tier: 'staged_rollout',
    reason:
      "Student-facing Lesson Generation Agent (GenAI Phase 5b): escalated to 100% same-day (migration 20260724220000) then FORCE-DISABLED 3 days later (20260727120000) because it abstained on ~100% of requests — production has zero cbse_syllabus rows at rag_status='ready' under the strict-mode coverage precheck, a dead end, not a degradation. Do NOT re-enable until (a) the coverage/confidence gate fix has landed (chapters legitimately reaching rag_status='ready', or a deliberately revised readiness predicate) AND (b) that fix is validated against production data with a real grounded, non-abstain response.",
    reasonHi:
      "छात्र-मुखी Lesson Generation Agent (GenAI Phase 5b): उसी दिन 100% तक बढ़ाया गया (माइग्रेशन 20260724220000) फिर 3 दिन बाद बलपूर्वक अक्षम किया गया (20260727120000) क्योंकि यह लगभग 100% अनुरोधों पर abstain करता था — प्रोडक्शन में strict-mode coverage precheck के तहत rag_status='ready' वाली कोई cbse_syllabus पंक्ति नहीं है, यह एक डेड एंड है, गुणवत्ता में कमी नहीं। तब तक पुनः सक्षम न करें जब तक (a) coverage/confidence गेट फिक्स न आ जाए (चैप्टर वास्तव में rag_status='ready' तक पहुँचें, या readiness predicate जानबूझकर संशोधित हो) और (b) वह फिक्स प्रोडक्शन डेटा के विरुद्ध वास्तविक ग्राउंडेड, non-abstain प्रतिक्रिया से सत्यापित हो।",
  },
  ff_content_generation_v1: {
    tier: 'staged_rollout',
    reason:
      "Student-facing Content Generation Agent, Mermaid diagrams (GenAI Phase 5c): escalated to 100% same-day (migration 20260724220000) then FORCE-DISABLED 3 days later (20260727120000) because it abstained on ~100% of requests — production has zero cbse_syllabus rows at rag_status='ready' under the strict-mode coverage precheck, a dead end, not a degradation. Do NOT re-enable until (a) the coverage/confidence gate fix has landed (chapters legitimately reaching rag_status='ready', or a deliberately revised readiness predicate) AND (b) that fix is validated against production data with a real grounded, non-abstain response.",
    reasonHi:
      "छात्र-मुखी Content Generation Agent, Mermaid डायग्राम (GenAI Phase 5c): उसी दिन 100% तक बढ़ाया गया (माइग्रेशन 20260724220000) फिर 3 दिन बाद बलपूर्वक अक्षम किया गया (20260727120000) क्योंकि यह लगभग 100% अनुरोधों पर abstain करता था — प्रोडक्शन में strict-mode coverage precheck के तहत rag_status='ready' वाली कोई cbse_syllabus पंक्ति नहीं है, यह एक डेड एंड है, गुणवत्ता में कमी नहीं। तब तक पुनः सक्षम न करें जब तक (a) coverage/confidence गेट फिक्स न आ जाए (चैप्टर वास्तव में rag_status='ready' तक पहुँचें, या readiness predicate जानबूझकर संशोधित हो) और (b) वह फिक्स प्रोडक्शन डेटा के विरुद्ध वास्तविक ग्राउंडेड, non-abstain प्रतिक्रिया से सत्यापित हो।",
  },

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
 * 20260720130000) plus ff_whatsapp_alarm_template (WhatsApp bot
 * protected flag, seeded fully OFF by 20260801100500; added here
 * 2026-07-30 as that seed's companion) plus the 5 GenAI ecosystem flags
 * added 2026-08-01 — ff_model_gateway_v1, ff_unified_memory_v1,
 * ff_outcome_prediction_v1, ff_lesson_generation_v1,
 * ff_content_generation_v1 — all still seeded OFF/0% today (see migration
 * 20260801120000_protected_feature_flags_genai_ecosystem_seed.sql and the
 * per-flag reasons above for why each is not yet ready to enable). The
 * flag-posture-canary cron compares live rows against this list nightly.
 *
 * NOT in this list (on purpose): ff_atomic_subscription_activation (its
 * approved posture is is_enabled=TRUE), ff_board_score_v1,
 * reconcile_stuck_subscriptions_enabled, and all ff_python_* flags
 * (metadata-envelope controlled -- their columns are not posture).
 *
 * ALSO NOT in this list (on purpose, as of 2026-07-22): ff_adaptive_remediation_v1
 * (Phase A Loop A adaptive-remediation). CEO-approved in this conversation
 * (2026-07-22): a deliberate, confirmed production pilot at 10% rollout via
 * the super-admin console's admin_flip_feature_flag RPC -- a genuine change of
 * approved posture, not drift. is_enabled=true / rollout_percentage=10 is now
 * this flag's CEO-approved canary baseline, replacing "must be fully OFF."
 * It remains a `constitution_pinned` entry in PROTECTED_FLAGS above, so the
 * console guardrail still requires typed confirmation for any FURTHER
 * increase beyond 10% (e.g. a bump to 50% or 100%). If this pilot is ever
 * fully rolled back to 0%, re-add 'ff_adaptive_remediation_v1' to this list
 * (or introduce a dedicated "expected active at rollout X" concept if more
 * flags reach this state) before the canary can enforce that baseline again.
 *
 * ALSO NOT in this list (on purpose, as of 2026-07-30): ff_whatsapp_bot_v1.
 * CEO-approved deliberate live flip to is_enabled=true,
 * rollout_percentage=100 (audited via admin_flip_feature_flag) to
 * exercise the end-to-end WhatsApp bot in production -- an approved
 * posture change, not drift. Mirrors the ff_adaptive_remediation_v1
 * precedent immediately above. It remains a `constitution_pinned`
 * entry in PROTECTED_FLAGS above, so any FURTHER change still requires
 * typed confirmation. If ever rolled back to 0%, re-add
 * 'ff_whatsapp_bot_v1' to this list.
 *
 * ALSO NOT in this list (on purpose, as of 2026-08-19):
 * ff_adaptive_loops_bc_v1 and ff_school_pulse_v1. CEO-approved (Pradeep
 * Sharma) INTENTIONALLY-LIVE. Both were flipped is_enabled=true in production
 * on 2026-08-18 16:27 UTC through admin_flip_feature_flag -- the governed,
 * typed-confirm RPC -- and both flips are recorded in admin_audit_log under
 * action 'feature_flag.protected_flip_rpc' by admin 2b0ae0a9. That is an
 * authorised rollout, not the 2026-07-20 console bulk-enable failure mode this
 * canary exists to catch, so leaving them listed here made every production
 * deploy since fail its post-deploy flag-posture gate on a state an operator
 * had deliberately and correctly set (Deploy Production #1410, #1411).
 *
 * CAVEAT, deliberately recorded rather than silently blessed: both rows are
 * live at rollout_percentage = NULL, not at an explicit staged number the way
 * ff_adaptive_remediation_v1 (10%) and ff_foxy_openai_primary_rollout_v1 (100%)
 * were. NULL is ungated, not a staged rollout, and the protected_feature_flags
 * reason string for both asks for a staged-rollout runbook (REG-124 /
 * REG-126..129 / REG-131..134 / REG-175). If the intent was a staged pilot,
 * set an explicit rollout_percentage; if either is ever rolled back to
 * is_enabled=false / 0, re-add it here -- mirroring the
 * ff_adaptive_remediation_v1 / ff_whatsapp_bot_v1 /
 * ff_foxy_openai_primary_rollout_v1 precedents below.
 *
 * BACK in this list as of 2026-09-01: ff_foxy_openai_primary_rollout_v1.
 * History: seeded is_enabled=false / rollout_percentage=0 by migration
 * 20260803120000 and listed here; REMOVED 2026-08-03 when #1443 pulled the
 * OpenAI-primary rollback lever to a CEO-approved intentionally-live 100%
 * (live, therefore not drift, therefore correctly not expected-off).
 * RE-ADDED 2026-09-01: migration 20260901140000 returns it to
 * is_enabled=false / rollout_percentage=0 on CEO direction (Pradeep Sharma)
 * to make Anthropic the primary provider for Foxy teaching with OpenAI as
 * the fallback tier — this file's own standing instruction for that case was
 * "If ever rolled back to 0%, re-add ... to this list", mirroring the
 * ff_adaptive_remediation_v1 / ff_whatsapp_bot_v1 precedents above.
 * It remains an `ai_provider` entry in PROTECTED_FLAGS above, so any FURTHER
 * change still requires typed confirmation; re-pulling the lever to 100%
 * means removing it from this list again AND carrying a
 * CEO-APPROVED-FLAG-FLIP marker in the enabling migration.
 */
export const EXPECTED_OFF_FLAGS: string[] = [
  // Group A — constitution-pinned. ff_adaptive_loops_bc_v1 and
  // ff_school_pulse_v1 left this list on 2026-08-19 (CEO-approved
  // intentionally-live; see the header note above) and remain
  // constitution_pinned entries in PROTECTED_FLAGS.
  'ff_digital_twin_v1',
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
  // ff_quiz_telemetry_v1 promoted to always-on in code (v2/quiz/submit/route.ts
  // unconditionally calls prepareQuizTelemetry, 2026-08-06 backendaudit P0).
  // Remains a PROTECTED_FLAGS entry above so any further flag change requires
  // typed confirmation. If the always-on code path is ever gated behind a flag
  // again, re-add 'ff_quiz_telemetry_v1' to this list.
  'ff_institution_entitlements_v1',
  'ff_foxy_curriculum_guard_v1',
  'ff_unified_quiz_v1',
  'ff_alfabot_lead_capture_v1',
  'ff_demo_accounts_v2',
  'ff_tutor_v1',
  // ff_foxy_streaming, ff_goal_aware_rag, ff_grounded_ai_concept_engine: approved intentionally-live (2026-08-03) — code review found them to be real, tested, functioning features with no incident history; full rationale in commit message.
  'ff_goal_daily_plan',
  'ff_goal_daily_plan_reminder',
  'improvement_mode',
  'improvement_auto_detect',
  'improvement_recommendations',
  'improvement_auto_stage',
  'ff_offline_payment_reconciliation_v1',
  'ff_school_contracts_v1',
  'ff_gst_invoicing_v1',
  // Restore block B — dormant-by-design
  'ff_irt_question_selection',
  // WhatsApp bot protected pair — seeded fully OFF by 20260801100500
  // (2026-07-29 plan); companion addition 2026-07-30. ff_whatsapp_bot_v1
  // REMOVED from this list 2026-07-30: CEO-approved live flip to
  // is_enabled=true, rollout_percentage=100 (audited via
  // admin_flip_feature_flag) to exercise the end-to-end WhatsApp bot in
  // production. Mirrors the ff_adaptive_remediation_v1 10%-pilot
  // precedent above — an approved posture change is not drift. It
  // remains a constitution_pinned entry in PROTECTED_FLAGS above, so
  // any FURTHER change still requires typed confirmation. If ever
  // rolled back to 0%, re-add 'ff_whatsapp_bot_v1' to this list.
  'ff_whatsapp_alarm_template',
  // GenAI ecosystem flags — registered 2026-08-01, closing the
  // 2026-07-24..27 GenAI generation-agent incident gap (see the header note
  // above and migration 20260801120000_protected_feature_flags_genai_
  // ecosystem_seed.sql). All 5 are still seeded OFF/0% as of this addition.
  // ff_response_eval_v1 is deliberately NOT included — its approved posture
  // is is_enabled=TRUE (see header note).
  'ff_model_gateway_v1',
  'ff_unified_memory_v1',
  'ff_outcome_prediction_v1',
  'ff_lesson_generation_v1',
  'ff_content_generation_v1',
  // ff_foxy_openai_primary_rollout_v1 — RE-ADDED 2026-09-01, per the standing
  // instruction this list carried while the flag was out ("If ever rolled back
  // to 0%, re-add ... here").
  //
  // Timeline: seeded OFF by 20260803120000 and listed here → REMOVED
  // 2026-08-03 when #1443 pulled the OpenAI-primary rollback lever to a
  // CEO-approved intentionally-live 100% (live by decision, so genuinely not
  // drift) → back to is_enabled=false / rollout_percentage=0 by migration
  // 20260901140000 on CEO direction (Pradeep Sharma), making Anthropic the
  // primary provider for Foxy teaching with OpenAI as the fallback tier.
  //
  // With the lever at 0%, resolveModelOrder falls through to
  // MODEL_FALLBACK_ORDER (anthropic first). Watching it here is what stops
  // that silently reverting: an unaudited flip back to 100% would swap every
  // identified caller to OpenAI-primary, and this entry makes the posture
  // canary fail on it instead of letting it ride.
  'ff_foxy_openai_primary_rollout_v1',
];
