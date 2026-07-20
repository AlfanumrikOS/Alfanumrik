-- Migration: 20260720130000_restore_approved_flag_posture.sql
-- Purpose: EMERGENCY restore of the CEO-approved feature-flag posture after a
--          console bulk-enable incident re-enabled forced-OFF flags in prod.
--
-- ─── Incident timeline (2026-07-20, UTC) ─────────────────────────────────────
--   10:15  Approved posture applied: migration
--          20260720110000_feature_flags_data_repair_ceo_approved.sql set the
--          CEO-approved posture (25 activations / 52 forced-OFF / 9 env adds).
--   10:30–10:44  Console bulk-enable: an operator bulk-enable in the flags
--          console re-enabled 49 of the 52 block-(ii) forced-OFF flags at
--          rollout 100 — including P0 quiz-submit hardening flags
--          (ff_server_only_quiz_submit, ff_v1_quiz_rpc_web_blocked), the MoL
--          provider flags, and the 4 constitution-pinned loop/pulse flags
--          (REG-124 / REG-126..129 / REG-131..134 / REG-175).
--   13:00  This restore: re-applies the exact approved posture.
--
-- CEO authorization: 2026-07-20 (ceo@alfanumrik.com) — emergency restore of the
-- already-approved 20260720110000 posture; no new policy decisions are made in
-- this file.
--
-- Durable fix (tracked separately, NOT in this file): a UI guardrail in the
-- flags console — protected-flag confirmation (explicit typed confirmation
-- before enabling constitution-pinned / P0 / forced-OFF flags, and exclusion of
-- protected flags from bulk operations). This migration is the data restore
-- only; without the guardrail the same console action could recur.
--
-- ─── Blocks ──────────────────────────────────────────────────────────────────
--   Block A — re-applies VERBATIM the block-(ii) 52-flag forced-OFF list from
--     20260720110000 (same names, same SET, same idempotency guard). Restores
--     is_enabled=false, rollout_percentage=0 on every flag the bulk-enable
--     flipped; rows already in the target state are untouched (0-row no-op).
--   Block B — additionally forces OFF ff_irt_question_selection. This flag is
--     NOT part of the 52: it is dormant-by-design per the constitution
--     ("off until calibration accumulates" — Foxy moat plan) and was swept up
--     in the same bulk-enable. This is a constitution-conformance restore,
--     documented separately from the incident's 52-flag scope.
--   Block C — defensive MoL metadata re-pause. The MoL shadow flags are also
--     controlled via the metadata jsonb envelope ({enabled}); this block
--     re-asserts metadata->>'enabled'='false' on the two shadow-capture flags.
--     At restore time the metadata was NOT changed by the console bulk-enable,
--     so this block currently matches 0 rows — it exists purely as a defensive
--     re-assertion and is a guarded, idempotent no-op when already false.
--
-- ─── OUT OF SCOPE — DO NOT TOUCH (assert: not modified anywhere below) ───────
--   The following are intentionally NOT touched by this restore:
--   * The 25 block-(i) activations from 20260720110000 — remain active.
--   * The 9 block-(iii) env additions from 20260720110000 — remain in place.
--   * ff_atomic_subscription_activation — P11 payment kill-switch, must remain
--     is_enabled=true (read directly by the Razorpay webhook fallback path).
--   * ff_board_score_v1 — excluded per standing CEO instruction.
--   * reconcile_stuck_subscriptions_enabled — payment-reconciliation control,
--     excluded per standing CEO instruction.
--   * ff_python_* (all) — controlled via the metadata jsonb envelope, not the
--     is_enabled/rollout_percentage columns; column rewrites are meaningless.
--     (Block C touches metadata ONLY for the two MoL shadow flags listed there,
--     which are not ff_python_* flags.)
--   * ff_tutor_bkt_v1, wave1_affective_coaching, ff_grounded_ai_quiz_generator
--     — CEO decision pending; leave in current state.
--
-- ─── Safety / house style ────────────────────────────────────────────────────
--   * Single transaction. NO INSERTs (REG-125 seed-shape scanner unaffected).
--     No DDL, no DROP, no SECURITY DEFINER.
--   * to_regclass fresh-DB guards: whole file is a clean NOTICE no-op where
--     public.feature_flags does not exist.
--   * Every block is idempotent: state guards make re-runs true 0-row no-ops
--     (no updated_at churn).
--   * GET DIAGNOSTICS row-count NOTICEs per block for apply-time visibility.
--
-- Owner: architect. Reviewers (P14 — feature-flag chain): ops, testing.
-- Added: 2026-07-20 (active incident — emergency restore)

BEGIN;

-- ─── Block A: RESTORE — re-apply the block-(ii) 52-flag forced-OFF posture ───
-- List copied VERBATIM from 20260720110000 block (ii). Same SET, same guard.
DO $restore_off$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.feature_flags') IS NULL THEN
    RAISE NOTICE 'feature_flags table absent; skipping block A RESTORE (fresh DB).';
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
  RAISE NOTICE 'flag posture restore block A (52-flag forced-OFF): % row(s) updated.', v_count;
END $restore_off$;

-- ─── Block B: CONSTITUTION-CONFORMANCE — force OFF ff_irt_question_selection ──
-- Dormant-by-design ("off until calibration accumulates" — constitution, Foxy
-- moat plan). Swept up by the bulk-enable; restored here as a separate,
-- documented conformance fix distinct from the incident's 52-flag list.
DO $restore_irt$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.feature_flags') IS NULL THEN
    RAISE NOTICE 'feature_flags table absent; skipping block B IRT restore (fresh DB).';
    RETURN;
  END IF;

  UPDATE public.feature_flags
     SET is_enabled = false,
         rollout_percentage = 0,
         updated_at = NOW()
   WHERE flag_name = 'ff_irt_question_selection'
     AND (is_enabled IS DISTINCT FROM false
          OR rollout_percentage IS DISTINCT FROM 0);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'flag posture restore block B (ff_irt_question_selection): % row(s) updated.', v_count;
END $restore_irt$;

-- ─── Block C: DEFENSIVE — MoL shadow metadata re-pause ───────────────────────
-- The console bulk-enable did NOT touch metadata, so this currently matches
-- 0 rows; it re-asserts the paused envelope defensively and idempotently.
DO $restore_mol_metadata$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.feature_flags') IS NULL THEN
    RAISE NOTICE 'feature_flags table absent; skipping block C MoL metadata (fresh DB).';
    RETURN;
  END IF;

  UPDATE public.feature_flags
     SET metadata = jsonb_set(metadata, '{enabled}', 'false'::jsonb),
         updated_at = NOW()
   WHERE flag_name IN (
       'ff_grounded_answer_mol_shadow_v1',
       'ff_mol_shadow_text_capture_v1'
     )
     AND metadata->>'enabled' IS DISTINCT FROM 'false';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'flag posture restore block C (MoL metadata re-pause): % row(s) updated (expected 0).', v_count;
END $restore_mol_metadata$;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
--
-- -- 53 flags fully OFF (the 52 + ff_irt_question_selection); expect 53 on prod
-- -- (fewer only where a name is unseeded on this env).
-- SELECT count(*) AS restored_off
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
--        'ff_school_contracts_v1','ff_gst_invoicing_v1','ff_irt_question_selection')
--    AND is_enabled = false AND rollout_percentage = 0;     -- expect: 53 on prod
--
-- -- P0 quiz-submit pair explicitly OFF (must return 2 rows, both false/0):
-- SELECT flag_name, is_enabled, rollout_percentage
--   FROM public.feature_flags
--  WHERE flag_name IN ('ff_server_only_quiz_submit','ff_v1_quiz_rpc_web_blocked');
--                                    -- expect: both is_enabled=false, rollout 0
--
-- -- MoL shadow flags: columns OFF and metadata envelope paused:
-- SELECT flag_name, is_enabled, rollout_percentage, metadata->>'enabled' AS meta_enabled
--   FROM public.feature_flags
--  WHERE flag_name IN ('ff_grounded_answer_mol_shadow_v1','ff_mol_shadow_text_capture_v1');
--                    -- expect: is_enabled=false, rollout 0, meta_enabled='false'
--
-- -- Out-of-scope untouched (P11 kill-switch must still be enabled):
-- SELECT flag_name, is_enabled, rollout_percentage
--   FROM public.feature_flags
--  WHERE flag_name = 'ff_atomic_subscription_activation';   -- expect: is_enabled = true
