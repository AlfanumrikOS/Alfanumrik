-- Migration: 20260720110000_feature_flags_data_repair_ceo_approved.sql
-- Purpose: Feature-flag RCA repair (data half, "Migration B") — the CEO-approved
--          one-time repair of already-seeded public.feature_flags rows. Companion
--          to the structural fix 20260720100000_feature_flags_rollout_default_and_anon_read.sql
--          (rollout_percentage DEFAULT 0 → 100 + anon SELECT policy), which fixed
--          the root cause for FUTURE rows but deliberately left existing rows
--          untouched. This file repairs the existing rows in three approved blocks.
--
-- CEO approval: 2026-07-20 (explicit per-flag lists, ceo@alfanumrik.com).
-- RCA reference: feature-flags-rca-repair branch; see the RCA narrative in the
--   header of 20260720100000 — "enabled flags born OFF": the old column DEFAULT 0
--   plus the evaluator's rollout_percentage <= 0 ⇒ unconditionally-FALSE rule
--   (packages/lib/src/feature-flags.ts, isFeatureEnabled) left 88 of 180 prod rows
--   in the lying state is_enabled=true AND rollout_percentage=0 (reads as ON in
--   the console, evaluates OFF for every user), and 17 enabled rows env-scoped
--   out of production.
--
-- ─── Per-block rationale ─────────────────────────────────────────────────────
--
-- Block (i) ACTIVATE (25 flags): rows that are MEANT to be live in production
--   and are only dark because of the rollout-0 landmine. Sets rollout 100 so the
--   evaluator agrees with the console. Guarded by is_enabled=true AND
--   rollout_percentage=0 so it never touches a row an operator has since changed.
--   Includes the 5 E1 flags, verified in-source 2026-07-20 (architect):
--     * adaptive_post_quiz, foxy_cognitive_engine, foxy_diagram_rendering,
--       quiz_assembler_v2 — NO runtime consumers anywhere in the repo (only
--       docs/feature-flags.md entries, which document their default as ON).
--     * ai_intent_router — NO runtime consumer; the name appears only in prose
--       comments (apps/host/src/app/api/foxy/route.ts:1020,
--       apps/host/src/app/api/foxy/_lib/legacy-flow.ts:20). The live gate on
--       that path is ff_grounded_ai_foxy via isFeatureEnabled.
--   Activation of all 5 is therefore harmless honesty — no behavior change,
--   the DB simply stops lying about a switch nothing reads (and for the four
--   documented kill-switches, matches their documented default-ON intent).
--
-- Block (ii) HONESTY-FIX (52 flags): rows showing is_enabled=true that must NOT
--   evaluate ON. Today they are OFF only by the rollout-0 accident (or by env
--   scoping); after the structural DEFAULT change, leaving them "enabled at 0"
--   is a standing landmine for any operator who edits the row. This block makes
--   the OFF state explicit and honest: is_enabled=false, rollout_percentage=0.
--     Group A — ff_adaptive_remediation_v1, ff_adaptive_loops_bc_v1,
--       ff_digital_twin_v1, ff_school_pulse_v1: CEO-confirmed stay OFF per
--       constitution pins REG-124 / REG-126..129 / REG-131..134 / REG-175
--       (default-OFF is the pinned, tested posture).
--     E3 — quiz-submit hardening flags not yet ramped.
--     E4 — wave2/wave3 marketing-era placeholders (features not built/retired).
--     E5 — orchestrator/learner-loop platform flags not launched.
--     E6 — MoL (mixture-of-LLMs) program flags, program paused.
--     E7 — assorted never-ramped or retired experiment flags.
--
-- Block (iii) ENV ADDITIONS (9 flags): rows enabled and rollout-correct but
--   scoped out of production via target_environments. CEO approved adding
--   'production' for:
--     D1 — ff_goal_aware_foxy, ff_goal_aware_selection, ff_today_home_v1,
--          ff_distractor_micro_explainer_v1 (live features env-locked by accident).
--     D2 — the 5 ff_editorial_atlas_* flags (Atlas option (a): officially ON in
--          production).
--   Explicitly EXCLUDED from (iii): ff_foxy_math_pipeline_v1 (intentionally
--   development-only) and ALL D3 pedagogy staged flags (stay staged).
--
-- ─── HARD EXCLUSIONS (assert: these names appear NOWHERE in this migration) ──
--   * ff_atomic_subscription_activation — P11 payment kill-switch. Read DIRECTLY
--     (is_enabled, rollout-ignored) by the Razorpay webhook fallback path; it
--     must remain is_enabled=true. Touching it risks 503-ing subscription
--     activation. NOT in any list above.
--   * ff_board_score_v1 — excluded per CEO instruction. NOT in any list above.
--   * reconcile_stuck_subscriptions_enabled — payment-reconciliation control,
--     excluded per CEO instruction. NOT in any list above.
--   * ff_python_* (all) — controlled via the metadata jsonb envelope
--     (enabled/kill_switch/rollout_pct inside metadata, read by
--     supabase/functions/_shared/python-ai-proxy.ts), NOT via the row's
--     is_enabled/rollout_percentage columns. Rewriting the columns would be
--     meaningless at best and confusing at worst. NOT in any list above.
--
-- ─── Staging / fresh-DB impact (this file runs on every environment) ─────────
--   * Staging: block (i) only touches rows already is_enabled=true AND
--     rollout_percentage=0 — i.e., rows already in the lying state; making them
--     evaluate ON matches their console appearance, same as prod. The adaptive
--     runbook's intentional is_enabled=true/rollout=0 "double-gate kill" rows on
--     staging are the Group A flags — and block (ii) forces those fully OFF
--     (is_enabled=false), which block (i) cannot re-activate because Group A
--     names are not in block (i)'s list. Result: Group A is explicitly OFF on
--     every environment, consistent with REG-124/126/131/175.
--   * Fresh DBs (CI live-DB tests, preview branches): seed migrations create
--     flags dark (explicit rollout 0 per the REG-125 shape), so block (i)'s
--     is_enabled=true guard matches few/no rows, block (ii) is a no-op or an
--     explicit-OFF rewrite of already-OFF rows (guarded, see idempotency), and
--     block (iii)'s NOT-ANY guard no-ops where the array already lacks or
--     already has 'production'. Net: mostly no-op, never harmful.
--   * Fresh/out-of-order DBs where feature_flags does not exist: to_regclass
--     guards make the whole file a clean NOTICE no-op.
--
-- ─── Idempotency ─────────────────────────────────────────────────────────────
--   * Block (i): WHERE rollout_percentage = 0 — after the first run rows read
--     100 and never rematch. Re-run = 0 rows.
--   * Block (ii): the spec's WHERE (flag_name IN ...) alone would bump
--     updated_at on every run; an added state guard
--     (is_enabled IS DISTINCT FROM false OR rollout_percentage IS DISTINCT FROM 0)
--     makes re-runs true 0-row no-ops without changing the effect.
--   * Block (iii): NOT ('production' = ANY(target_environments)) prevents
--     double-append; after the first run the predicate is false. Rows with a
--     NULL target_environments are intentionally NOT matched (NOT NULL = NULL):
--     NULL already means "no env scoping" to the evaluator, so no append is
--     needed or wanted.
--   * NO INSERTs anywhere in this file — the REG-125 seed-shape scanner is
--     unaffected. No DDL, no DROP, no SECURITY DEFINER, single transaction.
--
-- Owner: architect. Reviewers (P14 — feature-flag chain): ops, testing.
-- Added: 2026-07-20
--
-- ─── Reversible (manual DOWN) ────────────────────────────────────────────────
--   No automatic DOWN: this is a data repair. To revert a specific flag, restore
--   its prior (is_enabled, rollout_percentage, target_environments) from the
--   pre-migration snapshot taken during the RCA (180-row prod export, 2026-07-20)
--   or from audit_logs.

BEGIN;

-- ─── Block (i): ACTIVATE — 25 CEO-approved flags stuck at enabled-but-rollout-0
DO $activate$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.feature_flags') IS NULL THEN
    RAISE NOTICE 'feature_flags table absent; skipping block (i) ACTIVATE (fresh DB).';
    RETURN;
  END IF;

  UPDATE public.feature_flags
     SET rollout_percentage = 100,
         updated_at = NOW()
   WHERE is_enabled = true
     AND rollout_percentage = 0
     AND flag_name IN (
       -- CEO base list (20)
       'quiz_module',
       'foxy_ai_enabled',
       'leaderboard',
       'parent_portal',
       'push_notifications',
       'onboarding_flow',
       'simulations',
       'beta_features',
       'ff_response_cache_serve_ncert_v1',
       'ff_ncert_solver_solution_store_v1',
       'ff_foxy_vertical_math_v1',
       'ff_foxy_maps_v1',
       'ff_engagement_dashboard_v1',
       'ff_foxy_olympiad_mode_v1',
       'ff_foxy_interactive_lesson_v1',
       'ff_foxy_math_format_v2',
       'ff_foxy_diagrams_v1',
       'ff_foxy_teaching_director_v1',
       'ff_foxy_perception_v1',
       'ff_foxy_real_practice_v1',
       -- E1 read-path-verified subset (5): no runtime consumers found
       -- (verified 2026-07-20 — see header). Activation is harmless honesty.
       'adaptive_post_quiz',
       'foxy_cognitive_engine',
       'foxy_diagram_rendering',
       'quiz_assembler_v2',
       'ai_intent_router'
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'feature_flags data repair block (i) ACTIVATE: % row(s) updated.', v_count;
END $activate$;

-- ─── Block (ii): HONESTY-FIX — 52 flags forced explicitly, honestly OFF
DO $honesty_fix$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.feature_flags') IS NULL THEN
    RAISE NOTICE 'feature_flags table absent; skipping block (ii) HONESTY-FIX (fresh DB).';
    RETURN;
  END IF;

  UPDATE public.feature_flags
     SET is_enabled = false,
         rollout_percentage = 0,
         updated_at = NOW()
   WHERE flag_name IN (
       -- Group A: constitution-pinned default-OFF (REG-124/126/131/175)
       'ff_adaptive_remediation_v1',
       'ff_adaptive_loops_bc_v1',
       'ff_digital_twin_v1',
       'ff_school_pulse_v1',
       -- E3: quiz-submit hardening, not ramped
       'ff_server_only_quiz_submit',
       'ff_v1_quiz_rpc_web_blocked',
       'ff_competitive_exams_v1',
       -- E4: wave2/wave3 placeholders
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
       -- E5: orchestrator / learner-loop platform, not launched
       'ff_orchestrator_v1',
       'ff_rule_engine_v1',
       'ff_learner_loop_v1',
       'ff_learner_loop_dashboard_v1',
       'ff_scheduled_actions_v1',
       'ff_scan_to_queue_v1',
       'ff_personalised_compete_v1',
       -- E6: MoL program, paused
       'ff_mol_enabled',
       'ff_mol_hybrid_mode_v1',
       'ff_mol_openai_default',
       'ff_grounded_answer_mol_shadow_v1',
       'ff_mol_shadow_text_capture_v1',
       -- E7: never-ramped / retired experiments
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
       'ff_gst_invoicing_v1'
     )
     -- Idempotency guard: only touch rows not already in the target state,
     -- so re-runs are true 0-row no-ops (no updated_at churn).
     AND (is_enabled IS DISTINCT FROM false
          OR rollout_percentage IS DISTINCT FROM 0);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'feature_flags data repair block (ii) HONESTY-FIX: % row(s) updated.', v_count;
END $honesty_fix$;

-- ─── Block (iii): ENV ADDITIONS — 9 flags gain 'production' in target_environments
DO $env_additions$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.feature_flags') IS NULL THEN
    RAISE NOTICE 'feature_flags table absent; skipping block (iii) ENV ADDITIONS (fresh DB).';
    RETURN;
  END IF;

  UPDATE public.feature_flags
     SET target_environments = array_append(target_environments, 'production'),
         updated_at = NOW()
   WHERE is_enabled = true
     -- Double-append guard (also skips NULL arrays: NULL = no env scoping,
     -- nothing to add — see header idempotency notes).
     AND NOT ('production' = ANY(target_environments))
     AND flag_name IN (
       -- D1: live features env-locked out of production by accident
       'ff_goal_aware_foxy',
       'ff_goal_aware_selection',
       'ff_today_home_v1',
       'ff_distractor_micro_explainer_v1',
       -- D2: Editorial Atlas — option (a), officially ON in production
       'ff_editorial_atlas_v1',
       'ff_editorial_atlas_student',
       'ff_editorial_atlas_parent',
       'ff_editorial_atlas_teacher',
       'ff_editorial_atlas_school'
     );
     -- Excluded on purpose: 'ff_foxy_math_pipeline_v1' (intentionally
     -- development-only) and all D3 pedagogy staged flags (stay staged).

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'feature_flags data repair block (iii) ENV ADDITIONS: % row(s) updated.', v_count;
END $env_additions$;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- Per-block post-state counts (expected on prod, 2026-07-20 snapshot):
--
-- -- Block (i): all 25 (or however many of the 25 exist on this env) should now
-- -- read enabled at rollout 100; expected remaining-broken count: 0.
-- SELECT count(*) AS activate_done
--   FROM public.feature_flags
--  WHERE flag_name IN ('quiz_module','foxy_ai_enabled','leaderboard','parent_portal',
--        'push_notifications','onboarding_flow','simulations','beta_features',
--        'ff_response_cache_serve_ncert_v1','ff_ncert_solver_solution_store_v1',
--        'ff_foxy_vertical_math_v1','ff_foxy_maps_v1','ff_engagement_dashboard_v1',
--        'ff_foxy_olympiad_mode_v1','ff_foxy_interactive_lesson_v1','ff_foxy_math_format_v2',
--        'ff_foxy_diagrams_v1','ff_foxy_teaching_director_v1','ff_foxy_perception_v1',
--        'ff_foxy_real_practice_v1','adaptive_post_quiz','foxy_cognitive_engine',
--        'foxy_diagram_rendering','quiz_assembler_v2','ai_intent_router')
--    AND is_enabled = true AND rollout_percentage = 100;   -- expect: 25 on prod
--
-- -- Block (ii): every listed flag fully OFF; expect 52 on prod (fewer where
-- -- some names are unseeded on this env).
-- SELECT count(*) AS honesty_done
--   FROM public.feature_flags
--  WHERE flag_name IN ('ff_adaptive_remediation_v1','ff_adaptive_loops_bc_v1',
--        'ff_digital_twin_v1','ff_school_pulse_v1','ff_server_only_quiz_submit',
--        'ff_v1_quiz_rpc_web_blocked','ff_competitive_exams_v1','wave2_group_sessions',
--        'wave2_video_lessons','wave2_teacher_classroom','wave2_multilingual_12',
--        'wave2_all_subjects','wave2_jee_neet_prep','wave3_voice_tutor',
--        'wave3_govt_school_mode','wave3_phygital_centers','video_lessons','voice_tutor',
--        'group_sessions','ff_orchestrator_v1','ff_rule_engine_v1','ff_learner_loop_v1',
--        'ff_learner_loop_dashboard_v1','ff_scheduled_actions_v1','ff_scan_to_queue_v1',
--        'ff_personalised_compete_v1','ff_mol_enabled','ff_mol_hybrid_mode_v1',
--        'ff_mol_openai_default','ff_grounded_answer_mol_shadow_v1',
--        'ff_mol_shadow_text_capture_v1','ff_class_leaderboard_v1',
--        'ff_streak_guardian_cron_v1','ff_quiz_telemetry_v1','ff_institution_entitlements_v1',
--        'ff_foxy_curriculum_guard_v1','ff_unified_quiz_v1','ff_alfabot_lead_capture_v1',
--        'ff_demo_accounts_v2','ff_tutor_v1','ff_foxy_streaming','ff_goal_daily_plan',
--        'ff_goal_aware_rag','ff_goal_daily_plan_reminder','improvement_mode',
--        'improvement_auto_detect','improvement_recommendations','improvement_auto_stage',
--        'ff_grounded_ai_concept_engine','ff_offline_payment_reconciliation_v1',
--        'ff_school_contracts_v1','ff_gst_invoicing_v1')
--    AND is_enabled = false AND rollout_percentage = 0;    -- expect: 52 on prod
--
-- -- Block (iii): every listed flag now includes 'production'; expect 9 on prod.
-- SELECT count(*) AS env_done
--   FROM public.feature_flags
--  WHERE flag_name IN ('ff_goal_aware_foxy','ff_goal_aware_selection','ff_today_home_v1',
--        'ff_distractor_micro_explainer_v1','ff_editorial_atlas_v1',
--        'ff_editorial_atlas_student','ff_editorial_atlas_parent',
--        'ff_editorial_atlas_teacher','ff_editorial_atlas_school')
--    AND (target_environments IS NULL OR 'production' = ANY(target_environments));
--                                                          -- expect: 9 on prod
--
-- -- Hard exclusions untouched (P11 kill-switch must still be enabled):
-- SELECT flag_name, is_enabled, rollout_percentage
--   FROM public.feature_flags
--  WHERE flag_name = 'ff_atomic_subscription_activation';  -- expect: is_enabled = true
--
-- -- No double-append (idempotency proof after a re-run):
-- SELECT count(*) FROM public.feature_flags
--  WHERE array_length(array_positions(target_environments, 'production'), 1) > 1;
--                                                          -- expect: 0
