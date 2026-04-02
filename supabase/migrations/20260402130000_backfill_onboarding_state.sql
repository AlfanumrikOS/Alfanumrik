-- ============================================================================
-- Migration: 20260402130000_backfill_onboarding_state.sql
-- Purpose: Backfill onboarding_state for existing users who signed up before
--          the onboarding_state table was created (R16).
--          Also ensures all existing profiles have user_roles entries.
-- ============================================================================

-- Backfill onboarding_state for existing students without one
INSERT INTO onboarding_state (auth_user_id, intended_role, step, profile_id, completed_at)
SELECT s.auth_user_id, 'student', 'completed', s.id, COALESCE(s.created_at, now())
FROM students s
WHERE s.auth_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM onboarding_state os WHERE os.auth_user_id = s.auth_user_id
  )
ON CONFLICT (auth_user_id) DO NOTHING;

-- Backfill onboarding_state for existing teachers without one
INSERT INTO onboarding_state (auth_user_id, intended_role, step, profile_id, completed_at)
SELECT t.auth_user_id, 'teacher', 'completed', t.id, COALESCE(t.created_at, now())
FROM teachers t
WHERE t.auth_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM onboarding_state os WHERE os.auth_user_id = t.auth_user_id
  )
ON CONFLICT (auth_user_id) DO NOTHING;

-- Backfill onboarding_state for existing guardians without one
INSERT INTO onboarding_state (auth_user_id, intended_role, step, profile_id, completed_at)
SELECT g.auth_user_id, 'parent', 'completed', g.id, COALESCE(g.created_at, now())
FROM guardians g
WHERE g.auth_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM onboarding_state os WHERE os.auth_user_id = g.auth_user_id
  )
ON CONFLICT (auth_user_id) DO NOTHING;

-- Ensure all existing users have user_roles entries (re-sync)
-- Uses the sync_user_roles_for_user function from 20260402100000
DO $$
DECLARE
  v_auth_id UUID;
BEGIN
  -- Only run if the function exists (migration 20260402100000 applied)
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sync_user_roles_for_user') THEN
    FOR v_auth_id IN
      SELECT DISTINCT auth_user_id FROM students WHERE auth_user_id IS NOT NULL
      UNION
      SELECT DISTINCT auth_user_id FROM teachers WHERE auth_user_id IS NOT NULL
      UNION
      SELECT DISTINCT auth_user_id FROM guardians WHERE auth_user_id IS NOT NULL
    LOOP
      PERFORM sync_user_roles_for_user(v_auth_id);
    END LOOP;
  END IF;
END $$;
