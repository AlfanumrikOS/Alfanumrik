-- Migration: 20260813000003_adaptive_interventions_teacher_decision.sql
-- Purpose: Foxy North-Star Phase 5 (K4 — teacher override capture + K7 — audit
--          trail of who decided what and when). Add three additive columns to
--          adaptive_interventions so the teacher review lane can persist the
--          human decision on an autonomous suggestion:
--             teacher_decision  CHECK IN ('approved','overridden','dismissed')
--             decided_by        auth.users.id (soft pointer)
--             decided_at        timestamptz
--          The row itself remains the canonical intervention state; the three
--          columns describe the human overlay when a teacher intervened. NULL
--          on rows that never reached a human (Loop A/B/C auto-resolved paths).
--
-- Spec: docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md
--       (Phase 5 K4/K7 — human-in-the-loop decision capture; audit-log twin).
--
-- ─── Additive-only / RLS posture ─────────────────────────────────────────────
-- Same posture as 20260619000500_adaptive_interventions_extend_trigger_signal
-- (Loops B/C substrate extension): purely additive. No table create, no index
-- change, no RLS policy change — the baseline RLS on adaptive_interventions
-- keeps the student-lane read-only-own contract and service-role writes.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS (repeatable per Postgres 9.6+). The
-- inline CHECK on teacher_decision is added ONLY on the first successful ADD;
-- on a re-run, ADD COLUMN IF NOT EXISTS is a no-op and the constraint stays.
--
-- No DROP TABLE / DROP COLUMN. Owner: architect. Reviewer chain: backend
-- (teacher review-lane API), frontend (teacher UI), ops (audit-trail exposure).

ALTER TABLE public.adaptive_interventions
  ADD COLUMN IF NOT EXISTS teacher_decision text
    CHECK (teacher_decision IN ('approved', 'overridden', 'dismissed')),
  ADD COLUMN IF NOT EXISTS decided_by uuid,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz;

COMMENT ON COLUMN public.adaptive_interventions.teacher_decision IS
  'K4: teacher review-lane decision on an autonomous suggestion. NULL until a human touches the row. Enum-only (approved/overridden/dismissed) — reason lives on the teacher.override event payload (reason_code enum, no free text) per P13.';
COMMENT ON COLUMN public.adaptive_interventions.decided_by IS
  'K7: auth.users.id of the reviewing teacher. Soft pointer (no FK) so identity teardown does not cascade the audit trail.';
COMMENT ON COLUMN public.adaptive_interventions.decided_at IS
  'K7: wall-clock stamp of the teacher_decision. Paired with the teacher.override event on the bus for cross-surface reconstruction.';
