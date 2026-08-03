-- Migration: 20260802170000_ramp_wave_b_gap_screens.sql
-- Purpose: CEO-authorized (2026-08-03) ENABLEMENT of the 6 "Wave B gap
--          screens" feature flags seeded OFF by
--          20260802120000_seed_ff_wave_b_gap_screens.sql. This migration
--          flips all six to is_enabled = true, rollout_percentage = 100,
--          globally (no role/env/institution scoping).
--
-- Flags enabled (all is_enabled = true, rollout_percentage = 100):
--
--   1. ff_me_v2
--        New /me route (ProfileScreen.tsx) — identity/streak/settings/
--        data-export screen. Net-new page; no existing surface depends on
--        it while off, so ramping is additive only.
--
--   2. ff_onboarding_v2
--        Additive branch inside the existing /onboarding flow (SetupFlow.tsx):
--        4-step DPDP-aware parent-email gate. The legacy onboarding path
--        remains reachable/untouched code-wise; this flag only switches
--        which branch renders.
--
--   3. ff_learn_topic_v2
--        Additive branch inside the existing /learn/[subject]/[chapter]
--        chapter page (TopicPage.tsx): citation-gated explanations. Legacy
--        chapter page path remains in the codebase untouched; this flag
--        only switches which branch renders.
--
--   4. ff_quiz_result_v2
--        Additive branch inside the existing /quiz results state
--        (ResultSummary.tsx). JUST APPROVED for ramp by assessment this
--        session: verified P1 (score formula) and P2 (XP formula) are
--        untouched, the correct shared `mastery-band-labels.ts` module is
--        used consistently, and no XP/score values are hardcoded. Display-
--        layer only — does not alter score/XP computation.
--        KNOWN NON-BLOCKING FINDING (assessment, does not block this ramp):
--        a pre-existing, unrelated tech-debt item was flagged on an OLDER
--        surface — `SubjectMasteryCard.tsx` — which uses a different,
--        un-shared mastery-band vocabulary than `mastery-band-labels.ts`.
--        This predates ff_quiz_result_v2 and is not touched by it. Tracked
--        as a future fast-follow (reconcile SubjectMasteryCard.tsx onto the
--        shared `mastery-band-labels.ts` module); intentionally NOT fixed
--        as part of this ramp.
--
--   5. ff_foxy_snap_v1
--        New /foxy/snap route (SnapDoubt.tsx). ⚠️ KNOWN, ACCEPTED
--        LIMITATION (shipped as-is per explicit CEO direction, NOT an
--        oversight): this is a PRESENTATIONAL SHELL ONLY. Topic-matching
--        and the Foxy hand-off are real and functional. The core "take a
--        photo" capture action (camera/OCR) is intentionally NOT wired yet
--        and is a non-functional placeholder pending a separate product
--        decision on the camera/OCR vendor and flow. Ramping this flag
--        makes the route reachable and makes the real topic-matching/
--        Foxy-handoff features live — it does NOT make photo capture
--        functional. A parallel frontend task is wiring a discoverable nav
--        link to this route in the same window as this ramp.
--
--   6. ff_plan_v2
--        New PlanModal.tsx component. Reuses the existing `useCheckout` /
--        `/api/payments/subscribe` checkout path; invents no new price
--        (P11 payment integrity untouched — no new SKU, no bypass of
--        Razorpay signature verification). A parallel frontend task is
--        wiring a trigger button to mount/open this modal; the component
--        itself is inert with no mount point until that trigger lands, so
--        ramping the flag now is a zero-risk precondition for that PR.
--
-- ─── Protected-flag registry check ───────────────────────────────────────────
-- Verified against packages/lib/src/flags/protected-flags.ts (PROTECTED_FLAGS
-- and EXPECTED_OFF_FLAGS) and scripts/check-protected-flag-migrations.mjs:
-- none of ff_me_v2, ff_onboarding_v2, ff_learn_topic_v2, ff_quiz_result_v2,
-- ff_foxy_snap_v1, ff_plan_v2 appear in either list (grepped both files,
-- zero matches). No `-- CEO-APPROVED-FLAG-FLIP:` marker is required for
-- this migration.
--
-- ─── Column shape / REG-125 conformance ──────────────────────────────────────
-- Mirrors 20260802110000_ramp_alfa_os_presentation_flags.sql: explicit
-- column list, first column flag_name, idempotent UPSERT (INSERT ... ON
-- CONFLICT (flag_name) DO UPDATE) against the canonical unique key
-- feature_flags_flag_name_key. UPSERT (not a bare UPDATE or DO NOTHING) is
-- deliberate: it creates the row enabled-at-100% if for any reason it does
-- not yet exist (e.g. out-of-order apply on a fresh environment where the
-- 20260802120000 seed has not yet run), and forces every existing row to
-- the enabled/100 state regardless of its prior value. Replayable:
-- re-running re-asserts the ON state.
--
-- Scoping: rollout_percentage = 100, target_roles/target_environments/
-- target_institutions = NULL → enabled GLOBALLY for ALL tenants on apply.
--
-- No DDL. No DROP. No new tables → RLS N/A; feature_flags keeps its
-- existing baseline RLS posture. Guarded so it no-ops cleanly on a fresh DB
-- where feature_flags does not yet exist.
--
-- Owner: architect. CEO-approved, 2026-08-03.
-- Added: 2026-08-03
--
-- ─── Reversible (instant rollback) ───────────────────────────────────────────
--   UPDATE feature_flags SET is_enabled = false, rollout_percentage = 0,
--     updated_at = now()
--   WHERE flag_name IN (
--     'ff_me_v2', 'ff_onboarding_v2', 'ff_learn_topic_v2',
--     'ff_quiz_result_v2', 'ff_foxy_snap_v1', 'ff_plan_v2'
--   );
-- Each consuming surface falls back to its legacy/unmounted rendering when
-- its flag is OFF or missing, so the rollback is silent on the production
-- experience.

DO $ramp_wave_b_gap_screens$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN

    -- 1. /me identity/streak/settings/data-export screen.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_me_v2', true, 100,
      'Wave B gap screens: new /me route (ProfileScreen.tsx) — identity/streak/settings/data-export screen. Net-new page. CEO-approved ramp, 2026-08-03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 2. Onboarding v2 — 4-step DPDP-aware parent-email gate.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_onboarding_v2', true, 100,
      'Wave B gap screens: additive branch inside the existing /onboarding flow (SetupFlow.tsx) — 4-step DPDP-aware parent-email gate. Legacy onboarding path remains in the codebase; this flag only switches which branch renders. CEO-approved ramp, 2026-08-03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 3. Learn topic v2 — citation-gated explanations.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_learn_topic_v2', true, 100,
      'Wave B gap screens: additive branch inside the existing /learn/[subject]/[chapter] chapter page (TopicPage.tsx) — citation-gated explanations. Legacy chapter page remains in the codebase; this flag only switches which branch renders. CEO-approved ramp, 2026-08-03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 4. Quiz result v2 — assessment-approved (P1/P2 verified untouched).
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_quiz_result_v2', true, 100,
      'Wave B gap screens: additive branch inside the existing /quiz results state (ResultSummary.tsx). Assessment-approved for ramp: P1 score formula and P2 XP formula verified untouched, uses the correct shared mastery-band-labels.ts module consistently, no hardcoded values. Display-layer only. Known non-blocking finding (does not block this ramp): the pre-existing, unrelated SubjectMasteryCard.tsx surface uses a different unshared mastery-band vocabulary — tracked as a future fast-follow, not fixed here. CEO-approved ramp, 2026-08-03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 5. Foxy snap v1 — presentational shell; camera/OCR capture NOT wired.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_foxy_snap_v1', true, 100,
      'Wave B gap screens: new /foxy/snap route (SnapDoubt.tsx). KNOWN, ACCEPTED LIMITATION (shipped as-is per explicit CEO direction, not an oversight): this is a presentational shell only. Topic-matching and the Foxy hand-off are real and functional; the core "take a photo" camera/OCR capture action is intentionally NOT wired yet and is a non-functional placeholder pending a separate product decision. This ramp makes the route reachable and makes topic-matching/Foxy-handoff live; it does not make photo capture functional. A parallel frontend task is wiring a discoverable nav link to this route. CEO-approved ramp, 2026-08-03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

    -- 6. Plan v2 — PlanModal, reuses existing checkout path, no new price.
    INSERT INTO public.feature_flags (
      flag_name, is_enabled, rollout_percentage, description,
      target_roles, target_environments, target_institutions,
      created_at, updated_at
    )
    VALUES (
      'ff_plan_v2', true, 100,
      'Wave B gap screens: new PlanModal.tsx component (screen 15). Reuses the existing useCheckout/`/api/payments/subscribe` checkout path; invents no new price (P11 untouched — no new SKU, no bypass of Razorpay signature verification). A parallel frontend task is wiring a trigger button to mount/open this modal; component is inert with no mount point until that trigger lands. CEO-approved ramp, 2026-08-03.',
      NULL, NULL, NULL, now(), now()
    )
    ON CONFLICT (flag_name) DO UPDATE
      SET is_enabled        = true,
          rollout_percentage = 100,
          updated_at        = now();

  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping Wave B gap-screen flag ramp (fresh DB).';
  END IF;
END $ramp_wave_b_gap_screens$;
