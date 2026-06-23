-- Migration: 20260623000400_foxy_served_items.sql
-- Purpose: PART B1 (integrity foundation for evidential Foxy quiz). Record every
--          GRADABLE item Foxy serves a student ("Quiz me" evidential question) so
--          that, when the student answers, the grading flow can VERIFY the answer
--          was scored against a SERVER-ISSUED question + server-held correct index
--          — closing the mastery-injection vector where a client could POST an
--          arbitrary {correct:true, concept_id} to move mastery.
--
-- REUSE INVESTIGATION (required by the task): the existing tutor concept-check
--   path (POST /api/tutor/answer -> tutor_commit_attempt RPC, migrations
--   20260525100000/100001) does NOT have a server-issued served-item store:
--     * concept_attempts records the ANSWER (correct, chosen_index, served_at)
--       but holds NO server-issued correct_index to verify the client's `correct`
--       flag against — tutor_commit_attempt TRUSTS the client-supplied `correct`
--       and `chosen_index` parameters directly (route.ts lines 132-144).
--     * There is no row that says "we served THIS question with THIS correct index
--       at THIS time" before the answer arrives.
--   So this substrate is NOT a duplicate. It is the missing verification anchor.
--   ai-engineer will wire grading through the EXISTING
--   tutor_commit_attempt -> learner.concept_check_answered ->
--   conceptMasteryProjector path; this migration only provides the served-item
--   record + the one-evidential-per-concept-per-session uniqueness guard. The
--   grading flow itself is intentionally NOT built here.
--
-- Design:
--   foxy_served_items
--     id            UUID PK
--     session_id    -> foxy_sessions(id)   (the Foxy session the item was served in)
--     student_id    -> students(id)        (owner; RLS anchor)
--     concept_id    -> chapter_concepts(id)(the concept the evidential item probes)
--     question_id   TEXT NULL              (stable id when the item maps to a bank/
--                                           synthetic question; e.g. `${conceptId}:evidential:v1`)
--     question_payload JSONB NULL          (the served stem + options snapshot, so the
--                                           grade can re-derive correctness even for a
--                                           synthetic item not in question_bank)
--     correct_index INT NOT NULL CHECK 0..3(server-held answer key — the verification anchor)
--     served_at     TIMESTAMPTZ NOT NULL DEFAULT now()
--     answered_at   TIMESTAMPTZ NULL       (set by the grading flow on answer)
--     attempt_id    UUID NULL              (links to concept_attempts.attempt_id once graded)
--     created_at/updated_at
--     UNIQUE(session_id, concept_id)       (one evidential item per concept per session)
--
-- RLS: owner-scoped. A student may SELECT / INSERT / UPDATE only their own rows
--   (so the client can read the served stem to render it and the grading flow,
--   running as the student, can stamp answered_at/attempt_id). service_role
--   bypasses RLS for the server-issued INSERT + grade. Parent/teacher read
--   policies are intentionally OMITTED: a served-item is a transient grading
--   artifact, not a progress surface — guardians/teachers see mastery via
--   concept_mastery, never the raw answer key (exposing correct_index to a parent
--   pre-answer would be a leak). This is a deliberate, documented deviation from
--   the 4-pattern template for an answer-key table.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
--   DO/EXCEPTION-guarded CREATE POLICY, CREATE OR REPLACE trigger fn.
-- P5: grades remain TEXT (no grade column here; grade lives on foxy_sessions).
-- Owner: architect. Added: 2026-06-23. Reviewers: ai-engineer (B1 grading wiring),
--   testing, quality.

BEGIN;

CREATE TABLE IF NOT EXISTS public.foxy_served_items (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID         NOT NULL REFERENCES public.foxy_sessions(id)    ON DELETE CASCADE,
  student_id       UUID         NOT NULL REFERENCES public.students(id)         ON DELETE CASCADE,
  concept_id       UUID         NOT NULL REFERENCES public.chapter_concepts(id) ON DELETE CASCADE,
  -- Stable question id when the served item maps to a (bank or synthetic) question.
  question_id      TEXT         NULL,
  -- The served stem + options snapshot, so the grade can re-derive correctness
  -- even for a synthetic item that never entered question_bank. JSONB, IDs/enums
  -- + question content only (no PII).
  question_payload JSONB        NULL,
  -- SERVER-HELD answer key. This is the verification anchor: the grading flow
  -- compares the student's chosen index against THIS value, not a client claim.
  correct_index    INT          NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
  served_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Set by the grading flow when the item is answered. NULL = served, unanswered.
  answered_at      TIMESTAMPTZ  NULL,
  -- Links to concept_attempts.attempt_id once the answer is committed through the
  -- existing tutor_commit_attempt path. NULL until graded.
  attempt_id       UUID         NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- One evidential item per concept per session.
  CONSTRAINT foxy_served_items_session_concept_unique UNIQUE (session_id, concept_id)
);

COMMENT ON TABLE public.foxy_served_items IS
  'PART B1 (20260623000400): server-issued record of every gradable Foxy '
  '"Quiz me" evidential item. correct_index is the SERVER-HELD answer key — the '
  'grading flow verifies the student''s answer against it (anti mastery-injection). '
  'NOT a duplicate of concept_attempts: that table records the answer but holds no '
  'server-issued key. Grading is wired by ai-engineer through the EXISTING '
  'tutor_commit_attempt -> learner.concept_check_answered -> conceptMasteryProjector '
  'path; this table is the verification substrate + one-evidential-per-concept-per-'
  'session guard only.';
COMMENT ON COLUMN public.foxy_served_items.correct_index IS
  'Server-held answer key (0..3). The verification anchor — never exposed to a '
  'parent/teacher pre-answer; guardians see mastery via concept_mastery only.';

-- Indexes on FK / hot-read columns.
CREATE INDEX IF NOT EXISTS idx_foxy_served_items_student   ON public.foxy_served_items (student_id);
CREATE INDEX IF NOT EXISTS idx_foxy_served_items_session   ON public.foxy_served_items (session_id);
CREATE INDEX IF NOT EXISTS idx_foxy_served_items_concept   ON public.foxy_served_items (concept_id);
-- Hot path for the grading flow: find the unanswered served item for (session, concept).
CREATE INDEX IF NOT EXISTS idx_foxy_served_items_unanswered
  ON public.foxy_served_items (session_id, concept_id)
  WHERE answered_at IS NULL;

-- RLS (mandatory).
ALTER TABLE public.foxy_served_items ENABLE ROW LEVEL SECURITY;

-- Student reads own served items (to render the stem).
DO $$ BEGIN
  CREATE POLICY "foxy_served_items_student_select" ON public.foxy_served_items
    FOR SELECT USING (
      student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Student inserts own served items (defence-in-depth; production writes go via
-- service_role, but an authenticated insert must still be self-scoped).
DO $$ BEGIN
  CREATE POLICY "foxy_served_items_student_insert" ON public.foxy_served_items
    FOR INSERT WITH CHECK (
      student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Student updates own served items (grading flow stamps answered_at / attempt_id).
DO $$ BEGIN
  CREATE POLICY "foxy_served_items_student_update" ON public.foxy_served_items
    FOR UPDATE USING (
      student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
    ) WITH CHECK (
      student_id IN (SELECT id FROM public.students WHERE auth_user_id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- service_role full access (server-issued insert + server-side grade).
DO $$ BEGIN
  CREATE POLICY "foxy_served_items_service_role_all" ON public.foxy_served_items
    AS PERMISSIVE FOR ALL TO service_role
    USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- updated_at trigger.
CREATE OR REPLACE FUNCTION public.update_foxy_served_items_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_foxy_served_items_updated_at ON public.foxy_served_items;
CREATE TRIGGER trg_foxy_served_items_updated_at
  BEFORE UPDATE ON public.foxy_served_items
  FOR EACH ROW EXECUTE FUNCTION public.update_foxy_served_items_updated_at();

INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, details, created_at)
VALUES (
  NULL,
  'mastery_integrity.foxy_served_items_table_created',
  'system',
  NULL,
  jsonb_build_object(
    'migrated_at', now(),
    'reason', 'PART B1: server-issued served-item substrate (correct_index answer key + one-evidential-per-concept-per-session UNIQUE) for evidential Foxy quiz verification — anti mastery-injection',
    'reuse_decision', 'new table; concept_attempts records the answer but holds no server-issued correct_index to verify against',
    'rls', 'owner-scoped (student select/insert/update own) + service_role all; parent/teacher read intentionally omitted (answer-key table)',
    'table', 'foxy_served_items'
  ),
  now()
);

COMMIT;
