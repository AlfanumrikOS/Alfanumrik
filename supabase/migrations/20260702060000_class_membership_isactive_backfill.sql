-- Migration: 20260702060000_class_membership_isactive_backfill.sql
-- Purpose: TSB-4 READY-NOW slice (P8). One-time, FAIL-CLOSED reconcile of the
--          ALREADY-DIVERGENT historical class-membership rows that the
--          going-forward UPDATE-mirror triggers (migration 20260702030000) could
--          not retroactively fix.
--
-- ─── THE LIVE P8 LEAK THIS RECONCILES ────────────────────────────────────────
--   class_enrollments is canonical-by-intent; the school-admin de-enroll flips its
--   is_active=false. Before the 20260702030000 UPDATE-mirror triggers existed, that
--   flip NEVER propagated to class_students — so a de-enrolled student kept
--   is_active=true on class_students and REMAINED VISIBLE to the assigned teacher
--   via canAccessStudent (src/lib/rbac.ts:331, reads class_students .eq('is_active',
--   true)) and is_teacher_of(). The triggers only handle NEW flips from now on;
--   the rows that diverged BEFORE the triggers landed are still divergent on prod.
--   This migration reconciles them, ONCE, in the FAIL-CLOSED direction only.
--
-- ─── FAIL-CLOSED CONTRACT (only ever REMOVES visibility) ─────────────────────
--   Two divergence directions exist for a (class_id, student_id) pair:
--     A) ce.is_active=false AND cs.is_active=true  — THE LEAK. The de-enroll was
--        already authorized on the canonical table; class_students simply never
--        caught up. Completing it can only REMOVE a student from a teacher's view,
--        never over-grant. >>> THIS MIGRATION FIXES THIS DIRECTION. <<<
--     B) ce.is_active=true AND cs.is_active=false  — the reverse. "Fixing" it would
--        re-activate a class_students row and GRANT teacher visibility. That is an
--        authorization-WIDENING change and is NOT safe to auto-apply. >>> THIS
--        MIGRATION ONLY RAISE-NOTICE REPORTS direction B for manual review. <<<
--
-- ─── TRIGGER INTERACTION (no recursion/storm) ────────────────────────────────
--   The UPDATE below flips class_students.is_active true->false. That fires the
--   20260702030000 AFTER-UPDATE-OF-is_active mirror trigger
--   (trg_sync_class_students_active_to_enrollments), which attempts to mirror onto
--   class_enrollments. But the counterpart class_enrollments row is ALREADY false
--   (that is the originating de-enroll), so the trigger's row-level
--   "is_active IS DISTINCT FROM NEW.is_active" predicate matches ZERO rows -> no
--   UPDATE -> no further trigger fire. One bounce, then stop. No storm.
--
-- ─── SCOPE / SAFETY (HARD CONSTRAINTS) ───────────────────────────────────────
--   - ADDITIVE + a single fail-closed UPDATE. NO DROP TABLE/COLUMN.
--   - The DROP that appears is DROP POLICY IF EXISTS immediately followed by CREATE
--     (idempotent policy re-create) on the new backup table only.
--   - DEFERRED / OUT OF SCOPE (explicitly): repointing canAccessStudent /
--     is_teacher_of to read class_enrollments, and the eventual DROP of the
--     redundant roster table. Both are part of the SEPARATE, CEO-gated TSB-4
--     cutover (table-DROP is also hook-blocked). NOT done here.
--   - IDEMPOTENT / replayable: a re-run finds zero pairs matching direction A
--     (they were already set false), snapshots nothing new (WHERE NOT EXISTS guard),
--     and re-creates the backup table/policy harmlessly. Safe on PROD, main-staging,
--     CI live-DB, and fresh DBs (zero divergent rows -> all statements no-op).
--
-- Owner: architect. TSB-4 READY-NOW slice (P8) — one-time fail-closed reconcile.

BEGIN;

-- =============================================================================
-- 0. READ-ONLY DIVERGENCE COUNT (both directions) — operator visibility
-- =============================================================================
DO $$
DECLARE
  v_leak_dir_a   bigint;  -- ce=false / cs=true  (the leak — will be fixed)
  v_reverse_dir_b bigint; -- ce=true  / cs=false (reverse — REPORTED, not fixed)
BEGIN
  SELECT count(*) INTO v_leak_dir_a
    FROM public.class_enrollments ce
    JOIN public.class_students    cs
      ON cs.class_id = ce.class_id AND cs.student_id = ce.student_id
   WHERE ce.is_active = false AND cs.is_active = true;

  SELECT count(*) INTO v_reverse_dir_b
    FROM public.class_enrollments ce
    JOIN public.class_students    cs
      ON cs.class_id = ce.class_id AND cs.student_id = ce.student_id
   WHERE ce.is_active = true AND cs.is_active = false;

  RAISE NOTICE 'TSB-4 backfill: direction A (ce=false/cs=true, THE LEAK — will fix): % pair(s)', v_leak_dir_a;
  RAISE NOTICE 'TSB-4 backfill: direction B (ce=true/cs=false, reverse — REPORT ONLY, manual review): % pair(s)', v_reverse_dir_b;
END $$;

-- =============================================================================
-- 1. BACKUP TABLE for exact rollback (RLS + service-role-only policy — P8)
--    Every new table gets RLS + a policy in the SAME migration. This is a
--    service-role-only forensic/rollback table (UUIDs only, no PII); no other
--    role may read it.
-- =============================================================================
CREATE TABLE IF NOT EXISTS "public"."_tsb4_isactive_backfill_backup" (
  "class_id"       "uuid"        NOT NULL,
  "student_id"     "uuid"        NOT NULL,
  "table_name"     "text"        NOT NULL,
  "old_is_active"  boolean       NOT NULL,
  "backfilled_at"  timestamp with time zone NOT NULL DEFAULT "now"()
);

ALTER TABLE "public"."_tsb4_isactive_backfill_backup" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "_tsb4_isactive_backfill_backup_service_role"
  ON "public"."_tsb4_isactive_backfill_backup";
CREATE POLICY "_tsb4_isactive_backfill_backup_service_role"
  ON "public"."_tsb4_isactive_backfill_backup"
  USING (("auth"."role"() = 'service_role'::"text"));

-- =============================================================================
-- 2. SNAPSHOT the rows about to change (direction A class_students rows) into the
--    backup, BEFORE updating. Guarded by WHERE NOT EXISTS so a replay does not
--    duplicate already-captured rows.
-- =============================================================================
INSERT INTO "public"."_tsb4_isactive_backfill_backup"
  ("class_id", "student_id", "table_name", "old_is_active")
SELECT cs.class_id, cs.student_id, 'class_students', cs.is_active
  FROM public.class_students    cs
  JOIN public.class_enrollments ce
    ON ce.class_id = cs.class_id AND ce.student_id = cs.student_id
 WHERE ce.is_active = false
   AND cs.is_active = true
   AND NOT EXISTS (
     SELECT 1 FROM public._tsb4_isactive_backfill_backup b
      WHERE b.class_id   = cs.class_id
        AND b.student_id = cs.student_id
        AND b.table_name = 'class_students'
   );

-- =============================================================================
-- 3. FAIL-CLOSED RECONCILE — direction A ONLY (ce=false -> cs=false).
--    Completes an already-authorized de-enroll. Can only REMOVE visibility.
--    Idempotent: a re-run finds zero (cs.is_active=true) rows for these pairs.
-- =============================================================================
UPDATE public.class_students cs
   SET is_active  = false,
       updated_at = now()
  FROM public.class_enrollments ce
 WHERE ce.class_id   = cs.class_id
   AND ce.student_id = cs.student_id
   AND ce.is_active  = false
   AND cs.is_active  = true;

-- =============================================================================
-- 4. Direction B (ce=true / cs=false) is NOT auto-applied — re-activating a
--    class_students row would GRANT teacher visibility (authorization-widening).
--    It is only reported (step 0 NOTICE) for manual review. No statement here.
-- =============================================================================

COMMIT;

-- ─── Rollback (manual, if ever needed) ───────────────────────────────────────
--   Restore the pre-reconcile class_students.is_active from the backup:
--     UPDATE public.class_students cs
--        SET is_active = b.old_is_active, updated_at = now()
--       FROM public._tsb4_isactive_backfill_backup b
--      WHERE b.table_name = 'class_students'
--        AND b.class_id   = cs.class_id
--        AND b.student_id = cs.student_id;
--   (Re-activating via this path will re-fire the 20260702030000 mirror trigger,
--    which will then re-mirror onto class_enrollments — intended for a true rollback.)
