-- Migration: 20260802140000_seed_ff_exam_v2.sql
-- Purpose: Seed the CEO-approved "Wave B3" screen 11 "Mock exam"
--          student-frontend feature flag so the row EXISTS in
--          public.feature_flags and is auditable + flippable from the
--          super-admin console. Default OFF / 0% — this migration is a
--          zero-behavior-change deploy.
--
--   ff_exam_v2
--     Additive branch inside the existing /exams/mock/[paperId] mock-test
--     runner page: renders <ExamRunner> (packages/ui/src/exam/v2/ExamRunner.tsx)
--     in place of the legacy <MockTestRunner> when ON. Sections, a mono
--     countdown timer, a question palette (answered/marked/left), and
--     deferred feedback — all sourced from the SAME, UNCHANGED
--     `useMockTestState` state machine (same timer, same anti-cheat, same
--     atomic `submit_mock_test_attempt` call). Also wires a ~10s autosave of
--     in-progress responses through the `pending_writes` IndexedDB queue to
--     the new save-only `/api/exams/papers/[id]/autosave` route — that
--     route never calls `submit_mock_test_attempt` and never writes
--     score_percent/raw_score/xp_earned/status. Existing MockTestRunner path
--     is byte-identical while this flag is off or still resolving.
--
-- Not an "offline mock exam" mode: per the `ff_offline_v2` scope note
-- (20260802090200_seed_ff_wave_b_frontend_flags.sql, "Mock exams are
-- explicitly excluded from offline scope"), starting/submitting a mock exam
-- still always requires a live connection under ff_exam_v2 too. The
-- autosave wired here is only a live-session safety net against a
-- transient signal drop mid-attempt, replayed automatically once back
-- online — it does not let a student start or author an attempt offline.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds the row in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in packages/lib/src/feature-flags.ts)
-- returns false for both `is_enabled = false` AND `rollout_percentage <= 0`,
-- so the surface stays OFF until an operator explicitly flips the flag via
-- the super-admin console. Seeding the row makes it visible/auditable — it
-- does NOT enable any behavior. This migration is a zero-behavior-change
-- deploy.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent in this exact session
-- (20260802090200_seed_ff_wave_b_frontend_flags.sql,
-- 20260802120000_seed_ff_wave_b_gap_screens.sql) for the defensive
-- to_regclass guard + OFF/NULL-scoping semantics. Scoping arrays are left
-- NULL (no role/env/institution narrowing) — the global is_enabled=false /
-- rollout=0 double gate is what holds the flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING (backed by
-- the feature_flags.flag_name unique constraint, feature_flags_flag_name_key).
-- The whole INSERT is additionally guarded so it no-ops cleanly if the
-- feature_flags table does not yet exist (fresh DB / out-of-order apply), so
-- the live-DB CI test and Supabase preview branches never fail. No schema
-- changes. Pure data seed. No new tables → RLS N/A; feature_flags keeps its
-- existing baseline RLS posture. `ff_exam_v2` is not in
-- packages/lib/src/flags/protected-flags.ts, and this migration only ever
-- sets is_enabled=false/rollout_percentage=0, so
-- scripts/check-protected-flag-migrations.mjs has nothing to gate here.
--
-- Owner: frontend (this seed + the surface gate wiring + ExamRunner.tsx +
--        the autosave route, all against this exact flag name, in this
--        same round — no other agent is seeding or wiring ff_exam_v2)
-- Added: 2026-08-02
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name = 'ff_exam_v2';
-- The application resolves a missing flag to OFF, so deletion is silent on
-- the production experience.

DO $seed_ff_exam_v2$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    INSERT INTO public.feature_flags (
      flag_name,
      is_enabled,
      rollout_percentage,
      description,
      target_roles,
      target_environments,
      target_institutions,
      created_at,
      updated_at
    )
    VALUES (
      'ff_exam_v2',
      false,
      0,
      'Wave B3 screen 11 Mock exam: additive branch inside /exams/mock/[paperId] rendering <ExamRunner> (sections, mono timer, palette, deferred feedback) over the unchanged useMockTestState/submit_mock_test_attempt state machine, plus a ~10s pending_writes autosave to the new save-only /api/exams/papers/[id]/autosave route. Not an offline-exam mode — start/submit still require a live connection. Default off.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping ff_exam_v2 flag seed (fresh DB).';
  END IF;
END $seed_ff_exam_v2$;
