-- Migration: 20260715140000_foxy_sessions_lesson_state.sql
-- Purpose: Add per-session lesson-step persistence to foxy_sessions so the
--          Foxy Teaching Director can advance a lesson across conversation
--          turns (Phase 2.1).
--
-- Additive only: two nullable columns, no data migration, no change to any
-- existing column, index, trigger, or to any table's RLS posture. The writer
-- will be gated by ff_foxy_teaching_director_v1; these columns are inert
-- nullable storage until that flag is flipped.
--
-- RLS: UNCHANGED — no policy added or altered. foxy_sessions RLS is row-scoped
-- by student_id (student-own via get_my_student_id(), plus a service_role
-- bypass; see baseline policies "Students see/write/insert/update own foxy
-- sessions" and "foxy_sessions_service_role"). Postgres RLS is enforced at the
-- ROW level, never the column level: any principal already permitted to
-- SELECT/UPDATE a foxy_sessions row automatically covers these new columns.
-- No new policy is needed.

-- 1. lesson_step — the current lesson step for the active objective, or NULL at
--    the start of a lesson. The value set is COUPLED to the TypeScript
--    LESSON_STEPS constant in packages/lib/src/cognitive-engine.ts
--    (['hook','visualization','guided_examples','active_recall','application',
--    'spaced_revision']). Keep the CHECK list below in sync if that array
--    changes (assessment owns the LESSON_STEPS coupling).
ALTER TABLE "public"."foxy_sessions"
  ADD COLUMN IF NOT EXISTS "lesson_step" "text";

-- 2. lesson_objective_concept_id — the chapter_concepts row the current lesson
--    is progressing, or NULL when no lesson is active. The FK mirrors the
--    existing question_misconceptions.remediation_concept_id -> chapter_concepts(id)
--    pattern (ON DELETE SET NULL): if a concept is regenerated or deleted the
--    session's pointer is nulled rather than blocking the delete or orphaning
--    the row. The Teaching Director re-resolves the objective on the next turn.
ALTER TABLE "public"."foxy_sessions"
  ADD COLUMN IF NOT EXISTS "lesson_objective_concept_id" "uuid";

-- Permissive CHECK on lesson_step: allow NULL + the six LESSON_STEPS values.
-- Guarded so re-running the migration is a no-op instead of erroring on the
-- already-present constraint. All existing rows have lesson_step = NULL (the
-- column was just added), so validation is non-blocking.
DO $$
BEGIN
  ALTER TABLE "public"."foxy_sessions"
    ADD CONSTRAINT "foxy_sessions_lesson_step_check"
    CHECK (
      "lesson_step" IS NULL OR "lesson_step" = ANY (ARRAY[
        'hook'::"text",
        'visualization'::"text",
        'guided_examples'::"text",
        'active_recall'::"text",
        'application'::"text",
        'spaced_revision'::"text"
      ])
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- constraint already present; idempotent no-op
END
$$;

-- Hard FK to chapter_concepts(id), ON DELETE SET NULL — matches the existing
-- question_misconceptions_remediation_concept_id_fkey precedent. Guarded for
-- idempotency; all existing rows are NULL so validation is non-blocking.
DO $$
BEGIN
  ALTER TABLE "public"."foxy_sessions"
    ADD CONSTRAINT "foxy_sessions_lesson_objective_concept_id_fkey"
    FOREIGN KEY ("lesson_objective_concept_id")
    REFERENCES "public"."chapter_concepts"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- FK already present; idempotent no-op
END
$$;

COMMENT ON COLUMN "public"."foxy_sessions"."lesson_step" IS
  'Current lesson step for the active objective. One of LESSON_STEPS in packages/lib/src/cognitive-engine.ts (hook|visualization|guided_examples|active_recall|application|spaced_revision), or NULL at lesson start. Written by the Foxy Teaching Director, gated by ff_foxy_teaching_director_v1. CHECK constraint value set is coupled to that TS constant.';

COMMENT ON COLUMN "public"."foxy_sessions"."lesson_objective_concept_id" IS
  'chapter_concepts.id the current lesson is progressing, or NULL when no lesson is active. FK ON DELETE SET NULL (mirrors question_misconceptions.remediation_concept_id). Written by the Foxy Teaching Director, gated by ff_foxy_teaching_director_v1.';
