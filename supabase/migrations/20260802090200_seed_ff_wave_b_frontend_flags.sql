-- Migration: 20260802090200_seed_ff_wave_b_frontend_flags.sql
-- Purpose: Seed the two CEO-approved "Wave B" student-frontend feature
--          flags so each row EXISTS in public.feature_flags and is
--          auditable + flippable from the super-admin console. Both
--          default OFF / 0% — this migration is a zero-behavior change.
--
--          A fourth flag, ff_placement_v1, was seeded here originally and
--          is REMOVED as of 2026-08-02, same session, before this file was
--          ever applied to any database: assessment determined the
--          Placement Check feature it gated duplicates the already-live,
--          more rigorous /diagnostic system
--          (packages/lib/src/diagnostic/blueprint.ts) and deleted its
--          selector/hook/component/tests; backend is removing the
--          now-orphaned /api/v2/placement* routes in parallel.
--          ff_placement_v1 was never flipped ON, so no data or behavior is
--          affected by its removal. See
--          20260802090000_widen_learning_events_placement_probe.sql for the
--          matching learning_events CHECK-constraint reversion.
--
--   ff_offline_v2
--     Offline practice mode: explicit "keep offline" chapter downloads
--     (cap 5, least-recently-opened eviction) + queued practice-answer
--     replay keyed by a client-generated idempotency key (generated at
--     capture time, not at replay, so a flaky reconnect cannot double-count
--     — same discipline the payment path already uses). Offline answers are
--     credited to their occurred_at date in IST (not the sync date), with a
--     server clamp rejecting future timestamps and backfill older than 48
--     hours. Mock exams are explicitly excluded from offline scope — they
--     always require a live connection. When OFF, no offline queue or cache
--     path is exercised.
--   ff_exam_schedule_v1
--     Tiers 2-3 of the exam schedule: teacher-set dates with chapter scope,
--     and student-added dates via student_exam_entries /
--     student_exam_entry_topics (migration 20260802090100, student-private,
--     no parent/teacher visibility by design). Precedence school > teacher
--     > student is enforced server-side in the read union. When OFF, no
--     read route composes the union and the new tables are unused.
--
-- ─── Default-OFF contract ─────────────────────────────────────────────────────
-- This migration seeds both rows in the DISABLED state only:
--   is_enabled = FALSE, rollout_percentage = 0.
-- The read path (isFeatureEnabled in src/lib/feature-flags.ts) returns false
-- for both `is_enabled = false` AND `rollout_percentage <= 0`, so every
-- surface stays OFF until an operator explicitly flips a flag via the
-- super-admin console. Seeding the rows makes the flags visible/auditable —
-- it does NOT enable any behavior. Merging this migration, and the two
-- schema migrations it follows, is a zero-behavior-change deploy.
--
-- ─── Column shape ─────────────────────────────────────────────────────────────
-- Mirrors the established flag-seed precedent
-- (20260619000100_seed_ff_school_pulse_v1.sql,
-- 20260619000300_seed_ff_adaptive_remediation_v1.sql) for the defensive
-- to_regclass guard + OFF/NULL-scoping semantics. Scoping arrays are left
-- NULL (no role/env/institution narrowing) — the global is_enabled=false /
-- rollout=0 double gate is what holds every flag OFF.
--
-- Idempotent. Safe to re-run: ON CONFLICT (flag_name) DO NOTHING per row
-- (backed by the feature_flags.flag_name unique constraint,
-- feature_flags_flag_name_key). The whole INSERT is additionally guarded so
-- it no-ops cleanly if the feature_flags table does not yet exist (fresh DB
-- / out-of-order apply), so the live-DB CI test and Supabase preview
-- branches never fail. No schema changes. Pure data seed. No new tables →
-- RLS N/A; feature_flags keeps its existing baseline RLS posture.
--
-- Owner: architect (this seed + the two schema migrations it follows) +
--        frontend (surface gate wiring, in parallel, against these exact
--        flag names) + backend (offline sync route, in parallel, against
--        these exact flag names)
-- Added: 2026-08-02
--
-- ─── Reversible (manual DOWN) ─────────────────────────────────────────────────
--   DELETE FROM feature_flags WHERE flag_name IN (
--     'ff_offline_v2', 'ff_exam_schedule_v1'
--   );
-- The application resolves a missing flag to OFF, so deletion is silent on
-- the production experience.

DO $wave_b_frontend_flags$
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
    VALUES
    (
      'ff_offline_v2',
      false,
      0,
      'Wave B: offline practice mode (explicit keep-offline chapter cache, cap 5 LRU eviction; queued practice-answer replay keyed by a client-generated idempotency key created at capture, not at replay; occurred_at credited in IST with future-timestamp rejection and a 48h backfill clamp). Mock exams excluded by design — always require a connection. Default off.',
      NULL, NULL, NULL, now(), now()
    ),
    (
      'ff_exam_schedule_v1',
      false,
      0,
      'Wave B: exam schedule tiers 2-3 (teacher-set dates with chapter scope; student-added dates via student_exam_entries/student_exam_entry_topics, migration 20260802090100, student-private by design). Precedence school > teacher > student enforced server-side in the read union. Default off.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO NOTHING;
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping Wave B student-frontend flag seed (fresh DB).';
  END IF;
END $wave_b_frontend_flags$;
