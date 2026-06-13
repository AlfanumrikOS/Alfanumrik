-- Migration: 20260619000200_adaptive_interventions.sql
-- Purpose: Phase A Loop A (Adaptive Closed Loop: mastery-cliff -> auto-remediation
--          -> recovery verification) data layer. Creates `adaptive_interventions`,
--          the canonical state-machine table for system-initiated remediation
--          cycles (CEO-approved TIERED authority, model 3).
--
-- Spec: docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md
--       (Sections 4 "Loop Definition", 5.1 "adaptive_interventions").
--
-- One intervention cycle per (student, subject_code, chapter_number).
-- States: active -> recovered | escalated (terminal). `dismissed` is the
-- additional ops-only terminal state for the Section 9 hard-stop runbook
-- (bulk-resolve of active rows via service-role SQL when the kill switch's
-- natural drain is not enough) -- it is never produced by the cron loop.
--
-- ─── Identity / FK conventions (mirrors 20260613000004) ──────────────────────
--   - student_id            -> public.students(id)  (internal student id, NOT
--                              auth.uid(); the student's Supabase user is
--                              students.auth_user_id).
--   - teacher_assignment_id -> public.teacher_remediation_assignments(id),
--                              nullable; set on B2B escalation (the verify cron
--                              creates the Phase 3A assignment row and links it
--                              here). ON DELETE SET NULL so assignment cleanup
--                              never deletes the intervention audit trail.
--   - subject_code / chapter_number come from the mastery-cliff signal
--     (signals.ts worstSubject/worstChapter). subject_code carries the same
--     lowercase CHECK as learner_mastery (learner_mastery_subject_lower,
--     20260517100000). chapter_number is an integer platform-wide; P5 covers
--     *grades*, which never appear on this table.
--   - trigger_snapshot is derived metrics only ({ largestDrop, baselineMastery,
--     postCliffMastery, declineStreak, evaluatedAtIso, rulesVersion }) -- no PII
--     (P13). verify_by denormalizes created_at + RECOVERY_WINDOW_DAYS at insert
--     so later window changes are non-retroactive (spec Decision 6).
--
-- No updated_at: the row has exactly one transition (active -> terminal),
-- pinned by resolved_at -- same shape as teacher_remediation_assignments.
--
-- ─── Writes are service-role ONLY ────────────────────────────────────────────
-- The daily-cron worker routes (inject/verify, CRON_SECRET-gated, service role)
-- are the only writers. There is deliberately NO authenticated INSERT/UPDATE/
-- DELETE policy and the grant layer additionally strips write privileges from
-- `authenticated` (defense in depth on top of the absent policies).
--
-- ─── RLS (same migration -- P8) ──────────────────────────────────────────────
-- Four ratified patterns, mirrored from existing precedents:
--   service role ALL    -- auth.role() = 'service_role'
--                          (20260613000004 teacher_remediation_assignments).
--   student SELECT own  -- students.auth_user_id = auth.uid() join.
--   parent SELECT linked-- guardian_student_links dual-status ('active',
--                          'approved'), the exact value set the baseline policy
--                          "Guardians can view childrens classes" uses
--                          (00000000000000_baseline_from_prod.sql ~line 19853;
--                          chk_link_status permits both) and parent_cheers
--                          (20260613000001) mirrors.
--   teacher SELECT      -- canonical class_students x class_teachers roster
--                          join copied from 20260613000004.
--
-- Idempotent throughout: CREATE TABLE / INDEX IF NOT EXISTS; DROP POLICY IF
-- EXISTS before each CREATE POLICY; REVOKE/GRANT are inherently re-runnable.
-- No DROP TABLE / DROP COLUMN. Additive only.
--
-- The companion seed migration 20260619000300_seed_ff_adaptive_remediation_v1.sql
-- seeds the `ff_adaptive_remediation_v1` flag (default OFF).

BEGIN;

-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.adaptive_interventions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  subject_code          text NOT NULL,
  chapter_number        integer NOT NULL CHECK (chapter_number > 0),
  trigger_signal        text NOT NULL DEFAULT 'mastery_cliff'
                          CHECK (trigger_signal IN ('mastery_cliff')),
                          -- v1: mastery_cliff only. Loops B (inactivity) and
                          -- C (at-risk concentration) extend this CHECK in
                          -- follow-up migrations (spec Section 11).
  trigger_snapshot      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'recovered', 'escalated', 'dismissed')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  verify_by             timestamptz NOT NULL,
  resolved_at           timestamptz,
  escalated_to          text
                          CHECK (escalated_to IS NULL OR escalated_to IN ('teacher', 'parent')),
                          -- NULL also covers the terminal no-recipient edge
                          -- case (no roster teacher AND no linked guardian).
  teacher_assignment_id uuid REFERENCES public.teacher_remediation_assignments(id) ON DELETE SET NULL,
  CONSTRAINT adaptive_interventions_subject_lower
    CHECK (subject_code = lower(subject_code))
);

COMMENT ON TABLE public.adaptive_interventions IS
  'Phase A Loop A: canonical state machine for system-initiated remediation '
  'cycles (mastery-cliff -> auto-inject -> verify recovery -> escalate on '
  'failure). One cycle per (student, subject_code, chapter_number); at most '
  'one active row per triple (partial unique index). Written ONLY by the '
  'service-role cron routes; students/parents/teachers have read-only RLS '
  'visibility. trigger_snapshot carries derived metrics only -- no PII (P13). '
  'Spec: docs/superpowers/specs/2026-06-12-phase-a-loop-a-adaptive-remediation-design.md';

COMMENT ON COLUMN public.adaptive_interventions.trigger_snapshot IS
  'Pre/post-cliff baseline frozen at injection time: { largestDrop, '
  'baselineMastery, postCliffMastery, declineStreak, evaluatedAtIso, '
  'rulesVersion }. Derived metrics only -- never PII. Recovery verification '
  'compares ONLY the current mastery reading against this snapshot, so the '
  'loop never depends on old state_events rows surviving retention.';

COMMENT ON COLUMN public.adaptive_interventions.verify_by IS
  'Denormalized recovery deadline (created_at + RECOVERY_WINDOW_DAYS at '
  'insert). The verify cron sweeps (status, verify_by); a later window-length '
  'change is non-retroactive by design.';

COMMENT ON COLUMN public.adaptive_interventions.status IS
  'active -> recovered | escalated (cron-driven terminals). dismissed is the '
  'ops-only hard-stop terminal (spec Section 9 runbook bulk-resolve); the '
  'cron loop never writes it.';

COMMENT ON COLUMN public.adaptive_interventions.teacher_assignment_id IS
  'Set on B2B escalation: FK to the Phase 3A teacher_remediation_assignments '
  'row created for the roster teacher. NULL for B2C (parent) and no-recipient '
  'escalations.';

-- ─── 2. Indexes ──────────────────────────────────────────────────────────────

-- One-active-max per (student, subject, chapter) -- DB-level enforcement of
-- guardrail 5, race-proof against concurrent/duplicate cron invocations.
CREATE UNIQUE INDEX IF NOT EXISTS adaptive_interventions_one_active
  ON public.adaptive_interventions (student_id, subject_code, chapter_number)
  WHERE status = 'active';

-- Verify sweep: "all active rows at/past their deadline".
CREATE INDEX IF NOT EXISTS idx_adaptive_interventions_status_verify_by
  ON public.adaptive_interventions (status, verify_by);

-- /api/rhythm/today lane lookup: "this student's active interventions".
CREATE INDEX IF NOT EXISTS idx_adaptive_interventions_student_status
  ON public.adaptive_interventions (student_id, status);

-- 3-day chapter-cooldown check (guardrail 4): most recent terminal row for
-- the same (student, subject, chapter).
CREATE INDEX IF NOT EXISTS idx_adaptive_interventions_cooldown
  ON public.adaptive_interventions (student_id, subject_code, chapter_number, resolved_at);

-- ─── 3. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.adaptive_interventions ENABLE ROW LEVEL SECURITY;

-- (a) Service role: full access. The cron inject/verify routes are the only
--     writers (mirrors teacher_remediation_assignments_service_all).
DROP POLICY IF EXISTS adaptive_interventions_service_all
  ON public.adaptive_interventions;
CREATE POLICY adaptive_interventions_service_all
  ON public.adaptive_interventions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- (b) Student reads own intervention rows.
DROP POLICY IF EXISTS adaptive_interventions_student_select
  ON public.adaptive_interventions;
CREATE POLICY adaptive_interventions_student_select
  ON public.adaptive_interventions
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT s.id FROM public.students s WHERE s.auth_user_id = auth.uid()
    )
  );

-- (c) Linked guardian reads the child's intervention rows. Dual-status
--     ('active','approved') mirrors the baseline guardian-visibility policies
--     verbatim (chk_link_status permits both spellings of a live link).
DROP POLICY IF EXISTS adaptive_interventions_parent_select
  ON public.adaptive_interventions;
CREATE POLICY adaptive_interventions_parent_select
  ON public.adaptive_interventions
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT gsl.student_id
      FROM public.guardian_student_links gsl
      JOIN public.guardians g ON g.id = gsl.guardian_id
      WHERE g.auth_user_id = auth.uid()
        AND gsl.status IN ('active', 'approved')
    )
  );

-- (d) Roster teacher reads interventions for students genuinely on their
--     roster -- canonical class_students x class_teachers join copied verbatim
--     from 20260613000004_teacher_remediation_assignments.sql.
DROP POLICY IF EXISTS adaptive_interventions_teacher_select
  ON public.adaptive_interventions;
CREATE POLICY adaptive_interventions_teacher_select
  ON public.adaptive_interventions
  FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT cs.student_id
      FROM public.class_students cs
      JOIN public.class_teachers ct ON ct.class_id = cs.class_id
      JOIN public.teachers t        ON t.id = ct.teacher_id
      WHERE t.auth_user_id = auth.uid()
    )
  );

-- (e) Deliberately NO authenticated INSERT/UPDATE/DELETE policy. All writes
--     flow through the service-role cron routes (inject/verify). This omission
--     is the design, not an oversight -- do not add client write policies.

-- ─── 4. Grants (defense in depth under the RLS layer) ────────────────────────
-- Strip default privileges, then re-grant the minimum: authenticated may only
-- SELECT (RLS narrows rows); service_role holds full DML for the cron writers.
REVOKE ALL ON public.adaptive_interventions FROM PUBLIC;
REVOKE ALL ON public.adaptive_interventions FROM anon;
REVOKE ALL ON public.adaptive_interventions FROM authenticated;

GRANT SELECT ON public.adaptive_interventions TO authenticated;
GRANT ALL    ON public.adaptive_interventions TO service_role;

COMMIT;

-- ─── Verify (manual check after applying) ────────────────────────────────────
-- SELECT polname, cmd FROM pg_policies
--  WHERE tablename = 'adaptive_interventions' ORDER BY polname;
--   Expected: adaptive_interventions_parent_select  (SELECT),
--             adaptive_interventions_service_all    (ALL),
--             adaptive_interventions_student_select (SELECT),
--             adaptive_interventions_teacher_select (SELECT).
-- SELECT relrowsecurity FROM pg_class WHERE relname = 'adaptive_interventions';  -- expect: t
-- SELECT indexname FROM pg_indexes WHERE tablename = 'adaptive_interventions';
--   Expected: adaptive_interventions_pkey, adaptive_interventions_one_active,
--             idx_adaptive_interventions_status_verify_by,
--             idx_adaptive_interventions_student_status,
--             idx_adaptive_interventions_cooldown.
