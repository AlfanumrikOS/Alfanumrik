-- MIGRATION: 20260428000500_misconception_candidate_view
-- =====================================================
-- Migration: 20260428000500_misconception_candidate_view.sql
-- Purpose: Phase 3 of Foxy moat plan — editorial substrate for the
--          ~6,000 misconception annotations. Rather than try to author
--          all annotations programmatically (which would be low-quality
--          and unaccountable), we ship two pieces of editorial scaffold:
--
--          1) A read-only view `misconception_candidates` that surfaces
--             each (question_id, distractor_index) where the wrong-pick
--             rate among real student responses is high enough that the
--             distractor likely encodes a real misconception (not noise).
--
--          2) A curator-only RLS policy on `question_misconceptions` so
--             content editors with the `super_admin` role can write
--             curated rows; everyone else only reads (existing policy).
--
--          The view is the primary editorial input: editors sort by
--          `wrong_rate desc`, write a `misconception_code` + `label`,
--          and INSERT into `question_misconceptions`. A future Edge
--          Function (foxy-tutor-misconception-author) can pre-fill
--          drafts from Claude Sonnet and stage them for editor approval,
--          but no rows go live without curator review.
--
-- Idempotent. P5 grade strings preserved. No schema mutation outside
-- adding the view + the curator policy.

-- ─── 1. misconception_candidates view ─────────────────────────────────────
CREATE OR REPLACE VIEW misconception_candidates AS
WITH per_qd AS (
  SELECT
    qr.question_id,
    qr.student_answer_index              AS distractor_index,
    COUNT(*)                        AS times_picked,
    COUNT(*) FILTER (WHERE qr.is_correct = false) AS times_wrong
  FROM quiz_responses qr
  WHERE qr.student_answer_index IS NOT NULL
    AND qr.student_answer_index BETWEEN 0 AND 3
  GROUP BY qr.question_id, qr.student_answer_index
),
totals AS (
  SELECT question_id, SUM(times_picked) AS total_responses
    FROM per_qd
   GROUP BY question_id
)
SELECT
  pq.question_id,
  pq.distractor_index,
  pq.times_picked,
  pq.times_wrong,
  t.total_responses,
  ROUND(pq.times_wrong::NUMERIC / NULLIF(t.total_responses, 0), 4) AS wrong_rate,
  qb.question_text,
  qb.options,
  qb.correct_answer_index,
  qb.subject,
  qb.grade,
  qb.chapter_number,
  EXISTS (
    SELECT 1 FROM question_misconceptions qm
     WHERE qm.question_id = pq.question_id
       AND qm.distractor_index = pq.distractor_index
  ) AS has_curated_misconception
FROM per_qd pq
JOIN totals t ON t.question_id = pq.question_id
JOIN question_bank qb ON qb.id = pq.question_id
WHERE qb.is_active = true
  AND pq.distractor_index <> qb.correct_answer_index   -- only WRONG picks
  AND t.total_responses >= 10                          -- noise floor
  AND pq.times_wrong >= 3
  AND (pq.times_wrong::NUMERIC / NULLIF(t.total_responses, 0)) >= 0.10;

COMMENT ON VIEW misconception_candidates IS
  'Phase 3 editorial input. Surfaces (question_id, distractor_index) '
  'pairs where the distractor is picked by >=10% of responders to a '
  'question with >=10 total responses. Editors curate '
  'question_misconceptions rows by sorting wrong_rate DESC and writing '
  'a misconception_code + label. has_curated_misconception flags pairs '
  'already done so editors can skip them.';

-- ─── 2. Curator write policy on question_misconceptions ───────────────────
-- The base table has authenticated read but no write policy, so writes
-- are service-role-only. Add an explicit super_admin path so editors
-- working through the super-admin console can INSERT/UPDATE without the
-- service-role key being shipped to the client.

DO $$ BEGIN
  CREATE POLICY "qm_super_admin_write"
    ON question_misconceptions
    FOR ALL TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.auth_user_id = auth.uid()
          AND ur.is_active   = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.name IN ('super_admin', 'admin')
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.auth_user_id = auth.uid()
          AND ur.is_active   = true
          AND (ur.expires_at IS NULL OR ur.expires_at > now())
          AND r.name IN ('super_admin', 'admin')
      )
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN
    RAISE NOTICE 'qm_super_admin_write: user_roles/roles missing — skipping';
  WHEN undefined_column THEN
    RAISE NOTICE 'qm_super_admin_write: column shape mismatch — skipping';
END $$;

-- View grants: authenticated reads (matches existing question_misconceptions
-- read pattern; the view itself joins question_bank + quiz_responses both
-- of which already gate read access at row level).
GRANT SELECT ON misconception_candidates TO authenticated;
GRANT SELECT ON misconception_candidates TO service_role;



-- =====================================================
