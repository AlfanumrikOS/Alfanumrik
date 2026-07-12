-- Keep application and database idempotency aligned: both assigned and
-- in_progress are open work. The previous partial index protected assigned
-- rows only, so an assigned row could transition to in_progress while a racing
-- writer inserted another assigned row for the same learner/class/topic.
--
-- This is forward-only. Existing audit rows are retained: when legacy open
-- duplicates exist, keep an in-progress row (work already started) ahead of an
-- assigned row, then keep the oldest stable row within that status. All other
-- duplicates transition to the established dismissed terminal state.

BEGIN;

LOCK TABLE public.teacher_remediation_assignments IN SHARE ROW EXCLUSIVE MODE;

DO $dedupe$
DECLARE
  v_dismissed integer := 0;
BEGIN
  WITH ranked AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY student_id,
                          class_id,
                          COALESCE(
                            chapter_id,
                            '00000000-0000-0000-0000-000000000000'::uuid
                          )
             ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END,
                      created_at ASC,
                      id ASC
           ) AS rn
      FROM public.teacher_remediation_assignments
     WHERE status IN ('assigned', 'in_progress')
  ),
  dismissed AS (
    UPDATE public.teacher_remediation_assignments AS assignment
       SET status = 'dismissed',
           resolved_at = now()
      FROM ranked
     WHERE assignment.id = ranked.id
       AND ranked.rn > 1
    RETURNING assignment.id
  )
  SELECT count(*) INTO v_dismissed FROM dismissed;

  RAISE NOTICE
    'teacher_remediation_open_status_dedupe: dismissed % duplicate open assignment row(s)',
    v_dismissed;
END $dedupe$;

DROP INDEX IF EXISTS public.uq_teacher_remediation_assignments_open_dedupe;

CREATE UNIQUE INDEX uq_teacher_remediation_assignments_open_dedupe
  ON public.teacher_remediation_assignments (
    student_id,
    class_id,
    (COALESCE(chapter_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  WHERE status IN ('assigned', 'in_progress');

COMMENT ON INDEX public.uq_teacher_remediation_assignments_open_dedupe IS
  'At most one open remediation assignment (assigned or in_progress) per '
  'student x class x chapter. NULL chapter_id is bucketed with the RFC 4122 '
  'nil UUID. This index is the atomic backstop for teacher and cron writers.';

COMMIT;
