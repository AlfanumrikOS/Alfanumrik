-- Migration: 20260722104300_activate_ff_practice_revision_test_os_v1.sql
-- Purpose: CEO-approved go-live activation for the three Alfa OS
--          presentation-only Tier 1 flags: ff_practice_os_v1,
--          ff_revision_os_v1, ff_test_os_v1.
--
-- ─── Approval ─────────────────────────────────────────────────────────────
-- CEO (ceo@alfanumrik.com), this conversation, 2026-07-22: "i approve to on
-- flags recommended in teir 1 and 2" -- Tier 1 is these three flags; Tier 2
-- is a separate protected-flag pilot that goes through the live admin
-- console (admin_flip_feature_flag RPC), NOT this migration.
--
-- ─── This is the anticipated follow-up activation ──────────────────────────
-- Each flag was seeded OFF (is_enabled=false, rollout_percentage=0) by:
--   20260722104000_seed_ff_practice_os_v1.sql
--   20260722104100_seed_ff_revision_os_v1.sql
--   20260722104200_seed_ff_test_os_v1.sql
-- Every one of those seed migrations states verbatim that "Go-live is a
-- DELIBERATE, SEPARATE activation the user approves -- either an operator
-- flipping this flag via the admin_flip_feature_flag RPC, or a follow-up
-- activation migration." This migration IS that follow-up activation.
--
-- ─── Why a direct UPDATE (not admin_flip_feature_flag) is correct here ─────
-- I read packages/lib/src/flags/protected-flags.ts in full: none of
-- ff_practice_os_v1, ff_revision_os_v1, ff_test_os_v1 appear in
-- PROTECTED_FLAGS (exact-match) or PROTECTED_PREFIXES (ff_python_* only),
-- and none appear in EXPECTED_OFF_FLAGS (the nightly flag-posture-canary's
-- forced-OFF list). They were never mirrored into
-- public.protected_feature_flags (migration 20260722090000) either.
--
-- I also read 20260722090100_feature_flags_db_guard_trigger.sql in full.
-- Its BEFORE UPDATE trigger function protect_feature_flags_guard() does:
--   SELECT tier INTO v_tier FROM protected_feature_flags
--    WHERE flag_name = OLD.flag_name;
--   IF v_tier IS NULL THEN RETURN NEW; END IF;
-- With no protected_feature_flags row for any of these three flag_names,
-- v_tier is NULL and the trigger returns NEW unconditionally on its very
-- first branch -- it never reaches the ack-GUC check at all. So a direct
-- UPDATE (this migration, run as the migration runner / service role) is
-- unguarded and needs no `SET LOCAL app.protected_flag_ack`. These three
-- are intentionally simple, fast-toggle, unprotected flags, and this
-- migration does NOT add them to PROTECTED_FLAGS or
-- protected_feature_flags -- they stay that way.
--
-- ─── Effect ─────────────────────────────────────────────────────────────
-- Sets is_enabled = true, rollout_percentage = 100 for exactly these three
-- rows. Per nav-config.ts, isItemVisibleForFlags() will now show the new v2
-- nav entries (/practice "Practice Center", /revision "Revision Center",
-- /exam-briefing "Exam Briefing") ALONGSIDE the existing live v1 entries
-- (/quiz "Practice", /refresh "Refresh", /exam-prep "Exam Sprint") --
-- intentional coexistence per this activation's scope, not a replacement.
-- Presentation-only: no scoring/XP/anti-cheat/mastery/schema change rides
-- on any of the three (per each seed migration's own description).
--
-- No other flag is touched. No RLS/schema change (feature_flags already
-- exists with its established RLS posture). Idempotent: re-running this
-- migration is a no-op UPDATE-to-same-values.
--
-- ─── DOWN (manual) ─────────────────────────────────────────────────────────
--   UPDATE feature_flags
--      SET is_enabled = false, rollout_percentage = 0, updated_at = now()
--    WHERE flag_name IN ('ff_practice_os_v1', 'ff_revision_os_v1', 'ff_test_os_v1');
--
-- Owner: architect. Approval: CEO (2026-07-22, this conversation).

BEGIN;

DO $activate_tier1_os_flags$
BEGIN
  IF to_regclass('public.feature_flags') IS NOT NULL THEN
    UPDATE public.feature_flags
       SET is_enabled = true,
           rollout_percentage = 100,
           updated_at = now()
     WHERE flag_name IN (
       'ff_practice_os_v1',
       'ff_revision_os_v1',
       'ff_test_os_v1'
     );
  ELSE
    RAISE NOTICE 'feature_flags table absent; skipping Tier 1 OS flag activation (fresh DB).';
  END IF;
END $activate_tier1_os_flags$;

COMMIT;
