-- Migration: 20260802090100_create_student_exam_entries.sql
-- Purpose: Student-added exam dates — tier 3 of the exam schedule (Wave B),
--          flag-gated by ff_exam_schedule_v1 (seeded OFF in migration
--          20260802090200). This migration alone changes zero behavior:
--          new, empty, additive tables with no reader wired up yet.
--
-- WHY a separate table: school and teacher dates are authoritative and must
-- never be editable by a student. Keeping the student tier in its own table
-- makes that structural rather than a policy people have to remember. The
-- read route unions the tiers; only this table is student-writable.
-- Precedence stays school > teacher > student, enforced server-side in the
-- union — a student entry can never overwrite an authoritative one.
-- (Teacher-tier / tier 2 binding is explicitly out of scope here and stays
-- deferred future work; this migration only adds tier 3.)
--
-- Chapter scope is optional here. When present it narrows the revision plan
-- exactly the way a teacher-set scope does, so the ids must be
-- curriculum_topics ids — enforced by the FK below, not by convention.
--
-- No parent/teacher SELECT policy — student-private by product design: a
-- student entry (e.g. "coaching test Saturday") is the student organising
-- their own work. If it silently surfaced on a parent/teacher view, students
-- would stop adding entries and the signal would be lost entirely. Parents
-- and teachers see school- and teacher-tier dates instead, which are
-- institutional facts the student is not the source of. This is the same
-- shape as the existing learning_events table (student-only SELECT/INSERT,
-- no parent/teacher policy) — not a new pattern. Full rationale in the
-- handoff DECISIONS.md §6.

BEGIN;

CREATE TABLE IF NOT EXISTS public.student_exam_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 120),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_exam_entries_range CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS public.student_exam_entry_topics (
  entry_id uuid NOT NULL REFERENCES public.student_exam_entries(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.curriculum_topics(id),
  PRIMARY KEY (entry_id, topic_id)
);

CREATE INDEX IF NOT EXISTS idx_student_exam_entries_student_date
  ON public.student_exam_entries (student_id, starts_on);

-- Reverse-lookup support (review follow-up) — precedented by
-- student_cluster_assignments, which indexes both sides of its junction
-- table (idx_student_cluster_assignments_student_id AND
-- idx_student_cluster_assignments_cluster_id). The PK on
-- (entry_id, topic_id) only serves lookups starting from entry_id; without
-- this index, "which exam entries touch topic X" would force a full scan.
CREATE INDEX IF NOT EXISTS idx_student_exam_entry_topics_topic ON public.student_exam_entry_topics(topic_id);

ALTER TABLE public.student_exam_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_exam_entry_topics ENABLE ROW LEVEL SECURITY;

-- No parent/teacher SELECT policy — student-private by product design.
DROP POLICY IF EXISTS "students_own_exam_entries_select" ON public.student_exam_entries;
CREATE POLICY "students_own_exam_entries_select"
  ON public.student_exam_entries FOR SELECT
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS "students_own_exam_entries_insert" ON public.student_exam_entries;
CREATE POLICY "students_own_exam_entries_insert"
  ON public.student_exam_entries FOR INSERT
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "students_own_exam_entries_update" ON public.student_exam_entries;
CREATE POLICY "students_own_exam_entries_update"
  ON public.student_exam_entries FOR UPDATE
  USING (student_id = auth.uid())
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "students_own_exam_entries_delete" ON public.student_exam_entries;
CREATE POLICY "students_own_exam_entries_delete"
  ON public.student_exam_entries FOR DELETE
  USING (student_id = auth.uid());

-- Topic rows inherit ownership from their parent entry.
--
-- ARCHITECT REVIEW (2026-08-02, post-hoc on this same migration): the first
-- authored form of this policy inlined the EXISTS subquery directly in
-- USING/WITH CHECK. rls-no-cross-table-recursion.test.ts (the XC-3 P8 static
-- guard) correctly flags that: student_exam_entry_topics and
-- student_exam_entries are both RLS-enabled, and the policy inlines a
-- FROM/JOIN over the latter from the former -- the exact TSB-4 shape
-- (2026-07-02 students<->class_students recursion incident) the guard exists
-- to catch.
--
-- Structural check performed: the 4 policies on student_exam_entries above
-- (select/insert/update/delete) are pure `student_id = auth.uid()`
-- comparisons with ZERO FROM/JOIN of their own, so today there is no back
-- edge and the inline form could not actually recurse -- it would have been
-- safe to grandfather (add to GRANDFATHERED_INLINE_POLICIES with a
-- justification, matching e.g. the synthesis_quality_scores_read_admin
-- entry). That was option (a).
--
-- Chose option (b) instead -- delegate to a SECURITY DEFINER helper -- for
-- three reasons specific to this table, not as a default preference:
--   1. Precedent match, not novelty: this repo's own history shows that a
--      genuinely NEW policy gets the helper treatment rather than a
--      grandfather entry when a clean one is available. The
--      tp_threads_guardian_insert policy (migration 20260720170000) was
--      authored fresh, called public.get_my_guardian_id() from the start,
--      and "required no grandfathering" per this test file's own comments.
--      is_school_admin_of_student (migration 20260702090000) is the template
--      followed below almost verbatim.
--   2. Zero cost today: both tables are brand new and unapplied on any
--      shared/prod database this session -- there is no compensating
--      migration or back-compat concern to amending the policy shape now,
--      unlike retrofitting a long-lived inline policy.
--   3. Stronger invariant than a point-in-time proof: grandfathering
--      documents "safe as of today's neighboring policies." The helper makes
--      student_exam_entry_topics structurally incapable of participating in
--      a recursion cycle through this policy, independent of whatever
--      student_exam_entries' own policies do in the future, because the
--      helper's inner read bypasses RLS entirely.
-- rls-helper
CREATE OR REPLACE FUNCTION public.is_own_exam_entry(p_entry_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.student_exam_entries e
    WHERE e.id = p_entry_id AND e.student_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_own_exam_entry(uuid) IS
  'SECURITY DEFINER RLS helper [rls-helper] (migration 20260802090100). '
  'Returns true iff the caller (auth.uid()) owns the student_exam_entries row '
  'identified by p_entry_id, i.e. student_exam_entries.student_id = '
  'auth.uid(). Used by student_exam_entry_topics policies so a junction-table '
  'row is authorized via its parent entry ownership without inlining a '
  'FROM/JOIN over student_exam_entries directly in the policy predicate. '
  'SECURITY DEFINER so the inner read of student_exam_entries bypasses RLS: '
  'the 4 policies on student_exam_entries are pure auth.uid() checks with no '
  'FROM/JOIN today, so no recursion cycle exists to close right now, but '
  'delegating through a bypass-RLS helper keeps this boundary non-recursive '
  'by construction even if that ever changes -- matching the '
  'is_teacher_of / is_guardian_of / is_school_admin_of_student pattern '
  '(baseline:9181-9228; migration 20260702090000).';

DROP POLICY IF EXISTS "students_own_exam_entry_topics_all" ON public.student_exam_entry_topics;
CREATE POLICY "students_own_exam_entry_topics_all"
  ON public.student_exam_entry_topics FOR ALL
  USING (public.is_own_exam_entry(entry_id))
  WITH CHECK (public.is_own_exam_entry(entry_id));

COMMENT ON POLICY "students_own_exam_entry_topics_all" ON public.student_exam_entry_topics IS
  'Ownership inherited from the parent student_exam_entries row via the '
  'SECURITY DEFINER helper public.is_own_exam_entry(entry_id) -- see that '
  'function comment for the recursion-safety rationale. Same boundary as a '
  'direct EXISTS (SELECT 1 FROM student_exam_entries WHERE id = entry_id AND '
  'student_id = auth.uid()) subquery would express -- same table, same '
  'predicate, same auth.uid() resolution, no over- or under-grant. The only '
  'change from the first-authored form is that the cross-table read now '
  'runs inside a SECURITY DEFINER function instead of inline in the policy '
  'body, per architect review against rls-no-cross-table-recursion.test.ts.';

COMMIT;
