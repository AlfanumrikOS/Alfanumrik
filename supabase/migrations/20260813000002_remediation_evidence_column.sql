-- Migration: 20260813000002_remediation_evidence_column.sql
-- Purpose: Foxy North-Star Phase 5 (K3 — teacher remediation evidence snapshot).
--          Add an additive `evidence` jsonb column to
--          teacher_remediation_assignments so the escalation producer can freeze
--          a COUNTS/UUIDs-only snapshot of the state that justified the
--          assignment at CREATE time (worst chapters, at-risk counts, cliff
--          size, etc.). Teachers see WHY the system suggested the item without
--          re-deriving Pulse state at review time — and without ever seeing
--          answer text or PII.
--
-- Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
--       (Phase 5 K3 — teacher review lane evidence contract; P13 privacy).
--
-- ─── Additive-only / RLS posture ─────────────────────────────────────────────
-- Column is ADDED with a nullable default so all existing rows remain valid;
-- back-fill is a separate, non-blocking follow-up. Baseline RLS on
-- teacher_remediation_assignments is unchanged (same posture as the trigger
-- widenings in 20260619000500 for adaptive_interventions).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + COMMENT ON COLUMN. No DROP.

ALTER TABLE public.teacher_remediation_assignments
  ADD COLUMN IF NOT EXISTS evidence jsonb;

COMMENT ON COLUMN public.teacher_remediation_assignments.evidence IS
  'K3: counts/UUIDs-only snapshot at assign time. Never stores answer text or PII.';
