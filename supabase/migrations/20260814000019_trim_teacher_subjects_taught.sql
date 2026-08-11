-- Migration: 20260814000019_trim_teacher_subjects_taught.sql
-- Phase 3 / M8 — Server-authoritative allowed-subject policy: teacher repair.
--
-- CEO-APPROVED. This is the teacher-side counterpart to M4 (20260814000009),
-- which repaired STUDENT subject state only. M4's header, and the read-only
-- diagnostic at docs/subject-restriction-teacher-impact.sql, both recorded
-- that trimming teachers.subjects_taught was held pending this approval
-- because a teacher trimmed to zero subjects has no obvious product state.
-- Approval is now given; this migration does the trim and hands the
-- zero-subject population to support as an explicit count.
--
-- Purpose
--   Trim teachers.subjects_taught to its intersection with the ACTIVE subjects
--   master, order-preserving, archiving the pre-change array first.
--
-- WHY
--   /api/teacher/subjects (apps/host/src/app/api/teacher/subjects/route.ts)
--   intersects teachers.subjects_taught with the active subjects master and
--   silently drops any stored code that is not in it. When that intersection
--   is empty the route returns `{ subjects: [] }` — not an error — and the
--   teacher Command Center renders blank. After M1 (20260814000007)
--   deactivated everything outside the keep-set, every English / social
--   science / language / elective teacher is in exactly that state.
--
--   BE PRECISE ABOUT WHAT THIS FIXES. The route already computes the
--   intersection at read time, so the trim does NOT change any API response
--   and does NOT un-blank a Command Center. What it does is make the STORED
--   state equal the EFFECTIVE state, so that:
--     * the stranded population becomes countable (step 6's audit row) instead
--       of being hidden behind a read-time filter, and
--     * downstream writers that read subjects_taught back and re-save it (the
--       teacher-profile self-serve subject picker) can no longer resurrect a
--       deactivated code by round-tripping a stale array.
--   The blank Command Center for a zero-subject teacher is a PRODUCT decision
--   that remains open; this migration produces the number that decision needs.
--   The route already returns `allSubjects` (the full active master), so a
--   zero-subject teacher still has a catalogue to pick from and can self-serve
--   out of the state.
--
-- WHY the trim keys on subjects.is_active, and why that CANNOT drift from the
-- diagnostic's keep-set predicate
--   docs/subject-restriction-teacher-impact.sql sizes the blast radius using
--   the keep-set literal (`c IN (SELECT code FROM keep)`); this migration
--   trims using the active catalogue (`sub.is_active`). Its header asserts the
--   two are equivalent post-M1. Rather than trust that, step 1 PROVES it: it
--   compares the active catalogue against the keep-set in both directions and
--   raises if they differ. If M1 has not been applied, or if a subject was
--   activated/deactivated out of band since, this migration refuses to run
--   rather than trim every teacher against a catalogue nobody reviewed.
--   The keep-set is declared exactly ONCE in this file (step 0) and is used by
--   step 1 alone; every mutating statement reads subjects.is_active, which
--   step 1 has just proven identical to it.
--
-- WHY "NOT IN (keep-set)" AND NEVER "IN (removal-list)"
--   Same reason as M1/M2/M3: public.subjects holds MORE codes than seed.sql
--   declares (see the 20260528000010 header — informatics_practices,
--   health_fitness, psychology, fine_arts, sociology, home_science were
--   inserted out of band). Step 1's drift check is written as
--   `code NOT IN (keep-set)` over the whole active catalogue, so an unknown
--   sixth active subject trips it instead of slipping through.
--
-- EXPLICITLY NOT DONE
--   * NO teacher account is deleted, soft-deleted or deactivated. is_active,
--     deleted_at, auth_user_id and every other teachers column except
--     subjects_taught are untouched. A teacher trimmed to zero subjects keeps
--     their account, their login and their classes.
--   * public.classes, public.class_teachers, public.class_students and
--     public.class_enrollments are NOT read or written. A class whose subject
--     is now inactive keeps its teacher and its roster.
--   * teachers.grades_taught is NOT touched (grades are STRINGS, P5, and this
--     migration has no business rewriting them).
--   * No content row (question_bank / cbse_syllabus / rag_content_chunks).
--
-- ARCHIVE-TABLE DECISION (checked, per the P8 requirement)
--   legacy_subjects_archive does NOT fit and is NOT reused. It is
--   student-keyed: `student_id UUID NOT NULL` carrying
--   legacy_subjects_archive_student_id_fkey → students(id) ON DELETE CASCADE
--   (baseline lines 12093-12099 / 19176-19177), and its only RLS policy is
--   `lsa_read_own USING (student_id = auth.uid())`. Writing a teacher UUID
--   into it would fail the foreign key outright, and even if it did not, the
--   row would be invisible-by-design to the teacher and mis-typed for every
--   existing reader. A purpose-built table is therefore created below WITH
--   RLS enabled, PUBLIC/anon/authenticated revoked, and an explicit
--   service-role-only SELECT policy in this same file, per P8.
--
-- Non-destructive: no DROP TABLE / DROP COLUMN. Every pre-change array is
-- copied to the archive before the UPDATE runs.
--
-- Trigger side effects on teachers (checked, all benign):
--   set_updated_at / trg_teachers_updated (BEFORE UPDATE) bump updated_at —
--   expected and harmless. trg_onboarding_complete_on_teacher is
--   AFTER INSERT OR UPDATE **OF auth_user_id**, so a subjects_taught-only
--   UPDATE does not fire it. trg_sync_teacher_role is AFTER INSERT only.
--   No onboarding state and no role assignment changes here.
--
-- Ordering: apply AFTER 20260814000007 (M1) — step 1 enforces this.
--
-- Idempotency — per statement, see the inline notes below each block.

BEGIN;

-- ─── 0. KEEP-SET, declared exactly once for this file ───────────────────────
-- Idempotent: ON COMMIT DROP means the temp table never survives the
-- transaction, so every run (re-run included) starts from a clean create.
CREATE TEMP TABLE _keep_subject_codes ON COMMIT DROP AS
WITH keep(code) AS (
  VALUES ('math'), ('science'), ('physics'), ('chemistry'), ('biology')
)
SELECT k.code FROM keep k;

-- ─── 1. GUARD: the active catalogue must BE the keep-set ────────────────────
-- Both directions are checked. An EXTRA active subject means the trim would
-- preserve a code the diagnostic modelled as removed (the two would disagree);
-- a MISSING keep-set subject means the trim would strip a code the CEO locked
-- in (over-trimming every teacher who holds it). Either is drift, and either
-- makes the diagnostic's sizing wrong, so both abort.
--
-- `WHERE sub.is_active` treats NULL as false, matching get_available_subjects()
-- and M1's own `IS DISTINCT FROM TRUE` semantics — subjects.is_active is a
-- nullable boolean.
--
-- Idempotent: read-only. Raising rolls back the whole transaction (nothing has
-- been mutated at this point anyway).
DO $$
DECLARE
  v_extra   TEXT;
  v_missing TEXT;
BEGIN
  SELECT string_agg(sub.code, ', ' ORDER BY sub.code)
    INTO v_extra
    FROM public.subjects sub
   WHERE sub.is_active
     AND sub.code NOT IN (SELECT k.code FROM _keep_subject_codes k);

  SELECT string_agg(k.code, ', ' ORDER BY k.code)
    INTO v_missing
    FROM _keep_subject_codes k
   WHERE NOT EXISTS (
     SELECT 1 FROM public.subjects sub
      WHERE sub.code = k.code AND sub.is_active
   );

  IF v_extra IS NOT NULL OR v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'active subjects catalogue does not equal the Phase 3 keep-set (unexpected active: [%]; missing from active: [%]) — refusing to trim teachers.subjects_taught against an unreviewed catalogue',
      COALESCE(v_extra, ''), COALESCE(v_missing, '')
      USING
        ERRCODE = 'check_violation',
        HINT    = 'Apply 20260814000007 (M1) first. If a subject was activated or deactivated out of band, reconcile public.subjects with the CEO-locked keep-set (math, science, physics, chemistry, biology) and re-run. Do NOT weaken the keep-set or this guard to make it pass.';
  END IF;
END;
$$;

-- ─── 2. Compute the trim, once, for every affected teacher ──────────────────
-- One row per teacher whose stored array differs from its active-intersection.
-- Feeds the archive (step 4), the UPDATE (step 5) and the counts (step 6), so
-- all three see identical before/after pairs by construction.
--
-- Order-preserving: WITH ORDINALITY captures the stored position and
-- ARRAY_AGG(... ORDER BY u.ord) rebuilds in that order. Duplicate codes are
-- preserved as-is — de-duplicating would be an unrelated behaviour change.
--
-- ARRAY_AGG over zero surviving elements yields NULL, so after_codes is
-- COALESCEd to '{}' — matching the column's own DEFAULT '{}'::text[] rather
-- than introducing NULL where the schema expects an empty array.
--
-- IS DISTINCT FROM (not <>) so a NULL stored array compares correctly against
-- the empty-array result and does not silently qualify as "changed".
--
-- Soft-deleted / deactivated teachers ARE included: subjects_taught is data
-- hygiene, not an access grant, and leaving stale codes on a soft-deleted row
-- would resurrect them if the account is ever restored. They are counted
-- separately in step 6 so they cannot inflate the support hand-off number.
--
-- Idempotent: ON COMMIT DROP, and self-extinguishing — after step 5 no teacher
-- differs from their active-intersection, so a re-run builds an EMPTY table
-- and steps 4, 5 and 6 all become no-ops.
CREATE TEMP TABLE _teacher_subject_trim ON COMMIT DROP AS
SELECT
  t.id                                              AS teacher_id,
  COALESCE(t.subjects_taught, ARRAY[]::TEXT[])      AS before_codes,
  COALESCE(agg.after_codes,  ARRAY[]::TEXT[])       AS after_codes,
  (t.deleted_at IS NULL AND COALESCE(t.is_active, TRUE)) AS is_live
FROM public.teachers t
LEFT JOIN LATERAL (
  SELECT ARRAY_AGG(u.c ORDER BY u.ord) AS after_codes
    FROM UNNEST(COALESCE(t.subjects_taught, ARRAY[]::TEXT[]))
         WITH ORDINALITY AS u(c, ord)
   WHERE EXISTS (
     SELECT 1 FROM public.subjects sub
      WHERE sub.code = u.c AND sub.is_active
   )
) agg ON TRUE
WHERE COALESCE(t.subjects_taught, ARRAY[]::TEXT[])
      IS DISTINCT FROM COALESCE(agg.after_codes, ARRAY[]::TEXT[]);

-- ─── 3. Archive table (P8: RLS in the same migration) ───────────────────────
-- Rollback source of truth for step 5. Holds teacher UUIDs and subject codes
-- only — no name, email, phone or school. No PII.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS /
-- ENABLE ROW LEVEL SECURITY (a no-op when already enabled) / convergent
-- REVOKE+GRANT / DROP POLICY IF EXISTS before CREATE POLICY.
CREATE TABLE IF NOT EXISTS public.teacher_subjects_taught_archive_20260814 (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id             UUID NOT NULL
                           REFERENCES public.teachers(id) ON DELETE CASCADE,
  subjects_taught_before TEXT[] NOT NULL,
  subjects_taught_after  TEXT[] NOT NULL,
  archived_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One archive row per teacher: this table is scoped to a single dated
-- migration, so a second row for the same teacher could only ever be a
-- double-archive bug. The index makes step 4's guard structural rather than
-- merely procedural.
CREATE UNIQUE INDEX IF NOT EXISTS teacher_subj_archive_20260814_teacher_uniq
  ON public.teacher_subjects_taught_archive_20260814 (teacher_id);

COMMENT ON TABLE public.teacher_subjects_taught_archive_20260814 IS
  'Phase 3 M8 rollback source: pre-change teachers.subjects_taught for every '
  'teacher trimmed by migration 20260814000019, alongside the trimmed result. '
  'Service-role read only. Teacher UUIDs and subject codes only, no PII. '
  'Roll back with: UPDATE teachers t SET subjects_taught = a.subjects_taught_before '
  'FROM teacher_subjects_taught_archive_20260814 a WHERE a.teacher_id = t.id.';

-- RLS: this table holds no student data and no teacher PII, but P8 requires
-- RLS on every new table. It is service-role-only — no student, parent or
-- teacher read path exists for it, so the four-pattern policy set collapses to
-- the admin pattern alone (service_role additionally bypasses RLS by design;
-- the explicit policy below documents the intended reach and keeps the table
-- deny-by-default for every other role).
ALTER TABLE public.teacher_subjects_taught_archive_20260814 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.teacher_subjects_taught_archive_20260814 FROM PUBLIC;
REVOKE ALL ON TABLE public.teacher_subjects_taught_archive_20260814 FROM anon, authenticated;
GRANT SELECT ON TABLE public.teacher_subjects_taught_archive_20260814 TO service_role;

DROP POLICY IF EXISTS teacher_subj_archive_20260814_service_role_select
  ON public.teacher_subjects_taught_archive_20260814;
CREATE POLICY teacher_subj_archive_20260814_service_role_select
  ON public.teacher_subjects_taught_archive_20260814
  FOR SELECT TO service_role USING (true);

-- ─── 4. Archive every row that step 5 will rewrite ──────────────────────────
-- Runs BEFORE the UPDATE, so before_codes is genuinely the pre-change value.
--
-- Idempotent: guarded by NOT EXISTS on teacher_id (and backed by the unique
-- index from step 3), so re-running copies nothing twice. In practice step 2
-- is already empty on a re-run, which makes this a no-op twice over.
INSERT INTO public.teacher_subjects_taught_archive_20260814 (
  teacher_id, subjects_taught_before, subjects_taught_after, archived_at
)
SELECT x.teacher_id, x.before_codes, x.after_codes, now()
  FROM _teacher_subject_trim x
 WHERE NOT EXISTS (
   SELECT 1
     FROM public.teacher_subjects_taught_archive_20260814 a
    WHERE a.teacher_id = x.teacher_id
 );

-- ─── 5. Trim ────────────────────────────────────────────────────────────────
-- Only subjects_taught is assigned. Joining the temp table (rather than
-- recomputing) guarantees the written value is byte-identical to the value
-- archived in step 4.
--
-- Idempotent: driven entirely by _teacher_subject_trim, which is empty on a
-- re-run (step 2's predicate is self-extinguishing), so a second run updates
-- 0 rows and does not even bump updated_at.
UPDATE public.teachers t
   SET subjects_taught = x.after_codes
  FROM _teacher_subject_trim x
 WHERE x.teacher_id = t.id;

-- ─── 6. Support hand-off signal ─────────────────────────────────────────────
-- The archive table is the rollback source of truth; this row is the ops
-- breadcrumb pointing at it AND the number support needs.
--
-- teachers_left_with_zero mirrors the diagnostic's `would_be_left_with_zero`
-- (docs/subject-restriction-teacher-impact.sql Q1): a NON-EMPTY stored array
-- trimmed to empty. Teachers who were already empty before the trim are not
-- counted — they are not casualties of this migration and are excluded from
-- the temp table entirely (before = after = '{}' fails step 2's predicate).
--
-- teachers_left_with_zero_live is the SUPPORT HAND-OFF NUMBER: the same set
-- restricted to accounts that are actually live (deleted_at IS NULL AND
-- is_active), i.e. real people who will open a blank Command Center tomorrow.
-- Soft-deleted and deactivated teachers are trimmed too but must not inflate
-- that number.
--
-- Counts only — no teacher id, name, email or subject list. P13.
--
-- Idempotent: guarded by NOT EXISTS on the action code, so exactly one row
-- ever exists for this migration. That guard matters: on a re-run the temp
-- table is empty, so an unguarded INSERT would append a second row reading
-- 0/0 and destroy the hand-off signal.
INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
SELECT
  NULL,
  'subject.teacher_subjects.trimmed',
  'system',
  NULL,
  jsonb_build_object(
    'archive_table',    'public.teacher_subjects_taught_archive_20260814',
    'teachers_total',   (SELECT count(*) FROM public.teachers),
    'teachers_trimmed', (SELECT count(*) FROM _teacher_subject_trim),
    'teachers_left_with_zero',
      (SELECT count(*) FROM _teacher_subject_trim x
        WHERE array_length(x.before_codes, 1) IS NOT NULL
          AND array_length(x.after_codes,  1) IS NULL),
    'teachers_left_with_zero_live',
      (SELECT count(*) FROM _teacher_subject_trim x
        WHERE x.is_live
          AND array_length(x.before_codes, 1) IS NOT NULL
          AND array_length(x.after_codes,  1) IS NULL),
    'teachers_partially_trimmed',
      (SELECT count(*) FROM _teacher_subject_trim x
        WHERE array_length(x.after_codes, 1) IS NOT NULL),
    'kept',        (SELECT array_agg(k.code ORDER BY k.code) FROM _keep_subject_codes k),
    'diagnostic',  'docs/subject-restriction-teacher-impact.sql',
    'migration',   '20260814000019_trim_teacher_subjects_taught',
    'applied_at',  now()
  ),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.admin_audit_log l
   WHERE l.action = 'subject.teacher_subjects.trimmed'
);

COMMIT;
