-- Migration: 20260722090000_protected_feature_flags_registry.sql
-- Purpose: Phase 0 (Master Action Plan, item 0.1) of the flag-governance
--          hardening program. Ports the application-layer protected-flag
--          registry (packages/lib/src/flags/protected-flags.ts) into the
--          DATABASE so a direct Postgres/Supabase-Studio mutation of
--          `feature_flags` -- which bypasses the Next.js console API and its
--          typed-confirmation guardrail entirely -- can ALSO be intercepted.
--
-- ─── Context: two incidents, one gap ─────────────────────────────────────────
--   1. 2026-06-21: a premature manual enable of a constitution-pinned flag.
--   2. 2026-07-20: a console bulk-enable action re-armed 49 of 52
--      CEO-approved forced-OFF flags at rollout 100 (restored by migration
--      20260720130000_restore_approved_flag_posture.sql). The FIX that
--      shipped afterwards (protected-flags.ts registry + the confirm-gate in
--      apps/host/src/app/api/super-admin/feature-flags/route.ts) is
--      APPLICATION-LAYER ONLY. It does nothing to stop a raw
--      `UPDATE feature_flags SET is_enabled = true ...` run from the
--      Supabase SQL editor or any other direct-Postgres client -- the exact
--      vector incident #2's operator action resembles.
--
-- This migration is the DATA layer for that DB-side guardrail. The
-- accompanying BEFORE UPDATE trigger that actually enforces the block is
-- migration 20260722090100_feature_flags_db_guard_trigger.sql (kept as a
-- SEPARATE file: this one is pure data + RLS, that one is behavior, per this
-- repo's convention of not mixing a new table's RLS with unrelated trigger
-- logic on a DIFFERENT existing table).
--
-- ─── Seed provenance (do not hand-edit without regenerating) ─────────────────
-- The 74 rows below are a MACHINE-GENERATED 1:1 dump of
-- packages/lib/src/flags/protected-flags.ts as read on 2026-07-22:
--   - 72 rows = every key currently in `PROTECTED_FLAGS` (verified: this set
--     is a superset of `EXPECTED_OFF_FLAGS`, which is itself checked).
--   - 2 rows = `ff_productive_failure_v1` and `ff_pedagogy_v2_monthly_synthesis`,
--     two constitution-pinned Pedagogy v2 flags that were NOT yet present in
--     protected-flags.ts as of 2026-07-22. Migration
--     20260722090300_add_missing_protected_flags_ts_registry.sql-equivalent
--     TS change (packages/lib/src/flags/protected-flags.ts edit, same PR)
--     adds them to `PROTECTED_FLAGS` + `EXPECTED_OFF_FLAGS` in the SAME
--     change so the DB and TS registries land in lockstep. A static parity
--     test (apps/host/src/__tests__/api/super-admin/
--     feature-flags-protected-guardrail.test.ts) pins DB-seed === TS-registry
--     going forward so the two can never silently drift again.
--
-- ─── Table shape (as specified by the architect task) ────────────────────────
--   flag_name TEXT PRIMARY KEY  -- matches feature_flags.flag_name (not FK'd:
--                                  a protected name may be registered BEFORE
--                                  the flag row exists, e.g. a not-yet-seeded
--                                  constitution-pinned flag reserved ahead of
--                                  its feature shipping).
--   tier      TEXT NOT NULL     -- mirrors the TS `ProtectedTier` union exactly
--                                  (CHECK constraint enforces this in the DB).
--   reason    TEXT NOT NULL     -- human-readable justification, copied
--                                  verbatim from the TS registry's `reason`
--                                  field (English only; the DB table does not
--                                  carry the `reasonHi` variant -- this is an
--                                  ops/audit surface, not user-facing UI, so
--                                  P7 bilingual-UI does not apply here).
--   added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
--
-- ─── RLS (P8 -- every new table gets RLS in the SAME migration) ──────────────
-- This table does NOT fit the usual four-pattern rubric (student own / parent
-- linked / teacher assigned / admin service-role) because it has no
-- student_id, no per-user ownership, and no legitimate non-admin reader: it
-- is a pure ops/security-control table describing which feature-flag names
-- are protected and why. Per CLAUDE.md's own RLS pattern doc: "Admin: service
-- role bypasses RLS" is the applicable pattern here, and it is the ONLY
-- applicable pattern -- there is no student/parent/teacher reader for this
-- table by design. Accordingly:
--   - RLS is ENABLED (P8 requires this on every new table, no exceptions).
--   - The ONLY policy is service-role ALL (mirrors
--     adaptive_interventions_service_all / teacher_remediation_assignments_
--     service_all conventions elsewhere in this migration set).
--   - `authenticated`/`anon` get ZERO policies (no SELECT even), because the
--     admin console reads this indirectically only through the
--     admin_flip_feature_flag RPC (SECURITY DEFINER, migration
--     20260722090200) and through the BEFORE UPDATE trigger (which runs
--     SECURITY DEFINER and therefore does not need `authenticated` to have
--     read access at all). If a future admin UI needs to LIST protected
--     flags for display, add a narrow SECURITY DEFINER RPC rather than
--     opening a SELECT policy -- do not loosen this without a documented
--     reason (this table is a security control surface, not user data).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; DROP POLICY IF EXISTS before CREATE
-- POLICY; the seed INSERT uses ON CONFLICT (flag_name) DO UPDATE so re-running
-- this file (or a future correction) refreshes tier/reason without erroring.
-- No DROP TABLE / DROP COLUMN. Additive only.

BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.protected_feature_flags (
  flag_name text PRIMARY KEY,
  tier      text NOT NULL
              CHECK (tier IN (
                'p0_outage',
                'p11_payment',
                'ai_provider',
                'constitution_pinned',
                'staged_rollout',
                'special_do_not_touch'
              )),
  reason    text NOT NULL,
  added_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.protected_feature_flags IS
  'DB-layer mirror of packages/lib/src/flags/protected-flags.ts (PROTECTED_FLAGS). '
  'Read by the trg_protect_feature_flags BEFORE UPDATE trigger (migration '
  '20260722090100) to block a direct-Postgres/Studio mutation of feature_flags '
  'from re-arming a protected flag the way the 2026-07-20 console bulk-enable '
  'incident did. Service-role-only (P8): this is an ops-control table with no '
  'student/parent/teacher reader by design -- see migration header for the '
  'RLS rationale.';

COMMENT ON COLUMN public.protected_feature_flags.tier IS
  'Mirrors the TS ProtectedTier union exactly: p0_outage | p11_payment | '
  'ai_provider | constitution_pinned | staged_rollout | special_do_not_touch.';

COMMENT ON COLUMN public.protected_feature_flags.reason IS
  'Human-readable justification, copied verbatim from protected-flags.ts '
  '(English only -- this is an ops/audit surface, not user-facing UI; P7 '
  'bilingual-UI does not apply).';

-- ─── 2. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.protected_feature_flags ENABLE ROW LEVEL SECURITY;

-- Service role: full access. This is the ONLY policy -- see the migration
-- header for why the usual student/parent/teacher patterns do not apply to
-- an ops-control table with no per-user ownership.
DROP POLICY IF EXISTS protected_feature_flags_service_all
  ON public.protected_feature_flags;
CREATE POLICY protected_feature_flags_service_all
  ON public.protected_feature_flags
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Defense in depth under the RLS layer: strip default privileges entirely.
-- No SELECT for authenticated/anon -- see header ("no legitimate non-admin
-- reader"). The trigger function and the admin_flip_feature_flag RPC are
-- both SECURITY DEFINER and therefore read this table regardless of the
-- calling role's grants.
REVOKE ALL ON public.protected_feature_flags FROM PUBLIC;
REVOKE ALL ON public.protected_feature_flags FROM anon;
REVOKE ALL ON public.protected_feature_flags FROM authenticated;
GRANT ALL ON public.protected_feature_flags TO service_role;

-- ─── 3. Seed: 1:1 with protected-flags.ts as of 2026-07-22 ───────────────────
-- ON CONFLICT DO UPDATE so a future correction to protected-flags.ts can be
-- re-mirrored here by re-running (or copy-forwarding) this INSERT block
-- without needing a DELETE first.

INSERT INTO public.protected_feature_flags (flag_name, tier, reason) VALUES
  ('ff_server_only_quiz_submit', 'p0_outage', 'Enabling without deployed preconditions breaks quiz submission for all students (P0 outage class).'),
  ('ff_v1_quiz_rpc_web_blocked', 'p0_outage', 'Enabling without deployed preconditions breaks quiz submission for all students (P0 outage class).'),
  ('ff_competitive_exams_v1', 'p11_payment', 'Payment-coupled flag: the ₹999 Razorpay SKU must exist before this can be enabled (P11).'),
  ('ff_mol_enabled', 'ai_provider', 'AI provider change (MoL program): requires explicit CEO approval before any enable.'),
  ('ff_mol_hybrid_mode_v1', 'ai_provider', 'AI provider change (MoL program): requires explicit CEO approval before any enable.'),
  ('ff_mol_openai_default', 'ai_provider', 'AI provider change (MoL program): requires explicit CEO approval before any enable.'),
  ('ff_grounded_answer_mol_shadow_v1', 'ai_provider', 'AI provider change (MoL program): requires explicit CEO approval before any enable.'),
  ('ff_mol_shadow_text_capture_v1', 'ai_provider', 'AI provider change (MoL program): requires explicit CEO approval before any enable.'),
  ('ff_adaptive_remediation_v1', 'constitution_pinned', 'Constitution-pinned default-OFF; staged-rollout runbook required (REG-124 / REG-126..129 / REG-131..134 / REG-175).'),
  ('ff_adaptive_loops_bc_v1', 'constitution_pinned', 'Constitution-pinned default-OFF; staged-rollout runbook required (REG-124 / REG-126..129 / REG-131..134 / REG-175).'),
  ('ff_digital_twin_v1', 'constitution_pinned', 'Constitution-pinned default-OFF; staged-rollout runbook required (REG-124 / REG-126..129 / REG-131..134 / REG-175).'),
  ('ff_school_pulse_v1', 'constitution_pinned', 'Constitution-pinned default-OFF; staged-rollout runbook required (REG-124 / REG-126..129 / REG-131..134 / REG-175).'),
  ('wave2_group_sessions', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('wave2_video_lessons', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('wave2_teacher_classroom', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('wave2_multilingual_12', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('wave2_all_subjects', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('wave2_jee_neet_prep', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('wave3_voice_tutor', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('wave3_govt_school_mode', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('wave3_phygital_centers', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('video_lessons', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('voice_tutor', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('group_sessions', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_orchestrator_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_rule_engine_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_learner_loop_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_learner_loop_dashboard_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_scheduled_actions_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_scan_to_queue_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_personalised_compete_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_class_leaderboard_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_streak_guardian_cron_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_quiz_telemetry_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_institution_entitlements_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_foxy_curriculum_guard_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_unified_quiz_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_alfabot_lead_capture_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_demo_accounts_v2', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_tutor_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_foxy_streaming', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_goal_daily_plan', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_goal_aware_rag', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_goal_daily_plan_reminder', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('improvement_mode', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('improvement_auto_detect', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('improvement_recommendations', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('improvement_auto_stage', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_grounded_ai_concept_engine', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_offline_payment_reconciliation_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_school_contracts_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_gst_invoicing_v1', 'staged_rollout', 'CEO-approved forced-OFF posture (migration 20260720110000 block ii): feature not built, not launched, or retired. Do not re-enable without an approved rollout plan.'),
  ('ff_irt_question_selection', 'staged_rollout', 'Dormant by design ("off until IRT calibration accumulates" — Foxy moat plan / constitution). Do not enable until calibration data exists.'),
  ('ff_atomic_subscription_activation', 'special_do_not_touch', 'P11 payment kill-switch read directly by the Razorpay webhook fallback. enabled-at-rollout-0 is its CORRECT shape; disabling it 503s subscription activation. Do not touch from the console.'),
  ('ff_board_score_v1', 'special_do_not_touch', 'Excluded per standing CEO instruction (20260720110000 hard-exclusion list). Controlled outside the console.'),
  ('reconcile_stuck_subscriptions_enabled', 'special_do_not_touch', 'Payment-reconciliation control, excluded per standing CEO instruction. Controlled outside the console.'),
  ('ff_python_ai_services_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_bulk_question_gen_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_generate_answers_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_generate_concepts_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_voice_tts_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_ncert_solver_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_cme_engine_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_foxy_tutor_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_quiz_generator_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_monthly_synthesis_builder_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_nep_compliance_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_grade_experiment_conclusion_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_verify_question_bank_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_extract_ncert_questions_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_parent_report_generator_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_python_bulk_non_mcq_gen_v1', 'special_do_not_touch', 'ff_python_* flags are controlled via the metadata jsonb envelope (python-ai-proxy), NOT via is_enabled/rollout_percentage. Console column edits are meaningless-to-harmful. Controlled outside the console.'),
  ('ff_productive_failure_v1', 'constitution_pinned', 'Constitution-pinned default-OFF pedagogy flag; not yet in the protected-flags.ts registry as of 2026-07-22 -- added here and in the TS registry together (architect Phase 0 hardening).'),
  ('ff_pedagogy_v2_monthly_synthesis', 'constitution_pinned', 'Constitution-pinned default-OFF Pedagogy v2 Wave 3 monthly-synthesis flag; not yet in the protected-flags.ts registry as of 2026-07-22 -- added here and in the TS registry together (architect Phase 0 hardening).')
ON CONFLICT (flag_name) DO UPDATE
  SET tier = EXCLUDED.tier,
      reason = EXCLUDED.reason;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT count(*) FROM public.protected_feature_flags;  -- expect: 74
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'protected_feature_flags';  -- expect: t
-- SELECT polname, cmd FROM pg_policies WHERE tablename = 'protected_feature_flags';
--   Expected: protected_feature_flags_service_all (ALL) -- the only row.
-- SELECT tier, count(*) FROM public.protected_feature_flags GROUP BY tier ORDER BY tier;
--   Expected: ai_provider=5, constitution_pinned=6, p0_outage=2, p11_payment=1,
--             special_do_not_touch=19, staged_rollout=41.
