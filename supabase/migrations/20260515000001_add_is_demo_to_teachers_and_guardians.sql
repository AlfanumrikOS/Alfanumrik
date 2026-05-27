-- Migration: add_is_demo_to_teachers_and_guardians
-- Date: 2026-05-15
-- Purpose: Stop the runtime "column does not exist" failures in
--          src/app/api/super-admin/test-accounts/route.ts (writes is_demo on
--          teachers + guardians) and src/app/api/super-admin/demo-accounts/route.ts
--          (selects is_demo from both tables). Matches the existing
--          public.students.is_demo column shape (boolean NOT NULL DEFAULT false).
--
-- Backward compatibility: column is added with a safe default so existing rows
-- are backfilled to false (not-demo) without rewriting writers.
-- Rollback: ALTER TABLE ... DROP COLUMN is_demo;

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

ALTER TABLE public.guardians
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
