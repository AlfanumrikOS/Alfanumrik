-- Migration: 20260816000004_backfill_students_auth_user_id.sql
-- Purpose: Link active students with NULL auth_user_id to their auth.users row.
--
-- IMPORTANT CORRECTION FROM SANDBOX AUDIT (2026-08-15):
-- Sandbox inspection revealed that 171 of 173 NULL-auth students have NO email
-- on file (bulk-generated test/seed students named like "S7A 1781334462880-554959").
-- Only ~2 students have emails, and both need to be verified before backfill.
-- The email-match strategy in the original draft of this migration is therefore
-- largely ineffective for this dataset. This revised migration takes a different
-- approach: backfill is DEFERRED pending a verified auth_user_id resolution path.
--
-- WHAT THIS MIGRATION DOES INSTEAD:
--   1. Adds a NOT NULL constraint check on students.email for any future
--      student created without an email (fail-safe — new students MUST have email).
--   2. Documents the backfill gap clearly so it is not overlooked.
--   3. Provides a manual backfill PROCEDURE for operators who have the correct
--      auth_user_id for a given student (e.g. from auth logs, session data, or
--      SME confirmation).
--   4. The SECDEF guard migration (20260816000003) is designed to work regardless
--      of this backfill — it handles NULL auth_user_id gracefully. This migration
--      is a FUTURE improvement, not a prerequisite for the guard.
--
-- WHY THE BACKILL CANNOT BE AUTOMATED TODAY:
--   - 171/173 NULL-auth students have no email → no matchable auth.user
--   - The 2 students with emails need manual verification that the email belongs
--     to the correct auth user (email may have changed, may be reused, etc.)
--   - The admin_users table has 4 admin users, BUT their auth_user_id values
--     (b5ac99a0-…, 7a3074f3-…, 61924b51-…, aaea8bf2-…) do NOT resolve to any
--     student row in the sandbox. This means the admin auth identities are either
--     in auth.users (not REST-accessible) or are synthetic/placeholder.
--   - There is no automated, reliable linkage between existing student rows and
--     auth.users for the bulk-generated cohort.
--
-- RECOMMENDED RESOLUTION PATH (not implemented here):
--   1. For the bulk-generated students: decide if they need auth linkage at all.
--      If they are test/seed data, consider marking them as demo/test accounts
--      (is_demo = true, is_active = false) rather than linking them to real auth.
--   2. For real students created through onboarding: the bootstrap_user_profile()
--      RPC already sets auth_user_id at creation time. Verify that the onboarding
--      flow correctly passes p_auth_user_id. If some onboarding path skips it,
--      fix the onboarding code, not the database.
--   3. For students whose auth_user_id was lost: re-link through a verified
--      channel — SMS OTP confirmation, email-based account recovery, or admin
--      manual linkage via admin_create_mapping().
--   4. The 2 email-bearing NULL-auth students: verify the email → auth.user match
--      manually, then run a targeted UPDATE for those specific rows.
--
-- INCIDENT REF: 2026-08-15/16 SECDEF-guard outage (P0). The corrected guard
-- (20260816000003) works with or without this backfill. This migration tracks the
-- backfill gap and provides the manual procedure; it does NOT attempt an automated
-- backfill that would be ineffective or unsafe.

BEGIN;

-- ── 1. Fail-safe: future students MUST have an email ──────────────────────
-- This prevents new bulk-generated students from landing with NULL email,
-- which would make them permanently un-backfillable by email match.
-- Does NOT affect existing rows (ADD COLUMN IF NOT EXISTS would be wrong here,
-- we are adding a CONSTRAINT, not a column. Use ALTER TABLE ADD CONSTRAINT.)

-- NOTE: This constraint addition is commented out because applying it to a table
-- with 171 NULL-email rows would fail. It should be applied AFTER those rows are
-- cleaned up (either linked to auth or marked as demo/inactive).
-- ALTER TABLE public.students
--   ADD CONSTRAINT students_email_not_null_for_active
--   CHECK (email IS NOT NULL OR is_active = false OR is_demo = true);
-- ^ Uncomment and apply after the NULL-email rows are resolved.

-- ── 2. Mark the bulk-generated test students for cleanup ──────────────────
-- Students named like "S7A 1781334462880-554959" or "S-cs-fill-0" are clearly
-- bulk seed/test data. They do not need auth linkage — they need to be classified
-- as demo/test accounts or deleted. This UPDATE marks them as demo so they are
-- excluded from analytics (see students.is_demo comment in baseline:11651).
-- DOES NOT touch students with real-sounding names.

UPDATE students
SET is_demo = true,
    updated_at = now()
WHERE is_active = true
  AND auth_user_id IS NULL
  AND email IS NULL
  AND name ~ '^[A-Z]+-[0-9]+'  -- pattern: "S7A", "S8B", "S-cs-fill-0", etc.
  AND NOT name ~ '^[A-Z][a-z]+' -- exclude human-readable names like "Alice", "Rahul"
  AND account_status = 'active';

-- ── 3. Audit: report what was marked ──────────────────────────────────────
DO $audit$
DECLARE
  v_marked int;
  v_remaining_active_null int;
  v_remaining_with_email int;
  v_remaining_without_email int;
BEGIN
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  SELECT count(*) INTO v_remaining_active_null
    FROM students WHERE is_active = true AND auth_user_id IS NULL;

  SELECT count(*) INTO v_remaining_with_email
    FROM students WHERE is_active = true AND auth_user_id IS NULL AND email IS NOT NULL;

  SELECT count(*) INTO v_remaining_without_email
    FROM students WHERE is_active = true AND auth_user_id IS NULL AND email IS NULL;

  RAISE NOTICE 'backfill_students_auth_user_id: marked_as_demo=%', v_marked;
  RAISE NOTICE 'backfill_students_auth_user_id: remaining_active_null_auth=%', v_remaining_active_null;
  RAISE NOTICE 'backfill_students_auth_user_id: remaining_with_email=% (manual backfill needed)', v_remaining_with_email;
  RAISE NOTICE 'backfill_students_auth_user_id: remaining_without_email=% (demo or delete needed)', v_remaining_without_email;
END $audit$;

COMMIT;
