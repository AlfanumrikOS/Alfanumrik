-- Migration: 20260418101200_coverage_audit_helpers.sql
-- Purpose: Support tables + helpers for the nightly coverage-audit Edge
-- Function. Spec §8.2.
--
-- Contains:
--  1. coverage_audit_snapshots: one row per IST day capturing cbse_syllabus
--     rag_status so the audit can detect day-over-day regressions.
--  2. total_questions_in_chapter helper function — used by the auto-disable
--     threshold math (verified_ratio = verified / total).
--
-- Notes on RLS: snapshots are admin-only. The table is tiny (one row/day per
-- deployment) so we use the established `admin_users.is_active` pattern.

-- ── Snapshot table ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coverage_audit_snapshots (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date       date NOT NULL DEFAULT (current_date AT TIME ZONE 'Asia/Kolkata'),
  cbse_syllabus_rows  jsonb NOT NULL,  -- array of {board,grade,subject_code,chapter_number,rag_status,chunk_count,verified_question_count}
  ready_count         int NOT NULL DEFAULT 0,
  partial_count       int NOT NULL DEFAULT 0,
  missing_count       int NOT NULL DEFAULT 0,
  total_verified_questions int NOT NULL DEFAULT 0,
  total_chunks        int NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_coverage_audit_snapshots_date
  ON coverage_audit_snapshots (snapshot_date DESC);

ALTER TABLE coverage_audit_snapshots ENABLE ROW LEVEL SECURITY;

-- Admin read (service role bypasses automatically). Mirrors the grounded_ai_traces
-- admin policy.
DROP POLICY IF EXISTS coverage_audit_snapshots_read_admin ON coverage_audit_snapshots;
CREATE POLICY coverage_audit_snapshots_read_admin ON coverage_audit_snapshots
  FOR SELECT USING (
    auth.role() = 'service_role' OR
    auth.uid() IN (SELECT auth_user_id FROM admin_users WHERE is_active = true)
  );

-- Service-role only writes. No student/teacher paths touch this table.
DROP POLICY IF EXISTS coverage_audit_snapshots_write_service ON coverage_audit_snapshots;
CREATE POLICY coverage_audit_snapshots_write_service ON coverage_audit_snapshots
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE coverage_audit_snapshots IS
  'One row per IST day. Edge Function coverage-audit inserts the full '
  'cbse_syllabus rag_status snapshot here, then compares to the previous '
  'day to detect ready→partial regressions. Spec §8.2.';

-- ── Total questions helper ───────────────────────────────────────────────────
-- Returns the count of *all* non-deleted question_bank rows for a chapter
-- regardless of verification state. Used as the denominator in
-- verified_ratio = verified_count / total_questions.
--
-- SECURITY INVOKER so RLS applies to the caller (Edge Function uses service
-- role which bypasses; admin_users queries respect RLS).
CREATE OR REPLACE FUNCTION total_questions_in_chapter(
  p_grade text,
  p_subject_code text,
  p_chapter_number int
) RETURNS int
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*)::int FROM question_bank
  WHERE grade = p_grade
    AND subject = p_subject_code
    AND chapter_number = p_chapter_number
    AND deleted_at IS NULL;
$$;

COMMENT ON FUNCTION total_questions_in_chapter(text, text, int) IS
  'Count of non-deleted questions in a chapter (any verification state). '
  'Denominator for verified_ratio auto-disable math. Spec §8.2.';