-- ============================================================================
-- C3 + C2: Enforce UNIQUE auth_user_id + add performance indexes
--
-- PROBLEM: students, teachers, and guardians tables allow duplicate
-- auth_user_id values. A single auth user can have multiple profiles,
-- causing unpredictable RLS behavior and identity resolution bugs.
-- Additionally, every RLS policy calls get_student_id_for_auth() which
-- does a sequential scan without indexes — catastrophic at scale.
--
-- FIX: Add partial unique indexes (excluding NULL and soft-deleted rows)
-- and performance indexes for RLS hot paths.
-- ============================================================================

BEGIN;

-- ─── Step 1: Deduplicate existing data ─────────────────────────────────────
-- Keep the most recently active row for each auth_user_id, soft-delete others.
-- This is safe because deleted_at rows are excluded from the unique constraint.

-- Students: mark duplicates as deleted (keep the one with latest last_active)
UPDATE students s
SET deleted_at = now(), is_active = false
WHERE s.auth_user_id IS NOT NULL
  AND s.deleted_at IS NULL
  AND s.id != (
    SELECT id FROM students s2
    WHERE s2.auth_user_id = s.auth_user_id
      AND s2.deleted_at IS NULL
    ORDER BY s2.is_active DESC, s2.last_active DESC NULLS LAST, s2.created_at DESC
    LIMIT 1
  );

-- Teachers: mark duplicates as deleted
UPDATE teachers t
SET deleted_at = now(), is_active = false
WHERE t.auth_user_id IS NOT NULL
  AND t.deleted_at IS NULL
  AND t.id != (
    SELECT id FROM teachers t2
    WHERE t2.auth_user_id = t.auth_user_id
      AND t2.deleted_at IS NULL
    ORDER BY t2.is_active DESC, t2.created_at DESC
    LIMIT 1
  );

-- Guardians: mark duplicates as deleted
UPDATE guardians g
SET deleted_at = now()
WHERE g.auth_user_id IS NOT NULL
  AND g.deleted_at IS NULL
  AND g.id != (
    SELECT id FROM guardians g2
    WHERE g2.auth_user_id = g.auth_user_id
      AND g2.deleted_at IS NULL
    ORDER BY g2.created_at DESC
    LIMIT 1
  );

-- ─── Step 2: Add UNIQUE partial indexes ────────────────────────────────────
-- Partial: only non-deleted rows with a non-null auth_user_id are constrained.
-- This allows:
--   - Rows with NULL auth_user_id (pre-linked profiles)
--   - Soft-deleted rows to exist without conflict

CREATE UNIQUE INDEX IF NOT EXISTS uq_students_auth_user_id
  ON students (auth_user_id)
  WHERE auth_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_teachers_auth_user_id
  ON teachers (auth_user_id)
  WHERE auth_user_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guardians_auth_user_id
  ON guardians (auth_user_id)
  WHERE auth_user_id IS NOT NULL AND deleted_at IS NULL;

-- ─── Step 3: Performance indexes for RLS hot paths (C2) ───────────────────
-- Every RLS policy calls get_student_id_for_auth(auth.uid()) which filters
-- by auth_user_id + is_active. Without these, every query does a full table
-- scan. At 5000 concurrent users × 45 RLS policies = database collapse.

-- Students: the most-queried table (every student action triggers RLS)
CREATE INDEX IF NOT EXISTS idx_students_auth_user_active
  ON students (auth_user_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Teachers: queried on every teacher action
-- Drop the existing non-partial index and replace with filtered one
DROP INDEX IF EXISTS idx_teachers_auth_user_id;
CREATE INDEX IF NOT EXISTS idx_teachers_auth_user_active
  ON teachers (auth_user_id)
  WHERE is_active = true AND deleted_at IS NULL;

-- Guardians: queried on every parent action (no is_active column)
CREATE INDEX IF NOT EXISTS idx_guardians_auth_user_active
  ON guardians (auth_user_id)
  WHERE deleted_at IS NULL;

COMMIT;
