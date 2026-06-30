-- Migration: 20260702050000_class_enrollments_teacher_select_policy.sql
-- Purpose: TSB-4 READY-NOW slice (P8). Add the MISSING teacher SELECT policy to
--          class_enrollments so the canonical-by-intent roster is reachable by an
--          assigned teacher on the RLS client, mirroring class_students BYTE-FOR-BYTE.
--
-- ─── THE GAP THIS CLOSES (P8 — teacher data boundary) ────────────────────────
--   class_enrollments is the CANONICAL-BY-INTENT class-membership roster: the
--   school-admin de-enroll path flips its is_active=false (see ADR in migration
--   20260702030000_class_membership_softdelete_sync.sql). Yet its RLS today
--   (baseline 20639-20652) grants SELECT only to:
--     * class_enrollments_school_admin_select  (admin's school)
--     * class_enrollments_student_select       (student's own rows)
--     * class_enrollments_service_role         (service role bypass)
--   There is NO TEACHER SELECT POLICY. A teacher on the RLS client therefore gets
--   ZERO rows from class_enrollments — the very table that holds the authoritative
--   enrollment state. By contrast class_students DOES carry a teacher policy
--   ("Teachers can view students in their classes", baseline 20240-20243). This
--   asymmetry is part of why the live boundary reads class_students instead of the
--   canonical roster. Adding the symmetric teacher policy here is pure
--   defense-in-depth and a prerequisite for the eventual (CEO-gated) repoint of
--   canAccessStudent / is_teacher_of onto class_enrollments.
--
-- ─── BLAST RADIUS: grant-only, additive, fail-OPEN-safe ──────────────────────
--   class_enrollments has ZERO teacher policy today, so no existing teacher read
--   path can regress. This migration only ADDS a SELECT grant scoped to the
--   teacher's own assigned classes (same class_teachers/teachers/auth.uid()
--   subquery as class_students). It changes no reader, no other policy, no column.
--   No DROP TABLE/COLUMN. RLS is already ENABLED on class_enrollments (baseline
--   20639) — this migration does NOT toggle RLS.
--
-- ─── IDEMPOTENT / replayable ─────────────────────────────────────────────────
--   DROP POLICY IF EXISTS then CREATE POLICY. Safe on PROD, main-staging, CI
--   live-DB, and fresh DBs.
--
-- Owner: architect. TSB-4 READY-NOW slice (P8) — additive teacher SELECT policy.

BEGIN;

-- class_enrollments already has RLS ENABLED (baseline 20639); do NOT toggle it.
-- Teacher SELECT policy — BYTE-FOR-BYTE mirror of the class_students teacher policy
-- "Teachers can view students in their classes" (baseline 20240-20243):
--   class_id IN (SELECT ct.class_id FROM class_teachers ct
--                JOIN teachers t ON t.id = ct.teacher_id
--                WHERE t.auth_user_id = auth.uid())
DROP POLICY IF EXISTS "class_enrollments_teacher_select" ON "public"."class_enrollments";
CREATE POLICY "class_enrollments_teacher_select" ON "public"."class_enrollments"
  FOR SELECT TO "authenticated"
  USING (("class_id" IN ( SELECT "ct"."class_id"
     FROM ("public"."class_teachers" "ct"
       JOIN "public"."teachers" "t" ON (("t"."id" = "ct"."teacher_id")))
    WHERE ("t"."auth_user_id" = "auth"."uid"()))));

COMMIT;

-- ─── Verify (manual checks after applying) ───────────────────────────────────
-- 1. As an assigned teacher (RLS client), SELECT on class_enrollments now returns
--    the rows for that teacher's classes (previously zero).
-- 2. A teacher who is NOT assigned to a class still sees zero rows for it.
-- 3. The school-admin, student, and service-role policies are unchanged.
