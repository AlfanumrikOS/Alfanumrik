-- Migration: 20260802160000_rollback_confirmed_flag_drift_incident.sql
-- Purpose: CEO-authorized incident rollback (2026-08-02/03). Returns 11
--          confirmed-drifted feature flags to their own already-documented
--          CEO-approved baseline: is_enabled = false, rollout_percentage = 0.
--          This is a ROLLBACK to registered baseline, not a new enablement —
--          no flag's is_enabled goes to true and no rollout_percentage goes
--          above 0 in this file.
--
-- ─── Flags rolled back (all set to is_enabled = false, rollout_percentage = 0) ──
--
--   1. ff_server_only_quiz_submit
--        p0_outage-tier protected flag (packages/lib/src/flags/protected-flags.ts,
--        P0_QUIZ_SUBMIT reason) and a member of EXPECTED_OFF_FLAGS. Currently
--        toggles only a telemetry-only branch in
--        apps/host/src/app/api/quiz/submit/route.ts — the client-side cutover
--        it is meant to gate never shipped. Pinned by
--        apps/host/src/__tests__/quiz-submit-idempotency-contract-pin.test.ts
--        (SLC-8), which confirms submitQuizResults() still calls
--        submit_quiz_results_v2 directly with no idempotency key. No PR or
--        commit authorizes ramping this to 100%. Rolling back to its
--        registered false/0 baseline.
--
--   2. wave2_video_lessons
--        staged_rollout-tier protected flag, EXPECTED_OFF_FLAGS member
--        (E4 wave2/wave3 placeholder group, migration 20260720110000 block
--        ii). Zero code references anywhere outside the registry file —
--        confirmed unbuilt.
--
--   3. wave3_voice_tutor
--        Same E4 placeholder group as #2, same registry entries. Confirmed
--        unbuilt.
--
--   4. video_lessons
--        Same E4 placeholder group, same registry entries. Confirmed unbuilt.
--
--   5. voice_tutor
--        Same E4 placeholder group, same registry entries. Confirmed unbuilt.
--
--   6. ff_unified_quiz_v1
--        staged_rollout-tier protected flag (E7 never-ramped/retired
--        experiments group), EXPECTED_OFF_FLAGS member.
--        docs/LAUNCH_FLAG_MATRIX.md states "HOLD (not built)"; zero live
--        call sites.
--
--   7. ff_model_gateway_v1
--        ai_provider-tier protected flag, EXPECTED_OFF_FLAGS member. Registry
--        header states it was "seeded OFF ... never enabled" (independently
--        re-verified 2026-08-01). Drifted to ON with zero admin_audit_log
--        rows — an unaudited direct-DB-write bypass of the console
--        confirmation gate. This is an AI-provider-routing change (adds an
--        OpenAI fallback tier behind Anthropic in Foxy's intent classifier)
--        that has never received CEO provider approval. Rolled back once
--        already today (07:02 UTC per commit 6e00d483's addendum) and
--        drifted back — this is the second occurrence.
--
--   8. ff_unified_memory_v1
--        HIGHEST PRIORITY of this batch — a real, live P13 data-privacy
--        risk. staged_rollout-tier protected flag, EXPECTED_OFF_FLAGS
--        member. Registry reason: enabling before the DPDP erasure-guard
--        covers Foxy's teachingDirectorSection risks a mid-erasure student's
--        data leaking into a prompt (no getStudentMemory composer exists
--        yet — only the erasure-guard and preferences sub-reads under
--        packages/lib/src/memory/). Never deliberately enabled; same
--        unaudited direct-DB-write drift signature as #7.
--
--   9. ff_outcome_prediction_v1
--        staged_rollout-tier protected flag, EXPECTED_OFF_FLAGS member.
--        Zero UI caller anywhere in apps/host/src/app — low product risk in
--        isolation, but this is still unauthorized drift off the registered
--        baseline and is rolled back for consistency with the rest of the
--        batch.
--
--   10. ff_lesson_generation_v1
--        staged_rollout-tier protected flag, EXPECTED_OFF_FLAGS member. The
--        original 2026-07-27 100%-abstain incident flag (see
--        docs/incidents/2026-07-27-genai-generation-agents-100pct-abstain/).
--        Today's root-cause-fix migration
--        (20260801120000_protected_feature_flags_genai_ecosystem_seed.sql)
--        itself states this flag must "remain OFF pending live production
--        verification nobody in this environment can perform" — that
--        verification has not happened.
--
--   11. ff_content_generation_v1
--        Identical history and status to #10 (GenAI Phase 5c, Mermaid
--        diagrams) — escalated to 100% same-day then force-disabled 3 days
--        later for ~100% abstain rate; same unresolved coverage/confidence
--        gate blocker. staged_rollout-tier protected flag, EXPECTED_OFF_FLAGS
--        member.
--
-- ─── Explicitly NOT touched by this migration ────────────────────────────────
-- ff_foxy_streaming, ff_goal_aware_rag, ff_grounded_ai_concept_engine — held
-- for a separate CEO decision. Do not add these without a distinct
-- CEO-authorized change.
--
-- ─── check-protected-flag-migrations.mjs marker requirement ─────────────────
-- scripts/check-protected-flag-migrations.mjs only requires a
-- `-- CEO-APPROVED-FLAG-FLIP: <flag_name>` marker for a migration that
-- contains an "enabling" assignment for a mentioned protected flag — i.e.
-- an `is_enabled = true` literal, or a `rollout_percentage` literal that is
-- nonzero (see hasEnablingAssignment() in that script: `is_enabled\s*[=:]
-- \s*true` OR `rollout_percentage\s*[=:]\s*'?([1-9][0-9]*)'?`). This
-- migration sets `is_enabled = false` and `rollout_percentage = 0`
-- everywhere for all 11 flags — no `is_enabled = true` token and no nonzero
-- rollout_percentage literal appears anywhere in this file (verified by
-- reading the script before finalizing this migration). It is a pure
-- rollback-to-documented-baseline, so no marker comment is required.
--
-- ─── Column shape / REG-125 conformance ──────────────────────────────────────
-- Mirrors 20260802110000_ramp_alfa_os_presentation_flags.sql: explicit
-- column list, first column flag_name, idempotent UPSERT (INSERT ... ON
-- CONFLICT (flag_name) DO UPDATE) against the canonical unique key
-- feature_flags_flag_name_key. UPSERT (not a bare UPDATE) is deliberate so
-- this migration is safe even if a row happens to be absent on some
-- environment — it creates the row already at the correct false/0 baseline
-- rather than silently no-op-ing.
--
-- Scoping: rollout_percentage = 0, target_roles/target_environments/
-- target_institutions = NULL (unscoped baseline row shape).
--
-- No DDL. No DROP. No new tables → RLS N/A; feature_flags keeps its existing
-- baseline RLS posture. Guarded so it no-ops cleanly on a fresh DB where
-- feature_flags does not yet exist.
--
-- Owner: architect. CEO-authorized incident rollback, 2026-08-02/03.
-- Added: 2026-08-02
--
-- ─── Reversible ───────────────────────────────────────────────────────────
--   Any future re-enable of these flags requires a fresh CEO-approved
--   migration with the `-- CEO-APPROVED-FLAG-FLIP: <flag_name>` marker for
--   each flag (all 11 are PROTECTED_FLAGS entries), per
--   scripts/check-protected-flag-migrations.mjs. Do not hand-flip via
--   direct SQL outside a reviewed migration.

DO $rollback_confirmed_flag_drift_incident$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- 1. ff_server_only_quiz_submit — P0 quiz-submit hardening flag; rollback
    --    to registered OFF/0 baseline (no approved ramp to 100%).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_server_only_quiz_submit', false, 0,
      'P0 quiz-submit hardening flag. Currently toggles only a telemetry-only branch in apps/host/src/app/api/quiz/submit/route.ts; the client-side cutover it is meant to gate never shipped (pinned by quiz-submit-idempotency-contract-pin.test.ts, SLC-8). No approved ramp exists. CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

    -- 2. wave2_video_lessons — E4 placeholder, unbuilt.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'wave2_video_lessons', false, 0,
      'E4 wave2 placeholder flag. Zero code references anywhere outside the protected-flags registry file; confirmed unbuilt. CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

    -- 3. wave3_voice_tutor — E4/wave3 placeholder, unbuilt.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'wave3_voice_tutor', false, 0,
      'E4 wave3 placeholder flag. Zero code references anywhere outside the protected-flags registry file; confirmed unbuilt. CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

    -- 4. video_lessons — E4 placeholder (unprefixed twin), unbuilt.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'video_lessons', false, 0,
      'E4 placeholder flag (unprefixed twin of wave2_video_lessons). Zero code references anywhere outside the protected-flags registry file; confirmed unbuilt. CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

    -- 5. voice_tutor — E4 placeholder (unprefixed twin), unbuilt.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'voice_tutor', false, 0,
      'E4 placeholder flag (unprefixed twin of wave3_voice_tutor). Zero code references anywhere outside the protected-flags registry file; confirmed unbuilt. CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

    -- 6. ff_unified_quiz_v1 — E7 never-ramped experiment; HOLD (not built) per
    --    docs/LAUNCH_FLAG_MATRIX.md, zero live call sites.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_unified_quiz_v1', false, 0,
      'E7 never-ramped experiment flag. docs/LAUNCH_FLAG_MATRIX.md states "HOLD (not built)"; zero live call sites. CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

    -- 7. ff_model_gateway_v1 — ai_provider-tier; unaudited drift, second
    --    occurrence today. No CEO provider approval for the OpenAI fallback
    --    tier this activates.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_model_gateway_v1', false, 0,
      'GenAI Model Gateway L2 (AI provider-routing change: adds an OpenAI fallback tier behind Anthropic for Foxy''s intent classifier). Registry states "seeded OFF ... never enabled" (re-verified 2026-08-01); drifted to ON with zero admin_audit_log rows (unaudited direct-DB-write bypass). No CEO provider approval given. Rolled back once already today (07:02 UTC per commit 6e00d483 addendum) and drifted back -- second occurrence. CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

    -- 8. ff_unified_memory_v1 — HIGHEST PRIORITY: live P13 data-privacy risk.
    --    Enabling before the DPDP erasure-guard covers teachingDirectorSection
    --    risks a mid-erasure student's data leaking into a prompt.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_unified_memory_v1', false, 0,
      'Unified Student Memory (GenAI ecosystem). Blocked on an unresolved DPDP erasure-pending interlock: enabling before Foxy''s teachingDirectorSection is brought under the erasure-pending guard risks a mid-erasure student''s data leaking into a prompt (no getStudentMemory composer exists yet). Never deliberately enabled; same unaudited direct-DB-write drift signature as ff_model_gateway_v1. HIGHEST PRIORITY of this rollback batch -- real, live P13 risk. CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

    -- 9. ff_outcome_prediction_v1 — zero UI caller; unauthorized drift, low
    --    product risk in isolation but rolled back for batch consistency.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_outcome_prediction_v1', false, 0,
      'Read-only Outcome Prediction Agent endpoint (GenAI Phase 5a). Backend route and tests are complete, but zero UI caller anywhere in apps/host/src/app reaches it. Unauthorized drift off the registered baseline (low product risk in isolation, but no CEO approval to enable). CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

    -- 10. ff_lesson_generation_v1 — the original 2026-07-27 100%-abstain
    --     incident flag; must remain OFF pending unavailable live-prod
    --     verification.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_lesson_generation_v1', false, 0,
      'Student-facing Lesson Generation Agent (GenAI Phase 5b). Escalated to 100% same-day (migration 20260724220000) then FORCE-DISABLED 3 days later (20260727120000) after abstaining on ~100% of requests (zero cbse_syllabus rows at rag_status=''ready'' under the strict-mode coverage precheck). Migration 20260801120000 states this flag must remain OFF pending live production verification nobody in this environment can perform -- that verification has not happened. CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

    -- 11. ff_content_generation_v1 — identical history/status to #10 (GenAI
    --     Phase 5c, Mermaid diagrams).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_content_generation_v1', false, 0,
      'Student-facing Content Generation Agent, Mermaid diagrams (GenAI Phase 5c). Escalated to 100% same-day (migration 20260724220000) then FORCE-DISABLED 3 days later (20260727120000) after abstaining on ~100% of requests (zero cbse_syllabus rows at rag_status=''ready'' under the strict-mode coverage precheck). Same unresolved coverage/confidence gate blocker as ff_lesson_generation_v1 -- live production verification has not happened. CEO-authorized incident rollback to registered false/0 baseline, 2026-08-02/03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = false,
          rollout_percentage = 0,
          updated_at        = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping incident-drift flag rollback (fresh DB).';
  END IF;
END $rollback_confirmed_flag_drift_incident$;
