-- Migration: 20260802110000_ramp_alfa_os_presentation_flags.sql
-- Purpose: CEO-approved (2026-08-02, "ramp what's already built rather than
--          duplicate it") ENABLEMENT of the four "Alfa OS" presentation-layer
--          redesign flags. All four surfaces are fully coded and committed;
--          per each component's own header comments (verified this session),
--          this is a PRESENTATION-LAYER redesign over the UNCHANGED learning
--          engines — no scoring/XP/mastery/schema change (P1/P2/P3/P4/P12
--          untouched everywhere the flags gate). This migration seeds any
--          row that does not yet exist and flips every one of the four to
--          is_enabled = true, rollout_percentage = 100, globally (no role/
--          env/institution scoping).
--
-- Flags enabled (all is_enabled = true, rollout_percentage = 100):
--
--   1. ff_student_os_v1
--        Master switch for the "Alfa OS" flagship redesign of the student
--        dashboard (StudentOSDashboard: Today's Mission hero wrapping the
--        existing DailyRhythmQueue, Mastery Snapshot, Revision Rail reusing
--        ReviewsDueCard/useReviewCards, per-subject Subject Roadmaps) and the
--        Foxy AI workspace (3-pane desktop layout — Conversations rail |
--        Conversation | Context panel — with the chat column, renderer, and
--        7 modes byte-identical to today; the ContextPanel's suggestions
--        route through the existing mode/prompt mechanisms, no new AI
--        calls). Row already exists (enabled by migration
--        20260620001601_enable_latest_frontend_flags.sql) — this UPSERT
--        re-asserts the ON state idempotently.
--
--   2. ff_subjects_os_v1
--        Gates the "Alfa OS" Subjects experience (SubjectsOSHub) inside
--        /learn: when a subject is selected, the new per-subject hub renders
--        in place of the legacy chapter list. Presentation-only. Row never
--        previously seeded by any migration — this UPSERT creates it
--        enabled.
--
--   3. ff_foxy_os_v1
--        Master switch for the "Foxy OS" mobile-first redesign of the /foxy
--        AI tutor workspace (compact top bar + Study bottom sheet on phones,
--        <lg only; >=lg unchanged). Presentation-layer only over the
--        unchanged Foxy engines — does not touch the structured-render
--        envelope, /api/foxy, scope-lock, or daily limits (P12/REG-55
--        untouched). Row seeded OFF by
--        20260619000000_seed_ff_foxy_os_v1.sql — this UPSERT flips it ON.
--
--   4. ff_engagement_dashboard_v1
--        Master switch for the student-facing progress dashboard at
--        /progress/dashboard (XP/level ring, streak flame, cross-subject
--        mastery radar, per-subject mastery bands, recent quiz history). No
--        new tables — aggregates from existing students/concept_mastery/
--        quiz_responses. Row seeded OFF by
--        20260718000300_seed_ff_engagement_dashboard_v1.sql — this UPSERT
--        flips it ON.
--
-- ─── Explicitly NOT touched by this migration ────────────────────────────────
-- ff_revision_os_v1, ff_practice_os_v1, ff_test_os_v1 — these gate NEW routes
-- (/revision, /practice, /exam-briefing) that are launcher/hub pages handing
-- off to existing engines. They were not part of this reconciliation
-- decision; ramping a brand-new route needs its own separate CEO call.
--
-- ─── Protected-flag registry check ───────────────────────────────────────────
-- None of the four flags above appear in packages/lib/src/flags/
-- protected-flags.ts (PROTECTED_FLAGS / EXPECTED_OFF_FLAGS) as of this
-- writing, so no CEO-APPROVED-FLAG-FLIP marker comment is required by
-- scripts/check-protected-flag-migrations.mjs.
--
-- ─── Column shape / REG-125 conformance ──────────────────────────────────────
-- Mirrors 20260620001601_enable_latest_frontend_flags.sql: explicit column
-- list, first column flag_name, idempotent UPSERT (INSERT ... ON CONFLICT
-- (flag_name) DO UPDATE) against the canonical unique key
-- feature_flags_flag_name_key. UPSERT (not a bare UPDATE or DO NOTHING) is
-- deliberate: ff_subjects_os_v1 has never been seeded, so a bare UPDATE would
-- no-op and silently fail to enable it; the other three rows already exist in
-- various OFF/ON states, so ON CONFLICT DO NOTHING would silently fail to
-- flip the still-OFF ones. The UPSERT creates an absent row enabled-at-100%
-- and forces every existing row to the enabled/100 state regardless of its
-- prior value. Replayable: re-running re-asserts the ON state.
--
-- Scoping: rollout_percentage = 100, target_roles/target_environments/
-- target_institutions = NULL → enabled GLOBALLY for ALL tenants on apply.
--
-- No DDL. No DROP. No new tables → RLS N/A; feature_flags keeps its existing
-- baseline RLS posture. Guarded so it no-ops cleanly on a fresh DB where
-- feature_flags does not yet exist.
--
-- Owner: architect. CEO-approved, 2026-08-02.
-- Added: 2026-08-02
--
-- ─── Reversible (instant rollback) ───────────────────────────────────────────
--   UPDATE feature_flags SET is_enabled = false, updated_at = now()
--   WHERE flag_name IN (
--     'ff_student_os_v1', 'ff_subjects_os_v1',
--     'ff_foxy_os_v1', 'ff_engagement_dashboard_v1'
--   );
-- Each consuming surface falls back to its legacy/unmounted rendering when
-- its flag is OFF or missing, so the rollback is silent on the production
-- experience.

DO $ramp_alfa_os_presentation_flags$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- 1. Alfa OS student dashboard + Foxy 3-pane desktop workspace.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_student_os_v1', true, 100,
      'Alfa OS flagship redesign: student dashboard (StudentOSDashboard — Today''s Mission hero wrapping the existing DailyRhythmQueue, Mastery Snapshot, Revision Rail, per-subject Subject Roadmaps) + Foxy 3-pane desktop workspace (Conversations rail | Conversation | Context panel). Presentation-layer only over the unchanged scoring/XP/anti-cheat/quiz pipelines and the unchanged Foxy structured-render envelope/modes/daily limits (P1/P2/P3/P4/P12 untouched). CEO-approved ramp, 2026-08-02.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 2. Alfa OS Subjects/Learn hub (SubjectsOSHub) inside /learn.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_subjects_os_v1', true, 100,
      'Alfa OS Subjects experience (SubjectsOSHub) inside /learn: when a subject is selected, the new per-subject hub renders in place of the legacy chapter list. Presentation-only, no schema/scoring change. CEO-approved ramp, 2026-08-02.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 3. Foxy OS mobile-first redesign (compact top bar + Study sheet, <lg only).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_foxy_os_v1', true, 100,
      'Foxy OS mobile-first redesign of the /foxy AI tutor workspace (compact top bar + Study bottom sheet on phones, <lg only; >=lg unchanged). Presentation-layer only — does not touch /api/foxy, the structured-render envelope, scope-lock, or daily limits (P12/REG-55 untouched). CEO-approved ramp, 2026-08-02.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 4. Engagement Dashboard at /progress/dashboard.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_engagement_dashboard_v1', true, 100,
      'Student-facing engagement/progress dashboard at /progress/dashboard — XP/level ring, streak flame, cross-subject mastery radar, per-subject mastery bands, recent quiz history. No new tables; aggregates from existing students/concept_mastery/quiz_responses. CEO-approved ramp, 2026-08-02.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping Alfa OS presentation flag ramp (fresh DB).';
  END IF;
END $ramp_alfa_os_presentation_flags$;
