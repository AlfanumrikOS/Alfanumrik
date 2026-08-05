-- Migration: 20260813000001_idx_student_misconceptions_open.sql
-- Purpose: Foxy North-Star Phase 5 (K2 — Misconception Register lookup path).
--          Add a covering PARTIAL index on student_misconceptions targeting the
--          hot lookup path: "for THIS student + THIS pattern_code, is there an
--          OPEN misconception right now?" (dedupe on new detections + write-once
--          resolution flip). Full-table scans are already tolerable at current
--          volume but the register's growth is roughly quiz-response-rate * K,
--          so we cover the read pattern before it becomes the hot lane.
--
-- Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
--       (Phase 5 K2 — Misconception Register: dedupe + close-out contract).
--
-- ─── Additive-only / RLS posture ─────────────────────────────────────────────
-- No new table, no new column, no schema-semantics change. The baseline
-- student_misconceptions RLS (student reads own, service_role writes) is
-- unchanged — a partial index has no RLS surface of its own.
--
-- Idempotent: CREATE INDEX IF NOT EXISTS. No DROP.

CREATE INDEX IF NOT EXISTS idx_student_misconceptions_open
  ON public.student_misconceptions (student_id, pattern_code)
  WHERE is_resolved = FALSE;

COMMENT ON INDEX public.idx_student_misconceptions_open IS
  'Foxy Phase 5 K2: partial index covering the "open misconception for (student, pattern)" lookup used by the writer''s dedupe path and the register''s resolution flip. Baseline RLS on student_misconceptions is unchanged.';
