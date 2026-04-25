-- supabase/migrations/20260428000100_wrong_answer_remediations.sql
-- Phase 2.3: misconception remediation cache (stopgap).
--
-- When a student picks the wrong distractor on a quiz question, Foxy can
-- offer a 2-sentence misconception remediation. Phase 3 will replace this
-- with a curated misconception bank authored by the assessment team. For
-- now we cache LLM-generated remediations keyed on (question_id,
-- distractor_index) so the same wrong-answer pattern doesn't re-bill the
-- student.
--
-- Privacy: this table holds NO student-identifying data. It's keyed only
-- on the question + which distractor was picked, so two students who pick
-- distractor 2 on the same question see the same cached remediation. That
-- is the desired behavior.
--
-- RLS: read open to authenticated (any logged-in student may receive a
-- remediation); write restricted to service_role (only the Foxy backend
-- and admin tooling may insert).

BEGIN;

CREATE TABLE IF NOT EXISTS wrong_answer_remediations (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id         UUID         NOT NULL,
  distractor_index    INTEGER      NOT NULL CHECK (distractor_index BETWEEN 0 AND 3),
  remediation_text    TEXT         NOT NULL,
  remediation_text_hi TEXT,
  source              TEXT         NOT NULL DEFAULT 'llm-haiku',
  generated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (question_id, distractor_index)
);

CREATE INDEX IF NOT EXISTS idx_war_question
  ON wrong_answer_remediations (question_id);

ALTER TABLE wrong_answer_remediations ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user (cache is non-PII; same content for all).
DO $$ BEGIN
  CREATE POLICY "war_authenticated_select"
    ON wrong_answer_remediations
    FOR SELECT TO authenticated
    USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Write: service_role only (Foxy backend + admin).
DO $$ BEGIN
  CREATE POLICY "war_service_all"
    ON wrong_answer_remediations
    FOR ALL TO service_role
    USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TABLE wrong_answer_remediations IS
  'Phase 2.3: cached misconception remediation snippets keyed on (question_id, distractor_index). Stopgap for the curated misconception bank in Phase 3.';

COMMIT;
